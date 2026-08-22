// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrap } from "../../bootstrap";
import type { WorkflowDefinition } from "../../model/Workflow";
import { searchAttributeManager } from "../SearchAttributeManager";
import type { WorkflowEngineV2 } from "../WorkflowEngineV2";

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe("Continue-As-New + Search Attributes wiring (integration)", () => {
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

  it("starts a real new instance carrying input and search attributes on continue-as-new", async () => {
    const source: WorkflowDefinition = {
      id: "cont-src",
      name: "cont-src",
      startNode: "step",
      nodes: {
        step: {
          id: "step",
          type: "action",
          action: async (instance: any) => {
            engine.continueAsNew(instance.instanceId, {
              workflowId: "cont-dest",
              input: { carried: true },
              searchAttributes: { tenant: "acme" },
            });
            return { done: true };
          },
          next: [],
        },
      },
    };
    const dest: WorkflowDefinition = {
      id: "cont-dest",
      name: "cont-dest",
      startNode: "step",
      nodes: {
        step: {
          id: "step",
          type: "action",
          action: async () => ({}),
          next: [],
        },
      },
    };

    await engine.register(source);
    await engine.register(dest);

    const sourceId = await engine.start("cont-src", {});
    await wait(200);

    // Old instance finished.
    expect(engine.getInstance(sourceId)?.status).toBe("completed");

    // A brand-new dest instance was actually started — discoverable via search.
    const destIds = searchAttributeManager.query({ workflowId: "cont-dest" });
    expect(destIds.length).toBe(1);

    const destInstance = engine.getInstance(destIds[0]);
    expect(destInstance).toBeDefined();
    expect(destInstance?.continuedFromInstanceId).toBe(sourceId);
    expect(destInstance?.context.carried).toBe(true);
    expect(destInstance?.searchAttributes?.tenant).toBe("acme");
  });

  it("indexes search attributes and filters by status", async () => {
    const wf: WorkflowDefinition = {
      id: "search-wf",
      name: "search-wf",
      startNode: "step",
      nodes: {
        step: {
          id: "step",
          type: "action",
          action: async () => ({}),
          next: [],
        },
      },
    };
    await engine.register(wf);

    const id = await engine.start(
      "search-wf",
      {},
      { searchAttributes: { region: "us", priority: 5 } },
    );
    await wait(150);

    // Attribute filter.
    expect(
      searchAttributeManager.query({ attributes: { region: "us" } }),
    ).toContain(id);

    // Status filter reflects the completed instance.
    const completed = searchAttributeManager.query({ status: ["completed"] });
    expect(completed).toContain(id);
    expect(searchAttributeManager.query({ status: ["running"] })).not.toContain(
      id,
    );
  });
});
