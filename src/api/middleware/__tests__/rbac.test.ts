import type { NextFunction, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPermission, rbacMiddleware, requireRole } from "../rbac";

describe("RBAC Middleware", () => {
  const originalAuthEnabled = process.env.AUTH_ENABLED;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      user: { id: "user-1", role: "viewer" },
      path: "/api/workflows",
      method: "GET",
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();

    // Enable auth for tests
    process.env.AUTH_ENABLED = "true";
  });

  afterEach(() => {
    if (originalAuthEnabled === undefined) {
      delete process.env.AUTH_ENABLED;
    } else {
      process.env.AUTH_ENABLED = originalAuthEnabled;
    }
  });

  describe("hasPermission", () => {
    it("should grant admin all permissions", () => {
      expect(
        hasPermission("admin", { resource: "workflow", action: "read" }),
      ).toBe(true);
      expect(
        hasPermission("admin", { resource: "workflow", action: "delete" }),
      ).toBe(true);
      expect(hasPermission("admin", { resource: "ai", action: "write" })).toBe(
        true,
      );
    });

    it("should restrict viewer to read only", () => {
      expect(
        hasPermission("viewer", { resource: "workflow", action: "read" }),
      ).toBe(true);
      expect(
        hasPermission("viewer", { resource: "workflow", action: "write" }),
      ).toBe(false);
      expect(
        hasPermission("viewer", { resource: "workflow", action: "delete" }),
      ).toBe(false);
    });

    it("should allow operator workflow write", () => {
      expect(
        hasPermission("operator", { resource: "workflow", action: "write" }),
      ).toBe(true);
      expect(
        hasPermission("operator", { resource: "workflow", action: "delete" }),
      ).toBe(false);
    });
  });

  describe("rbacMiddleware", () => {
    it("should allow access when permission exists", () => {
      const middleware = rbacMiddleware({
        resource: "workflow",
        action: "read",
      });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it("should deny access when permission missing", () => {
      const middleware = rbacMiddleware({
        resource: "workflow",
        action: "delete",
      });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("should skip RBAC when auth is disabled", () => {
      process.env.AUTH_ENABLED = "false";

      const middleware = rbacMiddleware({
        resource: "workflow",
        action: "delete",
      });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it("should deny when user not authenticated", () => {
      mockReq.user = undefined;

      const middleware = rbacMiddleware({
        resource: "workflow",
        action: "read",
      });

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });

  describe("requireRole", () => {
    it("should allow when role matches", () => {
      mockReq.user = { id: "user-1", role: "admin" };
      const middleware = requireRole("admin", "operator");

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it("should deny when role doesn't match", () => {
      mockReq.user = { id: "user-1", role: "viewer" };
      const middleware = requireRole("admin", "operator");

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });
});
