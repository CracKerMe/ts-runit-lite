import { describe, expect, it } from "vitest";
import { createLeaseStore } from "../../utils/LeaseStore";

/**
 * 回归测试：过期 lease 必须被回收。
 *
 * 此前 acquire() 只 set 从不 delete，过期只被判定、从不移除；而
 * CronScheduler 每秒为每个工作流生成一个新 key（`cron:<id>:<秒桶>`）
 * 且从不 release —— Map 只增不减，是明确的无界内存泄漏。
 */

interface EvictableLeaseStore {
  acquire(key: string, holderId: string, ttlMs: number): Promise<boolean>;
  release(key: string, holderId: string): Promise<boolean>;
  evictExpired(): number;
  dispose(): void;
  readonly size: number;
}

function makeStore(): EvictableLeaseStore {
  return createLeaseStore() as unknown as EvictableLeaseStore;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("InMemoryLeaseStore eviction", () => {
  it("evicts expired leases on an explicit sweep", async () => {
    const store = makeStore();

    for (let i = 0; i < 100; i++) {
      await store.acquire(`cron:wf:${i}`, "holder", 1);
    }
    expect(store.size).toBe(100);

    await sleep(20);
    const evicted = store.evictExpired();

    expect(evicted).toBe(100);
    expect(store.size).toBe(0);

    store.dispose();
  });

  it("does not evict leases that are still live", async () => {
    const store = makeStore();

    await store.acquire("live", "holder", 60_000);
    await store.acquire("dead", "holder", 1);
    await sleep(20);

    store.evictExpired();

    expect(store.size).toBe(1);
    store.dispose();
  });

  it("reclaims an expired key in place on re-acquire", async () => {
    const store = makeStore();

    await store.acquire("k", "holder-a", 1);
    await sleep(20);

    // 过期后另一个持有者应能拿到，且不产生额外条目
    const acquired = await store.acquire("k", "holder-b", 60_000);

    expect(acquired).toBe(true);
    expect(store.size).toBe(1);
    store.dispose();
  });

  it("simulates the cron tick pattern without unbounded growth", async () => {
    const store = makeStore();

    // 模拟 500 个 cron tick，每个都是一个永不 release 的新 key
    for (let bucket = 0; bucket < 500; bucket++) {
      await store.acquire(`workflow:lease:cron:wf-1:${bucket}`, "cron", 1);
    }
    expect(store.size).toBe(500);

    await sleep(20);
    store.evictExpired();

    // 修复前这里仍是 500，且会随进程运行时间无限增长
    expect(store.size).toBe(0);
    store.dispose();
  });

  it("still refuses a lease held by someone else", async () => {
    const store = makeStore();

    expect(await store.acquire("k", "holder-a", 60_000)).toBe(true);
    expect(await store.acquire("k", "holder-b", 60_000)).toBe(false);
    // 同一持有者可重入
    expect(await store.acquire("k", "holder-a", 60_000)).toBe(true);

    store.dispose();
  });

  it("releases remove the entry immediately", async () => {
    const store = makeStore();

    await store.acquire("k", "holder", 60_000);
    expect(store.size).toBe(1);

    await store.release("k", "holder");

    expect(store.size).toBe(0);
    store.dispose();
  });
});
