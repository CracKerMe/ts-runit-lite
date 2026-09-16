// oxlint-disable no-explicit-any -- 测试构造最小化的记录形状
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { MemoryStorage } from "../../storage/MemoryStorage";
import type {
  EventRecord,
  InstanceQueryParams,
} from "../../storage/StorageProvider";

/**
 * 暴露内部索引规模。
 *
 * 必须直接看索引本身，不能只看查询结果：查询在缩小候选集之后仍会对每条
 * 记录做完整过滤，所以**漏摘的索引不会产生错误结果，只会让桶白白变大**。
 * 只断言查询结果的话，把 removeFromIndex 整段删掉测试依然全绿——试过了。
 */
class InspectableStorage extends MemoryStorage {
  indexSizes(): ReturnType<MemoryStorage["indexSizesForTest"]> {
    return this.indexSizesForTest();
  }
}

/**
 * 二级索引的一致性契约。
 *
 * 索引唯一的风险就是和主 Map 失配，而失配是静默的——查询只会少返回几条，
 * 不会报错。因此这里的核心是 **property-style 测试**：随机跑一串
 * save/cas/delete/cleanup，再拿索引查询的结果和暴力全扫描逐一对照。
 * 任何一条漏挂/漏摘的索引都会在这里暴露。
 */
describe("MemoryStorage – secondary index consistency", () => {
  let storage: InspectableStorage;

  const instance = (
    overrides: Partial<WorkflowInstance> & { instanceId: string },
  ): WorkflowInstance =>
    ({
      workflowId: "wf-a",
      currentNodes: [],
      status: "running",
      context: {},
      history: [],
      createdAt: new Date(1_700_000_000_000),
      updatedAt: new Date(1_700_000_000_000),
      ...overrides,
    }) as WorkflowInstance;

  const event = (
    overrides: Partial<EventRecord> & { id: string },
  ): EventRecord =>
    ({
      instanceId: "inst-1",
      workflowId: "wf-a",
      eventType: "started",
      timestamp: 1_700_000_000_000,
      payload: {},
      ...overrides,
    }) as EventRecord;

  beforeEach(async () => {
    storage = new InspectableStorage();
    await storage.connect();
  });

  it("reflects a status change instead of leaving the instance in both buckets", async () => {
    await storage.saveInstance(instance({ instanceId: "i1" }));
    expect((await storage.queryInstances({ status: "running" })).total).toBe(1);

    // 同一个实例改状态后重新写入
    await storage.saveInstance(
      instance({ instanceId: "i1", status: "completed" }),
    );

    expect((await storage.queryInstances({ status: "completed" })).total).toBe(
      1,
    );
    // 关键：旧桶必须被摘掉，否则它会同时出现在两个状态里
    expect((await storage.queryInstances({ status: "running" })).total).toBe(0);
    // 只有一条实例，status 索引里就该只有一个条目——查询结果测不出这一点
    expect(storage.indexSizes().instancesByStatus).toBe(1);
  });

  it("reflects a workflowId change", async () => {
    await storage.saveInstance(
      instance({ instanceId: "i1", workflowId: "wf-a" }),
    );
    await storage.saveInstance(
      instance({ instanceId: "i1", workflowId: "wf-b" }),
    );

    expect((await storage.queryInstances({ workflowId: "wf-b" })).total).toBe(
      1,
    );
    expect((await storage.queryInstances({ workflowId: "wf-a" })).total).toBe(
      0,
    );
  });

  it("drops an instance from every index on delete", async () => {
    await storage.saveInstance(
      instance({
        instanceId: "i1",
        workflowId: "wf-a",
        status: "running",
        parentInstanceId: "parent-1",
      } as any),
    );
    await storage.deleteInstance("i1");

    expect((await storage.queryInstances({ workflowId: "wf-a" })).total).toBe(
      0,
    );
    expect((await storage.queryInstances({ status: "running" })).total).toBe(0);
    expect(
      (await storage.queryInstances({ parentInstanceId: "parent-1" })).total,
    ).toBe(0);
    // 索引必须真的空掉，而不只是查不出来
    expect(storage.indexSizes()).toEqual({
      instancesByWorkflowId: 0,
      instancesByStatus: 0,
      instancesByParentId: 0,
      eventsByInstanceId: 0,
      eventsByType: 0,
    });
  });

  it("drops instances from the indexes on cleanupStaleInstances", async () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await storage.saveInstance(
      instance({ instanceId: "stale", status: "completed", updatedAt: old }),
    );
    await storage.saveInstance(
      instance({
        instanceId: "fresh",
        status: "completed",
        updatedAt: new Date(),
      }),
    );

    storage.cleanupStaleInstances(24 * 60 * 60 * 1000);

    const remaining = await storage.queryInstances({ status: "completed" });
    expect(remaining.total).toBe(1);
    expect(remaining.instances[0]?.instanceId).toBe("fresh");
  });

  it("keeps event indexes in sync through save, delete and cleanup", async () => {
    await storage.saveEvent(
      event({ id: "e1", instanceId: "inst-1", eventType: "started" }),
    );
    await storage.saveEvent(
      event({ id: "e2", instanceId: "inst-2", eventType: "finished" }),
    );

    expect((await storage.queryEvents({ instanceId: "inst-1" })).total).toBe(1);
    expect((await storage.queryEvents({ eventType: "finished" })).total).toBe(
      1,
    );

    await storage.deleteEvent("e1");
    expect((await storage.queryEvents({ instanceId: "inst-1" })).total).toBe(0);

    // 过期清理也必须摘索引
    await storage.saveEvent(
      event({ id: "e3", instanceId: "inst-3", timestamp: 1 }),
    );
    await storage.cleanupStaleEvents(1);
    expect((await storage.queryEvents({ instanceId: "inst-3" })).total).toBe(0);
  });

  it("combines indexed and unindexed filters correctly", async () => {
    await storage.saveInstance(
      instance({
        instanceId: "i1",
        workflowId: "wf-a",
        status: "running",
        createdAt: new Date(1000),
      }),
    );
    await storage.saveInstance(
      instance({
        instanceId: "i2",
        workflowId: "wf-a",
        status: "running",
        createdAt: new Date(5000),
      }),
    );

    // workflowId/status 走索引，startTime 是索引外的范围条件
    const result = await storage.queryInstances({
      workflowId: "wf-a",
      status: "running",
      startTime: 2000,
    });
    expect(result.total).toBe(1);
    expect(result.instances[0]?.instanceId).toBe("i2");
  });

  it("returns nothing for a value that was never indexed", async () => {
    await storage.saveInstance(instance({ instanceId: "i1" }));
    expect(
      (await storage.queryInstances({ workflowId: "never-seen" })).total,
    ).toBe(0);
    expect((await storage.queryEvents({ eventType: "never-seen" })).total).toBe(
      0,
    );
  });

  /**
   * 这条是真正的护栏：随机操作序列 + 对照暴力全扫描。
   *
   * 用固定种子的伪随机保证失败可复现——随机测试最糟糕的形态是"偶尔红一次
   * 但复现不了"。
   */
  it("matches a brute-force scan after a randomized mutation sequence", async () => {
    // xorshift32：确定性、可复现
    let seed = 0x2f6e2b1;
    const rand = (): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return Math.abs(seed) / 0x7fffffff;
    };
    const pick = <T>(xs: readonly T[]): T =>
      xs[Math.floor(rand() * xs.length)]!;

    const workflowIds = ["wf-a", "wf-b", "wf-c"];
    const statuses = ["running", "completed", "failed", "paused"];
    const parents = ["parent-1", "parent-2", undefined];

    // 影子副本：每一步都跟着主存储同步，作为暴力扫描的对照源
    const shadow = new Map<string, WorkflowInstance>();

    for (let step = 0; step < 600; step++) {
      const id = `i-${Math.floor(rand() * 60)}`;
      const action = rand();

      if (action < 0.6) {
        const next = instance({
          instanceId: id,
          workflowId: pick(workflowIds),
          status: pick(statuses),
          parentInstanceId: pick(parents),
          createdAt: new Date(1_700_000_000_000 + Math.floor(rand() * 10_000)),
        } as any);
        await storage.saveInstance(next);
        shadow.set(id, next);
      } else if (action < 0.75) {
        // CAS 更新：只有版本匹配才会落地，因此以存储的返回值为准
        const current = await storage.loadInstance(id);
        if (current) {
          const next = {
            ...current,
            status: pick(statuses),
            workflowId: pick(workflowIds),
          } as WorkflowInstance;
          const ok = await storage.casUpdateInstance(next);
          if (ok) {
            const stored = await storage.loadInstance(id);
            if (stored) shadow.set(id, stored);
          }
        }
      } else if (action < 0.9) {
        await storage.deleteInstance(id);
        shadow.delete(id);
      } else {
        // 清理：完成态且过期的会被删掉。以存储实际留下的为准同步影子副本
        storage.cleanupStaleInstances(0);
        // 先快照 key 再遍历：循环体里会 delete，不能边迭代边改
        // oxlint-disable-next-line no-useless-spread
        const keys = [...shadow.keys()];
        for (const key of keys) {
          if (!(await storage.loadInstance(key))) shadow.delete(key);
        }
      }
    }

    expect(shadow.size).toBeGreaterThan(0);

    const bruteForce = (params: InstanceQueryParams): string[] =>
      [...shadow.values()]
        .filter((i) => !params.workflowId || i.workflowId === params.workflowId)
        .filter((i) => !params.status || i.status === params.status)
        .filter(
          (i) =>
            !params.parentInstanceId ||
            i.parentInstanceId === params.parentInstanceId,
        )
        .map((i) => i.instanceId)
        .sort();

    // 逐个过滤条件、以及组合条件，全部对照
    const queries: InstanceQueryParams[] = [
      {},
      ...workflowIds.map((workflowId) => ({ workflowId })),
      ...statuses.map((status) => ({ status })),
      { parentInstanceId: "parent-1" },
      { parentInstanceId: "parent-2" },
      { workflowId: "wf-a", status: "running" },
      { workflowId: "wf-b", status: "completed" },
      { workflowId: "wf-c", status: "failed", parentInstanceId: "parent-1" },
    ];

    // 索引必须是**紧**的：条目数恰好等于记录数，不多不少。
    // 少了 = 漏挂（会漏查，但被后置过滤掩盖）；多了 = 漏摘（陈旧条目堆积，
    // 索引退化成全表扫描却依然返回正确结果）。两种都只有直接看索引才测得出。
    const sizes = storage.indexSizes();
    expect(sizes.instancesByWorkflowId).toBe(shadow.size);
    expect(sizes.instancesByStatus).toBe(shadow.size);
    expect(sizes.instancesByParentId).toBe(
      [...shadow.values()].filter((i) => i.parentInstanceId).length,
    );

    for (const query of queries) {
      const viaIndex = await storage.queryInstances({
        ...query,
        pageSize: 10_000,
      });
      expect(
        viaIndex.instances.map((i) => i.instanceId).sort(),
        `query mismatch for ${JSON.stringify(query)}`,
      ).toEqual(bruteForce(query));
      expect(
        viaIndex.total,
        `total mismatch for ${JSON.stringify(query)}`,
      ).toBe(bruteForce(query).length);
    }
  });
});
