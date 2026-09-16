/**
 * 统一的 API 服务器
 * 整合了所有 API 功能：路由、认证、限流、指标、文档
 */

import { createHash, timingSafeEqual } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import type { Server } from "http";
import morgan from "morgan";
import { WebSocketServer } from "ws";
import { getAppConfig } from "../config/AppConfig";
import type { WorkflowEngine } from "../engine/WorkflowEngine";
import { setHookDispatcher } from "../event/HookManager";
import { recordApiRequest } from "../metrics/index";
import type { StorageProvider } from "../storage/StorageProvider";
import { AuditLogger } from "../utils/AuditLogger";
import { parseEnvInt } from "../utils/env";
import { errorMessage, errorStack, Logger } from "../utils/Logger";
import { ApiError, ErrorCode, errorHandler } from "./ErrorHandler";
import {
  type AuthUser,
  combinedAuthMiddleware,
  verifyWsToken,
} from "./middleware/auth";
import { initRateLimiter, rateLimitMiddleware } from "./middleware/rateLimit";
import { generateConceptsDocHtml } from "./docsPage";
import { generateApiDocsHtml, openApiSpec } from "./openapi";
import { generatePlaygroundHtml } from "./playgroundPage";
import { generateWelcomeHtml } from "./welcomePage";
import { normalizeApiResponse } from "./response";
import { createWorkflowRouterBundle } from "./router";

/**
 * API 服务器配置
 */
export interface ApiServerConfig {
  port?: number;
  enableAuth?: boolean;
  enableRateLimit?: boolean;
  enableMetrics?: boolean;
  enableAuditLog?: boolean;
}

/**
 * HTTP 层的关闭动作，按 Server 实例登记。
 *
 * 用 WeakMap 而非模块级单例，是为了支持同一进程内启动多个服务器
 * （测试里就是这么用的），并且 Server 被回收时条目自动消失。
 */
const apiShutdownHooks = new WeakMap<Server, () => Promise<void>>();

/**
 * 关闭 API 服务器的 HTTP 资源：webhook 管理器、WebSocket 连接与监听套接字。
 *
 * 由调用方注册到 `GracefulShutdown` 的关闭链中，保证与引擎、worker 池、
 * 存储等其他资源按统一顺序释放，而不是各自抢先 `process.exit()`。
 * 对未由 `startApiServer` 创建的 Server 会退化为仅 `server.close()`。
 */
export async function closeApiServer(server: Server): Promise<void> {
  const hook = apiShutdownHooks.get(server);
  if (hook) {
    apiShutdownHooks.delete(server);
    await hook();
    return;
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

/**
 * 启动 API 服务器
 */
export async function startApiServer(
  engine: WorkflowEngine,
  storage: StorageProvider | null = null,
  config: ApiServerConfig = {},
): Promise<Server> {
  const port =
    config.port ??
    parseEnvInt(process.env.API_PORT, 3345, { min: 0, max: 65535 });
  const enableAuth = config.enableAuth ?? process.env.AUTH_ENABLED === "true";
  const enableRateLimit =
    config.enableRateLimit ?? process.env.RATE_LIMIT_ENABLED !== "false";
  const enableMetrics = config.enableMetrics ?? true;
  const enableAuditLog =
    config.enableAuditLog ?? process.env.AUDIT_LOG_ENABLED !== "false";

  // --- Production safety checks (fail-fast) ---
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error(
        "[SECURITY] Production mode requires JWT_SECRET with at least 32 characters. " +
          "Set JWT_SECRET in your environment or disable production mode.",
      );
    }
    // Fail-closed: production MUST have authentication enabled.
    // Override with AUTH_ENABLED=false only via explicit UNSAFE_DISABLE_AUTH=true.
    if (process.env.AUTH_ENABLED !== "true") {
      if (process.env.UNSAFE_DISABLE_AUTH === "true") {
        Logger.warn(
          "system",
          "security",
          "⚠️  UNSAFE_DISABLE_AUTH=true — authentication is DISABLED in production. " +
            "This is insecure and should only be used temporarily.",
        );
      } else {
        throw new Error(
          "[SECURITY] Production mode requires AUTH_ENABLED=true. " +
            "Set AUTH_ENABLED=true or explicitly set UNSAFE_DISABLE_AUTH=true (not recommended).",
        );
      }
    }
    if (!process.env.CORS_ALLOWED_ORIGINS) {
      Logger.warn(
        "system",
        "security",
        "CORS_ALLOWED_ORIGINS not set — CORS will reject all cross-origin requests.",
      );
    }
  }

  // Resolve effective auth flag: production forces true unless explicitly overridden
  const effectiveEnableAuth = isProduction
    ? enableAuth || process.env.UNSAFE_DISABLE_AUTH !== "true"
    : enableAuth;

  try {
    const app = express();
    const {
      router: apiRouter,
      webhookManager,
      consoleWsManager,
    } = createWorkflowRouterBundle(engine, storage, { enableMetrics });

    setHookDispatcher((payload) => {
      webhookManager.triggerHook(payload, "system");
      consoleWsManager.broadcastHook(payload);
    });

    // 静态文件服务 - API 文档相关文件
    app.use("/swagger-ui", express.static("node_modules/swagger-ui-dist"));

    // 基本中间件
    // --- Helmet with environment-appropriate CSP ---
    const cspDirectives: Record<string, string[]> = {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
    };

    if (isProduction) {
      // Production: no unsafe-inline or unsafe-eval
      cspDirectives.scriptSrc = ["'self'"];
      cspDirectives.styleSrc.push("'unsafe-inline'"); // Required for Swagger UI
    } else {
      // Development: allow CDN and inline for Swagger UI / React dev tools
      cspDirectives.scriptSrc = [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdn.jsdelivr.net",
        "https://unpkg.com",
      ];
      cspDirectives.styleSrc.push("'unsafe-inline'");
      cspDirectives.imgSrc.push("https:");
    }

    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: cspDirectives,
        },
        // Prevent MIME sniffing
        noSniff: true,
        // X-Frame-Options
        frameguard: { action: "deny" },
        // HSTS in production
        hsts: isProduction
          ? { maxAge: 31536000, includeSubDomains: true }
          : false,
      }),
    );
    // --- CORS: whitelist in production, permissive in development ---
    const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
      ? process.env.CORS_ALLOWED_ORIGINS.split(",")
          .map((o) => o.trim())
          .filter(Boolean)
      : [];

    if (allowedOrigins.length > 0) {
      app.use(
        cors({
          origin: (origin, callback) => {
            // Allow requests with no origin (server-to-server, curl, mobile apps)
            if (!origin) {
              callback(null, true);
              return;
            }
            if (allowedOrigins.includes(origin)) {
              callback(null, true);
            } else {
              Logger.warn("api", "cors", `Rejected origin: ${origin}`);
              callback(new Error("Not allowed by CORS"));
            }
          },
          credentials: true,
          maxAge: 86400, // 24h preflight cache
        }),
      );
    } else if (!isProduction) {
      // Dev mode: allow all origins
      app.use(cors());
    } else {
      // Production without explicit origins: block all cross-origin
      app.use(cors({ origin: false }));
    }
    // --- Body parser with size limit ---
    app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
    app.use(
      morgan("dev", {
        stream: {
          write: (message) => {
            Logger.debug("api", "http", message.trim());
          },
        },
      }),
    );

    app.use((req, res, next) => {
      if (!req.path.startsWith("/workflow-api/v1")) {
        next();
        return;
      }

      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        const normalized = normalizeApiResponse(body, res.statusCode || 200);
        return originalJson(normalized);
      }) as typeof res.json;

      next();
    });

    // API 请求计时和审计中间件
    app.use((req, res, next) => {
      const startTime = Date.now();
      res.on("finish", () => {
        const duration = (Date.now() - startTime) / 1000;

        if (enableMetrics) {
          // Normalize path to avoid high-cardinality Prometheus labels.
          // Strip dynamic segments (instance IDs, workflow IDs) from the path.
          // 无匹配路由的请求（扫描器、拼错的 URL）其 path 完全由调用方
          // 控制，且既不含 UUID 也不含数字段，会原样成为永久的指标标签。
          // 未认证的攻击者据此即可无限增长内存并让 /metrics 无法抓取。
          const normalizedPath = req.route
            ? `${req.baseUrl}${req.route.path}`
            : res.statusCode === 404
              ? "unmatched"
              : req.path
                  .replace(
                    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
                    "/:id",
                  )
                  .replace(/\/\d+/g, "/:id");
          recordApiRequest(
            req.method,
            normalizedPath,
            res.statusCode,
            duration,
          );
        }

        if (enableAuditLog) {
          AuditLogger.logApiRequest(
            req.method,
            req.path,
            res.statusCode,
            req.user?.id,
            req.ip,
            req.get("user-agent"),
            req.traceId,
            { duration },
          );
        }
      });
      next();
    });

    // 限流中间件
    if (enableRateLimit) {
      if (storage) {
        initRateLimiter(storage);
      }
      app.use(rateLimitMiddleware);
    }

    // 认证中间件
    if (effectiveEnableAuth) {
      app.use(combinedAuthMiddleware);
    }

    // 注册 API 路由（/workflows、/instances、/events、/webhooks、/dlq、
    // /templates、/analytics、/functions、/health、/metrics 均已在
    // createWorkflowRouterBundle 中挂载，此处只需整体挂到基础路径下）
    app.use("/workflow-api/v1", apiRouter);

    // API 文档端点
    // NOTE: These are registered on the root app AFTER the auth middleware,
    // so they WILL be subject to authentication when AUTH_ENABLED=true.
    // If public docs are needed, register before the auth middleware or
    // add explicit skip logic in the auth middleware for /api-docs paths.
    app.get("/", (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.send(generateWelcomeHtml(port));
    });

    app.get("/docs/concepts", (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.send(generateConceptsDocHtml(port));
    });

    app.get("/playground", (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.send(generatePlaygroundHtml(port));
    });

    app.get("/api-docs", (_req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.send(generateApiDocsHtml());
    });

    app.get("/api-docs/openapi.json", (_req, res) => {
      res.json(openApiSpec);
    });

    // 404 处理
    app.use((req, _res, next) => {
      next(
        ApiError.notFound(
          `路径不存在: ${req.originalUrl}`,
          ErrorCode.RESOURCE_NOT_FOUND,
        ),
      );
    });

    // 全局错误处理
    app.use(errorHandler);

    // ── WebSocket authentication helper ────────────────────────────────
    /**
     * Authenticate a WebSocket upgrade request.
     * Accepts Bearer token from the Sec-WebSocket-Protocol header (preferred)
     * or from the `token` query parameter.
     * Returns the authenticated user or null.
     */
    function authenticateWsUpgrade(
      request: import("http").IncomingMessage,
    ): AuthUser | null {
      // 1. Try Sec-WebSocket-Protocol: "bearer, <token>"
      const protocols = request.headers["sec-websocket-protocol"];
      if (protocols) {
        const parts = protocols.split(",").map((p) => p.trim());
        const bearerIdx = parts.indexOf("bearer");
        if (bearerIdx !== -1 && parts[bearerIdx + 1]) {
          const user = verifyWsToken(parts[bearerIdx + 1]);
          if (user) return user;
        }
      }

      // 2. Fallback: query parameter ?token=<jwt>
      const url = new URL(request.url || "", `http://${request.headers.host}`);
      const token = url.searchParams.get("token");
      if (token) {
        return verifyWsToken(token);
      }

      // 3. API Key from query parameter ?apiKey=<key>
      const apiKey = url.searchParams.get("apiKey");
      if (apiKey && process.env.API_KEY) {
        const hashA = createHash("sha256").update(apiKey).digest();
        const hashB = createHash("sha256").update(process.env.API_KEY).digest();
        if (hashA.length === hashB.length && timingSafeEqual(hashA, hashB)) {
          const config = getAppConfig();
          return { id: config.auth.apiKeyUserId, role: config.auth.apiKeyRole };
        }
      }

      return null;
    }

    // 启动服务器
    const server: Server = app.listen(port, () => {
      Logger.info("system", "api", `API Server running on port ${port}`);
      Logger.info("system", "api", `Welcome page: http://localhost:${port}/`);
      Logger.info(
        "system",
        "api",
        `Base URL: http://localhost:${port}/workflow-api/v1`,
      );
      Logger.info(
        "system",
        "api",
        `API Docs: http://localhost:${port}/api-docs`,
      );
    });

    // Setup WebSocket server for console real-time updates
    const wss = new WebSocketServer({ noServer: true });

    /**
     * Validate WebSocket upgrade Origin header.
     * In production with CORS_ALLOWED_ORIGINS set, only listed origins are accepted.
     */
    function isWebSocketOriginAllowed(
      request: import("http").IncomingMessage,
    ): boolean {
      const origin = request.headers.origin;
      if (!origin) return true; // Allow server-to-server / non-browser clients

      const wsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS;
      if (wsAllowedOrigins) {
        const allowed = wsAllowedOrigins.split(",").map((o) => o.trim());
        return allowed.includes(origin);
      }
      // No explicit allowlist: allow in dev, block in production
      return !isProduction;
    }

    server.on("upgrade", (request, socket, head) => {
      // Validate WebSocket Origin in production
      if (!isWebSocketOriginAllowed(request)) {
        Logger.warn(
          "api",
          "websocket",
          "WebSocket upgrade rejected by Origin policy",
          {
            origin: request.headers.origin,
            url: request.url,
          },
        );
        socket.destroy();
        return;
      }

      // ── WebSocket authentication ──────────────────────────────────────
      // In production or when auth is enabled, require valid credentials.
      const wsUser = authenticateWsUpgrade(request);
      if (effectiveEnableAuth && !wsUser) {
        Logger.warn(
          "api",
          "websocket",
          "WebSocket upgrade rejected: authentication failed",
          {
            url: request.url,
            ip: request.socket.remoteAddress,
          },
        );
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const url = new URL(request.url || "", `http://${request.headers.host}`);

      // Global console event feed
      if (url.pathname === "/console/stream") {
        wss.handleUpgrade(request, socket, head, (ws) => {
          consoleWsManager.handleGlobalConnection(ws, request);
        });
        // Handle WebSocket upgrade for console instance streaming
      } else if (
        url.pathname.match(/^\/api\/console\/instances\/[^/]+\/stream$/)
      ) {
        const instanceId = url.pathname.split("/")[4];

        wss.handleUpgrade(request, socket, head, (ws) => {
          consoleWsManager.handleConnection(ws, instanceId, request);
        });
      } else if (
        url.pathname.match(
          /^\/workflow-api\/v1\/console\/instances\/[^/]+\/stream$/,
        )
      ) {
        const instanceId = url.pathname.split("/")[6];

        wss.handleUpgrade(request, socket, head, (ws) => {
          consoleWsManager.handleConnection(ws, instanceId, request);
        });
      } else {
        socket.destroy();
      }
    });

    // NOTE: deliberately no process signal handler here.
    //
    // `GracefulShutdown` (src/lifecycle.ts) already owns SIGTERM/SIGINT and
    // runs the full ordered teardown (engine → worker pool → sandbox pool →
    // scheduler → storage). A second handler here used to call
    // `process.exit(0)` as soon as `server.close()` drained, killing the
    // process while that chain was still mid-flight — worker threads unjoined
    // and storage unflushed. It also never handled SIGINT at all.
    //
    // HTTP-side cleanup is exposed via `closeApiServer(server)` so the caller
    // can register it as one ordered step of the single shutdown chain.
    apiShutdownHooks.set(server, async () => {
      webhookManager.destroy();
      consoleWsManager.shutdown();
      await new Promise<void>((resolve) => {
        server.close(() => {
          Logger.info("system", "api", "Server closed");
          resolve();
        });
      });
    });

    return server;
  } catch (error: unknown) {
    Logger.error(
      "system",
      "api",
      `Failed to start API server: ${errorMessage(error)}`,
      errorStack(error),
    );
    throw error;
  }
}

// 保持向后兼容的导出
export { startApiServer as startServer };
