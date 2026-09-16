/**
 * Public library entry point.
 *
 * Keep this module free of startup side effects so consumers can safely import
 * types and helpers without starting the demo or REST API server.
 */

import type { Server } from "node:http";
import type { ApiServerConfig } from "./api/server";
import type { StorageProvider } from "./storage/StorageProvider";
import type { WorkflowEngine } from "./engine/WorkflowEngine";

export type { ApiServerConfig };

/**
 * Mountable Express router for the workflow API — for embedding into a host
 * app's own Express instance instead of running the standalone server from
 * `startApiServer`. Loaded lazily so importing this module never pulls in
 * `express` as a side effect.
 */
export async function createWorkflowRouter(
  ...args: Parameters<typeof import("./api/router").createWorkflowRouter>
): Promise<ReturnType<typeof import("./api/router").createWorkflowRouter>> {
  const router = await import("./api/router");
  return router.createWorkflowRouter(...args);
}
export type { WorkflowRouterBundle, WorkflowRouterOptions } from "./api/router";

/** Load the REST server only when it is explicitly requested. */
export async function startApiServer(
  engine: WorkflowEngine,
  storage: StorageProvider | null = null,
  config: ApiServerConfig = {},
): Promise<Server> {
  const server = await import("./api/server");
  return server.startApiServer(engine, storage, config);
}

export const startServer = startApiServer;
export {
  type AppContext,
  type BootstrapOptions,
  bootstrap,
  loadEnv,
} from "./bootstrap";
export {
  type AppContainer,
  createContainer,
  destroyContainer,
  getContainer,
  setContainer,
} from "./container";
export { DSLParseError, parseDSL } from "./dsl/DSLParser";
export type {
  DSLConditionalBranch,
  DSLNode,
  DSLRetryPolicy,
  DSLTrigger,
  DSLValue,
  DSLWorkflow,
} from "./dsl/WorkflowDSL";
export {
  type CreateEngineOptions,
  createEngine,
  createEngineV2,
} from "./engine/createEngine";
export {
  evaluateCondition,
  getNestedValue,
  interpolateExpressions,
  interpolateObject,
  resolveConditionalNext,
  resolveNodeOutput,
  validateExpression,
} from "./engine/ExpressionEvaluator";
export type { CustomFunctionMeta } from "./engine/functions/customFunctions";
// P2: 表达式引擎 v2
export {
  listCustomFunctions,
  registerCustomFunction,
  unregisterCustomFunction,
} from "./engine/functions/customFunctions";
// 导出核心模块供外部使用
export {
  type WaitForCompletionOptions,
  WorkflowEngine,
} from "./engine/WorkflowEngine";
export {
  ConcurrencyConflictError,
  InstanceNotFoundError,
  LockAcquisitionError,
  WorkflowNotFoundError,
} from "./engine/errors";
export { eventBus } from "./event/EventBus";
export {
  createHookPayload,
  emitHook,
  hookManager,
  offHook,
  onHook,
  setHookDispatcher,
} from "./event/HookManager";
export * from "./model/Instance";
export * from "./model/Workflow";
export * from "./notification/index";
// 节点执行器配置/输出类型（http/sql/queue/condition/router/loop），
// 供外部项目在构建 TaskNode.config 时获得类型提示，而不必去翻源码。
export type {
  ConditionNodeConfig,
  ConditionNodeOutput,
} from "./engine/executors/ConditionNodeExecutor";
export type {
  HttpNodeConfig,
  HttpNodeOutput,
} from "./engine/executors/HttpNodeExecutor";
export {
  type LoopNodeConfig,
  type LoopNodeOutput,
} from "./engine/executors/LoopNodeExecutor";
export {
  getQueueProvider,
  type QueueNodeConfig,
  type QueueNodeOutput,
  type QueueProvider,
  registerQueueProvider,
  unregisterQueueProvider,
} from "./engine/executors/QueueNodeExecutor";
export {
  type RouterNodeConfig,
  type RouterNodeOutput,
  type RouterRoute,
} from "./engine/executors/RouterNodeExecutor";
export {
  getSqlConnectionPool,
  registerSqlConnectionPool,
  type SqlConnectionPool,
  type SqlNodeConfig,
  type SqlNodeOutput,
  unregisterSqlConnectionPool,
} from "./engine/executors/SqlNodeExecutor";
export type {
  TemplateInstanceRequest,
  TemplateParameter,
  TemplateParameterType,
  WorkflowTemplate,
} from "./templates/index";
export {
  builtinTemplates,
  registerBuiltinTemplates,
  TemplateRegistry,
  templateRegistry,
} from "./templates/index";
export {
  type MockNodeHandler,
  type Mutation,
  type MutationReport,
  type MutationResult,
  MutationTester,
  type MutationType,
  type TestWorkflowInput,
  type TestWorkflowOptions,
  type TestWorkflowResult,
  type TestWorkflowTemplateInput,
  testWorkflow,
  type WorkflowFailureSnapshot,
} from "./testing/index";
export { Logger, type LogLevel } from "./utils/Logger";
export {
  AwsSecretsManagerProvider,
  EnvSecretProvider,
  SecretManager,
  type SecretProvider,
  UnsupportedSecretProviderError,
  VaultSecretProvider,
} from "./utils/SecretManager";
export {
  disposeSecretManager,
  getSecretManager,
  resolveSecrets,
  setSecretManager,
} from "./utils/secrets";
export {
  StickyExecutionManager,
  stickyExecutionManager,
  type StickyOptions,
  type StickyWorker,
} from "./engine/StickyExecutionManager";
export {
  type Task,
  type TaskHandler,
  TaskQueueManager,
  taskQueueManager,
  type TaskQueueOptions,
  type TaskQueueType,
} from "./engine/TaskQueueManager";
export {
  LocalFileStorage,
  MemoryStorage,
  StorageType,
  createStorage,
  getStorageType,
} from "./storage/index";
export type { LocalFileStorageOptions, StorageProvider } from "./storage/index";
