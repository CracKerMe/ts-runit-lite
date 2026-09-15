export type ActionSandboxMessageType = "evaluate" | "result" | "error";

export interface ActionSandboxMessage {
  type: ActionSandboxMessageType;
  taskId: string;
}

/**
 * `expression` and `context` are structured-cloned across the thread
 * boundary (worker_threads uses the HTML structured clone algorithm), so
 * `context` must already be plain data — the same constraint SandboxEvaluator
 * already imposes via `cloneForSandbox` before it reaches here.
 */
export interface EvaluateMessage extends ActionSandboxMessage {
  type: "evaluate";
  payload: {
    expression: string;
    context: Record<string, unknown>;
    timeoutMs: number;
  };
}

export interface EvaluateResultMessage extends ActionSandboxMessage {
  type: "result";
  payload: {
    result: unknown;
  };
}

export interface EvaluateErrorMessage extends ActionSandboxMessage {
  type: "error";
  payload: {
    message: string;
    stack?: string;
  };
}

export type WorkerReplyMessage = EvaluateResultMessage | EvaluateErrorMessage;

export function isEvaluateResultMessage(
  message: WorkerReplyMessage,
): message is EvaluateResultMessage {
  return message.type === "result";
}

export function isEvaluateErrorMessage(
  message: WorkerReplyMessage,
): message is EvaluateErrorMessage {
  return message.type === "error";
}
