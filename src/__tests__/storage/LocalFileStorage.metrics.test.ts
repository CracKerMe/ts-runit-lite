// oxlint-disable no-explicit-any -- 测试里需要直接探入 context 的动态形状
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { LocalFileStorage } from "../../storage/LocalFileStorage";
import type {
  InstanceMetrics,
  NodeMetrics,
} from "../../storage/StorageProvider";

/**
 * metrics 按节点拆文件（以及随之而来的借用式快照）的行为契约。
 *
 * 覆盖三件事：
 *  1. 新布局确实是每节点一个文件，且能跨重启恢复；
 *  2. 旧的整实例布局仍然能恢复（升级不丢数据）；
 *  3. 借用引用（peekInstance/peekInstanceMetrics）没有引入别名 bug——
 *     这是本次改动唯一真正的风险点。
 */
describe("LocalFileStorage – per-node metrics layout", () => {
  let directory: string;
  let storage: LocalFileStorage;

  const nodeMetrics = (nodeId: string, retryCount = 0): NodeMetrics => ({
    nodeId,
    nodeType: "action",
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_000_500,
    duration: 500,
    retryCount,
    status: "completed",
  });

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "tswe-metrics-"));
    storage = new LocalFileStorage(directory);
    await storage.connect();
  });

  afterEach(async () => {
    await storage.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function metricsFiles(): string[] {
    return fs
      .readdirSync(path.join(directory, "metrics"), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  }

  it("writes one file per node and restores them all after a restart", async () => {
    for (const nodeId of ["alpha", "beta", "gamma"]) {
      await storage.updateNodeMetrics("inst-1", nodeId, nodeMetrics(nodeId));
    }

    const files = metricsFiles();
    expect(files).toHaveLength(3);
    expect(files.every((name) => name.includes("__"))).toBe(true);

    await storage.close();
    const reopened = new LocalFileStorage(directory);
    await reopened.connect();
    try {
      const restored = await reopened.loadInstanceMetrics("inst-1");
      expect(Object.keys(restored?.nodeMetrics ?? {}).sort()).toEqual([
        "alpha",
        "beta",
        "gamma",
      ]);
      expect(restored?.nodeMetrics.beta?.duration).toBe(500);
    } finally {
      await reopened.close();
    }

    // afterEach 会再 close 一次 storage；重新连上以保持对称
    storage = new LocalFileStorage(directory);
    await storage.connect();
  });

  it("only rewrites the touched node's file, not the whole record", async () => {
    await storage.updateNodeMetrics("inst-1", "alpha", nodeMetrics("alpha"));
    await storage.updateNodeMetrics("inst-1", "beta", nodeMetrics("beta"));

    const alphaPath = path.join(directory, "metrics", metricsFiles()[0]!);
    const before = fs.statSync(alphaPath).mtimeMs;

    // 让 mtime 有机会变化
    await new Promise((resolve) => setTimeout(resolve, 10));
    await storage.updateNodeMetrics("inst-1", "beta", nodeMetrics("beta", 3));

    // alpha 的文件不该被动过
    expect(fs.statSync(alphaPath).mtimeMs).toBe(before);

    const restored = await storage.loadInstanceMetrics("inst-1");
    expect(restored?.nodeMetrics.beta?.retryCount).toBe(3);
    expect(restored?.nodeMetrics.alpha?.retryCount).toBe(0);
  });

  it("restores a legacy whole-instance metrics file", async () => {
    // 手写一份升级前布局的记录
    const legacy: InstanceMetrics = {
      instanceId: "legacy-1",
      workflowId: "wf-legacy",
      nodeMetrics: {
        one: nodeMetrics("one"),
        two: nodeMetrics("two", 2),
      },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000,
    };
    fs.writeFileSync(
      path.join(directory, "metrics", "legacy-1.json"),
      JSON.stringify(legacy),
      "utf8",
    );

    await storage.close();
    storage = new LocalFileStorage(directory);
    await storage.connect();

    const restored = await storage.loadInstanceMetrics("legacy-1");
    expect(restored?.workflowId).toBe("wf-legacy");
    expect(Object.keys(restored?.nodeMetrics ?? {}).sort()).toEqual([
      "one",
      "two",
    ]);
    expect(restored?.nodeMetrics.two?.retryCount).toBe(2);
  });

  it("merges legacy and per-node records for the same instance", async () => {
    const legacy: InstanceMetrics = {
      instanceId: "mixed-1",
      workflowId: "wf-mixed",
      nodeMetrics: { old: nodeMetrics("old") },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    fs.writeFileSync(
      path.join(directory, "metrics", "mixed-1.json"),
      JSON.stringify(legacy),
      "utf8",
    );
    await storage.updateNodeMetrics("mixed-1", "fresh", nodeMetrics("fresh"));

    await storage.close();
    storage = new LocalFileStorage(directory);
    await storage.connect();

    const restored = await storage.loadInstanceMetrics("mixed-1");
    expect(Object.keys(restored?.nodeMetrics ?? {}).sort()).toEqual([
      "fresh",
      "old",
    ]);
    expect(restored?.workflowId).toBe("wf-mixed");
  });

  it("deleteInstanceMetrics removes every node file and the legacy record", async () => {
    fs.writeFileSync(
      path.join(directory, "metrics", "inst-del.json"),
      JSON.stringify({
        instanceId: "inst-del",
        workflowId: "wf",
        nodeMetrics: {},
        createdAt: 1,
        updatedAt: 1,
      }),
      "utf8",
    );
    await storage.updateNodeMetrics("inst-del", "a", nodeMetrics("a"));
    await storage.updateNodeMetrics("inst-del", "b", nodeMetrics("b"));
    expect(metricsFiles().length).toBeGreaterThanOrEqual(3);

    await storage.deleteInstanceMetrics("inst-del");

    expect(metricsFiles()).toHaveLength(0);
    expect(await storage.loadInstanceMetrics("inst-del")).toBeNull();
  });

  it("handles instance and node ids containing the separator and slashes", async () => {
    const instanceId = "inst__weird/id";
    const nodeId = "node__with/slash";
    await storage.updateNodeMetrics(instanceId, nodeId, nodeMetrics(nodeId));

    await storage.close();
    storage = new LocalFileStorage(directory);
    await storage.connect();

    const restored = await storage.loadInstanceMetrics(instanceId);
    expect(restored?.nodeMetrics[nodeId]?.nodeId).toBe(nodeId);
  });
});

describe("LocalFileStorage – borrowed snapshots stay isolated", () => {
  let directory: string;
  let storage: LocalFileStorage;

  const makeInstance = (): WorkflowInstance =>
    ({
      instanceId: "inst-alias",
      workflowId: "wf",
      currentNodes: ["n1"],
      status: "running",
      context: { nested: { value: 1 } },
      history: [],
      createdAt: new Date(1_700_000_000_000),
      updatedAt: new Date(1_700_000_000_000),
      version: 1,
    }) as WorkflowInstance;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "tswe-alias-"));
    storage = new LocalFileStorage(directory);
    await storage.connect();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await storage.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  /**
   * 这是 peekInstance 借用引用引入的**唯一**真实风险：回滚快照是 Map 里的
   * 引用而非副本，若某条路径就地修改了已存储对象，快照就会被从脚下改掉。
   */
  it("rolls back to the pre-save value when the disk write fails", async () => {
    const original = makeInstance();
    await storage.saveInstance(original);

    const renameSpy = vi
      .spyOn(fs.promises, "rename")
      .mockRejectedValue(new Error("disk full"));

    const mutated = {
      ...makeInstance(),
      status: "completed",
      context: { nested: { value: 999 } },
    } as WorkflowInstance;

    await expect(storage.saveInstance(mutated)).rejects.toThrow("disk full");
    renameSpy.mockRestore();

    const afterRollback = await storage.loadInstance("inst-alias");
    expect(afterRollback).not.toBeNull();
    expect(afterRollback?.status).toBe("running");
    expect((afterRollback!.context as Record<string, any>).nested.value).toBe(
      1,
    );

    // 回滚之后修改调用方自己的对象，不得污染已回滚的存储副本
    (mutated.context as Record<string, any>).nested.value = 12345;
    mutated.status = "failed";
    const afterCallerMutation = await storage.loadInstance("inst-alias");
    expect(afterCallerMutation).not.toBeNull();
    expect(afterCallerMutation?.status).toBe("running");
    expect(
      (afterCallerMutation!.context as Record<string, any>).nested.value,
    ).toBe(1);
  });

  it("rolls back a failed CAS update to the pre-CAS version", async () => {
    await storage.saveInstance(makeInstance());
    const stored = await storage.loadInstance("inst-alias");

    const renameSpy = vi
      .spyOn(fs.promises, "rename")
      .mockRejectedValue(new Error("disk full"));

    await expect(
      storage.casUpdateInstance({
        ...stored!,
        status: "completed",
      } as WorkflowInstance),
    ).rejects.toThrow("disk full");
    renameSpy.mockRestore();

    const afterRollback = await storage.loadInstance("inst-alias");
    expect(afterRollback?.status).toBe("running");
    expect(afterRollback?.version).toBe(stored!.version);
  });

  /**
   * updateNodeMetrics 改成"替换而非就地修改"之后，先取出的引用必须保持不变。
   * 这条测试直接钉住那个语义——它是 peekInstanceMetrics 安全性的前提。
   */
  it("does not mutate a previously loaded metrics record in place", async () => {
    await storage.updateNodeMetrics("inst-m", "a", {
      nodeId: "a",
      retryCount: 0,
      status: "running",
    });
    const snapshot = await storage.loadInstanceMetrics("inst-m");

    await storage.updateNodeMetrics("inst-m", "b", {
      nodeId: "b",
      retryCount: 0,
      status: "running",
    });

    // 先前取出的快照不该凭空长出 node b
    expect(Object.keys(snapshot?.nodeMetrics ?? {})).toEqual(["a"]);
    const current = await storage.loadInstanceMetrics("inst-m");
    expect(Object.keys(current?.nodeMetrics ?? {}).sort()).toEqual(["a", "b"]);
  });
});
