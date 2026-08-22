// oxlint-disable no-explicit-any -- TaskExecutor dispatches to heterogeneous node executors with dynamic config
import type { ApprovalNodeConfig } from "../../model/Workflow";
import { ApprovalNodeExecutor } from "../executors/ApprovalNodeExecutor";
import { completeStandardNode, requireNodeConfig } from "./helpers";
import type { NodeDispatchContext } from "./types";

export async function dispatchWorkflowNode(
  ctx: NodeDispatchContext,
): Promise<true | undefined> {
  const { node, instance, logEntry, startTime, onComplete, storage } = ctx;

  if (node.type === "subworkflow") {
    // Subworkflow execution needs the engine's startWorkflow callback and
    // InstanceManager, neither of which is available in this stateless
    // dispatch context. ExecutionOrchestrator special-cases "subworkflow"
    // before ever calling TaskExecutor.execute, so this path is only
    // reached by a caller that invokes TaskExecutor.execute directly.
    throw new Error(
      `Node ${node.id} is a "subworkflow" node and must be executed via ` +
        "ExecutionOrchestrator/SubworkflowExecutor, not TaskExecutor.execute directly",
    );
  }

  if (node.type === "approval") {
    // 执行 Approval 节点：发布审批请求事件并等待 approval_response signal
    const approvalConfig = requireNodeConfig<ApprovalNodeConfig>(
      node,
      "Approval",
      {},
    );

    const result = await ApprovalNodeExecutor.waitForApproval(
      approvalConfig,
      instance,
      node.id,
    );
    const nextNodes = result.nextNode
      ? [result.nextNode]
      : node.next || [];

    await completeStandardNode({
      node,
      instance,
      logEntry,
      result,
      startTime,
      onComplete,
      storage,
      logMessage: "Approval node completed",
      logData: {
        approved: result.approved,
        timedOut: result.timedOut,
        nextNode: result.nextNode,
      },
      nextNodes,
    });
    return true;
  }

  return undefined;
}
