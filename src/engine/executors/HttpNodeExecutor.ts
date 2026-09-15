// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import type { WorkflowInstance } from "../../model/Instance";
import { errorMessage, Logger } from "../../utils/Logger";
import { interpolateObject } from "../ExpressionEvaluator";

/**
 * HTTP node configuration
 */
export interface HttpNodeConfig {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
  url: string; // Supports expressions
  headers?: Record<string, string>; // Supports expressions in values
  body?: any; // Supports expressions
  timeout?: number; // Request timeout in milliseconds (default: 30000)
  retryPolicy?: {
    maxRetries: number;
    backoff: "linear" | "exponential";
    initialDelay?: number; // Initial delay in ms (default: 1000)
  };
  followRedirects?: boolean; // Default: true
  validateStatus?: (status: number) => boolean; // Custom status validation
  /** 响应体大小上限（字节），默认 10 MiB。超限抛错而非把整个响应读进内存。 */
  maxResponseBytes?: number;
}

/**
 * HTTP node output
 */
export interface HttpNodeOutput {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: any;
  duration: number; // Request duration in milliseconds
}

/**
 * HTTP Node Executor
 * Executes HTTP requests with configurable method, URL, headers, body
 * Supports expression evaluation in configuration fields
 * Includes timeout and retry policy support
 */
/**
 * 未显式配置 timeout 时使用的默认请求超时。
 *
 * 此前不配 timeout 就完全不设 AbortController，fetch 可以无限期挂起，
 * 把工作流实例永久钉死在这个节点上。没有超时不是一个合理的默认值。
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * 响应体大小上限（字节）。
 *
 * 此前直接 `await response.json()` / `.text()`，既不检查 Content-Length
 * 也不做流式截断——恶意或异常的端点返回超大响应体会直接 OOM 掉进程。
 */
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MiB

/** 退避上限，避免指数退避算出过长的等待。 */
const MAX_BACKOFF_DELAY_MS = 30_000;

/**
 * Calculate backoff delay for retries
 *
 * 加入抖动：固定退避会让并发实例在同一时刻齐刷刷重试同一个故障端点
 * （惊群）。抖动把重试打散到 [50%, 100%] 区间。
 */
function calculateBackoffDelay(
  attempt: number,
  backoff: "linear" | "exponential",
  initialDelay: number,
): number {
  const base =
    backoff === "exponential"
      ? initialDelay * 2 ** (attempt - 1)
      : initialDelay * attempt;

  const capped = Math.min(base, MAX_BACKOFF_DELAY_MS);
  // 全抖动的一半：保底等待 50%，其余随机，既打散又不会退化成立即重试
  return Math.round(capped * (0.5 + Math.random() * 0.5));
}

/**
 * 在读取响应体时强制执行大小上限。
 *
 * 先看 Content-Length 快速拒绝；该头缺失或撒谎时（分块传输就没有这个头），
 * 再按流累计字节数，超限即中止——不能等到整个响应落到内存里才发现。
 */
async function assertContentLengthWithinLimit(
  response: Response,
  maxBytes: number,
): Promise<void> {
  const declared = response.headers.get("content-length");
  if (!declared) return;

  const size = Number(declared);
  if (Number.isFinite(size) && size > maxBytes) {
    throw new Error(
      `HTTP response body too large: ${size} bytes exceeds the ${maxBytes} byte limit`,
    );
  }
}

async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  await assertContentLengthWithinLimit(response, maxBytes);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(
          `HTTP response body too large: exceeded the ${maxBytes} byte limit`,
        );
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally {
    // 提前中止时释放底层连接，避免连接泄漏
    reader.cancel().catch(() => {});
  }

  return chunks.join("");
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a single HTTP request
 */
async function executeRequest(
  config: HttpNodeConfig,
): Promise<Omit<HttpNodeOutput, "duration">> {
  const controller = new AbortController();
  // 永远设置超时：不配 timeout 时用默认值，而不是不设上限。
  const effectiveTimeout = config.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    // Prepare request options
    const options: RequestInit = {
      method: config.method,
      headers: config.headers || {},
      signal: controller.signal,
      redirect: config.followRedirects !== false ? "follow" : "manual",
    };

    // Add body for methods that support it
    if (config.body && ["POST", "PUT", "PATCH"].includes(config.method)) {
      if (typeof config.body === "object") {
        options.body = JSON.stringify(config.body);
        // Set Content-Type if not already set
        if (!options.headers) {
          options.headers = {};
        }
        const headers = options.headers as Record<string, string>;
        if (!headers["Content-Type"] && !headers["content-type"]) {
          headers["Content-Type"] = "application/json";
        }
      } else {
        options.body = String(config.body);
      }
    }

    // Execute request
    const response = await fetch(config.url, options);

    // Validate status
    const validateStatus =
      config.validateStatus ||
      ((status: number) => status >= 200 && status < 300);
    if (!validateStatus(response.status)) {
      throw new Error(
        `HTTP request failed with status ${response.status}: ${response.statusText}`,
      );
    }

    // Parse response body（统一经过大小上限保护后再解析）
    const contentType = response.headers.get("content-type") || "";
    const maxBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    const isJson = contentType.includes("application/json");
    let body: any;

    if (response.body?.getReader) {
      // 正常路径：流式读取并强制大小上限
      const rawBody = await readBodyWithLimit(response, maxBytes);
      if (isJson) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = rawBody;
        }
      } else {
        // 文本与二进制统一按文本返回，保持原有行为
        body = rawBody;
      }
    } else {
      // 无可读流（HEAD 响应、非标准 Response 实现）：
      // Content-Length 检查已在上面生效，这里直接用原生解析。
      await assertContentLengthWithinLimit(response, maxBytes);
      if (isJson) {
        try {
          body = await response.json();
        } catch {
          body = await response.text();
        }
      } else {
        body = await response.text();
      }
    }

    // Convert headers to plain object
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
    };
  } catch (error: unknown) {
    if ((error instanceof Error ? error.name : "") === "AbortError") {
      throw new Error(`HTTP request timeout after ${config.timeout}ms`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * HTTP Node Executor
 * Executes HTTP requests with configurable method, URL, headers, body
 */
export async function execute(
  config: HttpNodeConfig,
  instance: WorkflowInstance,
): Promise<HttpNodeOutput> {
  const startTime = Date.now();

  // Evaluate expressions in configuration
  const context = {
    context: instance.context || {},
    state: instance.state || {},
  };

  const evaluatedConfig = interpolateObject(config, context, instance.state);

  Logger.log(
    instance.instanceId,
    "http-node",
    `Executing HTTP ${evaluatedConfig.method} request to ${evaluatedConfig.url}`,
  );

  // Execute with retry policy if configured
  const maxRetries = evaluatedConfig.retryPolicy?.maxRetries || 0;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = calculateBackoffDelay(
          attempt,
          evaluatedConfig.retryPolicy?.backoff || "linear",
          evaluatedConfig.retryPolicy?.initialDelay || 1000,
        );
        Logger.log(
          instance.instanceId,
          "http-node",
          `Retrying HTTP request (attempt ${attempt + 1}/${maxRetries + 1}) after ${delay}ms`,
        );
        await sleep(delay);
      }

      const result = await executeRequest(evaluatedConfig);
      const duration = Date.now() - startTime;

      Logger.log(
        instance.instanceId,
        "http-node",
        `HTTP request completed with status ${result.status} in ${duration}ms`,
      );

      return {
        ...result,
        duration,
      };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      Logger.warn(
        instance.instanceId,
        "http-node",
        `HTTP request failed (attempt ${attempt + 1}/${maxRetries + 1}): ${errorMessage(error)}`,
      );

      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        break;
      }
    }
  }

  // All retries exhausted
  Logger.error(
    instance.instanceId,
    "http-node",
    `HTTP request failed after ${maxRetries + 1} attempts`,
    lastError?.stack,
  );

  throw new Error(
    `HTTP request failed after ${maxRetries + 1} attempts: ${lastError?.message || "Unknown error"}`,
  );
}

export const HttpNodeExecutor = {
  execute,
};
