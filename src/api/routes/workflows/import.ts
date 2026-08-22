// oxlint-disable no-explicit-any -- workflow route handlers use dynamic types
import type { Request, Router } from "express";
import { body, param, query, validationResult } from "express-validator";

import type { WorkflowDefinition } from "../../../model/Workflow";
import type {
  StoredWorkflow,
  StoredWorkflowVersion,
} from "../../../storage/StorageProvider";
import { Logger } from "../../../utils/Logger";
import { sendError, sendSuccess } from "../../response";
import { WorkflowApplicationService } from "../../services/WorkflowApplicationService";
import {
  getRequestEngine,
  getRequestStorage,
  requireRequestEngine,
} from "../../utils/requestContext";
import { asyncHandler } from "../../utils/routeHelper";
import {
  persistImportedWorkflow,
  schemaValidator,
  templateRegistry,
  type WorkflowRegistrationEngine,
  workflowSchema,
} from "./shared";

// --- Service factory (creates per-request or uses cached instance) ---
let _cachedService: WorkflowApplicationService | null = null;
function getService(req: Request): WorkflowApplicationService {
  const storage = getRequestStorage(req) ?? null;
  if (!_cachedService || storage !== null) {
    _cachedService = new WorkflowApplicationService(storage);
  }
  return _cachedService;
}

export function registerImportRoutes(router: Router): void {
  router.post(
    "/import/dsl",
    body("dsl").isString().notEmpty().withMessage("DSL content is required"),
    body("name").optional().isString().withMessage("Name must be a string"),
    body("description")
      .optional()
      .isString()
      .withMessage("Description must be a string"),
    body("tags").optional().isArray().withMessage("Tags must be an array"),
    body("overwrite")
      .optional()
      .isBoolean()
      .withMessage("overwrite must be boolean"),
    asyncHandler(async (req, res) => {
      const service = getService(req);
      const { dsl, name, description, tags, overwrite } = req.body;

      const result = await service.importDsl({
        dsl,
        name,
        description,
        tags,
        overwrite,
      });

      // Register with engine if available
      const engine = getRequestEngine(req) as
        | {
            register?: (
              def: WorkflowDefinition,
              opts?: { version?: string; setActive?: boolean },
            ) => Promise<void>;
          }
        | undefined;
      if (engine && typeof engine.register === "function") {
        await engine.register(result.definition, {
          version: result.version.toString(),
          setActive: result.publishedVersion === result.version,
        });
      }

      res.status(201).json({
        success: true,
        data: { workflow: result, source: "dsl" },
        message: "Workflow imported from DSL",
      });
    }),
  );

  router.post(
    "/import/template",
    body("templateId")
      .isString()
      .notEmpty()
      .withMessage("templateId is required"),
    body("name").isString().notEmpty().withMessage("Name is required"),
    body("parameters")
      .optional()
      .isObject()
      .withMessage("parameters must be an object"),
    body("description")
      .optional()
      .isString()
      .withMessage("Description must be a string"),
    body("tags").optional().isArray().withMessage("Tags must be an array"),
    body("overwrite")
      .optional()
      .isBoolean()
      .withMessage("overwrite must be boolean"),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 400, 400, errors.array()[0].msg);
      }

      try {
        const storage = getRequestStorage(req);
        const engine = getRequestEngine(req) as
          | WorkflowRegistrationEngine
          | undefined;
        const { templateId, name, parameters, description, tags, overwrite } =
          req.body as {
            templateId: string;
            name: string;
            parameters?: Record<string, unknown>;
            description?: string;
            tags?: string[];
            overwrite?: boolean;
          };

        if (!storage) {
          return sendError(
            res,
            500,
            500,
            "Workflow template import not supported",
          );
        }

        const workflowDefinition = templateRegistry.instantiate({
          templateId,
          name,
          parameters: parameters ?? {},
        });
        if (description) {
          workflowDefinition.description = description;
        }

        const validation = schemaValidator.validate(workflowDefinition);
        if (!validation.valid) {
          return sendError(
            res,
            400,
            400,
            "Workflow definition validation failed",
            {
              errors: validation.errors,
              warnings: validation.warnings,
            },
          );
        }

        const storedWorkflow = await persistImportedWorkflow(
          storage,
          workflowDefinition,
          {
            description: workflowDefinition.description,
            tags,
            overwrite,
          },
        );
        if (storedWorkflow === "conflict") {
          return sendError(
            res,
            409,
            409,
            `Workflow with ID ${workflowDefinition.id} already exists`,
          );
        }

        if (engine && typeof engine.register === "function") {
          await engine.register(storedWorkflow.definition, {
            version: storedWorkflow.version.toString(),
            setActive:
              storedWorkflow.publishedVersion === storedWorkflow.version,
          });
        }

        return sendSuccess(
          res,
          201,
          {
            workflow: storedWorkflow,
            source: "template",
            templateId,
          },
          "Workflow imported from template",
        );
      } catch (error: any) {
        Logger.error(
          "api",
          "workflows",
          `Error importing workflow from template: ${error?.message}`,
          error?.stack,
        );

        return sendError(
          res,
          400,
          400,
          error?.message || "Failed to import workflow from template",
        );
      }
    },
  );

  router.post(
    "/import",
    body("definition")
      .isObject()
      .withMessage("Workflow definition is required"),
    body("name").optional().isString().withMessage("Name must be a string"),
    body("description")
      .optional()
      .isString()
      .withMessage("Description must be a string"),
    body("tags").optional().isArray().withMessage("Tags must be an array"),
    body("overwrite")
      .optional()
      .isBoolean()
      .withMessage("overwrite must be boolean"),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 400, 400, errors.array()[0].msg);
      }

      try {
        const storage = getRequestStorage(req);
        const { definition, name, description, tags, overwrite } = req.body;
        const workflowDefinition = definition as WorkflowDefinition;
        const workflowId = workflowDefinition.id;
        const workflowName = name ?? workflowDefinition.name;

        if (!workflowId || !workflowName) {
          return sendError(res, 400, 400, "Workflow id and name are required");
        }

        const validationResult = schemaValidator.validate(workflowDefinition);
        if (!validationResult.valid) {
          return sendError(
            res,
            400,
            400,
            "Workflow definition validation failed",
            {
              errors: validationResult.errors,
              warnings: validationResult.warnings,
            },
          );
        }

        if (!storage) {
          return sendError(res, 500, 500, "Workflow import not supported");
        }

        const existing = await storage.loadWorkflowWithMetadata(workflowId);
        const now = Date.now();

        if (existing && !overwrite) {
          return sendError(
            res,
            409,
            409,
            `Workflow with ID ${workflowId} already exists`,
          );
        }

        const nextVersion = existing ? existing.version + 1 : 1;
        const storedWorkflow: StoredWorkflow = {
          id: workflowId,
          name: workflowName,
          description: description ?? existing?.description,
          definition: workflowDefinition,
          version: nextVersion,
          publishedVersion: existing?.publishedVersion ?? nextVersion,
          lockedVersion: existing?.lockedVersion,
          releasePolicy: existing?.releasePolicy,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          tags: tags ?? existing?.tags,
        };

        await storage.saveWorkflowWithMetadata(storedWorkflow);
        const workflowVersion: StoredWorkflowVersion = {
          id: storedWorkflow.id,
          name: storedWorkflow.name,
          description: storedWorkflow.description,
          definition: storedWorkflow.definition,
          version: storedWorkflow.version,
          createdAt: now,
          tags: storedWorkflow.tags,
          metadata: storedWorkflow.definition.metadata,
        };
        await storage.saveWorkflowVersion(workflowVersion);

        const engine = getRequestEngine(req) as
          | WorkflowRegistrationEngine
          | undefined;
        if (engine && typeof engine.register === "function") {
          await engine.register(storedWorkflow.definition, {
            version: storedWorkflow.version.toString(),
            setActive:
              storedWorkflow.publishedVersion === storedWorkflow.version,
          });
        }

        return sendSuccess(res, 201, storedWorkflow, "Workflow imported");
      } catch (error: any) {
        Logger.error(
          "api",
          "workflows",
          `Error importing workflow: ${error?.message}`,
          error?.stack,
        );

        return sendError(
          res,
          500,
          500,
          error?.message || "Failed to import workflow",
        );
      }
    },
  );

  router.get(
    "/:id/export",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    query("version")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Version must be a positive integer"),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 400, 400, errors.array()[0].msg);
      }

      try {
        const storage = getRequestStorage(req);
        const workflowId = req.params?.id;
        const versionValue = req.query?.version as string | undefined;

        if (storage) {
          const versionNumber = versionValue
            ? Number.parseInt(versionValue, 10)
            : undefined;
          const workflow =
            versionNumber !== undefined
              ? await storage.loadWorkflowVersion(workflowId, versionNumber)
              : await storage.loadWorkflowWithMetadata(workflowId);
          if (!workflow) {
            return sendError(
              res,
              404,
              404,
              `Workflow with ID ${workflowId} not found`,
            );
          }
          const definition =
            "definition" in workflow ? workflow.definition : workflow;
          const resolvedVersion =
            "version" in workflow ? workflow.version : versionNumber;
          return sendSuccess(
            res,
            200,
            {
              workflowId,
              version: resolvedVersion,
              definition,
              schema: workflowSchema,
            },
            "Workflow exported",
          );
        }

        const engine = requireRequestEngine(req);
        const workflow =
          typeof engine.getWorkflow === "function"
            ? engine.getWorkflow(workflowId, versionValue)
            : undefined;
        if (!workflow) {
          return sendError(
            res,
            404,
            404,
            `Workflow with ID ${workflowId} not found`,
          );
        }
        return sendSuccess(
          res,
          200,
          {
            workflowId,
            version: workflow.version,
            definition: workflow,
            schema: workflowSchema,
          },
          "Workflow exported",
        );
      } catch (error: any) {
        Logger.error(
          "api",
          "workflows",
          `Error exporting workflow ${req.params?.id}: ${error?.message}`,
          error?.stack,
        );

        return sendError(
          res,
          500,
          500,
          error?.message || "Failed to export workflow",
        );
      }
    },
  );
}
