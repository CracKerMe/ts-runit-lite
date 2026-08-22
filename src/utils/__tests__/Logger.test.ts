// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Logger from "../Logger";

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

describe("Logger", () => {
  let logDir: string;
  let previousLogDir: string | undefined;
  let previousRetentionDays: string | undefined;

  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-test-"));
    previousLogDir = process.env.LOG_DIR;
    previousRetentionDays = process.env.LOG_RETENTION_DAYS;
    process.env.LOG_DIR = logDir;
    Logger.setLogLevel("DEBUG");
  });

  afterEach(() => {
    Logger.setLogLevel("INFO");
    if (previousLogDir === undefined) delete process.env.LOG_DIR;
    else process.env.LOG_DIR = previousLogDir;
    if (previousRetentionDays === undefined)
      delete process.env.LOG_RETENTION_DAYS;
    else process.env.LOG_RETENTION_DAYS = previousRetentionDays;
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  describe("log()", () => {
    it("should write to the daily log file", () => {
      Logger.log("inst-1", "node-1", "Task started");
      expect(readLoggedLines(logDir)).toHaveLength(1);
    });

    it("should include message and context in output", () => {
      Logger.log("inst-1", "node-1", "Task started", { orderId: "123" });
      const [output] = readLoggedLines(logDir);
      expect(output).toContain("Task started");
      expect(output).toContain("inst-1");
    });
  });

  describe("debug()", () => {
    it("should write to the daily log file", () => {
      Logger.debug("system", "storage", "debug message");
      expect(readLoggedLines(logDir)).toHaveLength(1);
    });
  });

  describe("info()", () => {
    it("should write to the daily log file", () => {
      Logger.info("system", "engine", "Engine started");
      const [output] = readLoggedLines(logDir);
      expect(output).toContain("Engine started");
    });
  });

  describe("warn()", () => {
    it("should write to the daily log file", () => {
      Logger.warn("system", "scheduler", "Job skipped");
      expect(readLoggedLines(logDir)).toHaveLength(1);
    });

    it("should include the warning message", () => {
      Logger.warn("system", "cleanup", "Stale instances removed", { count: 3 });
      const [output] = readLoggedLines(logDir);
      expect(output).toContain("Stale instances removed");
    });
  });

  describe("error()", () => {
    it("should write to the daily log file", () => {
      Logger.error("system", "storage", "Connection failed");
      expect(readLoggedLines(logDir)).toHaveLength(1);
    });

    it("should include error message and optional stack", () => {
      Logger.error(
        "system",
        "engine",
        "Unexpected crash",
        "Error: crash\n  at ...",
      );
      const [output] = readLoggedLines(logDir);
      expect(output).toContain("Unexpected crash");
    });
  });

  describe("prefix resolution", () => {
    it("should use [TASK] prefix for context2 containing 'task'", () => {
      Logger.log("inst-1", "task-runner", "msg");
      const [output] = readLoggedLines(logDir);
      expect(output).toContain("[TASK]");
    });

    it("should use [ENGINE] prefix for context2 containing 'engine'", () => {
      Logger.log("inst-1", "engine-core", "msg");
      const [output] = readLoggedLines(logDir);
      expect(output).toContain("[ENGINE]");
    });

    it("should use [SYSTEM] prefix for context2 containing 'system'", () => {
      Logger.log("ctx", "system-check", "msg");
      const [output] = readLoggedLines(logDir);
      expect(output).toContain("[SYSTEM]");
    });

    it("should use [EVENT] prefix for context2 containing 'event'", () => {
      Logger.log("ctx", "event-bus", "msg");
      const [output] = readLoggedLines(logDir);
      expect(output).toContain("[EVENT]");
    });

    it("should default to [WORKFLOW] for unrecognized context2", () => {
      Logger.log("ctx", "random-context", "msg");
      const [output] = readLoggedLines(logDir);
      expect(output).toContain("[WORKFLOW]");
    });

    it("should respect explicit nodeType over context2 inference (action → TASK)", () => {
      Logger.log("ctx", "engine", "msg", undefined, "action");
      const [output] = readLoggedLines(logDir);
      expect(output).toContain("[TASK]");
    });
  });

  describe("Logger namespace export", () => {
    it("should expose all log functions via Logger object", () => {
      expect(typeof Logger.Logger.log).toBe("function");
      expect(typeof Logger.Logger.debug).toBe("function");
      expect(typeof Logger.Logger.info).toBe("function");
      expect(typeof Logger.Logger.warn).toBe("function");
      expect(typeof Logger.Logger.error).toBe("function");
      expect(typeof Logger.Logger.setLevel).toBe("function");
      expect(typeof Logger.Logger.getLevel).toBe("function");
    });
  });

  describe("log levels", () => {
    it("should suppress messages below the configured level", () => {
      Logger.setLogLevel("WARN");

      Logger.debug("system", "storage", "debug message");
      Logger.info("system", "engine", "info message");
      Logger.warn("system", "scheduler", "warn message");

      const lines = readLoggedLines(logDir);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("warn message");
    });

    it("should expose the normalized current level", () => {
      Logger.setLogLevel("error");
      expect(Logger.getLogLevel()).toBe("ERROR");
      expect(Logger.Logger.getLevel()).toBe("ERROR");
    });
  });

  describe("circular reference handling", () => {
    it("should not throw when logging circular references", () => {
      const obj: any = { name: "circular" };
      obj.self = obj;
      expect(() =>
        Logger.log("ctx", "test", "circular test", obj),
      ).not.toThrow();
    });
  });

  describe("log file retention", () => {
    it("should delete daily log files older than the retention window", async () => {
      process.env.LOG_RETENTION_DAYS = "1";
      const staleDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      fs.writeFileSync(path.join(logDir, `${staleDate}.log`), "old\n");

      Logger.info("system", "engine", "trigger cleanup");
      // cleanup runs asynchronously after the write
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fs.existsSync(path.join(logDir, `${staleDate}.log`))).toBe(false);
    });
  });
});
