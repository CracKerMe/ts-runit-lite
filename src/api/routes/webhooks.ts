import express, { type Request, type Response, type Router } from "express";
import { body, param, validationResult } from "express-validator";
import { errorMessage, errorStack, Logger } from "../../utils/Logger";
import { rbacMiddleware } from "../middleware/rbac";
import { sendError, sendSuccess } from "../response";
import type { CreateWebhookDto, UpdateWebhookDto } from "../types";
import type { WebhookManager } from "../WebhookManager";

const router: Router = express.Router();

// 获取所有webhooks
router.get("/", async (req: Request, res: Response) => {
  try {
    const webhookManager = req.webhookManager as WebhookManager;
    const webhooks = webhookManager.getAllWebhooks();
    return sendSuccess(res, 200, webhooks, "Webhooks retrieved");
  } catch (error: unknown) {
    Logger.error(
      "api",
      "webhooks",
      `Error getting webhooks: ${errorMessage(error)}`,
      errorStack(error),
    );

    return sendError(
      res,
      500,
      500,
      errorMessage(error) || "Failed to retrieve webhooks",
    );
  }
});

// 获取 webhook 投递记录
router.get("/deliveries", async (req: Request, res: Response) => {
  try {
    const webhookManager = req.webhookManager as WebhookManager;
    const limit = Number.parseInt(req.query.limit as string, 10) || 100;
    const offset = Number.parseInt(req.query.offset as string, 10) || 0;
    const webhookId = req.query.webhookId as string | undefined;
    const event = req.query.event as string | undefined;
    const workflowId = req.query.workflowId as string | undefined;
    const instanceId = req.query.instanceId as string | undefined;
    const status = req.query.status as
      | "pending"
      | "retry_scheduled"
      | "success"
      | "failed"
      | "dead_lettered"
      | undefined;

    const result = webhookManager.listDeliveries({
      webhookId,
      event,
      workflowId,
      instanceId,
      status,
      limit,
      offset,
    });

    return sendSuccess(
      res,
      200,
      {
        deliveries: result.deliveries,
        pagination: {
          total: result.total,
          limit,
          offset,
        },
      },
      "Webhook deliveries retrieved",
    );
  } catch (error: unknown) {
    Logger.error(
      "api",
      "webhooks",
      `Error getting webhook deliveries: ${errorMessage(error)}`,
      errorStack(error),
    );

    return sendError(
      res,
      500,
      500,
      errorMessage(error) || "Failed to retrieve webhook deliveries",
    );
  }
});

router.get(
  "/deliveries/cleanup/status",
  async (req: Request, res: Response) => {
    try {
      const webhookManager = req.webhookManager as WebhookManager;
      const status = webhookManager.getCleanupStatus();

      return sendSuccess(
        res,
        200,
        status,
        "Webhook delivery cleanup status retrieved",
      );
    } catch (error: unknown) {
      Logger.error(
        "api",
        "webhooks",
        `Error getting webhook delivery cleanup status: ${errorMessage(error)}`,
        errorStack(error),
      );

      return sendError(
        res,
        500,
        500,
        errorMessage(error) ||
          "Failed to retrieve webhook delivery cleanup status",
      );
    }
  },
);

// 获取单条 webhook 投递记录
router.get(
  "/deliveries/:deliveryId",
  param("deliveryId")
    .isString()
    .notEmpty()
    .withMessage("Delivery ID is required"),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const webhookManager = req.webhookManager as WebhookManager;
      const delivery = webhookManager.getDelivery(
        req.params.deliveryId as string,
      );

      if (!delivery) {
        return sendError(res, 404, 404, "Webhook delivery not found");
      }

      return sendSuccess(res, 200, delivery, "Webhook delivery retrieved");
    } catch (error: unknown) {
      Logger.error(
        "api",
        "webhooks",
        `Error getting webhook delivery ${req.params.deliveryId}: ${errorMessage(error)}`,
        errorStack(error),
      );

      return sendError(
        res,
        500,
        500,
        errorMessage(error) || "Failed to retrieve webhook delivery",
      );
    }
  },
);

// 手动重试 webhook 投递
router.post(
  "/deliveries/:deliveryId/retry",
  param("deliveryId")
    .isString()
    .notEmpty()
    .withMessage("Delivery ID is required"),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const webhookManager = req.webhookManager as WebhookManager;
      const delivery = await webhookManager.retryDelivery(
        req.params.deliveryId as string,
      );

      return sendSuccess(
        res,
        200,
        delivery,
        "Webhook delivery scheduled for retry",
      );
    } catch (error: unknown) {
      Logger.error(
        "api",
        "webhooks",
        `Error retrying webhook delivery ${req.params.deliveryId}: ${errorMessage(error)}`,
        errorStack(error),
      );

      const statusCode =
        error instanceof Error && errorMessage(error).includes("not found")
          ? 404
          : 500;

      return sendError(
        res,
        statusCode,
        statusCode,
        errorMessage(error) || "Failed to retry webhook delivery",
      );
    }
  },
);

// 批量重试 webhook 投递
router.post("/deliveries/retry", async (req: Request, res: Response) => {
  try {
    const webhookManager = req.webhookManager as WebhookManager;
    const webhookId = req.body.webhookId as string | undefined;
    const event = req.body.event as string | undefined;
    const workflowId = req.body.workflowId as string | undefined;
    const instanceId = req.body.instanceId as string | undefined;
    const status = req.body.status as "failed" | "dead_lettered" | undefined;

    const deliveries = await webhookManager.retryDeliveries({
      webhookId,
      event,
      workflowId,
      instanceId,
      status,
    });

    return sendSuccess(
      res,
      200,
      {
        count: deliveries.length,
        deliveries,
      },
      "Webhook deliveries scheduled for retry",
    );
  } catch (error: unknown) {
    Logger.error(
      "api",
      "webhooks",
      `Error retrying webhook deliveries: ${errorMessage(error)}`,
      errorStack(error),
    );

    return sendError(
      res,
      500,
      500,
      errorMessage(error) || "Failed to retry webhook deliveries",
    );
  }
});

// 手动清理 webhook 投递记录
router.post("/deliveries/cleanup", async (req: Request, res: Response) => {
  try {
    const webhookManager = req.webhookManager as WebhookManager;
    const removed = await webhookManager.cleanupExpiredDeliveries();

    return sendSuccess(
      res,
      200,
      { removed },
      "Webhook delivery cleanup completed",
    );
  } catch (error: unknown) {
    Logger.error(
      "api",
      "webhooks",
      `Error cleaning webhook deliveries: ${errorMessage(error)}`,
      errorStack(error),
    );

    return sendError(
      res,
      500,
      500,
      errorMessage(error) || "Failed to clean webhook deliveries",
    );
  }
});

// 获取特定webhook
router.get(
  "/:id",
  param("id").isString().notEmpty().withMessage("Webhook ID is required"),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const webhookManager = req.webhookManager as WebhookManager;
      const webhookId = req.params.id as string;
      const webhook = webhookManager.getWebhook(webhookId);

      if (!webhook) {
        return sendError(
          res,
          404,
          404,
          `Webhook with ID ${webhookId} not found`,
        );
      }

      return sendSuccess(res, 200, webhook, "Webhook retrieved");
    } catch (error: unknown) {
      Logger.error(
        "api",
        "webhooks",
        `Error getting webhook ${req.params.id}: ${errorMessage(error)}`,
        errorStack(error),
      );

      return sendError(
        res,
        500,
        500,
        errorMessage(error) || "Failed to retrieve webhook",
      );
    }
  },
);

// 创建webhook
router.post(
  "/",
  rbacMiddleware({ resource: "config", action: "write" }),
  [
    body("name").isString().notEmpty().withMessage("Name is required"),
    body("url").isURL().withMessage("Valid URL is required"),
    body("events").isArray().notEmpty().withMessage("Events array is required"),
    body("events.*").isString().withMessage("Events must be strings"),
    body("headers")
      .optional()
      .isObject()
      .withMessage("Headers must be an object"),
    body("secret").optional().isString().withMessage("Secret must be a string"),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const webhookManager = req.webhookManager as WebhookManager;
      const webhookData = req.body as CreateWebhookDto;

      const webhook = await webhookManager.createWebhook(webhookData);

      return sendSuccess(res, 201, webhook, "Webhook created");
    } catch (error: unknown) {
      Logger.error(
        "api",
        "webhooks",
        `Error creating webhook: ${errorMessage(error)}`,
        errorStack(error),
      );

      return sendError(
        res,
        500,
        500,
        errorMessage(error) || "Failed to create webhook",
      );
    }
  },
);

// 更新webhook
router.put(
  "/:id",
  rbacMiddleware({ resource: "config", action: "write" }),
  [
    param("id").isString().notEmpty().withMessage("Webhook ID is required"),
    body("name").optional().isString().withMessage("Name must be a string"),
    body("url").optional().isURL().withMessage("Valid URL is required"),
    body("events").optional().isArray().withMessage("Events must be an array"),
    body("events.*")
      .optional()
      .isString()
      .withMessage("Events must be strings"),
    body("headers")
      .optional()
      .isObject()
      .withMessage("Headers must be an object"),
    body("isActive")
      .optional()
      .isBoolean()
      .withMessage("isActive must be a boolean"),
    body("secret").optional().isString().withMessage("Secret must be a string"),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const webhookManager = req.webhookManager as WebhookManager;
      const webhookData = req.body as UpdateWebhookDto;
      const webhookId = req.params.id as string;

      const webhook = await webhookManager.updateWebhook(
        webhookId,
        webhookData,
      );

      if (!webhook) {
        return sendError(
          res,
          404,
          404,
          `Webhook with ID ${webhookId} not found`,
        );
      }

      return sendSuccess(res, 200, webhook, "Webhook updated");
    } catch (error: unknown) {
      Logger.error(
        "api",
        "webhooks",
        `Error updating webhook ${req.params.id}: ${errorMessage(error)}`,
        errorStack(error),
      );

      return sendError(
        res,
        500,
        500,
        errorMessage(error) || "Failed to update webhook",
      );
    }
  },
);

// 删除webhook
router.delete(
  "/:id",
  rbacMiddleware({ resource: "config", action: "delete" }),
  param("id").isString().notEmpty().withMessage("Webhook ID is required"),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const webhookManager = req.webhookManager as WebhookManager;
      const webhookId = req.params.id as string;
      const success = await webhookManager.deleteWebhook(webhookId);

      if (!success) {
        return sendError(
          res,
          404,
          404,
          `Webhook with ID ${webhookId} not found`,
        );
      }

      return sendSuccess(
        res,
        200,
        { webhookId },
        `Webhook ${webhookId} deleted successfully`,
      );
    } catch (error: unknown) {
      Logger.error(
        "api",
        "webhooks",
        `Error deleting webhook ${req.params.id}: ${errorMessage(error)}`,
        errorStack(error),
      );

      return sendError(
        res,
        500,
        500,
        errorMessage(error) || "Failed to delete webhook",
      );
    }
  },
);

// 测试webhook
router.post(
  "/:id/test",
  param("id").isString().notEmpty().withMessage("Webhook ID is required"),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const webhookManager = req.webhookManager as WebhookManager;
      const webhookId = req.params.id as string;
      const success = await webhookManager.testWebhook(webhookId);

      if (!success) {
        return sendError(
          res,
          404,
          404,
          `Webhook with ID ${webhookId} not found or test failed`,
        );
      }

      return sendSuccess(
        res,
        200,
        { webhookId },
        `Webhook ${req.params?.id} tested successfully`,
      );
    } catch (error: unknown) {
      Logger.error(
        "api",
        "webhooks",
        `Error testing webhook ${req.params?.id}: ${errorMessage(error)}`,
        errorStack(error),
      );

      return sendError(
        res,
        500,
        500,
        errorMessage(error) || "Failed to test webhook",
      );
    }
  },
);

export default router;
