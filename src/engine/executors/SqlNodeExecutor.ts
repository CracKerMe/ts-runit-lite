import type { WorkflowInstance } from "../../model/Instance";
import { errorMessage, errorStack, Logger } from "../../utils/Logger";
import { interpolateObject } from "../ExpressionEvaluator";

/**
 * SQL node configuration
 */
export interface SqlNodeConfig {
  connection: string; // Connection string or reference to connection pool
  query: string; // SQL query (supports expressions)
  parameters?: unknown[]; // Parameterized query values (supports expressions)
  timeout?: number; // Query timeout in milliseconds
  database?: "postgres" | "mysql" | "sqlite" | "mssql" | "generic"; // Database type hint
}

/**
 * SQL node output
 */
export interface SqlNodeOutput {
  rows: unknown[]; // Query result rows
  rowCount: number; // Number of rows affected/returned
  duration: number; // Query execution duration in milliseconds
}

/**
 * SQL connection pool interface
 * This allows different database drivers to be plugged in
 */
export interface SqlConnectionPool {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: unknown[]; rowCount: number }>;
  close?(): Promise<void>;
}

/**
 * Global connection pool registry
 * Allows applications to register connection pools by name
 */
const connectionPools = new Map<string, SqlConnectionPool>();

/**
 * Register a SQL connection pool
 * @param name - Connection pool name/identifier
 * @param pool - Connection pool instance
 */
export function registerSqlConnectionPool(
  name: string,
  pool: SqlConnectionPool,
): void {
  connectionPools.set(name, pool);
  Logger.info(
    "sql-node",
    "pool-registered",
    `SQL connection pool registered: ${name}`,
  );
}

/**
 * Unregister a SQL connection pool
 * @param name - Connection pool name/identifier
 */
export function unregisterSqlConnectionPool(name: string): void {
  const pool = connectionPools.get(name);
  if (pool?.close) {
    pool.close().catch((error) => {
      Logger.error(
        "sql-node",
        "pool-close-error",
        `Error closing connection pool ${name}`,
        errorStack(error),
      );
    });
  }
  connectionPools.delete(name);
  Logger.info(
    "sql-node",
    "pool-unregistered",
    `SQL connection pool unregistered: ${name}`,
  );
}

/**
 * Get a registered SQL connection pool
 * @param name - Connection pool name/identifier
 * @returns Connection pool instance or undefined
 */
export function getSqlConnectionPool(
  name: string,
): SqlConnectionPool | undefined {
  return connectionPools.get(name);
}

/**
 * SQL Node Executor
 * Executes SQL queries with connection pooling
 * Supports parameterized queries and timeout
 */
/**
 * 为一个 Promise 附加超时，并在竞态结束后**清除定时器**。
 *
 * 此前 `Promise.race([work, createTimeoutPromise(ms)])` 的 setTimeout 句柄
 * 从不保存也从不 clear：查询先返回时定时器仍然挂着并持有整个闭包，高负载
 * 下会持续累积活跃定时器，并把进程退出推迟最多一个 timeout 时长。
 *
 * 注意这**不会**取消底层查询——Promise.race 的败者仍在跑，连接也仍被占用。
 * 真正的取消需要驱动层支持，这里只保证定时器本身不泄漏。
 */
async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Execute query with timeout support
 */
async function executeWithTimeout(
  pool: SqlConnectionPool,
  query: string,
  parameters?: unknown[],
  timeout?: number,
): Promise<{ rows: unknown[]; rowCount: number }> {
  if (!timeout) {
    // No timeout, execute directly
    return await pool.query(query, parameters);
  }

  // Execute with timeout
  return await withTimeout(
    pool.query(query, parameters),
    timeout,
    `SQL query timeout after ${timeout}ms`,
  );
}

/**
 * SQL Node Executor
 * Executes SQL queries with connection pooling
 * Supports parameterized queries and timeout
 */
export async function execute(
  config: SqlNodeConfig,
  instance: WorkflowInstance,
): Promise<SqlNodeOutput> {
  const startTime = Date.now();

  // Evaluate expressions in configuration
  const context = {
    context: instance.context || {},
    state: instance.state || {},
  };

  const evaluatedConfig = interpolateObject(config, context, instance.state);

  Logger.log(
    instance.instanceId,
    "sql-node",
    `Executing SQL query on connection: ${evaluatedConfig.connection}`,
  );

  try {
    // Get connection pool
    const pool = connectionPools.get(evaluatedConfig.connection);
    if (!pool) {
      throw new Error(
        `SQL connection pool not found: ${evaluatedConfig.connection}. ` +
          "Please register the connection pool using registerSqlConnectionPool().",
      );
    }

    // Execute query with timeout
    const result = await executeWithTimeout(
      pool,
      evaluatedConfig.query,
      evaluatedConfig.parameters,
      evaluatedConfig.timeout,
    );

    const duration = Date.now() - startTime;

    Logger.log(
      instance.instanceId,
      "sql-node",
      `SQL query completed: ${result.rowCount} rows affected/returned in ${duration}ms`,
    );

    return {
      rows: result.rows,
      rowCount: result.rowCount,
      duration,
    };
  } catch (error: unknown) {
    const duration = Date.now() - startTime;

    Logger.error(
      instance.instanceId,
      "sql-node",
      `SQL query failed after ${duration}ms: ${errorMessage(error)}`,
      errorStack(error),
    );

    throw new Error(`SQL query failed: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

export const SqlNodeExecutor = {
  execute,
};
