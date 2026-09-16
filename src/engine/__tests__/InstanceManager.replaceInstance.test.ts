// oxlint-disable no-explicit-any -- 测试构造最小化的实例形状
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { InstanceManager } from "../InstanceManager";
import { searchAttributeManager } from "../SearchAttributeManager";

/**
 * replaceInstance 必须同步搜索索引。
 *
 * 控制操作此前直接 `getInstancesMap().set(...)` 写内部 Map，跳过了索引
 * 同步——实例状态改了，但按 status 检索到的仍是旧值。
 */
describe("InstanceManager.replaceInstance", () => {
  let manager: InstanceManager;

  const instance = (
    overrides: Partial<WorkflowInstance> & { instanceId: string },
  ): WorkflowInstance =>
    ({
      workflowId: "wf",
      currentNodes: [],
      status: "running",
      context: {},
      history: [],
      createdAt: new Date(1_700_000_000_000),
      updatedAt: new Date(1_700_000_000_000),
      ...overrides,
    }) as WorkflowInstance;

  beforeEach(() => {
    manager = new InstanceManager();
  });

  it("updates both the instance map and the search index", () => {
    const original = instance({
      instanceId: "inst-1",
      status: "running",
      searchAttributes: { region: "us-east" },
    });
    manager.replaceInstance(original);

    expect(searchAttributeManager.query({ status: ["running"] })).toContain(
      "inst-1",
    );

    // 状态变更后重新放回
    manager.replaceInstance({
      ...original,
      status: "paused",
    } as WorkflowInstance);

    expect(manager.getInstance("inst-1")?.status).toBe("paused");
    // 索引必须跟着走——这正是直接写 Map 会漏掉的部分
    expect(searchAttributeManager.query({ status: ["paused"] })).toContain(
      "inst-1",
    );
    expect(searchAttributeManager.query({ status: ["running"] })).not.toContain(
      "inst-1",
    );
  });

  it("reflects changed search attributes", () => {
    manager.replaceInstance(
      instance({
        instanceId: "inst-2",
        searchAttributes: { region: "us-east" },
      }),
    );
    manager.replaceInstance(
      instance({
        instanceId: "inst-2",
        searchAttributes: { region: "eu-west" },
      }),
    );

    expect(
      searchAttributeManager.query({ attributes: { region: "eu-west" } }),
    ).toContain("inst-2");
    expect(
      searchAttributeManager.query({ attributes: { region: "us-east" } }),
    ).not.toContain("inst-2");
  });
});
