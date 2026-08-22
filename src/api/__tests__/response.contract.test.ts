// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { describe, expect, it } from "vitest";
import {
  API_SUCCESS_CODE,
  createErrorResponse,
  createSuccessResponse,
  isSuccessfulApiBody,
  normalizeApiResponse,
  sendError,
  sendSuccess,
} from "../response";

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe("API Response Contract", () => {
  it("normalizes legacy success body to standard contract", () => {
    const normalized = normalizeApiResponse(
      {
        success: true,
        data: { id: "instance-1" },
      },
      200,
    );

    expect(normalized).toMatchObject({
      code: API_SUCCESS_CODE,
      message: "OK",
      data: { id: "instance-1" },
    });
    expect((normalized as any).timestamp).toBeTypeOf("string");
  });

  it("normalizes legacy error string to standard error contract", () => {
    const normalized = normalizeApiResponse(
      {
        success: false,
        error: "Invalid request payload",
      },
      400,
    );

    expect(normalized).toMatchObject({
      code: 400,
      message: "Invalid request payload",
      error: { message: "Invalid request payload" },
    });
    expect((normalized as any).timestamp).toBeTypeOf("string");
  });

  it("keeps standard success contract unchanged in semantics", () => {
    const ts = "2026-02-12T00:00:00.000Z";
    const normalized = normalizeApiResponse(
      {
        code: 0,
        message: "Workflow started",
        data: { instanceId: "wf_1" },
        timestamp: ts,
      },
      201,
    );

    expect(normalized).toEqual({
      code: 0,
      message: "Workflow started",
      data: { instanceId: "wf_1" },
      timestamp: ts,
    });
  });

  it("keeps standard error contract unchanged in semantics", () => {
    const ts = "2026-02-12T00:00:00.000Z";
    const normalized = normalizeApiResponse(
      {
        code: 404,
        message: "Workflow not found",
        error: { workflowId: "missing" },
        timestamp: ts,
      },
      404,
    );

    expect(normalized).toEqual({
      code: 404,
      message: "Workflow not found",
      error: { workflowId: "missing" },
      timestamp: ts,
    });
  });

  it("sendSuccess returns standardized payload", () => {
    const res = createMockResponse();

    sendSuccess(res as any, 201, { webhookId: "wh_1" }, "Webhook created");

    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      code: 0,
      message: "Webhook created",
      data: { webhookId: "wh_1" },
    });
  });

  it("sendError returns standardized payload", () => {
    const res = createMockResponse();

    sendError(res as any, 429, "RATE_LIMIT_EXCEEDED", "Too many requests", {
      retryAfter: 60,
    });

    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many requests",
      error: { retryAfter: 60 },
    });
  });

  it("isSuccessfulApiBody detects both legacy and standard success shapes", () => {
    expect(isSuccessfulApiBody({ success: true, data: {} })).toBe(true);
    expect(isSuccessfulApiBody({ code: 0, message: "OK", data: {} })).toBe(
      true,
    );
    expect(isSuccessfulApiBody({ code: 400, message: "Bad Request" })).toBe(
      false,
    );
  });

  it("factory methods create explicit contracts", () => {
    const success = createSuccessResponse({ value: 1 }, "OK", 0);
    const error = createErrorResponse(500, "Internal Server Error", {
      traceId: "abc",
    });

    expect(success).toMatchObject({
      code: 0,
      message: "OK",
      data: { value: 1 },
    });
    expect(error).toMatchObject({
      code: 500,
      message: "Internal Server Error",
      error: { traceId: "abc" },
    });
  });
});
