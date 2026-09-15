import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { MemoryStorage } from "../../storage/MemoryStorage";
import { InstanceManager } from "../InstanceManager";

/**
 * 回归测试：CAS 重试不得原地改写调用方的对象。
 *
 * 此前 `instance.version = currentVersion` 直接写调用方持有的对象，
 * CAS 失败后那个引用会带着一个从未持久化的版本号；lastKnownGood 回滚
 * 只能修 Map 条目，修不了调用方手里的悬空引用。
 */

function makeInstance(id: string): WorkflowInstance {
  return {
    instanceId: id,
    workflowId: "wf-1",
    currentNodes: ["node-1"],
    status: "running",
    context: {},
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    retries: {},
    state: { nodes: {} },
    version: 1,
  };
}

describe("InstanceManager CAS — caller object integrity", () => {
  let storage: MemoryStorage;
  let manager: InstanceManager;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.connect();
    manager = new InstanceManager(storage);
  });

  it("advances the caller's version only after a successful CAS", async () => {
    const instance = makeInstance("inst-1");
    await storage.saveInstance(instance);

    await manager.updateInstance(instance);

    // 成功后调用方对象应与已持久化的版本一致
    const stored = await storage.loadInstance("inst-1");
    expect(instance.version).toBe(stored!.version);
  });

  it("does not leave the caller's object on a never-persisted version after conflict", async () => {
    const instance = makeInstance("inst-2");
    await storage.saveInstance(instance);

    // 制造冲突：另一路写入把存储推进到 version 2
    const other = await storage.loadInstance("inst-2");
    await storage.casUpdateInstance(other!);

    const versionBefore = instance.version;

    try {
      await manager.updateInstance(instance);
    } catch {
      // 冲突耗尽重试是允许的
    }

    const stored = await storage.loadInstance("inst-2");
    // 关键断言：调用方对象要么仍是原值，要么与实际持久化的版本一致，
    // 绝不能停在一个从未落盘的中间版本号上。
    expect([versionBefore, stored!.version]).toContain(instance.version);
  });

  it("persists the update and keeps memory in sync", async () => {
    const instance = makeInstance("inst-3");
    await storage.saveInstance(instance);

    instance.status = "completed";
    await manager.updateInstance(instance);

    const stored = await storage.loadInstance("inst-3");
    expect(stored!.status).toBe("completed");
  });

  it("retries rather than failing immediately under transient contention", async () => {
    const instance = makeInstance("inst-4");
    await storage.saveInstance(instance);

    let casCalls = 0;
    const realCas = storage.casUpdateInstance.bind(storage);
    storage.casUpdateInstance = async (inst) => {
      casCalls++;
      // 第一次人为失败，之后放行 —— 带退避的重试应该能成功
      if (casCalls === 1) return false;
      return realCas(inst);
    };

    await expect(manager.updateInstance(instance)).resolves.not.toThrow();
    expect(casCalls).toBeGreaterThan(1);
  });
});
