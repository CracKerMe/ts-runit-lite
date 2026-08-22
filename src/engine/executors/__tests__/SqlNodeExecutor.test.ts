import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../../model/Instance";
import {
  getSqlConnectionPool,
  registerSqlConnectionPool,
  type SqlConnectionPool,
  type SqlNodeConfig,
  SqlNodeExecutor,
  unregisterSqlConnectionPool,
} from "../SqlNodeExecutor";

describe("SqlNodeExecutor", () => {
  let mockInstance: WorkflowInstance;
  let mockPool: SqlConnectionPool;

  beforeEach(() => {
    // Create mock workflow instance
    mockInstance = {
      instanceId: "test-instance-123",
      workflowId: "test-workflow",
      status: "running",
      currentNodes: [],
      context: {
        userId: "user-123",
        tableName: "users",
      },
      state: {
        nodes: {},
      },
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Create mock connection pool
    mockPool = {
      query: vi.fn(async () => {
        // Simulate successful query
        return {
          rows: [
            { id: 1, name: "Alice", email: "alice@example.com" },
            { id: 2, name: "Bob", email: "bob@example.com" },
          ],
          rowCount: 2,
        };
      }),
    };

    // Register mock pool
    registerSqlConnectionPool("test-db", mockPool);
  });

  afterEach(() => {
    // Clean up registered pools
    unregisterSqlConnectionPool("test-db");
    vi.clearAllMocks();
  });

  describe("Connection Pool Management", () => {
    it("should register and retrieve connection pool", () => {
      const pool = getSqlConnectionPool("test-db");
      expect(pool).toBe(mockPool);
    });

    it("should return undefined for non-existent pool", () => {
      const pool = getSqlConnectionPool("non-existent");
      expect(pool).toBeUndefined();
    });

    it("should unregister connection pool", () => {
      unregisterSqlConnectionPool("test-db");
      const pool = getSqlConnectionPool("test-db");
      expect(pool).toBeUndefined();
    });

    it("should call close method when unregistering pool with close", async () => {
      const closeFn = vi.fn(async () => {});
      const poolWithClose = { ...mockPool, close: closeFn };
      registerSqlConnectionPool("closeable-db", poolWithClose);

      unregisterSqlConnectionPool("closeable-db");

      // Wait for async close to complete
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(closeFn).toHaveBeenCalled();
    });
  });

  describe("SQL Query Execution", () => {
    it("should execute simple SQL query", async () => {
      const config: SqlNodeConfig = {
        connection: "test-db",
        query: "SELECT * FROM users",
      };

      const result = await SqlNodeExecutor.execute(config, mockInstance);

      expect(result).toMatchObject({
        rows: expect.any(Array),
        rowCount: 2,
        duration: expect.any(Number),
      });
      expect(result.rows).toHaveLength(2);
      expect(mockPool.query).toHaveBeenCalledWith(
        "SELECT * FROM users",
        undefined,
      );
    });

    it("should execute parameterized query", async () => {
      const config: SqlNodeConfig = {
        connection: "test-db",
        query: "SELECT * FROM users WHERE id = $1",
        parameters: [1],
      };

      const result = await SqlNodeExecutor.execute(config, mockInstance);

      expect(result.rowCount).toBe(2);
      expect(mockPool.query).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE id = $1",
        [1],
      );
    });

    it("should support expression evaluation in query", async () => {
      const config: SqlNodeConfig = {
        connection: "test-db",
        query: "SELECT * FROM ${context.tableName}",
      };

      const result = await SqlNodeExecutor.execute(config, mockInstance);

      expect(result.rowCount).toBe(2);
      expect(mockPool.query).toHaveBeenCalledWith(
        "SELECT * FROM users",
        undefined,
      );
    });

    it("should support expression evaluation in parameters", async () => {
      const config: SqlNodeConfig = {
        connection: "test-db",
        query: "SELECT * FROM users WHERE id = $1",
        parameters: ["${context.userId}"],
      };

      await SqlNodeExecutor.execute(config, mockInstance);

      expect(mockPool.query).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE id = $1",
        ["user-123"],
      );
    });

    it("should measure query duration", async () => {
      const config: SqlNodeConfig = {
        connection: "test-db",
        query: "SELECT * FROM users",
      };

      const result = await SqlNodeExecutor.execute(config, mockInstance);

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe("number");
    });
  });

  describe("Error Handling", () => {
    it("should throw error for non-existent connection pool", async () => {
      const config: SqlNodeConfig = {
        connection: "non-existent-db",
        query: "SELECT * FROM users",
      };

      await expect(
        SqlNodeExecutor.execute(config, mockInstance),
      ).rejects.toThrow(/SQL connection pool not found: non-existent-db/);
    });

    it("should throw error when query fails", async () => {
      const errorPool: SqlConnectionPool = {
        query: vi.fn(async () => {
          throw new Error("Database connection failed");
        }),
      };
      registerSqlConnectionPool("error-db", errorPool);

      const config: SqlNodeConfig = {
        connection: "error-db",
        query: "SELECT * FROM users",
      };

      await expect(
        SqlNodeExecutor.execute(config, mockInstance),
      ).rejects.toThrow(/SQL query failed: Database connection failed/);

      unregisterSqlConnectionPool("error-db");
    });

    it("should include helpful message in error", async () => {
      const config: SqlNodeConfig = {
        connection: "missing-pool",
        query: "SELECT * FROM users",
      };

      await expect(
        SqlNodeExecutor.execute(config, mockInstance),
      ).rejects.toThrow(
        /Please register the connection pool using registerSqlConnectionPool/,
      );
    });
  });

  describe("Timeout Support", () => {
    it("should execute query without timeout", async () => {
      const config: SqlNodeConfig = {
        connection: "test-db",
        query: "SELECT * FROM users",
        timeout: undefined,
      };

      const result = await SqlNodeExecutor.execute(config, mockInstance);

      expect(result.rowCount).toBe(2);
    });

    it("should execute query with timeout when query completes in time", async () => {
      const config: SqlNodeConfig = {
        connection: "test-db",
        query: "SELECT * FROM users",
        timeout: 5000, // 5 seconds
      };

      const result = await SqlNodeExecutor.execute(config, mockInstance);

      expect(result.rowCount).toBe(2);
    });

    it("should timeout when query takes too long", async () => {
      const slowPool: SqlConnectionPool = {
        query: vi.fn(async () => {
          // Simulate slow query
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { rows: [], rowCount: 0 };
        }),
      };
      registerSqlConnectionPool("slow-db", slowPool);

      const config: SqlNodeConfig = {
        connection: "slow-db",
        query: "SELECT * FROM large_table",
        timeout: 50, // 50ms timeout
      };

      await expect(
        SqlNodeExecutor.execute(config, mockInstance),
      ).rejects.toThrow(/SQL query timeout after 50ms/);

      unregisterSqlConnectionPool("slow-db");
    });
  });

  describe("Different Query Types", () => {
    it("should handle SELECT queries", async () => {
      const config: SqlNodeConfig = {
        connection: "test-db",
        query: "SELECT * FROM users WHERE active = true",
      };

      const result = await SqlNodeExecutor.execute(config, mockInstance);

      expect(result.rows).toBeDefined();
      expect(result.rowCount).toBeGreaterThanOrEqual(0);
    });

    it("should handle INSERT queries", async () => {
      const insertPool: SqlConnectionPool = {
        query: vi.fn(async () => ({
          rows: [],
          rowCount: 1,
        })),
      };
      registerSqlConnectionPool("insert-db", insertPool);

      const config: SqlNodeConfig = {
        connection: "insert-db",
        query: "INSERT INTO users (name, email) VALUES ($1, $2)",
        parameters: ["Charlie", "charlie@example.com"],
      };

      const result = await SqlNodeExecutor.execute(config, mockInstance);

      expect(result.rowCount).toBe(1);
      expect(result.rows).toEqual([]);

      unregisterSqlConnectionPool("insert-db");
    });

    it("should handle UPDATE queries", async () => {
      const updatePool: SqlConnectionPool = {
        query: vi.fn(async () => ({
          rows: [],
          rowCount: 3,
        })),
      };
      registerSqlConnectionPool("update-db", updatePool);

      const config: SqlNodeConfig = {
        connection: "update-db",
        query: "UPDATE users SET active = false WHERE last_login < $1",
        parameters: ["2023-01-01"],
      };

      const result = await SqlNodeExecutor.execute(config, mockInstance);

      expect(result.rowCount).toBe(3);

      unregisterSqlConnectionPool("update-db");
    });

    it("should handle DELETE queries", async () => {
      const deletePool: SqlConnectionPool = {
        query: vi.fn(async () => ({
          rows: [],
          rowCount: 2,
        })),
      };
      registerSqlConnectionPool("delete-db", deletePool);

      const config: SqlNodeConfig = {
        connection: "delete-db",
        query: "DELETE FROM users WHERE id = $1",
        parameters: [999],
      };

      const result = await SqlNodeExecutor.execute(config, mockInstance);

      expect(result.rowCount).toBe(2);

      unregisterSqlConnectionPool("delete-db");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty result set", async () => {
      const emptyPool: SqlConnectionPool = {
        query: vi.fn(async () => ({
          rows: [],
          rowCount: 0,
        })),
      };
      registerSqlConnectionPool("empty-db", emptyPool);

      const config: SqlNodeConfig = {
        connection: "empty-db",
        query: "SELECT * FROM users WHERE id = -1",
      };

      const result = await SqlNodeExecutor.execute(config, mockInstance);

      expect(result.rows).toEqual([]);
      expect(result.rowCount).toBe(0);

      unregisterSqlConnectionPool("empty-db");
    });

    it("should handle large result sets", async () => {
      const largeRows = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
      }));

      const largePool: SqlConnectionPool = {
        query: vi.fn(async () => ({
          rows: largeRows,
          rowCount: 1000,
        })),
      };
      registerSqlConnectionPool("large-db", largePool);

      const config: SqlNodeConfig = {
        connection: "large-db",
        query: "SELECT * FROM users",
      };

      const result = await SqlNodeExecutor.execute(config, mockInstance);

      expect(result.rows).toHaveLength(1000);
      expect(result.rowCount).toBe(1000);

      unregisterSqlConnectionPool("large-db");
    });

    it("should handle null and undefined parameters", async () => {
      const config: SqlNodeConfig = {
        connection: "test-db",
        query: "SELECT * FROM users WHERE deleted_at IS NULL",
        parameters: undefined,
      };

      const result = await SqlNodeExecutor.execute(config, mockInstance);

      expect(result).toBeDefined();
      expect(mockPool.query).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE deleted_at IS NULL",
        undefined,
      );
    });
  });
});
