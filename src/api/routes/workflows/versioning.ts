// oxlint-disable no-explicit-any -- workflow route handlers use dynamic types
import type { Request, Router } from "express";
import { body, param, validationResult } from "express-validator";

import type { StoredWorkflow } from "../../../storage/StorageProvider";
import { Logger } from "../../../utils/Logger";
import { sendError, sendSuccess } from "../../response";
import { WorkflowApplicationService } from "../../services/WorkflowApplicationService";
import {
  getRequestEngine,
  getRequestStorage,
  requireRequestEngine,
} from "../../utils/requestContext";
import { asyncHandler } from "../../utils/routeHelper";
import type { WorkflowVersioningEngine } from "./shared";

// --- Service factory (creates per-request or uses cached instance) ---
let _cachedService: WorkflowApplicationService | null = null;
function getService(req: Request): WorkflowApplicationService {
  const storage = getRequestStorage(req) ?? null;
  if (!_cachedService || storage !== null) {
    _cachedService = new WorkflowApplicationService(storage);
  }
  return _cachedService;
}

export function registerVersioningRoutes(router: Router): void {
  // 获取工作流版本列表 —— Service-based
  router.get(
    "/:id/versions",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    asyncHandler(async (req, res) => {
      const service = getService(req);
      const result = await service.listVersions(req.params.id);
      res.json({
        success: true,
        data: {
          workflowId: req.params.id,
          versions: result.versions,
          latestVersion:
            result.versions.length > 0
              ? result.versions[result.versions.length - 1]
              : undefined,
          publishedVersion: result.activeVersion,
          lockedVersion: result.lockedVersion,
        },
        message: "Workflow versions retrieved",
      });
    }),
  );

  // 获取指定工作流版本
  router.get(
    "/:id/versions/:version",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    param("version").isString().notEmpty().withMessage("Version is required"),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 400, 400, errors.array()[0].msg);
      }

      try {
        const storage = getRequestStorage(req);
        const workflowId = req.params?.id;
        const versionValue = req.params?.version;

        if (storage) {
          const versionNumber = Number.parseInt(versionValue, 10);
          if (!Number.isFinite(versionNumber)) {
            return sendError(res, 400, 400, "Version must be a number");
          }
          const stored = await storage.loadWorkflowVersion(
            workflowId,
            versionNumber,
          );
          if (!stored) {
            return sendError(
              res,
              404,
              404,
              `Workflow version ${versionValue} not found`,
            );
          }
          return sendSuccess(res, 200, stored, "Workflow version retrieved");
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
            `Workflow version ${versionValue} not found`,
          );
        }
        return sendSuccess(res, 200, workflow, "Workflow version retrieved");
      } catch (error: any) {
        Logger.error(
          "api",
          "workflows",
          `Error getting workflow version ${req.params?.id}: ${error?.message}`,
          error?.stack,
        );
        return sendError(
          res,
          500,
          500,
          error?.message || "Failed to retrieve workflow version",
        );
      }
    },
  );

  // 发布工作流版本 —— Service-based
  router.post(
    "/:id/publish",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    body("version")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Version must be a positive integer"),
    body("canary.percent")
      .optional()
      .isFloat({ min: 0, max: 100 })
      .withMessage("canary.percent must be between 0 and 100"),
    asyncHandler(async (req, res) => {
      const service = getService(req);
      const result = await service.publishWorkflow(req.params.id, {
        version: req.body?.version,
        canary: req.body?.canary?.percent
          ? {
              percent: req.body.canary.percent,
              rules: req.body.canary.rules,
            }
          : undefined,
      });

      // Update engine if available
      const engine = getRequestEngine(req) as
        | {
            setActiveWorkflowVersion?: (id: string, v: string) => void;
            setReleasePolicy?: (id: string, policy: unknown) => void;
            startCanaryRelease?: (
              id: string,
              version: number,
              percent: number,
              rules?: unknown,
            ) => Promise<void>;
          }
        | undefined;
      if (!req.body?.canary?.percent && engine?.setActiveWorkflowVersion) {
        engine.setActiveWorkflowVersion(
          req.params.id,
          String(result.publishedVersion),
        );
      }
      if (engine?.setReleasePolicy) {
        engine.setReleasePolicy(
          req.params.id,
          req.body?.canary?.percent
            ? { type: "canary", canaryPercent: req.body.canary.percent }
            : { type: "stable" },
        );
      }
      if (req.body?.canary?.percent && engine?.startCanaryRelease) {
        const targetVersion = req.body?.version ?? result.publishedVersion;
        await engine.startCanaryRelease(
          req.params.id,
          targetVersion,
          req.body.canary.percent,
          req.body.canary.rules,
        );
      }

      res.json({
        success: true,
        data: result,
        message: req.body?.canary?.percent
          ? "Workflow canary release started"
          : "Workflow version published",
      });
    }),
  );

  router.post(
    "/:id/publish/promote",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 400, 400, errors.array()[0].msg);
      }
      try {
        const engine = getRequestEngine(req) as
          | WorkflowVersioningEngine
          | undefined;
        const workflowId = req.params?.id as string;
        if (!engine?.promoteCanary) {
          return sendError(res, 500, 500, "Canary promotion not supported");
        }
        await engine.promoteCanary(workflowId);
        return sendSuccess(res, 200, { workflowId }, "Canary promoted");
      } catch (error: any) {
        return sendError(
          res,
          500,
          500,
          error?.message || "Failed to promote canary",
        );
      }
    },
  );

  router.get(
    "/:id/release-status",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 400, 400, errors.array()[0].msg);
      }
      try {
        const engine = getRequestEngine(req) as
          | WorkflowVersioningEngine
          | undefined;
        const workflowId = req.params?.id as string;
        if (engine?.getCanaryStatus) {
          const status = await engine.getCanaryStatus(workflowId);
          return sendSuccess(res, 200, status, "Release status retrieved");
        }
        const storage = getRequestStorage(req);
        const workflow = await storage?.loadWorkflowWithMetadata(workflowId);
        if (!workflow) {
          return sendError(res, 404, 404, "Workflow not found");
        }
        return sendSuccess(
          res,
          200,
          {
            publishedVersion: workflow.publishedVersion ?? workflow.version,
            canaryVersion: workflow.canaryVersion,
            canaryPercent: workflow.canaryPercent,
            canaryStartedAt: workflow.canaryStartedAt,
          },
          "Release status retrieved",
        );
      } catch (error: any) {
        return sendError(
          res,
          500,
          500,
          error?.message || "Failed to get release status",
        );
      }
    },
  );

  // 回滚工作流发布版本
  router.post(
    "/:id/rollback",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    body("toVersion")
      .optional()
      .isInt({ min: 1 })
      .withMessage("toVersion must be a positive integer"),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendError(res, 400, 400, errors.array()[0].msg);
      }

      try {
        const storage = getRequestStorage(req);
        const workflowId = req.params?.id;
        const toVersionInput = req.body?.toVersion as number | undefined;

        if (storage) {
          const workflow = await storage.loadWorkflowWithMetadata(workflowId);
          if (!workflow) {
            return sendError(
              res,
              404,
              404,
              `Workflow with ID ${workflowId} not found`,
            );
          }
          const versions = await storage.listWorkflowVersions(workflowId);
          const sorted = versions.slice().sort((a, b) => a - b);
          const currentPublished = workflow.publishedVersion;
          let targetVersion = toVersionInput;
          if (!targetVersion) {
            if (currentPublished) {
              const idx = sorted.indexOf(currentPublished);
              if (idx > 0) {
                targetVersion = sorted[idx - 1];
              }
            }
          }
          if (!targetVersion || !versions.includes(targetVersion)) {
            return sendError(
              res,
              404,
              404,
              "Rollback target version not found",
            );
          }
          const updated: StoredWorkflow = {
            ...workflow,
            publishedVersion: targetVersion,
            releasePolicy: { type: "stable" },
            updatedAt: Date.now(),
          };
          await storage.saveWorkflowWithMetadata(updated);
          const engine = getRequestEngine(req) as
            | WorkflowVersioningEngine
            | undefined;
          if (engine?.setActiveWorkflowVersion) {
            engine.setActiveWorkflowVersion(
              workflowId,
              targetVersion.toString(),
            );
          }
          if (engine?.setReleasePolicy) {
            engine.setReleasePolicy(workflowId, { type: "stable" });
          }
          return sendSuccess(res, 200, updated, "Workflow version rolled back");
        }

        return sendError(res, 500, 500, "Workflow rollback not supported");
      } catch (error: any) {
        Logger.error(
          "api",
          "workflows",
          `Error rolling back workflow ${req.params?.id}: ${error?.message}`,
          error?.stack,
        );
        return sendError(
          res,
          500,
          500,
          error?.message || "Failed to rollback workflow",
        );
      }
    },
  );

  // 锁定工作流版本 —— Service-based
  router.post(
    "/:id/lock",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    body("version")
      .isInt({ min: 1 })
      .withMessage("Version must be a positive integer"),
    asyncHandler(async (req, res) => {
      const service = getService(req);
      const result = await service.lockWorkflow(
        req.params.id,
        Number.parseInt(req.body.version, 10),
      );

      // Update engine if available
      const engine = getRequestEngine(req) as
        | { setLockedWorkflowVersion?: (id: string, v: string) => void }
        | undefined;
      if (engine?.setLockedWorkflowVersion) {
        engine.setLockedWorkflowVersion(
          req.params.id,
          String(result.lockedVersion),
        );
      }

      res.json({
        success: true,
        data: result,
        message: "Workflow version locked",
      });
    }),
  );

  // 解锁工作流版本 —— Service-based
  router.delete(
    "/:id/lock",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    asyncHandler(async (req, res) => {
      const service = getService(req);
      const result = await service.unlockWorkflow(req.params.id);

      // Update engine if available
      const engine = getRequestEngine(req) as
        | { clearLockedWorkflowVersion?: (id: string) => void }
        | undefined;
      if (engine?.clearLockedWorkflowVersion) {
        engine.clearLockedWorkflowVersion(req.params.id);
      }

      res.json({
        success: true,
        data: result,
        message: "Workflow version unlocked",
      });
    }),
  );
}
