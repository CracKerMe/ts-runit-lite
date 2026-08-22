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
 * Create a timeout promise that rejects after specified milliseconds
 */
function createTimeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`SQL query timeout after ${ms}ms`));
    }, ms);
  });
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
  return await Promise.race([
    pool.query(query, parameters),
    createTimeoutPromise(timeout),
  ]);
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
