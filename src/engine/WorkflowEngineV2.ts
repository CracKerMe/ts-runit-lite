// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import { v4 as uuidv4 } from "uuid";
import type { DeadLetterQueue } from "../dlq/index";
import type { EventBus } from "../event/EventBus";
import { EventCoordinator } from "../event/EventCoordinator";
import { createHookPayload, hookManager } from "../event/HookManager";
import {
  type MessageHandler,
  messageBus,
  type SignalHandler,
} from "../event/MessageBus";
import { recordWorkflowComplete, recordWorkflowStart } from "../metrics/index";
import type { WorkflowInstance } from "../model/Instance";
import type { WorkflowDefinition } from "../model/Workflow";
import type { CronScheduler } from "../scheduler/CronScheduler";
import type {
  PromotionRules,
  StorageProvider,
} from "../storage/StorageProvider";
import { createLeaseStore, type LeaseStore } from "../utils/LeaseStore";
import { parseEnvInt } from "../utils/env";
import { Logger } from "../utils/Logger";
import { destroyConcurrencyControl } from "./ConcurrencyControl";
import {
  CanaryReleaseManager,
  type CanaryStatus,
  type PromotionEvaluation,
} from "./CanaryReleaseManager";
import {
  type ContinueAsNewOptions,
  type ContinueAsNewResult,
  continueAsNewManager,
} from "./ContinueAsNewManager";
import {
  DataValidationError,
  getValidationMode,
  validateAgainstSchema,
} from "./DataValidator";
import {
  DryRunExecutor,
  type DryRunResult as SandboxDryRunResult,
} from "./DryRunExecutor";
import { ExecutionOrchestrator } from "./ExecutionOrchestrator";
import { HeartbeatManager } from "./HeartbeatManager";
import { InstanceManager } from "./InstanceManager";
import { LifecycleManager } from "./LifecycleManager";
import { WorkflowInstanceControl } from "./WorkflowInstanceControl";
import { WorkflowPersistenceCoordinator } from "./WorkflowPersistenceCoordinator";
import { type ReleasePolicy, WorkflowRegistry } from "./WorkflowRegistry";

export interface WaitForCompletionOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

/**
 * 工作流引擎 V2 - 支持依赖注入和模块化架构
 */
export class WorkflowEngineV2 {
  private instanceManager: InstanceManager;
  private workflowRegistry: WorkflowRegistry;
  private lifecycleManager: LifecycleManager;
  private eventCoordinator: EventCoordinator;
  private executionOrchestrator: ExecutionOrchestrator;
  private leaseStore: LeaseStore;
  private heartbeatManager: HeartbeatManager;
  private canaryReleaseManager: CanaryReleaseManager;
  private dryRunExecutor: DryRunExecutor;
  private workflowPersistence: WorkflowPersistenceCoordinator;
  private workflowControl: WorkflowInstanceControl;
  private readonly leaseHolderId = uuidv4();
  private readonly instanceLeaseTtlMs: number;

  constructor(
    private storage: StorageProvider,
    eventBus: EventBus,
    scheduler: CronScheduler,
    private dlq: DeadLetterQueue,
    private config: {
      instanceTtlHours: number;
      cleanupIntervalMs: number;
      maxInstances: number;
    },
  ) {
    // 初始化各个管理器
    this.instanceManager = new InstanceManager(storage);
    this.workflowRegistry = new WorkflowRegistry(scheduler, eventBus);
    this.lifecycleManager = new LifecycleManager(storage, {
      instanceTtlHours: config.instanceTtlHours,
      cleanupIntervalMs: config.cleanupIntervalMs,
      eventRetentionDays: parseEnvInt(process.env.EVENT_RETENTION_DAYS, 90, {
        min: 0,
      }),
    });
    this.eventCoordinator = new EventCoordinator(eventBus, storage);
    this.leaseStore = createLeaseStore();
    this.heartbeatManager = new HeartbeatManager(storage, this.leaseHolderId);
    // 从存储恢复的心跳没有可序列化的 onTimeout 回调，注入引擎级兜底，
    // 否则重启后超时只会静默清理定时器，卡住的节点永远不会被判失败。
    this.heartbeatManager.setDefaultOnTimeout((instanceId, nodeId) => {
      Logger.error(
        instanceId,
        nodeId,
        "Restored heartbeat timed out; node is no longer reporting progress",
      );
    });
    // min:1000 —— NaN 或极小值都会让 Math.max(1000, ttl/2) 退化，
    // setInterval(fn, NaN) 被 Node 强制为 1ms，续约定时器每毫秒触发。
    this.instanceLeaseTtlMs = parseEnvInt(
      process.env.INSTANCE_LEASE_TTL_MS,
      30000,
      { min: 1000 },
    );
    this.executionOrchestrator = new ExecutionOrchestrator(
      this.instanceManager,
      this.eventCoordinator,
      async (instanceId) => this.ensureInstanceLease(instanceId),
      async (instance) => this.handleContinueAsNew(instance),
      async (workflowId, context, options) =>
        this.start(workflowId, context, {
          parentInstanceId: options?.parentInstanceId,
        }),
    );
    this.canaryReleaseManager = new CanaryReleaseManager(this.storage, this);
    this.dryRunExecutor = new DryRunExecutor((workflowId) =>
      this.workflowRegistry.getWorkflow(workflowId),
    );
    this.workflowPersistence = new WorkflowPersistenceCoordinator(
      this.storage,
      this.workflowRegistry,
      (workflowId, context) => this.start(workflowId, context),
    );
    this.workflowControl = new WorkflowInstanceControl(
      this.instanceManager,
      this.workflowRegistry,
      (instance) => this.execute(instance),
    );
  }

  /**
   * 初始化引擎（从存储加载实例等）
   * 说明：构造函数无法 await，因此需要在 bootstrap/createEngine 后显式调用。
   */
  async initialize(options?: {
    resumeRunningInstances?: boolean;
  }): Promise<void> {
    await this.workflowPersistence.restorePersistedWorkflows();
    await this.instanceManager.loadFromStorage();

    // Restore heartbeats from storage
    await this.heartbeatManager.restoreHeartbeats();

    // Start lifecycle management
    this.lifecycleManager.start(() => this.instanceManager.getInstancesMap());
    this.canaryReleaseManager.startEvaluationLoop();

    if (options?.resumeRunningInstances) {
      this.resumeRunningInstances();
    }
  }

  /**
   * 注册工作流
   */
  async register(
    workflow: WorkflowDefinition,
    options?: { version?: string; setActive?: boolean; persist?: boolean },
  ): Promise<void> {
    await this.workflowRegistry.register(
      workflow,
      (workflowId, context) => this.start(workflowId, context),
      options,
    );

    if (options?.persist !== false) {
      await this.workflowPersistence.persistWorkflowDefinition(
        workflow,
        options?.version,
      );
    }
  }

  /**
   * 启动工作流实例
   */
  async start(
    workflowId: string,
    context: Record<string, any> = {},
    options?: {
      version?: string;
      searchAttributes?: Record<string, string | number | boolean>;
      parentInstanceId?: string;
      tenantId?: string;
    },
  ): Promise<string> {
    let resolvedVersion = this.workflowRegistry.resolveVersion(
      workflowId,
      options?.version,
    );
    if (!resolvedVersion) {
      await this.workflowPersistence.hydrateWorkflowFromStorage(workflowId);
      resolvedVersion = this.workflowRegistry.resolveVersion(
        workflowId,
        options?.version,
      );
    }
    const workflow = resolvedVersion
      ? this.workflowRegistry.getWorkflow(workflowId, resolvedVersion)
      : this.workflowRegistry.getWorkflow(workflowId, options?.version);
    if (!workflow) {
      throw new Error(
        `Workflow ${workflowId}${options?.version ? ` version ${options.version}` : ""} not found`,
      );
    }

    // 输入 Schema 校验（SCHEMA_VALIDATION=strict|warn|off，默认 off）
    if (workflow.inputSchema) {
      const mode = getValidationMode();
      if (mode !== "off") {
        const validation = validateAgainstSchema(workflow.inputSchema, context);
        if (!validation.valid) {
          if (mode === "strict") {
            throw new DataValidationError(validation.issues);
          }
          Logger.warn(
            "system",
            "engine",
            `Workflow ${workflowId} input validation failed (warn mode)`,
            { issues: validation.issues },
          );
        }
      }
    }

    // 检查实例数限制
    if (this.instanceManager.getInstanceCount() >= this.config.maxInstances) {
      throw new Error(
        `Max instances limit (${this.config.maxInstances}) reached`,
      );
    }

    // 创建实例
    const instance = await this.instanceManager.createInstance(
      workflowId,
      workflow.startNode,
      context,
      resolvedVersion,
      options?.searchAttributes,
      options?.parentInstanceId,
      options?.tenantId,
    );

    // 记录指标
    recordWorkflowStart(workflowId);

    Logger.log(instance.instanceId, "system", "Workflow started", {
      workflowId,
    });
    void hookManager.emit(
      createHookPayload({
        event: "workflow.started",
        workflowId,
        instanceId: instance.instanceId,
        status: instance.status,
        traceId: instance.traceId,
        data: { context },
      }),
    );

    // 异步执行
    this.execute(instance).catch((err) => {
      Logger.error(
        instance.instanceId,
        "system",
        "Execute error",
        err instanceof Error ? err.stack : String(err),
      );

      // 添加到死信队列
      this.dlq.push({
        type: "workflow",
        payload: { instanceId: instance.instanceId, workflowId, context },
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        retryCount: 0,
        instanceId: instance.instanceId,
        workflowId,
      });
    });

    return instance.instanceId;
  }

  /**
   * 执行工作流
   */
  protected async execute(instance: WorkflowInstance): Promise<void> {
    const resolvedVersion =
      instance.workflowVersion ||
      this.workflowRegistry.resolveVersion(instance.workflowId);
    const workflow = resolvedVersion
      ? this.workflowRegistry.getWorkflow(instance.workflowId, resolvedVersion)
      : undefined;
    if (!workflow) {
      throw new Error(`Workflow ${instance.workflowId} not found`);
    }
    if (!instance.workflowVersion && resolvedVersion) {
      instance.workflowVersion = resolvedVersion;
      await this.instanceManager.updateInstance(instance);
    }
    const startTime = Date.now();
    await this.withInstanceLease(instance.instanceId, async () => {
      try {
        // 使用 ExecutionOrchestrator 执行工作流
        await this.executionOrchestrator.execute(instance, workflow);

        // 记录工作流完成
        const duration = (Date.now() - startTime) / 1000;
        recordWorkflowComplete(instance.workflowId, "completed", duration);
      } catch (error) {
        // 记录工作流失败
        const duration = (Date.now() - startTime) / 1000;
        recordWorkflowComplete(instance.workflowId, "failed", duration);
        throw error;
      }
    });
  }

  /**
   * 注册一个 Continue-As-New 续期请求。
   * 当前实例正常执行到终点后，引擎会以结转的 input/searchAttributes 启动一个新实例，
   * 用于避免单个长运行实例的历史无限膨胀（类似 Temporal 的 ContinueAsNew）。
   */
  continueAsNew(
    instanceId: string,
    options: ContinueAsNewOptions = {},
  ): ContinueAsNewResult {
    return continueAsNewManager.prepareContinueAsNew(instanceId, options);
  }

  /**
   * 工作流完成时的回调：若存在待处理的续期，则真正启动新实例。
   */
  private async handleContinueAsNew(instance: WorkflowInstance): Promise<void> {
    if (!continueAsNewManager.hasPendingContinuation(instance.instanceId)) {
      return;
    }

    const options = continueAsNewManager.getContinuation(instance.instanceId);
    continueAsNewManager.clearContinuation(instance.instanceId);
    if (!options) return;

    const targetWorkflowId = options.workflowId ?? instance.workflowId;
    const searchAttributes = options.searchAttributes as
      | Record<string, string | number | boolean>
      | undefined;

    const newInstanceId = await this.start(
      targetWorkflowId,
      options.input ?? {},
      { searchAttributes },
    );

    const newInstance = this.instanceManager.getInstance(newInstanceId);
    if (newInstance) {
      newInstance.continuedFromInstanceId = instance.instanceId;
      await this.instanceManager.updateInstance(newInstance);
    }

    Logger.info(
      instance.instanceId,
      "continue-as-new",
      `Continued as new instance ${newInstanceId}`,
      { targetWorkflowId },
    );
  }

  private getInstanceLeaseKey(instanceId: string): string {
    return `workflow:lease:instance:${instanceId}`;
  }

  private async ensureInstanceLease(instanceId: string): Promise<boolean> {
    const key = this.getInstanceLeaseKey(instanceId);
    return this.leaseStore.renew(
      key,
      this.leaseHolderId,
      this.instanceLeaseTtlMs,
    );
  }

  private async withInstanceLease<T>(
    instanceId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = this.getInstanceLeaseKey(instanceId);
    const acquired = await this.leaseStore.acquire(
      key,
      this.leaseHolderId,
      this.instanceLeaseTtlMs,
    );
    if (!acquired) {
      Logger.info(
        instanceId,
        "system",
        "Instance lease not acquired, skipping execution",
        { key },
      );
      return undefined as T;
    }

    let renewTimer: NodeJS.Timeout | undefined;
    try {
      renewTimer = setInterval(
        () => {
          this.leaseStore
            .renew(key, this.leaseHolderId, this.instanceLeaseTtlMs)
            .then((ok) => {
              if (!ok) {
                Logger.warn(
                  instanceId,
                  "system",
                  "Instance lease renewal failed",
                  { key },
                );
              }
            })
            .catch((err) => {
              Logger.error(
                instanceId,
                "system",
                "Instance lease renewal error",
                err instanceof Error ? err.stack : String(err),
              );
            });
        },
        Math.max(1000, Math.floor(this.instanceLeaseTtlMs / 2)),
      );

      return await fn();
    } finally {
      if (renewTimer) {
        clearInterval(renewTimer);
      }
      await this.leaseStore.release(key, this.leaseHolderId);
    }
  }

  /**
   * 重载存储后恢复未完成实例。
   * 供 Leader 选举场景在当选（可能是启动很久之后的接任）时调用，
   * 确保基于最新的实例视图恢复。
   */
  async resumeRunningInstancesFromStorage(): Promise<void> {
    await this.instanceManager.loadFromStorage();
    await this.restoreOrphanedWaitingStates();
    this.resumeRunningInstances();
  }

  /**
   * Restore event/approval waiting states that don't belong to an instance
   * about to be resumed by resumeRunningInstances() below (e.g. the instance
   * is no longer in memory, already terminal, or its currentNodes moved on).
   * Instances that ARE about to be resumed get their subscription recreated
   * naturally when execute() re-enters the waiting node — restoring those
   * here too would install a dead-end subscription first and block the real
   * one (see EventCoordinator.restoreWaitingStates for why).
   */
  private async restoreOrphanedWaitingStates(): Promise<void> {
    const instances = this.instanceManager.getInstancesMap();
    await this.eventCoordinator.restoreWaitingStates((instanceId, nodeId) => {
      const instance = instances.get(instanceId);
      if (!instance) return false;
      const resumableStatus =
        instance.status === "running" ||
        instance.status === "pending" ||
        instance.status === "rollback";
      return resumableStatus && instance.currentNodes.includes(nodeId);
    });
  }

  private resumeRunningInstances(): void {
    const instances = Array.from(
      this.instanceManager.getInstancesMap().values(),
    );
    const resumable = instances.filter(
      (instance) =>
        (instance.status === "running" ||
          instance.status === "pending" ||
          instance.status === "rollback") &&
        instance.currentNodes.length > 0,
    );

    if (resumable.length === 0) {
      return;
    }

    Logger.info(
      "system",
      "engine",
      `Resuming ${resumable.length} instance(s) from storage`,
    );

    for (const instance of resumable) {
      this.execute(instance).catch((err) => {
        Logger.error(
          instance.instanceId,
          "system",
          "Resume execute error",
          err instanceof Error ? err.stack : String(err),
        );

        this.dlq.push({
          type: "workflow",
          payload: {
            instanceId: instance.instanceId,
            workflowId: instance.workflowId,
          },
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          retryCount: 0,
          instanceId: instance.instanceId,
          workflowId: instance.workflowId,
        });
      });
    }
  }

  /**
   * 获取实例
   */
  getInstance(instanceId: string): WorkflowInstance | undefined {
    return this.instanceManager.getInstance(instanceId);
  }

  /**
   * Wait until an instance reaches a terminal state.
   */
  async waitForCompletion(
    instanceId: string,
    options: WaitForCompletionOptions = {},
  ): Promise<WorkflowInstance> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const pollIntervalMs = options.pollIntervalMs ?? 20;
    const deadline = Date.now() + timeoutMs;

    while (true) {
      if (options.signal?.aborted) {
        throw new Error(`Waiting for workflow instance ${instanceId} aborted`);
      }

      const instance = this.getInstance(instanceId);
      if (!instance) {
        throw new Error(`Workflow instance ${instanceId} not found`);
      }

      if (["completed", "failed", "cancelled"].includes(instance.status)) {
        return instance;
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for workflow instance ${instanceId} after ${timeoutMs}ms`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * 列出所有实例 ID
   */
  listInstances(): string[] {
    return this.instanceManager.listInstances();
  }

  /**
   * 获取工作流定义
   */
  getWorkflow(
    workflowId: string,
    version?: string,
  ): WorkflowDefinition | undefined {
    return this.workflowRegistry.getWorkflow(workflowId, version);
  }

  /**
   * 列出所有工作流 ID
   */
  listWorkflows(): string[] {
    return this.workflowRegistry.listWorkflows();
  }

  listWorkflowVersions(workflowId: string): string[] {
    return this.workflowRegistry.listVersions(workflowId);
  }

  getActiveWorkflowVersion(workflowId: string): string | undefined {
    return this.workflowRegistry.getActiveVersion(workflowId);
  }

  setActiveWorkflowVersion(workflowId: string, version: string): void {
    this.workflowRegistry.setActiveVersion(workflowId, version);
  }

  getLockedWorkflowVersion(workflowId: string): string | undefined {
    return this.workflowRegistry.getLockedVersion(workflowId);
  }

  setLockedWorkflowVersion(workflowId: string, version: string): void {
    this.workflowRegistry.setLockedVersion(workflowId, version);
  }

  clearLockedWorkflowVersion(workflowId: string): void {
    this.workflowRegistry.clearLockedVersion(workflowId);
  }

  setReleasePolicy(workflowId: string, policy: ReleasePolicy): void {
    this.workflowRegistry.setReleasePolicy(workflowId, policy);
  }

  async startCanaryRelease(
    workflowId: string,
    version: number,
    percent: number,
    rules?: PromotionRules,
  ): Promise<void> {
    await this.canaryReleaseManager.startCanaryRelease(
      workflowId,
      version,
      percent,
      rules,
    );
  }

  async promoteCanary(workflowId: string): Promise<void> {
    await this.canaryReleaseManager.promoteCanary(workflowId);
  }

  async rollbackCanary(workflowId: string): Promise<void> {
    await this.canaryReleaseManager.rollbackCanary(workflowId);
  }

  async getCanaryStatus(workflowId: string): Promise<CanaryStatus> {
    return this.canaryReleaseManager.getCanaryStatus(workflowId);
  }

  async evaluateCanaryPromotion(
    workflowId: string,
  ): Promise<PromotionEvaluation> {
    return this.canaryReleaseManager.evaluatePromotion(workflowId);
  }

  getReleasePolicy(workflowId: string): ReleasePolicy | undefined {
    return this.workflowRegistry.getReleasePolicy(workflowId);
  }

  /**
   * 销毁引擎，清理资源
   */
  destroy(): void {
    this.canaryReleaseManager.stopEvaluationLoop();
    this.lifecycleManager.destroy();
    this.eventCoordinator.destroy();
    this.heartbeatManager.stopAll();
    // 全局并发控制器的清理定时器此前无人负责，destroy() 后进程仍被钉住
    destroyConcurrencyControl();
    Logger.info("system", "engine", "WorkflowEngineV2 destroyed");
  }

  /**
   * Retry a failed node with its original input
   * @param instanceId - The workflow instance ID
   * @param nodeId - The node ID to retry
   * @returns Promise<void>
   */
  async retryNode(instanceId: string, nodeId: string): Promise<void> {
    await this.workflowControl.retryNode(instanceId, nodeId);
  }

  /**
   * Skip a node and continue workflow execution
   * @param instanceId - The workflow instance ID
   * @param nodeId - The node ID to skip
   * @param defaultOutput - Optional default output to use for the skipped node
   * @returns Promise<void>
   */
  async skipNode(
    instanceId: string,
    nodeId: string,
    defaultOutput?: any,
  ): Promise<void> {
    await this.workflowControl.skipNode(instanceId, nodeId, defaultOutput);
  }

  /**
   * Trigger compensation for a workflow instance
   * Executes rollback nodes in reverse dependency order
   * @param instanceId - The workflow instance ID
   * @param reason - Optional reason for compensation
   * @returns Promise<void>
   */
  async compensate(instanceId: string, reason?: string): Promise<void> {
    await this.workflowControl.compensate(instanceId, reason);
  }

  /** Pause a running instance. Throws if it isn't currently running. */
  async pauseInstance(instanceId: string): Promise<boolean> {
    return this.workflowControl.pauseInstance(instanceId);
  }

  /** Resume a paused instance and continue execution from its current nodes. */
  async resumeInstance(instanceId: string): Promise<boolean> {
    return this.workflowControl.resumeInstance(instanceId);
  }

  /** Cancel an instance. Throws if it's already in a terminal state. */
  async cancelInstance(instanceId: string): Promise<boolean> {
    return this.workflowControl.cancelInstance(instanceId);
  }

  /**
   * Forcefully cancel an instance. Unlike cancelInstance, this doesn't throw
   * for an already-terminal instance — it returns false instead.
   */
  async terminateInstance(instanceId: string): Promise<boolean> {
    return this.workflowControl.terminateInstance(instanceId);
  }

  /**
   * Dry-run mode: Simulate workflow execution without side effects
   * @param workflowId - The workflow ID to simulate
   * @param input - Input context for the workflow
   * @param options - Dry-run options
   * @returns Promise<DryRunResult>
   */
  async dryRun(
    workflowId: string,
    input: Record<string, any> = {},
    options: DryRunOptions = {},
  ): Promise<DryRunResult> {
    const workflow = this.workflowRegistry.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const result: SandboxDryRunResult = await this.dryRunExecutor.execute(
      workflow,
      {
        context: input,
        mockResponses: options.mockOutputs,
        skipNodes: options.skipNodes,
        stopAfterNode: options.stopAfterNode,
        recordExpressions: options.recordExpressions,
      },
    );
    if (options.failAt?.length) {
      for (const nodeId of options.failAt) {
        result.errors.push({ nodeId, error: "Simulated failure" });
      }
      result.valid = result.errors.length === 0;
      result.success = result.errors.length === 0;
    }
    return result;
  }

  /**
   * Send a signal to a running workflow instance
   * Similar to Temporal's Signal - asynchronous write request
   */
  async signal(
    instanceId: string,
    signalName: string,
    payload?: unknown,
  ): Promise<void> {
    const instance = await this.instanceManager.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }

    if (instance.status !== "running" && instance.status !== "paused") {
      throw new Error(
        `Cannot signal non-running instance: ${instanceId}, status: ${instance.status}`,
      );
    }

    await messageBus.sendSignal(instanceId, signalName, payload);

    void hookManager.emit(
      createHookPayload({
        event: "workflow.signaled",
        workflowId: instance.workflowId,
        instanceId,
        status: instance.status,
        traceId: instance.traceId,
        data: { signalName, payload },
      }),
    );

    Logger.log(instanceId, "system", `Signal sent: ${signalName}`);
  }

  /**
   * Register a signal handler for a workflow
   */
  registerSignal(name: string, handler: SignalHandler): void {
    messageBus.registerSignal(name, handler);
  }

  /**
   * Query the state of a running workflow instance
   * Similar to Temporal's Query - read-only request
   */
  async query<T = unknown>(
    instanceId: string,
    queryName: string,
    payload?: unknown,
  ): Promise<T> {
    const instance = await this.instanceManager.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }

    return messageBus.sendQuery<T>(instanceId, queryName, payload);
  }

  /**
   * Register a query handler for a workflow
   */
  registerQuery(name: string, handler: MessageHandler): void {
    messageBus.registerQuery(name, handler);
  }

  /**
   * Send an update to a running workflow and wait for response
   * Similar to Temporal's Update - synchronous tracked write request
   */
  async update<T = unknown>(
    instanceId: string,
    updateName: string,
    payload?: unknown,
    correlationId?: string,
  ): Promise<T> {
    const instance = await this.instanceManager.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }

    if (instance.status !== "running" && instance.status !== "paused") {
      throw new Error(
        `Cannot update non-running instance: ${instanceId}, status: ${instance.status}`,
      );
    }

    void hookManager.emit(
      createHookPayload({
        event: "workflow.updated",
        workflowId: instance.workflowId,
        instanceId,
        status: instance.status,
        traceId: instance.traceId,
        data: { updateName, payload },
      }),
    );

    return messageBus.sendUpdate<T>(
      instanceId,
      updateName,
      payload,
      correlationId,
    );
  }

  /**
   * Register an update handler for a workflow
   */
  registerUpdate(name: string, handler: MessageHandler): void {
    messageBus.registerUpdate(name, handler);
  }
}

/**
 * Dry-run options
 */
export interface DryRunOptions {
  /** Predefined outputs by node ID */
  mockOutputs?: Record<string, any>;
  mockResponses?: Record<string, any>;
  /** Node IDs to simulate failures */
  failAt?: string[];
  skipNodes?: string[];
  stopAfterNode?: string;
  recordExpressions?: boolean;
}

/**
 * Dry-run result
 */
export interface DryRunResult {
  success: boolean;
  valid: boolean;
  executionPath: string[];
  nodeResults?: Record<string, unknown>;
  expressionTrace?: Array<unknown>;
  warnings?: string[];
  totalDuration?: number;
  simulatedOutputs: Record<string, unknown>;
  errors: Array<{
    nodeId: string;
    error: string;
  }>;
  duration: number;
}
