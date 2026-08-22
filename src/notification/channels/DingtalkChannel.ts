import type { NotificationMessage } from "../NotificationChannel";
import { WebhookChannel } from "./WebhookChannel";

export class DingtalkChannel extends WebhookChannel {
  name = "dingtalk";

  protected buildPayload(message: NotificationMessage): unknown {
    const prefix = message.subject ? `${message.subject}\n` : "";
    return {
      msgtype: "text",
      text: { content: `${prefix}${message.body}` },
    };
  }

  protected resolveUrl(_message: NotificationMessage): string {
    if (!this.webhookUrl) {
      throw new Error("dingtalk channel requires a webhook URL");
    }
    return this.webhookUrl;
  }
}
