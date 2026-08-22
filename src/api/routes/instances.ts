import express, { type Request, type Response, type Router } from "express";
import { body, param, validationResult } from "express-validator";
import { workflowDebugger } from "../../debug/WorkflowDebugger";
import {
  type SearchQuery,
  type SearchResult,
  searchInstances,
} from "../../engine/InstanceSearch";
import {
  type SearchAttributeValue,
  searchAttributeManager,
} from "../../engine/SearchAttributeManager";
import type { WorkflowEngineV2 } from "../../engine/WorkflowEngineV2";
import type { ExecutionLog, WorkflowInstance } from "../../model/Instance";
import type { WorkflowDefinition } from "../../model/Workflow";
import type { StorageProvider } from "../../storage/StorageProvider";
import { errorMessage, errorStack, Logger } from "../../utils/Logger";
import { rbacMiddleware } from "../middleware/rbac";
import { sendError, sendSuccess } from "../response";
import { InstanceApplicationService } from "../services/InstanceApplicationService";
import { getRequestEngine, getRequestStorage } from "../utils/requestContext";
import { asyncHandler } from "../utils/routeHelper";

const router: Router = express.Router();

// --- Service factory ---
function getService(req: Request): InstanceApplicationService {
  const engine = getRequestEngine(req) as WorkflowEngineV2;
  const storage = getRequestStorage(req) ?? null;
  return new InstanceApplicationService(engine, storage);
}

type Engine = WorkflowEngineV2;
type EngineWithLifecycleControls = WorkflowEngineV2 & {
  pauseInstance?: (instanceId: string) => Promise<boolean>;
  resumeInstance?: (instanceId: string) => Promise<boolean>;
  cancelInstance?: (instanceId: string) => Promise<boolean>;
  terminateInstance?: (instanceId: string) => Promise<boolean>;
};
type SortableWorkflow = Pick<WorkflowDefinition, "nodes"> | null | undefined;

function getEngine(req: Request): Engine {
  return getRequestEngine(req) as Engine;
}

function getStorage(req: Request, engine: Engine): StorageProvider | undefined {
  void engine;
  return getRequestStorage(req);
}

function validateRequest(req: Request, res: Response): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    sendError(res, 400, 400, errors.array()[0].msg);
    return false;
  }
  return true;
}

// @ts-expect-error —保留以备后用
function _getTotalNodes(workflow: SortableWorkflow): number {
  const nodes = workflow?.nodes;
  if (!nodes) return 0;
  if (Array.isArray(nodes)) return nodes.length;
  if (typeof nodes === "object") return Object.keys(nodes).length;
  return 0;
}

router.post(
  "/workflows/:id/dry-run",
  param("id").isString().notEmpty().withMessage("Workflow ID is required"),
  body("context")
    .optional()
    .isObject()
    .withMessage("Context must be an object"),
  body("options")
    .optional()
    .isObject()
    .withMessage("Options must be an object"),
  async (req: Request, res: Response) => {
    if (!validateRequest(req, res)) {
      return;
    }
    try {
      const engine = getEngine(req);
      const workflowId = req.params.id;
      const result = await engine.dryRun(
        workflowId,
        req.body?.context ?? {},
        req.body?.options ?? {},
      );
      return sendSuccess(res, 200, result, "Workflow dry run completed");
    } catch (error: unknown) {
      Logger.error(
        "api",
        "instances",
        `Error running dry run for ${req.params.id}: ${errorMessage(error)}`,
        errorStack(error),
      );
      return sendError(
        res,
        500,
        500,
        errorMessage(error) || "Failed to execute dry run",
      );
    }
  },
);

function toEpochMs(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsedDate = Date.parse(value);
    if (!Number.isNaN(parsedDate)) {
      return parsedDate;
    }

    const parsedNumber = Number(value);
    if (Number.isFinite(parsedNumber)) {
      return parsedNumber;
    }
  }

  return 0;
}

async function loadInstance(
  engine: Engine,
  storage: StorageProvider | undefined,
  instanceId: string,
): Promise<WorkflowInstance | undefined> {
  const maybeInstance = await Promise.resolve(engine.getInstance(instanceId));
  if (maybeInstance) {
    return maybeInstance;
  }

  if (storage?.loadInstance) {
    const stored = await storage.loadInstance(instanceId);
    return stored ?? undefined;
  }

  return undefined;
}

// @ts-expect-error —保留以备后用
async function _loadAllInstances(
  engine: Engine,
  storage: StorageProvider | undefined,
): Promise<WorkflowInstance[]> {
  if (storage) {
    const ids = await storage.listInstances();
    const instances = await Promise.all(
      ids.map((instanceId) => storage.loadInstance(instanceId)),
    );
    return instances.filter((inst): inst is WorkflowInstance => Boolean(inst));
  }

  return engine
    .listInstances()
    .map((id) => engine.getInstance(id))
    .filter((inst): inst is WorkflowInstance => Boolean(inst));
}

// @ts-expect-error —保留以备后用
async function _invokeInstanceLifecycleMethod(
  engine: EngineWithLifecycleControls,
  methodName: string,
  instanceId: string,
): Promise<boolean> {
  switch (methodName) {
    case "cancelInstance":
      if (typeof engine.cancelInstance !== "function") {
        break;
      }
      return await engine.cancelInstance(instanceId);
    case "pauseInstance":
      if (typeof engine.pauseInstance !== "function") {
        break;
      }
      return await engine.pauseInstance(instanceId);
    case "resumeInstance":
      if (typeof engine.resumeInstance !== "function") {
        break;
      }
      return await engine.resumeInstance(instanceId);
    default:
      break;
  }

  throw new Error(`${methodName} is not supported by the current engine`);
}

// 获取所有实例 —— Service-based
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const service = getService(req);

    const page = req.query.page
      ? Number.parseInt(req.query.page as string, 10)
      : 1;
    const pageSize = req.query.pageSize
      ? Number.parseInt(req.query.pageSize as string, 10)
      : 50;

    if (page < 1 || pageSize < 1 || pageSize > 100) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message:
          "Invalid pagination parameters (page >= 1, 1 <= pageSize <= 100)",
      });
      return;
    }

    const result = await service.listInstances({
      workflowId: req.query.workflowId as string | undefined,
      status: req.query.status as string | undefined,
      startTime: req.query.startTime
        ? Number.parseInt(req.query.startTime as string, 10)
        : undefined,
      endTime: req.query.endTime
        ? Number.parseInt(req.query.endTime as string, 10)
        : undefined,
      page,
      pageSize,
      sortBy: (req.query.sortBy as string) || "createdAt",
      sortOrder: (req.query.sortOrder as "asc" | "desc") || "desc",
      parentId: req.query.parentId as string | undefined,
    });

    res.json({
      success: true,
      data: {
        instances: result.instances,
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          totalCount: result.total,
          totalPages: Math.ceil(result.total / result.pageSize),
        },
      },
      message: "Instances retrieved",
    });
  }),
);

// GET /search —— Service-based
router.get(
  "/search",
  asyncHandler(async (req: Request, res: Response) => {
    const service = getService(req);

    const workflowId = req.query.workflowId as string | undefined;
    const status =
      typeof req.query.status === "string" && req.query.status.length > 0
        ? req.query.status.split(",").map((s) => s.trim())
        : undefined;

    let attributes: Record<string, SearchAttributeValue> | undefined;
    if (typeof req.query.attributes === "string") {
      try {
        attributes = JSON.parse(req.query.attributes);
      } catch {
        res.status(400).json({
          success: false,
          error: "VALIDATION_ERROR",
          message: "attributes must be a valid JSON object",
        });
        return;
      }
    }

    const offset = req.query.offset
      ? Number.parseInt(req.query.offset as string, 10)
      : undefined;
    const limit = req.query.limit
      ? Number.parseInt(req.query.limit as string, 10)
      : undefined;

    const instanceIds = searchAttributeManager.query({
      workflowId,
      status,
      attributes,
      offset,
      limit,
    });

    const instances = await Promise.all(
      instanceIds.map((id) => service.getInstance(id).catch(() => null)),
    );

    const results = instances
      .filter((inst) => Boolean(inst))
      .map((inst) => {
        if (!inst) return null;
        return {
          id: inst.instanceId,
          workflowId: inst.workflowId,
          status: inst.status,
          createdAt: toEpochMs(inst.createdAt),
          updatedAt: toEpochMs(inst.updatedAt),
          currentNode: inst.currentNodes?.[0],
          searchAttributes: inst.searchAttributes,
        };
      })
      .filter(Boolean);

    res.json({
      success: true,
      data: { instances: results, total: instanceIds.length },
      message: "Instances retrieved",
    });
  }),
);

// POST /search —— Service-based
router.post(
  "/search",
  asyncHandler(async (req: Request, res: Response) => {
    const service = getService(req);
    const query = (req.body ?? {}) as SearchQuery;

    if (query.filters !== undefined && !Array.isArray(query.filters)) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "filters must be an array",
      });
      return;
    }

    // Load instances: prefer storage, fall back to engine
    const storage = getRequestStorage(req);
    let allInstances: WorkflowInstance[] = [];

    if (storage && typeof storage.listInstances === "function") {
      const ids = await storage.listInstances();
      allInstances = (
        await Promise.all(ids.map((id) => storage.loadInstance(id)))
      ).filter((inst): inst is WorkflowInstance => Boolean(inst));
    } else {
      const engine = getRequestEngine(req) as unknown as {
        listInstances: () => string[] | Promise<string[]>;
      };
      const rawIds = await engine.listInstances();
      const ids = Array.isArray(rawIds) ? rawIds : [];
      // Load raw instances via Service's loadInstance (not getInstance which requires getWorkflow)
      allInstances = (
        await Promise.all(
          ids.map(async (id) => {
            try {
              return await service.loadRawInstance(id);
            } catch {
              return null;
            }
          }),
        )
      ).filter((inst): inst is WorkflowInstance => Boolean(inst));
    }

    let result: SearchResult;
    try {
      result = searchInstances(allInstances, query);
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? errorMessage(error) : "Invalid search query";
      res
        .status(400)
        .json({ success: false, error: "VALIDATION_ERROR", message: msg });
      return;
    }

    res.json({
      success: true,
      data: {
        instances: result.instances.map((inst) => ({
          instanceId: inst.instanceId,
          workflowId: inst.workflowId,
          status: inst.status,
          createdAt: toEpochMs(inst.createdAt),
          updatedAt: toEpochMs(inst.updatedAt),
          currentNodes: inst.currentNodes,
          searchAttributes: inst.searchAttributes,
        })),
        pagination: result.pagination,
        aggregations: result.aggregations,
      },
      message: "Instances retrieved",
    });
  }),
);

// 批量重试 —— Service-based
router.post(
  "/batch/retry",
  asyncHandler(async (req: Request, res: Response) => {
    const service = getService(req);
    const ids = req.body?.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "Body must contain a non-empty ids array",
      });
      return;
    }

    const batchMaxSize = Number.parseInt(
      process.env.BATCH_MAX_SIZE || "100",
      10,
    );
    if (ids.length > batchMaxSize) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: `Batch size exceeds limit (${batchMaxSize})`,
      });
      return;
    }

    const results: Array<{
      id: string;
      ok: boolean;
      newInstanceId?: string;
      error?: string;
    }> = [];
    const newInstanceIds: string[] = [];
    const engine = getRequestEngine(req) as {
      start: (
        workflowId: string,
        context: Record<string, unknown>,
      ) => Promise<string>;
    };

    for (const rawId of ids) {
      const id = String(rawId);
      try {
        const instance = await service.getInstance(id);
        if (!["failed", "cancelled"].includes(instance.status)) {
          results.push({
            id,
            ok: false,
            error: `Cannot retry instance with status '${instance.status}'`,
          });
          continue;
        }
        const newInstanceId = await engine.start(
          instance.workflowId,
          (instance.context ?? {}) as Record<string, unknown>,
        );
        newInstanceIds.push(newInstanceId);
        results.push({ id, ok: true, newInstanceId });
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? errorMessage(error) : String(error);
        results.push({ id, ok: false, error: msg });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    res.json({
      success: true,
      data: {
        retried: succeeded,
        failed: results.length - succeeded,
        newInstanceIds,
        results,
      },
      message: "Batch retry completed",
    });
  }),
);

// 批量删除 —— Service-based
router.post(
  "/batch/delete",
  rbacMiddleware({ resource: "instance", action: "delete" }),
  asyncHandler(async (req: Request, res: Response) => {
    const service = getService(req);
    const ids = req.body?.ids;
    const confirm = req.body?.confirm;

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "Body must contain a non-empty ids array",
      });
      return;
    }
    if (confirm !== true) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message:
          "Batch delete requires { confirm: true } to prevent accidental deletion",
      });
      return;
    }

    const batchMaxSize = Number.parseInt(
      process.env.BATCH_MAX_SIZE || "100",
      10,
    );
    if (ids.length > batchMaxSize) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: `Batch size exceeds limit (${batchMaxSize})`,
      });
      return;
    }

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    const TERMINAL = new Set(["completed", "failed", "cancelled"]);

    for (const rawId of ids) {
      const id = String(rawId);
      try {
        const instance = await service.getInstance(id);
        if (!TERMINAL.has(instance.status)) {
          results.push({
            id,
            ok: false,
            error: `Cannot delete instance with status '${instance.status}'`,
          });
          continue;
        }
        await service.deleteInstance(id);
        results.push({ id, ok: true });
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? errorMessage(error) : String(error);
        results.push({ id, ok: false, error: msg });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    res.json({
      success: true,
      data: { deleted: succeeded, failed: results.length - succeeded, results },
      message: "Batch delete completed",
    });
  }),
);

// @ts-expect-error —保留以备后用
const _BATCH_OPERATIONS: Record<string, string> = {
  cancel: "cancelInstance",
  pause: "pauseInstance",
  resume: "resumeInstance",
};

// 批量操作 —— Service-based
router.post(
  "/batch/:operation",
  asyncHandler(async (req: Request, res: Response) => {
    const operation = req.params.operation as string;
    const engine = getRequestEngine(req) as unknown as Record<string, unknown>;

    const BATCH_METHODS: Record<string, string> = {
      cancel: "cancelInstance",
      pause: "pauseInstance",
      resume: "resumeInstance",
    };

    const methodName = BATCH_METHODS[operation];
    if (!methodName) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: `Unknown batch operation: ${operation}. Supported: ${Object.keys(BATCH_METHODS).join(", ")}`,
      });
      return;
    }

    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "Body must contain a non-empty ids array",
      });
      return;
    }

    const batchMaxSize = Number.parseInt(
      process.env.BATCH_MAX_SIZE || "100",
      10,
    );
    if (ids.length > batchMaxSize) {
      res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: `Batch size exceeds limit (${batchMaxSize})`,
      });
      return;
    }

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const rawId of ids) {
      const id = String(rawId);
      try {
        // Call engine directly to preserve mock compatibility in tests
        const fn = engine[methodName];
        if (typeof fn !== "function") {
          results.push({
            id,
            ok: false,
            error: `Method ${methodName} not supported`,
          });
          continue;
        }
        const success = await (fn as (id: string) => Promise<boolean>).call(
          engine,
          id,
        );
        results.push(
          success
            ? { id, ok: true }
            : { id, ok: false, error: "Instance not found or not eligible" },
        );
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? errorMessage(error) : String(error);
        results.push({ id, ok: false, error: msg });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    res.json({
      success: true,
      data: { succeeded, failed: results.length - succeeded, results },
      message: `Batch ${operation} completed`,
    });
  }),
);

// 获取特定实例 —— Service-based
router.get(
  "/:id",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  asyncHandler(async (req: Request, res: Response) => {
    const service = getService(req);
    const instance = await service.getInstance(req.params.id);
    res.json({
      success: true,
      data: instance,
      message: "Instance retrieved",
    });
  }),
);

// 获取实例执行历史
router.get(
  "/:id/history",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const engine = getEngine(req);
      const storage = getStorage(req, engine);
      const instanceId = req.params.id;

      const instance = await loadInstance(engine, storage, instanceId);

      if (!instance) {
        return sendError(
          res,
          404,
          404,
          `Instance with ID ${instanceId} not found`,
        );
      }

      // Build execution history in chronological order
      const executionHistory = instance.history
        .sort(
          (a: ExecutionLog, b: ExecutionLog) =>
            toEpochMs(a.timestamp) - toEpochMs(b.timestamp),
        )
        .map((log: ExecutionLog) => ({
          nodeId: log.nodeId,
          timestamp: toEpochMs(log.timestamp),
          status: log.status,
          duration: log.duration,
          data: log.data,
          error: log.error,
          stack: log.stack,
        }));

      return sendSuccess(
        res,
        200,
        {
          instanceId,
          workflowId: instance.workflowId,
          history: executionHistory,
          totalSteps: executionHistory.length,
        },
        "Instance history retrieved",
      );
    } catch (error: unknown) {
      Logger.error(
        "api",
        "instances",
        `Error getting instance history ${req.params.id}: ${errorMessage(error)}`,
        errorStack(error),
      );

      return sendError(
        res,
        500,
        500,
        errorMessage(error) || "Failed to retrieve instance history",
      );
    }
  },
);

// Attach debugger to an instance
router.post(
  "/:id/debug/attach",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  (req: Request, res: Response) => {
    if (!validateRequest(req, res)) {
      return;
    }

    const instanceId = req.params.id as string;
    workflowDebugger.attach(instanceId);
    return sendSuccess(
      res,
      200,
      workflowDebugger.getSnapshot(),
      `Debugger attached to instance ${instanceId}`,
    );
  },
);

// Detach debugger from the current instance
router.post("/:id/debug/detach", (req: Request, res: Response) => {
  const instanceId = req.params.id as string;
  workflowDebugger.detach();
  return sendSuccess(
    res,
    200,
    { instanceId },
    `Debugger detached from instance ${instanceId}`,
  );
});

// Get debugger snapshot
router.get("/:id/debug/snapshot", (_req: Request, res: Response) => {
  return sendSuccess(
    res,
    200,
    workflowDebugger.getSnapshot(),
    "Debugger snapshot retrieved",
  );
});

// Add breakpoint
router.post(
  "/:id/debug/breakpoints",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  body("nodeId").isString().notEmpty().withMessage("nodeId is required"),
  body("condition")
    .optional()
    .isString()
    .withMessage("condition must be a string"),
  (req: Request, res: Response) => {
    if (!validateRequest(req, res)) {
      return;
    }

    const instanceId = req.params.id as string;
    if (workflowDebugger.getSnapshot().instanceId !== instanceId) {
      workflowDebugger.attach(instanceId);
    }

    const breakpoint = workflowDebugger.addBreakpoint(
      req.body.nodeId as string,
      req.body.condition as string | undefined,
    );
    return sendSuccess(res, 201, breakpoint, "Breakpoint added");
  },
);

// Remove breakpoint
router.delete(
  "/:id/debug/breakpoints/:breakpointId",
  param("breakpointId")
    .isString()
    .notEmpty()
    .withMessage("breakpointId is required"),
  (req: Request, res: Response) => {
    if (!validateRequest(req, res)) {
      return;
    }

    const removed = workflowDebugger.removeBreakpoint(
      req.params.breakpointId as string,
    );
    return sendSuccess(
      res,
      removed ? 200 : 404,
      { removed },
      removed ? "Breakpoint removed" : "Breakpoint not found",
    );
  },
);

// Toggle breakpoint
router.patch(
  "/:id/debug/breakpoints/:breakpointId",
  param("breakpointId")
    .isString()
    .notEmpty()
    .withMessage("breakpointId is required"),
  body("enabled")
    .optional()
    .isBoolean()
    .withMessage("enabled must be a boolean"),
  (req: Request, res: Response) => {
    if (!validateRequest(req, res)) {
      return;
    }

    const breakpoint = workflowDebugger.toggleBreakpoint(
      req.params.breakpointId as string,
      req.body.enabled as boolean | undefined,
    );
    if (!breakpoint) {
      return sendError(res, 404, 404, "Breakpoint not found");
    }
    return sendSuccess(res, 200, breakpoint, "Breakpoint updated");
  },
);

// Resume debugger
router.post("/:id/debug/resume", (_req: Request, res: Response) => {
  workflowDebugger.resume();
  return sendSuccess(
    res,
    200,
    workflowDebugger.getSnapshot(),
    "Debugger resumed",
  );
});

// Step debugger
router.post("/:id/debug/step", (_req: Request, res: Response) => {
  void workflowDebugger.step();
  return sendSuccess(
    res,
    200,
    workflowDebugger.getSnapshot(),
    "Debugger step requested",
  );
});

// 发送信号 —— Service-based
router.post(
  "/:id/signal",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  body("name").isString().notEmpty().withMessage("Signal name is required"),
  body("payload").optional(),
  asyncHandler(async (req: Request, res: Response) => {
    const service = getService(req);
    const result = await service.signalInstance(
      req.params.id,
      req.body.name,
      req.body.payload,
    );
    res.status(202).json({
      success: true,
      data: result,
      message: `Signal ${req.body.name} sent to instance ${req.params.id}`,
    });
  }),
);

// 查询实例 —— Service-based
router.post(
  "/:id/query",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  body("name").isString().notEmpty().withMessage("Query name is required"),
  body("payload").optional(),
  asyncHandler(async (req: Request, res: Response) => {
    const service = getService(req);
    const result = await service.queryInstance(
      req.params.id,
      req.body.name,
      req.body.payload,
    );
    res.json({
      success: true,
      data: result,
      message: `Query ${req.body.name} completed for instance ${req.params.id}`,
    });
  }),
);

// 更新实例 —— Service-based
router.post(
  "/:id/update",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  body("name").isString().notEmpty().withMessage("Update name is required"),
  body("payload").optional(),
  body("correlationId").optional().isString(),
  asyncHandler(async (req: Request, res: Response) => {
    const service = getService(req);
    const result = await service.updateInstance(
      req.params.id,
      req.body.name,
      req.body.payload,
      req.body.correlationId,
    );
    res.json({
      success: true,
      data: result,
      message: `Update ${req.body.name} completed for instance ${req.params.id}`,
    });
  }),
);

// 暂停实例 —— Service-based
router.post(
  "/:id/pause",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  asyncHandler(async (req: Request, res: Response) => {
    const service = getService(req);
    const result = await service.pauseInstance(req.params.id);
    res.json({
      success: true,
      data: { instanceId: result.instanceId },
      message: `Instance ${req.params.id} paused successfully`,
    });
  }),
);

// 恢复实例 —— Service-based
router.post(
  "/:id/resume",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  asyncHandler(async (req: Request, res: Response) => {
    const service = getService(req);
    const result = await service.resumeInstance(req.params.id);
    res.json({
      success: true,
      data: { instanceId: result.instanceId },
      message: `Instance ${req.params.id} resumed successfully`,
    });
  }),
);

// 取消实例 —— Service-based
router.post(
  "/:id/cancel",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  asyncHandler(async (req: Request, res: Response) => {
    const service = getService(req);
    const result = await service.cancelInstance(req.params.id);
    res.json({
      success: true,
      data: { instanceId: result.instanceId },
      message: `Instance ${req.params.id} cancelled successfully`,
    });
  }),
);

// 强制终止实例 —— Service-based
router.post(
  "/:id/terminate",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  asyncHandler(async (req: Request, res: Response) => {
    const service = getService(req);
    const result = await service.terminateInstance(req.params.id);
    res.json({
      success: true,
      data: { instanceId: result.instanceId },
      message: result.success
        ? `Instance ${req.params.id} terminated successfully`
        : `Instance ${req.params.id} was already in a terminal state`,
    });
  }),
);

// Retry a failed node
router.post(
  "/:id/nodes/:nodeId/retry",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  param("nodeId").isString().notEmpty().withMessage("Node ID is required"),
  body("preserveInput")
    .optional()
    .isBoolean()
    .withMessage("preserveInput must be a boolean"),
  body("maxRetries")
    .optional()
    .isInt({ min: 1 })
    .withMessage("maxRetries must be a positive integer"),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const engine = getEngine(req);
      const instanceId = req.params.id as string;
      const nodeId = req.params.nodeId as string;

      // Retry the node (preserveInput is true by default in the engine implementation)
      await engine.retryNode(instanceId, nodeId);

      return sendSuccess(
        res,
        200,
        {
          instanceId,
          nodeId,
        },
        `Node ${nodeId} in instance ${instanceId} retried successfully`,
      );
    } catch (error: unknown) {
      Logger.error(
        "api",
        "instances",
        `Error retrying node ${req.params.nodeId} in instance ${req.params.id}: ${errorMessage(error)}`,
        errorStack(error),
      );

      // Return 400 for invalid state errors
      const statusCode =
        errorMessage(error)?.includes("not in a failed state") ||
        errorMessage(error)?.includes("not found")
          ? 400
          : 500;

      return sendError(
        res,
        statusCode,
        statusCode,
        errorMessage(error) || "Failed to retry node",
      );
    }
  },
);

// Skip a node
router.post(
  "/:id/nodes/:nodeId/skip",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  param("nodeId").isString().notEmpty().withMessage("Node ID is required"),
  body("defaultOutput").optional(),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const engine = getEngine(req);
      const instanceId = req.params.id as string;
      const nodeId = req.params.nodeId as string;
      const defaultOutput = req.body.defaultOutput;

      // Skip the node
      await engine.skipNode(instanceId, nodeId, defaultOutput);

      return sendSuccess(
        res,
        200,
        {
          instanceId,
          nodeId,
          defaultOutput,
        },
        `Node ${nodeId} in instance ${instanceId} skipped successfully`,
      );
    } catch (error: unknown) {
      Logger.error(
        "api",
        "instances",
        `Error skipping node ${req.params.nodeId} in instance ${req.params.id}: ${errorMessage(error)}`,
        errorStack(error),
      );

      // Return 400 for invalid state errors
      const statusCode =
        errorMessage(error)?.includes("already completed") ||
        errorMessage(error)?.includes("not found")
          ? 400
          : 500;

      return sendError(
        res,
        statusCode,
        statusCode,
        errorMessage(error) || "Failed to skip node",
      );
    }
  },
);

// Trigger compensation
router.post(
  "/:id/compensate",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  body("reason").optional().isString().withMessage("reason must be a string"),
  body("fromNode")
    .optional()
    .isString()
    .withMessage("fromNode must be a string"),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const engine = getEngine(req);
      const instanceId = req.params.id as string;
      const reason = req.body.reason;

      // Trigger compensation
      await engine.compensate(instanceId, reason);

      return sendSuccess(
        res,
        200,
        {
          instanceId,
          reason,
        },
        `Compensation triggered for instance ${instanceId}`,
      );
    } catch (error: unknown) {
      Logger.error(
        "api",
        "instances",
        `Error triggering compensation for instance ${req.params.id}: ${errorMessage(error)}`,
        errorStack(error),
      );

      // Return 400 for invalid state errors
      const statusCode = errorMessage(error)?.includes("not found") ? 400 : 500;

      return sendError(
        res,
        statusCode,
        statusCode,
        errorMessage(error) || "Failed to trigger compensation",
      );
    }
  },
);

// Get node status
router.get(
  "/:id/nodes/:nodeId/status",
  param("id").isString().notEmpty().withMessage("Instance ID is required"),
  param("nodeId").isString().notEmpty().withMessage("Node ID is required"),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return sendError(res, 400, 400, errors.array()[0].msg);
    }

    try {
      const engine = getEngine(req);
      const storage = getStorage(req, engine);
      const instanceId = req.params.id as string;
      const nodeId = req.params.nodeId as string;

      // Get instance
      const instance = await loadInstance(engine, storage, instanceId);

      if (!instance) {
        return sendError(
          res,
          404,
          404,
          `Instance with ID ${instanceId} not found`,
        );
      }

      // Find node execution history
      const nodeHistory = instance.history.filter(
        (log) => log.nodeId === nodeId,
      );

      if (nodeHistory.length === 0) {
        return sendError(
          res,
          404,
          404,
          `Node ${nodeId} not found in instance ${instanceId}`,
        );
      }

      // Get the latest execution
      const lastExecution = nodeHistory[nodeHistory.length - 1];

      // Determine node status
      let status: "pending" | "running" | "completed" | "failed" | "skipped";
      if (lastExecution.status === "success") {
        status = "completed";
      } else if (lastExecution.status === "failed") {
        status = "failed";
      } else if (lastExecution.status === "skipped") {
        status = "skipped";
      } else if (instance.currentNodes?.includes(nodeId)) {
        status = "running";
      } else {
        status = "pending";
      }

      // Calculate duration if available
      let duration: number | undefined;
      if (lastExecution.duration !== undefined) {
        duration = lastExecution.duration;
      }

      // Get retry count
      const retryCount = instance.retries?.[nodeId] || 0;

      // Get node output from state
      const output = instance.state?.nodes?.[nodeId]?.output;

      // Build node status response
      const nodeStatus = {
        nodeId,
        status,
        startTime: toEpochMs(lastExecution.timestamp),
        endTime: toEpochMs(lastExecution.timestamp) + (duration || 0),
        duration,
        retryCount,
        error:
          lastExecution.status === "failed"
            ? {
                message: lastExecution.error || "Unknown error",
                stack: lastExecution.stack,
                timestamp: toEpochMs(lastExecution.timestamp),
              }
            : undefined,
        output,
      };

      return sendSuccess(res, 200, nodeStatus, "Node status retrieved");
    } catch (error: unknown) {
      Logger.error(
        "api",
        "instances",
        `Error getting node status for ${req.params.nodeId} in instance ${req.params.id}: ${errorMessage(error)}`,
        errorStack(error),
      );

      return sendError(
        res,
        500,
        500,
        errorMessage(error) || "Failed to get node status",
      );
    }
  },
);

export default router;
