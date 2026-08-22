import { Logger } from "../../utils/Logger";
import type {
  NotificationChannel,
  NotificationMessage,
  NotificationResult,
} from "../NotificationChannel";

export interface SmsSendParams {
  /** 接收方手机号（国际格式，如 +8613800138000） */
  to: string;
  /** 短信正文 */
  content: string;
  /** 短信签名（阿里云/腾讯云等要求携带） */
  signName?: string;
}

export interface SmsSendResult {
  /** 运营商侧消息 ID */
  messageId?: string;
}

/** 短信发送器接口——可注入阿里云、腾讯云或任意自定义实现 */
export interface SmsTransport {
  send(params: SmsSendParams): Promise<SmsSendResult>;
}

export interface SmsChannelOptions {
  /** 注入的短信发送器 */
  transport: SmsTransport;
  /** 全局默认签名，可在 message.data.signName 中逐条覆盖 */
  signName?: string;
}

/**
 * 短信通知通道。
 *
 * 使用注入的 SmsTransport 发送短信，支持阿里云、腾讯云等任意实现。
 * message.target 作为接收方手机号；message.body 作为短信正文。
 */
export class SmsChannel implements NotificationChannel {
  name = "sms";
  private readonly transport: SmsTransport;
  private readonly defaultSignName?: string;

  constructor(options: SmsChannelOptions) {
    this.transport = options.transport;
    this.defaultSignName = options.signName;
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    try {
      const signName =
        (message.data?.signName as string | undefined) ?? this.defaultSignName;

      const result = await this.transport.send({
        to: message.target,
        content: message.body,
        signName,
      });

      return {
        ok: true,
        channel: this.name,
        detail: { messageId: result.messageId, to: message.target },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      Logger.warn("system", "notification", "sms send failed", {
        error: msg,
        to: message.target,
      });
      return { ok: false, channel: this.name, error: msg };
    }
  }

  async validate(): Promise<boolean> {
    return Boolean(this.transport);
  }
}
