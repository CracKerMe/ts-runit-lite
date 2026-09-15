// oxlint-disable no-explicit-any -- storage layer serializes/deserializes dynamic data structures
import type { WorkflowInstance } from "../model/Instance";
import type { WorkflowDefinition } from "../model/Workflow";

/**
 * Generic client handle returned by storage providers that expose a
 * lower-level client (e.g. for pub/sub or raw persistence access).
 * This fork only ships MemoryStorage, which never returns a client, so this
 * type is effectively unused at runtime — it exists purely so the
 * StorageProvider interface stays shape-compatible with custom storage
 * backends someone might plug in later.
 */
export type StorageClient = any;

// Event waiting state schema
export interface EventWaitingState {
  instanceId: string;
  nodeId: string;
  eventType: string;
  condition?: string;
  /**
   * When true, only events with a matching `payload.instanceId` will be accepted.
   * This is the recommended mode for workflow `event` nodes to avoid cross-instance delivery.
   */
  requireInstanceIdMatch?: boolean;
  timeoutMs?: number;
  deadline?: number;
  createdAt: number;
}

// Workflow definition with metadata
export type ReleasePolicy =
  | { type: "stable" }
  | {
      type: "canary";
      baselineVersion: number;
      canaryVersion: number;
      canaryPercent: number;
    };

export interface PromotionRules {
  autoPromote: boolean;
  minInstances?: number;
  maxErrorRate?: number;
  evaluationWindowMs?: number;
}

export interface CanaryMetrics {
  totalInstances: number;
  errorRate: number;
  avgDurationMs: number;
}

export interface StoredWorkflow {
  id: string;
  name: string;
  description?: string;
  definition: WorkflowDefinition;
  version: number;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  metadata?: Record<string, any>;
  publishedVersion?: number;
  lockedVersion?: number;
  releasePolicy?: ReleasePolicy;
  canaryVersion?: number;
  canaryPercent?: number;
  promotionRules?: PromotionRules;
  canaryStartedAt?: number;
}

export interface StoredWorkflowVersion {
  id: string;
  name: string;
  description?: string;
  definition: WorkflowDefinition;
  version: number;
  createdAt: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// Node execution metrics
export interface NodeMetrics {
  nodeId: string;
  nodeType?: string; // Type of node (action, wait, event, etc.)
  startTime?: number; // Unix timestamp when node execution started
  endTime?: number; // Unix timestamp when node execution completed
  duration?: number; // Execution duration in milliseconds
  retryCount: number; // Number of retry attempts
  retryTimestamps?: number[]; // Timestamps of each retry attempt
  error?: {
    message: string;
    stack?: string;
    timestamp: number;
  };
  status?: "pending" | "running" | "completed" | "failed" | "skipped"; // Current node status
}

// Instance metrics
export interface InstanceMetrics {
  instanceId: string;
  workflowId: string;
  nodeMetrics: Record<string, NodeMetrics>;
  createdAt: number;
  updatedAt: number;
}

// Event record
export interface EventRecord {
  id: string;
  instanceId: string;
  workflowId: string;
  eventType: string;
  payload: unknown;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// Heartbeat state for activity tracking
export interface HeartbeatState {
  instanceId: string;
  nodeId: string;
  heartbeatKey: string;
  workerId?: string;
  lastBeat: number;
  timeoutMs: number;
  deadline: number;
  createdAt: number;
}

// Query parameters for events
export interface EventQueryParams {
  instanceId?: string;
  eventType?: string;
  startTime?: number;
  endTime?: number;
  page?: number;
  pageSize?: number;
}

// Query parameters for instances
export type InstanceSortField = "createdAt" | "updatedAt" | "status";
export type InstanceSortOrder = "asc" | "desc";

export interface InstanceQueryParams {
  workflowId?: string;
  status?: string;
  startTime?: number;
  endTime?: number;
  page?: number;
  pageSize?: number;
  parentInstanceId?: string;
  /**
   * Sort field applied *before* pagination. Defaults to `createdAt`.
   * Sorting must happen in the storage layer — sorting a page after it has
   * been sliced yields duplicated and missing rows across pages.
   */
  sortBy?: InstanceSortField;
  /** Sort direction applied before pagination. Defaults to `desc`. */
  sortOrder?: InstanceSortOrder;
}

export interface StorageProvider {
  connect(): Promise<void>;
  getClient?(): StorageClient;
  saveInstance(instance: WorkflowInstance): Promise<void>;
  casUpdateInstance(instance: WorkflowInstance): Promise<boolean>;
  loadInstance(instanceId: string): Promise<WorkflowInstance | null>;
  saveWorkflow(workflow: WorkflowDefinition): Promise<void>;
  loadWorkflow(workflowId: string): Promise<WorkflowDefinition | null>;
  listInstances(): Promise<string[]>;
  listWorkflows(): Promise<string[]>;
  deleteInstance(instanceId: string): Promise<void>;
  deleteWorkflow(workflowId: string): Promise<void>;
  close(): Promise<void>;

  // Event waiting state methods
  saveEventWaitingState(state: EventWaitingState): Promise<void>;
  loadEventWaitingState(
    instanceId: string,
    nodeId: string,
  ): Promise<EventWaitingState | null>;
  loadAllEventWaitingStates(): Promise<EventWaitingState[]>;
  deleteEventWaitingState(instanceId: string, nodeId: string): Promise<void>;

  // Enhanced workflow methods with metadata
  saveWorkflowWithMetadata(workflow: StoredWorkflow): Promise<void>;
  loadWorkflowWithMetadata(workflowId: string): Promise<StoredWorkflow | null>;
  listWorkflowsWithMetadata(): Promise<StoredWorkflow[]>;
  saveWorkflowVersion(version: StoredWorkflowVersion): Promise<void>;
  loadWorkflowVersion(
    workflowId: string,
    version: number,
  ): Promise<StoredWorkflowVersion | null>;
  listWorkflowVersions(workflowId: string): Promise<number[]>;

  // Instance metrics methods
  saveInstanceMetrics(metrics: InstanceMetrics): Promise<void>;
  loadInstanceMetrics(instanceId: string): Promise<InstanceMetrics | null>;
  updateNodeMetrics(
    instanceId: string,
    nodeId: string,
    metrics: NodeMetrics,
  ): Promise<void>;

  // Event history methods
  saveEvent(event: EventRecord): Promise<void>;
  loadEvent(eventId: string): Promise<EventRecord | null>;
  queryEvents(
    params: EventQueryParams,
  ): Promise<{ events: EventRecord[]; total: number }>;
  deleteEvent(eventId: string): Promise<void>;

  // Instance query methods with filtering
  queryInstances(
    params: InstanceQueryParams,
  ): Promise<{ instances: WorkflowInstance[]; total: number }>;

  // Heartbeat persistence methods
  saveHeartbeat?(state: HeartbeatState): Promise<void>;
  loadAllHeartbeats?(): Promise<HeartbeatState[]>;
  deleteHeartbeat?(instanceId: string, nodeId: string): Promise<void>;

  // Event cleanup methods
  cleanupStaleEvents?(retentionDays: number): Promise<number>;
  cleanupExpiredHeartbeats?(): Promise<number>;

  /** Remove terminal instances older than the supplied age. */
  cleanupStaleInstances?(maxAgeMs: number): number | Promise<number>;

  // Dead-letter persistence (optional for custom providers)
  saveDeadLetterEntry?(entry: unknown): Promise<void>;
  loadAllDeadLetterEntries?(): Promise<unknown[]>;
  deleteDeadLetterEntry?(id: string): Promise<void>;

  // Webhook registration/delivery persistence (optional for custom providers)
  saveWebhookEntry?(entry: unknown): Promise<void>;
  loadAllWebhookEntries?(): Promise<unknown[]>;
  deleteWebhookEntry?(id: string): Promise<void>;
  saveWebhookDeliveryEntry?(entry: unknown): Promise<void>;
  loadAllWebhookDeliveryEntries?(): Promise<unknown[]>;
  deleteWebhookDeliveryEntry?(id: string): Promise<void>;
}
