import type { Response } from "express";

export const API_SUCCESS_CODE = 0;

type UnknownRecord = Record<string, unknown>;

export interface StandardSuccessResponse<T = unknown> {
  code: number | string;
  message: string;
  data: T;
  timestamp: string;
}

export interface StandardErrorResponse {
  code: number | string;
  message: string;
  error?: unknown;
  timestamp: string;
}

function isObject(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object";
}

function asObject(value: unknown): UnknownRecord | undefined {
  return isObject(value) ? value : undefined;
}

export function isSuccessfulApiBody(body: unknown): body is UnknownRecord {
  const objectBody = asObject(body);
  if (!objectBody) {
    return false;
  }

  if (objectBody.success === true) {
    return true;
  }

  return objectBody.code === API_SUCCESS_CODE || objectBody.code === "0";
}

function getTimestamp(candidate?: unknown): string {
  return typeof candidate === "string" ? candidate : new Date().toISOString();
}

function normalizeLegacyError(error: unknown): unknown {
  if (typeof error === "string") {
    return { message: error };
  }
  return error;
}

export function createSuccessResponse<T>(
  data: T,
  message = "OK",
  code: number | string = API_SUCCESS_CODE,
  timestamp = new Date().toISOString(),
): StandardSuccessResponse<T> {
  return {
    code,
    message,
    data,
    timestamp,
  };
}

export function createErrorResponse(
  code: number | string,
  message: string,
  error?: unknown,
  timestamp = new Date().toISOString(),
): StandardErrorResponse {
  return {
    code,
    message,
    ...(error !== undefined ? { error } : {}),
    timestamp,
  };
}

export function sendSuccess<T>(
  res: Response,
  statusCode: number,
  data: T,
  message = "OK",
  code: number | string = API_SUCCESS_CODE,
) {
  return res
    .status(statusCode)
    .json(createSuccessResponse(data, message, code));
}

export function sendError(
  res: Response,
  statusCode: number,
  code: number | string,
  message: string,
  error?: unknown,
) {
  return res.status(statusCode).json(createErrorResponse(code, message, error));
}

function normalizeStandardResponse(
  body: UnknownRecord,
  statusCode: number,
): StandardSuccessResponse | StandardErrorResponse {
  const hasError = "error" in body && body.error !== undefined;
  const hasData = "data" in body;

  if (!hasError && hasData && statusCode < 400) {
    return createSuccessResponse(
      body.data,
      typeof body.message === "string" ? body.message : "OK",
      typeof body.code === "string" || typeof body.code === "number"
        ? body.code
        : API_SUCCESS_CODE,
      getTimestamp(body.timestamp),
    );
  }

  return createErrorResponse(
    typeof body.code === "string" || typeof body.code === "number"
      ? body.code
      : -1,
    typeof body.message === "string" ? body.message : "Request failed",
    body.error,
    getTimestamp(body.timestamp),
  );
}

function inferErrorCode(
  statusCode: number,
  body?: UnknownRecord,
): number | string {
  if (body) {
    const errorObj = asObject(body.error);
    if (
      errorObj &&
      (typeof errorObj.code === "number" || typeof errorObj.code === "string")
    ) {
      return errorObj.code;
    }
    if (typeof body.code === "number" || typeof body.code === "string") {
      return body.code;
    }
  }
  return statusCode;
}

function inferMessage(statusCode: number, body?: UnknownRecord): string {
  if (body) {
    if (typeof body.message === "string") {
      return body.message;
    }
    if (typeof body.error === "string") {
      return body.error;
    }
    const errorObj = asObject(body.error);
    if (errorObj && typeof errorObj.message === "string") {
      return errorObj.message;
    }
  }

  if (statusCode >= 500) return "Internal Server Error";
  if (statusCode >= 400) return "Bad Request";
  return "OK";
}

export function normalizeApiResponse(
  body: unknown,
  statusCode: number,
): StandardSuccessResponse | StandardErrorResponse {
  const objectBody = asObject(body);

  if (objectBody && "code" in objectBody && "message" in objectBody) {
    return normalizeStandardResponse(objectBody, statusCode);
  }

  if (objectBody && objectBody.success === true) {
    return createSuccessResponse(
      objectBody.data,
      typeof objectBody.message === "string" ? objectBody.message : "OK",
      API_SUCCESS_CODE,
      getTimestamp(objectBody.timestamp),
    );
  }

  if (objectBody && objectBody.success === false) {
    const message = inferMessage(statusCode, objectBody);
    const code = inferErrorCode(statusCode, objectBody);
    const normalizedError = normalizeLegacyError(objectBody.error);
    return createErrorResponse(
      code,
      message,
      normalizedError,
      getTimestamp(objectBody.timestamp),
    );
  }

  if (statusCode >= 400) {
    const message = inferMessage(statusCode, objectBody);
    const code = inferErrorCode(statusCode, objectBody);
    const normalizedError = objectBody
      ? normalizeLegacyError(objectBody.error ?? objectBody)
      : undefined;
    return createErrorResponse(code, message, normalizedError);
  }

  return createSuccessResponse(body, "OK", API_SUCCESS_CODE);
}
