// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import type { EventCoordinator } from "../event/EventCoordinator";
import { createHookPayload, hookManager } from "../event/HookManager";
import { recordNodeExecution } from "../metrics/index";
import type { ExecutionLog, WorkflowInstance } from "../model/Instance";
import {
  calculateRetryDelay,
  isRetryableError,
  type RetryPolicy,
  shouldRetry,
} from "../model/RetryPolicy";
import type { TaskNode, WorkflowDefinition } from "../model/Workflow";
import {
  context as otelContext,
  otelTraceId,
  recordSpanError,
  SpanStatusCode,
  startSpan,
} from "../telemetry/index";
import {
  getWorkflowSpan,
  registerWorkflowSpan,
  unregisterWorkflowSpan,
} from "../telemetry/spanRegistry";
import { Logger } from "../utils/Logger";
import type { LoopNodeConfig } from "./executors/LoopNodeExecutor";
import { LoopNodeExecutor } from "./executors/LoopNodeExecutor";
import type { InstanceManager } from "./InstanceManager";
import { StateMachine } from "./StateMachine";
import { SubworkflowExecutor } from "./SubworkflowExecutor";
import { TaskExecutor } from "./TaskExecutor";

/**
 * 执行协调器
 * 负责工作流执行的主流程、节点执行、状态管理和回滚重试机制
 */
export class ExecutionOrchestrator {
  constructor(
    private instanceManager: InstanceManager,
    private eventCoordinator?: EventCoordinator,
    private ensureLease?: (instanceId: string) => Promise<boolean>,
    /** 工作流完成时回调，用于处理 Continue-As-New 续期 */
    private onWorkflowComplete?: (instance: WorkflowInstance) => Promise<void>,
    private startWorkflow?: (
      workflowId: string,
      context: Record<string, any>,
      options?: { parentInstanceId?: string },
    ) => Promise<string>,
  ) {}

  /**
   * 执行工作流实例
   */
  async execute(
    instance: WorkflowInstance,
    workflow: WorkflowDefinition,
  ): Promise<void> {
    const existingWorkflowSpan = getWorkflowSpan(instance.instanceId);
    const ownsWorkflowSpan = !existingWorkflowSpan;
    const workflowSpan =
      existingWorkflowSpan ??
      startSpan("workflow.execute", {
        "workflow.instance_id": instance.instanceId,
        "workflow.id": workflow.id,
        "workflow.definition.name": workflow.name,
      });

    if (ownsWorkflowSpan) {
      registerWorkflowSpan(
        instance.instanceId,
        workflowSpan.span,
        workflowSpan.context,
      );
      const traceId = otelTraceId(workflowSpan.span);
      if (!instance.traceId && traceId) {
        instance.traceId = traceId;
      }
    }

    try {
      await otelContext.with(workflowSpan.context, async () => {
        if (this.ensureLease) {
          const ok = await this.ensureLease(instance.instanceId);
          if (!ok) {
            throw new Error("Instance lease lost");
          }
        }

        // 状态转换
        if (instance.status === "pending" || instance.status === "rollback") {
          instance.status = StateMachine.transition(instance.status, "start");
        }

        if (instance.status !== "running") {
          instance.status = "running";
        }

        await this.instanceManager.updateInstance(instance);

        while (instance.currentNodes.length > 0) {
          if (this.ensureLease) {
            const ok = await this.ensureLease(instance.instanceId);
            if (!ok) {
              throw new Error("Instance lease lost");
            }
          }

          const nodeBatch = [...instance.currentNodes];
          const nextNodes: string[] = [];

          // 执行当前批次节点，收集下一批节点后统一推进。
          for (const nodeId of nodeBatch) {
            const node = workflow.nodes[nodeId];
            if (!node) continue;

            await this.executeNode(instance, workflow, node, {
              autoAdvance: false,
              nextNodes,
            });
          }

          const dedupedNextNodes = Array.from(new Set(nextNodes));
          instance.currentNodes = dedupedNextNodes;

          if (dedupedNextNodes.length === 0) {
            instance.status = StateMachine.transition(
              instance.status,
              "complete",
            );
            await this.instanceManager.updateInstance(instance);
            Logger.log(
              instance.instanceId,
              nodeBatch[nodeBatch.length - 1] ?? "system",
              "Workflow completed",
            );
            void hookManager.emit(
              createHookPayload({
                event: "workflow.completed",
                workflowId: instance.workflowId,
                instanceId: instance.instanceId,
                status: instance.status,
                traceId: instance.traceId,
                data: {
                  lastNodeId: nodeBatch[nodeBatch.length - 1],
                },
              }),
            );

            if (this.onWorkflowComplete) {
              await this.onWorkflowComplete(instance);
            }
            break;
          }

          await this.instanceManager.updateInstance(instance);
        }
      });
      if (ownsWorkflowSpan) {
        workflowSpan.span.setAttributes({
          "workflow.status": instance.status,
        });
        workflowSpan.span.setStatus({ code: SpanStatusCode.OK });
      }
    } catch (error) {
      if (ownsWorkflowSpan) {
        recordSpanError(workflowSpan.span, error);
      }
      throw error;
    } finally {
      if (ownsWorkflowSpan) {
        unregisterWorkflowSpan(instance.instanceId);
        workflowSpan.span.end();
      }
    }
  }

  /**
   * 执行单个节点
   */
  private async executeNode(
    instance: WorkflowInstance,
    workflow: WorkflowDefinition,
    node: TaskNode,
    options: {
      autoAdvance?: boolean;
      nextNodes?: string[];
    } = {},
  ): Promise<void> {
    const autoAdvance = options.autoAdvance ?? true;
    const batchNextNodes = options.nextNodes;
    const parentSpan = getWorkflowSpan(instance.instanceId);
    const nodeSpan = startSpan(
      "workflow.node.execute",
      {
        "workflow.instance_id": instance.instanceId,
        "workflow.id": workflow.id,
        "workflow.node.id": node.id,
        "workflow.node.type": node.type,
      },
      parentSpan?.context,
    );
    let nodeSpanEnded = false;
    const endNodeSpan = (status: "success" | "failed", error?: Error): void => {
      if (nodeSpanEnded) return;
      nodeSpanEnded = true;
      nodeSpan.span.setAttributes({
        "workflow.node.status": status,
      });
      if (error) {
        recordSpanError(nodeSpan.span, error);
      } else {
        nodeSpan.span.setStatus({ code: SpanStatusCode.OK });
      }
      nodeSpan.span.end();
    };

    if (this.ensureLease) {
      try {
        const ok = await this.ensureLease(instance.instanceId);
        if (!ok) {
          throw new Error("Instance lease lost");
        }
      } catch (error) {
        endNodeSpan("failed", error instanceof Error ? error : undefined);
        throw error;
      }
    }

    return otelContext.with(
      nodeSpan.context,
      () =>
        new Promise<void>((resolve, reject) => {
          const storage = this.instanceManager.storageProvider;

          Logger.debug(
            instance.instanceId,
            node.id,
            `Processing node ${node.id}, type=${node.type}`,
          );

          void hookManager.emit(
            createHookPayload({
              event: "node.started",
              workflowId: instance.workflowId,
              instanceId: instance.instanceId,
              nodeId: node.id,
              status: "running",
              traceId: instance.traceId,
              data: { nodeType: node.type },
            }),
          );

          if (node.type === "wait" && node.timeout) {
            void hookManager.emit(
              createHookPayload({
                event: "node.waiting",
                workflowId: instance.workflowId,
                instanceId: instance.instanceId,
                nodeId: node.id,
                status: "waiting",
                traceId: instance.traceId,
                data: { timeoutMs: node.timeout },
              }),
            );
          }

          const onComplete = async (nextNodes: string[]) => {
            endNodeSpan("success");
            void hookManager.emit(
              createHookPayload({
                event: "node.completed",
                workflowId: instance.workflowId,
                instanceId: instance.instanceId,
                nodeId: node.id,
                status: "completed",
                traceId: instance.traceId,
                data: {
                  output: instance.state?.nodes?.[node.id]?.output,
                  nextNodes,
                },
              }),
            );

            if (!autoAdvance) {
              batchNextNodes?.push(...nextNodes);
              resolve();
              return;
            }

            instance.currentNodes = nextNodes;

            if (nextNodes.length === 0) {
              // 工作流完成
              instance.status = StateMachine.transition(
                instance.status,
                "complete",
              );
              await this.instanceManager.updateInstance(instance);
              Logger.log(instance.instanceId, node.id, "Workflow completed");
              void hookManager.emit(
                createHookPayload({
                  event: "workflow.completed",
                  workflowId: instance.workflowId,
                  instanceId: instance.instanceId,
                  status: instance.status,
                  traceId: instance.traceId,
                  data: { lastNodeId: node.id },
                }),
              );

              // 处理 Continue-As-New：若该实例注册了续期，则启动新实例
              if (this.onWorkflowComplete) {
                await this.onWorkflowComplete(instance);
              }

              resolve();
            } else {
              // 继续执行后续节点
              Logger.debug(
                instance.instanceId,
                node.id,
                `Moving to next nodes: ${nextNodes.join(", ")}`,
              );
              try {
                await this.execute(instance, workflow);
                resolve();
              } catch (error) {
                reject(error);
              }
            }
          };

          const onError = async (err: Error) => {
            endNodeSpan("failed", err);
            void hookManager.emit(
              createHookPayload({
                event: "node.failed",
                workflowId: instance.workflowId,
                instanceId: instance.instanceId,
                nodeId: node.id,
                status: "failed",
                traceId: instance.traceId,
                data: { error: err.message, stack: err.stack },
              }),
            );

            const retryPolicy: RetryPolicy = node.retryPolicy ?? {};
            const currentRetryCount = instance.retries?.[node.id] ?? 0;

            if (retryPolicy && Object.keys(retryPolicy).length > 0) {
              const canRetry =
                shouldRetry(currentRetryCount, retryPolicy) &&
                isRetryableError(err, retryPolicy);

              if (canRetry) {
                const delay = calculateRetryDelay(
                  currentRetryCount,
                  retryPolicy,
                );
                Logger.log(
                  instance.instanceId,
                  node.id,
                  `Retrying with policy (attempt ${currentRetryCount + 1}), delay: ${delay}ms`,
                  { error: err.message },
                );

                instance.retries = instance.retries ?? {};
                instance.retries[node.id] = currentRetryCount + 1;

                void hookManager.emit(
                  createHookPayload({
                    event: "node.retry",
                    workflowId: instance.workflowId,
                    instanceId: instance.instanceId,
                    nodeId: node.id,
                    status: "retry",
                    traceId: instance.traceId,
                    data: {
                      attempt: currentRetryCount + 1,
                      delay,
                      error: err.message,
                    },
                  }),
                );

                await this.instanceManager.updateInstance(instance);

                await new Promise<void>((resolveRetry) => {
                  setTimeout(async () => {
                    try {
                      await this.executeNode(instance, workflow, node);
                      resolveRetry();
                    } catch (retryError) {
                      reject(retryError);
                    }
                  }, delay);
                });
                return;
              }
            }

            // 处理失败路径
            if (node.failureNext?.length) {
              Logger.log(
                instance.instanceId,
                node.id,
                "Node failed, proceeding along failureNext",
                { error: err.message },
              );
              await onComplete(node.failureNext);
              return;
            }

            // 处理回滚重试
            if (node.rollbackTo) {
              const maxRetries =
                typeof node.maxRetries === "number" ? node.maxRetries : 2;
              Logger.log(
                instance.instanceId,
                node.id,
                `Node failed, rolling back to ${node.rollbackTo}`,
                { error: err.message },
              );

              try {
                const success = await this.rollback(
                  instance,
                  workflow,
                  node.rollbackTo,
                  maxRetries,
                );
                if (!success) {
                  instance.status = StateMachine.transition(
                    instance.status,
                    "fail",
                  );
                  await this.instanceManager.updateInstance(instance);
                  void hookManager.emit(
                    createHookPayload({
                      event: "workflow.failed",
                      workflowId: instance.workflowId,
                      instanceId: instance.instanceId,
                      status: instance.status,
                      traceId: instance.traceId,
                      data: { error: err.message },
                    }),
                  );
                  Logger.error(
                    instance.instanceId,
                    node.id,
                    "Execution failed after max retries",
                    err.stack,
                  );
                  reject(err);
                } else {
                  resolve();
                }
              } catch (rollbackError) {
                reject(rollbackError);
              }
              return;
            }

            // 默认失败处理
            instance.status = StateMachine.transition(instance.status, "fail");
            await this.instanceManager.updateInstance(instance);
            void hookManager.emit(
              createHookPayload({
                event: "workflow.failed",
                workflowId: instance.workflowId,
                instanceId: instance.instanceId,
                status: instance.status,
                traceId: instance.traceId,
                data: { error: err.message },
              }),
            );
            Logger.error(
              instance.instanceId,
              node.id,
              "Execution failed",
              err.stack,
            );
            reject(err);
          };

          // 处理事件节点
          if (
            (node.type === "event" && node.onEvent && this.eventCoordinator) ||
            (node.type === "approval" && this.eventCoordinator)
          ) {
            const startTime = Date.now();
            const logEntry: ExecutionLog = {
              nodeId: node.id,
              timestamp: new Date(),
              status: "started",
            };
            instance.history.push(logEntry);

            if (storage) {
              storage
                .updateNodeMetrics(instance.instanceId, node.id, {
                  nodeId: node.id,
                  nodeType: node.type,
                  startTime,
                  status: "running",
                  retryCount: instance.retries?.[node.id] || 0,
                  retryTimestamps: [],
                })
                .catch((error: any) => {
                  Logger.error(
                    instance.instanceId,
                    node.id,
                    "Failed to record event start metrics",
                    error?.stack,
                  );
                });
            }

            const approvalConfig = (node.config ?? {}) as Record<
              string,
              unknown
            >;
            const eventType: string =
              node.type === "approval"
                ? (approvalConfig.eventType as string) ||
                  `workflow.approval.${instance.instanceId}.${node.id}`
                : (node.onEvent ?? `event.${node.id}`);
            const condition =
              typeof node?.config?.condition === "string"
                ? (node.config.condition as string)
                : undefined;

            this.eventCoordinator
              .waitForEvent(instance.instanceId, node.id, eventType, {
                condition,
                requireInstanceIdMatch:
                  node.type === "approval"
                    ? approvalConfig.requireInstanceIdMatch !== false
                    : true,
                timeoutMs:
                  typeof approvalConfig.timeoutMs === "number"
                    ? approvalConfig.timeoutMs
                    : typeof node.timeout === "number"
                      ? node.timeout
                      : undefined,
                onTimeout: () => {
                  void (async () => {
                    const endTime = Date.now();
                    const duration = endTime - startTime;
                    logEntry.status = "failed";
                    logEntry.error = `Event ${eventType} timeout`;
                    logEntry.duration = duration;

                    recordNodeExecution(
                      instance.workflowId,
                      node.id,
                      node.type,
                      "failed",
                      duration / 1000,
                    );

                    if (storage) {
                      await storage.updateNodeMetrics(
                        instance.instanceId,
                        node.id,
                        {
                          nodeId: node.id,
                          nodeType: node.type,
                          startTime,
                          endTime,
                          duration,
                          status: "failed",
                          retryCount: instance.retries?.[node.id] || 0,
                          error: {
                            message: logEntry.error,
                            timestamp: Date.now(),
                          },
                        },
                      );
                    }

                    await onError(new Error(logEntry.error));
                  })().catch((err) => {
                    void onError(
                      err instanceof Error ? err : new Error(String(err)),
                    );
                  });
                },
                onEvent: (payload: any) => {
                  void (async () => {
                    const endTime = Date.now();
                    const duration = endTime - startTime;

                    logEntry.status = "success";
                    logEntry.data = payload;
                    logEntry.duration = duration;

                    instance.context = {
                      ...instance.context,
                      eventData: payload,
                    };
                    if (!instance.state) {
                      instance.state = { nodes: {} };
                    }
                    if (!instance.state.nodes) {
                      instance.state.nodes = {};
                    }
                    instance.state.nodes[node.id] = { output: payload };

                    recordNodeExecution(
                      instance.workflowId,
                      node.id,
                      node.type,
                      "success",
                      duration / 1000,
                    );

                    if (storage) {
                      await storage.updateNodeMetrics(
                        instance.instanceId,
                        node.id,
                        {
                          nodeId: node.id,
                          nodeType: node.type,
                          startTime,
                          endTime,
                          duration,
                          status: "completed",
                          retryCount: instance.retries?.[node.id] || 0,
                        },
                      );
                    }

                    await this.instanceManager.updateInstance(instance);
                    if (node.type === "approval") {
                      const approved = payload?.approved === true;
                      const nextNode = approved
                        ? (approvalConfig.approvedTarget as string) ||
                          node.next?.[0]
                        : (approvalConfig.rejectedTarget as string) ||
                          node.failureNext?.[0];
                      await onComplete(nextNode ? [nextNode] : []);
                    } else {
                      await onComplete(node.next || []);
                    }
                  })().catch((err) => {
                    void onError(
                      err instanceof Error ? err : new Error(String(err)),
                    );
                  });
                },
              })
              .catch((err) => {
                void onError(
                  err instanceof Error ? err : new Error(String(err)),
                );
              });
          } else if (node.type === "subworkflow") {
            if (!this.startWorkflow) {
              void onError(
                new Error("Subworkflow execution is not configured"),
              );
              return;
            }

            const subworkflowExecutor = new SubworkflowExecutor(
              (workflowId, context, parentInstanceId) =>
                this.startWorkflow!(workflowId, context, { parentInstanceId }),
              (subInstanceId) =>
                this.instanceManager.getInstance(subInstanceId),
            );

            void (async () => {
              try {
                await subworkflowExecutor.execute(node, instance);
                await this.instanceManager.updateInstance(instance);
                await onComplete(node.next || []);
              } catch (error) {
                await onError(
                  error instanceof Error ? error : new Error(String(error)),
                );
              }
            })();
          } else if (node.type === "loop") {
            const loopConfig = node.config as unknown as LoopNodeConfig;

            // Callback to execute the body node for each iteration
            const executeBody = async (
              itemContext: Record<string, any>,
              _index: number,
            ) => {
              const originalContext = { ...instance.context };
              instance.context = { ...instance.context, ...itemContext };

              try {
                const bodyNodeId = LoopNodeExecutor.getBodyNode(loopConfig);
                const bodyNode = workflow.nodes[bodyNodeId];
                if (!bodyNode) {
                  throw new Error(`Loop body node ${bodyNodeId} not found`);
                }

                // "subworkflow" bodies must go through SubworkflowExecutor,
                // same as executeNode's top-level subworkflow branch above —
                // TaskExecutor/nodeDispatch has no case for "subworkflow" on
                // its own and would throw "Unsupported task type".
                if (bodyNode.type === "subworkflow") {
                  if (!this.startWorkflow) {
                    throw new Error("Subworkflow execution is not configured");
                  }
                  const subworkflowExecutor = new SubworkflowExecutor(
                    (workflowId, context, parentInstanceId) =>
                      this.startWorkflow!(workflowId, context, {
                        parentInstanceId,
                      }),
                    (subInstanceId) =>
                      this.instanceManager.getInstance(subInstanceId),
                  );
                  return await subworkflowExecutor.execute(bodyNode, instance);
                }

                // Execute body node locally via TaskExecutor
                return await new Promise((resolveBody, rejectBody) => {
                  TaskExecutor.execute(
                    bodyNode,
                    instance,
                    (_next) => {
                      resolveBody(instance.state?.nodes?.[bodyNodeId]?.output);
                    },
                    rejectBody,
                    storage,
                  );
                });
              } finally {
                instance.context = originalContext;
              }
            };

            LoopNodeExecutor.execute(loopConfig, instance, executeBody)
              .then(async (result) => {
                if (!instance.state) instance.state = { nodes: {} };
                if (!instance.state.nodes) instance.state.nodes = {};
                instance.state.nodes[node.id] = { output: result };

                await this.instanceManager.updateInstance(instance);
                await onComplete(node.next || []);
              })
              .catch(onError);
          } else {
            // 处理普通任务节点
            TaskExecutor.execute(node, instance, onComplete, onError, storage);
          }
        }),
    );
  }

  /**
   * 回滚到指定节点
   */
  async rollback(
    instance: WorkflowInstance,
    workflow: WorkflowDefinition,
    toNodeId: string,
    maxRetries = 3,
  ): Promise<boolean> {
    if (!workflow.nodes[toNodeId]) {
      throw new Error(`Target node ${toNodeId} not found`);
    }

    // 初始化重试记录
    if (!instance.retries) {
      instance.retries = {};
    }

    const rollbackFromNode = instance.currentNodes[0];
    if (!instance.retries[rollbackFromNode]) {
      instance.retries[rollbackFromNode] = 1;
    } else {
      instance.retries[rollbackFromNode]++;
    }

    void hookManager.emit(
      createHookPayload({
        event: "node.retry",
        workflowId: instance.workflowId,
        instanceId: instance.instanceId,
        nodeId: rollbackFromNode,
        status: "retrying",
        traceId: instance.traceId,
        data: {
          retryCount: instance.retries[rollbackFromNode],
          maxRetries,
          rollbackTo: toNodeId,
        },
      }),
    );

    // 检查是否超过最大重试次数
    if (instance.retries[rollbackFromNode] > maxRetries) {
      Logger.log(
        instance.instanceId,
        rollbackFromNode,
        `Max retries (${maxRetries}) reached, stopping rollback`,
      );
      instance.status = "failed";
      instance.maxRetriesReached = true;
      await this.instanceManager.updateInstance(instance);
      void hookManager.emit(
        createHookPayload({
          event: "workflow.failed",
          workflowId: instance.workflowId,
          instanceId: instance.instanceId,
          status: instance.status,
          traceId: instance.traceId,
          data: {
            error: `Max retries (${maxRetries}) reached for node ${rollbackFromNode}`,
          },
        }),
      );
      return false;
    }

    // 执行回滚
    instance.currentNodes = [toNodeId];
    instance.status = StateMachine.transition(instance.status, "rollback");

    void hookManager.emit(
      createHookPayload({
        event: "workflow.rollback",
        workflowId: instance.workflowId,
        instanceId: instance.instanceId,
        status: instance.status,
        traceId: instance.traceId,
        data: {
          fromNode: rollbackFromNode,
          toNode: toNodeId,
          retryCount: instance.retries[rollbackFromNode],
          maxRetries,
        },
      }),
    );

    Logger.log(
      instance.instanceId,
      toNodeId,
      `Rolled back to node ${toNodeId} (retry ${instance.retries[rollbackFromNode]}/${maxRetries})`,
    );

    await this.instanceManager.updateInstance(instance);
    await this.execute(instance, workflow);

    return true;
  }
}
