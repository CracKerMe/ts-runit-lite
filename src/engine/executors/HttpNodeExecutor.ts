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
  timeout?: number; // Request timeout in milliseconds
  retryPolicy?: {
    maxRetries: number;
    backoff: "linear" | "exponential";
    initialDelay?: number; // Initial delay in ms (default: 1000)
  };
  followRedirects?: boolean; // Default: true
  validateStatus?: (status: number) => boolean; // Custom status validation
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
 * Calculate backoff delay for retries
 */
function calculateBackoffDelay(
  attempt: number,
  backoff: "linear" | "exponential",
  initialDelay: number,
): number {
  if (backoff === "exponential") {
    return initialDelay * 2 ** (attempt - 1);
  }
  // Linear backoff
  return initialDelay * attempt;
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
  const timeoutId = config.timeout
    ? setTimeout(() => controller.abort(), config.timeout)
    : null;

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

    // Parse response body
    const contentType = response.headers.get("content-type") || "";
    let body: any;

    if (contentType.includes("application/json")) {
      try {
        body = await response.json();
      } catch {
        body = await response.text();
      }
    } else if (contentType.includes("text/")) {
      body = await response.text();
    } else {
      // For binary data, return as text or could be extended to handle buffers
      body = await response.text();
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
