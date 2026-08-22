import type { ExecutionLog, WorkflowInstance } from "../../model/Instance";
import type { TaskNode } from "../../model/Workflow";
import type { StorageProvider } from "../../storage/StorageProvider";

export interface NodeDispatchContext {
  node: TaskNode;
  instance: WorkflowInstance;
  logEntry: ExecutionLog;
  startTime: number;
  onComplete: (nextNodes: string[]) => void;
  storage?: StorageProvider;
}
