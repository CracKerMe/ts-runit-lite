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
  | "notification"
  | "join"
  | "transform";

import type { WorkflowInstance } from "./Instance";
import type { RetryPolicy } from "./RetryPolicy";

/**
 * Action/rollback node callback. Always receives the live WorkflowInstance
 * (never omitted at runtime — see TaskExecutor/controlNodes call sites) and
 * its return value is stored verbatim as the node's output, so callers that
 * need a specific output shape should narrow the return type themselves.
 */
export type WorkflowActionFn = (instance: WorkflowInstance) => Promise<unknown>;

/** action/rollback 节点的字符串求值配置（见 SandboxEvaluator）。 */
export interface ActionNodeConfig {
  /** 沙箱内求值的 JS 代码，作为函数体执行；未设置 node.action 时的兜底方式 */
  action?: string;
}

export interface TaskNode {
  id: string;
  type: TaskType;
  action?: WorkflowActionFn;
  /**
   * wait 节点的相对等待时长（毫秒）。仍受支持，作为 config.durationMs 的
   * 简写形式；同时设置时以 config 为准。
   */
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
  /** 节点特定配置 config （如 http, sql, queue, condition, router, loop, join, transform） */
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

/**
 * wait 节点配置。durationMs 与 until 二选一；同时设置时 until 优先。
 * 未设置 config 时回退到 TaskNode.timeout（相对毫秒数）。
 */
export interface WaitNodeConfig {
  /** 相对等待时长（毫秒） */
  durationMs?: number;
  /** 绝对到期时间（ISO 8601 字符串） */
  until?: string;
  /**
   * 开启后不在本进程内 setTimeout，而是通过外部定时器适配层调度到期事件。
   * 适用于需要“进程离线期间仍能按时触发”的场景。
   */
  externalTimer?: {
    enabled?: boolean;
    /**
     * 外部定时器到期后应触发的事件类型。
     * 未设置时使用默认值 `workflow.wait.<instanceId>.<nodeId>`。
     */
    eventType?: string;
  };
  /**
   * 是否把到期时间固化到实例状态（默认 true）。
   *
   * 开启后，节点首次进入时把绝对 deadline 写入
   * `instance.state.nodes[nodeId].deadline` 并持久化；进程重启后实例恢复、
   * 重新进入该节点时按原 deadline 续等剩余时长，而不是从头重新计时。
   * 这让相对时长的 `durationMs` 具备与绝对时间 `until` 同等的跨重启语义。
   *
   * 置为 false 可恢复旧行为（每次进入都从当前时刻重新计时），
   * 适用于 loop 体内需要每轮完整等待的场景。
   */
  durable?: boolean;
}
