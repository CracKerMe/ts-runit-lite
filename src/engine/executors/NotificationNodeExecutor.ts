import type { WorkflowInstance } from "../../model/Instance";
import type { NotificationNodeConfig } from "../../model/Workflow";
import type { NotificationResult } from "../../notification/NotificationChannel";
import {
  type NotificationManager,
  notificationManager,
} from "../../notification/NotificationManager";
import { Logger } from "../../utils/Logger";

function buildTemplateContext(
  instance: WorkflowInstance,
): Record<string, unknown> {
  return {
    ...instance.context,
    context: instance.context ?? {},
    state: instance.state ?? {},
  };
}

export async function execute(
  config: NotificationNodeConfig,
  instance: WorkflowInstance,
  manager: NotificationManager = notificationManager,
): Promise<NotificationResult> {
  const templateContext = buildTemplateContext(instance);
  const message = manager.renderMessage(
    {
      target: config.target,
      subject: config.subject,
      body: config.template,
      severity: config.severity,
      data: config.data,
    },
    templateContext,
    instance.state,
  );

  Logger.info(instance.instanceId, "notification", "Sending notification", {
    channel: config.channel,
    target: message.target,
    severity: message.severity ?? "info",
  });

  const result = await manager.send(config.channel, message);
  if (!result.ok) {
    throw new Error(
      result.error ?? `Notification channel ${config.channel} send failed`,
    );
  }

  return result;
}

export const NotificationNodeExecutor = {
  execute,
};
