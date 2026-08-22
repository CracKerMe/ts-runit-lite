import type { Request, Router } from "express";
import { param, query, validationResult } from "express-validator";

import { getVariableSuggestions } from "../../../model/WorkflowVariables";
import { sendError, sendSuccess } from "../../response";
import { WorkflowApplicationService } from "../../services/WorkflowApplicationService";
import { getRequestStorage } from "../../utils/requestContext";
import { asyncHandler } from "../../utils/routeHelper";

let _cachedService: WorkflowApplicationService | null = null;
function getService(req: Request): WorkflowApplicationService {
  const storage = getRequestStorage(req) ?? null;
  if (!_cachedService || storage !== null) {
    _cachedService = new WorkflowApplicationService(storage);
  }
  return _cachedService;
}

/**
 * GET /workflows/:id/variables — `${...}` expression autocomplete
 * candidates: `${context.*}` from the workflow's declared inputSchema, and
 * `${nodeId.output(.*)}` for every node (or only ancestors of `?before=`,
 * when a specific node is being edited). Complements GET /functions, which
 * covers the built-in function half of expression autocomplete.
 */
export function registerVariableRoutes(router: Router): void {
  router.get(
    "/:id/variables",
    param("id").isString().notEmpty().withMessage("Workflow ID is required"),
    query("before")
      .optional()
      .isString()
      .withMessage("before must be a node ID string"),
    asyncHandler(async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        sendError(res, 400, 400, errors.array()[0].msg);
        return;
      }

      const service = getService(req);
      const workflow = await service.getWorkflow(req.params.id);
      const before =
        typeof req.query.before === "string" ? req.query.before : undefined;
      const variables = getVariableSuggestions(workflow.definition, {
        before,
      });
      sendSuccess(res, 200, { variables }, "Variable suggestions retrieved");
    }),
  );
}
