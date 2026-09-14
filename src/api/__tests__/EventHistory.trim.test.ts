import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../storage/MemoryStorage";
import { EventHistoryManager } from "../EventHistory";

vi.mock("../../utils/Logger", () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("EventHistoryManager – amortized trimming", () => {
  it("does not scan the whole event store on every write", async () => {
    // 回归守卫：recordEvent 此前每次写入都调用 trimEventHistory()，
    // 后者拉取多达 10000 条事件再在内存里排序——为了删掉最多几条。
    const storage = new MemoryStorage();
    await storage.connect();
    const querySpy = vi.spyOn(storage, "queryEvents");

    const manager = new EventHistoryManager(storage);
    for (let i = 0; i < 250; i++) {
      await manager.recordEvent(`evt.${i}`, { i });
    }

    // 250 次写入应只触发个位数次全量查询，而不是 250 次
    expect(querySpy.mock.calls.length).toBeLessThanOrEqual(5);
    expect(querySpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("still converges to the retention cap", async () => {
    const storage = new MemoryStorage();
    await storage.connect();
    const manager = new EventHistoryManager(storage);

    // 写入远超 MAX_EVENTS(1000) 的量，确认裁剪确实发生
    for (let i = 0; i < 1300; i++) {
      await manager.recordEvent(`evt.${i}`, { i });
    }

    const { total } = await storage.queryEvents({ page: 1, pageSize: 1 });
    // 软上限：允许最多 TRIM_INTERVAL(100) 条的短暂超出
    expect(total).toBeLessThanOrEqual(1100);
  });

  it("keeps recorded events retrievable", async () => {
    const storage = new MemoryStorage();
    await storage.connect();
    const manager = new EventHistoryManager(storage);

    const id = await manager.recordEvent("evt.important", { payload: 1 });
    expect(id).toBeTruthy();

    const events = await manager.getEvents(10, 0);
    expect(events.some((e) => e.event === "evt.important")).toBe(true);
  });
});
