import { createHookPayload, hookManager } from "../event/HookManager";
import { recordNodeRetry } from "../metrics/index";
import type { WorkflowInstance } from "../model/Instance";
import type { TaskNode } from "../model/Workflow";
import { Logger } from "../utils/Logger";
import type { InstanceManager } from "./InstanceManager";
import type { WorkflowRegistry } from "./WorkflowRegistry";

export class WorkflowInstanceControl {
  constructor(
    private readonly instanceManager: InstanceManager,
    private readonly workflowRegistry: WorkflowRegistry,
    private readonly executeInstance: (
      instance: WorkflowInstance,
    ) => Promise<void>,
  ) {}

  async retryNode(instanceId: string, nodeId: string): Promise<void> {
    const instance = await this.loadLatestInstance(instanceId);
    this.requireWorkflowNode(instance.workflowId, nodeId);

    const nodeHistory = instance.history.filter((log) => log.nodeId === nodeId);
    const lastExecution = nodeHistory[nodeHistory.length - 1];
    if (!lastExecution || lastExecution.status !== "failed") {
      throw new Error(
        `Node ${nodeId} is not in a failed state and cannot be retried`,
      );
    }

    instance.retries ??= {};
    instance.retries[nodeId] = (instance.retries[nodeId] ?? 0) + 1;

    void hookManager.emit(
      createHookPayload({
        event: "node.retry",
        workflowId: instance.workflowId,
        instanceId,
        nodeId,
        status: "retrying",
        traceId: instance.traceId,
        data: { retryCount: instance.retries[nodeId], manual: true },
      }),
    );

    recordNodeRetry(instance.workflowId, nodeId);
    Logger.log(
      instanceId,
      nodeId,
      `Retrying node (attempt ${instance.retries[nodeId]})`,
      { originalInput: lastExecution.data },
    );

    instance.currentNodes = [nodeId];
    instance.status = "running";
    instance.updatedAt = new Date();
    const updated = await this.persistControlUpdate(instance, (current) => {
      current.currentNodes = [nodeId];
      current.status = "running";
      current.updatedAt = new Date();
    });
    await this.executeInstance(updated);
  }

  async skipNode(
    instanceId: string,
    nodeId: string,
    defaultOutput?: unknown,
  ): Promise<void> {
    const instance = await this.loadLatestInstance(instanceId);
    const node = this.requireWorkflowNode(instance.workflowId, nodeId);
    const nodeHistory = instance.history.filter((log) => log.nodeId === nodeId);
    const lastExecution = nodeHistory[nodeHistory.length - 1];

    if (lastExecution?.status === "success") {
      throw new Error(
        `Node ${nodeId} has already completed successfully and cannot be skipped`,
      );
    }

    Logger.log(instanceId, nodeId, "Skipping node", { defaultOutput });
    void hookManager.emit(
      createHookPayload({
        event: "node.skipped",
        workflowId: instance.workflowId,
        instanceId,
        nodeId,
        status: "skipped",
        traceId: instance.traceId,
        data: { defaultOutput },
      }),
    );

    instance.history.push({
      nodeId,
      timestamp: new Date(),
      status: "skipped",
      data: defaultOutput ?? null,
    });
    instance.state ??= { nodes: {} };
    instance.state.nodes ??= {};
    instance.state.nodes[nodeId] = { output: defaultOutput ?? null };
    instance.currentNodes = node.next || [];
    instance.status = "running";
    instance.updatedAt = new Date();
    const updated = await this.persistControlUpdate(instance, (current) => {
      current.history = instance.history;
      current.state = instance.state;
      current.currentNodes = node.next || [];
      current.status = "running";
      current.updatedAt = new Date();
    });

    if (updated.currentNodes.length > 0) {
      await this.executeInstance(updated);
      return;
    }

    updated.status = "completed";
    updated.updatedAt = new Date();
    await this.instanceManager.updateInstance(updated);
    void hookManager.emit(
      createHookPayload({
        event: "workflow.completed",
        workflowId: updated.workflowId,
        instanceId,
        status: updated.status,
        traceId: updated.traceId,
        data: { lastNodeId: nodeId },
      }),
    );
    Logger.log(instanceId, nodeId, "Workflow completed after skip");
  }

  async compensate(instanceId: string, reason?: string): Promise<void> {
    const instance = await this.loadLatestInstance(instanceId);
    const workflow = this.requireWorkflow(instance.workflowId);

    Logger.log(instanceId, "system", "Starting compensation", { reason });
    const completedNodes = instance.history
      .filter((log) => log.status === "success")
      .map((log) => log.nodeId);
    const uniqueCompletedNodes = Array.from(new Set(completedNodes)).reverse();
    const rollbackNodes: string[] = [];

    for (const nodeId of uniqueCompletedNodes) {
      const node = workflow.nodes[nodeId];
      if (!node?.rollbackTo) continue;
      const rollbackNode = workflow.nodes[node.rollbackTo];
      if (rollbackNode?.type === "rollback") {
        rollbackNodes.push(node.rollbackTo);
      }
    }

    if (rollbackNodes.length === 0) {
      Logger.log(
        instanceId,
        "system",
        "No rollback nodes found for compensation",
      );
      return;
    }

    Logger.log(
      instanceId,
      "system",
      `Executing ${rollbackNodes.length} rollback nodes in reverse order`,
      { rollbackNodes },
    );

    for (const rollbackNodeId of rollbackNodes) {
      const rollbackNode = workflow.nodes[rollbackNodeId];
      if (!rollbackNode) continue;
      Logger.log(instanceId, rollbackNodeId, "Executing compensation node");

      try {
        if (rollbackNode.action) {
          const startTime = Date.now();
          await rollbackNode.action(instance);
          instance.history.push({
            nodeId: rollbackNodeId,
            timestamp: new Date(),
            status: "rollback",
            duration: Date.now() - startTime,
          });
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        Logger.error(
          instanceId,
          rollbackNodeId,
          "Compensation node failed",
          err.stack,
        );
        instance.history.push({
          nodeId: rollbackNodeId,
          timestamp: new Date(),
          status: "failed",
          error: err.message,
          stack: err.stack,
        });
      }
    }

    instance.status = "rollback";
    instance.updatedAt = new Date();
    await this.persistControlUpdate(instance, (current) => {
      current.history = instance.history;
      current.status = "rollback";
      current.updatedAt = new Date();
    });
    Logger.log(instanceId, "system", "Compensation completed");
  }

  async pauseInstance(instanceId: string): Promise<boolean> {
    const instance = await this.loadLatestInstance(instanceId);
    if (instance.status !== "running") {
      throw new Error(
        `Instance ${instanceId} is not running and cannot be paused (status: ${instance.status})`,
      );
    }

    Logger.log(instanceId, "system", "Pausing instance");
    await this.persistControlUpdate(instance, (current) => {
      current.status = "paused";
      current.updatedAt = new Date();
    });

    void hookManager.emit(
      createHookPayload({
        event: "workflow.paused",
        workflowId: instance.workflowId,
        instanceId,
        status: "paused",
        traceId: instance.traceId,
      }),
    );

    return true;
  }

  async resumeInstance(instanceId: string): Promise<boolean> {
    const instance = await this.loadLatestInstance(instanceId);
    if (instance.status !== "paused") {
      throw new Error(
        `Instance ${instanceId} is not paused and cannot be resumed (status: ${instance.status})`,
      );
    }

    Logger.log(instanceId, "system", "Resuming instance");
    const updated = await this.persistControlUpdate(instance, (current) => {
      current.status = "running";
      current.updatedAt = new Date();
    });

    void hookManager.emit(
      createHookPayload({
        event: "workflow.resumed",
        workflowId: instance.workflowId,
        instanceId,
        status: "running",
        traceId: instance.traceId,
      }),
    );

    await this.executeInstance(updated);
    return true;
  }

  async cancelInstance(instanceId: string): Promise<boolean> {
    const instance = await this.loadLatestInstance(instanceId);
    if (instance.status === "completed" || instance.status === "cancelled") {
      throw new Error(
        `Instance ${instanceId} is already in a terminal state (status: ${instance.status})`,
      );
    }

    Logger.log(instanceId, "system", "Cancelling instance");
    await this.persistControlUpdate(instance, (current) => {
      current.status = "cancelled";
      current.currentNodes = [];
      current.updatedAt = new Date();
    });

    void hookManager.emit(
      createHookPayload({
        event: "workflow.cancelled",
        workflowId: instance.workflowId,
        instanceId,
        status: "cancelled",
        traceId: instance.traceId,
      }),
    );

    return true;
  }

  /**
   * Forceful variant of cancelInstance: succeeds (returns false, doesn't
   * throw) for an instance already in a terminal state, and works from
   * "paused" as well as "running"/"pending"/"rollback".
   */
  async terminateInstance(instanceId: string): Promise<boolean> {
    const instance = await this.loadLatestInstance(instanceId);
    if (instance.status === "completed" || instance.status === "cancelled") {
      return false;
    }

    Logger.log(instanceId, "system", "Terminating instance");
    await this.persistControlUpdate(instance, (current) => {
      current.status = "cancelled";
      current.currentNodes = [];
      current.updatedAt = new Date();
    });

    void hookManager.emit(
      createHookPayload({
        event: "workflow.cancelled",
        workflowId: instance.workflowId,
        instanceId,
        status: "cancelled",
        traceId: instance.traceId,
        data: { terminated: true },
      }),
    );

    return true;
  }

  private requireInstance(instanceId: string): WorkflowInstance {
    const instance = this.instanceManager.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }
    return instance;
  }

  private async loadLatestInstance(
    instanceId: string,
  ): Promise<WorkflowInstance> {
    const inMemory = this.requireInstance(instanceId);
    const storage = this.instanceManager.storageProvider;
    if (!storage) {
      return inMemory;
    }

    const fresh = await storage.loadInstance(instanceId);
    if (!fresh) {
      return inMemory;
    }

    this.instanceManager.getInstancesMap().set(instanceId, fresh);
    return fresh;
  }

  private async persistControlUpdate(
    instance: WorkflowInstance,
    mutate: (current: WorkflowInstance) => void,
  ): Promise<WorkflowInstance> {
    let current = instance;
    for (let attempt = 0; attempt < 5; attempt++) {
      mutate(current);
      const storage = this.instanceManager.storageProvider;
      if (storage) {
        const persisted = await storage.loadInstance(current.instanceId);
        if (!persisted) {
          current.version = 1;
          await storage.saveInstance(current);
          this.instanceManager
            .getInstancesMap()
            .set(current.instanceId, current);
          return current;
        }
      }
      try {
        await this.instanceManager.updateInstance(current);
        return current;
      } catch (error) {
        current = await this.loadLatestInstance(instance.instanceId);
        if (attempt === 4) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    return current;
  }

  private requireWorkflow(workflowId: string) {
    const workflow = this.workflowRegistry.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    return workflow;
  }

  private requireWorkflowNode(workflowId: string, nodeId: string): TaskNode {
    const workflow = this.requireWorkflow(workflowId);
    const node = workflow.nodes[nodeId];
    if (!node) {
      throw new Error(`Node ${nodeId} not found in workflow ${workflowId}`);
    }
    return node;
  }
}
