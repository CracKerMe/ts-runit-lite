import type { Request, Router } from "express";
import { body, param, query, validationResult } from "express-validator";

import type { WorkflowDefinition } from "../../../model/Workflow";
import { rbacMiddleware } from "../../middleware/rbac";
import { sendError, sendSuccess } from "../../response";
import { WorkflowApplicationService } from "../../services/WorkflowApplicationService";
import {
  getRequestEngine,
  getRequestStorage,
} from "../../utils/requestContext";
import { asyncHandler } from "../../utils/routeHelper";
import { nodeTemplates, templateRegistry, workflowSchema } from "./shared";

// --- Service factory (creates per-request or uses cached instance) ---
let _cachedService: WorkflowApplicationService | null = null;
function getService(req: Request): WorkflowApplicationService {
  const storage = getRequestStorage(req) ?? null;
  if (!_cachedService || storage !== null) {
    _cachedService = new WorkflowApplicationService(storage);
  }
  return _cachedService;
}

export function registerCrudRoutes(router: Router): void {
  // 获取所有工作流（带分页）—— Service-based
  router.get(
    "/",
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("pageSize")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Page size must be between 1 and 100"),
    asyncHandler(async (req, res) => {
      const page = Number.parseInt((req.query?.page as string) || "1", 10) || 1;
      const pageSize =
        Number.parseInt((req.query?.pageSize as string) || "50", 10) || 50;

      const service = getService(req);
      const { workflows, total } = await service.listWorkflows();

      const start = (page - 1) * pageSize;
      const paginated = workflows.slice(start, start + pageSize);

      res.json({
        success: true,
        data: {
          workflows: paginated,
          pagination: {
            page,
            pageSize,
            totalCount: total,
            totalPages: Math.ceil(total / pageSize),
          },
        },
        message: "Workflows retrieved",
      });
    }),
  );

  // 创建工作流 —— Service-based
  router.post(
    "/",
    rbacMiddleware({ resource: "workflow", action: "write" }),
    body("id").isString().notEmpty().withMessage("Workflow ID is required"),
    body("name").isString().notEmpty().withMessage("Workflow name is required"),
    body("description")
      .optional()
      .isString()
      .withMessage("Description must be a string"),
    body("definition")
      .isObject()
      .withMessage("Workflow definition is required"),
    body("tags").optional().isArray().withMessage("Tags must be an array"),
    asyncHandler(async (req, res) => {
      const { id, name, description, definition, tags } = req.body;

      const service = getService(req);
      const stored = await service.createWorkflow({
        id,
        name,
        description,
        definition: definition as WorkflowDefinition,
        tags,
      });

      // Register with engine if available
      const engine = getRequestEngine(req) as
        | {
            register?: (
              def: WorkflowDefinition,
              opts?: { version?: string; setActive?: boolean },
            ) => Promise<void>;
            setReleasePolicy?: (id: string, policy: unknown) => void;
          }
        | undefined;
      if (engine && typeof engine.register === "function") {
        await engine.register(definition as WorkflowDefinition, {
          version: "1",
          setActive: true,
        });
        if (typeof engine.setReleasePolicy === "function") {
          engine.setReleasePolicy(id, { type: "stable" });
        }
      }

      res.status(201).json({
        success: true,
        data: stored,
        message: "Workflow created",
      });
    }),
  );

  router.get("/schema", (_req, res) => {
    return sendSuccess(res, 200, workflowSchema, "Workflow schema retrieved");
  });

  router.get("/node-templates", (_req, res) => {
    return sendSuccess(res, 200, nodeTemplates, "Node templates retrieved");
  });

  router.get(
    "/templates",
    query("category")
      .optional()
      .isString()
      .withMessage("Category must be a string"),
    (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 400, 400, errors.array()[0].msg);
      }

      const category =
        req.query && typeof req.query.category === "string"
          ? req.query.category
          : undefined;
      return sendSuccess(
        res,
        200,
        templateRegistry.list(category),
        "Workflow templates retrieved",
      );
    },
  );

  // 获取特定工作流 —— Service-based
  router.get(
    "/:id",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    asyncHandler(async (req, res) => {
      const service = getService(req);
      const workflow = await service.getWorkflow(req.params.id);
      res.json({
        success: true,
        data: workflow,
        message: "Workflow retrieved",
      });
    }),
  );

  // 更新工作流 —— Service-based
  router.put(
    "/:id",
    rbacMiddleware({ resource: "workflow", action: "write" }),
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    body("name").optional().isString().withMessage("Name must be a string"),
    body("description")
      .optional()
      .isString()
      .withMessage("Description must be a string"),
    body("definition")
      .optional()
      .isObject()
      .withMessage("Definition must be an object"),
    body("tags").optional().isArray().withMessage("Tags must be an array"),
    asyncHandler(async (req, res) => {
      const { name, description, definition, tags } = req.body;

      const service = getService(req);
      const updated = await service.updateWorkflow(req.params.id, {
        name,
        description,
        definition: definition as WorkflowDefinition | undefined,
        tags,
      });

      // Re-register with engine if definition changed
      if (definition) {
        const engine = getRequestEngine(req) as
          | {
              register?: (
                def: WorkflowDefinition,
                opts?: { version?: string; setActive?: boolean },
              ) => Promise<void>;
            }
          | undefined;
        if (engine && typeof engine.register === "function") {
          const version = updated.version.toString();
          await engine.register(definition as WorkflowDefinition, {
            version,
            setActive: updated.publishedVersion === updated.version,
          });
        }
      }

      res.json({
        success: true,
        data: updated,
        message: "Workflow updated",
      });
    }),
  );

  // 删除工作流 —— Service-based
  router.delete(
    "/:id",
    rbacMiddleware({ resource: "workflow", action: "delete" }),
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    asyncHandler(async (req, res) => {
      const service = getService(req);
      await service.deleteWorkflow(req.params.id);
      res.status(204).send();
    }),
  );
}
