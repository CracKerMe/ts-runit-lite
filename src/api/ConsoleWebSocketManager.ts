/**
 * WebSocket Manager for Console Real-time Updates
 *
 * Supports two subscription modes:
 *  - Global (/console/stream): receives ALL hook events from the engine
 *  - Per-instance (/console/instances/:id/stream): receives events for one instance
 *    and sends the initial instance snapshot on connect
 */
import type { IncomingMessage } from "http";
import type { WebSocket } from "ws";
import type { HookEventName, HookPayload } from "../event/HookManager";
import type { WorkflowInstance } from "../model/Instance";
import type { StorageProvider } from "../storage/StorageProvider";
import { errorMessage, Logger } from "../utils/Logger";

/** 关闭帧发出后等待对端回应的时间，超时直接 terminate 释放 socket。 */
const WS_CLOSE_GRACE_MS = 1000;

export interface InstanceUpdate {
  instanceId: string;
  timestamp: number;
  type: "status" | "node" | "error" | "completed";
  data: Record<string, unknown>;
}

/**
 * Every shape sent down a console WebSocket connection (both the global
 * /console/stream and per-instance /console/instances/:id/stream feeds).
 * Frontends should discriminate on `type` (and, for "connected", on
 * `mode`) rather than treating messages as an untyped bag of fields.
 */
export interface ConsoleConnectedMessage {
  type: "connected";
  mode: "global" | "instance";
  timestamp: number;
  /** Present only for mode "instance". */
  instanceId?: string;
  /** Present only for mode "instance"; null if the instance wasn't found,
   * absent entirely if storage isn't configured (see `message`). */
  instance?: WorkflowInstance | null;
  /** Present only when storage isn't configured, in place of `instance`. */
  message?: string;
}

export interface ConsolePongMessage {
  type: "pong";
  timestamp: number;
}

/** A subworkflow's parent-instance notification carries the child's
 * instanceId/parentInstanceId alongside the underlying HookPayload fields. */
export type ConsoleHookData =
  | HookPayload
  | (HookPayload & { childInstanceId: string; parentInstanceId: string });

export interface ConsoleHookMessage {
  type: "hook";
  event: HookEventName;
  instanceId?: string;
  workflowId?: string;
  nodeId?: string;
  status?: string;
  timestamp: string;
  data: ConsoleHookData;
}

export type ConsoleWebSocketMessage =
  | ConsoleConnectedMessage
  | ConsolePongMessage
  | ConsoleHookMessage;

const INSTANCE_UPDATE_EVENT_MAP: Record<InstanceUpdate["type"], HookEventName> =
  {
    status: "workflow.started",
    node: "node.started",
    error: "workflow.failed",
    completed: "workflow.completed",
  };

export class ConsoleWebSocketManager {
  /** Clients subscribed to the global event feed */
  private globalConnections: Set<WebSocket> = new Set();
  /** Clients subscribed to a specific instance */
  private instanceConnections: Map<string, Set<WebSocket>> = new Map();
  private storage?: StorageProvider;

  constructor(storage?: StorageProvider) {
    this.storage = storage;
  }

  /**
   * Handle a new global WebSocket connection (receives all hook events).
   */
  handleGlobalConnection(ws: WebSocket, _req: IncomingMessage): void {
    Logger.info("api", "console-ws", "New global WebSocket connection");
    this.globalConnections.add(ws);

    this.sendMessage(ws, {
      type: "connected",
      mode: "global",
      timestamp: Date.now(),
    });

    ws.on("message", (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "ping") {
          this.sendMessage(ws, { type: "pong", timestamp: Date.now() });
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      this.globalConnections.delete(ws);
      Logger.info("api", "console-ws", "Global WebSocket connection closed");
    });

    ws.on("error", (error) => {
      Logger.error(
        "api",
        "console-ws",
        `Global WebSocket error: ${error.message}`,
      );
      this.globalConnections.delete(ws);
    });
  }

  /**
   * Handle a new per-instance WebSocket connection.
   * Sends the initial instance snapshot immediately, then streams hook events.
   */
  handleConnection(
    ws: WebSocket,
    instanceId: string,
    _req: IncomingMessage,
  ): void {
    Logger.info(
      "api",
      "console-ws",
      `New instance WebSocket connection for ${instanceId}`,
    );

    if (!this.instanceConnections.has(instanceId)) {
      this.instanceConnections.set(instanceId, new Set());
    }
    this.instanceConnections.get(instanceId)!.add(ws);

    // Send initial snapshot
    this.sendInitialState(ws, instanceId).catch((error: unknown) => {
      Logger.error(
        "api",
        "console-ws",
        `Failed to send initial state: ${errorMessage(error)}`,
      );
    });

    ws.on("message", (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "ping") {
          this.sendMessage(ws, { type: "pong", timestamp: Date.now() });
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      this.removeInstanceConnection(instanceId, ws);
    });

    ws.on("error", (error) => {
      Logger.error(
        "api",
        "console-ws",
        `Instance WebSocket error for ${instanceId}: ${error.message}`,
      );
      this.removeInstanceConnection(instanceId, ws);
    });
  }

  /**
   * Broadcast a hook payload to ALL connected clients.
   * Called by the hook dispatcher chain in server.ts.
   */
  broadcastHook(payload: HookPayload): void {
    const message: ConsoleHookMessage = {
      type: "hook",
      event: payload.event,
      instanceId: payload.instanceId,
      workflowId: payload.workflowId,
      nodeId: payload.nodeId,
      status: payload.status,
      timestamp: payload.timestamp ?? new Date().toISOString(),
      data: payload,
    };

    // Broadcast to global subscribers
    for (const ws of this.globalConnections) {
      this.sendMessage(ws, message);
    }

    // Broadcast to per-instance subscribers if instanceId is known
    if (payload.instanceId) {
      const conns = this.instanceConnections.get(payload.instanceId);
      if (conns) {
        for (const ws of conns) {
          this.sendMessage(ws, message);
        }
      }

      // When a subworkflow completes/fails, also notify parent instance subscribers
      if (
        (payload.event === "workflow.completed" ||
          payload.event === "workflow.failed") &&
        this.storage
      ) {
        void this.storage
          .loadInstance(payload.instanceId)
          .then((instance) => {
            const parentId = instance?.parentInstanceId;
            if (!parentId) return;
            const parentConns = this.instanceConnections.get(parentId);
            if (!parentConns) return;
            const parentMessage: ConsoleHookMessage = {
              ...message,
              type: "hook",
              event: `subworkflow.${payload.event === "workflow.completed" ? "completed" : "failed"}`,
              data: {
                ...payload,
                childInstanceId: payload.instanceId,
                parentInstanceId: parentId,
              },
            };
            for (const ws of parentConns) {
              this.sendMessage(ws, parentMessage);
            }
          })
          .catch(() => {
            /* storage lookup failure is non-critical */
          });
      }
    }
  }

  /**
   * Legacy method kept for backward compatibility – prefer broadcastHook.
   */
  broadcastUpdate(instanceId: string, update: InstanceUpdate): void {
    this.broadcastHook({
      event: INSTANCE_UPDATE_EVENT_MAP[update.type],
      instanceId,
      workflowId: "",
      timestamp: String(update.timestamp),
      ...update.data,
    });
  }

  private async sendInitialState(
    ws: WebSocket,
    instanceId: string,
  ): Promise<void> {
    if (!this.storage) {
      this.sendMessage(ws, {
        type: "connected",
        mode: "instance",
        instanceId,
        message: "Storage not available – hook events only",
        timestamp: Date.now(),
      });
      return;
    }

    try {
      const instance = await this.storage.loadInstance(instanceId);
      this.sendMessage(ws, {
        type: "connected",
        mode: "instance",
        instanceId,
        instance: instance ?? null,
        timestamp: Date.now(),
      });
    } catch (error: unknown) {
      Logger.error(
        "api",
        "console-ws",
        `Failed to load instance ${instanceId}: ${errorMessage(error)}`,
      );
      this.sendMessage(ws, {
        type: "connected",
        mode: "instance",
        instanceId,
        instance: null,
        timestamp: Date.now(),
      });
    }
  }

  private sendMessage(ws: WebSocket, message: ConsoleWebSocketMessage): void {
    if (ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error: unknown) {
        Logger.error(
          "api",
          "console-ws",
          `Failed to send message: ${errorMessage(error)}`,
        );
      }
    }
  }

  private removeInstanceConnection(instanceId: string, ws: WebSocket): void {
    const connections = this.instanceConnections.get(instanceId);
    if (connections) {
      connections.delete(ws);
      if (connections.size === 0) {
        this.instanceConnections.delete(instanceId);
      }
    }
  }

  getStats(): {
    globalConnections: number;
    instanceConnections: number;
    instanceCount: number;
  } {
    let instanceConnections = 0;
    for (const conns of this.instanceConnections.values()) {
      instanceConnections += conns.size;
    }
    return {
      globalConnections: this.globalConnections.size,
      instanceConnections,
      instanceCount: this.instanceConnections.size,
    };
  }

  shutdown(): void {
    for (const ws of this.globalConnections) {
      this.closeSocket(ws);
    }
    this.globalConnections.clear();

    for (const conns of this.instanceConnections.values()) {
      for (const ws of conns) {
        this.closeSocket(ws);
      }
    }
    this.instanceConnections.clear();

    Logger.info("api", "console-ws", "WebSocket manager shut down");
  }

  /**
   * 关闭单个连接，并保证底层 socket 一定会被释放。
   *
   * `ws.close()` 只是发出关闭帧，然后等待对端回应——对端无响应时这条 TCP
   * 连接会一直挂着，把 HTTP server 的监听端口一起拖住。所以这里加一个短
   * 超时兜底 `terminate()`，Ctrl+C 之后端口不会被残留连接占用。
   */
  private closeSocket(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      ws.terminate();
      return;
    }

    if (ws.readyState === ws.CLOSED) return;

    const timer = setTimeout(() => {
      if (ws.readyState !== ws.CLOSED) ws.terminate();
    }, WS_CLOSE_GRACE_MS);
    timer.unref();
    ws.once("close", () => clearTimeout(timer));
  }
}
