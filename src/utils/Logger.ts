import * as fs from "fs";
import * as path from "path";

type NodeType = "action" | "engine" | "system" | "event" | "workflow";
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

function normalizeLogLevel(level: string | undefined): LogLevel {
  const normalized = level?.toUpperCase();
  if (
    normalized === "DEBUG" ||
    normalized === "INFO" ||
    normalized === "WARN" ||
    normalized === "ERROR"
  ) {
    return normalized;
  }
  return "INFO";
}

let currentLogLevel = normalizeLogLevel(
  process.env.WORKFLOW_ENGINE_LOG_LEVEL || process.env.LOG_LEVEL,
);

export function setLogLevel(level: LogLevel | string): void {
  currentLogLevel = normalizeLogLevel(level);
}

export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel];
}

interface LogData {
  [key: string]: unknown;
}

/**
 * 日志条目结构。
 * context1/context2 在不同场景下含义不同：
 *   - 工作流实例内：context1 = instanceId, context2 = nodeId
 *   - 模块级（无实例）：context1 = 模块名（如 "system"、"storage"）, context2 = 操作名（如 "connect"、"cleanup"）
 */
interface LogEntry {
  data: LogData & {
    context1: string;
    context2: string;
    message: string;
  };
  timestamp: string;
}

interface ErrorLogEntry {
  context1: string;
  context2: string;
  error: string;
  stack?: string;
  timestamp: string;
}

/**
 * 根据 context2（nodeId 或操作名）推断日志前缀
 * nodeType 可强制指定，优先级最高
 */
function getPrefix(context2: string, nodeType?: NodeType): string {
  if (nodeType === "action") return "[TASK]";
  if (nodeType === "engine") return "[ENGINE]";
  if (nodeType === "system") return "[SYSTEM]";
  if (nodeType === "event") return "[EVENT]";
  if (nodeType === "workflow") return "[WORKFLOW]";
  const id = (context2 || "").toLowerCase();
  if (id.includes("engine")) return "[ENGINE]";
  if (id.includes("task")) return "[TASK]";
  if (id.includes("system")) return "[SYSTEM]";
  if (id.includes("event")) return "[EVENT]";
  if (id.includes("workflow")) return "[WORKFLOW]";
  return "[WORKFLOW]";
}

/**
 * 日志文件目录与保留天数，支持运行时通过环境变量配置（懒读取，便于测试覆盖）
 */
function getLogDir(): string {
  return process.env.LOG_DIR || path.join(process.cwd(), "logs");
}

function getLogRetentionDays(): number {
  const parsed = Number.parseInt(process.env.LOG_RETENTION_DAYS || "30", 10);
  return Number.isFinite(parsed) ? parsed : 30;
}

function getDateStr(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

const lastCleanupDateByDir = new Map<string, string>();

/**
 * 按天写入日志文件（YYYY-MM-DD.log），不再输出到控制台。
 * 写入失败时静默忽略，避免日志功能影响主业务流程。
 */
function writeLogLine(line: string): void {
  const dir = getLogDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const dateStr = getDateStr();
    fs.appendFileSync(path.join(dir, `${dateStr}.log`), `${line}\n`, "utf8");
    if (lastCleanupDateByDir.get(dir) !== dateStr) {
      lastCleanupDateByDir.set(dir, dateStr);
      void cleanupOldLogs(dir, dateStr);
    }
  } catch {
    // 忽略写入失败
  }
}

/**
 * 归档管理：清理超过保留天数的历史日志文件
 */
async function cleanupOldLogs(dir: string, todayStr: string): Promise<void> {
  const retentionDays = getLogRetentionDays();
  if (retentionDays <= 0) return;

  const threshold =
    Date.parse(`${todayStr}T00:00:00.000Z`) -
    retentionDays * 24 * 60 * 60 * 1000;

  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const match = /^(\d{4}-\d{2}-\d{2})\.log$/.exec(entry);
    if (!match) continue;
    const fileTime = Date.parse(`${match[1]}T00:00:00.000Z`);
    if (!Number.isFinite(fileTime) || fileTime >= threshold) continue;
    await fs.promises.rm(path.join(dir, entry), { force: true }).catch(() => {
      // 忽略单个文件的删除失败，不影响其他文件清理
    });
  }
}

/**
 * 安全地序列化对象，避免循环引用
 */
function safeStringify(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    return value;
  });
}

/**
 * 两种合法调用方式：
 *
 * 1. 工作流实例内（有 instanceId 上下文）：
 *    Logger.info(instance.instanceId, nodeId, "message", data?)
 *
 * 2. 模块级代码（无实例上下文）：
 *    Logger.info("system", "storage", "Local file storage initialized")
 *    Logger.info("system", "scheduler", "Job started")
 *
 * 第一个参数统一称为 context1，第二个称为 context2，
 * 两者都是字符串标识符，用于在日志中定位来源。
 */

export function log(
  context1: string,
  context2: string,
  message: string,
  data?: LogData,
  nodeType?: NodeType,
): void {
  if (!shouldLog("INFO")) return;

  const logEntry: LogEntry = {
    data: {
      ...data,
      context1,
      context2,
      message,
    },
    timestamp: new Date().toISOString(),
  };
  const prefix = getPrefix(context2, nodeType);
  writeLogLine(`${prefix} ${safeStringify(logEntry)}`);
}

export function debug(
  context1: string,
  context2: string,
  message: string,
  data?: LogData,
  nodeType?: NodeType,
): void {
  if (!shouldLog("DEBUG")) return;

  const logEntry: LogEntry = {
    data: {
      ...data,
      context1,
      context2,
      message,
    },
    timestamp: new Date().toISOString(),
  };
  const prefix = getPrefix(context2, nodeType);
  writeLogLine(`${prefix} ${safeStringify(logEntry)}`);
}

export function info(
  context1: string,
  context2: string,
  message: string,
  data?: LogData,
  nodeType?: NodeType,
): void {
  if (!shouldLog("INFO")) return;

  const logEntry: LogEntry = {
    data: {
      ...data,
      context1,
      context2,
      message,
    },
    timestamp: new Date().toISOString(),
  };
  const prefix = getPrefix(context2, nodeType);
  writeLogLine(`${prefix} ${safeStringify(logEntry)}`);
}

export function warn(
  context1: string,
  context2: string,
  message: string,
  data?: LogData,
  nodeType?: NodeType,
): void {
  if (!shouldLog("WARN")) return;

  const logEntry: LogEntry = {
    data: {
      ...data,
      context1,
      context2,
      message,
    },
    timestamp: new Date().toISOString(),
  };
  const prefix = getPrefix(context2, nodeType);
  writeLogLine(`${prefix} ${safeStringify(logEntry)}`);
}

export function error(
  context1: string,
  context2: string,
  errorMsg: string,
  stack?: string,
  nodeType?: NodeType,
): void {
  if (!shouldLog("ERROR")) return;

  const logEntry: ErrorLogEntry = {
    context1,
    context2,
    error: errorMsg,
    stack,
    timestamp: new Date().toISOString(),
  };
  const prefix = getPrefix(context2, nodeType);
  writeLogLine(`${prefix} ${safeStringify(logEntry)}`);
}

// 为了保持向后兼容性，导出一个包含所有日志函数的命名空间对象
export const Logger = {
  log,
  debug,
  info,
  warn,
  error,
  setLevel: setLogLevel,
  getLevel: getLogLevel,
};

/** Extract a human-readable message from an unknown caught error. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Extract stack trace from an unknown caught error. */
export function errorStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}
