// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import instanceRoutes from "../../../api/routes/instances";

describe("Instance messaging routes", () => {
  function createApp(engine: Record<string, unknown>) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).engine = engine;
      next();
    });
    app.use("/", instanceRoutes);
    return app;
  }

  it("should expose signal, query and update endpoints", async () => {
    const engine = {
      signal: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ status: "open" }),
      update: vi.fn().mockResolvedValue({ priority: "P1" }),
    };

    const app = createApp(engine);

    await request(app)
      .post("/inst-1/signal")
      .send({ name: "customer.message", payload: { text: "hello" } })
      .expect(202);
    expect(engine.signal).toHaveBeenCalledWith("inst-1", "customer.message", {
      text: "hello",
    });

    const queryResponse = await request(app)
      .post("/inst-1/query")
      .send({ name: "ticket.status" })
      .expect(200);
    expect(queryResponse.body.data.result).toEqual({ status: "open" });

    const updateResponse = await request(app)
      .post("/inst-1/update")
      .send({ name: "ticket.priority", payload: { priority: "P1" } })
      .expect(200);
    expect(updateResponse.body.data.result).toEqual({ priority: "P1" });
    expect(typeof updateResponse.body.data.correlationId).toBe("string");
  });
});
