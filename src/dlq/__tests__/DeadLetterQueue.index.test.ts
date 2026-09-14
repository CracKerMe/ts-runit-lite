import { beforeEach, describe, expect, it } from "vitest";
import { DeadLetterQueue } from "../DeadLetterQueue";

/**
 * entryIndex 与 entries 数组必须始终一致。按 id 查找走 Map（O(1)），
 * 但 entries 数组仍负责 FIFO 顺序与容量淘汰——任何整体替换数组的路径
 * （恢复、清空）都要重建/清空索引，否则索引会指向已删除的条目。
 */
describe("DeadLetterQueue – id index consistency", () => {
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    dlq = new DeadLetterQueue();
  });

  async function pushEntry(tag: string): Promise<string> {
    return dlq.push({
      type: "task",
      payload: { tag },
      error: `failure ${tag}`,
      retryCount: 0,
    });
  }

  it("finds an entry by id after push", async () => {
    const id = await pushEntry("a");
    const entry = await dlq.get(id);

    expect(entry).not.toBeNull();
    expect(entry?.id).toBe(id);
  });

  it("stops finding an entry after remove", async () => {
    const id = await pushEntry("a");
    expect(await dlq.remove(id)).toBe(true);

    expect(await dlq.get(id)).toBeNull();
    // 二次删除必须返回 false，而不是命中陈旧索引
    expect(await dlq.remove(id)).toBe(false);
    expect((await dlq.list()).entries).toHaveLength(0);
  });

  it("stops finding entries after clear", async () => {
    const ids = [await pushEntry("a"), await pushEntry("b")];
    await dlq.clear();

    for (const id of ids) {
      expect(await dlq.get(id)).toBeNull();
    }
    expect((await dlq.list()).entries).toHaveLength(0);
  });

  it("stops finding an entry after pop", async () => {
    const id = await pushEntry("a");
    const popped = await dlq.pop();

    expect(popped?.id).toBe(id);
    expect(await dlq.get(id)).toBeNull();
  });

  it("drops the oldest entry from the index when capacity is exceeded", async () => {
    const small = new DeadLetterQueue(undefined, 2);
    const first = await small.push({
      type: "task",
      payload: {},
      error: "first",
      retryCount: 0,
    });
    const second = await small.push({
      type: "task",
      payload: {},
      error: "second",
      retryCount: 0,
    });
    const third = await small.push({
      type: "task",
      payload: {},
      error: "third",
      retryCount: 0,
    });

    // 最旧的条目被淘汰，索引里也不应再有它
    expect(await small.get(first)).toBeNull();
    expect(await small.get(second)).not.toBeNull();
    expect(await small.get(third)).not.toBeNull();
    expect((await small.list()).entries).toHaveLength(2);
  });

  it("keeps lookups correct across many mixed operations", async () => {
    const live = new Set<string>();
    const allIds: string[] = [];
    for (let i = 0; i < 200; i++) {
      const id = await pushEntry(`e${i}`);
      live.add(id);
      allIds.push(id);
    }

    // 删掉一半——遍历独立的 id 快照，避免在遍历 live 的同时修改它
    let n = 0;
    for (const id of allIds) {
      if (n++ % 2 === 0) {
        await dlq.remove(id);
        live.delete(id);
      }
    }

    for (const id of live) {
      expect(await dlq.get(id)).not.toBeNull();
    }
    expect((await dlq.list()).entries).toHaveLength(live.size);
  });
});
