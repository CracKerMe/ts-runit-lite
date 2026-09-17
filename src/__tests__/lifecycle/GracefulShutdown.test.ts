import { describe, expect, it, vi } from "vitest";
import { GracefulShutdown, watchParentProcess } from "../../lifecycle";

/**
 * 这些用例锁住的是“Ctrl+C 之后端口必须尽快释放”这条性质。
 *
 * 回归背景：某个关闭回调（典型是等待 WebSocket 对端回应关闭帧的
 * `server.close()`）会一直挂住，整条关闭链卡在那一步，直到 30s 的
 * 强制退出兜底才结束——`tsx watch` 早就放弃等待，监听端口一直被占。
 */
describe("GracefulShutdown", () => {
  /** 取出 `setup()` 注册的 SIGINT 处理器并触发它，同时拦住 process.exit。 */
  async function runShutdown(shutdown: GracefulShutdown): Promise<void> {
    const handlers: Array<() => void> = [];
    const onSpy = vi.spyOn(process, "on").mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (event === "SIGINT") handlers.push(handler);
      return process;
    }) as never);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    try {
      shutdown.setup();
      for (const handler of handlers) handler();
      // 让关闭链跑完（含被放弃的超时回调）。
      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled(), {
        timeout: 5000,
      });
    } finally {
      onSpy.mockRestore();
      exitSpy.mockRestore();
    }
  }

  it("一个挂死的回调不会阻塞后续回调", async () => {
    const order: string[] = [];
    const shutdown = new GracefulShutdown({ callbackTimeout: 50 });

    shutdown.registerCallback(async () => {
      order.push("hangs");
      // 永不 resolve——模拟等待无响应对端的 server.close()。
      await new Promise<void>(() => {});
    });
    shutdown.registerCallback(async () => {
      order.push("runs-after");
    });

    await runShutdown(shutdown);

    // 关键：挂死的回调被放弃后，后面的清理仍然执行到了。
    expect(order).toEqual(["hangs", "runs-after"]);
  });

  it("registerCallbackFirst 把回调插到链首", async () => {
    const order: string[] = [];
    const shutdown = new GracefulShutdown({ callbackTimeout: 50 });

    shutdown.registerCallback(async () => {
      order.push("second");
    });
    shutdown.registerCallbackFirst(async () => {
      order.push("first");
    });

    await runShutdown(shutdown);

    expect(order).toEqual(["first", "second"]);
  });

  it("某个回调抛错不会中断关闭链", async () => {
    const order: string[] = [];
    const shutdown = new GracefulShutdown({ callbackTimeout: 50 });

    shutdown.registerCallback(async () => {
      order.push("throws");
      throw new Error("boom");
    });
    shutdown.registerCallback(async () => {
      order.push("still-runs");
    });

    await runShutdown(shutdown);

    expect(order).toEqual(["throws", "still-runs"]);
  });
});

describe("watchParentProcess", () => {
  it("父进程消失（ppid 变化）时触发回调", async () => {
    const ppidSpy = vi.spyOn(process, "ppid", "get").mockReturnValue(4242);
    const onOrphaned = vi.fn();

    try {
      const timer = watchParentProcess(onOrphaned, 10);
      expect(timer).not.toBeNull();
      expect(onOrphaned).not.toHaveBeenCalled();

      // 被 init 收养。
      ppidSpy.mockReturnValue(1);
      await vi.waitFor(() => expect(onOrphaned).toHaveBeenCalledTimes(1), {
        timeout: 1000,
      });

      // 只触发一次。
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(onOrphaned).toHaveBeenCalledTimes(1);
      if (timer) clearInterval(timer);
    } finally {
      ppidSpy.mockRestore();
    }
  });

  it("本来就没有父进程（ppid <= 1）时不启用", () => {
    const ppidSpy = vi.spyOn(process, "ppid", "get").mockReturnValue(1);
    try {
      expect(watchParentProcess(vi.fn(), 10)).toBeNull();
    } finally {
      ppidSpy.mockRestore();
    }
  });
});
