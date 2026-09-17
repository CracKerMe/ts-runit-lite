import { randomUUID } from "node:crypto";
import { evaluateConditionSandboxed } from "../engine/SandboxEvaluator";

export interface Breakpoint {
  id: string;
  instanceId: string;
  nodeId: string;
  condition?: string;
  hitCount: number;
  enabled: boolean;
}

export class BreakpointTracker {
  private readonly breakpoints = new Map<string, Breakpoint>();

  add(instanceId: string, nodeId: string, condition?: string): Breakpoint {
    const breakpoint: Breakpoint = {
      id: `bp-${randomUUID()}`,
      instanceId,
      nodeId,
      condition,
      hitCount: 0,
      enabled: true,
    };

    this.breakpoints.set(breakpoint.id, breakpoint);
    return breakpoint;
  }

  remove(id: string): boolean {
    return this.breakpoints.delete(id);
  }

  toggle(id: string, enabled?: boolean): Breakpoint | undefined {
    const breakpoint = this.breakpoints.get(id);
    if (!breakpoint) {
      return undefined;
    }

    breakpoint.enabled = enabled ?? !breakpoint.enabled;
    return breakpoint;
  }

  shouldBreak(
    instanceId: string,
    nodeId: string,
    context: Record<string, unknown> = {},
  ): Breakpoint | null {
    for (const breakpoint of this.breakpoints.values()) {
      if (
        !breakpoint.enabled ||
        breakpoint.instanceId !== instanceId ||
        breakpoint.nodeId !== nodeId
      ) {
        continue;
      }

      if (
        breakpoint.condition &&
        !this.evaluateCondition(breakpoint, context)
      ) {
        continue;
      }

      breakpoint.hitCount += 1;
      return breakpoint;
    }

    return null;
  }

  list(instanceId?: string): Breakpoint[] {
    const breakpoints = Array.from(this.breakpoints.values());
    return instanceId
      ? breakpoints.filter((breakpoint) => breakpoint.instanceId === instanceId)
      : breakpoints;
  }

  private evaluateCondition(
    breakpoint: Breakpoint,
    context: Record<string, unknown>,
  ): boolean {
    if (!breakpoint.condition) return true;
    // Pass context both as a named variable (backward compatible with
    // conditions like "context.amount > 100") and spread into scope
    // (for conditions like "amount > 100").
    return evaluateConditionSandboxed(breakpoint.condition, {
      ...context,
      context,
    });
  }
}
