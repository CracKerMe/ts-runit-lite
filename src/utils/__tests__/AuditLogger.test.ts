// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLogger, sanitizeObject, sanitizeValue } from "../AuditLogger";

describe("sanitizeValue", () => {
  it("should mask a password field", () => {
    // 's3cr3t' = 6 chars: keep first 2 ('s3') and last 2 ('3t') → 's3****3t'
    expect(sanitizeValue("password", "s3cr3t")).toBe("s3****3t");
  });

  it("should mask a token field", () => {
    expect(sanitizeValue("token", "abcdefgh")).toBe("ab****gh");
  });

  it("should return non-string sensitive values as ****", () => {
    expect(sanitizeValue("secret", 12345)).toBe("****");
  });

  it("should mask very short values as ****", () => {
    expect(sanitizeValue("apiKey", "abc")).toBe("****");
  });

  it("should leave non-sensitive fields unchanged", () => {
    expect(sanitizeValue("userId", "user-123")).toBe("user-123");
    expect(sanitizeValue("amount", 99.99)).toBe(99.99);
  });

  it("should be case-insensitive for sensitive field names", () => {
    expect(sanitizeValue("PASSWORD", "mysecret")).toBe("my****et");
  });
});

describe("sanitizeObject", () => {
  it("should recurse into nested objects", () => {
    const result = sanitizeObject({ user: { password: "p@ssw0rd" } });
    expect(result.user.password).toBe("p@****rd");
  });

  it("should handle arrays", () => {
    const result = sanitizeObject([{ token: "tok123" }]);
    expect(result[0].token).toBe("to****23");
  });

  it("should return primitives unchanged", () => {
    expect(sanitizeObject("hello")).toBe("hello");
    expect(sanitizeObject(42)).toBe(42);
    expect(sanitizeObject(null)).toBeNull();
    expect(sanitizeObject(undefined)).toBeUndefined();
  });

  it("should not recurse beyond depth 10", () => {
    let deep: any = { value: "ok" };
    for (let i = 0; i < 12; i++) deep = { nested: deep };
    const result = sanitizeObject(deep);
    // At depth 10 it should return [max depth]
    expect(JSON.stringify(result)).toContain("[max depth]");
  });
});

describe("AuditLogger", () => {
  beforeEach(() => {
    AuditLogger.clear();
  });

  afterEach(() => {
    AuditLogger.clear();
  });

  describe("log", () => {
    it("should record a log entry", () => {
      AuditLogger.log({ action: "workflow.start", success: true });
      const entries = AuditLogger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("workflow.start");
      expect(entries[0].success).toBe(true);
    });

    it("should add a timestamp automatically", () => {
      AuditLogger.log({ action: "instance.create", success: true });
      const entries = AuditLogger.getEntries();
      expect(entries[0].timestamp).toBeDefined();
    });

    it("should sanitize sensitive fields in details", () => {
      AuditLogger.log({
        action: "auth.success",
        success: true,
        details: { password: "hunter2", username: "alice" },
      });
      const entries = AuditLogger.getEntries();
      expect(entries[0].details?.password).not.toBe("hunter2");
      expect(entries[0].details?.username).toBe("alice");
    });
  });

  describe("logWorkflow", () => {
    it("should create a workflow audit entry", () => {
      AuditLogger.logWorkflow("workflow.start", "wf-1", "inst-1", { step: 1 });
      const entries = AuditLogger.getEntries({ action: "workflow.start" });
      expect(entries).toHaveLength(1);
      expect(entries[0].resourceId).toBe("wf-1");
    });
  });

  describe("logApiRequest", () => {
    it("should mark success for 2xx status codes", () => {
      AuditLogger.logApiRequest("GET", "/workflows", 200);
      const [entry] = AuditLogger.getEntries({ action: "api.request" });
      expect(entry.success).toBe(true);
      expect(entry.errorMessage).toBeUndefined();
    });

    it("should mark failure for 4xx status codes", () => {
      AuditLogger.logApiRequest("POST", "/workflows", 404);
      const [entry] = AuditLogger.getEntries({ action: "api.request" });
      expect(entry.success).toBe(false);
      expect(entry.errorMessage).toBe("HTTP 404");
    });
  });

  describe("logAuth", () => {
    it("should record auth.success on success", () => {
      AuditLogger.logAuth(true, "alice");
      const [entry] = AuditLogger.getEntries({ action: "auth.success" });
      expect(entry.actor).toBe("alice");
    });

    it("should record auth.failure on failure", () => {
      AuditLogger.logAuth(false, "bob", "1.2.3.4", "wrong password");
      const [entry] = AuditLogger.getEntries({ action: "auth.failure" });
      expect(entry.success).toBe(false);
      expect(entry.errorMessage).toBe("wrong password");
    });
  });

  describe("getEntries (filtering)", () => {
    beforeEach(() => {
      AuditLogger.log({
        action: "workflow.start",
        resource: "workflow",
        success: true,
      });
      AuditLogger.log({
        action: "instance.create",
        resource: "instance",
        success: true,
      });
      AuditLogger.log({
        action: "api.request",
        resource: "api",
        success: false,
      });
    });

    it("should filter by action", () => {
      const entries = AuditLogger.getEntries({ action: "api.request" });
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe("api.request");
    });

    it("should filter by resource", () => {
      const entries = AuditLogger.getEntries({ resource: "workflow" });
      expect(entries).toHaveLength(1);
    });

    it("should limit results via limit option", () => {
      const entries = AuditLogger.getEntries({ limit: 2 });
      expect(entries).toHaveLength(2);
    });

    it("should filter by startTime / endTime", () => {
      const start = new Date(Date.now() - 1000);
      const end = new Date(Date.now() + 1000);
      const entries = AuditLogger.getEntries({
        startTime: start,
        endTime: end,
      });
      expect(entries.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("export", () => {
    it("should export entries as JSON string", () => {
      AuditLogger.log({ action: "config.change", success: true });
      const exported = AuditLogger.export();
      const parsed = JSON.parse(exported);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].action).toBe("config.change");
    });
  });

  describe("clear", () => {
    it("should remove all entries", () => {
      AuditLogger.log({ action: "workflow.cancel", success: true });
      AuditLogger.clear();
      expect(AuditLogger.getEntries()).toHaveLength(0);
    });
  });
});
