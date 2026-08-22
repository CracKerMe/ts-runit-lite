import { Logger } from "../utils/Logger";

export type MessageType = "signal" | "query" | "update";

export interface Message {
  type: MessageType;
  name: string;
  payload: unknown;
  instanceId: string;
  correlationId?: string;
  timestamp: Date;
}

export interface SignalMessage extends Message {
  type: "signal";
}

export interface QueryMessage extends Message {
  type: "query";
}

export interface UpdateMessage extends Message {
  type: "update";
}

export type MessageHandler = (
  instanceId: string,
  name: string,
  payload: unknown,
) => unknown | Promise<unknown>;

export type SignalHandler = (
  instanceId: string,
  name: string,
  payload: unknown,
) => void | Promise<void>;

export class MessageBus {
  private signalHandlers: Map<string, SignalHandler[]> = new Map();
  private queryHandlers: Map<string, MessageHandler> = new Map();
  private updateHandlers: Map<string, MessageHandler[]> = new Map();
  private pendingUpdates: Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  > = new Map();

  registerSignal(name: string, handler: SignalHandler): void {
    const handlers = this.signalHandlers.get(name) ?? [];
    handlers.push(handler);
    this.signalHandlers.set(name, handlers);
    Logger.debug("system", "message-bus", `Signal handler registered: ${name}`);
  }

  registerQuery(name: string, handler: MessageHandler): void {
    this.queryHandlers.set(name, handler);
    Logger.debug("system", "message-bus", `Query handler registered: ${name}`);
  }

  registerUpdate(name: string, handler: MessageHandler): void {
    const handlers = this.updateHandlers.get(name) ?? [];
    handlers.push(handler);
    this.updateHandlers.set(name, handlers);
    Logger.debug("system", "message-bus", `Update handler registered: ${name}`);
  }

  async sendSignal(
    instanceId: string,
    name: string,
    payload?: unknown,
  ): Promise<void> {
    const handlers = this.signalHandlers.get(name);
    if (!handlers || handlers.length === 0) {
      Logger.warn("system", "message-bus", `No handlers for signal: ${name}`);
      return;
    }

    for (const handler of handlers) {
      try {
        await handler(instanceId, name, payload);
      } catch (error) {
        Logger.error(
          "system",
          "message-bus",
          `Signal handler error: ${name}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    Logger.info(
      "system",
      "message-bus",
      `Signal sent: ${name} to ${instanceId}`,
    );
  }

  async sendQuery<T = unknown>(
    instanceId: string,
    name: string,
    payload?: unknown,
  ): Promise<T> {
    const handler = this.queryHandlers.get(name);
    if (!handler) {
      throw new Error(`No query handler registered: ${name}`);
    }

    try {
      const result = await handler(instanceId, name, payload);
      Logger.info(
        "system",
        "message-bus",
        `Query executed: ${name} on ${instanceId}`,
      );
      return result as T;
    } catch (error) {
      Logger.error(
        "system",
        "message-bus",
        `Query handler error: ${name}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async sendUpdate<T = unknown>(
    instanceId: string,
    name: string,
    payload?: unknown,
    correlationId?: string,
  ): Promise<T> {
    const handlers = this.updateHandlers.get(name);
    if (!handlers || handlers.length === 0) {
      throw new Error(`No update handler registered: ${name}`);
    }

    const updateKey = correlationId ?? `${instanceId}:${name}:${Date.now()}`;

    return new Promise<T>((resolve, reject) => {
      this.pendingUpdates.set(updateKey, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      (async () => {
        try {
          let result: unknown;
          for (const handler of handlers) {
            result = await handler(instanceId, name, payload);
          }
          const pending = this.pendingUpdates.get(updateKey);
          if (pending) {
            pending.resolve(result);
            this.pendingUpdates.delete(updateKey);
          }
          Logger.info(
            "system",
            "message-bus",
            `Update processed: ${name} on ${instanceId}`,
          );
        } catch (error) {
          const pending = this.pendingUpdates.get(updateKey);
          if (pending) {
            pending.reject(error);
            this.pendingUpdates.delete(updateKey);
          }
        }
      })();
    });
  }

  unregisterSignal(name: string, handler: SignalHandler): void {
    const handlers = this.signalHandlers.get(name);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index >= 0) {
        handlers.splice(index, 1);
      }
      if (handlers.length === 0) {
        this.signalHandlers.delete(name);
      }
    }
  }

  unregisterQuery(name: string): void {
    this.queryHandlers.delete(name);
  }

  unregisterUpdate(name: string, handler?: MessageHandler): void {
    if (handler) {
      const handlers = this.updateHandlers.get(name);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
        if (handlers.length === 0) {
          this.updateHandlers.delete(name);
        }
      }
    } else {
      this.updateHandlers.delete(name);
    }
  }

  getSignalHandlers(name: string): SignalHandler[] {
    return this.signalHandlers.get(name) ?? [];
  }

  getQueryHandler(name: string): MessageHandler | undefined {
    return this.queryHandlers.get(name);
  }

  getUpdateHandlers(name: string): MessageHandler[] {
    return this.updateHandlers.get(name) ?? [];
  }
}

export const messageBus = new MessageBus();
