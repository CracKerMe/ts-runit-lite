export type NotificationSeverity = "info" | "warning" | "critical";

export interface NotificationMessage {
  /** 通道特定的目标（频道名、邮箱地址、webhook URL 等） */
  target: string;
  /** 标题（邮件主题等，webhook 类通道会拼入正文） */
  subject?: string;
  /** 正文 */
  body: string;
  severity?: NotificationSeverity;
  /** 附加结构化数据 */
  data?: Record<string, unknown>;
}

export interface NotificationResult {
  ok: boolean;
  channel: string;
  detail?: unknown;
  error?: string;
}

export interface NotificationChannel {
  name: string;
  send(message: NotificationMessage): Promise<NotificationResult>;
  validate(): Promise<boolean>;
}
