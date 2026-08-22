import {
  getNestedValue,
  interpolateExpressions,
  interpolateObject,
} from "../engine/ExpressionEvaluator";
import { Logger } from "../utils/Logger";
import type {
  NotificationChannel,
  NotificationMessage,
  NotificationResult,
} from "./NotificationChannel";

/**
 * 通知管理器：注册通道并按名称分发消息。
 * 既可由 notification 节点使用，也可独立用于引擎级告警。
 */
export class NotificationManager {
  private readonly channels = new Map<string, NotificationChannel>();

  registerChannel(channel: NotificationChannel): void {
    this.channels.set(channel.name, channel);
    Logger.info(
      "system",
      "notification",
      `Notification channel registered: ${channel.name}`,
    );
  }

  getChannel(name: string): NotificationChannel | undefined {
    return this.channels.get(name);
  }

  listChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  async send(
    channelName: string,
    message: NotificationMessage,
  ): Promise<NotificationResult> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      throw new Error(`Notification channel not registered: ${channelName}`);
    }
    return channel.send(message);
  }

  renderTemplate(
    template: string,
    context: Record<string, unknown>,
    state?: { nodes?: Record<string, { output?: unknown }> },
  ): string {
    const withVariables = template.replace(
      /\{\{\s*([\w.]+)\s*\}\}/g,
      (match, path) => {
        const value = getNestedValue(context as Record<string, unknown>, path);
        return value !== undefined ? String(value) : match;
      },
    );

    return interpolateExpressions(withVariables, context, state);
  }

  private renderValue<T>(
    value: T,
    context: Record<string, unknown>,
    state?: { nodes?: Record<string, { output?: unknown }> },
  ): T {
    if (typeof value === "string") {
      return this.renderTemplate(value, context, state) as T;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.renderValue(item, context, state)) as T;
    }

    if (value !== null && typeof value === "object") {
      const rendered: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        rendered[key] = this.renderValue(item, context, state);
      }
      return rendered as T;
    }

    return value;
  }

  renderMessage(
    message: NotificationMessage,
    context: Record<string, unknown>,
    state?: { nodes?: Record<string, { output?: unknown }> },
  ): NotificationMessage {
    const interpolatedMessage = interpolateObject(message, context, state);
    return {
      ...interpolatedMessage,
      body: this.renderTemplate(message.body, context, state),
      subject: message.subject
        ? this.renderTemplate(message.subject, context, state)
        : undefined,
      target: this.renderTemplate(message.target, context, state),
      data: this.renderValue(interpolatedMessage.data, context, state),
    };
  }
}

export const notificationManager = new NotificationManager();
