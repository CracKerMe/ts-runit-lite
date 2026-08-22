// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import type { DeadLetterQueue } from "../dlq/index";
import type { WorkflowEngineV2 } from "../engine/WorkflowEngineV2";
import type { HookPayload } from "../event/HookManager";
import type { StorageProvider } from "../storage/StorageProvider";
import type { ConsoleWebSocketManager } from "./ConsoleWebSocketManager";
import type { EventHistoryManager } from "./EventHistory";
import type { WebhookManager } from "./WebhookManager";

export interface LegacyApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface StandardApiSuccessResponse<T = any> {
  code: number | string;
  message: string;
  data: T;
  timestamp: string;
}

export interface StandardApiErrorResponse {
  code: number | string;
  message: string;
  error?: unknown;
  timestamp: string;
}

export type ApiResponse<T = any> =
  | LegacyApiResponse<T>
  | StandardApiSuccessResponse<T>
  | StandardApiErrorResponse;

// Webhook 相关类型
export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  headers?: Record<string, string>;
  isActive: boolean;
  secret?: string;
  createdAt: Date;
  updatedAt: Date;
  failedAttempts?: number;
  lastFailure?: string;
  lastSuccess?: Date;
}

export type WebhookDeliveryStatus =
  | "pending"
  | "retry_scheduled"
  | "success"
  | "failed"
  | "dead_lettered";

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  eventId?: string;
  workflowId?: string;
  instanceId?: string;
  source: "api" | "system" | "webhook";
  payload: WebhookPayload;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
  lastAttemptAt?: Date;
  nextAttemptAt?: Date;
  lastStatusCode?: number;
  lastError?: string;
  lastResponseTime?: number;
  dlqEntryId?: string;
}

export interface WebhookDeliveryCleanupStatus {
  running: boolean;
  mode: "all_nodes" | "leader_only";
  intervalMs: number;
  retentionDays: number;
  leaderOnlyEnabled: boolean;
  lastRunAt?: Date;
  lastSuccessAt?: Date;
  lastResult?: "success" | "failed" | "skipped";
  lastDurationMs?: number;
  lastRemovedCount?: number;
  lastError?: string;
}

export interface WebhookPayload extends HookPayload {
  signature?: string;
}

export interface CreateWebhookDto {
  name: string;
  url: string;
  events: string[];
  headers?: Record<string, string>;
  secret?: string;
}

export interface UpdateWebhookDto {
  name?: string;
  url?: string;
  events?: string[];
  headers?: Record<string, string>;
  isActive?: boolean;
  secret?: string;
}

// 事件触发相关类型
export interface EventTriggerDto {
  event: string;
  data: Record<string, any>;
  instanceId?: string;
}

// 工作流启动参数
export interface StartWorkflowDto {
  context?: Record<string, any>;
  version?: string;
}

export interface ApiRequestContext {
  engine?: WorkflowEngineV2;
  storage?: StorageProvider | null;
  webhookManager?: WebhookManager;
  eventHistoryManager?: EventHistoryManager;
  consoleWsManager?: ConsoleWebSocketManager;
  dlq?: DeadLetterQueue;
  traceId?: string;
}

declare global {
  namespace Express {
    interface Request extends ApiRequestContext {}
  }
}
