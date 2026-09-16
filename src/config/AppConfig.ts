import { z } from "zod";

/**
 * Zod schema for application configuration.
 * Validates all environment variables at startup with type safety and range checks.
 */

// ── Legacy Redis Configuration ───────────────────────────────────────────────
// ⚠️ 兼容性占位字段：ts-workflow-engine-lite 是单进程 lite 版本，不包含 Redis
// 客户端依赖，也不会用这些值建立任何连接。设置这些字段（或对应的环境变量）
// 不会让引擎接入 Redis 或分布式存储/限流后端——它们只是为了让从完整版
// ts-runit 迁移过来的旧调用方在读取/序列化配置对象时不报错。
// 需要 Redis 或集群能力时应使用完整版 ts-runit，或自行接入外部方案。

const RedisConfigSchema = z.object({
  enabled: z
    .boolean()
    .default(false)
    .describe(
      "⚠️ 兼容性占位字段，当前 lite 版本没有可用的 Redis 后端，设为 true 不会生效",
    ),
  host: z
    .string()
    .default("localhost")
    .describe("⚠️ 兼容性占位字段，不生效（无 Redis 后端）"),
  port: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(6379)
    .describe("⚠️ 兼容性占位字段，不生效（无 Redis 后端）"),
  password: z
    .string()
    .optional()
    .describe("⚠️ 兼容性占位字段，不生效（无 Redis 后端）"),
  maxRetriesPerRequest: z
    .number()
    .int()
    .min(0)
    .max(10)
    .default(3)
    .describe("⚠️ 兼容性占位字段，不生效（无 Redis 后端）"),
  lazyConnect: z
    .boolean()
    .default(true)
    .describe("⚠️ 兼容性占位字段，不生效（无 Redis 后端）"),
});

// ── Resource Limits ──────────────────────────────────────────────────────────

const ResourceLimitsSchema = z.object({
  maxInstances: z
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(10_000)
    .describe("Maximum workflow instances"),
  maxConcurrentInstances: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .default(100)
    .describe("Maximum concurrent executing instances"),
  instanceTtlHours: z
    .number()
    .min(1)
    .max(8760)
    .default(24)
    .describe("Instance TTL in hours"),
  maxEventsPerInstance: z
    .number()
    .int()
    .min(1)
    .max(10_000_000)
    .default(100_000)
    .describe("Max events per instance"),
  maxTotalEvents: z
    .number()
    .int()
    .min(1)
    .max(100_000_000)
    .default(1_000_000)
    .describe("Max total events"),
  eventRetentionDays: z
    .number()
    .min(1)
    .max(3650)
    .default(90)
    .describe("Event retention in days"),
  maxQueryPageSize: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(1000)
    .describe("Max query page size"),
  maxEventQueryTimeRangeDays: z
    .number()
    .min(1)
    .max(365)
    .default(30)
    .describe("Max event query time range in days"),
  maxNodeTimeoutMinutes: z
    .number()
    .min(1)
    .max(1440)
    .default(60)
    .describe("Max node execution timeout in minutes"),
  maxLoopIterations: z
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(10_000)
    .describe("Max loop iterations"),
  maxConcurrentNodesPerInstance: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(10)
    .describe(
      "Max concurrently executing nodes per instance (e.g. parallel loop iterations)",
    ),
  lockTimeoutMs: z
    .number()
    .int()
    .min(100)
    .max(600_000)
    .default(30_000)
    .describe("In-process lock timeout in ms, used by ConcurrencyControl"),
});

// ── Workflow Engine Config ───────────────────────────────────────────────────

const WorkflowEngineConfigSchema = z.object({
  logLevel: z
    .enum(["DEBUG", "INFO", "WARN", "ERROR"])
    .default("INFO")
    .describe("Log level"),
  maxInstances: z
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(1000)
    .describe("Max workflow instances"),
  instanceTtlHours: z
    .number()
    .min(1)
    .max(8760)
    .default(24)
    .describe("Instance TTL in hours"),
  cleanupIntervalMs: z
    .number()
    .min(1000)
    .max(86_400_000)
    .default(3_600_000)
    .describe("Cleanup interval in ms (1s - 24h)"),
});

// ── Storage Config ──────────────────────────────────────────────────────────

const StorageConfigSchema = z.object({
  type: z.enum(["memory", "file"]).default("file"),
  directory: z
    .string()
    .min(1)
    .default(".ts-workflow-engine-data")
    .describe("Local file storage directory"),
  fsyncOnWrite: z
    .boolean()
    .default(false)
    .describe(
      "fsync every write (temp file + parent directory) so state survives a host crash/power loss, not just a process restart. Off by default: materially slower under high node throughput.",
    ),
});

// ── API Server Config ────────────────────────────────────────────────────────

const ApiServerConfigSchema = z.object({
  enabled: z.boolean().default(false).describe("Start API server"),
  port: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(3345)
    .describe("API server port"),
  resumeOnStartup: z
    .boolean()
    .default(true)
    .describe("Resume incomplete instances on startup"),
});

// ── Auth Config ──────────────────────────────────────────────────────────────

const AuthConfigSchema = z.object({
  enabled: z.boolean().default(false).describe("Enable authentication"),
  jwtSecret: z
    .string()
    .min(32)
    .optional()
    .describe("JWT secret (>=32 chars, required when auth enabled)"),
  apiKey: z.string().optional().describe("API key for API key auth"),
  apiKeyUserId: z
    .string()
    .default("api-key-service")
    .describe("User ID for API key requests"),
  apiKeyRole: z
    .string()
    .default("operator")
    .describe("Role for API key requests"),
});

// ── Cluster Config ───────────────────────────────────────────────────────────
// ⚠️ 兼容性占位字段：这些值只在此处被解析/校验，engine/event 模块不会读取
// 或依据它们改变任何行为。把 leaderElection / eventBusDistributed 设为 true
// 不会让引擎获得多进程领导者选举或分布式事件总线——lite 版本是单进程设计，
// 需要这些能力时应使用完整版 ts-runit。

const ClusterConfigSchema = z.object({
  leaderElection: z
    .boolean()
    .default(false)
    .describe("⚠️ 兼容性占位字段，当前 lite 版本未接入，设为 true 不会生效"),
  leaderKey: z
    .string()
    .default("workflow:leader")
    .describe("⚠️ 兼容性占位字段，不生效（无领导者选举实现）"),
  leaderTtlMs: z
    .number()
    .int()
    .min(5000)
    .max(300_000)
    .default(30_000)
    .describe("⚠️ 兼容性占位字段，不生效（无领导者选举实现）"),
  eventBusDistributed: z
    .boolean()
    .default(false)
    .describe("⚠️ 兼容性占位字段，当前 lite 版本未接入，设为 true 不会生效"),
});

// ── Worker Pool Config ───────────────────────────────────────────────────────

const WorkerPoolConfigSchema = z.object({
  enabled: z.boolean().default(false).describe("Enable worker pool"),
  minWorkers: z
    .number()
    .int()
    .min(1)
    .max(64)
    .default(2)
    .describe("Minimum worker count"),
  maxWorkers: z
    .number()
    .int()
    .min(1)
    .max(256)
    .default(8)
    .describe("Maximum worker count"),
  taskTimeoutMs: z
    .number()
    .min(1000)
    .max(600_000)
    .default(60_000)
    .describe("Worker task timeout in ms"),
  idleTimeoutMs: z
    .number()
    .min(10_000)
    .max(3_600_000)
    .default(300_000)
    .describe("Worker idle timeout in ms"),
  stickyEnabled: z
    .boolean()
    .default(true)
    .describe("Route an instance's tasks back to the same worker"),
  stickyCacheSize: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(100)
    .describe("Max cached entries per sticky worker"),
  stickyTtlMs: z
    .number()
    .int()
    .min(1000)
    .max(3_600_000)
    .default(60_000)
    .describe("Sticky binding TTL in ms"),
});

// ── Action Sandbox Isolation Config ──────────────────────────────────────────

const ActionSandboxConfigSchema = z.object({
  isolationEnabled: z
    .boolean()
    .default(false)
    .describe(
      "Run action/rollback string bodies in a dedicated worker_threads pool " +
        "(real V8 isolate + heap, hard-terminable on timeout) instead of the " +
        "in-process vm module. Off by default: zero new threads unless opted in.",
    ),
  minWorkers: z.number().int().min(0).max(64).default(0),
  maxWorkers: z.number().int().min(1).max(256).default(4),
  taskTimeoutMs: z
    .number()
    .min(10)
    .max(600_000)
    .default(5_000)
    .describe("Hard wall-clock budget; the worker is terminated on expiry"),
  idleTimeoutMs: z
    .number()
    .min(10_000)
    .max(3_600_000)
    .default(300_000)
    .describe("Idle worker recycle time in ms"),
});

// ── Secret Manager Config ────────────────────────────────────────────────────

const SecretManagerConfigSchema = z
  .enum(["env", "vault", "aws", "aws-secrets-manager"])
  .default("env")
  .describe("Secret provider backend");

// ── Rate Limit Config ────────────────────────────────────────────────────────

const RateLimitConfigSchema = z.object({
  enabled: z.boolean().default(false).describe("Enable rate limiting"),
  store: z
    .enum(["memory", "redis"])
    .default("memory")
    .describe("Rate limit store backend"),
});

// ──── Archive Config ────────────────────────────────────────────────────

const ArchiveConfigSchema = z.object({
  enabled: z.boolean().default(false).describe("Archive terminal instances"),
  directory: z.string().min(1).optional().describe("Archive output directory"),
  retentionDays: z.number().int().min(1).max(3650).default(90),
  cleanupIntervalMs: z
    .number()
    .int()
    .min(1000)
    .max(86_400_000)
    .default(21_600_000),
});

// ── Full App Config ──────────────────────────────────────────────────────────

export const AppConfigSchema = z.object({
  redis: RedisConfigSchema,
  resources: ResourceLimitsSchema,
  storage: StorageConfigSchema.default({
    type: "file",
    directory: ".ts-workflow-engine-data",
    fsyncOnWrite: false,
  }),
  engine: WorkflowEngineConfigSchema,
  api: ApiServerConfigSchema,
  auth: AuthConfigSchema,
  cluster: ClusterConfigSchema,
  workerPool: WorkerPoolConfigSchema,
  actionSandbox: ActionSandboxConfigSchema,
  secretProvider: SecretManagerConfigSchema,
  rateLimit: RateLimitConfigSchema,
  archive: ArchiveConfigSchema.default({
    enabled: false,
    retentionDays: 90,
    cleanupIntervalMs: 21_600_000,
  }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// ── Environment Variable Parser ──────────────────────────────────────────────

function parseEnvBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue;
  return value === "true" || value === "1";
}

/**
 * 解析数值型环境变量（允许小数，用于比例/倍率等配置）。
 * 空串、非数字、NaN、Infinity 一律回退默认值——`Number("")` 为 0，
 * 直接用 `Number.isNaN` 判断会把未设置的变量当成 0。
 * 需要整数语义时请使用 `utils/env.ts` 的 `parseEnvInt`。
 */
function parseEnvNumber(
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined || value.trim() === "") return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/**
 * Parse environment variables into a raw config object.
 * This handles the string → typed conversion before Zod validation.
 */
function parseEnvToRawConfig(): Record<string, unknown> {
  return {
    redis: {
      enabled: parseEnvBoolean(process.env.REDIS_ENABLED, false),
      host: process.env.REDIS_HOST || "localhost",
      port: parseEnvNumber(process.env.REDIS_PORT, 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: parseEnvNumber(process.env.REDIS_MAX_RETRIES, 3),
      lazyConnect: parseEnvBoolean(process.env.REDIS_LAZY_CONNECT, true),
    },
    resources: {
      maxInstances: parseEnvNumber(process.env.MAX_INSTANCES, 10_000),
      maxConcurrentInstances: parseEnvNumber(
        process.env.MAX_CONCURRENT_INSTANCES,
        100,
      ),
      instanceTtlHours: parseEnvNumber(process.env.INSTANCE_TTL_HOURS, 24),
      maxEventsPerInstance: parseEnvNumber(
        process.env.MAX_EVENTS_PER_INSTANCE,
        100_000,
      ),
      maxTotalEvents: parseEnvNumber(process.env.MAX_TOTAL_EVENTS, 1_000_000),
      eventRetentionDays: parseEnvNumber(process.env.EVENT_RETENTION_DAYS, 90),
      maxQueryPageSize: parseEnvNumber(process.env.MAX_QUERY_PAGE_SIZE, 1000),
      maxEventQueryTimeRangeDays: parseEnvNumber(
        process.env.MAX_EVENT_QUERY_TIME_RANGE_DAYS,
        30,
      ),
      maxNodeTimeoutMinutes: parseEnvNumber(
        process.env.MAX_NODE_TIMEOUT_MINUTES,
        60,
      ),
      maxLoopIterations: parseEnvNumber(
        process.env.MAX_LOOP_ITERATIONS,
        10_000,
      ),
      maxConcurrentNodesPerInstance: parseEnvNumber(
        process.env.MAX_CONCURRENT_NODES,
        10,
      ),
      lockTimeoutMs: parseEnvNumber(process.env.LOCK_TIMEOUT_MS, 30_000),
    },
    storage: {
      type: (process.env.STORAGE_TYPE ||
        (process.env.NODE_ENV === "test" ? "memory" : "file")) as
        | "memory"
        | "file",
      directory: process.env.STORAGE_DIR || ".ts-workflow-engine-data",
      fsyncOnWrite: parseEnvBoolean(process.env.FSYNC_ON_WRITE, false),
    },
    engine: {
      logLevel: process.env.WORKFLOW_ENGINE_LOG_LEVEL || "INFO",
      maxInstances: parseEnvNumber(
        process.env.WORKFLOW_ENGINE_MAX_INSTANCES,
        1000,
      ),
      instanceTtlHours: parseEnvNumber(process.env.INSTANCE_TTL_HOURS, 24),
      cleanupIntervalMs: parseEnvNumber(
        process.env.CLEANUP_INTERVAL_MS,
        3_600_000,
      ),
    },
    api: {
      enabled: parseEnvBoolean(process.env.START_API_SERVER, false),
      port: parseEnvNumber(process.env.API_PORT, 3345),
      resumeOnStartup: parseEnvBoolean(process.env.RESUME_ON_STARTUP, true),
    },
    auth: {
      enabled: parseEnvBoolean(process.env.AUTH_ENABLED, false),
      jwtSecret: process.env.JWT_SECRET || undefined,
      apiKey: process.env.API_KEY || undefined,
      apiKeyUserId: process.env.API_KEY_USER_ID || "api-key-service",
      apiKeyRole: process.env.API_KEY_ROLE || "operator",
    },
    cluster: {
      leaderElection: parseEnvBoolean(
        process.env.CLUSTER_LEADER_ELECTION,
        false,
      ),
      leaderKey: process.env.CLUSTER_LEADER_KEY || "workflow:leader",
      leaderTtlMs: parseEnvNumber(process.env.CLUSTER_LEADER_TTL_MS, 30_000),
      eventBusDistributed: parseEnvBoolean(
        process.env.EVENT_BUS_DISTRIBUTED,
        false,
      ),
    },
    workerPool: {
      enabled: parseEnvBoolean(process.env.WORKER_POOL_ENABLED, false),
      minWorkers: parseEnvNumber(process.env.WORKER_POOL_MIN, 2),
      maxWorkers: parseEnvNumber(process.env.WORKER_POOL_MAX, 8),
      taskTimeoutMs: parseEnvNumber(
        process.env.WORKER_POOL_TASK_TIMEOUT_MS,
        60_000,
      ),
      idleTimeoutMs: parseEnvNumber(
        process.env.WORKER_POOL_IDLE_TIMEOUT_MS,
        300_000,
      ),
      stickyEnabled: parseEnvBoolean(process.env.WORKER_STICKY_ENABLED, true),
      stickyCacheSize: parseEnvNumber(
        process.env.WORKER_STICKY_CACHE_SIZE,
        100,
      ),
      stickyTtlMs: parseEnvNumber(process.env.WORKER_STICKY_TTL_MS, 60_000),
    },
    actionSandbox: {
      isolationEnabled: parseEnvBoolean(
        process.env.ACTION_SANDBOX_ISOLATION_ENABLED,
        false,
      ),
      minWorkers: parseEnvNumber(process.env.ACTION_SANDBOX_MIN, 0),
      maxWorkers: parseEnvNumber(process.env.ACTION_SANDBOX_MAX, 4),
      taskTimeoutMs: parseEnvNumber(
        process.env.ACTION_SANDBOX_TASK_TIMEOUT_MS,
        5_000,
      ),
      idleTimeoutMs: parseEnvNumber(
        process.env.ACTION_SANDBOX_IDLE_TIMEOUT_MS,
        300_000,
      ),
    },
    secretProvider: (process.env.SECRET_PROVIDER || "env") as
      | "env"
      | "vault"
      | "aws"
      | "aws-secrets-manager",
    rateLimit: {
      enabled: parseEnvBoolean(process.env.RATE_LIMIT_ENABLED, false),
      store: (process.env.RATE_LIMIT_STORE || "memory") as "memory" | "redis",
    },
    archive: {
      enabled: parseEnvBoolean(process.env.ARCHIVE_ENABLED, false),
      directory: process.env.ARCHIVE_DIR || undefined,
      retentionDays: parseEnvNumber(process.env.ARCHIVE_RETENTION_DAYS, 90),
      cleanupIntervalMs: parseEnvNumber(
        process.env.ARCHIVE_CLEANUP_INTERVAL_MS,
        21_600_000,
      ),
    },
  };
}

// ── Singleton Config ─────────────────────────────────────────────────────────

let _appConfig: AppConfig | null = null;

/**
 * Get the validated application configuration.
 * Call this once at startup; subsequent calls return the cached config.
 */
export function getAppConfig(): AppConfig {
  if (_appConfig) return _appConfig;
  throw new Error(
    "AppConfig not initialized. Call validateAppConfig() at startup first.",
  );
}

/**
 * Validate and initialize the application configuration from environment variables.
 * Throws a descriptive error if validation fails.
 */
export function validateAppConfig(): AppConfig {
  const raw = parseEnvToRawConfig();

  const result = AppConfigSchema.safeParse(raw);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        return `  - ${path || "(root)"}: ${issue.message}`;
      })
      .join("\n");

    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  const config = result.data;

  // Cross-field validation
  const crossErrors: string[] = [];

  if (config.auth.enabled && !config.auth.jwtSecret && !config.auth.apiKey) {
    crossErrors.push(
      "AUTH_ENABLED=true requires either JWT_SECRET (>=32 chars) or API_KEY",
    );
  }

  if (config.redis.enabled && !config.redis.host) {
    crossErrors.push("REDIS_HOST is required when Redis is enabled");
  }

  if (
    config.workerPool.enabled &&
    config.workerPool.maxWorkers < config.workerPool.minWorkers
  ) {
    crossErrors.push("WORKER_POOL_MAX must be >= WORKER_POOL_MIN");
  }

  if (crossErrors.length > 0) {
    throw new Error(
      `Configuration validation failed:\n${crossErrors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  _appConfig = config;
  return config;
}

/**
 * Reset the cached config (for testing only).
 */
export function resetAppConfig(): void {
  _appConfig = null;
}
