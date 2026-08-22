import { pathToFileURL } from "node:url";

import { bootstrap } from "../bootstrap";
import { destroyContainer } from "../container";
import type { WorkflowDefinition } from "../model/Workflow";
import { Logger } from "../utils/Logger";

// 测试工作流定义
const testWorkflow: WorkflowDefinition = {
  id: "test-flow",
  name: "Test Workflow Flow",
  startNode: "start-action",
  triggerEvents: ["test_event"],
  nodes: {
    "start-action": {
      id: "start-action",
      type: "action",
      action: async () => {
        Logger.info("test", "start-action", "Starting test workflow...");
        return { started: true };
      },
      next: ["wait-event"],
    },
    "wait-event": {
      id: "wait-event",
      type: "event",
      onEvent: "test_event",
      timeout: 3000, // 3秒超时
      next: ["success-action"],
      rollbackTo: "start-action", // 超时后回滚到开始节点
      failureNext: ["failure-action"], // 失败路径
      maxRetries: 1, // 最多重试1次
    },
    "success-action": {
      id: "success-action",
      type: "action",
      action: async () => {
        Logger.info(
          "test",
          "success-action",
          "Event received, executing success action...",
        );
        return { success: true };
      },
      next: [],
    },
    "failure-action": {
      id: "failure-action",
      type: "action",
      action: async () => {
        Logger.info(
          "test",
          "failure-action",
          "Event timeout, executing failure action...",
        );
        return { failure: true };
      },
      next: [],
    },
  },
};

// 测试函数
async function testWorkflowFlow() {
  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
  });

  try {
    // 注册工作流
    await engine.register(testWorkflow);
    Logger.info("test", "register", "Test workflow registered");

    // 启动工作流
    const instanceId = await engine.start("test-flow", {
      testId: "TEST-001",
    });
    Logger.info(
      "test",
      "start",
      `Workflow started with instance ID: ${instanceId}`,
    );

    // 等待一段时间后触发事件
    const eventTimer = setTimeout(() => {
      Logger.info(
        "test",
        "event",
        `Emitting test_event for instance ${instanceId}...`,
      );
      container.eventBus.emit("test_event", {
        token: "test123",
        instanceId,
        timestamp: new Date().toISOString(),
      });
    }, 2000); // 2秒后触发事件（在超时前）

    const instance = await engine.waitForCompletion(instanceId, {
      timeoutMs: 10_000,
    });
    clearTimeout(eventTimer);
    Logger.info(
      "test",
      "monitor",
      `Workflow finished with status: ${instance.status}`,
    );

    // 输出执行历史
    Logger.info("test", "history", "Execution history:");
    instance.history.forEach((log, index) => {
      Logger.info(
        "test",
        "history",
        `${index + 1}. ${log.nodeId}: ${log.status}${log.duration ? ` (${log.duration}ms)` : ""}${log.error ? ` - ${log.error}` : ""}`,
      );
    });
  } catch (error) {
    Logger.error(
      "test",
      "main",
      "Test failed",
      error instanceof Error ? error.stack : String(error),
    );
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

// 测试超时场景
async function testTimeoutScenario() {
  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
  });

  try {
    await engine.register(testWorkflow);

    const instanceId = await engine.start("test-flow", {
      testId: "TEST-002",
    });
    Logger.info(
      "test",
      "timeout-test",
      `Timeout test started with instance ID: ${instanceId}`,
    );

    const instance = await engine.waitForCompletion(instanceId, {
      timeoutMs: 10_000,
    });
    Logger.info(
      "test",
      "timeout-monitor",
      `Timeout test finished with status: ${instance.status}`,
    );

    // 输出执行历史
    Logger.info("test", "timeout-history", "Timeout test execution history:");
    instance.history.forEach((log, index) => {
      Logger.info(
        "test",
        "timeout-history",
        `${index + 1}. ${log.nodeId}: ${log.status}${log.duration ? ` (${log.duration}ms)` : ""}${log.error ? ` - ${log.error}` : ""}`,
      );
    });
  } catch (error) {
    Logger.error(
      "test",
      "timeout-test",
      "Timeout test failed",
      error instanceof Error ? error.stack : String(error),
    );
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

// 导出测试函数
export { testWorkflowFlow, testTimeoutScenario };

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void (async () => {
    // 运行正常流程测试
    await testWorkflowFlow();
    // 运行超时场景测试
    await testTimeoutScenario();
  })();
}
