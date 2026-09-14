import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import type { TaskNode } from "../../model/Workflow";
import { EnvSecretProvider, SecretManager } from "../../utils/SecretManager";
import { disposeSecretManager, setSecretManager } from "../../utils/secrets";
import {
  registerSqlConnectionPool,
  unregisterSqlConnectionPool,
} from "../executors/SqlNodeExecutor";
import { dispatchControlNode } from "../nodeDispatch/controlNodes";
import { dispatchIoNode } from "../nodeDispatch/ioNodes";
import type { NodeDispatchContext } from "../nodeDispatch/types";
import { taskQueueManager } from "../TaskQueueManager";

function makeInstance(): WorkflowInstance {
  return {
    instanceId: "inst-wiring",
    workflowId: "wf-wiring",
    status: "running",
    context: {},
    state: { nodes: {} },
    currentNodes: [],
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 0,
  } as WorkflowInstance;
}

function makeContext(node: TaskNode): NodeDispatchContext {
  return {
    node,
    instance: makeInstance(),
    logEntry: {} as NodeDispatchContext["logEntry"],
    startTime: Date.now(),
    onComplete: () => undefined,
    storage: undefined,
  } as unknown as NodeDispatchContext;
}

describe("secret resolution in IO node dispatch", () => {
  beforeEach(() => {
    process.env.DB_PASSWORD = "pw-from-secret";
    setSecretManager(new SecretManager(new EnvSecretProvider()));
  });

  afterEach(() => {
    disposeSecretManager();
    delete process.env.DB_PASSWORD;
    unregisterSqlConnectionPool("main");
  });

  it("resolves ${secret:...} before the SQL executor sees the config", async () => {
    let observedConnection: string | undefined;

    registerSqlConnectionPool("main", {
      async query() {
        return { rows: [], rowCount: 0 };
      },
    });

    const node: TaskNode = {
      id: "load",
      type: "sql",
      config: {
        connection: "main",
        query: "SELECT 1",
        // The secret sits in a nested field to prove deep resolution.
        parameters: ["${secret:DB_PASSWORD}"],
      },
    };

    const ctx = makeContext(node);
    // Capture what the executor received via the registered pool.
    registerSqlConnectionPool("main", {
      async query(_sql: string, params?: unknown[]) {
        observedConnection = params?.[0] as string;
        return { rows: [], rowCount: 0 };
      },
    });

    await dispatchIoNode(ctx);

    expect(observedConnection).toBe("pw-from-secret");
  });
});

describe("task queue routing for action nodes", () => {
  afterEach(() => {
    taskQueueManager.unregisterWorker("wiring-worker");
    taskQueueManager.deleteQueue("wiring-queue");
  });

  it("runs the node on the queue worker when one is registered", async () => {
    let ranOnWorker = false;

    taskQueueManager.registerWorker(
      "wiring-worker",
      ["wiring-queue"],
      async () => {
        ranOnWorker = true;
        return { via: "queue" };
      },
    );

    const node: TaskNode = {
      id: "queued",
      type: "action",
      taskQueue: "wiring-queue",
      action: async () => ({ via: "local" }),
    };

    const ctx = makeContext(node);
    await dispatchControlNode(ctx);

    expect(ranOnWorker).toBe(true);
    expect(ctx.instance.state?.nodes?.queued?.output).toEqual({ via: "queue" });
  });

  it("falls back to local execution when no worker serves the queue", async () => {
    const node: TaskNode = {
      id: "unserved",
      type: "action",
      taskQueue: "nobody-listening",
      action: async () => ({ via: "local" }),
    };

    const ctx = makeContext(node);
    await dispatchControlNode(ctx);

    // A queue with no worker must not strand the node.
    expect(ctx.instance.state?.nodes?.unserved?.output).toEqual({
      via: "local",
    });
  });
});
