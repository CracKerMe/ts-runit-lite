import type { Context, Span } from "./index";

export interface RegisteredWorkflowSpan {
  span: Span;
  context: Context;
}

const workflowSpans = new Map<string, RegisteredWorkflowSpan>();

export function registerWorkflowSpan(
  instanceId: string,
  span: Span,
  context: Context,
): void {
  workflowSpans.set(instanceId, { span, context });
}

export function getWorkflowSpan(
  instanceId: string,
): RegisteredWorkflowSpan | undefined {
  return workflowSpans.get(instanceId);
}

export function unregisterWorkflowSpan(instanceId: string): void {
  workflowSpans.delete(instanceId);
}

export function clearWorkflowSpansForTest(): void {
  workflowSpans.clear();
}
