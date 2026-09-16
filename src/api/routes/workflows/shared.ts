// oxlint-disable no-explicit-any -- shared workflow route helpers use dynamic types
import { SchemaValidator } from "../../../engine/SchemaValidator";
import type { TaskType, WorkflowDefinition } from "../../../model/Workflow";
import { getSupportedEdgeKinds } from "../../../model/WorkflowGraph";
import {
  getNodeConfigJsonSchema,
  getWorkflowDefinitionJsonSchema,
} from "../../../model/WorkflowSchema";
import type {
  StorageProvider,
  StoredWorkflow,
  StoredWorkflowVersion,
} from "../../../storage/StorageProvider";
import {
  registerBuiltinTemplates,
  templateRegistry,
} from "../../../templates/index";
import type { requireRequestEngine } from "../../utils/requestContext";

export type WorkflowWithListInstances = {
  listInstancesByWorkflow?: (workflowId: string) => Promise<unknown[]>;
};

export type WorkflowRegistrationEngine = ReturnType<
  typeof requireRequestEngine
> & {
  register?: (
    workflow: WorkflowDefinition,
    options?: { version?: string; setActive?: boolean },
  ) => Promise<void>;
  setReleasePolicy?: (workflowId: string, policy: unknown) => void;
};

export type WorkflowVersioningEngine = ReturnType<
  typeof requireRequestEngine
> & {
  listWorkflowVersions?: (workflowId: string) => string[];
  getActiveWorkflowVersion?: (workflowId: string) => string | undefined;
  getLockedWorkflowVersion?: (workflowId: string) => string | undefined;
  getReleasePolicy?: (workflowId: string) => unknown;
  setActiveWorkflowVersion?: (workflowId: string, version: string) => void;
  setLockedWorkflowVersion?: (workflowId: string, version: string) => void;
  clearLockedWorkflowVersion?: (workflowId: string) => void;
  setReleasePolicy?: (workflowId: string, policy: unknown) => void;
  startCanaryRelease?: (
    workflowId: string,
    version: number,
    percent: number,
    rules?: {
      autoPromote?: boolean;
      minInstances?: number;
      maxErrorRate?: number;
      evaluationWindowMs?: number;
    },
  ) => Promise<void>;
  promoteCanary?: (workflowId: string) => Promise<void>;
  getCanaryStatus?: (workflowId: string) => Promise<unknown>;
};

export type WorkflowDryRunEngine = WorkflowRegistrationEngine & {
  dryRun?: (
    workflowId: string,
    context?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
};

export function toWorkflowDefinition(definition: unknown): WorkflowDefinition {
  return definition as WorkflowDefinition;
}

// Initialize schema validator with default and extended node types
export const schemaValidator = new SchemaValidator();
schemaValidator.registerNodeType("http");
schemaValidator.registerNodeType("sql");
schemaValidator.registerNodeType("queue");
schemaValidator.registerNodeType("condition");
schemaValidator.registerNodeType("router");
schemaValidator.registerNodeType("loop");
registerBuiltinTemplates(templateRegistry);
export { templateRegistry };

/**
 * JSON Schema for WorkflowDefinition, generated from the Zod schemas in
 * src/model/WorkflowSchema.ts so it stays in sync with the TS model instead
 * of being hand-maintained (see GET /workflows/schema).
 */
export const workflowSchema = {
  $id: "https://ts-workflow-engine.local/workflow.schema.json",
  ...getWorkflowDefinitionJsonSchema(),
};

interface NodeTypeCatalogEntry {
  type: TaskType;
  label: string;
  category: "core" | "io" | "control";
  description: string;
  example?: Record<string, unknown>;
}

// One entry per TaskType (see src/model/Workflow.ts) — the full node
// palette for a visual editor, not just the subset that happened to have a
// worked example. `configSchema`/`ports` are attached below from
// src/model/WorkflowSchema.ts and src/model/WorkflowGraph.ts so this stays
// in sync with the model instead of drifting.
const NODE_TYPE_CATALOG: NodeTypeCatalogEntry[] = [
  {
    type: "action",
    label: "Action",
    category: "core",
    description:
      "Runs custom application code, registered as a JS function at register() time. Not editable from a form — config has no declarative schema.",
  },
  {
    type: "wait",
    label: "Wait",
    category: "core",
    description:
      "Pauses the instance for `config.durationMs`, until `config.until` (an absolute ISO timestamp), or the legacy `timeout` field.",
    example: { durationMs: 5000 },
  },
  {
    type: "event",
    label: "Event",
    category: "core",
    description: "Waits for an external event named `onEvent` to resume.",
    example: { onEvent: "order.paid" },
  },
  {
    type: "rollback",
    label: "Rollback",
    category: "core",
    description: "Executes compensation logic for a prior node.",
  },
  {
    type: "subworkflow",
    label: "Subworkflow",
    category: "core",
    description:
      "Starts another registered workflow (subworkflowId) and optionally waits for completion.",
    example: { subworkflowId: "", waitForCompletion: true },
  },
  {
    type: "http",
    label: "HTTP Request",
    category: "io",
    description: "Calls an external HTTP endpoint.",
    example: { method: "GET", url: "https://api.example.com/resource" },
  },
  {
    type: "sql",
    label: "SQL Query",
    category: "io",
    description: "Executes a SQL query against a configured connection.",
    example: { connection: "default", query: "SELECT * FROM table" },
  },
  {
    type: "queue",
    label: "Queue",
    category: "io",
    description: "Publishes to or consumes from a message queue.",
    example: {
      operation: "publish",
      queue: "default",
      message: { text: "msg" },
    },
  },
  {
    type: "notification",
    label: "Notification",
    category: "io",
    description:
      "Sends a notification via Slack/Feishu/DingTalk/email/webhook.",
    example: { channel: "slack", target: "#alerts", template: "{{message}}" },
  },
  {
    type: "condition",
    label: "Condition",
    category: "control",
    description:
      "Branches to one of two nodes (trueBranch/falseBranch) based on a boolean expression.",
    example: { condition: "${context.flag === true}" },
  },
  {
    type: "router",
    label: "Router",
    category: "control",
    description:
      "Branches to one of several nodes based on ordered route conditions, falling back to defaultTarget.",
    example: {
      routes: [{ condition: "${context.type === 'vip'}", target: "" }],
    },
  },
  {
    type: "loop",
    label: "Loop",
    category: "control",
    description: "Iterates `collection`, executing a `body` node per item.",
    example: { collection: "${context.items}", itemVariable: "item" },
  },
  {
    type: "approval",
    label: "Approval",
    category: "control",
    description:
      "Waits for an approve/reject signal before branching (approvedTarget/rejectedTarget).",
    example: { prompt: "Approve this request?" },
  },
  {
    type: "join",
    label: "Join",
    category: "control",
    description:
      "Waits for multiple fan-out branches (waitFor) to complete before proceeding — mode 'all' (default) requires every branch, 'any' proceeds once one has.",
    example: { waitFor: ["branchA", "branchB"], mode: "all" },
  },
  {
    type: "transform",
    label: "Transform",
    category: "control",
    description:
      "Reshapes prior node outputs into a new output object; each `output` field is an expression, evaluated (not string-interpolated) so numbers/arrays/objects keep their type.",
    example: { output: { total: "${node1.output.price * node1.output.qty}" } },
  },
];

export const nodeTemplates = NODE_TYPE_CATALOG.map((entry) => ({
  ...entry,
  configSchema: getNodeConfigJsonSchema(entry.type),
  ports: getSupportedEdgeKinds(entry.type),
}));

export async function persistImportedWorkflow(
  storage: StorageProvider,
  workflowDefinition: WorkflowDefinition,
  options: {
    description?: string;
    tags?: string[];
    overwrite?: boolean;
  },
): Promise<StoredWorkflow | "conflict"> {
  const existing = await storage.loadWorkflowWithMetadata(
    workflowDefinition.id,
  );
  if (existing && !options.overwrite) {
    return "conflict";
  }

  const now = Date.now();
  const nextVersion = existing ? existing.version + 1 : 1;
  const storedWorkflow: StoredWorkflow = {
    id: workflowDefinition.id,
    name: workflowDefinition.name,
    description: options.description ?? existing?.description,
    definition: workflowDefinition,
    version: nextVersion,
    publishedVersion: existing?.publishedVersion ?? nextVersion,
    lockedVersion: existing?.lockedVersion,
    releasePolicy: existing?.releasePolicy,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    tags: options.tags ?? existing?.tags,
  };

  await storage.saveWorkflowWithMetadata(storedWorkflow);
  const workflowVersion: StoredWorkflowVersion = {
    id: storedWorkflow.id,
    name: storedWorkflow.name,
    description: storedWorkflow.description,
    definition: storedWorkflow.definition,
    version: storedWorkflow.version,
    createdAt: now,
    tags: storedWorkflow.tags,
    metadata: storedWorkflow.definition.metadata,
  };
  await storage.saveWorkflowVersion(workflowVersion);
  return storedWorkflow;
}

export const sanitizeValue = (value: any): any => {
  if (value === null || value === undefined) return value;
  if (typeof value === "function") return undefined;
  if (Array.isArray(value)) {
    const items = value
      .map((item) => sanitizeValue(item))
      .filter((item) => item !== undefined);
    return items;
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, item]) => {
      if (typeof item === "function") return;
      const sanitized = sanitizeValue(item);
      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    });
    return result;
  }
  return value;
};

export const stableStringify = (value: any): string => {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
};

export const getNodeSignature = (node: any): string => {
  return stableStringify(sanitizeValue(node));
};

export const collectTargets = (node: any): string[] => {
  const targets = new Set<string>();
  const addValue = (value: any) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        addValue(entry);
      });
      return;
    }
    if (typeof value === "string") {
      targets.add(value);
      return;
    }
    if (typeof value === "object" && value.target) {
      targets.add(value.target);
    }
  };

  addValue(node.next);
  addValue(node.failureNext);
  addValue(node.conditionalNext);
  addValue(node.defaultNext);
  addValue(node.rollbackTo);
  addValue(node.onSuccess);
  addValue(node.onFailure);

  if (node.config) {
    addValue(node.config.trueBranch);
    addValue(node.config.falseBranch);
    addValue(node.config.defaultTarget);
    addValue(node.config.body);
    if (Array.isArray(node.config.routes)) {
      node.config.routes.forEach((route: any) => {
        addValue(route?.target);
      });
    }
  }

  return Array.from(targets);
};

export const buildGraph = (definition: WorkflowDefinition) => {
  const adjacency = new Map<string, Set<string>>();
  if (!definition?.nodes) {
    return adjacency;
  }
  Object.entries(definition.nodes).forEach(([nodeId, node]) => {
    const targets = collectTargets(node);
    adjacency.set(nodeId, new Set(targets));
  });
  return adjacency;
};

export const toEdgeSet = (graph: Map<string, Set<string>>) => {
  const edges = new Set<string>();
  for (const [source, targets] of graph.entries()) {
    for (const target of targets) {
      edges.add(`${source}->${target}`);
    }
  }
  return edges;
};

export const traverseGraph = (
  graph: Map<string, Set<string>>,
  startNodes: string[],
) => {
  const visited = new Set<string>();
  const stack = [...startNodes];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (visited.has(current)) continue;
    visited.add(current);
    const next = graph.get(current);
    if (next) {
      next.forEach((nodeId) => {
        if (!visited.has(nodeId)) {
          stack.push(nodeId);
        }
      });
    }
  }
  return visited;
};

export const reverseGraph = (graph: Map<string, Set<string>>) => {
  const reversed = new Map<string, Set<string>>();
  for (const [source, targets] of graph.entries()) {
    if (!reversed.has(source)) {
      reversed.set(source, new Set());
    }
    targets.forEach((target) => {
      const set = reversed.get(target) || new Set<string>();
      set.add(source);
      reversed.set(target, set);
    });
  }
  return reversed;
};
