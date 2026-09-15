import { afterEach, describe, expect, it } from "vitest";
import {
  hashRequestBody,
  IdempotencyStore,
  sharedIdempotencyStore,
} from "../IdempotencyStore";

/**
 * 回归测试：幂等存储必须跨请求共享，且不能无界增长。
 *
 * 此前路由每次请求都 `new IdempotencyStore()`，状态存在实例私有 Map 里，
 * 于是 `reserve()` 永远返回 `reserved`——同一个 Idempotency-Key 重复提交
 * 会重复启动工作流，幂等语义完全失效。
 */

describe("sharedIdempotencyStore", () => {
  it("is a single shared instance across importers", () => {
    expect(sharedIdempotencyStore).toBeInstanceOf(IdempotencyStore);
  });

  it("recognises a repeated key across separate reserve() calls", async () => {
    const store = sharedIdempotencyStore;
    const ns = `test-shared-${Math.random()}`;
    const hash = hashRequestBody({ a: 1 });

    const first = await store.reserve(ns, "key-1", hash);
    expect(first.type).toBe("reserved");

    // 模拟客户端重试：同一个 key 再次进来
    const second = await store.reserve(ns, "key-1", hash);
    expect(second.type).toBe("in_progress");

    await store.complete(ns, "key-1", hash, { instanceId: "inst-1" });

    const third = await store.reserve(ns, "key-1", hash);
    expect(third).toEqual({ type: "hit", value: { instanceId: "inst-1" } });
  });

  it("flags a key reused with a different payload as a conflict", async () => {
    const store = sharedIdempotencyStore;
    const ns = `test-conflict-${Math.random()}`;

    await store.reserve(ns, "key-1", hashRequestBody({ a: 1 }));
    const conflict = await store.reserve(
      ns,
      "key-1",
      hashRequestBody({ a: 2 }),
    );

    expect(conflict.type).toBe("conflict");
  });
});

describe("IdempotencyStore eviction", () => {
  const stores: IdempotencyStore[] = [];

  afterEach(() => {
    for (const s of stores.splice(0)) s.dispose();
  });

  function makeStore(maxSize: number): IdempotencyStore {
    // cleanupIntervalMs: 0 关闭后台定时器，测试内显式调用 evictExpired
    const store = new IdempotencyStore({ maxSize, cleanupIntervalMs: 0 });
    stores.push(store);
    return store;
  }

  it("enforces a capacity bound on caller-supplied keys", async () => {
    const store = makeStore(10);
    const hash = hashRequestBody({});

    for (let i = 0; i < 50; i++) {
      await store.reserve("ns", `key-${i}`, hash);
    }

    expect(store.size).toBeLessThanOrEqual(10);
  });

  it("sweeps expired entries rather than retaining them indefinitely", async () => {
    const store = makeStore(1000);
    const hash = hashRequestBody({});

    // pendingTtlSeconds 为 0 时条目立即过期
    for (let i = 0; i < 20; i++) {
      await store.reserve("ns", `key-${i}`, hash, { pendingTtlSeconds: 0 });
    }
    expect(store.size).toBe(20);

    const evicted = store.evictExpired();

    expect(evicted).toBe(20);
    expect(store.size).toBe(0);
  });

  it("does not evict entries that are still live", async () => {
    const store = makeStore(1000);
    const hash = hashRequestBody({});

    await store.reserve("ns", "live", hash, { pendingTtlSeconds: 600 });
    await store.reserve("ns", "dead", hash, { pendingTtlSeconds: 0 });

    store.evictExpired();

    expect(store.size).toBe(1);
    expect((await store.reserve("ns", "live", hash)).type).toBe("in_progress");
  });

  it("clears state on dispose", async () => {
    const store = makeStore(1000);
    await store.reserve("ns", "key", hashRequestBody({}));
    expect(store.size).toBe(1);

    store.dispose();

    expect(store.size).toBe(0);
  });
});
