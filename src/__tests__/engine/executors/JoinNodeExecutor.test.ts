import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../../model/Instance";
import {
  type JoinNodeConfig,
  JoinNodeExecutor,
} from "../../../engine/executors/JoinNodeExecutor";

describe("JoinNodeExecutor", () => {
  let mockInstance: WorkflowInstance;

  beforeEach(() => {
    mockInstance = {
      instanceId: "test-instance",
      workflowId: "test-workflow",
      currentNodes: [],
      status: "running",
      context: {},
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      state: {
        nodes: {
          "branch-a": { output: { value: "a-result" } },
          "branch-b": { output: { value: "b-result" } },
        },
      },
    };
  });

  it("should resolve when all waitFor branches have completed (mode: all, default)", async () => {
    const config: JoinNodeConfig = {
      waitFor: ["branch-a", "branch-b"],
    };

    const result = await JoinNodeExecutor.execute(config, mockInstance);

    expect(result.missing).toEqual([]);
    expect(result.results).toEqual({
      "branch-a": { value: "a-result" },
      "branch-b": { value: "b-result" },
    });
  });

  it("should throw in mode 'all' when a branch has not produced output", async () => {
    const config: JoinNodeConfig = {
      waitFor: ["branch-a", "branch-c"],
      mode: "all",
    };

    await expect(
      JoinNodeExecutor.execute(config, mockInstance),
    ).rejects.toThrow(/missing output from: branch-c/);
  });

  it("should resolve in mode 'any' as soon as one branch has completed", async () => {
    const config: JoinNodeConfig = {
      waitFor: ["branch-a", "branch-missing"],
      mode: "any",
    };

    const result = await JoinNodeExecutor.execute(config, mockInstance);

    expect(result.results).toEqual({ "branch-a": { value: "a-result" } });
    expect(result.missing).toEqual(["branch-missing"]);
  });

  it("should throw in mode 'any' when no branches have completed", async () => {
    const config: JoinNodeConfig = {
      waitFor: ["branch-x", "branch-y"],
      mode: "any",
    };

    await expect(
      JoinNodeExecutor.execute(config, mockInstance),
    ).rejects.toThrow(/no completed branches/);
  });

  it("should throw when waitFor is empty", async () => {
    await expect(
      JoinNodeExecutor.execute({ waitFor: [] }, mockInstance),
    ).rejects.toThrow("Join node requires a non-empty config.waitFor array");
  });

  it("should throw when waitFor is missing", async () => {
    await expect(
      JoinNodeExecutor.execute({} as JoinNodeConfig, mockInstance),
    ).rejects.toThrow("Join node requires a non-empty config.waitFor array");
  });
});
