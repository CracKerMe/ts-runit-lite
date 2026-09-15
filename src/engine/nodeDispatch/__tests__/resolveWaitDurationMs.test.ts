import { describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../../model/Instance";
import type { TaskNode } from "../../../model/Workflow";
import { resolveWaitDurationMs } from "../helpers";

function makeWaitNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "wait-node",
    type: "wait",
    ...overrides,
  };
}

function makeInstance(): WorkflowInstance {
  return {
    instanceId: "inst-1",
    workflowId: "wf-1",
    status: "running",
    currentNodes: ["wait-node"],
    context: {},
    logs: [],
  } as unknown as WorkflowInstance;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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

  it("pins no deadline when called without an instance", () => {
    const node = makeWaitNode({ config: { durationMs: 1000 } });
    expect(resolveWaitDurationMs(node)).toBe(1000);
  });

  describe("durable deadline pinning", () => {
    it("pins an absolute deadline into instance state on first entry", () => {
      const node = makeWaitNode({ config: { durationMs: 5000 } });
      const instance = makeInstance();

      const waitMs = resolveWaitDurationMs(node, instance)!;

      expect(waitMs).toBeGreaterThan(4000);
      expect(waitMs).toBeLessThanOrEqual(5000);

      const pinned = instance.state?.nodes?.["wait-node"]?.deadline;
      expect(pinned).toBeTypeOf("number");
      expect(pinned! - Date.now()).toBeLessThanOrEqual(5000);
    });

    it("waits only the REMAINING time when re-entered after a restart", () => {
      // A 7-day wait that was entered 6 days ago: recovery must wait ~1 more
      // day, not another full 7. This is the regression that made long waits
      // unusable across restarts.
      const node = makeWaitNode({ config: { durationMs: 7 * DAY_MS } });
      const instance = makeInstance();
      instance.state = {
        nodes: { "wait-node": { deadline: Date.now() + DAY_MS } },
      };

      const waitMs = resolveWaitDurationMs(node, instance)!;

      expect(waitMs).toBeGreaterThan(DAY_MS - 5000);
      expect(waitMs).toBeLessThanOrEqual(DAY_MS);
    });

    it("fires immediately when the pinned deadline expired while down", () => {
      const node = makeWaitNode({ config: { durationMs: 7 * DAY_MS } });
      const instance = makeInstance();
      instance.state = {
        nodes: { "wait-node": { deadline: Date.now() - DAY_MS } },
      };

      expect(resolveWaitDurationMs(node, instance)).toBe(0);
    });

    it("preserves an existing node output when pinning the deadline", () => {
      const node = makeWaitNode({ config: { durationMs: 5000 } });
      const instance = makeInstance();
      instance.state = { nodes: { "wait-node": { output: { prior: true } } } };

      resolveWaitDurationMs(node, instance);

      expect(instance.state?.nodes?.["wait-node"]?.output).toEqual({
        prior: true,
      });
      expect(instance.state?.nodes?.["wait-node"]?.deadline).toBeTypeOf(
        "number",
      );
    });

    it("restarts the clock each entry when durable is false", () => {
      const node = makeWaitNode({
        config: { durationMs: 7 * DAY_MS, durable: false },
      });
      const instance = makeInstance();
      const stalePin = Date.now() + DAY_MS;
      instance.state = { nodes: { "wait-node": { deadline: stalePin } } };

      // Opted out: the stale pin is ignored and the full duration applies.
      const waitMs = resolveWaitDurationMs(node, instance)!;

      expect(waitMs).toBeGreaterThan(7 * DAY_MS - 5000);
      // durable:false never writes a pin, so the stale one is left untouched.
      expect(instance.state?.nodes?.["wait-node"]?.deadline).toBe(stalePin);
    });

    it("pins legacy node.timeout waits too", () => {
      const node = makeWaitNode({ timeout: 3000 });
      const instance = makeInstance();

      resolveWaitDurationMs(node, instance);

      expect(instance.state?.nodes?.["wait-node"]?.deadline).toBeTypeOf(
        "number",
      );
    });

    it("pins nothing when the node has no timing config", () => {
      const node = makeWaitNode();
      const instance = makeInstance();

      expect(resolveWaitDurationMs(node, instance)).toBeUndefined();
      expect(instance.state?.nodes?.["wait-node"]).toBeUndefined();
    });
  });
});
