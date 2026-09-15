import { z } from "zod";

/**
 * Zod schemas mirroring src/model/Workflow.ts and the per-type `config`
 * shapes declared in src/engine/executors/*.ts. This is the single
 * machine-readable source of truth for the workflow model: it doubles as
 * a runtime validator (see SchemaValidator.validateNodeConfigs, which stays
 * responsible for graph-level checks like cycles/references) and, via
 * z.toJSONSchema(), as the JSON Schema exposed to frontend tooling through
 * GET /workflows/schema and the OpenAPI spec.
 */

export const TaskTypeSchema = z.enum([
  "action",
  "wait",
  "event",
  "rollback",
  "subworkflow",
  "http",
  "sql",
  "queue",
  "condition",
  "router",
  "loop",
  "approval",
  "notification",
  "join",
  "transform",
]);

const httpNodeConfigSchema = z
  .object({
    method: z.enum([
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "PATCH",
      "HEAD",
      "OPTIONS",
    ]),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.unknown().optional(),
    timeout: z.number().optional(),
    retryPolicy: z
      .object({
        maxRetries: z.number(),
        backoff: z.enum(["linear", "exponential"]),
        initialDelay: z.number().optional(),
      })
      .optional(),
    followRedirects: z.boolean().optional(),
  })
  .meta({ id: "HttpNodeConfig" });

const sqlNodeConfigSchema = z
  .object({
    connection: z.string(),
    query: z.string(),
    parameters: z.array(z.unknown()).optional(),
    timeout: z.number().optional(),
    database: z
      .enum(["postgres", "mysql", "sqlite", "mssql", "generic"])
      .optional(),
  })
  .meta({ id: "SqlNodeConfig" });

const queueNodeConfigSchema = z
  .object({
    operation: z.enum(["publish", "consume"]),
    queue: z.string(),
    message: z.unknown().optional(),
    timeout: z.number().optional(),
  })
  .meta({ id: "QueueNodeConfig" });

const conditionNodeConfigSchema = z
  .object({
    condition: z.string(),
    trueBranch: z.string(),
    falseBranch: z.string(),
  })
  .meta({ id: "ConditionNodeConfig" });

const routerNodeConfigSchema = z
  .object({
    routes: z.array(
      z.object({
        condition: z.string(),
        target: z.string(),
        priority: z.number().optional(),
      }),
    ),
    defaultTarget: z.string().optional(),
  })
  .meta({ id: "RouterNodeConfig" });

const loopNodeConfigSchema = z
  .object({
    collection: z.string(),
    itemVariable: z.string(),
    indexVariable: z.string().optional(),
    body: z.string(),
    parallel: z.boolean().optional(),
    maxConcurrency: z.number().optional(),
  })
  .meta({ id: "LoopNodeConfig" });

export const ApprovalNodeConfigSchema = z
  .object({
    eventType: z.string().optional(),
    prompt: z.string().optional(),
    approvedTarget: z.string().optional(),
    rejectedTarget: z.string().optional(),
    timeoutMs: z.number().optional(),
    requireInstanceIdMatch: z.boolean().optional(),
  })
  .meta({ id: "ApprovalNodeConfig" });

export const NotificationNodeConfigSchema = z
  .object({
    channel: z.union([
      z.enum(["slack", "feishu", "dingtalk", "email", "webhook"]),
      z.string(),
    ]),
    target: z.string(),
    template: z.string(),
    subject: z.string().optional(),
    severity: z.enum(["info", "warning", "critical"]).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: "NotificationNodeConfig" });

const joinNodeConfigSchema = z
  .object({
    waitFor: z.array(z.string()).min(1),
    mode: z.enum(["all", "any"]).optional(),
  })
  .meta({ id: "JoinNodeConfig" });

const transformNodeConfigSchema = z
  .object({
    output: z.record(z.string(), z.string()),
  })
  .meta({ id: "TransformNodeConfig" });

export const WaitNodeConfigSchema = z
  .object({
    durationMs: z.number().optional(),
    until: z.string().optional(),
  })
  .meta({ id: "WaitNodeConfig" });

/** Per-type config schema, keyed by TaskType. Types without a dedicated
 * declarative config (action/event/rollback/subworkflow) accept any
 * object — action nodes in particular carry a JS closure at runtime and
 * are not representable in a JSON schema. `wait`'s config is optional at
 * the node level (TaskNode.timeout is a legacy alternative), but when
 * present it must match WaitNodeConfigSchema. */
export const nodeConfigSchemaByType: Partial<
  Record<z.infer<typeof TaskTypeSchema>, z.ZodTypeAny>
> = {
  wait: WaitNodeConfigSchema,
  http: httpNodeConfigSchema,
  sql: sqlNodeConfigSchema,
  queue: queueNodeConfigSchema,
  condition: conditionNodeConfigSchema,
  router: routerNodeConfigSchema,
  loop: loopNodeConfigSchema,
  approval: ApprovalNodeConfigSchema,
  notification: NotificationNodeConfigSchema,
  join: joinNodeConfigSchema,
  transform: transformNodeConfigSchema,
};

const conditionalBranchSchema = z.object({
  condition: z.string(),
  target: z.string(),
});

const retryPolicySchema = z.record(z.string(), z.unknown());

/**
 * Base TaskNode shape shared by every node type. `config` is intentionally
 * loose here (per-type shape is available via nodeConfigSchemaByType /
 * TaskNodeSchemaByType) so a single non-discriminated schema can still
 * validate a full WorkflowDefinition where nodes of differing types share
 * one `nodes` map.
 */
export const TaskNodeSchema = z
  .object({
    id: z.string(),
    type: TaskTypeSchema,
    timeout: z.number().optional(),
    next: z.array(z.string()).optional(),
    onEvent: z.string().optional(),
    rollbackTo: z.string().optional(),
    failureNext: z.array(z.string()).optional(),
    maxRetries: z.number().optional(),
    retryPolicy: retryPolicySchema.optional(),
    heartbeat: z
      .object({
        interval: z.number().optional(),
        timeout: z.number().optional(),
      })
      .optional(),
    conditionalNext: z.array(conditionalBranchSchema).optional(),
    defaultNext: z.string().optional(),
    subworkflowId: z.string().optional(),
    subworkflowInput: z.record(z.string(), z.string()).optional(),
    waitForCompletion: z.boolean().optional(),
    output: z.unknown().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    inputSchema: z.record(z.string(), z.unknown()).optional(),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: "TaskNode" });

export const WorkflowDefinitionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    version: z.string().optional(),
    description: z.string().optional(),
    nodes: z.record(z.string(), TaskNodeSchema),
    startNode: z.string(),
    cron: z.string().optional(),
    triggerEvents: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    /** Serialized as ISO strings over JSON transport even though the TS
     * model types these as `Date`. */
    createdAt: z.union([z.string(), z.number()]).optional(),
    updatedAt: z.union([z.string(), z.number()]).optional(),
    inputSchema: z.record(z.string(), z.unknown()).optional(),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: "WorkflowDefinition" });

/**
 * Validates a node's `config` against the declarative schema for its type,
 * when one exists. Returns null for types without a dedicated config schema
 * (action/wait/event/rollback/subworkflow) rather than treating them as
 * invalid.
 */
export function validateNodeConfig(
  type: string,
  config: unknown,
): z.ZodSafeParseResult<unknown> | null {
  const schema = nodeConfigSchemaByType[type as z.infer<typeof TaskTypeSchema>];
  if (!schema) {
    return null;
  }
  return schema.safeParse(config ?? {});
}

/** JSON Schema (draft 2020-12) for the full WorkflowDefinition, generated
 * from the Zod schemas above so it stays in sync with the TS model. */
export function getWorkflowDefinitionJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(WorkflowDefinitionSchema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>;
}

/** JSON Schema for a single node type's `config`, or null if that type has
 * no declarative config (e.g. action/wait/event/rollback/subworkflow). */
export function getNodeConfigJsonSchema(
  type: string,
): Record<string, unknown> | null {
  const schema = nodeConfigSchemaByType[type as z.infer<typeof TaskTypeSchema>];
  if (!schema) {
    return null;
  }
  return z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<
    string,
    unknown
  >;
}

/**
 * Flattens a Zod-generated JSON Schema into OpenAPI 3.0-compatible
 * `components.schemas` entries: the root schema (keyed by `rootName`) plus
 * one entry per `$defs` sub-schema, with every internal `#/$defs/X` ref
 * rewritten to `#/components/schemas/X` (OpenAPI 3.0 has no `$defs`
 * keyword, so nested defs must be promoted to top-level named schemas).
 */
function toOpenApiComponents(
  rootName: string,
  zodSchema: z.ZodTypeAny,
): Record<string, unknown> {
  const generated = z.toJSONSchema(zodSchema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>;
  const {
    $schema: _schema,
    $defs,
    ...root
  } = generated as {
    $schema?: string;
    $defs?: Record<string, unknown>;
    [key: string]: unknown;
  };

  const rewritten = JSON.parse(
    JSON.stringify({ [rootName]: root, ...$defs }).replaceAll(
      "#/$defs/",
      "#/components/schemas/",
    ),
  ) as Record<string, unknown>;

  return rewritten;
}

/** OpenAPI 3.0 `components.schemas` entries for WorkflowDefinition, TaskNode,
 * and every per-node-type config schema — used to replace the hand-written
 * (and previously incomplete) WorkflowDefinition stub in src/api/openapi.ts. */
export function getWorkflowOpenApiSchemas(): Record<string, unknown> {
  let schemas: Record<string, unknown> = toOpenApiComponents(
    "WorkflowDefinition",
    WorkflowDefinitionSchema,
  );
  for (const [type, configSchema] of Object.entries(nodeConfigSchemaByType)) {
    if (!configSchema) continue;
    schemas = {
      ...schemas,
      ...toOpenApiComponents(
        `${type[0].toUpperCase()}${type.slice(1)}NodeConfig`,
        configSchema,
      ),
    };
  }
  return schemas;
}
