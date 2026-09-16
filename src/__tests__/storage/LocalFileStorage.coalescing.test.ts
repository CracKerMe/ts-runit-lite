// oxlint-disable no-explicit-any -- 测试需要替换 fs 内部方法做计数
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { LocalFileStorage } from "../../storage/LocalFileStorage";

/**
 * 按 key 合并写入的行为契约。
 *
 * 核心不变量（**不是**持久性窗口）：
 *   persist() 返回时，"本次的值或更新的值"必定已经原子落盘。
 * 被合并掉的中间值只是从未被写过——这和"更新的那次写先发生"在崩溃语义上
 * 不可区分，因此不会丢失任何已确认的写入。
 */
describe("LocalFileStorage – per-key write coalescing", () => {
  let directory: string;
  let storage: LocalFileStorage;

  const makeInstance = (n: number): WorkflowInstance =>
    ({
      instanceId: "inst-coalesce",
      workflowId: "wf",
      currentNodes: [`node-${n}`],
      status: "running",
      context: { n },
      history: [],
      createdAt: new Date(1_700_000_000_000),
      updatedAt: new Date(1_700_000_000_000),
    }) as WorkflowInstance;

  function readStored(): any {
    return JSON.parse(
      fs.readFileSync(
        path.join(directory, "instances", "inst-coalesce.json"),
        "utf8",
      ),
    );
  }

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "tswe-coalesce-"));
    storage = new LocalFileStorage(directory);
    await storage.connect();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await storage.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("collapses a burst of writes to one key into far fewer disk writes", async () => {
    const original = fs.promises.rename;
    let renames = 0;
    (fs.promises as any).rename = async (...args: any[]) => {
      renames++;
      return (original as any)(...args);
    };

    try {
      const BURST = 50;
      await Promise.all(
        Array.from({ length: BURST }, (_, i) =>
          storage.saveInstance(makeInstance(i)),
        ),
      );

      // 最终磁盘内容必须是最后一次写入的值
      expect(readStored().context.n).toBe(BURST - 1);
      // 且落盘次数远少于 50——这正是合并的收益
      expect(renames).toBeLessThan(BURST);
      console.log(`  ${BURST} concurrent saves -> ${renames} renames`);
    } finally {
      (fs.promises as any).rename = original;
    }
  });

  it("still persists the caller's own value when writes are sequential", async () => {
    // 逐个 await 时没有可合并的窗口，每次都必须真正落盘
    for (let i = 0; i < 5; i++) {
      await storage.saveInstance(makeInstance(i));
      expect(readStored().context.n).toBe(i);
    }
  });

  it("a write is visible on disk as soon as its persist() resolves", async () => {
    await storage.saveInstance(makeInstance(42));
    expect(readStored().context.n).toBe(42);
  });

  it("rejects every waiter when a coalesced write fails, and rolls back once", async () => {
    await storage.saveInstance(makeInstance(0));

    const renameSpy = vi
      .spyOn(fs.promises, "rename")
      .mockRejectedValue(new Error("disk full"));

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        storage.saveInstance(makeInstance(i + 1)),
      ),
    );
    renameSpy.mockRestore();

    // 所有等待者都必须看到失败，没有人被静默地"当成成功"
    expect(results.every((r) => r.status === "rejected")).toBe(true);

    // 内存回滚到写入前的值，且与磁盘一致——不能出现内存领先磁盘
    const inMemory = await storage.loadInstance("inst-coalesce");
    expect(inMemory).not.toBeNull();
    expect((inMemory!.context as Record<string, any>).n).toBe(0);
    expect(readStored().context.n).toBe(0);
  });

  it("recovers and keeps writing after a transient failure", async () => {
    await storage.saveInstance(makeInstance(0));

    const renameSpy = vi
      .spyOn(fs.promises, "rename")
      .mockRejectedValueOnce(new Error("transient"));

    await expect(storage.saveInstance(makeInstance(1))).rejects.toThrow(
      "transient",
    );
    renameSpy.mockRestore();

    // 后续写入不受影响
    await storage.saveInstance(makeInstance(2));
    expect(readStored().context.n).toBe(2);
  });

  it("coalesces independently per key", async () => {
    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) =>
        storage.saveInstance({
          ...makeInstance(i),
          instanceId: "a",
        } as WorkflowInstance),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        storage.saveInstance({
          ...makeInstance(i * 100),
          instanceId: "b",
        } as WorkflowInstance),
      ),
    ]);

    const a = JSON.parse(
      fs.readFileSync(path.join(directory, "instances", "a.json"), "utf8"),
    );
    const b = JSON.parse(
      fs.readFileSync(path.join(directory, "instances", "b.json"), "utf8"),
    );
    expect(a.context.n).toBe(9);
    expect(b.context.n).toBe(900);
  });

  it("survives a restart with the last written value", async () => {
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        storage.saveInstance(makeInstance(i)),
      ),
    );
    await storage.close();

    storage = new LocalFileStorage(directory);
    await storage.connect();
    const restored = await storage.loadInstance("inst-coalesce");
    expect(restored).not.toBeNull();
    expect((restored!.context as Record<string, any>).n).toBe(29);
  });
});
