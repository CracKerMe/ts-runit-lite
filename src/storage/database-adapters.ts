// oxlint-disable no-explicit-any -- optional driver imports are runtime-resolved
import type { WorkflowInstance } from "../model/Instance";
import type { WorkflowDefinition } from "../model/Workflow";
import type {
  EventRecord,
  EventWaitingState,
  HeartbeatState,
  InstanceMetrics,
  StorageProvider,
  StoredWorkflow,
  StoredWorkflowVersion,
} from "./StorageProvider";
import { MemoryStorage } from "./MemoryStorage";
import { registerStorageAdapter } from "./registry";

interface StorageSnapshot {
  instances: WorkflowInstance[];
  workflows: WorkflowDefinition[];
  eventWaitingStates: EventWaitingState[];
  workflowMetadata: StoredWorkflow[];
  workflowVersions: StoredWorkflowVersion[];
  metrics: InstanceMetrics[];
  events: EventRecord[];
  heartbeats: HeartbeatState[];
}

interface SnapshotPersistence {
  loadSnapshot(): Promise<StorageSnapshot | null>;
  saveSnapshot(snapshot: StorageSnapshot): Promise<void>;
  close(): Promise<void>;
}

class SnapshotBackedStorage extends MemoryStorage {
  private restoring = false;

  constructor(private readonly persistence: SnapshotPersistence) {
    super();
  }

  override async connect(): Promise<void> {
    await super.connect();
    const snapshot = await this.persistence.loadSnapshot();
    if (!snapshot) {
      return;
    }

    this.restoring = true;
    try {
      for (const workflow of snapshot.workflows) {
        await super.saveWorkflow(workflow);
      }
      for (const workflow of snapshot.workflowMetadata) {
        await super.saveWorkflowWithMetadata(workflow);
      }
      for (const version of snapshot.workflowVersions) {
        await super.saveWorkflowVersion(version);
      }
      for (const instance of snapshot.instances) {
        await super.saveInstance(instance);
      }
      for (const waitingState of snapshot.eventWaitingStates) {
        await super.saveEventWaitingState(waitingState);
      }
      for (const metric of snapshot.metrics) {
        await super.saveInstanceMetrics(metric);
      }
      for (const event of snapshot.events) {
        await super.saveEvent(event);
      }
      for (const heartbeat of snapshot.heartbeats) {
        await super.saveHeartbeat(heartbeat);
      }
    } finally {
      this.restoring = false;
    }
  }

  override async close(): Promise<void> {
    await this.persistSnapshot();
    await this.persistence.close();
    await super.close();
  }

  private async persistSnapshot(): Promise<void> {
    if (this.restoring) {
      return;
    }

    const instances = await this.listInstances();
    const workflows = await this.listWorkflows();
    const workflowMetadata = await this.listWorkflowsWithMetadata();
    const eventWaitingStates = await this.loadAllEventWaitingStates();
    const heartbeats = await this.loadAllHeartbeats();

    const snapshot: StorageSnapshot = {
      instances: (
        await Promise.all(instances.map((id) => this.loadInstance(id)))
      ).filter((item): item is WorkflowInstance => item !== null),
      workflows: (
        await Promise.all(workflows.map((id) => this.loadWorkflow(id)))
      ).filter((item): item is WorkflowDefinition => item !== null),
      eventWaitingStates,
      workflowMetadata,
      workflowVersions: (
        await Promise.all(
          workflows.flatMap(async (workflowId) => {
            const versions = await this.listWorkflowVersions(workflowId);
            return Promise.all(
              versions.map((version) =>
                this.loadWorkflowVersion(workflowId, version),
              ),
            );
          }),
        )
      )
        .flat()
        .filter((item): item is StoredWorkflowVersion => item !== null),
      metrics: (
        await Promise.all(instances.map((id) => this.loadInstanceMetrics(id)))
      ).filter((item): item is InstanceMetrics => item !== null),
      events: (
        await this.queryEvents({
          page: 1,
          pageSize: Number.MAX_SAFE_INTEGER,
        })
      ).events,
      heartbeats,
    };

    await this.persistence.saveSnapshot(snapshot);
  }

  private async mutate<T>(fn: () => Promise<T>): Promise<T> {
    const result = await fn();
    await this.persistSnapshot();
    return result;
  }

  override async saveInstance(instance: WorkflowInstance): Promise<void> {
    await this.mutate(() => super.saveInstance(instance));
  }

  override async casUpdateInstance(instance: WorkflowInstance): Promise<boolean> {
    return this.mutate(() => super.casUpdateInstance(instance));
  }

  override async deleteInstance(instanceId: string): Promise<void> {
    await this.mutate(() => super.deleteInstance(instanceId));
  }

  override async saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
    await this.mutate(() => super.saveWorkflow(workflow));
  }

  override async deleteWorkflow(workflowId: string): Promise<void> {
    await this.mutate(() => super.deleteWorkflow(workflowId));
  }

  override async saveEventWaitingState(state: EventWaitingState): Promise<void> {
    await this.mutate(() => super.saveEventWaitingState(state));
  }

  override async deleteEventWaitingState(
    instanceId: string,
    nodeId: string,
  ): Promise<void> {
    await this.mutate(() => super.deleteEventWaitingState(instanceId, nodeId));
  }

  override async saveWorkflowWithMetadata(workflow: StoredWorkflow): Promise<void> {
    await this.mutate(() => super.saveWorkflowWithMetadata(workflow));
  }

  override async saveWorkflowVersion(version: StoredWorkflowVersion): Promise<void> {
    await this.mutate(() => super.saveWorkflowVersion(version));
  }

  override async saveInstanceMetrics(metrics: InstanceMetrics): Promise<void> {
    await this.mutate(() => super.saveInstanceMetrics(metrics));
  }

  override async deleteInstanceMetrics(instanceId: string): Promise<void> {
    await this.mutate(() => super.deleteInstanceMetrics(instanceId));
  }

  override async updateNodeMetrics(
    instanceId: string,
    nodeId: string,
    metrics: {
      nodeId: string;
      nodeType?: string;
      startTime?: number;
      endTime?: number;
      duration?: number;
      retryCount: number;
      retryTimestamps?: number[];
      error?: { message: string; stack?: string; timestamp: number };
      status?: "pending" | "running" | "completed" | "failed" | "skipped";
    },
  ): Promise<void> {
    await this.mutate(() => super.updateNodeMetrics(instanceId, nodeId, metrics));
  }

  override async saveEvent(event: EventRecord): Promise<void> {
    await this.mutate(() => super.saveEvent(event));
  }

  override async deleteEvent(eventId: string): Promise<void> {
    await this.mutate(() => super.deleteEvent(eventId));
  }

  override async saveHeartbeat(state: HeartbeatState): Promise<void> {
    await this.mutate(() => super.saveHeartbeat(state));
  }

  override async deleteHeartbeat(instanceId: string, nodeId: string): Promise<void> {
    await this.mutate(() => super.deleteHeartbeat(instanceId, nodeId));
  }
}

class SqliteSnapshotPersistence implements SnapshotPersistence {
  private db: any;

  constructor(private readonly filePath: string) {}

  async loadSnapshot(): Promise<StorageSnapshot | null> {
    await this.ensureDb();
    const row = this.db
      .prepare("SELECT payload FROM engine_snapshot WHERE id = 1")
      .get() as { payload?: string } | undefined;
    if (!row?.payload) {
      return null;
    }
    return JSON.parse(row.payload) as StorageSnapshot;
  }

  async saveSnapshot(snapshot: StorageSnapshot): Promise<void> {
    await this.ensureDb();
    const payload = JSON.stringify(snapshot);
    this.db
      .prepare(
        "INSERT INTO engine_snapshot(id, payload, updated_at) VALUES(1, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
      )
      .run(payload, Date.now());
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = undefined;
    }
  }

  private async ensureDb(): Promise<void> {
    if (this.db) {
      return;
    }
    const loadImport = new Function(
      "name",
      "return import(name)",
    ) as (name: string) => Promise<any>;
    const mod = await loadImport("better-sqlite3").catch(() => null);
    if (!mod) {
      throw new Error(
        'SQLite storage adapter requires optional dependency "better-sqlite3".',
      );
    }
    const BetterSqlite3 = mod.default ?? mod;
    this.db = new BetterSqlite3(this.filePath);
    this.db
      .prepare(
        "CREATE TABLE IF NOT EXISTS engine_snapshot (" +
          "id INTEGER PRIMARY KEY CHECK(id = 1)," +
          "payload TEXT NOT NULL," +
          "updated_at INTEGER NOT NULL" +
          ")",
      )
      .run();
  }
}

class PostgresSnapshotPersistence implements SnapshotPersistence {
  private pool: any;

  constructor(private readonly connectionString: string) {}

  async loadSnapshot(): Promise<StorageSnapshot | null> {
    await this.ensurePool();
    const result = await this.pool.query(
      "SELECT payload FROM engine_snapshot WHERE id = 1",
    );
    const payload = result.rows[0]?.payload as string | undefined;
    if (!payload) {
      return null;
    }
    return JSON.parse(payload) as StorageSnapshot;
  }

  async saveSnapshot(snapshot: StorageSnapshot): Promise<void> {
    await this.ensurePool();
    const payload = JSON.stringify(snapshot);
    await this.pool.query(
      "INSERT INTO engine_snapshot(id, payload, updated_at) VALUES($1, $2, NOW()) " +
        "ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()",
      [1, payload],
    );
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = undefined;
    }
  }

  private async ensurePool(): Promise<void> {
    if (this.pool) {
      return;
    }
    const loadImport = new Function(
      "name",
      "return import(name)",
    ) as (name: string) => Promise<any>;
    const mod = await loadImport("pg").catch(() => null);
    if (!mod) {
      throw new Error('Postgres storage adapter requires optional dependency "pg".');
    }
    const Pool = mod.Pool;
    this.pool = new Pool({ connectionString: this.connectionString });
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS engine_snapshot (" +
        "id INTEGER PRIMARY KEY," +
        "payload TEXT NOT NULL," +
        "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()" +
        ")",
    );
  }
}

export async function createSqliteStorageAdapter(
  config: Record<string, unknown>,
): Promise<StorageProvider> {
  const filePath =
    (config.path as string) ??
    process.env.SQLITE_STORAGE_PATH ??
    ".ts-workflow-engine.sqlite";
  const adapter = new SnapshotBackedStorage(
    new SqliteSnapshotPersistence(filePath),
  );
  await adapter.connect();
  return adapter;
}

export async function createPostgresStorageAdapter(
  config: Record<string, unknown>,
): Promise<StorageProvider> {
  const connectionString =
    (config.connectionString as string) ??
    process.env.POSTGRES_STORAGE_URL ??
    "";
  if (!connectionString) {
    throw new Error(
      "Postgres storage adapter requires connectionString or POSTGRES_STORAGE_URL.",
    );
  }
  const adapter = new SnapshotBackedStorage(
    new PostgresSnapshotPersistence(connectionString),
  );
  await adapter.connect();
  return adapter;
}

export function registerDatabaseStorageAdapters(): void {
  registerStorageAdapter("sqlite", createSqliteStorageAdapter);
  registerStorageAdapter("postgres", createPostgresStorageAdapter);
}
