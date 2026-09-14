import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { DeadLetterQueue } from "../../dlq/index";
import { LocalFileStorage } from "../LocalFileStorage";

function makeInstance(instanceId: string): WorkflowInstance {
  return {
    instanceId,
    workflowId: "file-storage-test",
    currentNodes: ["step-1"],
    status: "running",
    context: { orderId: 42 },
    history: [
      {
        nodeId: "step-1",
        timestamp: new Date(),
        status: "started",
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  };
}

describe("LocalFileStorage", () => {
  let directory: string;
  let storage: LocalFileStorage;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "ts-runit-storage-"));
    storage = new LocalFileStorage(directory);
    await storage.connect();
  });

  afterEach(async () => {
    await storage.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("restores instances and waiting state after reopening", async () => {
    const instance = makeInstance("instance-restart");
    await storage.saveInstance(instance);
    await storage.saveEventWaitingState({
      instanceId: instance.instanceId,
      nodeId: "step-1",
      eventType: "order.approved",
      createdAt: Date.now(),
    });
    await storage.close();

    storage = new LocalFileStorage(directory);
    await storage.connect();

    const restored = await storage.loadInstance(instance.instanceId);
    expect(restored?.context.orderId).toBe(42);
    expect(restored?.createdAt).toBeInstanceOf(Date);
    expect(restored?.history[0].timestamp).toBeInstanceOf(Date);
    expect(
      await storage.loadEventWaitingState(instance.instanceId, "step-1"),
    ).toMatchObject({ eventType: "order.approved" });
  });

  it("persists CAS updates atomically", async () => {
    const instance = makeInstance("instance-cas");
    await storage.saveInstance(instance);
    instance.status = "completed";

    expect(await storage.casUpdateInstance(instance)).toBe(true);
    await storage.close();

    storage = new LocalFileStorage(directory);
    await storage.connect();
    expect(await storage.loadInstance(instance.instanceId)).toMatchObject({
      status: "completed",
      version: 2,
    });
  });

  it("persists serializable workflow definitions but skips closures", async () => {
    await storage.saveWorkflowWithMetadata({
      id: "serializable",
      name: "Serializable",
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      definition: {
        id: "serializable",
        name: "Serializable",
        startNode: "start",
        nodes: {
          start: {
            id: "start",
            type: "action",
            config: { action: "return { ok: true }" },
          },
        },
      },
    });
    await storage.saveWorkflow({
      id: "closure",
      name: "Closure",
      startNode: "start",
      nodes: {
        start: {
          id: "start",
          type: "action",
          action: async () => ({ ok: true }),
        },
      },
    });
    await storage.close();

    storage = new LocalFileStorage(directory);
    await storage.connect();
    expect(
      await storage.loadWorkflowWithMetadata("serializable"),
    ).not.toBeNull();
    expect(await storage.loadWorkflow("closure")).toBeNull();
  });

  it("quarantines corrupt records without blocking startup", async () => {
    const instanceDirectory = path.join(directory, "instances");
    await fs.promises.writeFile(
      path.join(instanceDirectory, "broken.json"),
      "{broken",
      "utf8",
    );
    await storage.close();

    storage = new LocalFileStorage(directory);
    await expect(storage.connect()).resolves.toBeUndefined();
    const quarantined = await fs.promises.readdir(
      path.join(instanceDirectory, "corrupt"),
    );
    expect(quarantined.some((name) => name.startsWith("broken-"))).toBe(true);
  });

  it("keeps a valid record on disk when the restore callback throws", async () => {
    // 回归守卫：restoreCollection 曾把 JSON.parse 和 restore 回调放在同一个
    // try 里，导致 restore 侧的 bug 把完全合法的记录 rename 进 corrupt/
    // 而永久丢失。解析成功的记录绝不应因我们自己的 bug 被隔离。
    const instance = makeInstance("instance-restore-bug");
    await storage.saveInstance(instance);
    await storage.close();

    storage = new LocalFileStorage(directory);
    const restoreInstance = (
      storage as unknown as {
        restoreInstance: (value: unknown, id: string) => WorkflowInstance;
      }
    ).restoreInstance.bind(storage);
    (
      storage as unknown as {
        restoreInstance: (value: unknown, id: string) => WorkflowInstance;
      }
    ).restoreInstance = () => {
      throw new Error("simulated restore bug");
    };

    await expect(storage.connect()).resolves.toBeUndefined();

    const instanceDirectory = path.join(directory, "instances");
    const remaining = await fs.promises.readdir(instanceDirectory);
    expect(
      remaining.some((name) => name.startsWith("instance-restore-bug")),
    ).toBe(true);

    const corruptDirectory = path.join(instanceDirectory, "corrupt");
    const quarantined = fs.existsSync(corruptDirectory)
      ? await fs.promises.readdir(corruptDirectory)
      : [];
    expect(quarantined).toEqual([]);

    // 修复 restore 后重启，记录仍可恢复——数据没有丢
    await storage.close();
    storage = new LocalFileStorage(directory);
    (
      storage as unknown as {
        restoreInstance: (value: unknown, id: string) => WorkflowInstance;
      }
    ).restoreInstance = restoreInstance;
    await storage.connect();
    expect(await storage.loadInstance("instance-restore-bug")).not.toBeNull();
  });

  it("starts up despite a file whose name cannot be URI-decoded", async () => {
    // 回归守卫：listFiles 的 decodeURIComponent 抛 URIError 的位置在任何
    // per-record try 之外，一个坏文件名会让整个 connect() 崩掉。
    const instance = makeInstance("instance-alongside-bad-name");
    await storage.saveInstance(instance);
    await storage.close();

    const instanceDirectory = path.join(directory, "instances");
    await fs.promises.writeFile(
      path.join(instanceDirectory, "%zz.json"),
      JSON.stringify({ instanceId: "%zz" }),
      "utf8",
    );

    storage = new LocalFileStorage(directory);
    await expect(storage.connect()).resolves.toBeUndefined();

    // 坏文件名被跳过，其余实例照常恢复
    expect(
      await storage.loadInstance("instance-alongside-bad-name"),
    ).not.toBeNull();
  });

  it("restores dead-letter entries after reopening", async () => {
    let queue = new DeadLetterQueue(storage);
    const id = await queue.push({
      type: "workflow",
      payload: { orderId: 42 },
      error: "failed",
      retryCount: 0,
      workflowId: "file-storage-test",
    });
    await storage.close();

    storage = new LocalFileStorage(directory);
    await storage.connect();
    queue = new DeadLetterQueue(storage);

    expect(await queue.get(id)).toMatchObject({
      id,
      error: "failed",
      workflowId: "file-storage-test",
    });
  });
});
