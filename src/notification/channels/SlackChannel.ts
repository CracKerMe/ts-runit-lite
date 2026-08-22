import type { NotificationMessage } from "../NotificationChannel";
import { WebhookChannel } from "./WebhookChannel";

export class SlackChannel extends WebhookChannel {
  name = "slack";

  protected buildPayload(message: NotificationMessage): unknown {
    const prefix = message.subject ? `*${message.subject}*\n` : "";
    return {
      channel: message.target,
      text: `${prefix}${message.body}`,
    };
  }

  protected resolveUrl(_message: NotificationMessage): string {
    if (!this.webhookUrl) {
      throw new Error("slack channel requires a webhook URL");
    }
    return this.webhookUrl;
  }
}
