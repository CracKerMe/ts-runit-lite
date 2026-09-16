import express from "express";
import supertest from "supertest";
import { describe, expect, it, vi } from "vitest";
import templateRoutes from "../../../api/routes/templates";

vi.mock("../../../utils/Logger", () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/templates", templateRoutes);
  return app;
}

describe("templates routes", () => {
  it("mounts as a real Express router (not the factory function)", () => {
    // Regression guard: templateRoutes must be a Router, not the
    // createTemplateRoutes(router) factory it used to export by mistake.
    expect(typeof templateRoutes).toBe("function");
    expect(typeof (templateRoutes as unknown as { get: unknown }).get).toBe(
      "function",
    );
  });

  it("lists templates (empty gallery) via GET /templates", async () => {
    const app = buildApp();

    const res = await supertest(app).get("/templates");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.templates).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("lists categories via GET /templates/categories", async () => {
    const app = buildApp();

    const res = await supertest(app).get("/templates/categories");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.categories)).toBe(true);
  });

  it("registers, fetches, instantiates, and deletes a template end-to-end", async () => {
    const app = buildApp();
    const template = {
      id: "tpl-1",
      name: "Sample Template",
      category: "demo",
      description: "test",
      definition: {
        id: "wf-from-tpl",
        name: "wf",
        startNode: "n1",
        nodes: { n1: { id: "n1", type: "action" } },
      },
    };

    const created = await supertest(app).post("/templates").send(template);
    expect(created.status).toBe(201);

    const fetched = await supertest(app).get("/templates/tpl-1");
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.template.id).toBe("tpl-1");

    const notFound = await supertest(app).get("/templates/does-not-exist");
    expect(notFound.status).toBe(404);

    const deleted = await supertest(app).delete("/templates/tpl-1");
    expect(deleted.status).toBe(200);

    const afterDelete = await supertest(app).get("/templates/tpl-1");
    expect(afterDelete.status).toBe(404);
  });

  it("returns 400 when registering a template without id or name", async () => {
    const app = buildApp();

    const res = await supertest(app).post("/templates").send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  describe("POST /templates/extract – directory confinement", () => {
    // 安全回归守卫：directory 曾被直接喂给 readdirSync/readFileSync，
    // 且文件内容会回显在响应体里，构成任意目录读取。
    const escapes = [
      ["parent traversal", "../../.."],
      ["absolute path", "/etc"],
      ["absolute path to sensitive dir", "/var/root"],
      ["traversal mixed with a valid segment", "practices-demo/../../.."],
      ["null byte injection", "practices-demo\0/etc"],
      ["sibling dir sharing the root prefix", "../tswe-evil"],
    ] as const;

    for (const [label, directory] of escapes) {
      it(`rejects ${label}`, async () => {
        const app = buildApp();

        const res = await supertest(app)
          .post("/templates/extract")
          .send({ directory });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body).not.toHaveProperty("data");
      });
    }

    it("rejects a non-string directory", async () => {
      const app = buildApp();

      const res = await supertest(app)
        .post("/templates/extract")
        .send({ directory: { toString: "evil" } });

      expect(res.status).toBe(400);
    });

    it("accepts a directory inside the root", async () => {
      const app = buildApp();

      const res = await supertest(app)
        .post("/templates/extract")
        .send({ directory: "practices-demo" });

      // 目录可能不存在，但不应是 400 —— 路径本身是合法的
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("defaults to practices-demo when no directory is given", async () => {
      const app = buildApp();

      const res = await supertest(app).post("/templates/extract").send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
