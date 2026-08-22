import { DingtalkChannel } from "./channels/DingtalkChannel";
import {
  EmailChannel,
  type EmailChannelOptions,
  type EmailTransport,
} from "./channels/EmailChannel";
import { FeishuChannel } from "./channels/FeishuChannel";
import { SlackChannel } from "./channels/SlackChannel";
import {
  SmsChannel,
  type SmsChannelOptions,
  type SmsTransport,
} from "./channels/SmsChannel";
import {
  WebhookChannel,
  type WebhookChannelOptions,
} from "./channels/WebhookChannel";
import type { NotificationChannel } from "./NotificationChannel";
import {
  type NotificationManager,
  notificationManager,
} from "./NotificationManager";

export * from "./channels/DingtalkChannel";
export * from "./channels/EmailChannel";
export * from "./channels/FeishuChannel";
export * from "./channels/SlackChannel";
export * from "./channels/SmsChannel";
export * from "./channels/WebhookChannel";
export * from "./NotificationChannel";
export * from "./NotificationManager";

export interface NotificationSetupOptions {
  manager?: NotificationManager;
  fetchImpl?: typeof fetch;
  email?: {
    transport: EmailTransport;
    from: string;
  };
  sms?: {
    transport: SmsTransport;
    signName?: string;
  };
}

function registerIfMissing(
  manager: NotificationManager,
  name: string,
  factory: () => NotificationChannel,
): void {
  if (!manager.getChannel(name)) {
    manager.registerChannel(factory());
  }
}

export function setupNotificationChannelsFromEnv(
  options: NotificationSetupOptions = {},
): NotificationManager {
  const manager = options.manager ?? notificationManager;
  const webhookOptions: WebhookChannelOptions = {
    fetchImpl: options.fetchImpl,
  };

  if (process.env.SLACK_WEBHOOK_URL) {
    registerIfMissing(
      manager,
      "slack",
      () =>
        new SlackChannel({
          ...webhookOptions,
          webhookUrl: process.env.SLACK_WEBHOOK_URL,
        }),
    );
  }

  if (process.env.FEISHU_WEBHOOK_URL) {
    registerIfMissing(
      manager,
      "feishu",
      () =>
        new FeishuChannel({
          ...webhookOptions,
          webhookUrl: process.env.FEISHU_WEBHOOK_URL,
        }),
    );
  }

  if (process.env.DINGTALK_WEBHOOK_URL) {
    registerIfMissing(
      manager,
      "dingtalk",
      () =>
        new DingtalkChannel({
          ...webhookOptions,
          webhookUrl: process.env.DINGTALK_WEBHOOK_URL,
        }),
    );
  }

  registerIfMissing(
    manager,
    "webhook",
    () => new WebhookChannel(webhookOptions),
  );

  if (options.email && !manager.getChannel("email")) {
    const emailOptions: EmailChannelOptions = {
      transport: options.email.transport,
      from: options.email.from,
    };
    manager.registerChannel(new EmailChannel(emailOptions));
  }

  if (options.sms && !manager.getChannel("sms")) {
    const smsOptions: SmsChannelOptions = {
      transport: options.sms.transport,
      signName: options.sms.signName,
    };
    manager.registerChannel(new SmsChannel(smsOptions));
  }

  return manager;
}
