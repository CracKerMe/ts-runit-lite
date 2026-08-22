// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import { Logger } from "../utils/Logger";

export type HookEventType =
  | "workflow.started"
  | "workflow.completed"
  | "workflow.failed"
  | "workflow.rollback"
  | "workflow.cancelled"
  | "workflow.paused"
  | "workflow.resumed"
  | "node.started"
  | "node.completed"
  | "node.failed"
  | "node.retry"
  | "node.skipped"
  | "node.waiting";

export type HookEventName = HookEventType | (string & {});

export interface HookPayload {
  event: HookEventName;
  timestamp: string;
  workflowId?: string;
  instanceId?: string;
  nodeId?: string;
  status?: string;
  traceId?: string;
  data?: Record<string, any>;
}

export type HookListener = (payload: HookPayload) => void | Promise<void>;
export type HookDispatcher = (payload: HookPayload) => void | Promise<void>;

export interface HookPayloadInput extends Omit<HookPayload, "timestamp"> {
  timestamp?: string;
}

export function createHookPayload(payload: HookPayloadInput): HookPayload {
  return {
    timestamp: payload.timestamp ?? new Date().toISOString(),
    ...payload,
  };
}

export class HookManager {
  private listeners = new Map<string, Set<HookListener>>();
  private dispatcher?: HookDispatcher;

  on(event: HookEventName | "*", handler: HookListener): () => void {
    const key = event || "*";
    const existing = this.listeners.get(key);
    if (existing) {
      existing.add(handler);
    } else {
      this.listeners.set(key, new Set([handler]));
    }

    return () => this.off(event, handler);
  }

  off(event: HookEventName | "*", handler: HookListener): void {
    const key = event || "*";
    const existing = this.listeners.get(key);
    if (!existing) return;

    existing.delete(handler);
    if (existing.size === 0) {
      this.listeners.delete(key);
    }
  }

  setDispatcher(dispatcher?: HookDispatcher): void {
    this.dispatcher = dispatcher;
  }

  async emit(payload: HookPayload): Promise<void> {
    const handlers = new Set<HookListener>();
    const directHandlers = this.listeners.get(payload.event);
    if (directHandlers) {
      directHandlers.forEach((handler) => {
        handlers.add(handler);
      });
    }

    const wildcardHandlers = this.listeners.get("*");
    if (wildcardHandlers) {
      wildcardHandlers.forEach((handler) => {
        handlers.add(handler);
      });
    }

    const tasks: Array<{
      label: string;
      promise: Promise<void>;
    }> = [];

    if (this.dispatcher) {
      tasks.push({
        label: "dispatcher",
        promise: Promise.resolve(this.dispatcher(payload)),
      });
    }

    handlers.forEach((handler) => {
      tasks.push({
        label: "listener",
        promise: Promise.resolve(handler(payload)),
      });
    });

    if (tasks.length === 0) return;

    const results = await Promise.allSettled(tasks.map((task) => task.promise));

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const label = tasks[index]?.label || "listener";
        Logger.error(
          "hook",
          "dispatch",
          `Hook ${label} failed for ${payload.event}`,
          result.reason instanceof Error
            ? result.reason.stack
            : String(result.reason),
        );
      }
    });
  }
}

export const hookManager = new HookManager();

export function onHook(
  event: HookEventName | "*",
  handler: HookListener,
): () => void {
  return hookManager.on(event, handler);
}

export function offHook(
  event: HookEventName | "*",
  handler: HookListener,
): void {
  hookManager.off(event, handler);
}

export function emitHook(payload: HookPayload): Promise<void> {
  return hookManager.emit(payload);
}

export function setHookDispatcher(dispatcher?: HookDispatcher): void {
  hookManager.setDispatcher(dispatcher);
}
