import express from "express";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/Logger", () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * 限流配置以前在模块加载期求值，非法值会被固化；现在是惰性读取，
 * 所以每个用例都需要重新 import 模块以拿到干净的内存计数桶。
 */
async function buildApp(): Promise<express.Express> {
  vi.resetModules();
  const { rateLimitMiddleware } = await import("../rateLimit");
  const app = express();
  app.use(rateLimitMiddleware);
  app.get("/ping", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

async function countAllowed(
  app: express.Express,
  requests: number,
): Promise<number> {
  let allowed = 0;
  for (let i = 0; i < requests; i++) {
    const res = await supertest(app).get("/ping");
    if (res.status === 200) allowed++;
  }
  return allowed;
}

describe("rateLimit – environment configuration", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.RATE_LIMIT_MAX_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_MS;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("enforces an explicit numeric limit", async () => {
    process.env.RATE_LIMIT_MAX_REQUESTS = "3";
    const app = await buildApp();

    expect(await countAllowed(app, 6)).toBe(3);
  });

  it("falls back to the default limit when the value is not a number", async () => {
    // 回归守卫：Number.parseInt("abc") 得到 NaN，而 `count >= NaN` 恒为
    // false——限流会完全静默失效，而不是回退到默认值。
    process.env.RATE_LIMIT_MAX_REQUESTS = "abc";
    const app = await buildApp();

    // 默认上限是 100：第 101 个请求必须被拒
    expect(await countAllowed(app, 105)).toBe(100);
  });

  it("falls back to the default limit when the value is zero", async () => {
    // 0 会封死所有请求，显然不是用户想要的配置
    process.env.RATE_LIMIT_MAX_REQUESTS = "0";
    const app = await buildApp();

    expect(await countAllowed(app, 3)).toBe(3);
  });

  it("falls back to the default limit when the value is negative", async () => {
    process.env.RATE_LIMIT_MAX_REQUESTS = "-1";
    const app = await buildApp();

    expect(await countAllowed(app, 3)).toBe(3);
  });

  it("still allows everything through when rate limiting is disabled", async () => {
    process.env.RATE_LIMIT_ENABLED = "false";
    process.env.RATE_LIMIT_MAX_REQUESTS = "1";
    const app = await buildApp();

    expect(await countAllowed(app, 5)).toBe(5);
  });
});
