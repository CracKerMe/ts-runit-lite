import type { WorkflowInstance } from "../../model/Instance";
import { errorMessage, errorStack, Logger } from "../../utils/Logger";
import { evaluate } from "../ExpressionEvaluator";

/**
 * Transform node configuration
 *
 * `output` maps result field names to expressions evaluated against the
 * workflow context and prior node outputs. Unlike plain `${...}` string
 * interpolation (see ExpressionEvaluator.interpolateObject), each field is
 * evaluated through the expression engine directly, so the result keeps its
 * native type (number, boolean, array, object) instead of being stringified.
 */
export interface TransformNodeConfig {
  /**
   * Field name -> expression (e.g. "${a.output.x + b.output.y}" or a bare
   * expression). Each value is passed to the expression engine, not
   * interpolated as a template string — a literal string result must be
   * quoted inside the expression (e.g. "'order total'"), otherwise a plain
   * word like "order total" is invalid expression syntax and the node fails.
   */
  output: Record<string, string>;
}

/**
 * Transform node output: the evaluated `output` map.
 */
export type TransformNodeOutput = Record<string, unknown>;

/**
 * An expression field may be wrapped in `${...}` (consistent with the rest
 * of the workflow definition syntax) or written as a bare expression. Both
 * forms are accepted so `transform` config reads the same as other nodes'
 * expression fields.
 */
function unwrapExpression(expression: string): string {
  const trimmed = expression.trim();
  if (trimmed.startsWith("${") && trimmed.endsWith("}")) {
    return trimmed.slice(2, -1);
  }
  return trimmed;
}

function buildEvaluationContext(
  instance: WorkflowInstance,
): Record<string, unknown> {
  const evaluationContext: Record<string, unknown> = {
    ...instance.context,
    context: instance.context || {},
    state: instance.state || {},
  };

  if (instance.state?.nodes) {
    for (const [nodeId, nodeState] of Object.entries(instance.state.nodes)) {
      // Expose both the raw output (e.g. `${nodeId.field}`) and the
      // `.output` accessor used by string interpolation elsewhere, so
      // transform expressions can be written either way.
      evaluationContext[nodeId] = nodeState;
    }
  }

  return evaluationContext;
}

/**
 * Execute a transform node: evaluate every field in `config.output` as an
 * expression against workflow context + prior node outputs, and return the
 * resulting object as the node's output.
 */
export async function execute(
  config: TransformNodeConfig,
  instance: WorkflowInstance,
): Promise<TransformNodeOutput> {
  if (!config?.output || typeof config.output !== "object") {
    throw new Error("Transform node requires config.output");
  }

  const evaluationContext = buildEvaluationContext(instance);
  const result: TransformNodeOutput = {};

  for (const [fieldName, rawExpression] of Object.entries(config.output)) {
    const expression = unwrapExpression(rawExpression);
    try {
      result[fieldName] = evaluate(expression, evaluationContext);
    } catch (error: unknown) {
      Logger.error(
        instance.instanceId,
        "transform-node",
        `Error evaluating output field "${fieldName}": ${expression}`,
        errorStack(error),
      );
      throw new Error(
        `Transform field "${fieldName}" evaluation failed: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  return result;
}

export const TransformNodeExecutor = {
  execute,
};
