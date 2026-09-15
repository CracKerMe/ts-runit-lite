/**
 * Mountable Express router for the workflow API.
 *
 * `startApiServer` (see `./server.ts`) builds its own standalone `express()`
 * app and calls `app.listen`, which works for running this project as a
 * sidecar service but cannot be plugged into a host application's existing
 * Express app. `createWorkflowRouter` extracts just the route-wiring part
 * (the `/workflows`, `/instances`, `/events`, ... sub-routers, request
 * context injection, and the event-history recording hook) as a plain
 * `express.Router`, so a consumer can do:
 *
 * ```ts
 * import express from "express";
 * import { createWorkflowRouter } from "ts-workflow-engine-lite";
 *
 * const app = express();
 * app.use(express.json());
 * app.use("/workflow-api/v1", createWorkflowRouter(engine, storage));
 * app.listen(3000);
 * ```
 *
 * This does NOT include `startApiServer`'s standalone-service concerns:
 * helmet/CORS/rate-limit/auth middleware, the welcome/docs pages, the
 * WebSocket console stream, or production fail-fast checks. When mounting
 * into a host app, apply the host's own body-parser, auth, and security
 * middleware upstream of this router. Use `startApiServer` instead when you
 * want a fully configured, standalone HTTP server.
 */
import express, { type Router as ExpressRouter } from "express";
import { getDLQ } from "../dlq/index";
import type { WorkflowEngineV2 } from "../engine/WorkflowEngineV2";
import { getMetrics } from "../metrics/index";
import type { StorageProvider } from "../storage/StorageProvider";
import { Logger } from "../utils/Logger";
import { ConsoleWebSocketManager } from "./ConsoleWebSocketManager";
import { EventHistoryManager } from "./EventHistory";
import { createSuccessResponse, isSuccessfulApiBody } from "./response";
import { createEventRoutes } from "./routes/eventHistory";
import analyticsRoutes from "./routes/analytics";
import dlqRoutes from "./routes/dlq";
import eventRoutes from "./routes/events";
import functionRoutes from "./routes/functions";
import instanceRoutes from "./routes/instances";
import templateRoutes from "./routes/templates";
import webhookRoutes from "./routes/webhooks";
import workflowRoutes from "./routes/workflows/index";
import { WebhookManager } from "./WebhookManager";

export interface WorkflowRouterOptions {
  /** Include the Prometheus-format `GET /metrics` endpoint. Default: true. */
  enableMetrics?: boolean;
}

/** The router plus the internally-created managers it depends on, for callers (e.g. `startApiServer`) that also need to wire hooks, WebSocket upgrades, or shutdown against the same instances. */
export interface WorkflowRouterBundle {
  router: ExpressRouter;
  webhookManager: WebhookManager;
  eventHistoryManager: EventHistoryManager;
  consoleWsManager: ConsoleWebSocketManager;
}

/**
 * Build a mountable `express.Router` exposing the workflow REST API
 * (`/workflows`, `/instances`, `/events`, `/webhooks`, `/dlq`, `/templates`,
 * `/analytics`, `/functions`, `/health`, and optionally `/metrics`) under
 * whatever base path the host app mounts it at.
 *
 * The router assumes `express.json()` has already run upstream — it does
 * not parse the request body itself, so mount it after your own body
 * parser and any auth/rate-limit middleware.
 */
export function createWorkflowRouter(
  engine: WorkflowEngineV2,
  storage: StorageProvider | null = null,
  options: WorkflowRouterOptions = {},
): ExpressRouter {
  return createWorkflowRouterBundle(engine, storage, options).router;
}

/**
 * Same as {@link createWorkflowRouter}, but also returns the webhook/event
 * history/console WebSocket managers it created internally, for callers
 * that need to wire hook dispatch, WebSocket upgrades, or graceful shutdown
 * against those same instances (see `startApiServer` in `./server.ts`).
 */
export function createWorkflowRouterBundle(
  engine: WorkflowEngineV2,
  storage: StorageProvider | null = null,
  options: WorkflowRouterOptions = {},
): WorkflowRouterBundle {
  const enableMetrics = options.enableMetrics ?? true;

  const webhookManager = new WebhookManager(storage || undefined);
  webhookManager.startCleanupScheduler();
  const eventHistoryManager = new EventHistoryManager(storage || undefined);
  const consoleWsManager = new ConsoleWebSocketManager(storage || undefined);
  const dlq = getDLQ();

  const router: ExpressRouter = express.Router();

  // 为路由处理器提供必要的依赖
  router.use((req, _res, next) => {
    req.engine = engine;
    req.storage = storage;
    req.webhookManager = webhookManager;
    req.eventHistoryManager = eventHistoryManager;
    req.consoleWsManager = consoleWsManager;
    req.dlq = dlq;
    next();
  });

  // 事件历史记录中间件 — MUST be registered BEFORE routes so it intercepts res.json
  router.use(async (req, res, next) => {
    const originalJson = res.json;
    res.json = function (body) {
      const method = req.method;
      const path = req.path;

      if (isSuccessfulApiBody(body)) {
        if (
          method === "POST" &&
          path.includes("/workflows") &&
          path.includes("/start") &&
          (body as { data?: { instanceId?: string } }).data?.instanceId
        ) {
          const workflowId = req.params.id;
          const instanceId = (body as { data: { instanceId: string } }).data
            .instanceId;
          const context = req.body || {};

          eventHistoryManager
            .recordEvent(
              "workflow_started",
              { workflowId, instanceId, context },
              "api",
              instanceId,
            )
            .catch((err) => {
              Logger.error(
                "api",
                "event-history",
                `Error recording workflow start event: ${err.message}`,
              );
            });
        }

        if (method === "POST" && path.includes("/events/trigger")) {
          const { event, data = {}, instanceId } = req.body;
          eventHistoryManager
            .recordEvent(event, data, "api", instanceId)
            .catch((err) => {
              Logger.error(
                "api",
                "event-history",
                `Error recording triggered event: ${err.message}`,
              );
            });
        }
      }

      return originalJson.call(this, body);
    };
    next();
  });

  router.use("/workflows", workflowRoutes);
  router.use("/webhooks", webhookRoutes);
  router.use("/events", eventRoutes);
  router.use("/instances", instanceRoutes);
  router.use("/events/history", createEventRoutes(eventHistoryManager));
  router.use("/dlq", dlqRoutes);
  router.use("/templates", templateRoutes);
  router.use("/analytics", analyticsRoutes);
  router.use("/functions", functionRoutes);

  router.get("/health", (_req, res) => {
    res.status(200).json(
      createSuccessResponse(
        {
          status: "ok",
          version: process.env.npm_package_version || "1.0.0",
        },
        "Service healthy",
      ),
    );
  });

  if (enableMetrics) {
    router.get("/metrics", (_req, res) => {
      res.set("Content-Type", "text/plain; charset=utf-8");
      res.send(getMetrics());
    });
  }

  return { router, webhookManager, eventHistoryManager, consoleWsManager };
}
