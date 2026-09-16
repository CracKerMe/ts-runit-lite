// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import { DeadLetterQueue } from "../dlq/index";
import { parseDSL } from "../dsl/DSLParser";
import { WorkflowEngine } from "../engine/WorkflowEngine";
import { EventBus } from "../event/EventBus";
import type { WorkflowInstance } from "../model/Instance";
import type { TaskNode, WorkflowDefinition } from "../model/Workflow";
import { CronScheduler } from "../scheduler/CronScheduler";
import { MemoryStorage } from "../storage/MemoryStorage";
import type { TemplateInstanceRequest } from "../templates/index";
import {
  registerBuiltinTemplates,
  templateRegistry as sharedTemplateRegistry,
  type TemplateRegistry,
} from "../templates/index";

export type MockNodeHandler = (
  instance: WorkflowInstance,
  node: TaskNode,
) => Promise<unknown> | unknown;

export interface TestWorkflowOptions {
  context?: Record<string, unknown>;
  mockNodes?: Record<string, MockNodeHandler | unknown>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  templateRegistry?: TemplateRegistry;
}

export type TestWorkflowTemplateInput = Omit<
  TemplateInstanceRequest,
  "name"
> & {
  name?: string;
};

export type TestWorkflowInput =
  | WorkflowDefinition
  | string
  | {
      dsl: string;
    }
  | {
      template: TestWorkflowTemplateInput;
    };

export interface WorkflowFailureSnapshot {
  instanceId: string;
  workflowId: string;
  status: WorkflowInstance["status"];
  currentNodes: string[];
  history: Array<{
    nodeId: string;
    status: string;
    error?: string;
    timestamp: string;
  }>;
  outputs: Record<string, unknown>;
}

export interface TestWorkflowResult {
  instanceId: string;
  instance: WorkflowInstance;
  outputs: Record<string, unknown>;
  history: WorkflowInstance["history"];
  failureSnapshot?: WorkflowFailureSnapshot;
  storage: MemoryStorage;
  engine: WorkflowEngine;
  getOutput: <T = unknown>(nodeId: string) => T | undefined;
  expectStatus: (status: WorkflowInstance["status"]) => TestWorkflowResult;
  expectCompleted: () => TestWorkflowResult;
  expectOutput: <T = unknown>(
    nodeId: string,
    expected: T,
  ) => TestWorkflowResult;
  formatFailureSnapshot: () => string;
  cleanup: () => Promise<void>;
}

function isTerminalStatus(status: WorkflowInstance["status"]): boolean {
  return ["completed", "failed", "cancelled"].includes(status);
}

function applyMocks(
  workflow: WorkflowDefinition,
  mockNodes: Record<string, MockNodeHandler | unknown> | undefined,
): WorkflowDefinition {
  if (!mockNodes || Object.keys(mockNodes).length === 0) {
    return workflow;
  }

  const nodes = Object.fromEntries(
    Object.entries(workflow.nodes).map(([nodeId, node]) => {
      const mock = mockNodes[nodeId];
      if (mock === undefined) {
        return [nodeId, node];
      }

      const action: TaskNode["action"] = async (
        instance?: WorkflowInstance,
      ) => {
        if (typeof mock === "function") {
          return (mock as MockNodeHandler)(instance as WorkflowInstance, node);
        }
        return mock;
      };

      return [
        nodeId,
        {
          ...node,
          type: "action" as const,
          action,
          config: undefined,
        },
      ];
    }),
  ) as Record<string, TaskNode>;

  return {
    ...workflow,
    nodes,
  };
}

function extractOutputs(instance: WorkflowInstance): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(instance.state?.nodes ?? {}).map(([nodeId, nodeState]) => [
      nodeId,
      nodeState.output,
    ]),
  );
}

function normalizeForAssertion(value: unknown): string {
  return JSON.stringify(value);
}

function createFailureSnapshot(
  instance: WorkflowInstance,
): WorkflowFailureSnapshot | undefined {
  if (instance.status === "completed") {
    return undefined;
  }

  return {
    instanceId: instance.instanceId,
    workflowId: instance.workflowId,
    status: instance.status,
    currentNodes: [...instance.currentNodes],
    history: instance.history.map((entry) => ({
      nodeId: entry.nodeId,
      status: entry.status,
      error: entry.error,
      timestamp:
        entry.timestamp instanceof Date
          ? entry.timestamp.toISOString()
          : new Date(entry.timestamp).toISOString(),
    })),
    outputs: extractOutputs(instance),
  };
}

function formatFailureSnapshot(snapshot?: WorkflowFailureSnapshot): string {
  if (!snapshot) {
    return "workflow completed successfully";
  }

  return JSON.stringify(snapshot, null, 2);
}

export async function testWorkflow(
  workflowInput: TestWorkflowInput,
  options: TestWorkflowOptions = {},
): Promise<TestWorkflowResult> {
  const storage = new MemoryStorage();
  await storage.connect();
  const eventBus = new EventBus();
  const scheduler = new CronScheduler(storage);
  const dlq = new DeadLetterQueue(storage);
  const engine = new WorkflowEngine(storage, eventBus, scheduler, dlq, {
    instanceTtlHours: 24,
    cleanupIntervalMs: 60_000,
    maxInstances: 100,
  });
  await engine.initialize({ resumeRunningInstances: false });

  const workflow = resolveWorkflowDefinition(workflowInput, options);
  const mockedWorkflow = applyMocks(workflow, options.mockNodes);
  await engine.register(mockedWorkflow, { persist: false });

  const instanceId = await engine.start(
    mockedWorkflow.id,
    (options.context as Record<string, any> | undefined) ?? {},
  );

  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollIntervalMs = options.pollIntervalMs ?? 20;
  const deadline = Date.now() + timeoutMs;

  let instance = engine.getInstance(instanceId);
  while (
    instance &&
    !isTerminalStatus(instance.status) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    instance = engine.getInstance(instanceId);
  }

  if (!instance) {
    await cleanupResources(engine, scheduler, eventBus, storage);
    throw new Error(`Workflow instance not found: ${instanceId}`);
  }

  if (!isTerminalStatus(instance.status)) {
    const snapshot = createFailureSnapshot(instance);
    const report = formatFailureSnapshot(snapshot);
    await cleanupResources(engine, scheduler, eventBus, storage);
    throw new Error(`Workflow test timed out after ${timeoutMs}ms\n${report}`);
  }

  const failureSnapshot = createFailureSnapshot(instance);

  const cleanup = async (): Promise<void> => {
    await cleanupResources(engine, scheduler, eventBus, storage);
  };

  const result: TestWorkflowResult = {
    instanceId,
    instance,
    outputs: extractOutputs(instance),
    history: instance.history,
    failureSnapshot,
    storage,
    engine,
    getOutput: <T = unknown>(nodeId: string): T | undefined =>
      result.outputs[nodeId] as T | undefined,
    expectStatus: (status: WorkflowInstance["status"]): TestWorkflowResult => {
      if (result.instance.status !== status) {
        throw new Error(
          `Expected workflow status ${status}, received ${result.instance.status}\n${result.formatFailureSnapshot()}`,
        );
      }
      return result;
    },
    expectCompleted: (): TestWorkflowResult => result.expectStatus("completed"),
    expectOutput: <T = unknown>(
      nodeId: string,
      expected: T,
    ): TestWorkflowResult => {
      const actual = result.getOutput<T>(nodeId);
      if (normalizeForAssertion(actual) !== normalizeForAssertion(expected)) {
        throw new Error(
          `Unexpected output for node ${nodeId}\nExpected: ${normalizeForAssertion(expected)}\nActual: ${normalizeForAssertion(actual)}\n${result.formatFailureSnapshot()}`,
        );
      }
      return result;
    },
    formatFailureSnapshot: (): string =>
      formatFailureSnapshot(result.failureSnapshot),
    cleanup,
  };

  return result;
}

function resolveWorkflowDefinition(
  workflowInput: TestWorkflowInput,
  options: TestWorkflowOptions,
): WorkflowDefinition {
  if (typeof workflowInput === "string") {
    return parseDSL(workflowInput);
  }

  if ("dsl" in workflowInput) {
    return parseDSL(workflowInput.dsl);
  }

  if ("template" in workflowInput) {
    const registry = options.templateRegistry ?? sharedTemplateRegistry;
    registerBuiltinTemplates(registry);

    return registry.instantiate({
      ...workflowInput.template,
      name: workflowInput.template.name ?? workflowInput.template.templateId,
    });
  }

  return workflowInput;
}

async function cleanupResources(
  engine: WorkflowEngine,
  scheduler: CronScheduler,
  eventBus: EventBus,
  storage: MemoryStorage,
): Promise<void> {
  engine.destroy();
  scheduler.stopAll();
  await eventBus.close();
  await storage.close();
}
