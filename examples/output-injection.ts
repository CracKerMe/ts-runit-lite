// oxlint-disable no-explicit-any -- dynamic types used throughout this module
/**
 * 集成测试：节点输出引用功能
 * 验证后续节点能够通过 ${nodeId.output.path} 语法读取前置节点的输出
 */

import {
  bootstrap,
  destroyContainer,
  interpolateExpressions,
  interpolateObject,
  Logger,
  type WorkflowDefinition,
} from "../src/index";

async function testOutputInjection() {
  console.log("\n=== 测试：节点输出引用功能 ===\n");

  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
  });

  try {
    // 定义测试工作流
    const workflow: WorkflowDefinition = {
      id: "output-injection-test",
      name: "Output Injection Test Workflow",
      version: "1.0.0",
      description: "测试节点输出引用功能",
      startNode: "fetchData",
      nodes: {
        // 步骤1：获取数据
        fetchData: {
          id: "fetchData",
          type: "action",
          action: async () => {
            Logger.info("test", "fetchData", "Fetching user data...");
            return {
              userId: "user_123",
              userName: "Alice",
              score: 95,
              metadata: {
                level: "premium",
                credits: 1000,
              },
            };
          },
          next: ["processData"],
        },

        // 步骤2：处理数据（使用前一步的输出）
        processData: {
          id: "processData",
          type: "action",
          action: async (instance) => {
            // 通过表达式引用前置节点输出
            const userId = interpolateExpressions(
              "${fetchData.output.userId}",
              instance.context,
              instance.state,
            );
            const userName = interpolateExpressions(
              "${fetchData.output.userName}",
              instance.context,
              instance.state,
            );
            const score = interpolateExpressions(
              "${fetchData.output.score}",
              instance.context,
              instance.state,
            );
            const level = interpolateExpressions(
              "${fetchData.output.metadata.level}",
              instance.context,
              instance.state,
            );

            Logger.info(
              "test",
              "processData",
              `Processing data for user: ${userName} (${userId})`,
            );
            Logger.info(
              "test",
              "processData",
              `Score: ${score}, Level: ${level}`,
            );

            return {
              processedAt: new Date().toISOString(),
              summary: `User ${userName} has score ${score} at ${level} level`,
              bonus: Number.parseInt(score, 10) >= 90 ? 100 : 50,
            };
          },
          next: ["generateReport"],
        },

        // 步骤3：生成报告（使用多个前置节点的输出）
        generateReport: {
          id: "generateReport",
          type: "action",
          action: async (instance) => {
            // 使用 interpolateObject 处理复杂对象
            const reportData = interpolateObject(
              {
                title: "User Performance Report",
                user: {
                  id: "${fetchData.output.userId}",
                  name: "${fetchData.output.userName}",
                  score: "${fetchData.output.score}",
                },
                processing: {
                  timestamp: "${processData.output.processedAt}",
                  summary: "${processData.output.summary}",
                  bonus: "${processData.output.bonus}",
                },
                credits: "${fetchData.output.metadata.credits}",
              },
              instance.context,
              instance.state,
            );

            Logger.info(
              "test",
              "generateReport",
              "Report generated:",
              reportData,
            );

            return {
              reportId: "report_001",
              data: reportData,
              status: "completed",
            };
          },
          next: [],
        },
      },
    };

    // 注册工作流
    await engine.register(workflow);

    // 启动工作流
    const instanceId = await engine.start("output-injection-test", {
      testRun: true,
    });

    // 等待工作流完成
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 获取实例状态
    const instance = engine.getInstance(instanceId);

    if (!instance) {
      console.error("❌ 实例未找到");
      return false;
    }

    console.log("\n=== 工作流执行结果 ===");
    console.log(`状态: ${instance.status}`);
    console.log(`执行节点数: ${instance.history.length}`);

    // 验证节点输出
    console.log("\n=== 节点输出验证 ===");

    if (instance.state?.nodes) {
      const fetchDataOutput = instance.state.nodes.fetchData?.output as any;
      const processDataOutput = instance.state.nodes.processData?.output as any;
      const generateReportOutput = instance.state.nodes.generateReport
        ?.output as any;

      console.log("\n1. fetchData 输出:");
      console.log(JSON.stringify(fetchDataOutput, null, 2));

      console.log("\n2. processData 输出:");
      console.log(JSON.stringify(processDataOutput, null, 2));

      console.log("\n3. generateReport 输出:");
      console.log(JSON.stringify(generateReportOutput, null, 2));

      // 验证数据正确性
      const checks = [
        {
          name: "fetchData 返回了用户数据",
          pass:
            fetchDataOutput?.userId === "user_123" &&
            fetchDataOutput?.userName === "Alice",
        },
        {
          name: "processData 正确引用了 fetchData 的输出",
          pass:
            processDataOutput?.summary?.includes("Alice") &&
            processDataOutput?.bonus === 100,
        },
        {
          name: "generateReport 正确引用了多个节点的输出",
          pass:
            generateReportOutput?.data?.user?.id === "user_123" &&
            generateReportOutput?.data?.user?.name === "Alice" &&
            generateReportOutput?.data?.credits === "1000",
        },
        {
          name: "工作流成功完成",
          pass: instance.status === "completed",
        },
      ];

      console.log("\n=== 验证结果 ===");
      let allPassed = true;
      for (const check of checks) {
        const status = check.pass ? "✅" : "❌";
        console.log(`${status} ${check.name}`);
        if (!check.pass) allPassed = false;
      }

      return allPassed;
    }

    console.error("❌ 节点状态树未找到");
    return false;
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

async function testMissingOutput() {
  console.log("\n=== 测试：缺失输出的兼容性 ===\n");

  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
  });

  try {
    const workflow: WorkflowDefinition = {
      id: "missing-output-test",
      name: "Missing Output Test",
      version: "1.0.0",
      startNode: "step1",
      nodes: {
        step1: {
          id: "step1",
          type: "action",
          action: async () => {
            // 返回 undefined（模拟旧工作流）
            return undefined;
          },
          next: ["step2"],
        },
        step2: {
          id: "step2",
          type: "action",
          action: async (instance) => {
            // 尝试引用不存在的输出
            const value = interpolateExpressions(
              "${step1.output.value}",
              instance.context,
              instance.state,
            );
            const missing = interpolateExpressions(
              "${nonexistent.output.data}",
              instance.context,
              instance.state,
            );

            Logger.info(
              "test",
              "step2",
              `Value: ${value}, Missing: ${missing}`,
            );

            return {
              result: "completed",
              valueWasUndefined: value === "${step1.output.value}",
              missingWasUndefined: missing === "${nonexistent.output.data}",
            };
          },
          next: [],
        },
      },
    };

    await engine.register(workflow);
    const instanceId = await engine.start("missing-output-test", {});

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const instance = engine.getInstance(instanceId);

    if (!instance) {
      console.error("❌ 实例未找到");
      return false;
    }

    const step2Output = instance.state?.nodes?.step2?.output as any;

    console.log("\n=== 缺失输出处理结果 ===");
    console.log(JSON.stringify(step2Output, null, 2));

    const passed =
      instance.status === "completed" &&
      step2Output?.valueWasUndefined === true &&
      step2Output?.missingWasUndefined === true;

    console.log(
      passed
        ? "\n✅ 缺失输出正确处理（返回占位符，不抛异常）"
        : "\n❌ 缺失输出处理失败",
    );

    return passed;
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

// 运行测试
async function runTests() {
  try {
    const test1 = await testOutputInjection();
    const test2 = await testMissingOutput();

    console.log("\n=== 总体测试结果 ===");
    console.log(test1 ? "✅ 输出引用功能测试通过" : "❌ 输出引用功能测试失败");
    console.log(test2 ? "✅ 兼容性测试通过" : "❌ 兼容性测试失败");

    if (test1 && test2) {
      console.log("\n🎉 所有测试通过！");
      process.exit(0);
    } else {
      console.log("\n❌ 部分测试失败");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ 测试执行出错:", error);
    process.exit(1);
  }
}

runTests();
