import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrap } from "../../bootstrap";
import type { WorkflowDefinition } from "../../model/Workflow";
import type { WorkflowEngineV2 } from "../WorkflowEngineV2";

describe("New node types: join / transform / wait (config)", () => {
  let engine: WorkflowEngineV2;
  let ctx: Awaited<ReturnType<typeof bootstrap>>;

  beforeEach(async () => {
    ctx = await bootstrap({ skipValidation: true, skipGracefulShutdown: true });
    engine = ctx.engine;
  });

  afterEach(() => {
    engine.destroy();
    ctx.container.scheduler.stopAll();
  });

  describe("join", () => {
    it("should wait for all fan-out branches before proceeding", async () => {
      const workflow: WorkflowDefinition = {
        id: "wf-join-basic",
        name: "wf-join-basic",
        startNode: "fanout",
        nodes: {
          fanout: {
            id: "fanout",
            type: "action",
            action: async () => ({ started: true }),
            next: ["branchA", "branchB"],
          },
          branchA: {
            id: "branchA",
            type: "action",
            action: async () => ({ value: "a" }),
            next: ["joinNode"],
          },
          branchB: {
            id: "branchB",
            type: "action",
            action: async () => ({ value: "b" }),
            next: ["joinNode"],
          },
          joinNode: {
            id: "joinNode",
            type: "join",
            config: { waitFor: ["branchA", "branchB"] },
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const id = await engine.start("wf-join-basic", {});
      const instance = await engine.waitForCompletion(id);

      expect(instance?.status).toBe("completed");
      const joinOutput = instance?.state?.nodes?.joinNode?.output as {
        results: Record<string, unknown>;
        missing: string[];
      };
      expect(joinOutput.missing).toEqual([]);
      expect(joinOutput.results.branchA).toEqual({ value: "a" });
      expect(joinOutput.results.branchB).toEqual({ value: "b" });
    });

    it("should fail the node when a required branch is missing (mode: all)", async () => {
      const workflow: WorkflowDefinition = {
        id: "wf-join-missing",
        name: "wf-join-missing",
        startNode: "branchA",
        nodes: {
          branchA: {
            id: "branchA",
            type: "action",
            action: async () => ({ value: "a" }),
            next: ["joinNode"],
          },
          joinNode: {
            id: "joinNode",
            type: "join",
            // References a node that never runs in this workflow.
            config: { waitFor: ["branchA", "branchNeverRuns"] },
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const id = await engine.start("wf-join-missing", {});
      const instance = await engine.waitForCompletion(id, {
        timeoutMs: 5000,
      });

      expect(instance?.status).toBe("failed");
    });
  });

  describe("transform", () => {
    it("should compute typed output fields from prior node outputs", async () => {
      const workflow: WorkflowDefinition = {
        id: "wf-transform-basic",
        name: "wf-transform-basic",
        startNode: "priceNode",
        nodes: {
          priceNode: {
            id: "priceNode",
            type: "action",
            action: async () => ({ price: 50, qty: 4 }),
            next: ["reshape"],
          },
          reshape: {
            id: "reshape",
            type: "transform",
            config: {
              output: {
                total: "${priceNode.output.price * priceNode.output.qty}",
                label: "'order total'",
              },
            },
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const id = await engine.start("wf-transform-basic", {});
      const instance = await engine.waitForCompletion(id);

      expect(instance?.status).toBe("completed");
      expect(instance?.state?.nodes?.reshape?.output).toEqual({
        total: 200,
        label: "order total",
      });
    });
  });

  describe("wait (config.durationMs / config.until)", () => {
    it("should support config.durationMs as an alternative to node.timeout", async () => {
      const workflow: WorkflowDefinition = {
        id: "wf-wait-duration",
        name: "wf-wait-duration",
        startNode: "waitNode",
        nodes: {
          waitNode: {
            id: "waitNode",
            type: "wait",
            config: { durationMs: 20 },
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const id = await engine.start("wf-wait-duration", {});
      const instance = await engine.waitForCompletion(id, { timeoutMs: 5000 });

      expect(instance?.status).toBe("completed");
      const output = instance?.state?.nodes?.waitNode?.output as {
        waited: number;
        deadline: number;
      };
      expect(output.waited).toBe(20);
      expect(typeof output.deadline).toBe("number");
    });

    it("should support config.until as an absolute deadline", async () => {
      const until = new Date(Date.now() + 20).toISOString();
      const workflow: WorkflowDefinition = {
        id: "wf-wait-until",
        name: "wf-wait-until",
        startNode: "waitNode",
        nodes: {
          waitNode: {
            id: "waitNode",
            type: "wait",
            config: { until },
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const id = await engine.start("wf-wait-until", {});
      const instance = await engine.waitForCompletion(id, { timeoutMs: 5000 });

      expect(instance?.status).toBe("completed");
    });
  });
});
