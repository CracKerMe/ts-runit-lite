import type { NextFunction, Request, Response } from "express";
import { Logger } from "../utils/Logger";
import { createErrorResponse } from "./response";

/**
 * 错误码枚举
 * 使用三位数字格式：
 * - 1xx: 系统相关错误
 * - 2xx: 工作流相关错误
 * - 3xx: API相关错误
 * - 4xx: 存储相关错误
 * - 5xx: Webhook相关错误
 */
export enum ErrorCode {
  // 系统错误 (1xx)
  UNKNOWN_ERROR = 100,
  INTERNAL_SERVER_ERROR = 101,
  CONFIGURATION_ERROR = 102,
  SERVICE_UNAVAILABLE = 103,

  // 工作流错误 (2xx)
  WORKFLOW_NOT_FOUND = 201,
  INVALID_WORKFLOW_DEFINITION = 202,
  WORKFLOW_EXECUTION_ERROR = 203,
  WORKFLOW_TIMEOUT = 204,
  INSTANCE_NOT_FOUND = 205,
  INVALID_STATE_TRANSITION = 206,

  // API错误 (3xx)
  INVALID_REQUEST = 301,
  INVALID_PARAMETERS = 302,
  MISSING_REQUIRED_PARAMETER = 303,
  RESOURCE_NOT_FOUND = 304,
  METHOD_NOT_ALLOWED = 305,
  RATE_LIMIT_EXCEEDED = 306,

  // 存储错误 (4xx)
  STORAGE_ERROR = 401,
  DATA_NOT_FOUND = 402,
  DATABASE_CONNECTION_ERROR = 403,
  SERIALIZATION_ERROR = 404,

  // Webhook错误 (5xx)
  WEBHOOK_REGISTRATION_FAILED = 501,
  WEBHOOK_DELIVERY_FAILED = 502,
  WEBHOOK_NOT_FOUND = 503,
  WEBHOOK_VALIDATION_FAILED = 504,
}

/**
 * 自定义API错误类
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly errorCode: ErrorCode;
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 500,
    errorCode: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.context = context;

    // 捕获堆栈信息
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * 将错误转换为响应对象
   */
  toResponse() {
    return createErrorResponse(this.errorCode, this.message, {
      code: this.errorCode,
      message: this.message,
      ...(this.context ? { context: this.context } : {}),
    });
  }

  /**
   * 创建Bad Request错误
   */
  static badRequest(
    message: string,
    errorCode: ErrorCode = ErrorCode.INVALID_REQUEST,
    context?: Record<string, unknown>,
  ) {
    return new ApiError(message, 400, errorCode, context);
  }

  /**
   * 创建Not Found错误
   */
  static notFound(
    message: string,
    errorCode: ErrorCode = ErrorCode.RESOURCE_NOT_FOUND,
    context?: Record<string, unknown>,
  ) {
    return new ApiError(message, 404, errorCode, context);
  }

  /**
   * 创建Unauthorized错误
   */
  static unauthorized(
    message = "未授权访问",
    context?: Record<string, unknown>,
  ) {
    return new ApiError(message, 401, ErrorCode.INVALID_REQUEST, context);
  }

  /**
   * 创建服务器错误
   */
  static serverError(
    message = "服务器内部错误",
    errorCode: ErrorCode = ErrorCode.INTERNAL_SERVER_ERROR,
    context?: Record<string, unknown>,
  ) {
    return new ApiError(message, 500, errorCode, context);
  }
}

/**
 * 全局错误处理中间件
 */
export function errorHandler(
  err: Error | ApiError,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const isApiError = err instanceof ApiError;

  // 获取错误详情
  const statusCode = isApiError ? err.statusCode : 500;
  const errorCode = isApiError ? err.errorCode : ErrorCode.UNKNOWN_ERROR;
  const message = isApiError
    ? err.message
    : process.env.NODE_ENV === "production"
      ? "服务器内部错误"
      : err.message || "未知错误";

  // 记录错误日志
  const logLevel = statusCode >= 500 ? "error" : "warn";
  Logger[logLevel](
    "api",
    "error",
    `[${req.method}] ${req.path} - ${statusCode} - Code: ${errorCode} - ${message}`,
  );

  if (statusCode >= 500) {
    Logger.error("api", "stack", err.stack || "无堆栈信息");
  }

  // 返回错误响应
  res.status(statusCode).json(
    createErrorResponse(errorCode, message, {
      code: errorCode,
      message,
      path: req.path,
      ...(isApiError && err.context ? { context: err.context } : {}),
    }),
  );
}

/**
 * 异步路由处理器包装函数
 * 用于自动捕获异步路由处理器中的错误
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 请求验证中间件
 */
interface RequestSchemaValidationError {
  details: Array<{ message: string }>;
}

interface RequestSchema {
  validate(value: unknown): { error?: RequestSchemaValidationError };
}

export function validateRequest(schema: RequestSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const { error } = schema.validate(req.body);
      if (error) {
        throw ApiError.badRequest(
          `请求数据验证失败: ${error.details.map((x) => x.message).join(", ")}`,
          ErrorCode.INVALID_PARAMETERS,
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
