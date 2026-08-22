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

  constructor(
    private storage?: StorageProvider,
    private workerId?: string,
  ) {}

  configure(storage?: StorageProvider, workerId?: string): void {
    this.storage = storage;
    this.workerId = workerId;
  }

  async start(options: HeartbeatOptions, timeoutMs?: number): Promise<string> {
    const key = this.getKey(options.instanceId, options.nodeId);
    const isRestart = this.timers.has(key);
    if (isRestart) {
      this.stop(options.instanceId, options.nodeId);
    }

    // Store heartbeat state for recovery
    const state: HeartbeatState = {
      instanceId: options.instanceId,
      nodeId: options.nodeId,
      heartbeatKey: key,
      workerId: this.workerId,
      lastBeat: Date.now(),
      timeoutMs: timeoutMs || options.interval * 3,
      deadline: Date.now() + (timeoutMs || options.interval * 3),
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

      const timeoutTimer = setTimeout(() => {
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
      }, state.timeoutMs);

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
        void this.persistHeartbeat(state).catch((error) => {
          Logger.error(
            options.instanceId,
            options.nodeId,
            "Failed to persist heartbeat tick",
            error instanceof Error ? error.stack : String(error),
          );
        });
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
    const timer = this.timers.get(key);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(key);
      const timeoutTimer = this.timeoutTimers.get(key);
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        this.timeoutTimers.delete(key);
      }

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

          // Restart monitoring
          const options: HeartbeatOptions = {
            ...(this.heartbeatOptions.get(hb.heartbeatKey) ?? {
              instanceId: hb.instanceId,
              nodeId: hb.nodeId,
              interval: Math.max(hb.timeoutMs / 3, 1000),
            }),
          };

          await this.start(options, hb.timeoutMs);

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
