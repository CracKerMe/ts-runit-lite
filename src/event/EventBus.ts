import { Logger } from "../utils/Logger";

export type EventHandler = (data: unknown) => void | Promise<void>;

export class EventBus {
  private handlers: Record<string, EventHandler[]> = {};

  on(event: string, handler: EventHandler): void {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }

  emit(event: string, data: unknown): void {
    this.dispatchLocal(event, data);
  }

  off(event: string, handler: EventHandler): void {
    if (!this.handlers[event]) return;
    this.handlers[event] = this.handlers[event].filter((h) => h !== handler);
  }

  /**
   * 将事件分发给本进程内的订阅者。
   * 如果 handler 返回 Promise（async handler），附加 .catch 防止 unhandled rejection。
   */
  protected dispatchLocal(event: string, data: unknown): void {
    if (this.handlers[event]) {
      for (const h of this.handlers[event]) {
        try {
          const result = h(data);
          // async handler 返回 Promise 时，捕获拒绝防止 unhandled rejection
          if (result && typeof (result as Promise<void>).catch === "function") {
            (result as Promise<void>).catch((error: unknown) => {
              Logger.warn(
                "system",
                "eventbus",
                `Async event handler error for '${event}'`,
                {
                  error: error instanceof Error ? error.message : String(error),
                },
              );
            });
          }
        } catch (error) {
          Logger.warn(
            "system",
            "eventbus",
            `Event handler error for '${event}'`,
            { error: error instanceof Error ? error.message : String(error) },
          );
        }
      }
    }
  }

  /**
   * 释放底层资源（分布式实现关闭订阅连接时使用）
   *
   * 必须清空 handlers：此前 close() 是空操作，destroyContainer() 之后
   * 所有监听器及其闭包捕获的对象（引擎、存储……）仍被 EventBus 持有，
   * 整张对象图无法回收。
   */
  async close(): Promise<void> {
    this.handlers = {};
  }

  /** 已注册的监听器总数。用于测试与内存诊断。 */
  listenerCount(): number {
    return Object.values(this.handlers).reduce(
      (total, list) => total + list.length,
      0,
    );
  }
}

// 全局事件总线
export const eventBus = new EventBus();
