// oxlint-disable no-explicit-any -- TaskExecutor dispatches to heterogeneous node executors with dynamic config
import { recordNodeExecution } from "../../metrics/index";
import type { WorkflowInstance } from "../../model/Instance";
import { Logger } from "../../utils/Logger";
import { evaluateSandboxed } from "../SandboxEvaluator";
import {
  type ConditionNodeConfig,
  ConditionNodeExecutor,
} from "../executors/ConditionNodeExecutor";
import {
  type RouterNodeConfig,
  RouterNodeExecutor,
} from "../executors/RouterNodeExecutor";
import { HeartbeatManager } from "../HeartbeatManager";
import { taskQueueManager } from "../TaskQueueManager";
import {
  completeStandardNode,
  handleRouting,
  requireNodeConfig,
} from "./helpers";
import type { NodeDispatchContext } from "./types";

export async function dispatchControlNode(
  ctx: NodeDispatchContext,
): Promise<true | undefined> {
  const { node, instance, logEntry, startTime, onComplete, storage } = ctx;

  if (node.type === "condition") {
    const conditionConfig = requireNodeConfig<ConditionNodeConfig>(
      node,
      "Condition",
    );

    const result = await ConditionNodeExecutor.execute(
      conditionConfig,
      instance,
    );

    const nextNode = ConditionNodeExecutor.getNextNode(
      conditionConfig,
      result.result,
    );

    await completeStandardNode({
      node,
      instance,
      logEntry,
      result,
      startTime,
      onComplete,
      storage,
      logMessage: "Condition node succeeded",
      logData: {
        result: result.result,
        branch: result.branch,
        nextNode,
      },
      nextNodes: [nextNode],
    });
    return true;
  }

  if (node.type === "router") {
    const routerConfig = requireNodeConfig<RouterNodeConfig>(node, "Router");

    const result = await RouterNodeExecutor.execute(routerConfig, instance);
    const nextNode = RouterNodeExecutor.getNextNode(result);

    await completeStandardNode({
      node,
      instance,
      logEntry,
      result,
      startTime,
      onComplete,
      storage,
      logMessage: "Router node succeeded",
      logData: {
        matchedRoute: result.matchedRoute,
        target: result.target,
      },
      nextNodes: [nextNode],
    });
    return true;
  }

  if (node.type === "loop") {
    // Loop nodes require special handling at the WorkflowEngine level but we allow passing through
    Logger.debug(
      instance.instanceId,
      node.id,
      "Loop node execution passed to engine level",
    );
    return true;
  }

  if (node.type === "action" || node.type === "rollback") {
    // rollback 节点复用 action 的执行语义（同一个 node.action 字段），
    // 使其在通过正常引擎路径（而非 WorkflowInstanceControl.compensate()）到达时
    // 也能安全执行，而不是落到 "Unsupported task type" 兜底分支。
    // 如果没有action函数，提供一个默认的处理逻辑
    const actionFn =
      node.action ||
      (async (actionInstance?: WorkflowInstance) => {
        // 从config中读取配置
        const config = node.config || {};

        // 如果config中有action字符串，尝试执行它
        if (config.action && typeof config.action === "string") {
          try {
            // Use sandboxed evaluation instead of raw new Function()
            // Workflow definitions are trusted but defense-in-depth is better
            const fnBody = config.action;
            // Wrap action code as a function body that receives the instance
            const result = evaluateSandboxed(
              `(function(instance) { ${fnBody} })(context.instance)`,
              { instance: actionInstance },
              { timeoutMs: 5000 },
            );
            return result;
          } catch (error: any) {
            Logger.warn(
              actionInstance?.instanceId ?? "system",
              node.id,
              `Failed to execute action string: ${error.message}`,
            );
          }
        }

        // 默认返回成功
        return { status: "completed", timestamp: new Date().toISOString() };
      });
    let heartbeatKey: string | undefined;

    const heartbeatConfig = node.heartbeat;
    const heartbeatMgr = new HeartbeatManager();
    if (heartbeatConfig?.interval) {
      heartbeatKey = await heartbeatMgr.start({
        instanceId: instance.instanceId,
        nodeId: node.id,
        interval: heartbeatConfig.interval,
        onHeartbeat: heartbeatConfig.onHeartbeat,
      });
    }

    try {
      // A node bound to a task queue runs on that queue's registered workers,
      // which apply their own concurrency limits. With no worker registered the
      // task would never be picked up, so fall back to local execution.
      const result =
        node.taskQueue && taskQueueManager.hasWorkerFor(node.taskQueue)
          ? await taskQueueManager.submit(
              node.taskQueue,
              { nodeId: node.id, instance },
              instance.instanceId,
            )
          : await actionFn(instance);

      await completeStandardNode({
        node,
        instance,
        logEntry,
        result,
        startTime,
        onComplete,
        storage,
        logMessage: "Task succeeded",
        logData: result as Record<string, unknown>,
      });
    } finally {
      if (heartbeatKey) {
        heartbeatMgr.stop(instance.instanceId, node.id);
      }
    }
    return true;
  }

  if (node.type === "wait" && node.timeout) {
    // 执行等待节点
    Logger.log(
      instance.instanceId,
      node.id,
      `Starting wait for ${node.timeout}ms`,
    );

    setTimeout(() => {
      const endTime = Date.now();
      const duration = endTime - startTime;

      logEntry.status = "success";
      logEntry.duration = node.timeout;

      // 等待节点也记录输出（虽然通常为空）
      if (!instance.state) {
        instance.state = { nodes: {} };
      }
      if (!instance.state.nodes) {
        instance.state.nodes = {};
      }
      instance.state.nodes[node.id] = { output: { waited: node.timeout } };

      Logger.log(
        instance.instanceId,
        node.id,
        "Wait timeout completed",
        undefined,
        "action",
      );

      // Record Prometheus metrics for wait node
      recordNodeExecution(
        instance.workflowId,
        node.id,
        node.type,
        "success",
        duration / 1000, // Convert to seconds
      );

      // Record completion metrics for wait node
      if (storage) {
        try {
          storage
            .updateNodeMetrics(instance.instanceId, node.id, {
              nodeId: node.id,
              nodeType: node.type,
              startTime,
              endTime,
              duration,
              status: "completed",
              retryCount: instance.retries?.[node.id] || 0,
            })
            .catch((error: any) => {
              Logger.error(
                instance.instanceId,
                node.id,
                "Failed to record wait completion metrics",
                error?.stack,
              );
            });
        } catch (error: any) {
          Logger.error(
            instance.instanceId,
            node.id,
            "Failed to record wait completion metrics",
            error?.stack,
          );
        }
      }

      handleRouting(node, instance, onComplete).catch((error: any) => {
        Logger.error(
          instance.instanceId,
          node.id,
          "Wait node routing failed",
          error?.stack,
        );
      });
    }, node.timeout);
    return true;
  }

  if (node.type === "event" && node.onEvent) {
    // 事件节点由 WorkflowEngine 统一 management
    Logger.log(
      instance.instanceId,
      node.id,
      `Waiting for event: ${node.onEvent}`,
      undefined,
      "event",
    );
    // 事件触发后，由 WorkflowEngine 的 handler 调用 onComplete/onError
    return true;
  }

  return undefined;
}
