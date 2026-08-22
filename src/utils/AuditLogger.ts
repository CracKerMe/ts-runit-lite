// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import { Logger } from "./Logger";

/**
 * 审计日志类型
 */
export type AuditAction =
  | "workflow.register"
  | "workflow.start"
  | "workflow.complete"
  | "workflow.fail"
  | "workflow.cancel"
  | "workflow.pause"
  | "workflow.resume"
  | "instance.create"
  | "instance.update"
  | "instance.delete"
  | "event.trigger"
  | "event.process"
  | "api.request"
  | "auth.success"
  | "auth.failure"
  | "config.change";

/**
 * 审计日志条目
 */
export interface AuditEntry {
  timestamp: string;
  action: AuditAction;
  actor?: string;
  resource?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  traceId?: string;
  success: boolean;
  errorMessage?: string;
}

/**
 * 敏感字段列表（需要脱敏）
 */
const SENSITIVE_FIELDS = [
  "password",
  "token",
  "secret",
  "apiKey",
  "api_key",
  "authorization",
  "credential",
  "private",
  "ssn",
  "creditCard",
  "credit_card",
  "cardNumber",
  "card_number",
  "cvv",
  "pin",
];

/**
 * 脱敏处理
 */
function sanitizeValue(key: string, value: any): any {
  const lowerKey = key.toLowerCase();

  // 检查是否是敏感字段
  for (const sensitive of SENSITIVE_FIELDS) {
    if (lowerKey.includes(sensitive.toLowerCase())) {
      if (typeof value === "string") {
        if (value.length <= 4) {
          return "****";
        }
        return `${value.substring(0, 2)}****${value.substring(value.length - 2)}`;
      }
      return "****";
    }
  }

  return value;
}

/**
 * 递归脱敏对象
 */
function sanitizeObject(obj: any, depth = 0): any {
  if (depth > 10) return "[max depth]";

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeObject(value, depth + 1);
    } else {
      sanitized[key] = sanitizeValue(key, value);
    }
  }

  return sanitized;
}

/**
 * 审计日志器（纯静态工具类）
 */
export class AuditLogger {
  private static entries: AuditEntry[] = [];
  private static maxEntries = 10000;
  private static enabled = process.env.AUDIT_LOG_ENABLED !== "false";

  // 私有构造函数防止实例化
  private constructor() {}

  /**
   * 记录审计日志
   */
  static log(entry: Omit<AuditEntry, "timestamp">): void {
    if (!AuditLogger.enabled) return;

    const sanitizedDetails = entry.details
      ? sanitizeObject(entry.details)
      : undefined;

    const auditEntry: AuditEntry = {
      ...entry,
      details: sanitizedDetails,
      timestamp: new Date().toISOString(),
    };

    AuditLogger.entries.push(auditEntry);

    // 限制内存中的条目数量
    if (AuditLogger.entries.length > AuditLogger.maxEntries) {
      AuditLogger.entries = AuditLogger.entries.slice(
        -AuditLogger.maxEntries / 2,
      );
    }

    // 同时输出到日志
    const logLevel = entry.success ? "info" : "warn";
    Logger[logLevel]("audit", entry.action, JSON.stringify(auditEntry));
  }

  /**
   * 记录工作流操作
   */
  static logWorkflow(
    action: AuditAction,
    workflowId: string,
    instanceId?: string,
    details?: Record<string, unknown>,
    success = true,
    errorMessage?: string,
  ): void {
    AuditLogger.log({
      action,
      resource: "workflow",
      resourceId: workflowId,
      details: {
        instanceId,
        ...details,
      },
      success,
      errorMessage,
    });
  }

  /**
   * 记录 API 请求
   */
  static logApiRequest(
    method: string,
    path: string,
    statusCode: number,
    actor?: string,
    ip?: string,
    userAgent?: string,
    traceId?: string,
    details?: Record<string, unknown>,
  ): void {
    AuditLogger.log({
      action: "api.request",
      actor,
      resource: "api",
      resourceId: `${method} ${path}`,
      ip,
      userAgent,
      traceId,
      details: {
        statusCode,
        ...details,
      },
      success: statusCode < 400,
      errorMessage: statusCode >= 400 ? `HTTP ${statusCode}` : undefined,
    });
  }

  /**
   * 记录认证事件
   */
  static logAuth(
    success: boolean,
    actor?: string,
    ip?: string,
    errorMessage?: string,
  ): void {
    AuditLogger.log({
      action: success ? "auth.success" : "auth.failure",
      actor,
      ip,
      success,
      errorMessage,
    });
  }

  /**
   * 获取审计日志
   */
  static getEntries(options?: {
    action?: AuditAction;
    resource?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): AuditEntry[] {
    let filtered = [...AuditLogger.entries];

    if (options?.action) {
      filtered = filtered.filter((e) => e.action === options.action);
    }

    if (options?.resource) {
      filtered = filtered.filter((e) => e.resource === options.resource);
    }

    if (options?.startTime) {
      const start = options.startTime;
      filtered = filtered.filter((e) => new Date(e.timestamp) >= start);
    }

    if (options?.endTime) {
      const end = options.endTime;
      filtered = filtered.filter((e) => new Date(e.timestamp) <= end);
    }

    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  /**
   * 清除审计日志
   */
  static clear(): void {
    AuditLogger.entries = [];
  }

  /**
   * 导出审计日志
   */
  static export(): string {
    return JSON.stringify(AuditLogger.entries, null, 2);
  }
}

/**
 * 脱敏工具函数（导出供其他模块使用）
 */
export { sanitizeObject, sanitizeValue };
