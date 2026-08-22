import type { WorkflowInstance } from "../../model/Instance";
import { errorMessage, errorStack, Logger } from "../../utils/Logger";
import { interpolateObject } from "../ExpressionEvaluator";

/**
 * Queue node configuration
 */
export interface QueueNodeConfig {
  operation: "publish" | "consume"; // Queue operation type
  queue: string; // Queue name (supports expressions)
  message?: unknown; // Message to publish (for publish operation, supports expressions)
  timeout?: number; // Timeout for consume operations in milliseconds
}

/**
 * Queue node output
 */
export interface QueueNodeOutput {
  messageId?: string; // Message ID for publish operations
  message?: unknown; // Message content for consume operations
}

/**
 * Queue provider interface
 * This allows different message queue systems to be plugged in
 */
export interface QueueProvider {
  publish(queue: string, message: unknown): Promise<string>; // Returns messageId
  consume(queue: string, timeout?: number): Promise<unknown>; // Returns message
  close?(): Promise<void>;
}

/**
 * Global queue provider registry
 * Allows applications to register queue providers by name
 */
const queueProviders = new Map<string, QueueProvider>();

/**
 * Register a queue provider
 * @param name - Queue provider name/identifier
 * @param provider - Queue provider instance
 */
export function registerQueueProvider(
  name: string,
  provider: QueueProvider,
): void {
  queueProviders.set(name, provider);
  Logger.info(
    "queue-node",
    "provider-registered",
    `Queue provider registered: ${name}`,
  );
}

/**
 * Unregister a queue provider
 * @param name - Queue provider name/identifier
 */
export function unregisterQueueProvider(name: string): void {
  const provider = queueProviders.get(name);
  if (provider?.close) {
    provider.close().catch((error) => {
      Logger.error(
        "queue-node",
        "provider-close-error",
        `Error closing queue provider ${name}`,
        errorStack(error),
      );
    });
  }
  queueProviders.delete(name);
  Logger.info(
    "queue-node",
    "provider-unregistered",
    `Queue provider unregistered: ${name}`,
  );
}

/**
 * Get a registered queue provider
 * @param name - Queue provider name/identifier
 * @returns Queue provider instance or undefined
 */
export function getQueueProvider(name: string): QueueProvider | undefined {
  return queueProviders.get(name);
}

/**
 * Queue Node Executor
 * Executes queue operations (publish/consume) with timeout support
 * Supports message queues like RabbitMQ, Redis, AWS SQS, etc.
 */
/**
 * Create a timeout promise that rejects after specified milliseconds
 */
function createTimeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Queue consume timeout after ${ms}ms`));
    }, ms);
  });
}

/**
 * Execute publish operation
 */
async function executePublish(
  provider: QueueProvider,
  queue: string,
  message: unknown,
): Promise<string> {
  return await provider.publish(queue, message);
}

/**
 * Execute consume operation with timeout support
 */
async function executeConsume(
  provider: QueueProvider,
  queue: string,
  timeout?: number,
): Promise<unknown> {
  if (!timeout) {
    // No timeout, consume directly
    return await provider.consume(queue);
  }

  // Execute with timeout
  return await Promise.race([
    provider.consume(queue, timeout),
    createTimeoutPromise(timeout),
  ]);
}

/**
 * Queue Node Executor
 * Executes queue operations (publish/consume) with timeout support
 */
export async function execute(
  config: QueueNodeConfig,
  instance: WorkflowInstance,
): Promise<QueueNodeOutput> {
  const startTime = Date.now();

  // Evaluate expressions in configuration
  const context = {
    context: instance.context || {},
    state: instance.state || {},
  };

  const evaluatedConfig = interpolateObject(config, context, instance.state);

  Logger.log(
    instance.instanceId,
    "queue-node",
    `Executing queue ${evaluatedConfig.operation} operation on queue: ${evaluatedConfig.queue}`,
  );

  try {
    // Get queue provider (use 'default' as the provider name)
    const provider = queueProviders.get("default");
    if (!provider) {
      throw new Error(
        "Queue provider not found. " +
          `Please register a queue provider using registerQueueProvider('default', provider).`,
      );
    }

    let result: QueueNodeOutput;

    if (evaluatedConfig.operation === "publish") {
      // Publish operation
      if (evaluatedConfig.message === undefined) {
        throw new Error("Queue publish operation requires a message");
      }

      const messageId = await executePublish(
        provider,
        evaluatedConfig.queue,
        evaluatedConfig.message,
      );

      result = { messageId };

      const duration = Date.now() - startTime;
      Logger.log(
        instance.instanceId,
        "queue-node",
        `Message published to queue ${evaluatedConfig.queue}: ${messageId} in ${duration}ms`,
      );
    } else if (evaluatedConfig.operation === "consume") {
      // Consume operation
      const message = await executeConsume(
        provider,
        evaluatedConfig.queue,
        evaluatedConfig.timeout,
      );

      result = { message };

      const duration = Date.now() - startTime;
      Logger.log(
        instance.instanceId,
        "queue-node",
        `Message consumed from queue ${evaluatedConfig.queue} in ${duration}ms`,
      );
    } else {
      throw new Error(
        `Invalid queue operation: ${evaluatedConfig.operation}. Must be 'publish' or 'consume'.`,
      );
    }

    return result;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;

    Logger.error(
      instance.instanceId,
      "queue-node",
      `Queue ${config.operation} operation failed after ${duration}ms: ${errorMessage(error)}`,
      errorStack(error),
    );

    throw new Error(
      `Queue ${config.operation} operation failed: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

export const QueueNodeExecutor = {
  execute,
};
