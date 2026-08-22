import { type Router as ExpressRouter, Router } from "express";
import { registerAnalysisRoutes } from "./analysis";
import { registerCrudRoutes } from "./crud";
import { registerExecutionRoutes } from "./execution";
import { registerGraphRoutes } from "./graph";
import { registerImportRoutes } from "./import";
import { registerVariableRoutes } from "./variables";
import { registerVersioningRoutes } from "./versioning";

const router: ExpressRouter = Router();

// Literal routes first to avoid /:id wildcard shadowing
registerCrudRoutes(router); // GET /, POST /, GET /schema, GET /node-templates, GET /templates, GET /:id, PUT /:id, DELETE /:id
registerImportRoutes(router); // POST /import/dsl, POST /import/template, POST /import, GET /:id/export
registerAnalysisRoutes(router); // GET /:id/impact
registerVersioningRoutes(router); // GET /:id/versions, POST /:id/publish, etc.
registerExecutionRoutes(router); // POST /:id/validate, POST /:id/dry-run, POST /:id/start, GET /:id/instances, POST /:id/test/generate
registerGraphRoutes(router); // GET /:id/graph, PUT /:id/graph
registerVariableRoutes(router); // GET /:id/variables

export default router;
