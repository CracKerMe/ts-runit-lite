import { afterEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../../model/Instance";
import type { TaskNode } from "../../../model/Workflow";
import {
  execute,
  initWorkerPool,
  shutdownWorkerPool,
} from "../../../engine/TaskExecutor";

function createInstance(): WorkflowInstance {
  return {
    instanceId: "worker-http-instance",
    workflowId: "worker-http-workflow",
    status: "running",
    context: {},
    currentNodes: ["http-node"],
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
  } as WorkflowInstance;
}

describe("TaskExecutor worker integration", () => {
  afterEach(async () => {
    await shutdownWorkerPool();
  });

  it("executes HTTP nodes through WorkerPool when enabled", async () => {
    initWorkerPool({
      minWorkers: 1,
      maxWorkers: 1,
      taskTimeout: 5000,
      idleTimeout: 30000,
    });

    const instance = createInstance();
    const node: TaskNode = {
      id: "http-node",
      type: "http",
      config: {
        method: "GET",
        url: "data:application/json,%7B%22ok%22%3Atrue%7D",
      },
      next: ["done"],
    } as TaskNode;

    const nextNodes = await new Promise<string[]>((resolve, reject) => {
      execute(node, instance, resolve, reject);
    });
    expect(nextNodes).toEqual(["done"]);
    const output = instance.state?.nodes?.["http-node"]?.output;
    expect(output).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(instance.history[0]).toMatchObject({
      nodeId: "http-node",
      status: "success",
    });
  });
});
