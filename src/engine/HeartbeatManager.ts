// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import type { StorageProvider } from "../storage/StorageProvider";
import { Logger } from "../utils/Logger";

export interface HeartbeatOptions {
  instanceId: string;
  nodeId: string;
  interval: number;
  onHeartbeat?: (details: any) => void;
  onTimeout?: () => void;
}

export interface HeartbeatState {
  instanceId: string;
  nodeId: string;
  heartbeatKey: string;
  workerId?: string;
  lastBeat: number;
  timeoutMs: number;
  deadline: number;
  createdAt: number;
}

export class HeartbeatManager {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private timeoutTimers: Map<string, NodeJS.Timeout> = new Map();
  private heartbeatStates: Map<string, HeartbeatState> = new Map();
  private heartbeatOptions: Map<string, HeartbeatOptions> = new Map();

  /**
   * 上次成功落盘的时间戳（按 key）。用于对心跳写入去抖。
   *
   * 心跳每 tick 都会写一次存储：走 LocalFileStorage 就是
   * stringify → 临时文件 → rename（开 FSYNC_ON_WRITE 还要两次 fsync），
   * 而每次唯一变化的只是一个时间戳。1 秒间隔 × 100 个并发节点
   * 就是每秒 100 次全文件重写，按 key 的写队列只串行化不合并，
   * 积压会持续增长。
   *
   * 心跳是恢复提示而非事务状态：崩溃后丢失最多 PERSIST_MIN_INTERVAL_MS
   * 的心跳进度是可接受的，超时判定仍以持久化的 deadline 为准。
   */
  private lastPersistedAt: Map<string, number> = new Map();

  /** 心跳落盘的最小间隔。期间的 tick 只更新内存状态。 */
  private static readonly PERSIST_MIN_INTERVAL_MS = 10_000;

  /**
   * 恢复场景下的兜底超时处理器。
   *
   * `heartbeatOptions` 里的回调是闭包，无法序列化，所以只有
   * `heartbeatStates` 被持久化。进程重启后 `heartbeatOptions` 是空的，
   * 恢复出来的心跳就没有 onTimeout——超时定时器照常触发却什么也不做，
   * 卡住的节点永远不会被判失败。引擎在构造时注入这个兜底处理器，
   * 让心跳机制在最需要它的时刻（重启后）仍然有效。
   */
  private defaultOnTimeout?: (instanceId: string, nodeId: string) => void;

  constructor(
    private storage?: StorageProvider,
    private workerId?: string,
  ) {}

  configure(storage?: StorageProvider, workerId?: string): void {
    this.storage = storage;
    this.workerId = workerId;
  }

  /** 设置恢复场景下的兜底超时处理器。 */
  setDefaultOnTimeout(
    handler: (instanceId: string, nodeId: string) => void,
  ): void {
    this.defaultOnTimeout = handler;
  }

  /**
   * @param deadline 从存储恢复时传入原有的 deadline。省略则按
   *   `now + timeoutMs` 重新计算——恢复场景下那会把一个已过去 29s 的
   *   30s 超时窗口重置为完整的 30s，等于丢掉了超时进度。
   */
  async start(
    options: HeartbeatOptions,
    timeoutMs?: number,
    deadline?: number,
  ): Promise<string> {
    const key = this.getKey(options.instanceId, options.nodeId);
    const isRestart = this.timers.has(key);
    if (isRestart) {
      this.stop(options.instanceId, options.nodeId);
    }

    // Store heartbeat state for recovery
    const effectiveTimeoutMs = timeoutMs || options.interval * 3;
    const state: HeartbeatState = {
      instanceId: options.instanceId,
      nodeId: options.nodeId,
      heartbeatKey: key,
      workerId: this.workerId,
      lastBeat: Date.now(),
      timeoutMs: effectiveTimeoutMs,
      deadline: deadline ?? Date.now() + effectiveTimeoutMs,
      createdAt: Date.now(),
    };

    this.heartbeatStates.set(key, state);
    this.heartbeatOptions.set(key, options);

    // Persist to storage
    if (this.storage) {
      try {
        await this.persistHeartbeat(state);
      } catch (error) {
        Logger.error(
          options.instanceId,
          options.nodeId,
          "Failed to persist heartbeat state",
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    const scheduleTimeoutCheck = () => {
      const existingTimeout = this.timeoutTimers.get(key);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeoutTimer = setTimeout(
        () => {
          const activeState = this.heartbeatStates.get(key);
          if (!activeState) {
            return;
          }

          if (Date.now() < activeState.deadline) {
            scheduleTimeoutCheck();
            return;
          }

          this.stop(options.instanceId, options.nodeId);

          if (options.onTimeout) {
            try {
              options.onTimeout();
            } catch (error) {
              Logger.error(
                options.instanceId,
                options.nodeId,
                "Heartbeat timeout callback error",
                error instanceof Error ? error.stack : String(error),
              );
            }
          }
          // 按距离 deadline 的剩余时间布防，而不是完整的 timeoutMs：
          // 从存储恢复时 deadline 可能已经过去大半。
        },
        Math.max(
          0,
          (this.heartbeatStates.get(key)?.deadline ?? 0) - Date.now(),
        ),
      );

      this.timeoutTimers.set(key, timeoutTimer);
    };

    const tick = () => {
      Logger.debug(options.instanceId, options.nodeId, "Heartbeat tick");

      // Update heartbeat state
      const state = this.heartbeatStates.get(key);
      if (state) {
        state.lastBeat = Date.now();
        state.deadline = Date.now() + state.timeoutMs;
        scheduleTimeoutCheck();

        // 去抖：内存状态每 tick 都更新（超时判定依赖它），
        // 但落盘按最小间隔合并，避免写放大。
        if (this.shouldPersistNow(key)) {
          void this.persistHeartbeat(state).catch((error) => {
            Logger.error(
              options.instanceId,
              options.nodeId,
              "Failed to persist heartbeat tick",
              error instanceof Error ? error.stack : String(error),
            );
          });
        }
      }

      if (options.onHeartbeat) {
        try {
          options.onHeartbeat({ timestamp: Date.now() });
        } catch (error) {
          Logger.error(
            options.instanceId,
            options.nodeId,
            "Heartbeat callback error",
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    };

    // 重启时立即触发一次，然后按间隔触发
    if (isRestart) {
      tick();
    }
    const timer = setInterval(tick, options.interval);

    this.timers.set(key, timer);
    scheduleTimeoutCheck();
    Logger.debug(
      options.instanceId,
      options.nodeId,
      `Heartbeat started with interval ${options.interval}ms`,
    );

    return key;
  }

  stop(instanceId: string, nodeId: string): void {
    const key = this.getKey(instanceId, nodeId);

    // 无条件清理超时定时器，不要嵌在 `if (timer)` 里。
    // scheduleTimeoutCheck() 会在定时器回调中自我续期，若 stop() 恰好
    // 发生在「deadline 检查」与「重新布防」之间，就会给一个已经没有
    // interval 条目的 key 装上新的 setTimeout，之后永远没人清理它。
    const timeoutTimer = this.timeoutTimers.get(key);
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      this.timeoutTimers.delete(key);
    }
    this.lastPersistedAt.delete(key);

    const timer = this.timers.get(key);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(key);

      // Remove from memory
      this.heartbeatStates.delete(key);
      this.heartbeatOptions.delete(key);

      // Remove from storage
      if (this.storage) {
        this.storage.deleteHeartbeat?.(instanceId, nodeId).catch((error) => {
          Logger.error(
            instanceId,
            nodeId,
            "Failed to delete heartbeat state",
            error instanceof Error ? error.stack : String(error),
          );
        });
      }

      Logger.debug(instanceId, nodeId, "Heartbeat stopped");
    }
  }

  stopAll(): void {
    for (const [, timer] of this.timers) {
      clearInterval(timer);
    }
    for (const [, timer] of this.timeoutTimers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.timeoutTimers.clear();
    this.heartbeatStates.clear();
    // heartbeatOptions 此前被漏掉，会随进程生命周期无限增长
    this.heartbeatOptions.clear();
    this.lastPersistedAt.clear();
    Logger.debug("system", "heartbeat", "All heartbeats stopped");
  }

  private getKey(instanceId: string, nodeId: string): string {
    return `${instanceId}:${nodeId}`;
  }

  isActive(instanceId: string, nodeId: string): boolean {
    return this.timers.has(this.getKey(instanceId, nodeId));
  }

  async restoreHeartbeats(): Promise<void> {
    if (!this.storage) return;

    try {
      const heartbeats = await this.storage.loadAllHeartbeats?.();
      if (!heartbeats) return;

      for (const hb of heartbeats) {
        // Only restore non-expired heartbeats
        if (hb.deadline > Date.now()) {
          this.heartbeatStates.set(hb.heartbeatKey, hb);

          // Restart monitoring.
          // 进程重启后 heartbeatOptions 必然为空（回调不可序列化），
          // 所以这里的 spread 通常只提供 instanceId/nodeId/interval。
          const options: HeartbeatOptions = {
            instanceId: hb.instanceId,
            nodeId: hb.nodeId,
            interval: Math.max(hb.timeoutMs / 3, 1000),
            ...this.heartbeatOptions.get(hb.heartbeatKey),
          };

          if (!options.onTimeout && this.defaultOnTimeout) {
            options.onTimeout = () => {
              this.defaultOnTimeout?.(hb.instanceId, hb.nodeId);
            };
          }

          // 传入持久化的 deadline，保留超时进度
          await this.start(options, hb.timeoutMs, hb.deadline);

          Logger.info(
            hb.instanceId,
            hb.nodeId,
            `Restored heartbeat (deadline in ${hb.deadline - Date.now()}ms)`,
          );
        } else {
          // Clean up expired heartbeats
          await this.storage.deleteHeartbeat?.(hb.instanceId, hb.nodeId);
        }
      }

      Logger.info(
        "system",
        "heartbeat",
        `Restored ${this.heartbeatStates.size} heartbeats from storage`,
      );
    } catch (error) {
      Logger.error(
        "system",
        "heartbeat",
        "Failed to restore heartbeats from storage",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * 判断本次 tick 是否应该真正落盘，并在返回 true 时记账。
   * 首次 tick 总是落盘，之后按 PERSIST_MIN_INTERVAL_MS 合并。
   */
  private shouldPersistNow(key: string): boolean {
    const now = Date.now();
    const last = this.lastPersistedAt.get(key);
    if (
      last !== undefined &&
      now - last < HeartbeatManager.PERSIST_MIN_INTERVAL_MS
    ) {
      return false;
    }
    this.lastPersistedAt.set(key, now);
    return true;
  }

  private async persistHeartbeat(state: HeartbeatState): Promise<void> {
    if (!this.storage) return;

    try {
      await this.storage.saveHeartbeat?.(state);
    } catch (error) {
      Logger.error(
        state.instanceId,
        state.nodeId,
        "Failed to save heartbeat state",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

export const heartbeatManager = new HeartbeatManager();

export function configureHeartbeatManager(
  storage?: StorageProvider,
  workerId?: string,
): HeartbeatManager {
  heartbeatManager.configure(storage, workerId);
  return heartbeatManager;
}
