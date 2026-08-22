import { beforeEach, describe, expect, it } from "vitest";
import { eventBus } from "../../../event/EventBus";
import { messageBus } from "../../../event/MessageBus";
import type { WorkflowInstance } from "../../../model/Instance";
import type { ApprovalNodeConfig } from "../../../model/Workflow";
import { ApprovalNodeExecutor } from "../ApprovalNodeExecutor";

function createInstance(instanceId = "inst-1"): WorkflowInstance {
  return {
    instanceId,
    workflowId: "test-workflow",
    currentNodes: [],
    status: "running",
    context: { orderId: "ORD-000001" },
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as WorkflowInstance;
}

describe("ApprovalNodeExecutor", () => {
  let instance: WorkflowInstance;

  beforeEach(() => {
    instance = createInstance();
  });

  it("should publish an approval request event with interpolated prompt", async () => {
    const received: unknown[] = [];
    eventBus.on("approval:requested", (data) => {
      received.push(data);
    });

    const config: ApprovalNodeConfig = {
      prompt: "请审批订单 ${orderId}",
      approvedTarget: "approved-node",
      rejectedTarget: "rejected-node",
    };

    const pending = ApprovalNodeExecutor.waitForApproval(
      config,
      instance,
      "approval-node",
    );

    // Event should be published synchronously before waiting
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      instanceId: "inst-1",
      nodeId: "approval-node",
      workflowId: "test-workflow",
      prompt: "请审批订单 ORD-000001",
    });

    await messageBus.sendSignal("inst-1", "approval_response", {
      approved: true,
    });
    const result = await pending;
    expect(result.approved).toBe(true);
  });

  it("should route to approvedTarget when approved", async () => {
    const config: ApprovalNodeConfig = {
      approvedTarget: "approved-node",
      rejectedTarget: "rejected-node",
    };

    const pending = ApprovalNodeExecutor.waitForApproval(
      config,
      instance,
      "approval-node",
    );
    await messageBus.sendSignal("inst-1", "approval_response", {
      approved: true,
      approver: "alice",
      comment: "LGTM",
    });

    const result = await pending;
    expect(result.approved).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.approver).toBe("alice");
    expect(result.comment).toBe("LGTM");
    expect(result.nextNode).toBe("approved-node");
  });

  it("should route to rejectedTarget when rejected", async () => {
    const config: ApprovalNodeConfig = {
      approvedTarget: "approved-node",
      rejectedTarget: "rejected-node",
    };

    const pending = ApprovalNodeExecutor.waitForApproval(
      config,
      instance,
      "approval-node",
    );
    await messageBus.sendSignal("inst-1", "approval_response", {
      approved: false,
      approver: "bob",
    });

    const result = await pending;
    expect(result.approved).toBe(false);
    expect(result.nextNode).toBe("rejected-node");
  });

  it("should ignore signals for other instances when requireInstanceIdMatch", async () => {
    const config: ApprovalNodeConfig = {
      approvedTarget: "approved-node",
      rejectedTarget: "rejected-node",
      requireInstanceIdMatch: true,
    };

    const pending = ApprovalNodeExecutor.waitForApproval(
      config,
      instance,
      "approval-node",
    );

    // Signal for a different instance must be ignored
    await messageBus.sendSignal("other-instance", "approval_response", {
      approved: true,
    });
    // Correct instance signal settles the approval
    await messageBus.sendSignal("inst-1", "approval_response", {
      approved: false,
    });

    const result = await pending;
    expect(result.approved).toBe(false);
    expect(result.nextNode).toBe("rejected-node");
  });

  it("should ignore signals targeting a different nodeId", async () => {
    const config: ApprovalNodeConfig = {
      approvedTarget: "approved-node",
      rejectedTarget: "rejected-node",
    };

    const pending = ApprovalNodeExecutor.waitForApproval(
      config,
      instance,
      "approval-node",
    );

    await messageBus.sendSignal("inst-1", "approval_response", {
      approved: true,
      nodeId: "some-other-node",
    });
    await messageBus.sendSignal("inst-1", "approval_response", {
      approved: true,
      nodeId: "approval-node",
    });

    const result = await pending;
    expect(result.approved).toBe(true);
  });

  it("should treat timeout as rejection and route to rejectedTarget", async () => {
    const config: ApprovalNodeConfig = {
      approvedTarget: "approved-node",
      rejectedTarget: "rejected-node",
      timeoutMs: 30,
    };

    const result = await ApprovalNodeExecutor.waitForApproval(
      config,
      instance,
      "approval-node",
    );

    expect(result.approved).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.nextNode).toBe("rejected-node");
  });

  it("should use custom eventType when configured", async () => {
    const received: unknown[] = [];
    eventBus.on("custom:approval", (data) => {
      received.push(data);
    });

    const config: ApprovalNodeConfig = {
      eventType: "custom:approval",
      approvedTarget: "approved-node",
      timeoutMs: 30,
    };

    await ApprovalNodeExecutor.waitForApproval(config, instance, "node-x");
    expect(received).toHaveLength(1);
  });

  it("should not leak signal handlers after settling", async () => {
    const config: ApprovalNodeConfig = {
      approvedTarget: "a",
      rejectedTarget: "r",
      timeoutMs: 20,
    };

    await ApprovalNodeExecutor.waitForApproval(config, instance, "n1");
    // After timeout the handler must be unregistered; a later signal is a no-op
    await expect(
      messageBus.sendSignal("inst-1", "approval_response", { approved: true }),
    ).resolves.toBeUndefined();
  });
});
