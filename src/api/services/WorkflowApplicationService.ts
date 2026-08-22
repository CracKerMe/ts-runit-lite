/**
 * WorkflowApplicationService — business logic extracted from routes/workflows.ts.
 *
 * This service owns all workflow CRUD, versioning, import/export, and DSL operations.
 * The route layer is responsible only for HTTP parsing/validation and response formatting.
 */
import { DSLParseError, parseDSL } from "../../dsl/DSLParser";
import { SchemaValidator } from "../../engine/SchemaValidator";
import type { WorkflowDefinition } from "../../model/Workflow";
import type {
  StorageProvider,
  StoredWorkflow,
  StoredWorkflowVersion,
} from "../../storage/StorageProvider";
import { Logger } from "../../utils/Logger";

// ─── Types ───────────────────────────────────────────────────────────

export interface CreateWorkflowInput {
  id: string;
  name: string;
  description?: string;
  definition: WorkflowDefinition;
  tags?: string[];
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  definition?: WorkflowDefinition;
  tags?: string[];
}

export interface ImportWorkflowInput {
  definition: WorkflowDefinition;
  name?: string;
  description?: string;
  tags?: string[];
  overwrite?: boolean;
}

export interface ImportDslInput {
  dsl: string;
  name?: string;
  description?: string;
  tags?: string[];
  overwrite?: boolean;
}

export interface WorkflowListResult {
  workflows: StoredWorkflow[];
  total: number;
}

export interface WorkflowVersionListResult {
  versions: StoredWorkflowVersion[];
  activeVersion?: string;
  lockedVersion?: string;
}

export interface PublishWorkflowInput {
  version?: number;
  canary?: {
    percent: number;
    rules?: {
      autoPromote?: boolean;
      minInstances?: number;
      maxErrorRate?: number;
      evaluationWindowMs?: number;
    };
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string; code: string }>;
  warnings: Array<{ path: string; message: string; code: string }>;
}

// ─── Service ─────────────────────────────────────────────────────────

export class WorkflowApplicationService {
  private schemaValidator = new SchemaValidator();

  constructor(private storage: StorageProvider | null) {}

  // ─── CRUD ────────────────────────────────────────────────────────

  async createWorkflow(input: CreateWorkflowInput): Promise<StoredWorkflow> {
    if (!this.storage) {
      throw new ServiceError(
        500,
        "STORAGE_UNAVAILABLE",
        "Storage not available",
      );
    }

    const existing = await this.storage.loadWorkflowWithMetadata(input.id);
    if (existing) {
      throw new ServiceError(
        409,
        "WORKFLOW_EXISTS",
        `Workflow with ID ${input.id} already exists`,
      );
    }

    const validation = this.schemaValidator.validate(input.definition);
    if (!validation.valid) {
      throw new ServiceError(
        400,
        "VALIDATION_FAILED",
        "Workflow definition validation failed",
        {
          errors: validation.errors,
          warnings: validation.warnings,
        },
      );
    }

    const now = Date.now();
    const stored: StoredWorkflow = {
      id: input.id,
      name: input.name,
      description: input.description,
      definition: input.definition,
      version: 1,
      createdAt: now,
      updatedAt: now,
      tags: input.tags,
    };

    await this.storage.saveWorkflowWithMetadata(stored);
    await this.registerWorkflow(stored);

    Logger.info("api", "workflow-service", `Created workflow ${input.id}`);
    return stored;
  }

  async getWorkflow(workflowId: string): Promise<StoredWorkflow> {
    if (!this.storage) {
      throw new ServiceError(
        500,
        "STORAGE_UNAVAILABLE",
        "Storage not available",
      );
    }

    const workflow = await this.storage.loadWorkflowWithMetadata(workflowId);
    if (!workflow) {
      throw new ServiceError(
        404,
        "NOT_FOUND",
        `Workflow with ID ${workflowId} not found`,
      );
    }
    return workflow;
  }

  async listWorkflows(): Promise<WorkflowListResult> {
    if (!this.storage) {
      return { workflows: [], total: 0 };
    }

    const workflowIds = await this.storage.listWorkflows();
    const workflows: StoredWorkflow[] = [];

    for (const id of workflowIds) {
      const w = await this.storage.loadWorkflowWithMetadata(id);
      if (w) workflows.push(w);
    }

    return { workflows, total: workflows.length };
  }

  async updateWorkflow(
    workflowId: string,
    input: UpdateWorkflowInput,
  ): Promise<StoredWorkflow> {
    if (!this.storage) {
      throw new ServiceError(
        500,
        "STORAGE_UNAVAILABLE",
        "Storage not available",
      );
    }

    const existing = await this.storage.loadWorkflowWithMetadata(workflowId);
    if (!existing) {
      throw new ServiceError(
        404,
        "NOT_FOUND",
        `Workflow with ID ${workflowId} not found`,
      );
    }

    if (input.definition) {
      const validation = this.schemaValidator.validate(input.definition);
      if (!validation.valid) {
        throw new ServiceError(
          400,
          "VALIDATION_FAILED",
          "Workflow definition validation failed",
          {
            errors: validation.errors,
            warnings: validation.warnings,
          },
        );
      }
    }

    const updated: StoredWorkflow = {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      ...(input.definition !== undefined && { definition: input.definition }),
      ...(input.tags !== undefined && { tags: input.tags }),
      version: existing.version + 1,
      updatedAt: Date.now(),
    };

    await this.storage.saveWorkflowWithMetadata(updated);
    Logger.info(
      "api",
      "workflow-service",
      `Updated workflow ${workflowId} to v${updated.version}`,
    );
    return updated;
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    if (!this.storage) {
      throw new ServiceError(
        500,
        "STORAGE_UNAVAILABLE",
        "Storage not available",
      );
    }

    const existing = await this.storage.loadWorkflowWithMetadata(workflowId);
    if (!existing) {
      throw new ServiceError(
        404,
        "NOT_FOUND",
        `Workflow with ID ${workflowId} not found`,
      );
    }

    await this.storage.deleteWorkflow(workflowId);
    Logger.info("api", "workflow-service", `Deleted workflow ${workflowId}`);
  }

  // ─── Version Management ──────────────────────────────────────────

  async listVersions(workflowId: string): Promise<{
    versions: number[];
    activeVersion?: number;
    lockedVersion?: number;
  }> {
    if (!this.storage) {
      throw new ServiceError(
        500,
        "STORAGE_UNAVAILABLE",
        "Storage not available",
      );
    }

    const workflow = await this.storage.loadWorkflowWithMetadata(workflowId);
    if (!workflow) {
      throw new ServiceError(
        404,
        "NOT_FOUND",
        `Workflow with ID ${workflowId} not found`,
      );
    }

    const versions = await this.storage.listWorkflowVersions(workflowId);
    return {
      versions,
      activeVersion: workflow.publishedVersion,
      lockedVersion: workflow.lockedVersion,
    };
  }

  async publishWorkflow(
    workflowId: string,
    input: PublishWorkflowInput,
  ): Promise<StoredWorkflow> {
    if (!this.storage) {
      throw new ServiceError(
        500,
        "STORAGE_UNAVAILABLE",
        "Storage not available",
      );
    }

    const workflow = await this.storage.loadWorkflowWithMetadata(workflowId);
    if (!workflow) {
      throw new ServiceError(
        404,
        "NOT_FOUND",
        `Workflow with ID ${workflowId} not found`,
      );
    }

    const versions = await this.storage.listWorkflowVersions(workflowId);
    const latest =
      versions.length > 0 ? versions[versions.length - 1] : undefined;
    const targetVersion = input.version ?? latest;

    if (!targetVersion || !versions.includes(targetVersion)) {
      throw new ServiceError(
        404,
        "VERSION_NOT_FOUND",
        "Target version not found",
      );
    }

    const updated: StoredWorkflow = input.canary?.percent
      ? {
          ...workflow,
          canaryVersion: targetVersion,
          canaryPercent: input.canary.percent,
          canaryStartedAt: Date.now(),
          promotionRules: {
            autoPromote: input.canary.rules?.autoPromote ?? false,
            minInstances: input.canary.rules?.minInstances,
            maxErrorRate: input.canary.rules?.maxErrorRate,
            evaluationWindowMs: input.canary.rules?.evaluationWindowMs,
          },
          updatedAt: Date.now(),
        }
      : {
          ...workflow,
          publishedVersion: targetVersion,
          updatedAt: Date.now(),
        };

    await this.storage.saveWorkflowWithMetadata(updated);
    Logger.info(
      "api",
      "workflow-service",
      `Published workflow ${workflowId} v${targetVersion}`,
    );
    return updated;
  }

  async lockWorkflow(
    workflowId: string,
    version?: number,
  ): Promise<StoredWorkflow> {
    if (!this.storage) {
      throw new ServiceError(
        500,
        "STORAGE_UNAVAILABLE",
        "Storage not available",
      );
    }

    const workflow = await this.storage.loadWorkflowWithMetadata(workflowId);
    if (!workflow) {
      throw new ServiceError(
        404,
        "NOT_FOUND",
        `Workflow with ID ${workflowId} not found`,
      );
    }

    if (workflow.lockedVersion) {
      throw new ServiceError(
        409,
        "ALREADY_LOCKED",
        "Workflow is already locked",
      );
    }

    const lockVersion = version ?? workflow.publishedVersion;
    const updated: StoredWorkflow = {
      ...workflow,
      lockedVersion: lockVersion,
      updatedAt: Date.now(),
    };

    await this.storage.saveWorkflowWithMetadata(updated);
    Logger.info(
      "api",
      "workflow-service",
      `Locked workflow ${workflowId} to v${lockVersion}`,
    );
    return updated;
  }

  async unlockWorkflow(workflowId: string): Promise<StoredWorkflow> {
    if (!this.storage) {
      throw new ServiceError(
        500,
        "STORAGE_UNAVAILABLE",
        "Storage not available",
      );
    }

    const workflow = await this.storage.loadWorkflowWithMetadata(workflowId);
    if (!workflow) {
      throw new ServiceError(
        404,
        "NOT_FOUND",
        `Workflow with ID ${workflowId} not found`,
      );
    }

    const updated: StoredWorkflow = {
      ...workflow,
      lockedVersion: undefined,
      updatedAt: Date.now(),
    };

    await this.storage.saveWorkflowWithMetadata(updated);
    Logger.info("api", "workflow-service", `Unlocked workflow ${workflowId}`);
    return updated;
  }

  // ─── Import / Export ─────────────────────────────────────────────

  async importWorkflow(input: ImportWorkflowInput): Promise<StoredWorkflow> {
    if (!this.storage) {
      throw new ServiceError(
        500,
        "STORAGE_UNAVAILABLE",
        "Storage not available",
      );
    }

    const workflowId = input.definition.id;
    const workflowName = input.name ?? input.definition.name;

    if (!workflowId || !workflowName) {
      throw new ServiceError(
        400,
        "INVALID_INPUT",
        "Workflow id and name are required",
      );
    }

    const validation = this.schemaValidator.validate(input.definition);
    if (!validation.valid) {
      throw new ServiceError(
        400,
        "VALIDATION_FAILED",
        "Workflow definition validation failed",
        {
          errors: validation.errors,
          warnings: validation.warnings,
        },
      );
    }

    const existing = await this.storage.loadWorkflowWithMetadata(workflowId);
    if (existing && !input.overwrite) {
      throw new ServiceError(
        409,
        "WORKFLOW_EXISTS",
        `Workflow with ID ${workflowId} already exists`,
      );
    }

    const now = Date.now();
    const stored: StoredWorkflow = {
      id: workflowId,
      name: workflowName,
      description: input.description ?? input.definition.description,
      definition: input.definition,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      tags: input.tags,
    };

    await this.storage.saveWorkflowWithMetadata(stored);
    Logger.info("api", "workflow-service", `Imported workflow ${workflowId}`);
    return stored;
  }

  async importDsl(input: ImportDslInput): Promise<StoredWorkflow> {
    let parsedDefinition: WorkflowDefinition;
    try {
      parsedDefinition = parseDSL(input.dsl);
    } catch (err) {
      if (err instanceof DSLParseError) {
        throw new ServiceError(
          400,
          "DSL_PARSE_ERROR",
          `DSL parse error: ${err.message}`,
        );
      }
      throw err;
    }

    const workflowDefinition: WorkflowDefinition = {
      ...parsedDefinition,
      name: input.name ?? parsedDefinition.name,
      description: input.description ?? parsedDefinition.description,
    };

    return this.importWorkflow({
      definition: workflowDefinition,
      name: input.name,
      description: input.description,
      tags: input.tags,
      overwrite: input.overwrite,
    });
  }

  async exportWorkflow(workflowId: string): Promise<StoredWorkflow> {
    return this.getWorkflow(workflowId);
  }

  // ─── Validation ──────────────────────────────────────────────────

  validateDefinition(definition: WorkflowDefinition): ValidationResult {
    const result = this.schemaValidator.validate(definition);
    return {
      valid: result.valid,
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private async registerWorkflow(_stored: StoredWorkflow): Promise<void> {
    // Registration is handled by the engine if available
    // This is a placeholder for future engine integration
  }
}

// ─── Error Type ────────────────────────────────────────────────────────

export class ServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
