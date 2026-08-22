// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { describe, expect, it } from "vitest";
import {
  API_SUCCESS_CODE,
  createErrorResponse,
  createSuccessResponse,
  isSuccessfulApiBody,
  normalizeApiResponse,
} from "../response";

/**
 * API Response Utilities Unit Tests
 * Pure functions that format API responses and detect success/failure
 */

describe("createSuccessResponse", () => {
  it("should create response with defaults", () => {
    const res = createSuccessResponse({ userId: "123" });
    expect(res.code).toBe(API_SUCCESS_CODE);
    expect(res.message).toBe("OK");
    expect(res.data).toEqual({ userId: "123" });
    expect(res.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("should accept custom message and code", () => {
    const res = createSuccessResponse({ items: [1, 2] }, "Created", 201);
    expect(res.code).toBe(201);
    expect(res.message).toBe("Created");
    expect(res.data).toEqual({ items: [1, 2] });
  });

  it("should accept custom timestamp", () => {
    const ts = "2026-04-20T10:00:00.000Z";
    const res = createSuccessResponse(null, "OK", 0, ts);
    expect(res.timestamp).toBe(ts);
  });

  it("should handle string code", () => {
    const res = createSuccessResponse("done", "Success", "SUCCESS");
    expect(res.code).toBe("SUCCESS");
  });

  it("should handle undefined data", () => {
    const res = createSuccessResponse(undefined);
    expect(res.data).toBeUndefined();
  });
});

describe("createErrorResponse", () => {
  it("should create error response with defaults", () => {
    const res = createErrorResponse(404, "Not Found");
    expect(res.code).toBe(404);
    expect(res.message).toBe("Not Found");
    expect(res.error).toBeUndefined();
  });

  it("should include error detail", () => {
    const err = new Error("validation failed");
    const res = createErrorResponse(400, "Bad Request", err);
    expect(res.code).toBe(400);
    expect(res.message).toBe("Bad Request");
    expect(res.error).toBe(err);
  });

  it("should omit error field when undefined", () => {
    const res = createErrorResponse(500, "Server Error");
    expect("error" in res).toBe(false);
  });

  it("should accept string code", () => {
    const res = createErrorResponse("E_AUTH", "Unauthorized");
    expect(res.code).toBe("E_AUTH");
  });

  it("should include error object even when empty", () => {
    const res = createErrorResponse(400, "Invalid input", {});
    expect(res.error).toEqual({});
  });
});

describe("isSuccessfulApiBody", () => {
  it("should return true for body with code 0", () => {
    expect(isSuccessfulApiBody({ code: 0, message: "OK" })).toBe(true);
  });

  it('should return true for body with code "0"', () => {
    expect(isSuccessfulApiBody({ code: "0", message: "OK" })).toBe(true);
  });

  it("should return true for body with success: true", () => {
    expect(isSuccessfulApiBody({ success: true, data: {} })).toBe(true);
  });

  it("should return true when code=0 even if success=false", () => {
    expect(
      isSuccessfulApiBody({ success: false, code: 0, message: "OK" }),
    ).toBe(true);
  });

  it("should return false for body with success: false", () => {
    expect(isSuccessfulApiBody({ success: false, message: "error" })).toBe(
      false,
    );
  });

  it("should return false for non-object body", () => {
    expect(isSuccessfulApiBody(null)).toBe(false);
    expect(isSuccessfulApiBody(undefined)).toBe(false);
    expect(isSuccessfulApiBody("string")).toBe(false);
    expect(isSuccessfulApiBody(123)).toBe(false);
  });

  it("should return false for body with non-zero code", () => {
    expect(isSuccessfulApiBody({ code: 404, message: "Not Found" })).toBe(
      false,
    );
    expect(isSuccessfulApiBody({ code: "E_FAIL", message: "fail" })).toBe(
      false,
    );
  });
});

describe("normalizeApiResponse", () => {
  describe("standard response (has code + message)", () => {
    it("should normalize success response with data", () => {
      const body = {
        code: 0,
        message: "Success",
        data: { id: 1 },
        timestamp: "2026-04-20T10:00:00Z",
      };
      const res = normalizeApiResponse(body, 200);
      expect(res.code).toBe(0);
      expect(res.message).toBe("Success");
      expect((res as any).data).toEqual({ id: 1 });
      expect((res as any).timestamp).toBe("2026-04-20T10:00:00Z");
    });

    it("should normalize error response with error object", () => {
      const body = {
        code: 404,
        message: "Not Found",
        error: { detail: "missing" },
      };
      const res = normalizeApiResponse(body, 404);
      expect(res.code).toBe(404);
      expect(res.message).toBe("Not Found");
      expect((res as any).error).toEqual({ detail: "missing" });
    });

    it("should use body.code when error.code is not present", () => {
      const body = { code: 500, message: "Server Error" };
      const res = normalizeApiResponse(body, 500);
      expect(res.code).toBe(500);
    });
  });

  describe("legacy success response (success: true)", () => {
    it("should normalize legacy success format", () => {
      const body = { success: true, data: { result: 42 }, message: "Done" };
      const res = normalizeApiResponse(body, 200);
      expect(res.code).toBe(API_SUCCESS_CODE);
      expect(res.message).toBe("Done");
      expect((res as any).data).toEqual({ result: 42 });
    });

    it("should use OK when no message in legacy success", () => {
      const body = { success: true, data: { id: 1 } };
      const res = normalizeApiResponse(body, 200);
      expect(res.message).toBe("OK");
    });
  });

  describe("legacy error response (success: false)", () => {
    it("should normalize legacy error with string error", () => {
      const body = { success: false, error: "Validation failed" };
      const res = normalizeApiResponse(body, 400);
      expect(res.code).toBe(400);
      // String error becomes { message: 'string' }
      expect((res as any).error).toEqual({ message: "Validation failed" });
    });

    it("should normalize legacy error with object error that has no message", () => {
      const body = {
        success: false,
        error: { code: "E_VAL", detail: "bad input" },
      };
      const res = normalizeApiResponse(body, 422);
      expect(res.code).toBe("E_VAL"); // error.code takes priority over statusCode
      expect(res.message).toBe("Bad Request"); // falls through to statusCode inference (no readable message)
      expect((res as any).error).toEqual({
        code: "E_VAL",
        detail: "bad input",
      });
    });

    it("should use error.message from error object when present", () => {
      const body = {
        success: false,
        error: { message: "Invalid email address" },
      };
      const res = normalizeApiResponse(body, 400);
      expect(res.message).toBe("Invalid email address");
    });
  });

  describe("plain error status (>= 400, no structured body)", () => {
    it("should infer message from string error", () => {
      const body = { error: "Database connection failed" };
      const res = normalizeApiResponse(body, 500);
      expect(res.message).toBe("Database connection failed");
      expect(res.code).toBe(500);
    });

    it("should use default Bad Request for 400 with no readable body message", () => {
      const res = normalizeApiResponse({}, 400);
      expect(res.message).toBe("Bad Request");
    });

    it("should use default Internal Server Error for 500", () => {
      const res = normalizeApiResponse({}, 500);
      expect(res.message).toBe("Internal Server Error");
    });

    it("should infer code from error.code field", () => {
      const body = { error: { code: "E_DB", message: "connection failed" } };
      const res = normalizeApiResponse(body, 500);
      expect(res.code).toBe("E_DB");
    });

    it("should use statusCode as fallback code", () => {
      const body = { error: "Unknown error" };
      const res = normalizeApiResponse(body, 503);
      expect(res.code).toBe(503);
    });
  });

  describe("fallback to success", () => {
    it("should return success for 2xx with no structured body", () => {
      const res = normalizeApiResponse({ raw: "data" }, 201);
      expect(res.code).toBe(API_SUCCESS_CODE);
      expect(res.message).toBe("OK");
      expect((res as any).data).toEqual({ raw: "data" });
    });

    it("should return success for 204 No Content", () => {
      const res = normalizeApiResponse(null, 204);
      expect(res.code).toBe(API_SUCCESS_CODE);
      expect(res.message).toBe("OK");
    });

    it("should return success for 200 with plain data", () => {
      const res = normalizeApiResponse({ items: [1, 2, 3] }, 200);
      expect(res.code).toBe(API_SUCCESS_CODE); // fallback path (no structured fields)
      expect((res as any).data).toEqual({ items: [1, 2, 3] });
    });
  });
});
