export type TaskType =
  | "action"
  | "wait"
  | "event"
  | "rollback"
  | "subworkflow"
  | "http"
  | "sql"
  | "queue"
  | "condition"
  | "router"
  | "loop"
  | "approval"
  | "notification";

import type { RetryPolicy } from "./RetryPolicy";

export interface TaskNode {
  id: string;
  type: TaskType;
  // action callbacks receive WorkflowInstance at runtime;
  // using unknown would require 300+ null-checks in examples and user code.
  // TODO: Create a branded WorkflowActionFn type once examples are updated.
  // oxlint-disable-next-line no-explicit-any -- see above rationale
  action?: (instance?: any) => Promise<any>;
  timeout?: number;
  next?: string[];
  onEvent?: string;
  rollbackTo?: string;
  /** 指定节点失败时的后续节点，用于自定义错误处理流程 */
  failureNext?: string[];
  /** 最大重试次数，可用于 rollback 或超时重试，默认 2 次 */
  maxRetries?: number;
  /** 增强的重试策略配置 */
  retryPolicy?: RetryPolicy;
  /** 心跳配置（用于长时运行的 action 节点） */
  heartbeat?: {
    interval?: number;
    timeout?: number;
    onHeartbeat?: (details: unknown) => void;
  };
  /** 条件分支配置 */
  conditionalNext?: Array<{
    condition: string;
    target: string;
  }>;
  /** 默认分支（当所有条件都不满足时） */
  defaultNext?: string;
  /** 子工作流 ID */
  subworkflowId?: string;
  /** 子工作流输入参数映射 */
  subworkflowInput?: Record<string, string>;
  /** 是否等待子工作流完成 */
  waitForCompletion?: boolean;
  /** 节点执行输出，用于后续节点引用 */
  output?: unknown;
  /** 节点特定配置 config （如 http, sql, queue, condition, router, loop, llm, ai_router） */
  config?: Record<string, unknown>;
  /**
   * 将该节点的执行路由到指定的命名任务队列（见 TaskQueueManager）。
   * 仅对 action / rollback 节点生效；未注册 worker 的队列会回退为本地直接执行。
   */
  taskQueue?: string;
  /** 节点输入 Schema（JSON Schema 子集，见 DataValidator） */
  inputSchema?: Record<string, unknown>;
  /** 节点输出 Schema（JSON Schema 子集，见 DataValidator） */
  outputSchema?: Record<string, unknown>;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  /** 工作流版本号，语义化版本格式 */
  version?: string;
  /** 工作流描述 */
  description?: string;
  nodes: Record<string, TaskNode>;
  startNode: string;
  cron?: string;
  triggerEvents?: string[];
  /** 工作流元数据 */
  metadata?: Record<string, unknown>;
  /** 创建时间 */
  createdAt?: Date;
  /** 更新时间 */
  updatedAt?: Date;
  /** 工作流启动输入 Schema（JSON Schema 子集，见 DataValidator） */
  inputSchema?: Record<string, unknown>;
  /** 工作流最终输出 Schema（JSON Schema 子集，见 DataValidator） */
  outputSchema?: Record<string, unknown>;
}

export interface ApprovalNodeConfig {
  eventType?: string;
  prompt?: string;
  approvedTarget?: string;
  rejectedTarget?: string;
  timeoutMs?: number;
  requireInstanceIdMatch?: boolean;
}

export interface NotificationNodeConfig {
  channel: "slack" | "feishu" | "dingtalk" | "email" | "webhook" | string;
  target: string;
  template: string;
  subject?: string;
  severity?: "info" | "warning" | "critical";
  data?: Record<string, unknown>;
}
