// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import dotenv from "dotenv";
import { pathToFileURL } from "node:url";
import { bootstrap } from "../bootstrap";
import { destroyContainer } from "../container";
import type { WorkflowInstance } from "../model/Instance";
import type { WorkflowDefinition } from "../model/Workflow";
import { Logger } from "../utils/Logger";

// 加载环境变量
dotenv.config();

/**
 * 数据处理工作流示例
 * 场景：CSV 文件导入处理
 *
 * 流程：
 * 1. 接收文件上传 (receive-file)
 * 2. 格式验证 (validate-format)
 * 3. 数据清洗 (clean-data)
 * 4. 批量入库 (save-to-db)
 * 5. 生成报告 (generate-report)
 *
 * 错误处理：
 * - 验证失败 → 回滚到接收文件，最多重试 2 次
 * - 入库失败 → 执行清理操作，走失败路径
 */

// 模拟数据库
const mockDatabase: any[] = [];

// 模拟文件存储
interface FileData {
  filename: string;
  content: string;
  uploadedAt: Date;
}

const dataProcessingWorkflow: WorkflowDefinition = {
  id: "data-processing-flow",
  name: "CSV Data Processing Workflow",
  startNode: "receive-file",
  triggerEvents: ["file_uploaded"], // 可以通过文件上传事件触发
  nodes: {
    // 1. 接收文件
    "receive-file": {
      id: "receive-file",
      type: "action",
      action: async (instance: WorkflowInstance) => {
        Logger.info("data-processing", "receive-file", "📥 接收文件上传...");

        const context = instance.context;
        const fileData: FileData = context.fileData || {
          filename: context.filename || "sample-data.csv",
          content:
            context.content ||
            "id,name,age,email\n1,张三,25,zhang@example.com\n2,李四,30,li@example.com",
          uploadedAt: new Date(),
        };

        Logger.info(
          "data-processing",
          "receive-file",
          `文件接收成功: ${fileData.filename}`,
        );

        instance.context.fileData = fileData;
        instance.context.receivedAt = new Date().toISOString();

        return {
          fileData,
          receivedAt: instance.context.receivedAt,
        };
      },
      next: ["validate-format"],
    },

    // 2. 格式验证
    "validate-format": {
      id: "validate-format",
      type: "action",
      action: async (instance: WorkflowInstance) => {
        Logger.info("data-processing", "validate-format", "🔍 验证文件格式...");

        const context = instance.context;
        const { fileData } = context;
        const lines = fileData.content
          .split("\n")
          .filter((line: string) => line.trim());

        // 检查是否有数据
        if (lines.length < 2) {
          throw new Error("文件为空或只有表头");
        }

        // 检查表头格式
        const header = lines[0].split(",");
        const requiredColumns = ["id", "name", "age", "email"];
        const hasAllColumns = requiredColumns.every((col) =>
          header.includes(col),
        );

        if (!hasAllColumns) {
          throw new Error(`缺少必需列，需要: ${requiredColumns.join(", ")}`);
        }

        // 模拟：10% 概率验证失败（用于测试重试）
        if (context.simulateValidationError && Math.random() < 0.1) {
          throw new Error("格式验证失败（模拟错误）");
        }

        Logger.info(
          "data-processing",
          "validate-format",
          `✅ 格式验证通过，共 ${lines.length - 1} 条数据`,
        );

        instance.context.validatedAt = new Date().toISOString();
        instance.context.rowCount = lines.length - 1;
        instance.context.columns = header;

        return {
          validatedAt: instance.context.validatedAt,
          rowCount: instance.context.rowCount,
          columns: header,
        };
      },
      next: ["clean-data"],
      rollbackTo: "receive-file", // 验证失败回滚到接收文件
      maxRetries: 2, // 最多重试 2 次
    },

    // 3. 数据清洗
    "clean-data": {
      id: "clean-data",
      type: "action",
      action: async (instance: WorkflowInstance) => {
        Logger.info("data-processing", "clean-data", "🧹 清洗数据...");

        const context = instance.context;
        const { fileData } = context;
        const lines = fileData.content
          .split("\n")
          .filter((line: string) => line.trim());
        const header = lines[0].split(",");

        // 解析并清洗数据
        const cleanedData = lines.slice(1).map((line: string) => {
          const values = line.split(",");
          const row: any = {};

          header.forEach((col: string, i: number) => {
            let value: any = values[i]?.trim() || "";

            // 数据清洗规则
            if (col === "age") {
              value = Number.parseInt(value, 10) || 0;
            } else if (col === "email") {
              value = value.toLowerCase();
            }

            row[col] = value;
          });

          return row;
        });

        // 过滤无效数据
        const validData = cleanedData.filter((row: any) => {
          return row.id && row.name && row.age > 0 && row.email.includes("@");
        });

        Logger.info(
          "data-processing",
          "clean-data",
          `✅ 数据清洗完成，有效数据: ${validData.length}/${cleanedData.length}`,
        );

        instance.context.cleanedData = validData;
        instance.context.cleanedAt = new Date().toISOString();
        instance.context.invalidCount = cleanedData.length - validData.length;

        return {
          cleanedData: validData,
          cleanedAt: instance.context.cleanedAt,
          invalidCount: instance.context.invalidCount,
        };
      },
      next: ["save-to-db"],
    },

    // 4. 批量入库
    "save-to-db": {
      id: "save-to-db",
      type: "action",
      action: async (instance: WorkflowInstance) => {
        Logger.info("data-processing", "save-to-db", "💾 批量保存到数据库...");

        const context = instance.context;
        const { cleanedData } = context;

        // 模拟批量插入
        let successCount = 0;
        let failedCount = 0;

        for (const row of cleanedData) {
          try {
            // 模拟数据库插入
            mockDatabase.push({
              ...row,
              createdAt: new Date(),
              importBatch: instance.instanceId,
            });
            successCount++;
          } catch (error) {
            failedCount++;
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            Logger.error(
              "data-processing",
              "save-to-db",
              `插入失败: ${row.id}`,
              errorMsg,
            );
          }
        }

        if (failedCount > 0) {
          throw new Error(
            `部分数据插入失败: ${failedCount}/${cleanedData.length}`,
          );
        }

        Logger.info(
          "data-processing",
          "save-to-db",
          `✅ 数据保存成功: ${successCount} 条`,
        );

        instance.context.savedAt = new Date().toISOString();
        instance.context.successCount = successCount;
        instance.context.failedCount = failedCount;

        return {
          savedAt: instance.context.savedAt,
          successCount,
          failedCount,
        };
      },
      next: ["generate-report"],
      failureNext: ["cleanup-failed"], // 入库失败走清理路径
    },

    // 5. 生成报告
    "generate-report": {
      id: "generate-report",
      type: "action",
      action: async (instance: WorkflowInstance) => {
        Logger.info("data-processing", "generate-report", "📊 生成处理报告...");

        const context = instance.context;
        const report = {
          filename: context.fileData.filename,
          uploadedAt: context.receivedAt,
          totalRows: context.rowCount,
          validRows: context.cleanedData.length,
          invalidRows: context.invalidCount,
          savedRows: context.successCount,
          processedAt: new Date().toISOString(),
          status: "success",
        };

        Logger.info("data-processing", "generate-report", "✅ 报告生成完成");
        Logger.info(
          "data-processing",
          "generate-report",
          JSON.stringify(report, null, 2),
        );

        instance.context.report = report;
        return { report };
      },
      next: [], // 流程结束
    },

    // 失败清理节点
    "cleanup-failed": {
      id: "cleanup-failed",
      type: "action",
      action: async (instance: WorkflowInstance) => {
        Logger.info("data-processing", "cleanup-failed", "🧹 清理失败数据...");

        // 回滚已插入的数据
        const removedCount = mockDatabase.length;
        mockDatabase.length = 0; // 清空数据库（实际应该按 batchId 删除）

        Logger.info(
          "data-processing",
          "cleanup-failed",
          `已清理 ${removedCount} 条数据`,
        );

        const context = instance.context;
        const failureReport = {
          filename: context.fileData?.filename || "unknown",
          status: "failed",
          error: "数据入库失败",
          cleanedUp: true,
          processedAt: new Date().toISOString(),
        };

        Logger.error(
          "data-processing",
          "cleanup-failed",
          "❌ 处理失败",
          JSON.stringify(failureReport, null, 2),
        );

        instance.context.failureReport = failureReport;
        return { failureReport };
      },
      next: [], // 流程结束
    },
  },
};

/**
 * 测试函数：正常流程
 */
async function testNormalFlow() {
  console.log("\n========== 测试场景 1: 正常数据处理流程 ==========\n");

  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
  });

  try {
    await engine.register(dataProcessingWorkflow);

    // 模拟文件上传
    const instanceId = await engine.start("data-processing-flow", {
      filename: "users-2024.csv",
      content: `id,name,age,email
1,张三,25,zhangsan@example.com
2,李四,30,lisi@example.com
3,王五,28,wangwu@example.com
4,赵六,35,zhaoliu@example.com
5,Invalid,,0,invalid-email`,
      simulateValidationError: false,
    });

    Logger.info("test", "normal-flow", `工作流已启动: ${instanceId}`);

    // 监控流程
    await monitorWorkflow(engine, instanceId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    Logger.error("test", "normal-flow", "测试失败", errorMsg);
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

/**
 * 测试函数：验证失败重试
 */
async function testValidationRetry() {
  console.log(
    "\n========== 测试场景 2: 格式验证失败（缺少必需列） ==========\n",
  );

  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
  });

  try {
    await engine.register(dataProcessingWorkflow);

    // 模拟错误格式的文件
    const instanceId = await engine.start("data-processing-flow", {
      filename: "invalid-format.csv",
      content: `id,name,age
1,张三,25
2,李四,30`, // 缺少 email 列
    });

    Logger.info("test", "validation-retry", `工作流已启动: ${instanceId}`);

    await monitorWorkflow(engine, instanceId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    Logger.error("test", "validation-retry", "测试失败", errorMsg);
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

/**
 * 测试函数：通过事件触发
 */
async function testEventTrigger() {
  console.log("\n========== 测试场景 3: 通过事件触发工作流 ==========\n");

  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
  });

  try {
    await engine.register(dataProcessingWorkflow);

    Logger.info("test", "event-trigger", "等待文件上传事件...");

    // 模拟 2 秒后文件上传
    setTimeout(() => {
      Logger.info("test", "event-trigger", "📤 触发文件上传事件");
      container.eventBus.emit("file_uploaded", {
        filename: "event-triggered.csv",
        content: `id,name,age,email
1,事件触发,20,event@example.com`,
      });
    }, 2000);

    // 等待流程完成
    await new Promise((resolve) => setTimeout(resolve, 8000));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    Logger.error("test", "event-trigger", "测试失败", errorMsg);
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

/**
 * 监控工作流执行
 */
async function monitorWorkflow(
  engine: { getInstance(instanceId: string): WorkflowInstance | undefined },
  instanceId: string,
): Promise<void> {
  return new Promise((resolve) => {
    const monitorInterval = setInterval(() => {
      const instance = engine.getInstance(instanceId);
      if (instance) {
        Logger.info(
          "monitor",
          instanceId,
          `状态: ${instance.status}, 当前节点: ${instance.currentNodes.join(", ")}`,
        );

        if (instance.status === "completed" || instance.status === "failed") {
          clearInterval(monitorInterval);

          console.log("\n========== 执行历史 ==========");
          instance.history.forEach((log, index) => {
            const duration = log.duration ? ` (${log.duration}ms)` : "";
            const error = log.error ? ` ❌ ${log.error}` : "";
            console.log(
              `${index + 1}. [${log.status}] ${log.nodeId}${duration}${error}`,
            );
          });

          console.log("\n========== 最终结果 ==========");
          console.log(`状态: ${instance.status}`);
          console.log(`数据库记录数: ${mockDatabase.length}`);
          console.log("");

          resolve();
        }
      }
    }, 1000);
  });
}

// 导出
export {
  dataProcessingWorkflow,
  testNormalFlow,
  testValidationRetry,
  testEventTrigger,
};

// 直接运行
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  (async () => {
    await testNormalFlow();

    // 清空数据库
    mockDatabase.length = 0;

    await new Promise((resolve) => setTimeout(resolve, 2000));
    await testValidationRetry();

    await new Promise((resolve) => setTimeout(resolve, 2000));
    await testEventTrigger();
  })();
}
