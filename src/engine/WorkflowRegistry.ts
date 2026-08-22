// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import type { EventBus } from "../event/EventBus";
import type { WorkflowDefinition } from "../model/Workflow";
import type {
  CronScheduler,
  CronStartableEngine,
} from "../scheduler/CronScheduler";
import { Logger } from "../utils/Logger";

export type ReleasePolicy =
  | { type: "stable" }
  | {
      type: "canary";
      baselineVersion: string;
      canaryVersion: string;
      canaryPercent: number;
    };

export class WorkflowRegistry {
  private workflows = new Map<string, Map<string, WorkflowDefinition>>();
  private activeVersions = new Map<string, string>();
  private lockedVersions = new Map<string, string>();
  private releasePolicies = new Map<string, ReleasePolicy>();
  private registeredEvents = new Map<string, Set<string>>();
  private registeredCron = new Map<string, string>();

  constructor(
    private scheduler?: CronScheduler,
    private eventBus?: EventBus,
  ) {}

  async register(
    workflow: WorkflowDefinition,
    startWorkflow: (
      workflowId: string,
      context: Record<string, any>,
    ) => Promise<string>,
    options?: { version?: string; setActive?: boolean },
  ): Promise<void> {
    const version = options?.version ?? workflow.version ?? "1";
    const versions = this.workflows.get(workflow.id) || new Map();
    versions.set(version, workflow);
    this.workflows.set(workflow.id, versions);

    if (!this.activeVersions.has(workflow.id) || options?.setActive) {
      this.activeVersions.set(workflow.id, version);
    }

    Logger.info(
      "system",
      "registry",
      `Workflow ${workflow.id} registered in memory`,
    );

    if (workflow.cron && this.scheduler) {
      const existingCron = this.registeredCron.get(workflow.id);
      if (existingCron !== workflow.cron) {
        const cronEngine: CronStartableEngine = { start: startWorkflow };
        this.scheduler.scheduleJob(workflow.id, workflow.cron, cronEngine);
        this.registeredCron.set(workflow.id, workflow.cron);
      }
    }

    if (workflow.triggerEvents && this.eventBus) {
      const eventBus = this.eventBus;
      const registered = this.registeredEvents.get(workflow.id) || new Set();
      workflow.triggerEvents.forEach((event) => {
        if (registered.has(event)) return;
        const handler = (data: any) => {
          if (!data || !data.instanceId) {
            startWorkflow(workflow.id, data).catch((err) =>
              Logger.error(
                "system",
                "event",
                "Workflow start error",
                err instanceof Error ? err.stack : String(err),
              ),
            );
          }
        };
        eventBus.on(event, handler);
        registered.add(event);
      });
      this.registeredEvents.set(workflow.id, registered);
    }
  }

  getWorkflow(
    workflowId: string,
    version?: string,
  ): WorkflowDefinition | undefined {
    const resolvedVersion = this.resolveVersion(workflowId, version);
    if (!resolvedVersion) return undefined;
    const versions = this.workflows.get(workflowId);
    return versions?.get(resolvedVersion);
  }

  resolveVersion(
    workflowId: string,
    requestedVersion?: string,
  ): string | undefined {
    const versions = this.workflows.get(workflowId);
    if (!versions || versions.size === 0) return undefined;

    const locked = this.lockedVersions.get(workflowId);
    if (locked && versions.has(locked)) {
      return locked;
    }

    if (requestedVersion && versions.has(requestedVersion)) {
      return requestedVersion;
    }

    const policy = this.releasePolicies.get(workflowId);
    if (policy?.type === "canary") {
      const canary = policy.canaryVersion;
      const baseline = policy.baselineVersion;
      const percent = Math.max(0, Math.min(100, policy.canaryPercent));
      const pickCanary = Math.random() * 100 < percent;
      if (pickCanary && versions.has(canary)) {
        return canary;
      }
      if (versions.has(baseline)) {
        return baseline;
      }
    }

    const active = this.activeVersions.get(workflowId);
    if (active && versions.has(active)) {
      return active;
    }

    const ordered = Array.from(versions.keys()).sort((a, b) => {
      const numA = Number.parseFloat(a);
      const numB = Number.parseFloat(b);
      if (Number.isFinite(numA) && Number.isFinite(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b);
    });
    return ordered[ordered.length - 1];
  }

  listWorkflows(): string[] {
    return Array.from(this.workflows.keys());
  }

  listVersions(workflowId: string): string[] {
    const versions = this.workflows.get(workflowId);
    return versions ? Array.from(versions.keys()) : [];
  }

  setActiveVersion(workflowId: string, version: string): void {
    if (this.workflows.get(workflowId)?.has(version)) {
      this.activeVersions.set(workflowId, version);
    }
  }

  getActiveVersion(workflowId: string): string | undefined {
    return this.activeVersions.get(workflowId);
  }

  setLockedVersion(workflowId: string, version: string): void {
    if (this.workflows.get(workflowId)?.has(version)) {
      this.lockedVersions.set(workflowId, version);
    }
  }

  clearLockedVersion(workflowId: string): void {
    this.lockedVersions.delete(workflowId);
  }

  getLockedVersion(workflowId: string): string | undefined {
    return this.lockedVersions.get(workflowId);
  }

  setReleasePolicy(workflowId: string, policy: ReleasePolicy): void {
    this.releasePolicies.set(workflowId, policy);
  }

  getReleasePolicy(workflowId: string): ReleasePolicy | undefined {
    return this.releasePolicies.get(workflowId);
  }

  hasWorkflow(workflowId: string): boolean {
    return this.workflows.has(workflowId);
  }
}
