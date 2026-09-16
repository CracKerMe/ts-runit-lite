// oxlint-disable no-explicit-any -- 测试构造最小化的记录形状
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { LocalFileStorage } from "../LocalFileStorage";

/**
 * 清理路径改为"精确删除 + 低频孤儿清扫"之后的行为契约。
 *
 * 精确删除覆盖正常路径；孤儿清扫兜底崩溃在"内存已删、文件未删"之间留下的
 * 残留——那正是这次改动唯一的回归风险点。
 */
describe("LocalFileStorage – cleanup deletes precisely and sweeps orphans", () => {
  let directory: string;
  let storage: LocalFileStorage;

  const instance = (id: string, updatedAt: Date): WorkflowInstance =>
    ({
      instanceId: id,
      workflowId: "wf",
      currentNodes: [],
      status: "completed",
      context: {},
      history: [],
      createdAt: updatedAt,
      updatedAt,
    }) as WorkflowInstance;

  const files = (collection: string): string[] =>
    fs
      .readdirSync(path.join(directory, collection), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "tswe-cleanup-"));
    storage = new LocalFileStorage(directory);
    await storage.connect();
  });

  afterEach(async () => {
    await storage.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("removes the files of instances it just cleaned, and keeps the rest", async () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await storage.saveInstance(instance("stale-1", old));
    await storage.saveInstance(instance("stale-2", old));
    await storage.saveInstance(instance("fresh", new Date()));
    expect(files("instances")).toHaveLength(3);

    storage.cleanupStaleInstances(24 * 60 * 60 * 1000);
    // 清理是同步接口的异步收尾，用 whenIdle 等它结束而不是 sleep 猜时间
    await storage.whenIdle();

    expect(files("instances")).toEqual(["fresh.json"]);
  });

  it("removes the files of events it just cleaned", async () => {
    const oldTs = Date.now() - 10 * 24 * 60 * 60 * 1000;
    await storage.saveEvent({
      id: "evt-old",
      instanceId: "i",
      workflowId: "wf",
      eventType: "t",
      timestamp: oldTs,
      payload: {},
    } as any);
    await storage.saveEvent({
      id: "evt-new",
      instanceId: "i",
      workflowId: "wf",
      eventType: "t",
      timestamp: Date.now(),
      payload: {},
    } as any);
    expect(files("events")).toHaveLength(2);

    await storage.cleanupStaleEvents(1);

    expect(files("events")).toEqual(["evt-new.json"]);
  });

  it("removes the files of heartbeats it just expired", async () => {
    await storage.saveHeartbeat({
      heartbeatKey: "i:expired",
      instanceId: "i",
      nodeId: "expired",
      lastBeat: Date.now() - 60_000,
      deadline: Date.now() - 1000,
    } as any);
    await storage.saveHeartbeat({
      heartbeatKey: "i:live",
      instanceId: "i",
      nodeId: "live",
      lastBeat: Date.now(),
      deadline: Date.now() + 60_000,
    } as any);
    expect(files("heartbeats")).toHaveLength(2);

    await storage.cleanupExpiredHeartbeats();

    expect(files("heartbeats")).toEqual(["i%3Alive.json"]);
  });

  /**
   * 崩溃可能在"内存已删、文件还在"之间留下孤儿。精确删除看不到它们，
   * 必须由周期性清扫回收——否则磁盘会无限增长。
   */
  it("sweeps an orphaned file that memory no longer knows about", async () => {
    await storage.saveEvent({
      id: "evt-live",
      instanceId: "i",
      workflowId: "wf",
      eventType: "t",
      timestamp: Date.now(),
      payload: {},
    } as any);

    // 手工制造一个孤儿：磁盘有、内存无（模拟崩溃留下的残留）
    fs.writeFileSync(
      path.join(directory, "events", "evt-orphan.json"),
      JSON.stringify({
        id: "evt-orphan",
        instanceId: "i",
        workflowId: "wf",
        eventType: "t",
        timestamp: Date.now(),
        payload: {},
      }),
      "utf8",
    );
    expect(files("events")).toContain("evt-orphan.json");

    // 第一次清理就会做一次清扫（上次清扫时间为 0）
    await storage.cleanupStaleEvents(30);

    expect(files("events")).toEqual(["evt-live.json"]);
  });

  it("sweeps orphaned instance files too", async () => {
    await storage.saveInstance(instance("live", new Date()));
    fs.writeFileSync(
      path.join(directory, "instances", "orphan.json"),
      JSON.stringify({ instanceId: "orphan", workflowId: "wf" }),
      "utf8",
    );

    storage.cleanupStaleInstances(24 * 60 * 60 * 1000);
    await storage.whenIdle();

    expect(files("instances")).toEqual(["live.json"]);
  });

  it("does not readdir on every cleanup call", async () => {
    await storage.saveEvent({
      id: "evt-1",
      instanceId: "i",
      workflowId: "wf",
      eventType: "t",
      timestamp: Date.now(),
      payload: {},
    } as any);

    const original = fs.promises.readdir;
    let readdirs = 0;
    (fs.promises as any).readdir = async (...args: any[]) => {
      readdirs++;
      return (original as any)(...args);
    };
    try {
      // 第一次会清扫，后续几次应当被间隔挡住
      for (let i = 0; i < 5; i++) await storage.cleanupStaleEvents(30);
    } finally {
      (fs.promises as any).readdir = original;
    }

    expect(readdirs).toBeLessThan(5);
  });
});
