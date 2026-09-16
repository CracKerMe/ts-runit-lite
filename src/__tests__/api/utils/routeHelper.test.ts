import express from "express";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  asyncHandler,
  errorHandler,
} from "../../../api/ErrorHandler";
import { ServiceError } from "../../../api/services/WorkflowApplicationService";
import { asyncHandler as routeHelperAsyncHandler } from "../../../api/utils/routeHelper";

vi.mock("../../../utils/Logger", () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function buildApp(handler: () => Promise<void>): express.Express {
  const app = express();
  app.use(express.json());
  app.get(
    "/boom",
    routeHelperAsyncHandler(async () => {
      await handler();
    }),
  );
  app.use(errorHandler);
  return app;
}

describe("routeHelper asyncHandler", () => {
  const savedEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
  });

  it("is the same function as the canonical ErrorHandler implementation", () => {
    // 此前存在两份同名实现，instances.ts 同时 import 了两者，
    // 靠 import 顺序决定用哪一个——极易误用。
    expect(routeHelperAsyncHandler).toBe(asyncHandler);
  });

  it("preserves ApiError status codes instead of collapsing them to 500", async () => {
    // 回归守卫：旧实现从不调用 next(error)，自行返回 500，
    // ApiError.notFound 会变成 INTERNAL_ERROR。
    const app = buildApp(async () => {
      throw ApiError.notFound("工作流不存在");
    });

    const res = await supertest(app).get("/boom");

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).toContain("工作流不存在");
  });

  it("maps ServiceError status code, code and details", async () => {
    // 承重守卫：ServiceError 映射从 routeHelper 迁移到了 errorHandler，
    // 迁移若失败，这批 4xx 会静默退化成 5xx。
    const app = buildApp(async () => {
      throw new ServiceError(409, "WORKFLOW_CONFLICT", "版本冲突", {
        version: 3,
      });
    });

    const res = await supertest(app).get("/boom");

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("WORKFLOW_CONFLICT");
    expect(JSON.stringify(res.body)).toContain("版本冲突");
  });

  it("does not leak a raw error message to clients in production", async () => {
    // 回归守卫：旧实现把 error.message 原样塞进响应体，
    // 绕过 errorHandler 在生产环境的脱敏。
    process.env.NODE_ENV = "production";

    const secret = "SELECT * FROM secrets failed at /var/db/credentials.sqlite";
    const app = buildApp(async () => {
      throw new Error(secret);
    });

    const res = await supertest(app).get("/boom");

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect(JSON.stringify(res.body)).not.toContain("/var/db");
  });

  it("still surfaces the message outside production for debuggability", async () => {
    const app = buildApp(async () => {
      throw new Error("a helpful development message");
    });

    const res = await supertest(app).get("/boom");

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).toContain("a helpful development message");
  });
});
