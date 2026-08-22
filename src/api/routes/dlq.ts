import { type Request, type Response, Router } from "express";
import type { DeadLetterQueue, DeadLetterStatus } from "../../dlq/index";
import type { WorkflowEngineV2 } from "../../engine/WorkflowEngineV2";
import { Logger } from "../../utils/Logger";
import { sendError, sendSuccess } from "../response";

const router: Router = Router();

const VALID_STATUSES: DeadLetterStatus[] = [
  "pending",
  "retried",
  "acknowledged",
  "permanently_failed",
];

function getMaxRetries(): number {
  return Number.parseInt(process.env.DLQ_MAX_RETRIES || "5", 10);
}

function getBatchMaxSize(): number {
  return Number.parseInt(process.env.BATCH_MAX_SIZE || "100", 10);
}

function parseBatchIds(req: Request, res: Response): string[] | null {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    sendError(res, 400, 400, "Body must contain a non-empty ids array");
    return null;
  }
  const max = getBatchMaxSize();
  if (ids.length > max) {
    sendError(res, 400, 400, `Batch size exceeds limit (${max})`);
    return null;
  }
  return ids.map(String);
}

interface RetryOutcome {
  ok: boolean;
  newInstanceId?: string;
  error?: string;
  statusCode: number;
}

type DlqRetryEngine = Pick<WorkflowEngineV2, "start">;

function requireDlq(req: Request): DeadLetterQueue {
  if (!req.dlq) {
    throw new Error("DLQ is not available on request context");
  }
  return req.dlq;
}

function requireRetryEngine(req: Request): DlqRetryEngine {
  if (!req.engine) {
    throw new Error("Workflow engine is not available on request context");
  }
  return req.engine;
}

/**
 * 重试单条死信的核心逻辑（单条接口与批量接口共用）。
 * 超过 DLQ_MAX_RETRIES 时标记为 permanently_failed 且不再重试。
 */
async function retryEntry(
  dlq: DeadLetterQueue,
  engine: DlqRetryEngine,
  id: string,
): Promise<RetryOutcome> {
  const entry = await dlq.get(id);
  if (!entry) {
    return { ok: false, error: "DLQ entry not found", statusCode: 404 };
  }
  if (entry.status === "permanently_failed") {
    return {
      ok: false,
      error: "Entry is permanently failed",
      statusCode: 429,
    };
  }
  if (entry.retryCount >= getMaxRetries()) {
    await dlq.updateStatus(id, "permanently_failed");
    return {
      ok: false,
      error: `Max retries (${getMaxRetries()}) exceeded`,
      statusCode: 429,
    };
  }
  if (entry.type !== "workflow" || !entry.workflowId) {
    return {
      ok: false,
      error: "Retry not supported for this entry type",
      statusCode: 400,
    };
  }

  await dlq.incrementRetry(id);
  const newInstanceId = await engine.start(
    entry.workflowId,
    entry.payload?.context || {},
  );
  await dlq.updateStatus(id, "retried");
  await dlq.remove(id);
  return { ok: true, newInstanceId, statusCode: 200 };
}

/**
 * 获取死信队列列表
 * GET /dlq
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const dlq = requireDlq(req);
    const limit = Number.parseInt(req.query.limit as string, 10) || 100;
    const offset = Number.parseInt(req.query.offset as string, 10) || 0;
    const type = req.query.type as "event" | "task" | "workflow" | undefined;
    const workflowId = req.query.workflowId as string | undefined;

    const result = await dlq.list({ limit, offset, type, workflowId });

    return sendSuccess(
      res,
      200,
      {
        entries: result.entries,
        pagination: {
          total: result.total,
          limit,
          offset,
        },
      },
      "DLQ entries retrieved",
    );
  } catch (error) {
    Logger.error(
      "api",
      "dlq",
      "Failed to list DLQ entries",
      error instanceof Error ? error.stack : String(error),
    );
    return sendError(res, 500, 500, "Failed to list DLQ entries");
  }
});

/**
 * 获取死信队列统计
 * GET /dlq/stats
 */
router.get("/stats", (req: Request, res: Response) => {
  void (async () => {
    try {
      const dlq = requireDlq(req);
      const stats = await dlq.getStats();

      return sendSuccess(res, 200, stats, "DLQ stats retrieved");
    } catch (error) {
      Logger.error(
        "api",
        "dlq",
        "Failed to get DLQ stats",
        error instanceof Error ? error.stack : String(error),
      );
      return sendError(res, 500, 500, "Failed to get DLQ stats");
    }
  })();
});

/**
 * 获取单个死信条目
 * GET /dlq/:id
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const dlq = requireDlq(req);
    const id = req.params.id as string;
    const entry = await dlq.get(id);

    if (!entry) {
      return sendError(res, 404, 404, "DLQ entry not found");
    }

    return sendSuccess(res, 200, entry, "DLQ entry retrieved");
  } catch (error) {
    Logger.error(
      "api",
      "dlq",
      "Failed to get DLQ entry",
      error instanceof Error ? error.stack : String(error),
    );
    return sendError(res, 500, 500, "Failed to get DLQ entry");
  }
});

/**
 * 删除死信条目
 * DELETE /dlq/:id
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const dlq = requireDlq(req);
    const id = req.params.id as string;
    const removed = await dlq.remove(id);

    return removed
      ? sendSuccess(res, 200, { removed }, "Entry removed")
      : sendError(res, 404, 404, "Entry not found");
  } catch (error) {
    Logger.error(
      "api",
      "dlq",
      "Failed to remove DLQ entry",
      error instanceof Error ? error.stack : String(error),
    );
    return sendError(res, 500, 500, "Failed to remove DLQ entry");
  }
});

/**
 * 清空死信队列
 * POST /dlq/clear
 */
router.post("/clear", async (req: Request, res: Response) => {
  try {
    const dlq = requireDlq(req);
    const count = await dlq.clear();

    return sendSuccess(res, 200, { cleared: count }, "DLQ cleared");
  } catch (error) {
    Logger.error(
      "api",
      "dlq",
      "Failed to clear DLQ",
      error instanceof Error ? error.stack : String(error),
    );
    return sendError(res, 500, 500, "Failed to clear DLQ");
  }
});

/**
 * 批量重试死信条目
 * POST /dlq/batch/retry
 */
router.post("/batch/retry", async (req: Request, res: Response) => {
  try {
    const dlq = requireDlq(req);
    const engine = requireRetryEngine(req);
    const ids = parseBatchIds(req, res);
    if (!ids) return;

    const results: Array<{
      id: string;
      ok: boolean;
      newInstanceId?: string;
      error?: string;
    }> = [];
    for (const id of ids) {
      try {
        const outcome = await retryEntry(dlq, engine, id);
        results.push({
          id,
          ok: outcome.ok,
          newInstanceId: outcome.newInstanceId,
          error: outcome.error,
        });
      } catch (error) {
        results.push({
          id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    return sendSuccess(
      res,
      200,
      { succeeded, failed: results.length - succeeded, results },
      "Batch retry completed",
    );
  } catch (error) {
    Logger.error(
      "api",
      "dlq",
      "Failed to batch retry DLQ entries",
      error instanceof Error ? error.stack : String(error),
    );
    return sendError(res, 500, 500, "Failed to batch retry DLQ entries");
  }
});

/**
 * 批量删除死信条目
 * POST /dlq/batch/delete
 */
router.post("/batch/delete", async (req: Request, res: Response) => {
  try {
    const dlq = requireDlq(req);
    const ids = parseBatchIds(req, res);
    if (!ids) return;

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of ids) {
      const entry = await dlq.get(id);
      if (!entry) {
        results.push({ id, ok: false, error: "DLQ entry not found" });
        continue;
      }
      const removed = await dlq.remove(id);
      results.push(
        removed
          ? { id, ok: true }
          : { id, ok: false, error: "Failed to remove entry" },
      );
    }

    const succeeded = results.filter((r) => r.ok).length;
    return sendSuccess(
      res,
      200,
      { succeeded, failed: results.length - succeeded, results },
      "Batch delete completed",
    );
  } catch (error) {
    Logger.error(
      "api",
      "dlq",
      "Failed to batch delete DLQ entries",
      error instanceof Error ? error.stack : String(error),
    );
    return sendError(res, 500, 500, "Failed to batch delete DLQ entries");
  }
});

/**
 * 更新死信条目状态
 * PATCH /dlq/:id
 */
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const dlq = requireDlq(req);
    const id = req.params.id as string;
    const status = req.body?.status as DeadLetterStatus | undefined;
    const notes = req.body?.notes as string | undefined;

    if (!status || !VALID_STATUSES.includes(status)) {
      return sendError(
        res,
        400,
        400,
        `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
      );
    }

    const updated = await dlq.updateStatus(id, status, notes);
    if (!updated) {
      return sendError(res, 404, 404, "DLQ entry not found");
    }

    return sendSuccess(res, 200, { id, status, notes }, "Entry updated");
  } catch (error) {
    Logger.error(
      "api",
      "dlq",
      "Failed to update DLQ entry",
      error instanceof Error ? error.stack : String(error),
    );
    return sendError(res, 500, 500, "Failed to update DLQ entry");
  }
});

/**
 * 重试死信条目
 * POST /dlq/:id/retry
 */
router.post("/:id/retry", async (req: Request, res: Response) => {
  try {
    const dlq = requireDlq(req);
    const engine = requireRetryEngine(req);
    const id = req.params.id as string;

    const outcome = await retryEntry(dlq, engine, id);
    if (!outcome.ok) {
      return sendError(
        res,
        outcome.statusCode,
        outcome.statusCode,
        outcome.error ?? "Retry failed",
      );
    }

    return sendSuccess(
      res,
      200,
      { newInstanceId: outcome.newInstanceId },
      "Workflow restarted",
    );
  } catch (error) {
    Logger.error(
      "api",
      "dlq",
      "Failed to retry DLQ entry",
      error instanceof Error ? error.stack : String(error),
    );
    return sendError(res, 500, 500, "Failed to retry DLQ entry");
  }
});

export default router;
