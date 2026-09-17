/**
 * LLM 调用 + 人工审批 + 超时降级示例
 *
 * 场景：LLM 起草一条客户回复，人工审批后发送；如果审批超时，
 * 走降级路径（发送一条保守的预设回复）而不是让流程卡死。
 *
 * `call-llm` 用一个可替换的 action 模拟 LLM 调用（不发起真实网络请求），
 * 接入真实模型时替换该节点的 `action` 或改成 `http` 节点调用你的 LLM API 网关。
 *
 * `approval` 节点通过事件总线解决：等待事件名
 * `workflow.approval.<instanceId>.<nodeId>`，payload 里 `approved: true` 走
 * `approvedTarget`，`approved: false` 走 `rejectedTarget`；超时则按标准的
 * `failureNext` 失败路径处理（不会自动走 `rejectedTarget`）。
 *
 * 运行：pnpm example llm-approval-workflow
 */

import {
  bootstrap,
  destroyContainer,
  type WorkflowDefinition,
} from "../src/index";

async function callLlm(prompt: string): Promise<string> {
  // 用你自己的 SDK / HTTP 调用替换这里；示例里返回一个固定草稿以保持可离线运行。
  return `Draft reply to: "${prompt}"`;
}

const llmApprovalWorkflow: WorkflowDefinition = {
  id: "llm-approval-workflow",
  name: "LLM draft with human approval and timeout fallback",
  startNode: "call-llm",
  nodes: {
    "call-llm": {
      id: "call-llm",
      type: "action",
      maxRetries: 2,
      action: async (instance) => ({
        draft: await callLlm(
          (instance.context as Record<string, unknown>)?.prompt as string,
        ),
      }),
      failureNext: ["fallback-reply"],
      next: ["human-approval"],
    },
    "human-approval": {
      id: "human-approval",
      type: "approval",
      config: {
        prompt: "Approve this LLM-drafted reply: ${call-llm.output.draft}",
        timeoutMs: 5000,
        approvedTarget: "send-reply",
        rejectedTarget: "fallback-reply",
      },
      // A timed-out approval fails the node rather than following
      // rejectedTarget, so the degradation path is wired through
      // failureNext, same as any other node's failure recovery.
      failureNext: ["fallback-reply"],
    },
    "send-reply": {
      id: "send-reply",
      type: "action",
      action: async (instance) => ({
        sent: true,
        draft: instance.state?.nodes?.["call-llm"]?.output,
      }),
      next: [],
    },
    "fallback-reply": {
      id: "fallback-reply",
      type: "action",
      action: async () => ({
        sent: true,
        degraded: true,
        reply:
          "Thanks for reaching out — a team member will follow up shortly.",
      }),
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
    await engine.register(llmApprovalWorkflow);

    // Run 1: reviewer approves in time.
    const approvedId = await engine.start("llm-approval-workflow", {
      prompt: "How do I reset my password?",
    });
    // The LLM call runs asynchronously after start() returns, so the
    // approval node isn't listening for its event yet. Re-emit for a short
    // window — emitting to a not-yet-registered listener is a harmless
    // no-op — until the approval node picks it up.
    const approveInterval = setInterval(() => {
      container.eventBus.emit(
        `workflow.approval.${approvedId}.human-approval`,
        {
          instanceId: approvedId,
          approved: true,
          approver: "reviewer@example.com",
        },
      );
    }, 20);
    const approvedResult = await engine.waitForCompletion(approvedId, {
      timeoutMs: 10_000,
    });
    clearInterval(approveInterval);
    console.log("Approved run status:", approvedResult.status);
    console.log(
      "Approved run outcome:",
      approvedResult.state?.nodes?.["send-reply"]?.output,
    );

    // Run 2: no one reviews in time — the approval node's timeoutMs (5s)
    // elapses, failureNext routes to the degraded fallback reply.
    const timedOutId = await engine.start("llm-approval-workflow", {
      prompt: "What's your refund policy?",
    });
    const timedOutResult = await engine.waitForCompletion(timedOutId, {
      timeoutMs: 10_000,
    });
    console.log("Timed-out run status:", timedOutResult.status);
    console.log(
      "Timed-out run outcome:",
      timedOutResult.state?.nodes?.["fallback-reply"]?.output,
    );
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
