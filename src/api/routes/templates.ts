import path from "node:path";
import type { Request, Response } from "express";
import express, { type Router } from "express";
import { extractTemplatesFromDemos } from "../../templates/AutoExtract";
import {
  TemplateGallery,
  type WorkflowTemplate,
} from "../../templates/TemplateGallery";
import { Logger } from "../../utils/Logger";
import { rbacMiddleware } from "../middleware/rbac";

// Singleton instances
let gallery: TemplateGallery | null = null;

/**
 * 模板抽取的根目录。请求里的 directory 只能指向该根目录之下，
 * 避免任意目录读取（文件内容会回显在响应体中）。
 */
function getTemplateRoot(): string {
  return path.resolve(process.env.TEMPLATE_DEMO_ROOT ?? process.cwd());
}

/**
 * 把请求提供的相对目录收敛到根目录内，越界返回 null。
 *
 * 用 path.relative 判断而非 startsWith 前缀比较：后者会被同前缀的
 * 兄弟目录绕过（如 root="/srv/app" 时 "/srv/app-evil" 也能通过）。
 */
function resolveDemoDir(input: unknown): string | null {
  if (input !== undefined && typeof input !== "string") return null;

  const requested =
    input === undefined || input === "" ? "practices-demo" : input;
  if (requested.includes("\0")) return null;

  const root = getTemplateRoot();
  const resolved = path.resolve(root, requested);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function getGallery(): TemplateGallery {
  if (!gallery) {
    gallery = new TemplateGallery();
  }
  return gallery;
}

const router: Router = express.Router();

// GET /workflow-api/v1/templates - List all templates
router.get("/", (req: Request, res: Response) => {
  try {
    const g = getGallery();
    const { category, tag, search } = req.query;

    let templates: WorkflowTemplate[];

    if (search) {
      const results = g.search(search as string);
      templates = results.map((r) => ({
        ...r.template,
        relevanceScore: r.score,
      }));
    } else if (category) {
      templates = g.listByCategory(category as string);
    } else if (tag) {
      templates = g.searchByTags([tag as string]);
    } else {
      templates = g.listAll();
    }

    res.json({
      success: true,
      data: {
        templates,
        total: templates.length,
        stats: g.getStats(),
      },
    });
  } catch (err: unknown) {
    Logger.error(
      "api",
      "templates",
      "Failed to list templates",
      err instanceof Error ? err.message : String(err),
    );
    res.status(500).json({ success: false, error: "Failed to list templates" });
  }
});

// GET /workflow-api/v1/templates/categories - List categories
router.get("/categories", (_req: Request, res: Response) => {
  try {
    const g = getGallery();
    const categories = g.listCategories();

    res.json({
      success: true,
      data: { categories },
    });
  } catch (_err: unknown) {
    res
      .status(500)
      .json({ success: false, error: "Failed to list categories" });
  }
});

// POST /workflow-api/v1/templates/extract - Extract templates from demos
router.post(
  "/extract",
  rbacMiddleware({ resource: "config", action: "write" }),
  (req: Request, res: Response) => {
    try {
      const demoDir = resolveDemoDir(req.body?.directory);
      if (demoDir === null) {
        Logger.warn(
          "api",
          "templates",
          "Rejected template extraction outside the template root",
          // 不要 String(...) 原值：攻击者可传 { toString: "evil" }，
          // 使隐式转换抛出 TypeError，把 400 变成 500。
          {
            requested:
              typeof req.body?.directory === "string"
                ? req.body.directory
                : typeof req.body?.directory,
          },
        );
        res.status(400).json({ success: false, error: "Invalid directory" });
        return;
      }

      const templates = extractTemplatesFromDemos(demoDir);

      // Register extracted templates
      const g = getGallery();
      for (const template of templates) {
        g.register(template);
      }

      res.json({
        success: true,
        data: {
          extracted: templates.length,
          templates,
        },
      });
    } catch (err: unknown) {
      Logger.error(
        "api",
        "templates",
        "Failed to extract templates",
        err instanceof Error ? err.stack : String(err),
      );
      res
        .status(500)
        .json({ success: false, error: "Failed to extract templates" });
    }
  },
);

// GET /workflow-api/v1/templates/:id - Get template by ID
router.get("/:id", (req: Request, res: Response) => {
  try {
    const g = getGallery();
    const template = g.getById(req.params.id);

    if (!template) {
      res.status(404).json({ success: false, error: "Template not found" });
      return;
    }

    res.json({
      success: true,
      data: { template },
    });
  } catch (_err: unknown) {
    res.status(500).json({ success: false, error: "Failed to get template" });
  }
});

// POST /workflow-api/v1/templates - Register a new template
router.post("/", (req: Request, res: Response) => {
  try {
    const g = getGallery();
    const template = req.body as WorkflowTemplate;

    if (!template.id || !template.name) {
      res.status(400).json({
        success: false,
        error: "Template must have id and name",
      });
      return;
    }

    g.register(template);

    res.status(201).json({
      success: true,
      data: { template },
    });
  } catch (_err: unknown) {
    res
      .status(500)
      .json({ success: false, error: "Failed to register template" });
  }
});

// POST /workflow-api/v1/templates/:id/instantiate - Instantiate template
router.post("/:id/instantiate", (req: Request, res: Response) => {
  try {
    const g = getGallery();
    const params = req.body || {};

    const definition = g.instantiate(req.params.id, params);

    res.json({
      success: true,
      data: { definition },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      res.status(404).json({ success: false, error: msg });
      return;
    }
    if (msg.includes("Missing required")) {
      res.status(400).json({ success: false, error: msg });
      return;
    }
    res
      .status(500)
      .json({ success: false, error: "Failed to instantiate template" });
  }
});

// DELETE /workflow-api/v1/templates/:id - Delete template
router.delete("/:id", (req: Request, res: Response) => {
  try {
    const g = getGallery();
    const deleted = g.unregister(req.params.id);

    if (!deleted) {
      res.status(404).json({ success: false, error: "Template not found" });
      return;
    }

    res.json({ success: true, message: "Template deleted" });
  } catch (_err: unknown) {
    res
      .status(500)
      .json({ success: false, error: "Failed to delete template" });
  }
});

export default router;
