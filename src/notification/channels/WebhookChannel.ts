import { Logger } from "../../utils/Logger";
import type {
  NotificationChannel,
  NotificationMessage,
  NotificationResult,
} from "../NotificationChannel";

export interface WebhookChannelOptions {
  /** 固定的 webhook URL；不提供时使用 message.target 作为 URL */
  webhookUrl?: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

/**
 * 通用 Webhook 通知通道。
 * 也是 Slack/Feishu/Dingtalk 通道的基座：子类只需覆写 name 与 buildPayload。
 */
export class WebhookChannel implements NotificationChannel {
  name = "webhook";
  protected readonly webhookUrl?: string;
  protected readonly fetchImpl: typeof fetch;
  protected readonly headers: Record<string, string>;

  constructor(options: WebhookChannelOptions = {}) {
    this.webhookUrl = options.webhookUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.headers = options.headers ?? {};
  }

  protected buildPayload(message: NotificationMessage): unknown {
    return {
      subject: message.subject,
      body: message.body,
      severity: message.severity ?? "info",
      target: message.target,
      data: message.data,
    };
  }

  protected resolveUrl(message: NotificationMessage): string {
    const url = this.webhookUrl ?? message.target;
    if (!url) {
      throw new Error(`${this.name} channel requires a webhook URL`);
    }
    return url;
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    try {
      const url = this.resolveUrl(message);
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: JSON.stringify(this.buildPayload(message)),
      });

      if (!response.ok) {
        const error = `Webhook responded with status ${response.status}`;
        Logger.warn("system", "notification", `${this.name} send failed`, {
          status: response.status,
        });
        return { ok: false, channel: this.name, error };
      }

      return {
        ok: true,
        channel: this.name,
        detail: { status: response.status },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Logger.warn("system", "notification", `${this.name} send failed`, {
        error: msg,
      });
      return { ok: false, channel: this.name, error: msg };
    }
  }

  async validate(): Promise<boolean> {
    return this.webhookUrl !== undefined;
  }
}
