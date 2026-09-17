import type { ExecutionLog, WorkflowInstance } from "../../model/Instance";
import type { TaskNode } from "../../model/Workflow";
import type { StorageProvider } from "../../storage/StorageProvider";
import type { HeartbeatTracker } from "../HeartbeatTracker";

export interface NodeDispatchContext {
  node: TaskNode;
  instance: WorkflowInstance;
  logEntry: ExecutionLog;
  startTime: number;
  onComplete: (nextNodes: string[]) => void;
  storage?: StorageProvider;
  /** 引擎持有的、已配置好 storage/workerId/超时兜底的心跳管理器；action 节点的心跳应通过它注册，而不是各自新建实例 */
  heartbeatTracker?: HeartbeatTracker;
}
