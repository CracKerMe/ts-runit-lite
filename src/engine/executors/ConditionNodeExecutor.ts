import type { WorkflowInstance } from "../../model/Instance";
import { errorMessage, errorStack, Logger } from "../../utils/Logger";
import { evaluate, interpolateObject } from "../ExpressionEvaluator";

/**
 * Condition node configuration
 */
export interface ConditionNodeConfig {
  condition: string; // Expression to evaluate (must return boolean)
  trueBranch: string; // Node ID to execute if condition is true
  falseBranch: string; // Node ID to execute if condition is false
}

/**
 * Condition node output
 */
export interface ConditionNodeOutput {
  result: boolean; // The boolean result of the condition evaluation
  branch: "true" | "false"; // Which branch was taken
}

/**
 * Condition Node Executor
 * Evaluates a boolean expression and routes to true or false branch
 * Supports expression evaluation with access to workflow context and state
 */
/**
 * Evaluate a condition expression with workflow context
 * @param condition - The condition expression to evaluate
 * @param instance - Workflow instance for context
 * @returns Boolean result of the condition
 */
function evaluateCondition(
  condition: string,
  instance: WorkflowInstance,
): boolean {
  // Build evaluation context with access to workflow context and state
  const evaluationContext: Record<string, unknown> = {
    // Direct access to context variables
    ...instance.context,
    // Nested access to context
    context: instance.context || {},
    // Access to workflow state
    state: instance.state || {},
  };

  // Add node outputs to context for easy access
  if (instance.state?.nodes) {
    for (const [nodeId, nodeState] of Object.entries(instance.state.nodes)) {
      if (nodeState.output !== undefined) {
        evaluationContext[nodeId] = nodeState.output;
      }
    }
  }

  try {
    // Evaluate the expression using the enhanced expression engine
    const result = evaluate(condition, evaluationContext);

    // Convert result to boolean
    return Boolean(result);
  } catch (error: unknown) {
    Logger.error(
      instance.instanceId,
      "condition-node",
      `Error evaluating condition expression: ${condition}`,
      errorStack(error),
    );
    throw new Error(`Invalid condition expression: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

/**
 * Get the next node ID based on the condition result
 * This is a helper method for workflow engines to determine routing
 * @param config - Condition node configuration
 * @param result - The condition evaluation result
 * @returns The node ID to route to
 */
export function getNextNode(
  config: ConditionNodeConfig,
  result: boolean,
): string {
  return result ? config.trueBranch : config.falseBranch;
}

/**
 * Execute a condition node
 * @param config - Condition node configuration
 * @param instance - Workflow instance for context
 * @returns Condition result and branch taken
 */
export async function execute(
  config: ConditionNodeConfig,
  instance: WorkflowInstance,
): Promise<ConditionNodeOutput> {
  const startTime = Date.now();

  // Evaluate expressions in configuration (in case condition itself contains placeholders)
  const context = {
    context: instance.context || {},
    state: instance.state || {},
  };

  const evaluatedConfig = interpolateObject(config, context, instance.state);

  Logger.log(
    instance.instanceId,
    "condition-node",
    `Evaluating condition: ${evaluatedConfig.condition}`,
  );

  try {
    // Evaluate the condition expression
    const result = evaluateCondition(evaluatedConfig.condition, instance);

    const duration = Date.now() - startTime;
    const branch = result ? "true" : "false";
    const targetNode = result
      ? evaluatedConfig.trueBranch
      : evaluatedConfig.falseBranch;

    Logger.log(
      instance.instanceId,
      "condition-node",
      `Condition evaluated to ${result}, routing to ${branch} branch (${targetNode}) in ${duration}ms`,
    );

    return {
      result,
      branch,
    };
  } catch (error: unknown) {
    const duration = Date.now() - startTime;

    Logger.error(
      instance.instanceId,
      "condition-node",
      `Condition evaluation failed after ${duration}ms: ${errorMessage(error)}`,
      errorStack(error),
    );

    throw new Error(`Condition evaluation failed: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

export const ConditionNodeExecutor = {
  execute,
  getNextNode,
};
