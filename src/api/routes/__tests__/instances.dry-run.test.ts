// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import instanceRoutes from "../instances";

describe("instances dry-run route", () => {
  it("proxies workflow dry run requests", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).engine = {
        dryRun: vi.fn(async () => ({
          success: true,
          valid: true,
          executionPath: ["start"],
          simulatedOutputs: {},
          errors: [],
          duration: 1,
        })),
      };
      next();
    });
    app.use("/", instanceRoutes);
    const response = await request(app)
      .post("/workflows/wf-1/dry-run")
      .send({ context: { a: 1 } })
      .expect(200);
    expect(response.body.data.valid).toBe(true);
  });
});
