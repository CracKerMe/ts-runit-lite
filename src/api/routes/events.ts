import express, { type Request, type Response, type Router } from "express";
import { body, query, validationResult } from "express-validator";
import { getContainer } from "../../container";
import { errorMessage, errorStack, Logger } from "../../utils/Logger";
import { sendError, sendSuccess } from "../response";
import type { EventTriggerDto } from "../types";
import {
  hashRequestBody,
  sharedIdempotencyStore,
} from "../utils/IdempotencyStore";
import {
  getRequestEngine,
  getRequestStorage,
  requireRequestEventHistoryManager,
  requireRequestWebhookManager,
} from "../utils/requestContext";

const router: Router = express.Router();
type EventAwareEngine = {
  getRegisteredEvents?: () => Promise<string[]> | string[];
};

// 手动触发事件
router.post(
  "/trigger",
  [
    body("event").isString().notEmpty().withMessage("Event name is required"),
    body("data").isObject().withMessage("Event data must be an object"),
    body("instanceId")
      .optional()
      .isString()
      .withMessage("Instance ID must be a string"),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const webhookManager = requireRequestWebhookManager(req);
      const { event, data, instanceId } = req.body as EventTriggerDto;

      const idempotencyKey = req.get("Idempotency-Key");
      if (idempotencyKey) {
        const store = sharedIdempotencyStore;
        const bodyHash = hashRequestBody(req.body ?? {});
        const reserve = await store.reserve(
          `event-trigger:${event}`,
          idempotencyKey,
          bodyHash,
        );

        if (reserve.type === "conflict") {
          return sendError(res, 409, 409, reserve.message);
        }
        if (reserve.type === "in_progress") {
          return sendError(res, 409, 409, "Request is already in progress");
        }
        if (reserve.type === "hit") {
          return sendSuccess(
            res,
            200,
            reserve.value,
            "Event already triggered",
          );
        }

        try {
          // 将 instanceId 加入事件数据
          const eventData = { ...data };
          if (instanceId) {
            eventData.instanceId = instanceId;
          }

          // 通过 eventBus 触发事件
          const container = getContainer();
          if (!container) {
            return sendError(res, 500, 500, "Container not initialized");
          }

          container.eventBus.emit(event, eventData);

          // 同时触发 webhooks
          await webhookManager.triggerEvent(event, eventData);

          const result = { event, withInstanceId: !!instanceId };
          await store.complete(
            `event-trigger:${event}`,
            idempotencyKey,
            bodyHash,
            result,
          );
          return sendSuccess(
            res,
            200,
            result,
            `Event ${event} triggered successfully`,
          );
        } catch (error: unknown) {
          await store.fail(`event-trigger:${event}`, idempotencyKey);
          throw error;
        }
      }

      // 将 instanceId 加入事件数据
      const eventData = { ...data };
      if (instanceId) {
        eventData.instanceId = instanceId;
      }

      // 通过 eventBus 触发事件
      const container = getContainer();
      if (!container) {
        return sendError(res, 500, 500, "Container not initialized");
      }

      container.eventBus.emit(event, eventData);

      // 同时触发 webhooks
      await webhookManager.triggerEvent(event, eventData);

      return sendSuccess(
        res,
        200,
        {
          event,
          withInstanceId: !!instanceId,
        },
        `Event ${event} triggered successfully`,
      );
    } catch (error: unknown) {
      Logger.error(
        "api",
        "events",
        `Error triggering event: ${errorMessage(error)}`,
        errorStack(error),
      );

      return sendError(
        res,
        500,
        500,
        errorMessage(error) || "Failed to trigger event",
      );
    }
  },
);

// 获取已注册事件
router.get("/registered", async (req, res) => {
  try {
    const engine = getRequestEngine(req);

    const getRegisteredEvents = (engine as EventAwareEngine | undefined)
      ?.getRegisteredEvents;
    let registeredEvents: string[];
    if (typeof getRegisteredEvents === "function") {
      registeredEvents = await getRegisteredEvents.call(engine);
    } else {
      const storage = getRequestStorage(req);
      if (!storage?.listWorkflowsWithMetadata) {
        return sendError(
          res,
          501,
          501,
          "getRegisteredEvents is not supported by the current engine and storage is not available",
        );
      }

      const workflows = await storage.listWorkflowsWithMetadata();
      const events = new Set<string>();

      for (const workflow of workflows) {
        const definition = workflow.definition;
        if (definition?.triggerEvents) {
          for (const event of definition.triggerEvents) {
            events.add(event);
          }
        }

        if (definition?.nodes) {
          for (const node of Object.values(definition.nodes)) {
            if (node.type === "event" && node.onEvent) {
              events.add(node.onEvent);
            }
          }
        }
      }

      registeredEvents = Array.from(events);
    }

    return sendSuccess(
      res,
      200,
      registeredEvents,
      "Registered events retrieved",
    );
  } catch (error: unknown) {
    Logger.error(
      "api",
      "events",
      `Error getting registered events: ${errorMessage(error)}`,
      errorStack(error),
    );

    return sendError(
      res,
      500,
      500,
      errorMessage(error) || "Failed to retrieve registered events",
    );
  }
});

// Query events with filters and pagination
router.get(
  "/",
  [
    query("instanceId").optional().isString(),
    query("eventType").optional().isString(),
    query("startTime").optional().isInt({ min: 0 }).toInt(),
    query("endTime").optional().isInt({ min: 0 }).toInt(),
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("pageSize").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("sortOrder").optional().isIn(["asc", "desc"]),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const eventHistoryManager = requireRequestEventHistoryManager(req);

      const params = {
        instanceId: req.query.instanceId as string | undefined,
        eventType: req.query.eventType as string | undefined,
        startTime: req.query.startTime
          ? Number.parseInt(req.query.startTime as string, 10)
          : undefined,
        endTime: req.query.endTime
          ? Number.parseInt(req.query.endTime as string, 10)
          : undefined,
        page: req.query.page
          ? Number.parseInt(req.query.page as string, 10)
          : undefined,
        pageSize: req.query.pageSize
          ? Number.parseInt(req.query.pageSize as string, 10)
          : undefined,
        sortOrder: (req.query.sortOrder as "asc" | "desc") || "desc",
      };

      const result = await eventHistoryManager.queryEvents(params);

      return sendSuccess(res, 200, result, "Events queried");
    } catch (error: unknown) {
      Logger.error(
        "api",
        "events",
        `Error querying events: ${errorMessage(error)}`,
        errorStack(error),
      );

      return sendError(
        res,
        500,
        500,
        errorMessage(error) || "Failed to query events",
      );
    }
  },
);

// Aggregate events by dimension
router.get(
  "/aggregate",
  [
    query("groupBy")
      .isString()
      .isIn(["eventType", "instanceId", "workflowId"])
      .withMessage("groupBy must be eventType, instanceId, or workflowId"),
    query("startTime").optional().isInt({ min: 0 }).toInt(),
    query("endTime").optional().isInt({ min: 0 }).toInt(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const eventHistoryManager = requireRequestEventHistoryManager(req);

      const params = {
        groupBy: req.query.groupBy as "eventType" | "instanceId" | "workflowId",
        startTime: req.query.startTime
          ? Number.parseInt(req.query.startTime as string, 10)
          : undefined,
        endTime: req.query.endTime
          ? Number.parseInt(req.query.endTime as string, 10)
          : undefined,
      };

      const result = await eventHistoryManager.aggregateEvents(params);

      return sendSuccess(res, 200, result, "Events aggregated");
    } catch (error: unknown) {
      Logger.error(
        "api",
        "events",
        `Error aggregating events: ${errorMessage(error)}`,
        errorStack(error),
      );

      return sendError(
        res,
        500,
        500,
        errorMessage(error) || "Failed to aggregate events",
      );
    }
  },
);

// Get specific event by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const eventHistoryManager = requireRequestEventHistoryManager(req);

    const { id } = req.params;
    const event = await eventHistoryManager.getEvent(id);

    if (!event) {
      return sendError(res, 404, 404, `Event ${id} not found`);
    }

    return sendSuccess(res, 200, event, "Event retrieved");
  } catch (error: unknown) {
    Logger.error(
      "api",
      "events",
      `Error getting event: ${errorMessage(error)}`,
      errorStack(error),
    );

    return sendError(
      res,
      500,
      500,
      errorMessage(error) || "Failed to get event",
    );
  }
});

export default router;
