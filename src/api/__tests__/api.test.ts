import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap } from "../../bootstrap";
import type { AppContainer } from "../../container";
import { destroyContainer } from "../../container";
import type { WorkflowEngineV2 } from "../../engine/WorkflowEngineV2";

/**
 * WorkflowEngine 集成测试
 * 测试核心功能
 */

describe("WorkflowEngine Integration Tests", () => {
  let engine: WorkflowEngineV2;
  let container: AppContainer;

  beforeAll(async () => {
    const ctx = await bootstrap({
      skipValidation: true,
      skipGracefulShutdown: true,
    });
    engine = ctx.engine;
    container = ctx.container;

    // 注册测试工作流
    await engine.register({
      id: "test-workflow",
      name: "Test Workflow",
      version: "1.0.0",
      startNode: "start",
      nodes: {
        start: {
          id: "start",
          type: "action",
          action: async () => ({ success: true }),
          next: ["end"],
        },
        end: {
          id: "end",
          type: "action",
          action: async () => ({ completed: true }),
          next: [],
        },
      },
    });
  });

  afterAll(() => {
    engine.destroy();
    return destroyContainer(container);
  });

  describe("Workflow Registration", () => {
    it("should register workflow successfully", async () => {
      // 注册不应抛出错误
      await expect(
        engine.register({
          id: "another-workflow",
          name: "Another Workflow",
          version: "1.0.0",
          startNode: "init",
          nodes: {
            init: {
              id: "init",
              type: "action",
              action: async () => ({ done: true }),
              next: [],
            },
          },
        }),
      ).resolves.not.toThrow();
    });
  });

  describe("Instance Management", () => {
    it("should start workflow instance", async () => {
      const instanceId = await engine.start("test-workflow", {
        testData: "value",
      });

      expect(instanceId).toBeDefined();
      expect(typeof instanceId).toBe("string");
    });

    it("should get instance by ID", async () => {
      const instanceId = await engine.start("test-workflow", {});

      // 等待一下让实例状态更新
      await new Promise((resolve) => setTimeout(resolve, 50));

      const instance = engine.getInstance(instanceId);

      expect(instance).toBeDefined();
      expect(instance?.instanceId).toBe(instanceId);
      expect(instance?.workflowId).toBe("test-workflow");
    });

    it("should list all instances", async () => {
      // 启动几个实例
      await engine.start("test-workflow", {});
      await engine.start("test-workflow", {});

      await new Promise((resolve) => setTimeout(resolve, 50));

      const instanceIds = engine.listInstances();

      expect(instanceIds).toBeDefined();
      expect(Array.isArray(instanceIds)).toBe(true);
      expect(instanceIds.length).toBeGreaterThanOrEqual(2);
    });

    it("should return undefined for non-existent instance", () => {
      const instance = engine.getInstance("non-existent-id");
      expect(instance).toBeUndefined();
    });
  });

  describe("Instance Lifecycle", () => {
    it("should track instance status", async () => {
      const instanceId = await engine.start("test-workflow", {});

      // 等待执行
      await new Promise((resolve) => setTimeout(resolve, 100));

      const instance = engine.getInstance(instanceId);

      expect(instance).toBeDefined();
      // 实例应该在某个有效状态
      expect(["pending", "running", "completed", "failed"]).toContain(
        instance?.status,
      );
    });

    it("should store context data", async () => {
      const testContext = { userId: "123", action: "test" };
      const instanceId = await engine.start("test-workflow", testContext);

      const instance = engine.getInstance(instanceId);

      expect(instance?.context).toBeDefined();
      expect(instance?.context.userId).toBe("123");
    });

    it("should have timestamps", async () => {
      const instanceId = await engine.start("test-workflow", {});
      const instance = engine.getInstance(instanceId);

      expect(instance?.createdAt).toBeInstanceOf(Date);
      expect(instance?.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("Error Handling", () => {
    it("should throw error for non-existent workflow", async () => {
      await expect(engine.start("non-existent-workflow", {})).rejects.toThrow();
    });
  });
});
