// oxlint-disable no-explicit-any -- 测试构造最小化的记录形状
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { LocalFileStorage } from "../../storage/LocalFileStorage";

/**
 * 并行化启动恢复之后的正确性契约。
 *
 * 关键点：并行不能破坏两件事——损坏记录仍要被隔离且不阻断启动，
 * workflow-versions 这种读-改-写的集合仍要拿到完整的版本列表。
 */
describe("LocalFileStorage – parallel restore", () => {
  let directory: string;
  let storage: LocalFileStorage;

  const instance = (id: string): WorkflowInstance =>
    ({
      instanceId: id,
      workflowId: "wf",
      currentNodes: ["n1"],
      status: "running",
      context: { id },
      history: [],
      createdAt: new Date(1_700_000_000_000),
      updatedAt: new Date(1_700_000_000_000),
    }) as WorkflowInstance;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "tswe-restore-"));
    storage = new LocalFileStorage(directory);
    await storage.connect();
  });

  afterEach(async () => {
    await storage.close();
    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env.STORAGE_RESTORE_CONCURRENCY;
  });

  async function reopen(): Promise<void> {
    await storage.close();
    storage = new LocalFileStorage(directory);
    await storage.connect();
  }

  it("restores every record across all collections", async () => {
    for (let i = 0; i < 200; i++) {
      await storage.saveInstance(instance(`inst-${i}`));
      await storage.saveEvent({
        id: `evt-${i}`,
        instanceId: `inst-${i}`,
        workflowId: "wf",
        eventType: "t",
        timestamp: Date.now(),
        payload: { i },
      } as any);
      await storage.updateNodeMetrics(`inst-${i}`, "n1", {
        nodeId: "n1",
        retryCount: 0,
        status: "completed",
      });
    }

    await reopen();

    expect(await storage.listInstances()).toHaveLength(200);
    const restored = await storage.loadInstance("inst-77");
    expect(restored).not.toBeNull();
    expect((restored!.context as Record<string, any>).id).toBe("inst-77");
    expect(
      (await storage.loadInstanceMetrics("inst-77"))?.nodeMetrics.n1?.status,
    ).toBe("completed");
    expect((await storage.loadEvent("evt-77"))?.payload).toEqual({ i: 77 });
  });

  it("keeps every workflow version despite a read-modify-write replay", async () => {
    for (let version = 1; version <= 25; version++) {
      await storage.saveWorkflowVersion({
        id: "wf-versioned",
        name: `v${version}`,
        version,
        definition: { id: "wf-versioned", name: `v${version}` },
        createdAt: Date.now(),
      } as any);
    }

    await reopen();

    const versions = await storage.listWorkflowVersions("wf-versioned");
    expect(versions.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
  });

  it("quarantines a corrupt record without blocking the rest of startup", async () => {
    for (let i = 0; i < 50; i++) {
      await storage.saveInstance(instance(`ok-${i}`));
    }
    fs.writeFileSync(
      path.join(directory, "instances", "broken.json"),
      "{ this is not json",
      "utf8",
    );

    await reopen();

    // 49 条 + 1 条，损坏的那条不该出现
    const ids = await storage.listInstances();
    expect(ids).toHaveLength(50);
    expect(ids).not.toContain("broken");

    // 损坏文件被移入 corrupt/，而不是留在原地或被删掉
    const quarantined = fs.readdirSync(
      path.join(directory, "instances", "corrupt"),
    );
    expect(quarantined.some((name) => name.startsWith("broken"))).toBe(true);
  });

  it("honours STORAGE_RESTORE_CONCURRENCY", async () => {
    for (let i = 0; i < 30; i++) await storage.saveInstance(instance(`c-${i}`));

    process.env.STORAGE_RESTORE_CONCURRENCY = "4";
    await reopen();

    expect(await storage.listInstances()).toHaveLength(30);
  });

  it("falls back to the default for a nonsense concurrency value", async () => {
    await storage.saveInstance(instance("only"));

    process.env.STORAGE_RESTORE_CONCURRENCY = "not-a-number";
    await reopen();

    expect(await storage.listInstances()).toEqual(["only"]);
  });
});
