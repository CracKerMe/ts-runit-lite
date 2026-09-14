import type { WorkflowInstance } from "../model/Instance";
import type {
  CanaryMetrics,
  PromotionRules,
  StorageProvider,
  StoredWorkflow,
} from "../storage/StorageProvider";
import { parseEnvInt } from "../utils/env";
import { Logger } from "../utils/Logger";

export interface CanaryStatus {
  publishedVersion: number;
  canaryVersion?: number;
  canaryPercent?: number;
  canaryStartedAt?: number;
  canaryMetrics?: CanaryMetrics;
}

export interface PromotionEvaluation {
  shouldPromote: boolean;
  reason: string;
}

const DEFAULT_RULES: Required<Omit<PromotionRules, "autoPromote">> = {
  minInstances: 100,
  maxErrorRate: 0.05,
  evaluationWindowMs: 60 * 60 * 1000,
};

export class CanaryReleaseManager {
  private evaluationTimer?: NodeJS.Timeout;

  constructor(
    private storage: StorageProvider,
    private engine?: {
      setActiveWorkflowVersion?: (workflowId: string, version: string) => void;
      setReleasePolicy?: (
        workflowId: string,
        policy:
          | { type: "stable" }
          | {
              type: "canary";
              baselineVersion: string;
              canaryVersion: string;
              canaryPercent: number;
            },
      ) => void;
    },
  ) {}

  async startCanaryRelease(
    workflowId: string,
    version: number,
    percent: number,
    rules?: PromotionRules,
  ): Promise<void> {
    const workflow = await this.requireWorkflow(workflowId);
    const publishedVersion = workflow.publishedVersion ?? workflow.version;
    const updated: StoredWorkflow = {
      ...workflow,
      canaryVersion: version,
      canaryPercent: percent,
      canaryStartedAt: Date.now(),
      promotionRules: {
        autoPromote: rules?.autoPromote ?? false,
        minInstances: rules?.minInstances ?? DEFAULT_RULES.minInstances,
        maxErrorRate: rules?.maxErrorRate ?? DEFAULT_RULES.maxErrorRate,
        evaluationWindowMs:
          rules?.evaluationWindowMs ?? DEFAULT_RULES.evaluationWindowMs,
      },
      releasePolicy: {
        type: "canary",
        baselineVersion: publishedVersion,
        canaryVersion: version,
        canaryPercent: percent,
      },
      updatedAt: Date.now(),
    };
    await this.storage.saveWorkflowWithMetadata(updated);
    this.engine?.setReleasePolicy?.(workflowId, {
      type: "canary",
      baselineVersion: String(publishedVersion),
      canaryVersion: String(version),
      canaryPercent: percent,
    });
  }

  async promoteCanary(workflowId: string): Promise<void> {
    const workflow = await this.requireWorkflow(workflowId);
    if (!workflow.canaryVersion) {
      throw new Error(`Workflow ${workflowId} has no active canary release`);
    }
    const updated: StoredWorkflow = {
      ...workflow,
      publishedVersion: workflow.canaryVersion,
      releasePolicy: { type: "stable" },
      canaryVersion: undefined,
      canaryPercent: undefined,
      canaryStartedAt: undefined,
      promotionRules: undefined,
      updatedAt: Date.now(),
    };
    await this.storage.saveWorkflowWithMetadata(updated);
    this.engine?.setActiveWorkflowVersion?.(
      workflowId,
      String(updated.publishedVersion),
    );
    this.engine?.setReleasePolicy?.(workflowId, { type: "stable" });
  }

  async rollbackCanary(workflowId: string): Promise<void> {
    const workflow = await this.requireWorkflow(workflowId);
    const updated: StoredWorkflow = {
      ...workflow,
      releasePolicy: { type: "stable" },
      canaryVersion: undefined,
      canaryPercent: undefined,
      canaryStartedAt: undefined,
      promotionRules: undefined,
      updatedAt: Date.now(),
    };
    await this.storage.saveWorkflowWithMetadata(updated);
    if (updated.publishedVersion !== undefined) {
      this.engine?.setActiveWorkflowVersion?.(
        workflowId,
        String(updated.publishedVersion),
      );
    }
    this.engine?.setReleasePolicy?.(workflowId, { type: "stable" });
  }

  async getCanaryStatus(workflowId: string): Promise<CanaryStatus> {
    const workflow = await this.requireWorkflow(workflowId);
    return {
      publishedVersion: workflow.publishedVersion ?? workflow.version,
      canaryVersion: workflow.canaryVersion,
      canaryPercent: workflow.canaryPercent,
      canaryStartedAt: workflow.canaryStartedAt,
      canaryMetrics: workflow.canaryVersion
        ? await this.collectMetrics(workflowId, workflow)
        : undefined,
    };
  }

  async evaluatePromotion(workflowId: string): Promise<PromotionEvaluation> {
    const workflow = await this.requireWorkflow(workflowId);
    if (!workflow.canaryVersion || !workflow.canaryStartedAt) {
      return { shouldPromote: false, reason: "No active canary release" };
    }
    const rules = {
      autoPromote: workflow.promotionRules?.autoPromote ?? false,
      minInstances:
        workflow.promotionRules?.minInstances ?? DEFAULT_RULES.minInstances,
      maxErrorRate:
        workflow.promotionRules?.maxErrorRate ?? DEFAULT_RULES.maxErrorRate,
      evaluationWindowMs:
        workflow.promotionRules?.evaluationWindowMs ??
        DEFAULT_RULES.evaluationWindowMs,
    };
    const metrics = await this.collectMetrics(workflowId, workflow);
    const elapsed = Date.now() - workflow.canaryStartedAt;

    if (metrics.totalInstances < rules.minInstances) {
      if (elapsed > rules.evaluationWindowMs) {
        if (rules.autoPromote) {
          await this.rollbackCanary(workflowId);
        }
        return { shouldPromote: false, reason: "Evaluation window expired" };
      }
      return { shouldPromote: false, reason: "Not enough canary instances" };
    }

    if (metrics.errorRate > rules.maxErrorRate) {
      if (rules.autoPromote) {
        await this.rollbackCanary(workflowId);
      }
      return { shouldPromote: false, reason: "Error rate too high" };
    }

    if (elapsed < rules.evaluationWindowMs) {
      return { shouldPromote: false, reason: "Evaluation window not reached" };
    }

    if (rules.autoPromote) {
      await this.promoteCanary(workflowId);
    }
    return { shouldPromote: true, reason: "Canary metrics satisfied" };
  }

  startEvaluationLoop(
    intervalMs = parseEnvInt(process.env.CANARY_EVAL_INTERVAL_MS, 60000, {
      min: 1000,
    }),
  ): void {
    if (this.evaluationTimer) return;
    this.evaluationTimer = setInterval(() => {
      void this.evaluateActiveCanaries();
    }, intervalMs);
  }

  stopEvaluationLoop(): void {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = undefined;
    }
  }

  private async evaluateActiveCanaries(): Promise<void> {
    const workflows = await this.storage.listWorkflowsWithMetadata();
    for (const workflow of workflows) {
      if (!workflow.canaryVersion) continue;
      try {
        await this.evaluatePromotion(workflow.id);
      } catch (error) {
        Logger.error(
          "system",
          "canary",
          `Failed to evaluate canary for ${workflow.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  private async requireWorkflow(workflowId: string): Promise<StoredWorkflow> {
    const workflow = await this.storage.loadWorkflowWithMetadata(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    return workflow;
  }

  private async collectMetrics(
    workflowId: string,
    workflow: StoredWorkflow,
  ): Promise<CanaryMetrics> {
    const startedAt = workflow.canaryStartedAt ?? 0;
    const instances = await this.loadInstancesForWorkflow(workflowId);
    const canaryInstances = instances.filter(
      (instance) =>
        instance.workflowVersion === String(workflow.canaryVersion) &&
        instance.createdAt.getTime() >= startedAt,
    );
    const failures = canaryInstances.filter(
      (instance) => instance.status === "failed",
    ).length;
    const totalDurationMs = canaryInstances.reduce((sum, instance) => {
      return (
        sum + (instance.updatedAt.getTime() - instance.createdAt.getTime())
      );
    }, 0);
    return {
      totalInstances: canaryInstances.length,
      errorRate:
        canaryInstances.length === 0 ? 0 : failures / canaryInstances.length,
      avgDurationMs:
        canaryInstances.length === 0
          ? 0
          : totalDurationMs / canaryInstances.length,
    };
  }

  private async loadInstancesForWorkflow(
    workflowId: string,
  ): Promise<WorkflowInstance[]> {
    const result = await this.storage.queryInstances({
      workflowId,
      page: 1,
      pageSize: 10000,
    });
    return result.instances;
  }
}
