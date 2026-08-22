/**
 * Integration tests for authentication middleware.
 *
 * Tests the fail-closed behavior in production mode and
 * the combined JWT + API key authentication flow.
 */

import express from "express";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  apiKeyAuthMiddleware,
  combinedAuthMiddleware,
  generateToken,
  jwtAuthMiddleware,
} from "../../api/middleware/auth";
import { resetAppConfig, validateAppConfig } from "../../config/AppConfig";

const JWT_SECRET = "test-secret-key-that-is-at-least-32-characters-long";

function createTestApp(authMiddleware: express.Handler) {
  const app = express();
  app.use(express.json());
  app.use("/api", authMiddleware, (_req, res) => {
    res.json({ success: true, user: _req.user });
  });
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  return app;
}

describe("Auth Middleware Integration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.AUTH_ENABLED = "true";
    resetAppConfig();
    validateAppConfig();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetAppConfig();
  });

  describe("JWT Authentication", () => {
    it("should allow valid JWT tokens", async () => {
      const token = generateToken({ id: "user-1", role: "admin" });
      const app = createTestApp(jwtAuthMiddleware);

      const response = await import("supertest").then((st) =>
        st.default(app).get("/api").set("Authorization", `Bearer ${token}`),
      );

      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe("user-1");
    });

    it("should reject requests without auth header", async () => {
      const app = createTestApp(jwtAuthMiddleware);

      const response = await import("supertest").then((st) =>
        st.default(app).get("/api"),
      );

      expect(response.status).toBe(401);
    });

    it("should reject invalid tokens", async () => {
      const app = createTestApp(jwtAuthMiddleware);

      const response = await import("supertest").then((st) =>
        st
          .default(app)
          .get("/api")
          .set("Authorization", "Bearer invalid-token"),
      );

      expect(response.status).toBe(403);
    });

    it("should reject tokens signed with wrong secret", async () => {
      const token = jwt.sign({ id: "user-1" }, "wrong-secret");
      const app = createTestApp(jwtAuthMiddleware);

      const response = await import("supertest").then((st) =>
        st.default(app).get("/api").set("Authorization", `Bearer ${token}`),
      );

      expect(response.status).toBe(403);
    });

    it("should skip auth for health checks", async () => {
      const app = createTestApp(jwtAuthMiddleware);

      const response = await import("supertest").then((st) =>
        st.default(app).get("/health"),
      );

      expect(response.status).toBe(200);
    });
  });

  describe("API Key Authentication", () => {
    beforeEach(() => {
      process.env.API_KEY = "test-api-key-12345678";
    });

    it("should allow valid API keys", async () => {
      const app = createTestApp(apiKeyAuthMiddleware);

      const response = await import("supertest").then((st) =>
        st.default(app).get("/api").set("X-API-Key", "test-api-key-12345678"),
      );

      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe("api-key-service");
    });

    it("should reject invalid API keys", async () => {
      const app = createTestApp(apiKeyAuthMiddleware);

      const response = await import("supertest").then((st) =>
        st.default(app).get("/api").set("X-API-Key", "wrong-key"),
      );

      expect(response.status).toBe(401);
    });
  });

  describe("Fail-Closed in Production", () => {
    it("should enable auth by default when NODE_ENV=production", () => {
      delete process.env.AUTH_ENABLED;
      process.env.NODE_ENV = "production";

      // The isAuthEnabled() function should return true in production
      // even without AUTH_ENABLED being set
      const app = createTestApp(combinedAuthMiddleware);

      // Request without auth should be rejected
      return import("supertest").then((st) =>
        st
          .default(app)
          .get("/api")
          .then((response) => {
            expect(response.status).toBe(401);
          }),
      );
    });

    it("should allow unauthenticated requests in development", () => {
      delete process.env.AUTH_ENABLED;
      process.env.NODE_ENV = "development";

      const app = createTestApp(combinedAuthMiddleware);

      return import("supertest").then((st) =>
        st
          .default(app)
          .get("/api")
          .then((response) => {
            expect(response.status).toBe(200);
          }),
      );
    });

    it("should respect explicit AUTH_ENABLED=false even in production", () => {
      process.env.AUTH_ENABLED = "false";
      process.env.NODE_ENV = "production";

      const app = createTestApp(combinedAuthMiddleware);

      return import("supertest").then((st) =>
        st
          .default(app)
          .get("/api")
          .then((response) => {
            expect(response.status).toBe(200);
          }),
      );
    });
  });

  describe("Combined Auth Middleware", () => {
    beforeEach(() => {
      process.env.API_KEY = "test-api-key-12345678";
    });

    it("should accept JWT tokens via combined middleware", async () => {
      const token = generateToken({ id: "user-1", role: "admin" });
      const app = createTestApp(combinedAuthMiddleware);

      const response = await import("supertest").then((st) =>
        st.default(app).get("/api").set("Authorization", `Bearer ${token}`),
      );

      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe("user-1");
    });

    it("should accept API keys via combined middleware", async () => {
      const app = createTestApp(combinedAuthMiddleware);

      const response = await import("supertest").then((st) =>
        st.default(app).get("/api").set("X-API-Key", "test-api-key-12345678"),
      );

      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe("api-key-service");
    });

    it("should reject requests with neither JWT nor API key", async () => {
      const app = createTestApp(combinedAuthMiddleware);

      const response = await import("supertest").then((st) =>
        st.default(app).get("/api"),
      );

      expect(response.status).toBe(401);
    });
  });
});
