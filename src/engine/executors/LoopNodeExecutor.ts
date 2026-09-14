// oxlint-disable no-explicit-any -- Loop executor handles dynamic collection/item types
import type { WorkflowInstance } from "../../model/Instance";
import { parseEnvInt } from "../../utils/env";
import { Logger } from "../../utils/Logger";
import { getConcurrencyControl } from "../ConcurrencyControl";
import { evaluate, interpolateObject } from "../ExpressionEvaluator";

/** 单个 loop 节点允许的最大迭代次数。 */
function getMaxLoopIterations(): number {
  return parseEnvInt(process.env.MAX_LOOP_ITERATIONS, 10_000, { min: 1 });
}

/**
 * Loop node configuration
 */
export interface LoopNodeConfig {
  collection: string; // Expression returning array to iterate over
  itemVariable: string; // Variable name for current item (e.g., "item")
  indexVariable?: string; // Variable name for index (e.g., "index")
  body: string; // Node ID to execute for each item
  parallel?: boolean; // Execute iterations in parallel (default: false)
  maxConcurrency?: number; // Maximum concurrent iterations (default: unlimited)
}

/**
 * Loop node output
 */
export interface LoopNodeOutput {
  iterations: number; // Number of iterations completed
  results: any[]; // Aggregated results from body executions
  duration: number; // Total duration in milliseconds
}

/**
 * Loop Node Executor
 * Iterates over a collection and executes a body node for each item
 * Supports both sequential and parallel execution modes
 */
/**
 * Evaluate the collection expression to get the array to iterate over
 * @param collectionExpr - The collection expression
 * @param instance - Workflow instance for context
 * @returns Array to iterate over
 */
function evaluateCollection(
  collectionExpr: string,
  instance: WorkflowInstance,
): any[] {
  // Build evaluation context with access to workflow context and state
  const evaluationContext: Record<string, any> = {
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
    const result = evaluate(collectionExpr, evaluationContext);

    return result;
  } catch (error: any) {
    Logger.error(
      instance.instanceId,
      "loop-node",
      `Error evaluating collection expression: ${collectionExpr}`,
      error?.stack,
    );
    throw new Error(`Invalid collection expression: ${error.message}`, {
      cause: error,
    });
  }
}

/**
 * Execute iterations sequentially (one after another)
 * @param collection - Array to iterate over
 * @param config - Loop configuration
 * @param instance - Workflow instance
 * @param executeBody - Function to execute body node
 * @returns Array of results from each iteration
 */
async function executeSequential(
  collection: any[],
  config: LoopNodeConfig,
  instance: WorkflowInstance,
  executeBody: (
    itemContext: Record<string, any>,
    index: number,
  ) => Promise<any>,
): Promise<any[]> {
  const results: any[] = [];

  for (let i = 0; i < collection.length; i++) {
    const item = collection[i];

    Logger.log(
      instance.instanceId,
      "loop-node",
      `Executing iteration ${i + 1}/${collection.length}`,
    );

    // Build context for this iteration
    const itemContext: Record<string, any> = {
      [config.itemVariable]: item,
    };

    if (config.indexVariable) {
      itemContext[config.indexVariable] = i;
    }

    try {
      // Execute the body node with the item context
      const result = await executeBody(itemContext, i);
      results.push(result);

      Logger.log(
        instance.instanceId,
        "loop-node",
        `Iteration ${i + 1}/${collection.length} completed`,
      );
    } catch (error: any) {
      Logger.error(
        instance.instanceId,
        "loop-node",
        `Iteration ${i + 1}/${collection.length} failed: ${error.message}`,
        error?.stack,
      );
      throw new Error(`Loop iteration ${i} failed: ${error.message}`, {
        cause: error,
      });
    }
  }

  return results;
}

/**
 * Execute iterations in parallel with optional concurrency limit
 * @param collection - Array to iterate over
 * @param config - Loop configuration
 * @param instance - Workflow instance
 * @param executeBody - Function to execute body node
 * @returns Array of results from each iteration (in original order)
 */
async function executeParallel(
  collection: any[],
  config: LoopNodeConfig,
  instance: WorkflowInstance,
  executeBody: (
    itemContext: Record<string, any>,
    index: number,
  ) => Promise<any>,
): Promise<any[]> {
  // Falls back to the engine-wide MAX_CONCURRENT_NODES setting when the
  // loop node doesn't specify its own limit.
  //
  // 必须挡住 NaN 与 <=0：`executing.size >= NaN` 恒为 false（并发上限静默
  // 失效），`>= 0` 恒为 true（每调度一个就 await，退化为串行）。
  const configuredConcurrency =
    config.maxConcurrency ??
    getConcurrencyControl().getConfig().maxConcurrentNodesPerInstance;
  const maxConcurrency =
    Number.isFinite(configuredConcurrency) && configuredConcurrency >= 1
      ? Math.trunc(configuredConcurrency)
      : collection.length;

  Logger.log(
    instance.instanceId,
    "loop-node",
    `Executing ${collection.length} iterations in parallel (max concurrency: ${maxConcurrency})`,
  );

  // If no concurrency limit or limit >= collection size, execute all at once
  if (maxConcurrency >= collection.length) {
    const promises = collection.map(async (item, i) => {
      // Build context for this iteration
      const itemContext: Record<string, any> = {
        [config.itemVariable]: item,
      };

      if (config.indexVariable) {
        itemContext[config.indexVariable] = i;
      }

      try {
        const result = await executeBody(itemContext, i);

        Logger.log(
          instance.instanceId,
          "loop-node",
          `Parallel iteration ${i + 1}/${collection.length} completed`,
        );

        return result;
      } catch (error: any) {
        Logger.error(
          instance.instanceId,
          "loop-node",
          `Parallel iteration ${i + 1}/${collection.length} failed: ${error.message}`,
          error?.stack,
        );
        throw new Error(`Loop iteration ${i} failed: ${error.message}`, {
          cause: error,
        });
      }
    });

    return await Promise.all(promises);
  }

  // 有界并发池。
  //
  // 旧实现每次补位都要遍历整个池，用
  // `Promise.race([p, Promise.resolve("pending")])` 逐个探测哪些已结算，
  // 每个窗口 O(n) 次 race、整体 O(n²)，且正确性依赖「已结算的 promise 会
  // 赢过另一个已结算的 promise」这一微妙的微任务顺序语义。
  //
  // 现在改为：.finally 在结算时确定性地把自己从 Set 中移除，补位只需一次
  // race；.catch 记录首个错误而不 re-throw，末尾无条件 drain 完所有在途
  // 任务后再抛出，保证没有任何被遗弃、无 handler 的在途 promise。
  const results: any[] = Array.from({ length: collection.length });
  const executing = new Set<Promise<void>>();
  let firstError: Error | undefined;

  for (let index = 0; index < collection.length; index++) {
    // 已有迭代失败时停止调度新迭代，但仍要 drain 已在途的
    if (firstError) break;

    // Build context for this iteration
    const itemContext: Record<string, any> = {
      [config.itemVariable]: collection[index],
    };

    if (config.indexVariable) {
      itemContext[config.indexVariable] = index;
    }

    const promise: Promise<void> = executeBody(itemContext, index)
      .then((result) => {
        results[index] = result;

        Logger.log(
          instance.instanceId,
          "loop-node",
          `Parallel iteration ${index + 1}/${collection.length} completed`,
        );
      })
      .catch((error: any) => {
        Logger.error(
          instance.instanceId,
          "loop-node",
          `Parallel iteration ${index + 1}/${collection.length} failed: ${error.message}`,
          error?.stack,
        );
        firstError ??= new Error(
          `Loop iteration ${index} failed: ${error.message}`,
          { cause: error },
        );
      })
      .finally(() => {
        executing.delete(promise);
      });

    executing.add(promise);

    if (executing.size >= maxConcurrency) {
      await Promise.race(executing);
    }
  }

  // 无条件 drain，确保没有被遗弃的在途 promise
  await Promise.all(executing);

  if (firstError) throw firstError;

  return results;
}

/**
 * Get the body node ID to execute for each iteration
 * This is a helper method for workflow engines
 * @param config - Loop node configuration
 * @returns The body node ID
 */
export function getBodyNode(config: LoopNodeConfig): string {
  return config.body;
}

/**
 * Execute a loop node
 * @param config - Loop node configuration
 * @param instance - Workflow instance for context
 * @param executeBody - Function to execute the body node for each iteration
 * @returns Loop execution results with iterations count, results array, and duration
 */
export async function execute(
  config: LoopNodeConfig,
  instance: WorkflowInstance,
  executeBody: (
    itemContext: Record<string, any>,
    index: number,
  ) => Promise<any>,
): Promise<LoopNodeOutput> {
  const startTime = Date.now();

  // Evaluate expressions in configuration
  const context = {
    context: instance.context || {},
    state: instance.state || {},
  };

  const evaluatedConfig = interpolateObject(config, context, instance.state);

  Logger.log(
    instance.instanceId,
    "loop-node",
    `Evaluating collection expression: ${evaluatedConfig.collection}`,
  );

  try {
    // Evaluate the collection expression to get the array
    const collection = evaluateCollection(evaluatedConfig.collection, instance);

    if (!Array.isArray(collection)) {
      throw new Error(
        `Collection expression must return an array, got ${typeof collection} ` +
          `(expression: ${evaluatedConfig.collection})`,
      );
    }

    // 迭代次数上限：每次迭代都会向 instance.history 追加日志并触发存储写入，
    // 一个返回百万元素的表达式足以拖垮引擎。在执行任何 body 之前就拒绝。
    const maxIterations = getMaxLoopIterations();
    if (collection.length > maxIterations) {
      throw new Error(
        `Loop iteration count ${collection.length} exceeds the limit of ${maxIterations}`,
      );
    }

    Logger.log(
      instance.instanceId,
      "loop-node",
      `Starting loop with ${collection.length} iterations (mode: ${evaluatedConfig.parallel ? "parallel" : "sequential"})`,
    );

    // Execute iterations based on mode
    const results = evaluatedConfig.parallel
      ? await executeParallel(
          collection,
          evaluatedConfig,
          instance,
          executeBody,
        )
      : await executeSequential(
          collection,
          evaluatedConfig,
          instance,
          executeBody,
        );

    const duration = Date.now() - startTime;

    Logger.log(
      instance.instanceId,
      "loop-node",
      `Loop completed: ${collection.length} iterations in ${duration}ms`,
    );

    return {
      iterations: collection.length,
      results,
      duration,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;

    Logger.error(
      instance.instanceId,
      "loop-node",
      `Loop execution failed after ${duration}ms: ${error.message}`,
      error?.stack,
    );

    throw new Error(`Loop execution failed: ${error.message}`, {
      cause: error,
    });
  }
}

export const LoopNodeExecutor = {
  execute,
  getBodyNode,
};
