// oxlint-disable no-explicit-any -- test file spies on fs internals
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function todayLogFile(dir: string): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  return path.join(dir, `${dateStr}.log`);
}

function readLoggedLines(dir: string): string[] {
  const filePath = todayLogFile(dir);
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

/**
 * Node 内置的 fs 导出在这套测试环境里不可重新定义（Cannot redefine
 * property），所以不能直接 vi.spyOn(fs, "appendFileSync")。改用
 * vi.mock 包一层，计数真实调用次数并转发给真实实现。
 */
const appendFileSyncCalls: unknown[][] = [];
const mkdirSyncCalls: unknown[][] = [];
let appendFileSyncImpl: ((...args: any[]) => any) | null = null;

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    default: {
      ...actual,
      appendFileSync: (...args: any[]) => {
        appendFileSyncCalls.push(args);
        if (appendFileSyncImpl) return appendFileSyncImpl(...args);
        return actual.appendFileSync(
          ...(args as Parameters<typeof actual.appendFileSync>),
        );
      },
      mkdirSync: (...args: any[]) => {
        mkdirSyncCalls.push(args);
        return actual.mkdirSync(
          ...(args as Parameters<typeof actual.mkdirSync>),
        );
      },
    },
    appendFileSync: (...args: any[]) => {
      appendFileSyncCalls.push(args);
      if (appendFileSyncImpl) return appendFileSyncImpl(...args);
      return actual.appendFileSync(
        ...(args as Parameters<typeof actual.appendFileSync>),
      );
    },
    mkdirSync: (...args: any[]) => {
      mkdirSyncCalls.push(args);
      return actual.mkdirSync(...(args as Parameters<typeof actual.mkdirSync>));
    },
  };
});

describe("Logger – buffered async writes", () => {
  let logDir: string;
  let previousLogDir: string | undefined;
  let previousSync: string | undefined;
  let Logger: typeof import("../Logger");

  beforeEach(async () => {
    vi.resetModules();
    appendFileSyncCalls.length = 0;
    mkdirSyncCalls.length = 0;
    appendFileSyncImpl = null;

    Logger = await import("../Logger");

    logDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-buffer-test-"));
    previousLogDir = process.env.LOG_DIR;
    previousSync = process.env.LOG_SYNC;
    delete process.env.LOG_SYNC;
    process.env.LOG_DIR = logDir;
    Logger.setLogLevel("DEBUG");
  });

  afterEach(async () => {
    await Logger.flush();
    Logger.setLogLevel("INFO");
    if (previousLogDir === undefined) delete process.env.LOG_DIR;
    else process.env.LOG_DIR = previousLogDir;
    if (previousSync === undefined) delete process.env.LOG_SYNC;
    else process.env.LOG_SYNC = previousSync;
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it("does not block: appendFileSync is not called synchronously from a single log call", () => {
    // 这是本次修复要解决的具体问题：热路径上的同步 fs 调用。
    // 单条日志调用不应立即触发同步 appendFileSync —— 应当先进入内存缓冲。
    Logger.info("system", "engine", "message 1");

    expect(appendFileSyncCalls).toHaveLength(0);
  });

  it("mkdirSync is only called once per directory across many writes", () => {
    for (let i = 0; i < 20; i++) {
      Logger.info("system", "engine", `message ${i}`);
    }

    expect(mkdirSyncCalls).toHaveLength(1);
  });

  it("flush() writes all buffered lines to disk", async () => {
    for (let i = 0; i < 10; i++) {
      Logger.info("system", "engine", `message ${i}`);
    }

    expect(readLoggedLines(logDir)).toHaveLength(0);

    await Logger.flush();

    expect(readLoggedLines(logDir)).toHaveLength(10);
  });

  it("auto-flushes once the buffer crosses the size threshold", async () => {
    // 阈值是 200 行；不调用 flush() 也应在达到阈值时自动落盘。
    for (let i = 0; i < 205; i++) {
      Logger.info("system", "engine", `bulk message ${i}`);
    }

    const lines = readLoggedLines(logDir);
    expect(lines.length).toBeGreaterThanOrEqual(200);

    await Logger.flush();
    expect(readLoggedLines(logDir)).toHaveLength(205);
  });

  it("auto-flushes on a timer even below the size threshold", async () => {
    Logger.info("system", "engine", "single message");

    expect(readLoggedLines(logDir)).toHaveLength(0);

    // 定时器间隔是 100ms。pendingLines/flushTimers 是模块级单例，
    // 在这套测试运行配置下（vitest.config.ts 的 singleFork: true）
    // 所有测试文件共享同一个进程——其他测试文件里的 Logger 调用会
    // 命中各自独立 import 出来的模块实例，但它们的定时器仍可能在
    // 本测试等待期间到期、写入当时的 process.env.LOG_DIR（全局可变）。
    // 所以这里只断言"我们写的那一行确实被落盘"，不对总行数做精确匹配，
    // 避免因为别的测试文件的定时器在同一窗口内触发而产生假失败。
    await new Promise((resolve) => setTimeout(resolve, 200));

    const lines = readLoggedLines(logDir);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.some((line) => line.includes("single message"))).toBe(true);
  });

  it("batches multiple buffered lines into a single appendFileSync call", async () => {
    for (let i = 0; i < 15; i++) {
      Logger.info("system", "engine", `message ${i}`);
    }
    await Logger.flush();

    // 15 条日志应该被合并成一次写入，而不是 15 次
    const logFileCalls = appendFileSyncCalls.filter((call) =>
      String(call[0]).endsWith(".log"),
    );
    expect(logFileCalls).toHaveLength(1);
    expect(readLoggedLines(logDir)).toHaveLength(15);
  });

  it("never throws even when the underlying write fails", async () => {
    appendFileSyncImpl = () => {
      throw new Error("disk full");
    };

    expect(() => {
      Logger.info("system", "engine", "message");
    }).not.toThrow();

    await expect(Logger.flush()).resolves.toBeUndefined();
  });

  it("respects LOG_SYNC=1 by writing synchronously", () => {
    process.env.LOG_SYNC = "1";

    Logger.info("system", "engine", "sync message");

    // 同步模式下无需 flush 即可读到
    expect(readLoggedLines(logDir)).toHaveLength(1);
  });
});
