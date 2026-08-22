/**
 * Minimal no-op tracing shim.
 *
 * This fork drops the OpenTelemetry SDK/exporters entirely (no
 * @opentelemetry/* dependency), but the core engine's execution path still
 * calls into a small span-shaped API to time and annotate workflow/node
 * execution. Keeping that call surface — as inert no-ops — avoids threading
 * conditional tracing logic through the engine's control flow, while
 * guaranteeing nothing here ever talks to a collector.
 */
import { Logger } from "../utils/Logger";

export enum SpanStatusCode {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
}

export enum SpanKind {
  INTERNAL = 0,
  SERVER = 1,
  CLIENT = 2,
  PRODUCER = 3,
  CONSUMER = 4,
}

export interface Span {
  setAttributes(attrs: Record<string, unknown>): Span;
  setStatus(status: { code: SpanStatusCode; message?: string }): Span;
  recordException(error: Error): void;
  end(): void;
  spanContext(): { traceId: string; spanId: string };
}

export interface Context {
  with<T>(fn: () => T): T;
}

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, unknown>;
}

export interface StartedSpan {
  span: Span;
  context: Context;
}

const NOOP_TRACE_ID = "0".repeat(32);
const NOOP_SPAN_ID = "0".repeat(16);

function createNoopSpan(): Span {
  const span: Span = {
    setAttributes: () => span,
    setStatus: () => span,
    recordException: () => {},
    end: () => {},
    spanContext: () => ({ traceId: NOOP_TRACE_ID, spanId: NOOP_SPAN_ID }),
  };
  return span;
}

function createNoopContext(): Context {
  return {
    with<T>(fn: () => T): T {
      return fn();
    },
  };
}

/**
 * Always disabled in this fork — tracing has no configurable backend.
 */
export async function initTelemetry(): Promise<boolean> {
  return false;
}

export async function shutdownTelemetry(): Promise<void> {
  Logger.debug("system", "telemetry", "No-op telemetry shutdown");
}

export function startSpan(
  _name: string,
  _attrs: Record<string, string | number | boolean | undefined> = {},
  parent?: Context,
  _options: SpanOptions = {},
): StartedSpan {
  return {
    span: createNoopSpan(),
    context: parent ?? createNoopContext(),
  };
}

export function startServerSpan(
  name: string,
  attrs: Record<string, string | number | boolean | undefined> = {},
): StartedSpan {
  return startSpan(name, attrs, undefined, { kind: SpanKind.SERVER });
}

export function otelTraceId(_span: Span): string | undefined {
  return undefined;
}

export function recordSpanError(span: Span, error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  span.recordException(err);
  span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
}

export function getTracer() {
  return {
    startSpan: () => createNoopSpan(),
  };
}

export const context = {
  active: (): Context => createNoopContext(),
  with<T>(ctx: Context, fn: () => T): T {
    return ctx.with(fn);
  },
};

export const trace = {
  getActiveSpan: (): Span | undefined => undefined,
  setSpan: (ctx: Context, _span: Span): Context => ctx,
};
