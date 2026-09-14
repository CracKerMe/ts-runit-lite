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

/**
 * 统一的异步路由包装器。
 *
 * 这里曾有第二份 asyncHandler 实现：它从不调用 next(error)，而是自行拼装
 * 响应——把原始的 error.message 直接返回给客户端（生产环境也不例外，绕过
 * errorHandler 的脱敏），并且丢掉 ApiError.statusCode，使
 * `ApiError.notFound(...)` 变成 500。ServiceError 的 statusCode 映射已迁入
 * errorHandler，这里改为直接复用唯一正确的实现。
 */
export { asyncHandler } from "../ErrorHandler";

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
