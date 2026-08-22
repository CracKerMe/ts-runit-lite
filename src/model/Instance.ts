// oxlint-disable no-explicit-any -- dynamic types used throughout this module
export type InstanceStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "rollback"
  | "paused"
  | "cancelled";

export interface WorkflowInstance {
  instanceId: string;
  workflowId: string;
  /** 创建时的工作流版本 */
  workflowVersion?: string;
  currentNodes: string[]; // 当前激活节点（支持并行）
  status: InstanceStatus;
  context: Record<string, any>; // 共享上下文 — intentionally `any`: workflow context is a dynamic key-value bag
  history: ExecutionLog[]; // 执行日志
  createdAt: Date;
  updatedAt: Date;
  retries?: Record<string, number>; // 各节点的重试次数
  maxRetriesReached?: boolean; // 标记是否已达到最大重试次数
  /** 追踪 ID，用于日志关联 */
  traceId?: string;
  /** 父实例 ID（子工作流场景） */
  parentInstanceId?: string;
  /** 触发来源 */
  triggeredBy?: "api" | "event" | "cron" | "subworkflow";
  /** 节点状态树，存储各节点的执行输出 */
  state?: {
    nodes?: Record<string, { output?: unknown }>;
  };
  /** Search Attributes - 自定义索引属性 */
  searchAttributes?: Record<string, string | number | boolean>;
  /** 标记实例是否是从之前的 ContinueAsNew 继续的 */
  continuedFromInstanceId?: string;
  /** 版本号，用于乐观并发控制（CAS），防止并发覆盖 */
  version?: number;
  /** 租户 ID（多租户模式下由 API 层注入，用于 AI 预算执行） */
  tenantId?: string;
}

export interface ExecutionLog {
  nodeId: string;
  timestamp: Date;
  status: "started" | "success" | "failed" | "rollback" | "skipped";
  error?: string;
  data?: Record<string, unknown> | unknown;
  duration?: number; // 任务执行时长（毫秒）
  stack?: string; // 错误堆栈信息
}
