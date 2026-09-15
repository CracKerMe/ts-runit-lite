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
 *
 * This is defense-in-depth hardening for trusted workflow definitions, not a
 * security boundary for untrusted code: the VM context and BLOCKED_PATTERNS
 * regex list raise the bar against accidental misuse, but a regex-based
 * blocklist over source text is known to be bypassable (indirect references,
 * computed property access, string concatenation). Only run action strings
 * from workflow definitions you already trust.
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
 * Deep-clone a plain-data value for sandbox exposure. Functions and other
 * non-JSON-safe values pass through by reference (they can't be structurally
 * cloned and aren't targets of deepFreeze mutation in the same way plain
 * objects are), so callers that pass live functions in context should keep
 * that in mind — no bug here, we only need to keep plain data safe.
 */
function cloneForSandbox<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => cloneForSandbox(item)) as unknown as T;
  }
  if (value instanceof Date || typeof value === "function") return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = cloneForSandbox(val);
  }
  return out as T;
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
 * Core `vm` execution: pattern check, context construction, and
 * `vm.Script.runInContext`. Exported (in addition to `evaluateSandboxed`) so
 * `ActionSandboxWorker` — running inside a dedicated worker thread for real
 * isolation — can reuse the exact same blocklist/context logic instead of a
 * second, driftable copy of it.
 *
 * @param expression - The expression to evaluate
 * @param context - Variables to make available in the expression
 * @param options - Sandbox configuration options
 * @returns The evaluation result
 * @throws Error if the expression is blocked or evaluation fails
 */
export function runInVmSandbox(
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

  // Create sandbox context with safe builtins (deep frozen to prevent prototype
  // pollution). context/extraContext are caller-owned live objects (e.g. the
  // running WorkflowInstance) — clone them before freezing so deepFreeze can't
  // reach through the spread and freeze the caller's own object in place.
  const sandbox = deepFreeze({
    ...createSandboxContext(),
    ...cloneForSandbox(context),
    ...cloneForSandbox(options.extraContext ?? {}),
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
 * Safely evaluate an expression in a sandboxed VM context.
 * Blocks access to dangerous Node.js APIs and prevents prototype pollution.
 *
 * This runs in-process (same thread, same heap) — the `vm` context and
 * BLOCKED_PATTERNS blocklist are defense-in-depth, not a real isolation
 * boundary; a hung or CPU-bound expression still occupies this thread until
 * `timeoutMs` cooperatively interrupts it. Callers on the action/rollback
 * node path that want a hard-terminable, separate-heap boundary should go
 * through `evaluateActionSandboxed` instead (see SandboxEvaluator export).
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
  return runInVmSandbox(expression, context, options);
}

let actionSandboxPool:
  | import("./worker/ActionSandboxPool").ActionSandboxPool
  | undefined;
let actionSandboxConfig: ActionSandboxIsolationConfig | undefined;

export interface ActionSandboxIsolationConfig {
  minWorkers: number;
  maxWorkers: number;
  taskTimeoutMs: number;
  idleTimeoutMs: number;
}

/**
 * Enable worker-thread isolation for `evaluateActionSandboxed`. Call once at
 * startup (see bootstrap.ts); without it, `evaluateActionSandboxed` falls
 * back to the in-process `vm` path transparently.
 */
export function configureActionSandboxIsolation(
  config: ActionSandboxIsolationConfig,
): void {
  actionSandboxConfig = config;
}

/**
 * Tear down the worker pool started by `configureActionSandboxIsolation`, if
 * any. Safe to call even when isolation was never enabled.
 */
export async function shutdownActionSandboxIsolation(): Promise<void> {
  if (actionSandboxPool) {
    await actionSandboxPool.shutdown();
    actionSandboxPool = undefined;
  }
  actionSandboxConfig = undefined;
}

/**
 * Evaluate an action/rollback node's string body. When worker-thread
 * isolation is configured (`configureActionSandboxIsolation`), this runs the
 * expression in a dedicated worker thread — a real separate V8 isolate and
 * heap, hard-terminated if it exceeds its timeout — instead of the
 * in-process `vm` context that `evaluateSandboxed`/`evaluateConditionSandboxed`
 * use. Falls back to the in-process path when isolation isn't configured, so
 * this is a drop-in upgrade with no required config change.
 */
export async function evaluateActionSandboxed(
  expression: string,
  context: Record<string, unknown> = {},
  options: SandboxOptions = {},
): Promise<unknown> {
  if (!actionSandboxConfig) {
    // Preserve the historic action-string budget when worker isolation is not
    // enabled. Expression evaluation still retains its shorter 100ms default.
    return runInVmSandbox(expression, context, {
      ...options,
      timeoutMs: options.timeoutMs ?? 5_000,
    });
  }

  if (!actionSandboxPool) {
    const { ActionSandboxPool } = await import("./worker/ActionSandboxPool");
    actionSandboxPool = new ActionSandboxPool({
      minWorkers: actionSandboxConfig.minWorkers,
      maxWorkers: actionSandboxConfig.maxWorkers,
      taskTimeoutMs: options.timeoutMs ?? actionSandboxConfig.taskTimeoutMs,
      idleTimeoutMs: actionSandboxConfig.idleTimeoutMs,
    });
  }

  return actionSandboxPool.evaluate(expression, cloneForSandbox(context));
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
