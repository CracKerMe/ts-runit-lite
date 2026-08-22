import type { WorkflowInstance } from "../model/Instance";
import type { TaskNode, WorkflowDefinition } from "../model/Workflow";
import { Logger } from "../utils/Logger";

/**
 * 节点执行结果
 */
export interface NodeExecutionResult {
  nodeId: string;
  success: boolean;
  nextNodes: string[];
  error?: Error;
  duration: number;
}

/**
 * 并行执行结果
 */
export interface ParallelExecutionResult {
  allSucceeded: boolean;
  results: NodeExecutionResult[];
  nextNodes: string[];
  errors: Error[];
}

/**
 * 并行节点执行器
 * 支持真正的并行执行多个节点
 */
export class ParallelExecutor {
  constructor(
    private executeNode: (
      node: TaskNode,
      instance: WorkflowInstance,
    ) => Promise<string[]>,
  ) {}

  /**
   * 并行执行多个节点
   */
  async executeParallel(
    nodeIds: string[],
    workflow: WorkflowDefinition,
    instance: WorkflowInstance,
  ): Promise<ParallelExecutionResult> {
    if (nodeIds.length === 0) {
      return {
        allSucceeded: true,
        results: [],
        nextNodes: [],
        errors: [],
      };
    }

    // 单节点直接执行
    if (nodeIds.length === 1) {
      const result = await this.executeSingleNode(
        nodeIds[0],
        workflow,
        instance,
      );
      return {
        allSucceeded: result.success,
        results: [result],
        nextNodes: result.nextNodes,
        errors: result.error ? [result.error] : [],
      };
    }

    Logger.info(
      instance.instanceId,
      "parallel",
      `Executing ${nodeIds.length} nodes in parallel: ${nodeIds.join(", ")}`,
    );

    // 并行执行所有节点
    const promises = nodeIds.map((nodeId) =>
      this.executeSingleNode(nodeId, workflow, instance),
    );

    const results = await Promise.allSettled(promises);

    // 聚合结果
    const executionResults: NodeExecutionResult[] = [];
    const nextNodesSet = new Set<string>();
    const errors: Error[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const nodeId = nodeIds[i];

      if (result.status === "fulfilled") {
        executionResults.push(result.value);
        if (result.value.success) {
          result.value.nextNodes.forEach((n) => {
            nextNodesSet.add(n);
          });
        } else if (result.value.error) {
          errors.push(result.value.error);
        }
      } else {
        const error =
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason));
        errors.push(error);
        executionResults.push({
          nodeId,
          success: false,
          nextNodes: [],
          error,
          duration: 0,
        });
      }
    }

    const allSucceeded = errors.length === 0;

    Logger.info(
      instance.instanceId,
      "parallel",
      `Parallel execution completed: ${executionResults.filter((r) => r.success).length}/${nodeIds.length} succeeded`,
    );

    return {
      allSucceeded,
      results: executionResults,
      nextNodes: Array.from(nextNodesSet),
      errors,
    };
  }

  /**
   * 执行单个节点
   */
  private async executeSingleNode(
    nodeId: string,
    workflow: WorkflowDefinition,
    instance: WorkflowInstance,
  ): Promise<NodeExecutionResult> {
    const node = workflow.nodes[nodeId];
    if (!node) {
      return {
        nodeId,
        success: false,
        nextNodes: [],
        error: new Error(`Node not found: ${nodeId}`),
        duration: 0,
      };
    }

    const startTime = Date.now();

    try {
      const nextNodes = await this.executeNode(node, instance);

      // 注意：输出已在 executeNode 内部（TaskExecutor）持久化到 instance.state.nodes

      return {
        nodeId,
        success: true,
        nextNodes,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        nodeId,
        success: false,
        nextNodes: [],
        error: error instanceof Error ? error : new Error(String(error)),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 处理部分失败场景
   * 根据策略决定是否继续执行
   */
  handlePartialFailure(
    result: ParallelExecutionResult,
    strategy: "fail-fast" | "continue" | "ignore-errors" = "continue",
  ): { shouldContinue: boolean; nextNodes: string[] } {
    switch (strategy) {
      case "fail-fast":
        // 任何失败都停止
        return {
          shouldContinue: result.allSucceeded,
          nextNodes: result.allSucceeded ? result.nextNodes : [],
        };

      case "continue": {
        // 有成功的就继续
        const hasSuccess = result.results.some((r) => r.success);
        return {
          shouldContinue: hasSuccess,
          nextNodes: result.nextNodes,
        };
      }

      case "ignore-errors":
        // 忽略错误，总是继续
        return {
          shouldContinue: true,
          nextNodes: result.nextNodes,
        };

      default:
        return {
          shouldContinue: result.allSucceeded,
          nextNodes: result.nextNodes,
        };
    }
  }
}

/**
 * 合并多个分支的结果到上下文
 */
export function mergeParallelResults(
  instance: WorkflowInstance,
  results: NodeExecutionResult[],
): void {
  if (!instance.context.__parallelResults) {
    instance.context.__parallelResults = {};
  }

  for (const result of results) {
    instance.context.__parallelResults[result.nodeId] = {
      success: result.success,
      duration: result.duration,
      error: result.error?.message,
    };
  }
}
