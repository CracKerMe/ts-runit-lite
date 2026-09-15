import { describe, expect, it } from "vitest";
import type { TaskNode } from "../../../model/Workflow";
import { resolveWaitDurationMs } from "../helpers";

function makeWaitNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "wait-node",
    type: "wait",
    ...overrides,
  };
}

describe("resolveWaitDurationMs", () => {
  it("returns undefined when no timing config is present", () => {
    expect(resolveWaitDurationMs(makeWaitNode())).toBeUndefined();
  });

  it("falls back to legacy node.timeout when config is absent", () => {
    expect(resolveWaitDurationMs(makeWaitNode({ timeout: 1500 }))).toBe(1500);
  });

  it("prefers config.durationMs over node.timeout", () => {
    const node = makeWaitNode({
      timeout: 1500,
      config: { durationMs: 200 },
    });
    expect(resolveWaitDurationMs(node)).toBe(200);
  });

  it("prefers config.until over config.durationMs and node.timeout", () => {
    const until = new Date(Date.now() + 5000).toISOString();
    const node = makeWaitNode({
      timeout: 1500,
      config: { durationMs: 200, until },
    });
    const result = resolveWaitDurationMs(node)!;
    expect(result).toBeGreaterThan(4000);
    expect(result).toBeLessThanOrEqual(5000);
  });

  it("clamps a config.until in the past to 0", () => {
    const until = new Date(Date.now() - 5000).toISOString();
    const node = makeWaitNode({ config: { until } });
    expect(resolveWaitDurationMs(node)).toBe(0);
  });

  it("clamps a negative config.durationMs to 0", () => {
    const node = makeWaitNode({ config: { durationMs: -100 } });
    expect(resolveWaitDurationMs(node)).toBe(0);
  });

  it("throws on an invalid config.until date string", () => {
    const node = makeWaitNode({ config: { until: "not-a-date" } });
    expect(() => resolveWaitDurationMs(node)).toThrow(/not a valid date/);
  });
});
