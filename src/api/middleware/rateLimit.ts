import type { NextFunction, Request, Response } from "express";
import type { StorageProvider } from "../../storage/StorageProvider";
import { Logger } from "../../utils/Logger";
import { sendError } from "../response";
import {
  MemoryRateLimitStore,
  type RateLimitResult,
  type RateLimitStore,
} from "./rateLimitStore";

const defaultWindowMs = Number.parseInt(
  process.env.RATE_LIMIT_WINDOW_MS || "60000",
  10,
);
const defaultMaxRequests = Number.parseInt(
  process.env.RATE_LIMIT_MAX_REQUESTS || "100",
  10,
);

// 限流存储（内存）— 限流状态始终是进程本地，不含分布式/Redis 限流。
const defaultStore: RateLimitStore = new MemoryRateLimitStore();

/**
 * 保留接口以兼容调用方；本精简版没有可切换的分布式限流存储。
 */
export function initRateLimiter(_storage: StorageProvider): void {}

async function checkLimit(
  store: RateLimitStore,
  key: string,
  windowMs: number,
  maxRequests: number,
): Promise<RateLimitResult> {
  try {
    return await store.hit(key, windowMs, maxRequests);
  } catch (error) {
    // 限流存储故障时放行（fail-open），避免 Redis 抖动放大为全站 5xx
    Logger.warn("system", "rateLimit", "Rate limit store error, failing open", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      allowed: true,
      remaining: maxRequests,
      resetTime: Date.now() + windowMs,
    };
  }
}

function applyRateLimitHeaders(
  res: Response,
  maxRequests: number,
  result: RateLimitResult,
): void {
  res.setHeader("X-RateLimit-Limit", maxRequests.toString());
  res.setHeader("X-RateLimit-Remaining", result.remaining.toString());
  res.setHeader(
    "X-RateLimit-Reset",
    Math.ceil(result.resetTime / 1000).toString(),
  );
}

/**
 * 限流中间件
 */
export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  // 健康检查跳过限流
  if (req.path === "/health" || req.path.endsWith("/health")) {
    next();
    return;
  }

  // 检查是否启用限流
  if (process.env.RATE_LIMIT_ENABLED === "false") {
    next();
    return;
  }

  // 使用 IP 作为限流 key
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const result = await checkLimit(
    defaultStore,
    key,
    defaultWindowMs,
    defaultMaxRequests,
  );

  applyRateLimitHeaders(res, defaultMaxRequests, result);

  if (!result.allowed) {
    Logger.warn("system", "rateLimit", `Rate limit exceeded for ${key}`);
    sendError(
      res,
      429,
      "RATE_LIMIT_EXCEEDED",
      "Too many requests, please try again later",
      {
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
      },
    );
    return;
  }

  next();
};

/**
 * 创建自定义限流中间件
 */
export function createRateLimiter(
  windowMs: number,
  maxRequests: number,
  store: RateLimitStore = new MemoryRateLimitStore(),
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const result = await checkLimit(store, key, windowMs, maxRequests);

    applyRateLimitHeaders(res, maxRequests, result);

    if (!result.allowed) {
      sendError(res, 429, "RATE_LIMIT_EXCEEDED", "Too many requests", {
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
      });
      return;
    }

    next();
  };
}
