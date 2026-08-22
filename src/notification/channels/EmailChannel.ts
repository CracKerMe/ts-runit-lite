import { Logger } from "../../utils/Logger";
import type {
  NotificationChannel,
  NotificationMessage,
  NotificationResult,
} from "../NotificationChannel";

export interface EmailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject?: string;
    text: string;
  }): Promise<unknown>;
}

export interface EmailChannelOptions {
  /** 注入的邮件发送器（如 nodemailer transporter 或自定义实现） */
  transport: EmailTransport;
  from: string;
}

export class EmailChannel implements NotificationChannel {
  name = "email";
  private readonly transport: EmailTransport;
  private readonly from: string;

  constructor(options: EmailChannelOptions) {
    this.transport = options.transport;
    this.from = options.from;
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    try {
      const detail = await this.transport.sendMail({
        from: this.from,
        to: message.target,
        subject: message.subject,
        text: message.body,
      });
      return { ok: true, channel: this.name, detail };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Logger.warn("system", "notification", "email send failed", {
        error: msg,
      });
      return { ok: false, channel: this.name, error: msg };
    }
  }

  async validate(): Promise<boolean> {
    return Boolean(this.transport && this.from);
  }
}
