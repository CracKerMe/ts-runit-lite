/**
 * API routes for expression function management.
 *
 * GET    /workflow-api/v1/functions          — list all available functions
 * POST   /workflow-api/v1/functions          — register a custom function
 * DELETE /workflow-api/v1/functions/:name    — unregister a custom function
 */
import { Router } from "express";
import { getFunctionCatalog } from "../../engine/functions/index";
import {
  getCustomFunction,
  listCustomFunctions,
  registerCustomFunction,
  unregisterCustomFunction,
} from "../../engine/functions/customFunctions";
import { sendError, sendSuccess } from "../response";

const router: Router = Router();

/**
 * GET /functions
 * Returns the full catalogue of built-in and custom functions.
 */
router.get("/", (_req, res) => {
  try {
    const builtin = getFunctionCatalog();
    const custom = listCustomFunctions().map((f) => ({
      name: f.name,
      category: "custom",
      description: f.description,
      args: f.params,
      expression: f.expression,
    }));

    sendSuccess(res, 200, {
      builtin,
      custom,
      total: builtin.length + custom.length,
    });
  } catch (err: unknown) {
    sendError(
      res,
      500,
      "FUNCTIONS_LIST_ERROR",
      err instanceof Error
        ? err instanceof Error
          ? err.message
          : String(err)
        : String(err),
    );
  }
});

/**
 * POST /functions
 * Register a custom function.
 * Body: { name: string, expression: string, params: string[], description?: string }
 */
router.post("/", (req, res) => {
  try {
    const { name, expression, params, description } = req.body ?? {};

    if (!name || typeof name !== "string") {
      sendError(
        res,
        400,
        "INVALID_NAME",
        "name is required and must be a string",
      );
      return;
    }
    if (!expression || typeof expression !== "string") {
      sendError(
        res,
        400,
        "INVALID_EXPRESSION",
        "expression is required and must be a string",
      );
      return;
    }
    if (!Array.isArray(params)) {
      sendError(
        res,
        400,
        "INVALID_PARAMS",
        "params must be an array of parameter names",
      );
      return;
    }

    // Check if name collides with an existing custom function
    const existing = getCustomFunction(name);
    const force = req.query.force === "true";

    if (existing && !force) {
      sendError(
        res,
        409,
        "ALREADY_EXISTS",
        `Custom function "${name}" already registered. Use ?force=true to override.`,
      );
      return;
    }

    registerCustomFunction(name, expression, params, description ?? "", force);

    sendSuccess(res, 201, getCustomFunction(name), "Function registered");
  } catch (err: unknown) {
    sendError(
      res,
      500,
      "FUNCTION_REGISTER_ERROR",
      err instanceof Error
        ? err instanceof Error
          ? err.message
          : String(err)
        : String(err),
    );
  }
});

/**
 * DELETE /functions/:name
 * Unregister a custom function.
 */
router.delete("/:name", (req, res) => {
  try {
    const { name } = req.params;

    if (!name) {
      sendError(res, 400, "INVALID_NAME", "name parameter is required");
      return;
    }

    const removed = unregisterCustomFunction(name);

    if (!removed) {
      sendError(res, 404, "NOT_FOUND", `Custom function "${name}" not found`);
      return;
    }

    sendSuccess(res, 200, { name, removed: true }, "Function unregistered");
  } catch (err: unknown) {
    sendError(
      res,
      500,
      "FUNCTION_DELETE_ERROR",
      err instanceof Error
        ? err instanceof Error
          ? err.message
          : String(err)
        : String(err),
    );
  }
});

export default router;
