import type { WorkflowInstance } from "../../model/Instance";
import { errorMessage, errorStack, Logger } from "../../utils/Logger";
import { evaluate, interpolateObject } from "../ExpressionEvaluator";

/**
 * Router node route configuration
 */
export interface RouterRoute {
  condition: string; // Expression to evaluate (must return boolean)
  target: string; // Node ID to route to if condition matches
  priority?: number; // Optional priority (lower number = higher priority)
}

/**
 * Router node configuration
 */
export interface RouterNodeConfig {
  routes: RouterRoute[]; // Array of condition-target pairs
  defaultTarget?: string; // Fallback node ID if no conditions match
}

/**
 * Router node output
 */
export interface RouterNodeOutput {
  matchedRoute: number; // Index of matched route (-1 if default used)
  target: string; // The target node ID that was selected
}

/**
 * Router Node Executor
 * Evaluates multiple conditions in priority order and routes to first matching target
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
      "router-node",
      `Error evaluating condition expression: ${condition}`,
      errorStack(error),
    );
    throw new Error(`Invalid condition expression: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

/**
 * Get the target node ID based on the router output
 * This is a helper method for workflow engines to determine routing
 * @param output - The router execution output
 * @returns The node ID to route to
 */
export function getNextNode(output: RouterNodeOutput): string {
  return output.target;
}

/**
 * Execute a router node
 * @param config - Router node configuration
 * @param instance - Workflow instance for context
 * @returns Matched route index and target node ID
 */
export async function execute(
  config: RouterNodeConfig,
  instance: WorkflowInstance,
): Promise<RouterNodeOutput> {
  const startTime = Date.now();

  // Evaluate expressions in configuration (in case routes contain placeholders)
  const context = {
    context: instance.context || {},
    state: instance.state || {},
  };

  const evaluatedConfig = interpolateObject(config, context, instance.state);

  Logger.log(
    instance.instanceId,
    "router-node",
    `Evaluating ${evaluatedConfig.routes.length} routes`,
  );

  try {
    // Sort routes by priority (lower number = higher priority)
    const sortedRoutes = [...evaluatedConfig.routes].sort((a, b) => {
      const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
      const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
      return priorityA - priorityB;
    });

    // Evaluate routes in priority order
    for (let i = 0; i < sortedRoutes.length; i++) {
      const route = sortedRoutes[i];
      const originalIndex = evaluatedConfig.routes.indexOf(route);

      Logger.log(
        instance.instanceId,
        "router-node",
        `Evaluating route ${i} (priority ${route.priority ?? "default"}): ${route.condition}`,
      );

      const conditionResult = evaluateCondition(route.condition, instance);

      if (conditionResult) {
        const duration = Date.now() - startTime;

        Logger.log(
          instance.instanceId,
          "router-node",
          `Route ${originalIndex} matched, routing to ${route.target} in ${duration}ms`,
        );

        return {
          matchedRoute: originalIndex,
          target: route.target,
        };
      }
    }

    // No routes matched, use default target
    if (evaluatedConfig.defaultTarget) {
      const duration = Date.now() - startTime;

      Logger.log(
        instance.instanceId,
        "router-node",
        `No routes matched, using default target ${evaluatedConfig.defaultTarget} in ${duration}ms`,
      );

      return {
        matchedRoute: -1,
        target: evaluatedConfig.defaultTarget,
      };
    }

    // No routes matched and no default target
    const duration = Date.now() - startTime;

    Logger.error(
      instance.instanceId,
      "router-node",
      `No routes matched and no default target configured after ${duration}ms`,
    );

    throw new Error("No routes matched and no default target configured");
  } catch (error: unknown) {
    const duration = Date.now() - startTime;

    Logger.error(
      instance.instanceId,
      "router-node",
      `Router evaluation failed after ${duration}ms: ${errorMessage(error)}`,
      errorStack(error),
    );

    throw new Error(`Router evaluation failed: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

export const RouterNodeExecutor = {
  execute,
  getNextNode,
};
