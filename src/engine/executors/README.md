# Node Executors

This directory contains specialized node executors for different node types in the workflow engine.

## Available Executors

### HttpNodeExecutor

Executes HTTP requests with configurable method, URL, headers, and body.

**Features:**

- Support for all HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
- Expression evaluation in configuration fields
- Timeout support
- Retry policies (linear and exponential backoff)
- Automatic content-type handling
- Redirect following

**Example:**

```typescript
const httpNode = {
  id: "fetch-data",
  type: "http",
  config: {
    method: "GET",
    url: "https://api.example.com/data/${context.userId}",
    headers: {
      Authorization: "Bearer ${context.token}",
    },
    timeout: 5000,
    retryPolicy: {
      maxRetries: 3,
      backoff: "exponential",
      initialDelay: 1000,
    },
  },
  next: ["process-data"],
};
```

### SqlNodeExecutor

Executes SQL queries with connection pooling and parameterized query support.

**Features:**

- Connection pool management
- Parameterized queries for SQL injection prevention
- Expression evaluation in queries and parameters
- Timeout support
- Support for multiple database types (PostgreSQL, MySQL, SQLite, MSSQL, etc.)

**Setup:**

Before using SQL nodes, you must register a connection pool:

```typescript
import { registerSqlConnectionPool } from "./engine/executors/SqlNodeExecutor";
import { Pool } from "pg"; // Example with PostgreSQL

// Create a connection pool (example with pg)
const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "mydb",
  user: "user",
  password: "password",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Wrap the pool to match the SqlConnectionPool interface
const sqlPool = {
  query: async (sql: string, params?: any[]) => {
    const result = await pool.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount || 0,
    };
  },
  close: async () => {
    await pool.end();
  },
};

// Register the pool with a name
registerSqlConnectionPool("main-db", sqlPool);
```

**Example Workflow Node:**

```typescript
const sqlNode = {
  id: "fetch-users",
  type: "sql",
  config: {
    connection: "main-db", // Reference to registered pool
    query: "SELECT * FROM users WHERE status = $1 AND created_at > $2",
    parameters: ["active", "${context.startDate}"],
    timeout: 10000, // 10 seconds
  },
  next: ["process-users"],
};
```

**SELECT Query Example:**

```typescript
{
  id: 'get-user',
  type: 'sql',
  config: {
    connection: 'main-db',
    query: 'SELECT id, name, email FROM users WHERE id = $1',
    parameters: ['${context.userId}']
  }
}
// Output: { rows: [...], rowCount: 1, duration: 45 }
```

**INSERT Query Example:**

```typescript
{
  id: 'create-user',
  type: 'sql',
  config: {
    connection: 'main-db',
    query: 'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id',
    parameters: ['${context.userName}', '${context.userEmail}']
  }
}
// Output: { rows: [{ id: 123 }], rowCount: 1, duration: 23 }
```

**UPDATE Query Example:**

```typescript
{
  id: 'update-status',
  type: 'sql',
  config: {
    connection: 'main-db',
    query: 'UPDATE orders SET status = $1 WHERE id = $2',
    parameters: ['shipped', '${context.orderId}']
  }
}
// Output: { rows: [], rowCount: 1, duration: 18 }
```

**DELETE Query Example:**

```typescript
{
  id: 'delete-old-records',
  type: 'sql',
  config: {
    connection: 'main-db',
    query: 'DELETE FROM logs WHERE created_at < $1',
    parameters: ['${context.cutoffDate}']
  }
}
// Output: { rows: [], rowCount: 150, duration: 67 }
```

**Using Query Results in Subsequent Nodes:**

The SQL node output is stored in `state.nodes[nodeId].output` and can be referenced in subsequent nodes:

```typescript
{
  id: 'process-results',
  type: 'action',
  action: async (instance) => {
    // Access the SQL query results
    const sqlOutput = instance.state.nodes['fetch-users'].output;
    console.log(`Found ${sqlOutput.rowCount} users`);
    console.log(`Query took ${sqlOutput.duration}ms`);

    // Process the rows
    for (const user of sqlOutput.rows) {
      console.log(`User: ${user.name} (${user.email})`);
    }
  }
}
```

**Connection Pool Management:**

```typescript
import {
  registerSqlConnectionPool,
  unregisterSqlConnectionPool,
  getSqlConnectionPool,
} from "./engine/executors/SqlNodeExecutor";

// Register a pool
registerSqlConnectionPool("analytics-db", analyticsPool);

// Get a registered pool
const pool = getSqlConnectionPool("analytics-db");

// Unregister and close a pool (automatically calls close() if available)
unregisterSqlConnectionPool("analytics-db");
```

**Error Handling:**

The SQL executor will throw errors in the following cases:

- Connection pool not found (not registered)
- Query execution failure
- Timeout exceeded

These errors will be caught by the workflow engine's error handling mechanism and can trigger retry logic or compensation.

**Best Practices:**

1. **Use Parameterized Queries**: Always use parameterized queries ($1, $2, etc.) instead of string interpolation to prevent SQL injection
2. **Set Appropriate Timeouts**: Configure timeouts based on expected query duration
3. **Connection Pool Sizing**: Size your connection pools appropriately for your workload
4. **Error Handling**: Implement proper error handling and retry logic for transient failures
5. **Resource Cleanup**: Unregister connection pools when shutting down the application

### QueueNodeExecutor

Executes queue operations (publish/consume) with timeout support for message queues.

**Features:**

- Support for publish and consume operations
- Expression evaluation in configuration fields
- Timeout support for consume operations
- Pluggable queue provider system (RabbitMQ, Redis, AWS SQS, etc.)
- Connection management with cleanup

**Setup:**

Before using Queue nodes, you must register a queue provider:

```typescript
import { registerQueueProvider } from "./engine/executors/QueueNodeExecutor";

// Example: In-memory queue provider (for testing)
const inMemoryQueues = new Map<string, any[]>();

const queueProvider = {
  publish: async (queue: string, message: any): Promise<string> => {
    if (!inMemoryQueues.has(queue)) {
      inMemoryQueues.set(queue, []);
    }
    const messageId = `msg-${Date.now()}`;
    inMemoryQueues.get(queue)!.push(message);
    return messageId;
  },
  consume: async (queue: string, timeout?: number): Promise<any> => {
    const messages = inMemoryQueues.get(queue) || [];
    if (messages.length === 0) {
      throw new Error("No messages available");
    }
    return messages.shift();
  },
  close: async () => {
    inMemoryQueues.clear();
  },
};

// Register the provider
registerQueueProvider("default", queueProvider);
```

**Example Workflow Nodes:**

**Publish Message:**

```typescript
const publishNode = {
  id: "send-notification",
  type: "queue",
  config: {
    operation: "publish",
    queue: "notifications",
    message: {
      type: "email",
      to: "${context.userEmail}",
      subject: "Order Confirmation",
      body: "Your order ${context.orderId} has been confirmed",
    },
  },
  next: ["next-step"],
};
// Output: { messageId: 'msg-1234567890' }
```

**Consume Message:**

```typescript
const consumeNode = {
  id: "process-order",
  type: "queue",
  config: {
    operation: "consume",
    queue: "orders",
    timeout: 30000, // 30 seconds
  },
  next: ["handle-order"],
};
// Output: { message: { orderId: 'ORD-123', items: [...] } }
```

**Using Queue Results in Subsequent Nodes:**

```typescript
{
  id: 'handle-message',
  type: 'action',
  action: async (instance) => {
    // Access consumed message
    const queueOutput = instance.state.nodes['process-order'].output;
    const message = queueOutput.message;

    console.log(`Processing order: ${message.orderId}`);
    // Process the message...
  }
}
```

**Queue Provider Management:**

```typescript
import {
  registerQueueProvider,
  unregisterQueueProvider,
  getQueueProvider,
} from "./engine/executors/QueueNodeExecutor";

// Register a provider
registerQueueProvider("default", myQueueProvider);

// Get a registered provider
const provider = getQueueProvider("default");

// Unregister and close a provider (automatically calls close() if available)
unregisterQueueProvider("default");
```

**Error Handling:**

The Queue executor will throw errors in the following cases:

- Queue provider not found (not registered)
- Publish operation without message
- Consume timeout exceeded
- Invalid operation type
- Provider connection failures

These errors will be caught by the workflow engine's error handling mechanism and can trigger retry logic or compensation.

**Best Practices:**

1. **Register Providers Early**: Register queue providers during application initialization
2. **Set Appropriate Timeouts**: Configure consume timeouts based on expected message availability
3. **Handle Empty Queues**: Implement proper error handling for empty queue scenarios
4. **Message Format**: Use consistent message formats across your workflows
5. **Resource Cleanup**: Unregister queue providers when shutting down the application

### ConditionNodeExecutor

Evaluates a boolean expression and routes to a `trueBranch` or `falseBranch`.

**Features:**

- Expression evaluation with access to workflow context and state
- Interpolation of configuration fields
- Detailed logging of evaluation result and duration

**Example:**

```typescript
const conditionNode = {
  id: "check-high-value",
  type: "condition",
  config: {
    condition: "${context.orderAmount} > 1000",
    trueBranch: "priority-process",
    falseBranch: "standard-process",
  },
};
```

**Output:** `{ result: true, branch: 'true' }`

### RouterNodeExecutor

Evaluates multiple conditions in priority order and routes to the first matching target.

**Features:**

- Priority-based route evaluation
- Fallback `defaultTarget` support
- Full expression support for all conditions
- Detailed routing trace

**Example:**

```typescript
const routerNode = {
  id: "route-by-region",
  type: "router",
  config: {
    routes: [
      {
        condition: '${context.region} == "US"',
        target: "us-warehouse",
        priority: 1,
      },
      {
        condition: '${context.region} == "EU"',
        target: "eu-warehouse",
        priority: 1,
      },
      {
        condition: '${context.userType} == "VIP"',
        target: "express-shipping",
        priority: 0,
      },
    ],
    defaultTarget: "global-warehouse",
  },
};
```

**Output:** `{ matchedRoute: 2, target: 'express-shipping' }`

### LoopNodeExecutor

Iterates over a collection and executes a body node for each item. Supports sequential and parallel execution.

**Features:**

- Sequential or parallel iteration modes
- Concurrency control for parallel execution (`maxConcurrency`)
- Custom item and index variable names
- Aggregation of results from each iteration

## Adding New Executors

To add a new node executor:

1. Create a new file in this directory (e.g., `CustomNodeExecutor.ts`)
2. Define the configuration and output interfaces
3. Implement the executor class with a static `execute` method
4. Register the node type in `TaskExecutor.ts`
5. Add the node type to the `TaskType` union in `src/model/Workflow.ts`
6. Write comprehensive unit tests

Example structure:

```typescript
export interface MyNodeConfig {
  // Configuration fields
}

export interface MyNodeOutput {
  // Output fields
}

export class MyNodeExecutor {
  static async execute(
    config: MyNodeConfig,
    instance: WorkflowInstance,
  ): Promise<MyNodeOutput> {
    // Implementation
  }
}
```
