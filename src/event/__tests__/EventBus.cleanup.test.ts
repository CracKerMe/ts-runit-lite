import { describe, expect, it } from "vitest";
import { EventBus } from "../EventBus";

/**
 * 回归测试：close() 必须清空监听器。
 *
 * 此前 close() 是空操作，destroyContainer() 之后所有监听器及其闭包
 * 捕获的对象（引擎、存储……）仍被 EventBus 持有，整张对象图无法回收。
 */

describe("EventBus.close", () => {
  it("clears all registered handlers", async () => {
    const bus = new EventBus();
    bus.on("a", () => {});
    bus.on("a", () => {});
    bus.on("b", () => {});

    expect(bus.listenerCount()).toBe(3);

    await bus.close();

    expect(bus.listenerCount()).toBe(0);
  });

  it("stops dispatching to handlers after close", async () => {
    const bus = new EventBus();
    let calls = 0;
    bus.on("evt", () => {
      calls++;
    });

    bus.emit("evt", {});
    expect(calls).toBe(1);

    await bus.close();
    bus.emit("evt", {});

    expect(calls).toBe(1);
  });

  it("releases closures so their captured objects can be collected", async () => {
    const bus = new EventBus();
    const captured = { big: "payload" };
    bus.on("evt", () => {
      void captured.big;
    });

    await bus.close();

    // 无法直接断言 GC，但监听器数量归零即闭包已不再被总线持有
    expect(bus.listenerCount()).toBe(0);
  });

  it("still works normally after close (bus is reusable)", async () => {
    const bus = new EventBus();
    await bus.close();

    let received: unknown = null;
    bus.on("evt", (data) => {
      received = data;
    });
    bus.emit("evt", { ok: true });

    expect(received).toEqual({ ok: true });
  });

  it("off() removes a single handler without affecting others", () => {
    const bus = new EventBus();
    const keep = () => {};
    const drop = () => {};
    bus.on("evt", keep);
    bus.on("evt", drop);

    bus.off("evt", drop);

    expect(bus.listenerCount()).toBe(1);
  });
});
