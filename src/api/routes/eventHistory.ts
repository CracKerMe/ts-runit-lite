import express, { type Request, type Response, type Router } from "express";
import { ApiError, asyncHandler, ErrorCode } from "../ErrorHandler";
import type { EventHistoryManager } from "../EventHistory";
import { sendSuccess } from "../response";

export function createEventRoutes(
  eventHistoryManager: EventHistoryManager,
): Router {
  const router: Router = express.Router();

  // 获取所有事件历史
  router.get(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const limit = req.query.limit
        ? Number.parseInt(req.query.limit as string, 10)
        : 20;
      const offset = req.query.offset
        ? Number.parseInt(req.query.offset as string, 10)
        : 0;

      const events = await eventHistoryManager.getEvents(limit, offset);
      sendSuccess(res, 200, events, "Event history retrieved");
    }),
  );

  // 获取特定事件记录
  router.get(
    "/:id",
    asyncHandler(async (req: Request, res: Response) => {
      const id = req.params.id as string;
      const event = await eventHistoryManager.getEvent(id);

      if (!event) {
        throw ApiError.notFound(
          `事件记录不存在: ${id}`,
          ErrorCode.DATA_NOT_FOUND,
        );
      }

      sendSuccess(res, 200, event, "Event retrieved");
    }),
  );

  // 获取指定类型的事件记录
  router.get(
    "/type/:eventType",
    asyncHandler(async (req: Request, res: Response) => {
      const eventType = req.params.eventType as string;
      const limit = req.query.limit
        ? Number.parseInt(req.query.limit as string, 10)
        : 20;
      const offset = req.query.offset
        ? Number.parseInt(req.query.offset as string, 10)
        : 0;

      const events = await eventHistoryManager.getEventsByType(
        eventType,
        limit,
        offset,
      );

      sendSuccess(res, 200, events, "Events by type retrieved");
    }),
  );

  // 获取指定实例的事件记录
  router.get(
    "/instance/:instanceId",
    asyncHandler(async (req: Request, res: Response) => {
      const instanceId = req.params.instanceId as string;
      const limit = req.query.limit
        ? Number.parseInt(req.query.limit as string, 10)
        : 20;
      const offset = req.query.offset
        ? Number.parseInt(req.query.offset as string, 10)
        : 0;

      const events = await eventHistoryManager.getEventsByInstance(
        instanceId,
        limit,
        offset,
      );

      sendSuccess(res, 200, events, "Events by instance retrieved");
    }),
  );

  return router;
}
