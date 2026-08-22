// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import type { WorkflowDefinition } from "../model/Workflow";
import type { StorageProvider } from "../storage/StorageProvider";
import type { WorkflowRegistry } from "./WorkflowRegistry";

export class WorkflowPersistenceCoordinator {
  constructor(
    private readonly storage: StorageProvider,
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly startWorkflow: (
      workflowId: string,
      context: Record<string, any>,
    ) => Promise<string>,
  ) {}

  async restorePersistedWorkflows(): Promise<void> {
    if (!this.storage?.listWorkflowsWithMetadata) {
      return;
    }

    const workflows = await this.storage.listWorkflowsWithMetadata();
    for (const workflow of workflows) {
      await this.workflowRegistry.register(
        workflow.definition,
        (workflowId, context) => this.startWorkflow(workflowId, context),
        {
          version: workflow.version.toString(),
          setActive:
            workflow.publishedVersion === undefined ||
            workflow.publishedVersion === workflow.version,
        },
      );
      if (workflow.releasePolicy) {
        if (workflow.releasePolicy.type === "canary") {
          this.workflowRegistry.setReleasePolicy(workflow.id, {
            type: "canary",
            baselineVersion: workflow.releasePolicy.baselineVersion.toString(),
            canaryVersion: workflow.releasePolicy.canaryVersion.toString(),
            canaryPercent: workflow.releasePolicy.canaryPercent,
          });
        } else {
          this.workflowRegistry.setReleasePolicy(workflow.id, {
            type: "stable",
          });
        }
      }
      if (workflow.lockedVersion !== undefined) {
        this.workflowRegistry.setLockedVersion(
          workflow.id,
          workflow.lockedVersion.toString(),
        );
      }
    }
  }

  async hydrateWorkflowFromStorage(workflowId: string): Promise<void> {
    if (!this.storage?.loadWorkflowWithMetadata) {
      return;
    }

    const storedWorkflow =
      await this.storage.loadWorkflowWithMetadata(workflowId);
    if (!storedWorkflow) {
      return;
    }

    await this.workflowRegistry.register(
      storedWorkflow.definition,
      (nextWorkflowId, context) => this.startWorkflow(nextWorkflowId, context),
      {
        version: storedWorkflow.version.toString(),
        setActive:
          storedWorkflow.publishedVersion === undefined ||
          storedWorkflow.publishedVersion === storedWorkflow.version,
      },
    );
  }

  async persistWorkflowDefinition(
    workflow: WorkflowDefinition,
    explicitVersion?: string,
  ): Promise<void> {
    const existing = await this.storage.loadWorkflowWithMetadata(workflow.id);
    const now = Date.now();
    const requestedVersion = Number.parseInt(
      explicitVersion ?? workflow.version ?? "",
      10,
    );
    const version =
      Number.isFinite(requestedVersion) && requestedVersion > 0
        ? requestedVersion
        : (existing?.version ?? 0) + 1;

    if (existing?.version === version) {
      return;
    }

    const storedWorkflow = {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      definition: workflow,
      version,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      tags: existing?.tags,
      metadata: workflow.metadata,
      publishedVersion: existing?.publishedVersion ?? version,
      lockedVersion: existing?.lockedVersion,
      releasePolicy: existing?.releasePolicy,
    };

    await this.storage.saveWorkflow(workflow);
    await this.storage.saveWorkflowWithMetadata(storedWorkflow);
    await this.storage.saveWorkflowVersion({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      definition: workflow,
      version,
      createdAt: now,
      tags: existing?.tags,
      metadata: workflow.metadata,
    });
  }
}
