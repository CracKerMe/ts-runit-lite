// oxlint-disable no-explicit-any -- workflow route handlers use dynamic types
import type { Request, Response, Router } from "express";
import { body, param, validationResult } from "express-validator";

import { DataValidationError } from "../../../engine/DataValidator";
import { Logger } from "../../../utils/Logger";
import { sendError, sendSuccess } from "../../response";
import type { StartWorkflowDto } from "../../types";
import {
  hashRequestBody,
  IdempotencyStore,
} from "../../utils/IdempotencyStore";
import {
  getRequestStorage,
  requireRequestEngine,
} from "../../utils/requestContext";
import type { WorkflowDryRunEngine, WorkflowWithListInstances } from "./shared";
import { schemaValidator, toWorkflowDefinition } from "./shared";

export function registerExecutionRoutes(router: Router): void {
  // 验证工作流定义
  router.post(
    "/:id/validate",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    body("definition")
      .isObject()
      .withMessage("Workflow definition is required"),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 400, 400, errors.array()[0].msg);
      }

      try {
        const { definition } = req.body;

        // Validate workflow definition
        const validationResult = schemaValidator.validate(
          toWorkflowDefinition(definition),
        );

        return sendSuccess(
          res,
          200,
          {
            valid: validationResult.valid,
            errors: validationResult.errors,
            warnings: validationResult.warnings,
          },
          "Workflow validated",
        );
      } catch (error: any) {
        Logger.error(
          "api",
          "workflows",
          `Error validating workflow: ${error?.message}`,
          error?.stack,
        );

        return sendError(
          res,
          500,
          500,
          error?.message || "Failed to validate workflow",
        );
      }
    },
  );

  router.post(
    "/:id/dry-run",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    body("context")
      .optional()
      .isObject()
      .withMessage("Context must be an object"),
    body("options")
      .optional()
      .isObject()
      .withMessage("Options must be an object"),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 400, 400, errors.array()[0].msg);
      }

      try {
        const engine = requireRequestEngine(req) as WorkflowDryRunEngine;
        const storage = getRequestStorage(req);
        const workflowId = req.params?.id;
        const { context = {}, options = {} } = req.body || {};
        let resolvedWorkflowId = workflowId;

        if (!engine || typeof engine.dryRun !== "function") {
          return sendError(res, 500, 500, "Dry run not supported");
        }

        if (typeof engine.getWorkflow === "function") {
          const existingWorkflow = engine.getWorkflow(workflowId);
          if (!existingWorkflow && storage) {
            const storedWorkflow =
              await storage.loadWorkflowWithMetadata(workflowId);
            if (
              storedWorkflow?.definition &&
              typeof engine.register === "function"
            ) {
              await engine.register(storedWorkflow.definition, {
                version: String(storedWorkflow.version || "1"),
                setActive: true,
              });

              resolvedWorkflowId =
                storedWorkflow.definition.id || storedWorkflow.id || workflowId;
            }
          }
        }

        if (typeof engine.getWorkflow === "function") {
          const canRun =
            engine.getWorkflow(resolvedWorkflowId) ||
            (resolvedWorkflowId !== workflowId
              ? engine.getWorkflow(workflowId)
              : undefined);
          if (!canRun) {
            return sendError(
              res,
              404,
              404,
              `Workflow ${workflowId} not found for dry run`,
            );
          }
        }

        const result = await engine.dryRun(
          resolvedWorkflowId,
          context,
          options,
        );
        return sendSuccess(res, 200, result, "Workflow dry run completed");
      } catch (error: any) {
        Logger.error(
          "api",
          "workflows",
          `Error running workflow dry run ${req.params?.id}: ${error?.message}`,
          error?.stack,
        );

        return sendError(
          res,
          500,
          500,
          error?.message || "Failed to execute dry run",
        );
      }
    },
  );

  // 启动工作流
  router.post(
    "/:id/start",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    body().custom((value) => {
      // 允许空对象或包含 context 字段的对象
      if (Object.keys(value).length === 0) return true;
      if (value.context && typeof value.context === "object") return true;
      if (value.version && typeof value.version === "string") return true;
      throw new Error(
        "Request body should be empty or contain a context object",
      );
    }),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 400, 400, errors.array()[0].msg);
      }

      try {
        const engine = requireRequestEngine(req);
        const { context = {}, version } = req.body as StartWorkflowDto;

        const idempotencyKey = req.get("Idempotency-Key");
        if (idempotencyKey) {
          const store = new IdempotencyStore();
          const bodyHash = hashRequestBody(req.body ?? {});
          const reserve = await store.reserve(
            `workflow-start:${req.params?.id}`,
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
              "Workflow already started",
            );
          }

          try {
            const instanceId = await engine.start(req.params?.id, context, {
              version,
            });
            const result = { instanceId };
            await store.complete(
              `workflow-start:${req.params?.id}`,
              idempotencyKey,
              bodyHash,
              result,
            );
            return sendSuccess(res, 201, result, "Workflow started");
          } catch (error: any) {
            await store.fail(
              `workflow-start:${req.params?.id}`,
              idempotencyKey,
            );
            throw error;
          }
        }

        const instanceId = await engine.start(req.params?.id, context, {
          version,
        });

        return sendSuccess(res, 201, { instanceId }, "Workflow started");
      } catch (error: any) {
        if (error instanceof DataValidationError) {
          return sendError(res, 400, 400, "Input validation failed", {
            details: error.issues,
          });
        }
        Logger.error(
          "api",
          "workflows",
          `Error starting workflow ${req.params?.id}: ${error?.message}`,
          error?.stack,
        );
        return sendError(
          res,
          500,
          500,
          error?.message || "Failed to start workflow",
        );
      }
    },
  );

  // 获取工作流实例
  router.get(
    "/:id/instances",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 400, 400, errors.array()[0].msg);
      }

      try {
        const engine = requireRequestEngine(req) as WorkflowWithListInstances;
        const workflowId = req.params?.id as string;
        const listInstancesByWorkflow = engine.listInstancesByWorkflow;

        let instances: unknown[] = [];
        if (typeof listInstancesByWorkflow === "function") {
          instances = await listInstancesByWorkflow.call(engine, workflowId);
        } else {
          const storage = getRequestStorage(req);
          if (storage?.queryInstances) {
            const result = await storage.queryInstances({
              workflowId,
              page: 1,
              pageSize: 100,
            });
            instances = result.instances;
          } else {
            return sendError(
              res,
              501,
              501,
              "listInstancesByWorkflow is not supported by the current engine and storage is not available",
            );
          }
        }

        return sendSuccess(res, 200, instances, "Workflow instances retrieved");
      } catch (error: any) {
        Logger.error(
          "api",
          "workflows",
          `Error getting instances for workflow ${req.params?.id}: ${
            error?.message
          }`,
          error?.stack,
        );
        return sendError(
          res,
          500,
          500,
          error?.message || "Failed to retrieve workflow instances",
        );
      }
    },
  );

  // POST /workflows/:id/test/generate - Generate test cases for a workflow
  router.post("/:id/test/generate", async (req: Request, res: Response) => {
    const engine = requireRequestEngine(req);

    try {
      const workflowId = req.params.id;

      // Get workflow definition
      let workflow = null;
      if (engine.getWorkflow) {
        workflow = await engine.getWorkflow(workflowId);
      }

      if (!workflow) {
        return sendError(res, 404, "WORKFLOW_NOT_FOUND", "Workflow not found");
      }

      // Import test generator
      const { TestGenerator } = await import("../../../testing/TestGenerator");
      const generator = new TestGenerator();

      const { types } = req.body || {};

      // Generate tests
      let tests = await generator.generateFromWorkflow(workflow);

      // Filter by requested types if specified
      if (types && Array.isArray(types)) {
        tests = tests.filter((t: { testType?: string }) =>
          types.includes(t.testType),
        );
      }

      return sendSuccess(
        res,
        200,
        {
          workflowId,
          testsGenerated: tests.length,
          tests,
        },
        "Test cases generated successfully",
      );
    } catch (error: any) {
      Logger.error(
        "api",
        "workflows",
        `Error generating tests for workflow ${req.params.id}: ${error?.message}`,
        error?.stack,
      );
      return sendError(
        res,
        500,
        500,
        error?.message || "Failed to generate test cases",
      );
    }
  });
}
