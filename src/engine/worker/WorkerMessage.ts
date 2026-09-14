export type WorkerMessageType =
  | "execute"
  | "result"
  | "error"
  | "heartbeat"
  | "cancel";

export interface WorkerMessage {
  type: WorkerMessageType;
  taskId: string;
  payload?: unknown;
}

export interface ExecuteTaskMessage extends WorkerMessage {
  type: "execute";
  payload: {
    nodeType: string;
    config: unknown;
    instanceId: string;
    workflowId: string;
    nodeId: string;
    context: Record<string, unknown>;
    state?: unknown;
  };
}

export interface TaskResultMessage extends WorkerMessage {
  type: "result";
  payload: {
    output: unknown;
    duration: number;
    /** Worker that ran the task; present when sticky affinity is in play. */
    workerId?: string;
  };
}

export interface TaskErrorMessage extends WorkerMessage {
  type: "error";
  payload: {
    message: string;
    stack?: string;
  };
}

export function isTaskResultMessage(
  message: WorkerMessage,
): message is TaskResultMessage {
  return message.type === "result";
}

export function isTaskErrorMessage(
  message: WorkerMessage,
): message is TaskErrorMessage {
  return message.type === "error";
}
