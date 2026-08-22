import { type Request, type Response, Router } from "express";
import { AnalyticsCollector } from "../../metrics/AnalyticsCollector";
import { AnomalyDetector } from "../../metrics/AnomalyDetector";
import { SlaMonitor } from "../../metrics/SlaMonitor";
import { Logger } from "../../utils/Logger";

// Singleton instances
const analyticsCollector = new AnalyticsCollector();
const anomalyDetector = new AnomalyDetector();
const slaMonitor = new SlaMonitor();

const router: Router = Router();
// GET /workflow-api/v1/analytics/overview - Global analytics overview
router.get("/overview", async (_req: Request, res: Response) => {
  try {
    const stats = {
      eventCount: analyticsCollector.getEventCount(),
      anomalyCount: anomalyDetector.detectAll([]).length,
      slaViolations: slaMonitor.getViolations().length,
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (err: unknown) {
    Logger.error(
      "api",
      "analytics",
      "Failed to get overview",
      err instanceof Error ? err.message : String(err),
    );
    res.status(500).json({ success: false, error: "Failed to get overview" });
  }
});

// GET /workflow-api/v1/analytics/workflow/:id - Workflow analytics
router.get("/workflow/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const windowMs = req.query.window ? Number(req.query.window) : undefined;

    const analytics = await analyticsCollector.aggregate(id, windowMs);
    const slaStatus = slaMonitor.getStatus(id);

    res.json({
      success: true,
      data: {
        analytics,
        sla: slaStatus,
      },
    });
  } catch (err: unknown) {
    Logger.error(
      "api",
      "analytics",
      "Failed to get workflow analytics",
      err instanceof Error ? err.message : String(err),
    );
    res.status(500).json({ success: false, error: "Failed to get analytics" });
  }
});

// GET /workflow-api/v1/analytics/nodes/:id - Node analytics
router.get("/nodes/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const workflowId = req.query.workflowId as string;
    const windowMs = req.query.window ? Number(req.query.window) : undefined;

    if (!workflowId) {
      res.status(400).json({
        success: false,
        error: "workflowId query parameter is required",
      });
      return;
    }

    const analytics = await analyticsCollector.aggregateByNode(
      workflowId,
      id,
      windowMs,
    );

    res.json({
      success: true,
      data: { analytics },
    });
  } catch (_err: unknown) {
    res
      .status(500)
      .json({ success: false, error: "Failed to get node analytics" });
  }
});

// GET /workflow-api/v1/analytics/anomalies - Anomaly list
router.get("/anomalies", async (req: Request, res: Response) => {
  try {
    const { workflowId } = req.query;

    // Get events for the workflow (simplified)
    const anomalies = anomalyDetector.detectAll([]);

    const filtered = workflowId
      ? anomalies.filter((a) => a.workflowId === workflowId)
      : anomalies;

    res.json({
      success: true,
      data: {
        anomalies: filtered,
        total: filtered.length,
      },
    });
  } catch (_err: unknown) {
    res.status(500).json({ success: false, error: "Failed to get anomalies" });
  }
});

// GET /workflow-api/v1/analytics/sla - SLA status
router.get("/sla", async (req: Request, res: Response) => {
  try {
    const { workflowId } = req.query;

    const rules = slaMonitor.getRules(workflowId as string | undefined);
    const violations = slaMonitor.getViolations(
      workflowId as string | undefined,
    );

    res.json({
      success: true,
      data: {
        rules,
        violations,
        healthy:
          violations.filter((v) => v.detectedAt > Date.now() - 60 * 60 * 1000)
            .length === 0,
      },
    });
  } catch (_err: unknown) {
    res.status(500).json({ success: false, error: "Failed to get SLA status" });
  }
});

// POST /workflow-api/v1/analytics/sla - Create SLA rule
router.post("/sla", async (req: Request, res: Response) => {
  try {
    const rule = req.body;

    if (!rule.id || !rule.workflowId || !rule.metric || !rule.threshold) {
      res.status(400).json({
        success: false,
        error: "Missing required fields: id, workflowId, metric, threshold",
      });
      return;
    }

    slaMonitor.addRule(rule);

    res.status(201).json({
      success: true,
      data: { rule },
    });
  } catch (_err: unknown) {
    res
      .status(500)
      .json({ success: false, error: "Failed to create SLA rule" });
  }
});

// DELETE /workflow-api/v1/analytics/sla/:id - Delete SLA rule
router.delete("/sla/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    slaMonitor.removeRule(id);

    res.json({ success: true, message: "SLA rule removed" });
  } catch (_err: unknown) {
    res
      .status(500)
      .json({ success: false, error: "Failed to delete SLA rule" });
  }
});

export default router;

// Export singletons for testing
export { analyticsCollector, anomalyDetector, slaMonitor };
