import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getAppConfig } from "../../config/AppConfig";
import { Logger } from "../../utils/Logger";
import { sendError } from "../response";
import { isAuthEnabled } from "../utils/authConfig";

export interface AuthUser {
  id: string;
  tenantId?: string;
  role?: string;
  [key: string]: unknown;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * JWT 认证中间件
 */
export const jwtAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // 健康检查跳过认证
  if (req.path === "/health" || req.path.endsWith("/health")) {
    next();
    return;
  }

  // 检查是否启用认证
  if (!isAuthEnabled()) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendError(
      res,
      401,
      "UNAUTHORIZED",
      "Missing or invalid authorization header",
    );
    return;
  }

  const token = authHeader.split(" ")[1];
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    Logger.error("system", "auth", "JWT_SECRET not configured");
    sendError(
      res,
      500,
      "SERVER_ERROR",
      "Authentication not properly configured",
    );
    return;
  }

  try {
    const decoded = jwt.verify(token, jwtSecret, {
      algorithms: ["HS256", "HS384", "HS512"],
    }) as AuthUser;
    req.user = decoded;
    next();
  } catch (error) {
    const message =
      error instanceof jwt.TokenExpiredError
        ? "Token has expired"
        : "Invalid token";

    sendError(res, 403, "FORBIDDEN", message);
  }
};

/**
 * 固定时间字符串比较，防止时序攻击。
 * 对两个字符串取 SHA-256 后再比较，避免长度不同时的快速失败。
 */
function safeStringEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * API Key 认证中间件
 */
export const apiKeyAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // 健康检查跳过认证
  if (req.path === "/health" || req.path.endsWith("/health")) {
    next();
    return;
  }

  // 检查是否启用认证
  if (!isAuthEnabled()) {
    next();
    return;
  }

  const apiKey = req.headers["x-api-key"] as string;
  const validApiKey = process.env.API_KEY;

  if (!validApiKey) {
    Logger.error("system", "auth", "API_KEY not configured");
    sendError(
      res,
      500,
      "SERVER_ERROR",
      "Authentication not properly configured",
    );
    return;
  }

  // 使用固定时间比较防止时序攻击
  if (!apiKey || !safeStringEqual(apiKey, validApiKey)) {
    sendError(res, 401, "UNAUTHORIZED", "Invalid or missing API key");
    return;
  }

  // 设置 req.user，使 RBAC 中间件能正常工作
  const config = getAppConfig();
  req.user = {
    id: config.auth.apiKeyUserId,
    role: config.auth.apiKeyRole,
  };

  next();
};

/**
 * 组合认证中间件 - 支持 JWT 或 API Key
 */
export const combinedAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // 健康检查跳过认证
  if (req.path === "/health" || req.path.endsWith("/health")) {
    next();
    return;
  }

  // 检查是否启用认证
  if (!isAuthEnabled()) {
    next();
    return;
  }

  // 优先检查 JWT
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    jwtAuthMiddleware(req, res, next);
    return;
  }

  // 其次检查 API Key
  const apiKey = req.headers["x-api-key"];
  if (apiKey) {
    apiKeyAuthMiddleware(req, res, next);
    return;
  }

  Logger.warn("api", "auth", "Unauthenticated request rejected", {
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  sendError(
    res,
    401,
    "UNAUTHORIZED",
    "Authentication required. Provide Bearer token or X-API-Key header.",
  );
};

/**
 * Verify a JWT token from a WebSocket upgrade request.
 * Returns the decoded user or null if invalid.
 */
export function verifyWsToken(token: string): AuthUser | null {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return null;

  try {
    return jwt.verify(token, jwtSecret, {
      algorithms: ["HS256", "HS384", "HS512"],
    }) as AuthUser;
  } catch {
    return null;
  }
}

/**
 * 生成 JWT Token（用于测试或内部使用）
 */
export function generateToken(payload: AuthUser, expiresIn = "24h"): string {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET not configured");
  }
  return jwt.sign(payload as object, jwtSecret, {
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
  });
}
