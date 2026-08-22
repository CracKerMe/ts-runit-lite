import { eventBus } from "../../event/EventBus";
import { messageBus, type SignalHandler } from "../../event/MessageBus";
import type { WorkflowInstance } from "../../model/Instance";
import type { ApprovalNodeConfig } from "../../model/Workflow";
import { Logger } from "../../utils/Logger";
import { interpolateExpressions } from "../ExpressionEvaluator";

/**
 * Approval node output
 */
export interface ApprovalNodeOutput {
  approved: boolean;
  approver?: string;
  comment?: string;
  timedOut: boolean;
  nextNode: string | null;
}

interface ApprovalSignalPayload {
  approved?: boolean;
  approver?: string;
  comment?: string;
  nodeId?: string;
}

const APPROVAL_SIGNAL = "approval_response";
const DEFAULT_REQUEST_EVENT = "approval:requested";

/**
 * Approval Node Executor
 * Publishes an approval request event, then pauses the node until an
 * `approval_response` signal arrives via the MessageBus (or the configured
 * timeout elapses, which is treated as a rejection).
 */
export const ApprovalNodeExecutor = {
  waitForApproval(
    config: ApprovalNodeConfig,
    instance: WorkflowInstance,
    nodeId: string,
  ): Promise<ApprovalNodeOutput> {
    const prompt = config.prompt
      ? interpolateExpressions(config.prompt, instance.context, instance.state)
      : undefined;

    eventBus.emit(config.eventType ?? DEFAULT_REQUEST_EVENT, {
      instanceId: instance.instanceId,
      nodeId,
      workflowId: instance.workflowId,
      prompt,
    });

    Logger.log(
      instance.instanceId,
      nodeId,
      "Approval requested, waiting for signal",
      { eventType: config.eventType ?? DEFAULT_REQUEST_EVENT, prompt },
      "event",
    );

    return new Promise<ApprovalNodeOutput>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const settle = (output: ApprovalNodeOutput): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        messageBus.unregisterSignal(APPROVAL_SIGNAL, handler);
        resolve(output);
      };

      const handler: SignalHandler = (signalInstanceId, _name, payload) => {
        if (settled) return;
        if (
          (config.requireInstanceIdMatch ?? true) &&
          signalInstanceId !== instance.instanceId
        ) {
          return;
        }
        const data = (payload ?? {}) as ApprovalSignalPayload;
        if (data.nodeId && data.nodeId !== nodeId) {
          return;
        }

        const approved = data.approved === true;
        Logger.log(
          instance.instanceId,
          nodeId,
          `Approval ${approved ? "granted" : "rejected"}`,
          { approver: data.approver, comment: data.comment },
          "event",
        );
        settle({
          approved,
          approver: data.approver,
          comment: data.comment,
          timedOut: false,
          nextNode: approved
            ? (config.approvedTarget ?? null)
            : (config.rejectedTarget ?? null),
        });
      };

      messageBus.registerSignal(APPROVAL_SIGNAL, handler);

      if (config.timeoutMs && config.timeoutMs > 0) {
        timer = setTimeout(() => {
          Logger.warn(
            instance.instanceId,
            nodeId,
            `Approval timed out after ${config.timeoutMs}ms, treating as rejection`,
          );
          settle({
            approved: false,
            timedOut: true,
            nextNode: config.rejectedTarget ?? null,
          });
        }, config.timeoutMs);
      }
    });
  },
};
