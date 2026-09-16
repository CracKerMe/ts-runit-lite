import { afterEach, describe, expect, it } from "vitest";
import {
  DataValidationError,
  getValidationMode,
  validateAgainstSchema,
} from "../../engine/DataValidator";

describe("validateAgainstSchema", () => {
  const orderSchema = {
    type: "object",
    required: ["orderId", "amount"],
    properties: {
      orderId: { type: "string", pattern: "^ORD-\\d{6}$" },
      amount: { type: "number", minimum: 0 },
      customerEmail: { type: "string", format: "email" },
      tags: { type: "array", items: { type: "string" } },
      level: { type: "string", enum: ["basic", "premium"] },
      nested: {
        type: "object",
        required: ["inner"],
        properties: { inner: { type: "boolean" } },
      },
    },
  };

  it("should accept valid data", () => {
    const result = validateAgainstSchema(orderSchema, {
      orderId: "ORD-000001",
      amount: 99.9,
      customerEmail: "a@b.com",
      tags: ["vip"],
      level: "premium",
      nested: { inner: true },
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("should report missing required fields with path", () => {
    const result = validateAgainstSchema(orderSchema, { amount: 5 });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "/orderId" }),
    );
  });

  it("should report type mismatches", () => {
    const result = validateAgainstSchema(orderSchema, {
      orderId: "ORD-000001",
      amount: "not-a-number",
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === "/amount")).toBe(true);
  });

  it("should enforce minimum", () => {
    const result = validateAgainstSchema(orderSchema, {
      orderId: "ORD-000001",
      amount: -5,
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0].path).toBe("/amount");
    expect(result.issues[0].message).toMatch(/>= 0/);
  });

  it("should enforce pattern and email format", () => {
    const result = validateAgainstSchema(orderSchema, {
      orderId: "BAD",
      amount: 1,
      customerEmail: "not-an-email",
    });
    expect(result.valid).toBe(false);
    const paths = result.issues.map((i) => i.path);
    expect(paths).toContain("/orderId");
    expect(paths).toContain("/customerEmail");
  });

  it("should enforce enum", () => {
    const result = validateAgainstSchema(orderSchema, {
      orderId: "ORD-000001",
      amount: 1,
      level: "gold",
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0].path).toBe("/level");
  });

  it("should validate array items with index paths", () => {
    const result = validateAgainstSchema(orderSchema, {
      orderId: "ORD-000001",
      amount: 1,
      tags: ["ok", 42],
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0].path).toBe("/tags/1");
  });

  it("should validate nested objects", () => {
    const result = validateAgainstSchema(orderSchema, {
      orderId: "ORD-000001",
      amount: 1,
      nested: {},
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0].path).toBe("/nested/inner");
  });

  it("should enforce minLength/maxLength", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string", minLength: 2, maxLength: 4 } },
    };
    expect(validateAgainstSchema(schema, { name: "a" }).valid).toBe(false);
    expect(validateAgainstSchema(schema, { name: "abcde" }).valid).toBe(false);
    expect(validateAgainstSchema(schema, { name: "abc" }).valid).toBe(true);
  });

  it("should reject non-object data for object schemas", () => {
    const result = validateAgainstSchema(orderSchema, "just a string");
    expect(result.valid).toBe(false);
    expect(result.issues[0].path).toBe("/");
  });
});

describe("getValidationMode", () => {
  const original = process.env.SCHEMA_VALIDATION;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SCHEMA_VALIDATION;
    } else {
      process.env.SCHEMA_VALIDATION = original;
    }
  });

  it("should default to off", () => {
    delete process.env.SCHEMA_VALIDATION;
    expect(getValidationMode()).toBe("off");
  });

  it("should read strict and warn modes", () => {
    process.env.SCHEMA_VALIDATION = "strict";
    expect(getValidationMode()).toBe("strict");
    process.env.SCHEMA_VALIDATION = "warn";
    expect(getValidationMode()).toBe("warn");
  });
});

describe("DataValidationError", () => {
  it("should carry issues", () => {
    const err = new DataValidationError([
      { path: "/amount", message: "must be >= 0" },
    ]);
    expect(err.issues).toHaveLength(1);
    expect(err.message).toMatch(/validation failed/i);
  });
});
