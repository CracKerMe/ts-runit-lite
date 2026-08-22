// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import { hookManager } from "../event/HookManager";
import type { WorkflowInstance } from "../model/Instance";
import type { TaskNode } from "../model/Workflow";
import { Logger } from "../utils/Logger";
import { getNestedValue } from "./ExpressionEvaluator";

/**
 * 子工作流执行结果
 */
export interface SubworkflowResult {
  instanceId: string;
  status: "completed" | "failed" | "running";
  output?: Record<string, any>;
  error?: string;
}

/**
 * 子工作流执行器
 * 处理工作流嵌套调用
 */
export class SubworkflowExecutor {
  constructor(
    private startWorkflow: (
      workflowId: string,
      context: Record<string, any>,
      parentInstanceId?: string,
    ) => Promise<string>,
    private getInstanceStatus: (
      instanceId: string,
    ) => WorkflowInstance | undefined,
  ) {}

  /**
   * 执行子工作流节点
   */
  async execute(
    node: TaskNode,
    parentInstance: WorkflowInstance,
  ): Promise<SubworkflowResult> {
    if (!node.subworkflowId) {
      throw new Error("Subworkflow node missing subworkflowId");
    }

    // 构建子工作流输入参数
    const subworkflowContext = this.buildSubworkflowContext(
      node.subworkflowInput || {},
      parentInstance.context,
    );

    // 添加父实例引用
    subworkflowContext.__parentInstanceId = parentInstance.instanceId;
    subworkflowContext.__parentWorkflowId = parentInstance.workflowId;

    Logger.info(
      parentInstance.instanceId,
      node.id,
      `Starting subworkflow: ${node.subworkflowId}`,
      {
        subworkflowId: node.subworkflowId,
        waitForCompletion: node.waitForCompletion,
      },
    );

    // 启动子工作流
    const subInstanceId = await this.startWorkflow(
      node.subworkflowId,
      subworkflowContext,
      parentInstance.instanceId,
    );

    // 如果不需要等待完成，直接返回
    if (!node.waitForCompletion) {
      Logger.debug(
        parentInstance.instanceId,
        node.id,
        `Subworkflow started (fire-and-forget): ${subInstanceId}`,
      );

      const fireAndForgetResult: SubworkflowResult = {
        instanceId: subInstanceId,
        status: "running",
      };
      this.writeParentState(parentInstance, node.id, fireAndForgetResult);
      return fireAndForgetResult;
    }

    // 等待子工作流完成
    const result = await this.waitForCompletion(
      subInstanceId,
      parentInstance.instanceId,
      node.id,
      node.timeout,
    );
    this.writeParentState(parentInstance, node.id, result);
    return result;
  }

  /**
   * 构建子工作流上下文
   */
  private buildSubworkflowContext(
    inputMapping: Record<string, string>,
    parentContext: Record<string, any>,
  ): Record<string, any> {
    const context: Record<string, any> = {};

    for (const [targetKey, sourcePath] of Object.entries(inputMapping)) {
      // 支持直接值或从父上下文获取
      if (sourcePath.startsWith("$")) {
        // 直接值，如 "$literal:value"
        const value = sourcePath.substring(1);
        if (value.startsWith("literal:")) {
          context[targetKey] = value.substring(8);
        } else {
          context[targetKey] = value;
        }
      } else {
        // 从父上下文获取，支持 "parent.key" 前缀
        const resolvedPath = sourcePath.startsWith("parent.")
          ? sourcePath.substring(7)
          : sourcePath;
        context[targetKey] = getNestedValue(parentContext, resolvedPath);
      }
    }

    return context;
  }

  /**
   * 等待子工作流完成（事件驱动，订阅 hookManager 的 workflow.completed/failed 事件）
   */
  private async waitForCompletion(
    subInstanceId: string,
    parentInstanceId: string,
    nodeId: string,
    timeoutMs = 5000,
  ): Promise<SubworkflowResult> {
    // 先检查实例是否已经处于终态（避免在订阅前完成导致永久等待）
    const earlyCheck = this.getInstanceStatus(subInstanceId);
    if (!earlyCheck) {
      Logger.warn(
        parentInstanceId,
        nodeId,
        `Subworkflow instance not found: ${subInstanceId}`,
      );
      return {
        instanceId: subInstanceId,
        status: "failed",
        error: "Subworkflow instance not found",
      };
    }
    if (earlyCheck.status === "completed") {
      Logger.info(
        parentInstanceId,
        nodeId,
        `Subworkflow completed: ${subInstanceId}`,
      );
      return {
        instanceId: subInstanceId,
        status: "completed",
        output: earlyCheck.context,
      };
    }
    if (earlyCheck.status === "failed" || earlyCheck.status === "cancelled") {
      Logger.warn(
        parentInstanceId,
        nodeId,
        `Subworkflow failed: ${subInstanceId}`,
        { status: earlyCheck.status },
      );
      return {
        instanceId: subInstanceId,
        status: "failed",
        error: `Subworkflow ended with status: ${earlyCheck.status}`,
      };
    }

    return new Promise<SubworkflowResult>((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout;

      const cleanup = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          offCompleted();
          offFailed();
        }
      };

      const offCompleted = hookManager.on("workflow.completed", (payload) => {
        if (settled || payload.instanceId !== subInstanceId) return;
        cleanup();
        const instance = this.getInstanceStatus(subInstanceId);
        Logger.info(
          parentInstanceId,
          nodeId,
          `Subworkflow completed: ${subInstanceId}`,
        );
        resolve({
          instanceId: subInstanceId,
          status: "completed",
          output: instance?.context,
        });
      });

      const offFailed = hookManager.on("workflow.failed", (payload) => {
        if (settled || payload.instanceId !== subInstanceId) return;
        cleanup();
        Logger.warn(
          parentInstanceId,
          nodeId,
          `Subworkflow failed: ${subInstanceId}`,
        );
        resolve({
          instanceId: subInstanceId,
          status: "failed",
          error:
            payload.data && typeof payload.data.error === "string"
              ? payload.data.error
              : "Subworkflow failed",
        });
      });

      timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        Logger.error(
          parentInstanceId,
          nodeId,
          `Subworkflow timeout: ${subInstanceId}`,
        );
        resolve({
          instanceId: subInstanceId,
          status: "failed",
          error: `Subworkflow timeout after ${timeoutMs}ms`,
        });
      }, timeoutMs);
    });
  }

  private writeParentState(
    parentInstance: WorkflowInstance,
    nodeId: string,
    result: SubworkflowResult,
  ): void {
    if (!parentInstance.state) {
      parentInstance.state = { nodes: {} };
    }
    if (!parentInstance.state.nodes) {
      parentInstance.state.nodes = {};
    }
    parentInstance.state.nodes[nodeId] = { output: result };
  }
}
