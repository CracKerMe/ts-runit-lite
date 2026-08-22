/**
 * Custom function registry for the expression engine.
 * Allows runtime registration of user-defined functions that can be
 * used in workflow expressions (e.g., `${formatCurrency(amount, 'USD')}`).
 *
 * Each custom function is defined as an expression string and compiled
 * into a callable at registration time.
 */
import { Logger } from "../../utils/Logger";
import { evaluate, registerFunction } from "../ExpressionEvaluator";

/** Metadata associated with a custom function */
export interface CustomFunctionMeta {
  name: string;
  description: string;
  /** Expression body — will be wrapped into a function at call time */
  expression: string;
  /** Parameter names the expression expects */
  params: string[];
  createdAt: number;
}

interface InternalEntry {
  meta: CustomFunctionMeta;
  fn: (...args: unknown[]) => unknown;
}

const entries = new Map<string, InternalEntry>();

/**
 * Register a custom function.
 *
 * @param name       Unique function name (must not collide with built-ins)
 * @param expression Expression body — evaluated with the given param names in scope
 * @param params     Ordered parameter names
 * @param description Human-readable description
 * @throws if name collides with an existing custom function (use force to override)
 */
export function registerCustomFunction(
  name: string,
  expression: string,
  params: string[],
  description = "",
  force = false,
): void {
  if (!force && entries.has(name)) {
    throw new Error(`Custom function "${name}" already registered`);
  }

  // Build a wrapper that evaluates the expression with params bound to arguments
  const fn = (...args: unknown[]): unknown => {
    const context: Record<string, unknown> = {};
    for (let i = 0; i < params.length; i++) {
      context[params[i]] = args[i];
    }
    return evaluate(expression, context);
  };

  const meta: CustomFunctionMeta = {
    name,
    description,
    expression,
    params,
    createdAt: Date.now(),
  };

  entries.set(name, { meta, fn });

  // Also register into the global expression engine FUNCTIONS map
  registerFunction(name, fn);

  Logger.info(
    "system",
    "custom-functions",
    `Registered custom function: ${name}`,
    {
      params,
      expression: expression.substring(0, 100),
    },
  );
}

/**
 * Unregister a custom function by name.
 * @returns true if the function existed and was removed
 */
export function unregisterCustomFunction(name: string): boolean {
  const existed = entries.delete(name);
  if (existed) {
    Logger.info(
      "system",
      "custom-functions",
      `Unregistered custom function: ${name}`,
    );
  }
  return existed;
}

/**
 * Get metadata for a single custom function.
 */
export function getCustomFunction(
  name: string,
): CustomFunctionMeta | undefined {
  return entries.get(name)?.meta;
}

/**
 * List all registered custom functions.
 */
export function listCustomFunctions(): CustomFunctionMeta[] {
  return Array.from(entries.values()).map((e) => e.meta);
}
