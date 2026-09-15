// oxlint-disable no-explicit-any -- test file exercises dynamic context shapes
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { MemoryStorage } from "../MemoryStorage";

/**
 * 回归测试：deepClone 改用 structuredClone 后，克隆语义必须保持不变。
 *
 * structuredClone 有两处会**静默**改变语义的地方：Buffer 降级成
 * Uint8Array，类实例丢失原型链。二者都不抛错，所以必须由测试守住。
 */

function makeInstance(context: Record<string, any> = {}): WorkflowInstance {
  return {
    instanceId: "inst-1",
    workflowId: "wf-1",
    currentNodes: ["node-1"],
    status: "running",
    context,
    history: [],
    createdAt: new Date(1_700_000_000_000),
    updatedAt: new Date(1_700_000_000_000),
    retries: {},
    state: { nodes: {} },
  };
}

describe("MemoryStorage deep clone fidelity", () => {
  let storage: MemoryStorage;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.connect();
  });

  async function roundTrip(context: Record<string, any>): Promise<any> {
    await storage.saveInstance(makeInstance(context));
    const loaded = await storage.loadInstance("inst-1");
    return loaded!.context;
  }

  it("isolates the stored copy from later mutation of the caller's object", async () => {
    const context = { nested: { list: [1, 2, 3] } };
    await storage.saveInstance(makeInstance(context));

    context.nested.list.push(4);
    const loaded = await storage.loadInstance("inst-1");

    expect(loaded!.context.nested.list).toEqual([1, 2, 3]);
  });

  it("isolates the loaded copy from mutation of the stored copy", async () => {
    await storage.saveInstance(makeInstance({ nested: { n: 1 } }));

    const a = await storage.loadInstance("inst-1");
    a!.context.nested.n = 999;
    const b = await storage.loadInstance("inst-1");

    expect(b!.context.nested.n).toBe(1);
  });

  it("preserves Date instances", async () => {
    const when = new Date(1_699_999_999_000);
    const ctx = await roundTrip({ when });

    expect(ctx.when).toBeInstanceOf(Date);
    expect(ctx.when.getTime()).toBe(when.getTime());
    expect(ctx.when).not.toBe(when);
  });

  it("preserves top-level instance dates", async () => {
    await storage.saveInstance(makeInstance());
    const loaded = await storage.loadInstance("inst-1");

    expect(loaded!.createdAt).toBeInstanceOf(Date);
    expect(loaded!.updatedAt).toBeInstanceOf(Date);
    expect(loaded!.createdAt.getTime()).toBe(1_700_000_000_000);
  });

  it("preserves Map with deep-cloned values", async () => {
    const map = new Map<string, { n: number }>([["k", { n: 1 }]]);
    const ctx = await roundTrip({ map });

    expect(ctx.map).toBeInstanceOf(Map);
    expect(ctx.map.get("k")).toEqual({ n: 1 });
    expect(ctx.map.get("k")).not.toBe(map.get("k"));
  });

  it("preserves Set", async () => {
    const ctx = await roundTrip({ set: new Set([1, 2, 3]) });

    expect(ctx.set).toBeInstanceOf(Set);
    expect([...ctx.set]).toEqual([1, 2, 3]);
  });

  it("preserves RegExp source and flags", async () => {
    const ctx = await roundTrip({ re: /ab+c/gi });

    expect(ctx.re).toBeInstanceOf(RegExp);
    expect(ctx.re.source).toBe("ab+c");
    expect(ctx.re.flags).toBe("gi");
  });

  it("keeps Buffer a Buffer rather than degrading it to Uint8Array", async () => {
    const buf = Buffer.from("hello");
    const ctx = await roundTrip({ buf });

    expect(Buffer.isBuffer(ctx.buf)).toBe(true);
    expect(ctx.buf.toString()).toBe("hello");
    expect(ctx.buf).not.toBe(buf);
  });

  it("keeps a nested Buffer a Buffer", async () => {
    const ctx = await roundTrip({ a: { b: { buf: Buffer.from("deep") } } });

    expect(Buffer.isBuffer(ctx.a.b.buf)).toBe(true);
    expect(ctx.a.b.buf.toString()).toBe("deep");
  });

  it("preserves the prototype chain of class instances", async () => {
    class Money {
      constructor(public amount: number) {}
      format(): string {
        return `$${this.amount}`;
      }
    }

    const ctx = await roundTrip({ price: new Money(42) });

    expect(ctx.price).toBeInstanceOf(Money);
    expect(ctx.price.format()).toBe("$42");
  });

  it("handles circular references without overflowing", async () => {
    const cyclic: any = { name: "root" };
    cyclic.self = cyclic;

    const ctx = await roundTrip({ cyclic });

    expect(ctx.cyclic.name).toBe("root");
    expect(ctx.cyclic.self).toBe(ctx.cyclic);
  });

  it("falls back without throwing when the context contains a function", async () => {
    const ctx = await roundTrip({ fn: () => 1, keep: "value" });

    // 关键是不抛错且其余字段完好；函数本身是否可序列化不作保证。
    expect(ctx.keep).toBe("value");
  });

  it("round-trips a plain JSON-shaped context (the common case)", async () => {
    const ctx = await roundTrip({
      str: "s",
      num: 1.5,
      bool: true,
      nil: null,
      arr: [1, "two", { three: 3 }],
      obj: { nested: { deep: true } },
    });

    expect(ctx).toEqual({
      str: "s",
      num: 1.5,
      bool: true,
      nil: null,
      arr: [1, "two", { three: 3 }],
      obj: { nested: { deep: true } },
    });
  });

  it("normalises string dates on write so reads return Date objects", async () => {
    const instance = makeInstance();
    // 模拟从 JSON 恢复的实例：日期是字符串
    (instance as any).createdAt = "2023-11-14T22:13:20.000Z";
    (instance as any).updatedAt = "2023-11-14T22:13:20.000Z";

    await storage.saveInstance(instance);
    const loaded = await storage.loadInstance("inst-1");

    expect(loaded!.createdAt).toBeInstanceOf(Date);
    expect(loaded!.updatedAt).toBeInstanceOf(Date);
  });

  it("normalises history timestamps on write", async () => {
    const instance = makeInstance();
    instance.history = [
      {
        timestamp: "2023-11-14T22:13:20.000Z" as any,
        nodeId: "n1",
        status: "completed",
        message: "done",
      } as any,
    ];

    await storage.saveInstance(instance);
    const loaded = await storage.loadInstance("inst-1");

    expect(loaded!.history[0]!.timestamp).toBeInstanceOf(Date);
  });

  it("keeps CAS-updated instances correctly cloned", async () => {
    const instance = makeInstance({ nested: { n: 1 } });
    instance.version = 1;
    await storage.saveInstance(instance);

    const ok = await storage.casUpdateInstance({
      ...instance,
      context: { nested: { n: 2 } },
    });

    expect(ok).toBe(true);
    const loaded = await storage.loadInstance("inst-1");
    expect(loaded!.context.nested.n).toBe(2);
    expect(loaded!.version).toBe(2);
  });
});
