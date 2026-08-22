import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitHook } from "../../event/HookManager";
import type { WorkflowInstance } from "../../model/Instance";
import { ArchiveManager } from "../ArchiveManager";
import { MemoryStorage } from "../MemoryStorage";

function makeInstance(instanceId: string): WorkflowInstance {
  const now = new Date();
  return {
    instanceId,
    workflowId: "archive-test",
    currentNodes: [],
    status: "completed",
    context: {},
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe("ArchiveManager", () => {
  let archiveDir: string;
  let storage: MemoryStorage;
  let manager: ArchiveManager;

  beforeEach(async () => {
    archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-runit-archive-"));
    storage = new MemoryStorage();
    await storage.connect();
    manager = new ArchiveManager(storage, archiveDir);
  });

  afterEach(async () => {
    manager.destroy();
    await storage.close();
    fs.rmSync(archiveDir, { recursive: true, force: true });
  });

  it("archives and evicts terminal instances only after initialization", async () => {
    const instance = makeInstance("archive-instance");
    await storage.saveInstance(instance);
    manager.initialize();

    await emitHook({
      event: "workflow.completed",
      timestamp: new Date().toISOString(),
      workflowId: instance.workflowId,
      instanceId: instance.instanceId,
    });

    const dateDirectory = new Date().toISOString().split("T")[0];
    const archivePath = path.join(
      archiveDir,
      dateDirectory,
      `${instance.instanceId}.json`,
    );
    expect(fs.existsSync(archivePath)).toBe(true);
    const archived = JSON.parse(fs.readFileSync(archivePath, "utf8"));
    expect(archived).toMatchObject({
      instanceId: instance.instanceId,
      workflowId: instance.workflowId,
      status: "completed",
    });
    expect(await storage.loadInstance(instance.instanceId)).toBeNull();
  });

  it("removes archive directories older than the retention period", async () => {
    manager.destroy();
    manager = new ArchiveManager(storage, archiveDir, {
      retentionDays: 30,
      cleanupIntervalMs: 60_000,
    });
    const oldDirectory = path.join(archiveDir, "2020-01-01");
    const recentDirectory = path.join(archiveDir, "2026-08-18");
    fs.mkdirSync(oldDirectory, { recursive: true });
    fs.mkdirSync(recentDirectory, { recursive: true });

    const deleted = await manager.cleanupExpiredArchives(
      Date.parse("2026-08-19T00:00:00.000Z"),
    );

    expect(deleted).toBe(1);
    expect(fs.existsSync(oldDirectory)).toBe(false);
    expect(fs.existsSync(recentDirectory)).toBe(true);
  });

  it("removes global hook subscriptions when destroyed", async () => {
    manager.initialize();
    manager.destroy();

    await emitHook({
      event: "workflow.completed",
      timestamp: new Date().toISOString(),
      workflowId: "archive-test",
      instanceId: "after-destroy",
    });

    const dateDirectory = new Date().toISOString().split("T")[0];
    expect(
      fs.existsSync(path.join(archiveDir, dateDirectory, "after-destroy.json")),
    ).toBe(false);
  });
});
