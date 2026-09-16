import { getContainer } from "../container";
import { Logger } from "../utils/Logger";
import { WorkflowEngine } from "./WorkflowEngine";

/**
 * 引擎创建选项
 */
export interface CreateEngineOptions {
  maxInstances?: number;
  instanceTtlHours?: number;
  cleanupIntervalMs?: number;
}

/**
 * 创建工作流引擎
 * 自动从容器获取依赖，简化引擎创建
 */
export async function createEngine(
  options: CreateEngineOptions = {},
): Promise<WorkflowEngine> {
  const container = getContainer();
  if (!container) {
    throw new Error("Container not initialized. Call createContainer() first.");
  }

  Logger.info("system", "engine", "Creating WorkflowEngine");

  const engine = new WorkflowEngine(
    container.storage,
    container.eventBus,
    container.scheduler,
    container.dlq,
    {
      maxInstances: options.maxInstances ?? container.config.maxInstances,
      instanceTtlHours:
        options.instanceTtlHours ?? container.config.instanceTtlHours,
      cleanupIntervalMs:
        options.cleanupIntervalMs ?? container.config.cleanupIntervalMs,
    },
  );

  await engine.initialize();
  return engine;
}

/**
 * 快速创建 V2 引擎（推荐）
 */
export async function createEngineV2(
  options: CreateEngineOptions = {},
): Promise<WorkflowEngine> {
  return createEngine(options);
}
