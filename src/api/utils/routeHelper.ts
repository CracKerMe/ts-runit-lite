/**
 * Route helpers — standardized error handling and Service integration for Express routes.
 *
 * Usage:
 *   router.get("/", asyncHandler(async (req, res) => {
 *     const service = getService(req);
 *     const result = await service.listWorkflows();
 *     res.json(successResponse(result));
 *   }));
 */
import type { Request, Response } from "express";
import { validationResult } from "express-validator";
import { ServiceError } from "../services/WorkflowApplicationService";

/**
 * Wrap an async route handler with consistent error handling.
 * Catches ServiceError and maps to appropriate HTTP status codes.
 */
export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => void {
  return (req, res) => {
    fn(req, res).catch((error: unknown) => {
      if (error instanceof ServiceError) {
        const body: Record<string, unknown> = {
          success: false,
          error: error.code,
          message: error.message,
        };
        if (error.details !== undefined) {
          body.details = error.details;
        }
        res.status(error.statusCode).json(body);
        return;
      }

      const message =
        error instanceof Error ? error.message : "Internal server error";

      res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message,
      });
    });
  };
}

/**
 * Build a success response body.
 */
export function successResponse<T>(
  data: T,
  message?: string,
): { success: true; data: T; message?: string } {
  return { success: true as const, data, ...(message ? { message } : {}) };
}

/**
 * Build a paginated success response body.
 */
export function paginatedResponse<T>(
  data: T[],
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  },
  message?: string,
): {
  success: true;
  data: { items: T[]; pagination: typeof pagination };
  message?: string;
} {
  return {
    success: true as const,
    data: { items: data, pagination },
    ...(message ? { message } : {}),
  };
}

/**
 * Validate request using express-validator and send error if invalid.
 * Returns true if valid, false if error was sent.
 */
export function validateOrSendError(req: Request, res: Response): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: errors.array()[0].msg,
    });
    return false;
  }
  return true;
}

/**
 * Parse pagination params from query string.
 */
export function parsePagination(req: Request): {
  page: number;
  pageSize: number;
} {
  const page = Math.max(
    1,
    Number.parseInt((req.query?.page as string) || "1", 10) || 1,
  );
  const pageSize = Math.min(
    100,
    Math.max(
      1,
      Number.parseInt((req.query?.pageSize as string) || "50", 10) || 50,
    ),
  );
  return { page, pageSize };
}
