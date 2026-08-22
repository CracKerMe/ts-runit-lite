import type { NextFunction, Request, Response } from "express";
import { Logger } from "../../utils/Logger";
import { isAuthEnabled } from "../utils/authConfig";

/**
 * User roles for RBAC
 */
export type Role = "admin" | "operator" | "viewer";

/**
 * Resource types that can be protected
 */
export type Resource =
  | "workflow"
  | "instance"
  | "event"
  | "config"
  | "ai"
  | "template";

/**
 * Actions that can be performed on resources
 */
export type Action = "read" | "write" | "delete" | "execute";

/**
 * Permission definition
 */
export interface Permission {
  resource: Resource;
  action: Action;
}

/**
 * Role to permissions mapping
 */
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    // Full access to everything
    { resource: "workflow", action: "read" },
    { resource: "workflow", action: "write" },
    { resource: "workflow", action: "delete" },
    { resource: "workflow", action: "execute" },
    { resource: "instance", action: "read" },
    { resource: "instance", action: "write" },
    { resource: "instance", action: "delete" },
    { resource: "instance", action: "execute" },
    { resource: "event", action: "read" },
    { resource: "event", action: "write" },
    { resource: "event", action: "delete" },
    { resource: "config", action: "read" },
    { resource: "config", action: "write" },
    { resource: "ai", action: "read" },
    { resource: "ai", action: "write" },
    { resource: "template", action: "read" },
    { resource: "template", action: "write" },
    { resource: "template", action: "delete" },
  ],
  operator: [
    // Can manage workflows and instances, read AI data
    { resource: "workflow", action: "read" },
    { resource: "workflow", action: "write" },
    { resource: "workflow", action: "execute" },
    { resource: "instance", action: "read" },
    { resource: "instance", action: "write" },
    { resource: "instance", action: "execute" },
    { resource: "event", action: "read" },
    { resource: "event", action: "write" },
    { resource: "ai", action: "read" },
    { resource: "template", action: "read" },
    { resource: "template", action: "write" },
  ],
  viewer: [
    // Read-only access
    { resource: "workflow", action: "read" },
    { resource: "instance", action: "read" },
    { resource: "event", action: "read" },
    { resource: "ai", action: "read" },
    { resource: "template", action: "read" },
  ],
};

/**
 * Get permissions for a role
 */
export function getPermissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.some(
    (p) => p.resource === permission.resource && p.action === permission.action,
  );
}

/**
 * RBAC middleware that checks if the authenticated user has the required permission
 *
 * Usage:
 *   router.delete('/workflows/:id', rbacMiddleware({ resource: 'workflow', action: 'delete' }), handler)
 */
export function rbacMiddleware(requiredPermission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip RBAC if auth is not enabled (uses shared isAuthEnabled)
    if (!isAuthEnabled()) {
      next();
      return;
    }

    const user = req.user;
    if (!user) {
      res.status(401).json({
        success: false,
        error: "Authentication required",
      });
      return;
    }

    const role = (user.role as Role) || "viewer";

    if (!hasPermission(role, requiredPermission)) {
      Logger.warn("api", "rbac", "Access denied", {
        userId: user.id,
        role,
        resource: requiredPermission.resource,
        action: requiredPermission.action,
        path: req.path,
        method: req.method,
      });

      res.status(403).json({
        success: false,
        error: "Insufficient permissions",
        required: requiredPermission,
        currentRole: role,
      });
      return;
    }

    next();
  };
}

/**
 * Convenience middleware for requiring specific roles
 *
 * Usage:
 *   router.post('/config', requireRole('admin'), handler)
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip if auth is not enabled (uses shared isAuthEnabled)
    if (!isAuthEnabled()) {
      next();
      return;
    }

    const user = req.user;
    if (!user) {
      res.status(401).json({
        success: false,
        error: "Authentication required",
      });
      return;
    }

    const userRole = (user.role as Role) || "viewer";

    if (!roles.includes(userRole)) {
      Logger.warn("api", "rbac", "Role check failed", {
        userId: user.id,
        userRole,
        requiredRoles: roles,
        path: req.path,
      });

      res.status(403).json({
        success: false,
        error: "Insufficient role",
        required: roles,
        current: userRole,
      });
      return;
    }

    next();
  };
}
