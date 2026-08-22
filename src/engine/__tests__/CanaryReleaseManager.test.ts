import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../storage/MemoryStorage";
import { CanaryReleaseManager } from "../CanaryReleaseManager";

describe("CanaryReleaseManager", () => {
  it("starts, promotes, rolls back, and evaluates canary releases", async () => {
    const storage = new MemoryStorage();
    await storage.connect();
    await storage.saveWorkflowWithMetadata({
      id: "wf-canary",
      name: "wf-canary",
      definition: {
        id: "wf-canary",
        name: "wf-canary",
        startNode: "start",
        nodes: { start: { id: "start", type: "action" } },
      },
      version: 2,
      publishedVersion: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const engine = {
      setActiveWorkflowVersion: vi.fn(),
      setReleasePolicy: vi.fn(),
    };
    const manager = new CanaryReleaseManager(storage, engine);

    await manager.startCanaryRelease("wf-canary", 2, 100, {
      autoPromote: true,
      minInstances: 1,
      evaluationWindowMs: 0,
      maxErrorRate: 0.2,
    });
    const started = await manager.getCanaryStatus("wf-canary");
    expect(started.canaryVersion).toBe(2);
    expect(started.canaryPercent).toBe(100);

    await storage.saveInstance({
      instanceId: "inst-1",
      workflowId: "wf-canary",
      workflowVersion: "2",
      currentNodes: [],
      status: "completed",
      context: {},
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const evaluation = await manager.evaluatePromotion("wf-canary");
    expect(evaluation.shouldPromote).toBe(true);

    const promoted = await storage.loadWorkflowWithMetadata("wf-canary");
    expect(promoted?.publishedVersion).toBe(2);
    expect(promoted?.canaryVersion).toBeUndefined();

    await manager.startCanaryRelease("wf-canary", 2, 50, {
      autoPromote: false,
    });
    await manager.rollbackCanary("wf-canary");
    const rolledBack = await storage.loadWorkflowWithMetadata("wf-canary");
    expect(rolledBack?.canaryVersion).toBeUndefined();
  });
});
