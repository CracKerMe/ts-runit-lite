/**
 * 长时运行审批流示例
 *
 * 场景：采购审批流程，金额 > 1000 需要经理审批。
 * 展示 approval 节点、event 触发、超时处理。
 *
 * 运行：pnpm example:approval
 */

import {
  bootstrap,
  destroyContainer,
  type WorkflowDefinition,
} from "../src/index";

const approvalWorkflow: WorkflowDefinition = {
  id: "approval-pipeline",
  name: "Purchase approval pipeline",
  startNode: "check-amount",
  nodes: {
    "check-amount": {
      id: "check-amount",
      type: "condition",
      config: {
        condition: "${instance.context.amount > 1000}",
        trueBranch: "manager-approval",
        falseBranch: "auto-approve",
      },
    },
    "manager-approval": {
      id: "manager-approval",
      type: "approval",
      config: {
        prompt: "Approve purchase of ${instance.context.amount}?",
        timeoutMs: 30000,
        approvedTarget: "fulfill",
        rejectedTarget: "reject",
      },
    },
    "auto-approve": {
      id: "auto-approve",
      type: "action",
      action: async () => ({ approved: true, auto: true }),
      next: ["fulfill"],
    },
    fulfill: {
      id: "fulfill",
      type: "action",
      action: async (instance) => ({
        status: "fulfilled",
        amount: (instance.context as Record<string, unknown>)?.amount,
      }),
      next: [],
    },
    reject: {
      id: "reject",
      type: "action",
      action: async () => ({ status: "rejected", reason: "Denied by manager" }),
      next: [],
    },
  },
};

async function main(): Promise<void> {
  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
    logLevel: "WARN",
  });

  try {
    await engine.register(approvalWorkflow);

    // Low amount — auto-approved
    const id1 = await engine.start("approval-pipeline", { amount: 500 });
    const result1 = await engine.waitForCompletion(id1);
    console.log("Low amount result:", result1.state?.nodes?.fulfill?.output);
    console.log("Status:", result1.status);
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
