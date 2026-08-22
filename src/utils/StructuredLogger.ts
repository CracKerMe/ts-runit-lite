import { v4 as uuidv4 } from "uuid";
import { trace } from "../telemetry/index";

/**
 * 日志级别
 */
export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

/**
 * 日志上下文
 */
export interface LogContext {
  traceId?: string;
  instanceId?: string;
  nodeId?: string;
  workflowId?: string;
  userId?: string;
  [key: string]: unknown;
}

/**
 * 结构化日志条目
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  traceId?: string;
  instanceId?: string;
  nodeId?: string;
  workflowId?: string;
  data?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

/**
 * 获取当前日志级别
 */
function getCurrentLogLevel(): LogLevel {
  const level = (process.env.LOG_LEVEL || "info").toLowerCase();
  switch (level) {
    case "debug":
      return LogLevel.DEBUG;
    case "warn":
      return LogLevel.WARN;
    case "error":
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}

/**
 * 日志级别优先级
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
};

/**
 * 检查是否应该输出该级别的日志
 */
function shouldLog(level: LogLevel): boolean {
  const currentLevel = getCurrentLogLevel();
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLevel];
}

/**
 * 结构化日志器
 */
export class StructuredLogger {
  private context: LogContext;

  constructor(context: LogContext = {}) {
    this.context = context;
  }

  /**
   * 创建带有 traceId 的子日志器
   */
  child(additionalContext: LogContext): StructuredLogger {
    return new StructuredLogger({
      ...this.context,
      ...additionalContext,
    });
  }

  /**
   * 生成新的 traceId
   */
  static generateTraceId(): string {
    const activeSpan = trace.getActiveSpan();
    const activeTraceId = activeSpan?.spanContext().traceId;
    if (activeTraceId && activeTraceId !== "0".repeat(32)) {
      return activeTraceId;
    }
    return uuidv4();
  }

  /**
   * 输出日志
   */
  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    error?: Error,
  ): void {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      traceId: this.context.traceId,
      instanceId: this.context.instanceId,
      nodeId: this.context.nodeId,
      workflowId: this.context.workflowId,
    };

    if (data && Object.keys(data).length > 0) {
      entry.data = data;
    }

    if (error) {
      entry.error = {
        message: error.message,
        stack: error.stack,
        code: (error as { code?: string }).code,
      };
    }

    const output = JSON.stringify(entry);

    switch (level) {
      case LogLevel.ERROR:
        console.error(output);
        break;
      case LogLevel.WARN:
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, data, error);
  }

  /**
   * 获取当前上下文
   */
  getContext(): LogContext {
    return { ...this.context };
  }

  /**
   * 设置上下文属性
   */
  setContext(key: string, value: unknown): void {
    this.context[key] = value;
  }
}

/**
 * 创建请求级别的日志器
 */
export function createRequestLogger(requestId?: string): StructuredLogger {
  return new StructuredLogger({
    traceId: requestId || StructuredLogger.generateTraceId(),
  });
}

/**
 * 创建工作流实例级别的日志器
 */
export function createInstanceLogger(
  instanceId: string,
  workflowId: string,
  traceId?: string,
): StructuredLogger {
  return new StructuredLogger({
    traceId: traceId || StructuredLogger.generateTraceId(),
    instanceId,
    workflowId,
  });
}

// 默认日志器实例
export const defaultLogger = new StructuredLogger();
