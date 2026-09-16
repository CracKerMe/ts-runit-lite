import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap } from "../../../bootstrap";
import type { AppContainer } from "../../../container";
import { destroyContainer } from "../../../container";
import type { WorkflowEngine } from "../../../engine/WorkflowEngine";
import type { WorkflowDefinition } from "../../../model/Workflow";

/**
 * Regression guard: action 节点的 config.action 字符串曾用
 * `context.instance` 包装，但沙箱里实际注入的变量是 `instance`——
 * `context` 根本不存在，任何引用它的 action 字符串都会 ReferenceError，
 * 而这个错误又被内部 catch 悄悄吞掉、伪装成 { status: "completed" }。
 */
describe("action node config.action string execution", () => {
  let engine: WorkflowEngine;
  let container: AppContainer;

  beforeAll(async () => {
    const ctx = await bootstrap({
      skipValidation: true,
      skipGracefulShutdown: true,
    });
    engine = ctx.engine;
    container = ctx.container;
  });

  afterAll(async () => {
    engine.destroy();
    await destroyContainer(container);
  });

  it("executes a minimal action string and completes the node", async () => {
    const workflow: WorkflowDefinition = {
      id: "action-string-basic",
      name: "Action String Basic",
      version: "1.0.0",
      startNode: "compute",
      nodes: {
        compute: {
          id: "compute",
          type: "action",
          config: { action: "return 42;" },
          next: [],
        },
      },
    };

    await engine.register(workflow);
    const instanceId = await engine.start("action-string-basic", {});
    await new Promise((resolve) => setTimeout(resolve, 100));

    const instance = engine.getInstance(instanceId);
    expect(instance?.status).toBe("completed");
    expect(instance?.state?.nodes?.compute?.output).toBe(42);
  });

  it("fails the node instead of masking a sandbox error as success", async () => {
    const workflow: WorkflowDefinition = {
      id: "action-string-throws",
      name: "Action String Throws",
      version: "1.0.0",
      startNode: "compute",
      nodes: {
        compute: {
          id: "compute",
          type: "action",
          config: { action: "throw new Error('boom');" },
          next: [],
        },
      },
    };

    await engine.register(workflow);
    const instanceId = await engine.start("action-string-throws", {});
    await new Promise((resolve) => setTimeout(resolve, 100));

    const instance = engine.getInstance(instanceId);
    expect(instance?.status).toBe("failed");
    const nodeLog = instance?.history.find((h) => h.nodeId === "compute");
    expect(nodeLog?.status).toBe("failed");
  });
});
