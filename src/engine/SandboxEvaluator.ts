// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import vm from "node:vm";
import { Logger } from "../utils/Logger";

/**
 * Sandbox configuration for expression evaluation
 */
interface SandboxOptions {
  /** Maximum execution time in milliseconds (default: 100) */
  timeoutMs?: number;
  /** Additional context variables to inject */
  extraContext?: Record<string, unknown>;
}

type SafeMathEntry = ((...args: number[]) => number) | number;

/**
 * Safe built-in objects allowed in the sandbox.
 * Uses isolated primitive wrappers to cut off prototype chain access to the host.
 */
function createSandboxContext(): Record<string, unknown> {
  // 创建隔离的 primitive 包装对象，而非直接引用宿主全局
  const safeJSON = Object.freeze({
    parse: (s: string) => JSON.parse(s),
    stringify: (v: unknown, r?: any, s?: any) => JSON.stringify(v, r, s),
  });

  const safeMath = Object.freeze(
    Object.fromEntries(
      (Object.getOwnPropertyNames(Math) as Array<keyof Math>)
        .filter(
          (k) => typeof Math[k] === "function" || typeof Math[k] === "number",
        )
        .map((k) => [k, Math[k] as SafeMathEntry]),
    ),
  );

  return Object.freeze({
    Math: safeMath,
    JSON: safeJSON,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    Number,
    String,
    Boolean,
    // Only expose static factory methods, not constructors that could be abused
    Array,
    Object,
    RegExp,
    Map,
    Set,
    // Date 静态方法 (only statics, not the constructor)
    UTC: Date.UTC,
    now: Date.now,
    parse: Date.parse,
    // Error types (safe — no code execution vectors)
    Error,
    TypeError,
    RangeError,
    ReferenceError,
    SyntaxError,
    // Utility methods
    ObjectKeys: (o: object) => Object.keys(o),
    ObjectValues: (o: object) => Object.values(o),
    ObjectEntries: (o: object) => Object.entries(o),
    ArrayIsArray: Array.isArray,
    DateNow: () => Date.now(),
    // Explicitly block access to dangerous constructors
    undefined: undefined,
    NaN: Number.NaN,
    Infinity: Number.POSITIVE_INFINITY,
  });
}

/**
 * Deep freeze a record and all nested objects to prevent prototype chain pollution.
 */
function deepFreeze(obj: Record<string, unknown>): Record<string, unknown> {
  Object.freeze(obj);
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object" && !Object.isFrozen(val)) {
      try {
        deepFreeze(val as Record<string, unknown>);
      } catch {
        // Some built-in objects can't be frozen, skip
      }
    }
  }
  return obj;
}

/**
 * Patterns that are blocked in sandboxed expressions
 */
const BLOCKED_PATTERNS = [
  /\brequire\s*\(/, // require() 调用
  /\bprocess\s*\./, // process.env / process.exit
  /\bglobalThis\b/,
  /\b__proto__\b/,
  /\bprototype\s*\[/, // prototype["xxx"] 动态访问
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/, // new Function() 动态代码
  /\bimport\s*\(/, // dynamic import
  /\bexports\b/,
  /\bmodule\b/,
  /\bexec\b/,
  /\bspawn\b/,
  /\bchild_process\b/,
  /\bfs\b/,
  /\bos\b/,
  /\bpath\b/,
  /\bnet\b/,
  /\bhttp\b/,
  /\bhttps\b/,
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bconstructor\b/, // prevent constructor chain access
  /\b__defineGetter__\b/,
  /\b__defineSetter__\b/,
  /\b__lookupGetter__\b/,
  /\b__lookupSetter__\b/,
  /\bProxy\b/, // prevent Proxy-based sandbox escapes
  /\bReflect\b/,
  /\bWeakRef\b/,
  /\bFinalizationRegistry\b/,
];

/**
 * Check if an expression contains blocked patterns
 */
function containsBlockedPatterns(expression: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(expression)) {
      return `Expression contains blocked pattern: ${pattern.source}`;
    }
  }
  return null;
}

/**
 * Safely evaluate an expression in a sandboxed VM context.
 * Blocks access to dangerous Node.js APIs and prevents prototype pollution.
 *
 * @param expression - The expression to evaluate
 * @param context - Variables to make available in the expression
 * @param options - Sandbox configuration options
 * @returns The evaluation result
 * @throws Error if the expression is blocked or evaluation fails
 */
export function evaluateSandboxed(
  expression: string,
  context: Record<string, unknown> = {},
  options: SandboxOptions = {},
): unknown {
  const timeoutMs = options.timeoutMs || 100;

  // Pre-check for blocked patterns
  const blockedReason = containsBlockedPatterns(expression);
  if (blockedReason) {
    Logger.warn("system", "sandbox", "Blocked expression", {
      expression: expression.substring(0, 100),
      reason: blockedReason,
    });
    throw new Error(blockedReason);
  }

  // Create sandbox context with safe builtins (deep frozen to prevent prototype pollution)
  const sandbox = deepFreeze({
    ...createSandboxContext(),
    ...context,
    ...options.extraContext,
  });

  try {
    // Create a new context (isolated global scope)
    const vmContext = vm.createContext(sandbox);

    // Wrap expression to handle both simple values and complex expressions
    const script = new vm.Script(`(${expression})`, {
      filename: "sandboxed-expression.vm",
    });

    // Run with timeout protection
    const result = script.runInContext(vmContext, {
      timeout: timeoutMs,
      displayErrors: false,
    });

    return result;
  } catch (err: unknown) {
    if (
      (err instanceof Error ? err.message : String(err))?.includes("timed out")
    ) {
      Logger.warn("system", "sandbox", "Expression evaluation timed out", {
        expression: expression.substring(0, 100),
        timeoutMs,
      });
      throw new Error(`Expression evaluation timed out after ${timeoutMs}ms`, {
        cause: err,
      });
    }

    Logger.debug("system", "sandbox", "Expression evaluation failed", {
      expression: expression.substring(0, 100),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Evaluate a condition expression safely (returns boolean)
 */
export function evaluateConditionSandboxed(
  expression: string,
  context: Record<string, unknown> = {},
): boolean {
  try {
    const result = evaluateSandboxed(expression, context);
    return Boolean(result);
  } catch (err: unknown) {
    Logger.error(
      "system",
      "sandbox",
      `Error evaluating condition: ${expression}`,
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Check if the VM module is available (for environments where it might not be)
 */
export function isSandboxAvailable(): boolean {
  try {
    return typeof vm.createContext === "function";
  } catch {
    return false;
  }
}
