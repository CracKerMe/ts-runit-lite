/**
 * InstanceApplicationService — business logic extracted from routes/instances.ts.
 *
 * This service owns all instance lifecycle, messaging (Signal/Query/Update),
 * and debug operations. The route layer handles only HTTP concerns.
 */
import { randomUUID } from "node:crypto";
import type { WorkflowEngine } from "../../engine/WorkflowEngine";
import type { WorkflowInstance } from "../../model/Instance";
import type { WorkflowDefinition } from "../../model/Workflow";
import type {
  InstanceSortField,
  InstanceSortOrder,
  StorageProvider,
} from "../../storage/StorageProvider";
import { Logger } from "../../utils/Logger";
import { ServiceError } from "./WorkflowApplicationService";

// ─── Types ───────────────────────────────────────────────────────────

export interface InstanceListParams {
  workflowId?: string;
  status?: string;
  startTime?: number;
  endTime?: number;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  parentId?: string;
}

export interface InstanceListResult {
  instances: InstanceSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InstanceSummary {
  id: string;
  workflowId: string;
  status: WorkflowInstance["status"];
  progress: number;
  createdAt: Date;
  updatedAt: Date;
  traceId?: string;
}

export interface InstanceDetail extends WorkflowInstance {
  totalNodes: number;
  completedNodes: number;
  progress: number;
}

export interface SignalResult {
  instanceId: string;
  eventType: string;
  result: unknown;
}

export interface QueryResult {
  instanceId: string;
  name: string;
  result: unknown;
}

export interface UpdateResult {
  instanceId: string;
  name: string;
  correlationId: string;
  result: unknown;
}

export interface LifecycleResult {
  instanceId: string;
  action: string;
  success: boolean;
}

// ─── Service ─────────────────────────────────────────────────────────

export class InstanceApplicationService {
  constructor(
    private engine: WorkflowEngine,
    private storage: StorageProvider | null,
  ) {}

  // ─── List / Search ───────────────────────────────────────────────

  async listInstances(params: InstanceListParams): Promise<InstanceListResult> {
    if (!this.storage) {
      throw new ServiceError(
        503,
        "STORAGE_UNAVAILABLE",
        "Storage not available",
      );
    }

    // Sorting is delegated to the storage layer so that it runs *before*
    // pagination — sorting an already-sliced page returns the wrong rows.
    const { instances, total } = await this.storage.queryInstances({
      workflowId: params.workflowId,
      status: params.status,
      startTime: params.startTime,
      endTime: params.endTime,
      page: params.page,
      pageSize: params.pageSize,
      parentInstanceId: params.parentId,
      sortBy: params.sortBy as InstanceSortField | undefined,
      sortOrder: params.sortOrder as InstanceSortOrder | undefined,
    });

    // Enrich with progress
    const summaries = await Promise.all(
      instances.map(async (inst) => this.buildSummary(inst)),
    );

    return {
      instances: summaries,
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async getInstance(instanceId: string): Promise<InstanceDetail> {
    const instance = await this.loadInstance(instanceId);
    if (!instance) {
      throw new ServiceError(
        404,
        "NOT_FOUND",
        `Instance with ID ${instanceId} not found`,
      );
    }

    const workflow = await Promise.resolve(
      this.engine.getWorkflow(instance.workflowId),
    );
    const totalNodes = getTotalNodes(workflow);
    const completedNodes = new Set(
      instance.history
        .filter((log) => log.status === "success" || log.status === "skipped")
        .map((log) => log.nodeId),
    ).size;

    return {
      ...instance,
      totalNodes,
      completedNodes,
      progress:
        totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0,
    };
  }

  // ─── Lifecycle Controls ──────────────────────────────────────────

  async pauseInstance(instanceId: string): Promise<LifecycleResult> {
    const instance = await this.loadInstance(instanceId);
    if (!instance) {
      throw new ServiceError(
        404,
        "NOT_FOUND",
        `Instance with ID ${instanceId} not found`,
      );
    }

    const success = await this.callEngineMethod("pauseInstance", instanceId);
    return { instanceId, action: "pause", success };
  }

  async resumeInstance(instanceId: string): Promise<LifecycleResult> {
    const instance = await this.loadInstance(instanceId);
    if (!instance) {
      throw new ServiceError(
        404,
        "NOT_FOUND",
        `Instance with ID ${instanceId} not found`,
      );
    }

    const success = await this.callEngineMethod("resumeInstance", instanceId);
    return { instanceId, action: "resume", success };
  }

  async cancelInstance(instanceId: string): Promise<LifecycleResult> {
    const instance = await this.loadInstance(instanceId);
    if (!instance) {
      throw new ServiceError(
        404,
        "NOT_FOUND",
        `Instance with ID ${instanceId} not found`,
      );
    }

    const success = await this.callEngineMethod("cancelInstance", instanceId);
    return { instanceId, action: "cancel", success };
  }

  async terminateInstance(instanceId: string): Promise<LifecycleResult> {
    const instance = await this.loadInstance(instanceId);
    if (!instance) {
      throw new ServiceError(
        404,
        "NOT_FOUND",
        `Instance with ID ${instanceId} not found`,
      );
    }

    const success = await this.callEngineMethod(
      "terminateInstance",
      instanceId,
    );
    return { instanceId, action: "terminate", success };
  }

  // ─── Messaging ───────────────────────────────────────────────────

  async signalInstance(
    instanceId: string,
    eventType: string,
    payload?: unknown,
  ): Promise<SignalResult> {
    // Check existence but don't block on failure — engine is source of truth
    const instance = await this.loadInstance(instanceId);
    if (!instance) {
      // Try the operation anyway — engine may know the instance
      try {
        await this.engine.signal(instanceId, eventType, payload);
        return { instanceId, eventType, result: undefined };
      } catch (err) {
        if (err instanceof ServiceError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("not found")) {
          throw new ServiceError(
            404,
            "NOT_FOUND",
            `Instance with ID ${instanceId} not found`,
          );
        }
        throw new ServiceError(500, "SIGNAL_ERROR", msg);
      }
    }

    const result = await this.engine.signal(instanceId, eventType, payload);
    return { instanceId, eventType, result };
  }

  async queryInstance(
    instanceId: string,
    name: string,
    payload?: unknown,
  ): Promise<QueryResult> {
    const instance = await this.loadInstance(instanceId);
    if (!instance) {
      try {
        const result = await this.engine.query(instanceId, name, payload);
        return { instanceId, name, result };
      } catch (err) {
        if (err instanceof ServiceError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("not found")) {
          throw new ServiceError(
            404,
            "NOT_FOUND",
            `Instance with ID ${instanceId} not found`,
          );
        }
        throw new ServiceError(500, "QUERY_ERROR", msg);
      }
    }

    const result = await this.engine.query(instanceId, name, payload);
    return { instanceId, name, result };
  }

  async updateInstance(
    instanceId: string,
    name: string,
    payload?: unknown,
    correlationId?: string,
  ): Promise<UpdateResult> {
    const instance = await this.loadInstance(instanceId);
    if (!instance) {
      try {
        const cid = correlationId ?? randomUUID();
        const result = await this.engine.update(instanceId, name, payload, cid);
        return { instanceId, name, correlationId: cid, result };
      } catch (err) {
        if (err instanceof ServiceError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("not found")) {
          throw new ServiceError(
            404,
            "NOT_FOUND",
            `Instance with ID ${instanceId} not found`,
          );
        }
        if (msg.includes("Cannot update")) {
          throw new ServiceError(409, "CONFLICT", msg);
        }
        throw new ServiceError(500, "UPDATE_ERROR", msg);
      }
    }

    const cid = correlationId ?? randomUUID();
    const result = await this.engine.update(instanceId, name, payload, cid);
    return { instanceId, name, correlationId: cid, result };
  }

  // ─── Delete ──────────────────────────────────────────────────────

  async deleteInstance(instanceId: string): Promise<void> {
    const instance = await this.loadInstance(instanceId);
    if (!instance) {
      throw new ServiceError(
        404,
        "NOT_FOUND",
        `Instance with ID ${instanceId} not found`,
      );
    }

    if (this.storage) {
      await this.storage.deleteInstance(instanceId);
    }
    Logger.info("api", "instance-service", `Deleted instance ${instanceId}`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  /**
   * Load raw instance without enriching with workflow metadata.
   * Used by search routes that only need the instance data.
   */
  async loadRawInstance(instanceId: string): Promise<WorkflowInstance | null> {
    return this.loadInstance(instanceId);
  }

  private async loadInstance(
    instanceId: string,
  ): Promise<WorkflowInstance | null> {
    if (this.storage) {
      const inst = await this.storage.loadInstance(instanceId);
      if (inst) return inst;
    }
    // Fallback to engine (cast to any for mock compatibility in tests)
    try {
      const engineExt = this.engine as unknown as Record<string, unknown>;
      const fn = engineExt.getInstance;
      if (typeof fn === "function") {
        const result = await (
          fn as (
            id: string,
          ) => Promise<WorkflowInstance | null> | WorkflowInstance | null
        ).call(this.engine, instanceId);
        return result ?? null;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async callEngineMethod(
    method: string,
    instanceId: string,
  ): Promise<boolean> {
    const engineExt = this.engine as unknown as Record<string, unknown>;
    const fn = engineExt[method];
    if (typeof fn !== "function") {
      throw new ServiceError(
        501,
        "NOT_IMPLEMENTED",
        `Engine method ${method} is not available`,
      );
    }
    return (fn as (id: string) => Promise<boolean>).call(
      this.engine,
      instanceId,
    );
  }

  private async buildSummary(
    instance: WorkflowInstance,
  ): Promise<InstanceSummary> {
    const workflow = await Promise.resolve(
      this.engine.getWorkflow(instance.workflowId),
    );
    const totalNodes = getTotalNodes(workflow);
    const completedNodes = new Set(
      instance.history
        .filter((log) => log.status === "success" || log.status === "skipped")
        .map((log) => log.nodeId),
    ).size;

    return {
      id: instance.instanceId,
      workflowId: instance.workflowId,
      status: instance.status,
      progress:
        totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      traceId: instance.traceId,
    };
  }
}

// ─── Utilities ────────────────────────────────────────────────────────

function getTotalNodes(
  workflow: WorkflowDefinition | null | undefined,
): number {
  const nodes = workflow?.nodes;
  if (!nodes) return 0;
  if (Array.isArray(nodes)) return nodes.length;
  if (typeof nodes === "object") return Object.keys(nodes).length;
  return 0;
}
