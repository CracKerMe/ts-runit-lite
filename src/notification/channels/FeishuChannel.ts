import type { NotificationMessage } from "../NotificationChannel";
import { WebhookChannel } from "./WebhookChannel";

export class FeishuChannel extends WebhookChannel {
  name = "feishu";

  protected buildPayload(message: NotificationMessage): unknown {
    const prefix = message.subject ? `${message.subject}\n` : "";
    return {
      msg_type: "text",
      content: { text: `${prefix}${message.body}` },
    };
  }

  protected resolveUrl(_message: NotificationMessage): string {
    if (!this.webhookUrl) {
      throw new Error("feishu channel requires a webhook URL");
    }
    return this.webhookUrl;
  }
}
