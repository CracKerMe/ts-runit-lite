import type { Request, Router } from "express";
import { param, validationResult } from "express-validator";

import {
  fromGraph,
  toGraph,
  type WorkflowGraph,
} from "../../../model/WorkflowGraph";
import { rbacMiddleware } from "../../middleware/rbac";
import { sendError, sendSuccess } from "../../response";
import { WorkflowApplicationService } from "../../services/WorkflowApplicationService";
import {
  getRequestEngine,
  getRequestStorage,
} from "../../utils/requestContext";
import { asyncHandler } from "../../utils/routeHelper";

// Mirrors the service factory in crud.ts so /graph shares the same
// storage-backed WorkflowApplicationService instance per request.
let _cachedService: WorkflowApplicationService | null = null;
function getService(req: Request): WorkflowApplicationService {
  const storage = getRequestStorage(req) ?? null;
  if (!_cachedService || storage !== null) {
    _cachedService = new WorkflowApplicationService(storage);
  }
  return _cachedService;
}

/**
 * GET/PUT /workflows/:id/graph — a nodes[]/edges[] view of a workflow
 * definition, suitable for React Flow and similar canvas libraries, so a
 * frontend never has to reverse-engineer where each node type hides its
 * edges (next/failureNext/conditionalNext/defaultNext/rollbackTo, plus
 * type-specific config fields like trueBranch/routes[].target/body/
 * approvedTarget). See src/model/WorkflowGraph.ts for the conversion.
 */
export function registerGraphRoutes(router: Router): void {
  router.get(
    "/:id/graph",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    asyncHandler(async (req, res) => {
      const service = getService(req);
      const workflow = await service.getWorkflow(req.params.id);
      const graph = toGraph(workflow.definition);
      sendSuccess(res, 200, graph, "Workflow graph retrieved");
    }),
  );

  router.put(
    "/:id/graph",
    rbacMiddleware({ resource: "workflow", action: "write" }),
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    asyncHandler(async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        sendError(res, 400, 400, errors.array()[0].msg);
        return;
      }

      const graph = req.body as WorkflowGraph;
      if (
        !graph ||
        !Array.isArray(graph.nodes) ||
        !Array.isArray(graph.edges)
      ) {
        sendError(
          res,
          400,
          400,
          "Request body must be a graph with `nodes` and `edges` arrays",
        );
        return;
      }

      const definition = fromGraph({ ...graph, id: req.params.id });

      const service = getService(req);
      const updated = await service.updateWorkflow(req.params.id, {
        definition,
      });

      const engine = getRequestEngine(req) as
        | {
            register?: (
              def: typeof definition,
              opts?: { version?: string; setActive?: boolean },
            ) => Promise<void>;
          }
        | undefined;
      if (engine && typeof engine.register === "function") {
        await engine.register(definition, {
          version: updated.version.toString(),
          setActive: updated.publishedVersion === updated.version,
        });
      }

      sendSuccess(
        res,
        200,
        toGraph(updated.definition),
        "Workflow graph updated",
      );
    }),
  );
}
