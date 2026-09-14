import type { NotificationNodeConfig } from "../../model/Workflow";
import {
  type HttpNodeConfig,
  HttpNodeExecutor,
} from "../executors/HttpNodeExecutor";
import { NotificationNodeExecutor } from "../executors/NotificationNodeExecutor";
import {
  type QueueNodeConfig,
  QueueNodeExecutor,
} from "../executors/QueueNodeExecutor";
import {
  type SqlNodeConfig,
  SqlNodeExecutor,
} from "../executors/SqlNodeExecutor";
import { resolveSecrets } from "../../utils/secrets";
import {
  completeStandardNode,
  executeInWorker,
  requireNodeConfig,
  shouldUseWorker,
} from "./helpers";
import type { NodeDispatchContext } from "./types";

export async function dispatchIoNode(
  ctx: NodeDispatchContext,
): Promise<true | undefined> {
  const { node, instance, logEntry, startTime, onComplete, storage } = ctx;

  if (node.type === "http") {
    // 执行 HTTP 节点
    const httpConfig = await resolveSecrets(
      requireNodeConfig<HttpNodeConfig>(node, "HTTP"),
    );

    const result = shouldUseWorker(node)
      ? await executeInWorker(node, instance, httpConfig)
      : await HttpNodeExecutor.execute(httpConfig, instance);
    await completeStandardNode({
      node,
      instance,
      logEntry,
      result,
      startTime,
      onComplete,
      storage,
      logMessage: "HTTP node succeeded",
      logData: {
        status: (result as { status?: number }).status,
        duration: (result as { duration?: number }).duration,
      },
    });
    return true;
  }

  if (node.type === "sql") {
    // 执行 SQL 节点
    const sqlConfig = await resolveSecrets(
      requireNodeConfig<SqlNodeConfig>(node, "SQL"),
    );

    const result = await SqlNodeExecutor.execute(sqlConfig, instance);
    await completeStandardNode({
      node,
      instance,
      logEntry,
      result,
      startTime,
      onComplete,
      storage,
      logMessage: "SQL node succeeded",
      logData: {
        rowCount: (result as { rowCount?: number }).rowCount,
        duration: (result as { duration?: number }).duration,
      },
    });
    return true;
  }

  if (node.type === "queue") {
    // 执行 Queue 节点
    const queueConfig = await resolveSecrets(
      requireNodeConfig<QueueNodeConfig>(node, "Queue"),
    );

    const result = await QueueNodeExecutor.execute(queueConfig, instance);
    await completeStandardNode({
      node,
      instance,
      logEntry,
      result,
      startTime,
      onComplete,
      storage,
      logMessage: "Queue node succeeded",
      logData: {
        operation: queueConfig.operation,
        messageId: (result as { messageId?: string }).messageId,
      },
    });
    return true;
  }

  if (node.type === "notification") {
    const notificationConfig = requireNodeConfig<NotificationNodeConfig>(
      node,
      "Notification",
    );

    const result = await NotificationNodeExecutor.execute(
      notificationConfig,
      instance,
    );
    await completeStandardNode({
      node,
      instance,
      logEntry,
      result,
      startTime,
      onComplete,
      storage,
      logMessage: "Notification node succeeded",
      logData: {
        channel: result.channel,
        ok: result.ok,
      },
    });
    return true;
  }

  return undefined;
}
