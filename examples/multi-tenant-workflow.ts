/**
 * 多租户 SaaS 工作流示例
 *
 * 场景：SaaS 平台按租户隔离工作流。每个租户有独立的工作流定义，
 * 通过条件路由决定走哪条业务线，租户数据互不干扰。
 *
 * 运行：pnpm example:multi-tenant
 */

import {
  bootstrap,
  destroyContainer,
  type WorkflowDefinition,
} from "../src/index";

// ── 租户 A：标准订单流程 ─────────────────────────────────────────────────
const tenantAWorkflow: WorkflowDefinition = {
  id: "tenant-a-order",
  name: "Tenant A — Standard order flow",
  startNode: "validate",
  nodes: {
    validate: {
      id: "validate",
      type: "action",
      action: async (instance) => {
        const amount = (instance.context as Record<string, unknown>)
          ?.amount as number;
        return { valid: amount > 0, amount };
      },
      next: ["process"],
    },
    process: {
      id: "process",
      type: "action",
      action: async (instance) => {
        const amount = (
          instance.state?.nodes?.validate?.output as Record<string, unknown>
        )?.amount as number;
        return { tenant: "A", charged: amount * 1.1, strategy: "standard" };
      },
      next: [],
    },
  },
};

// ── 租户 B：企业折扣流程 ─────────────────────────────────────────────────
const tenantBWorkflow: WorkflowDefinition = {
  id: "tenant-b-order",
  name: "Tenant B — Enterprise order flow",
  startNode: "validate",
  nodes: {
    validate: {
      id: "validate",
      type: "action",
      action: async (instance) => {
        const amount = (instance.context as Record<string, unknown>)
          ?.amount as number;
        const discount = (instance.context as Record<string, unknown>)
          ?.discount as number;
        return { valid: amount > 0, amount, discount: discount ?? 0.2 };
      },
      next: ["process"],
    },
    process: {
      id: "process",
      type: "action",
      action: async (instance) => {
        const output = instance.state?.nodes?.validate?.output as Record<
          string,
          unknown
        >;
        return {
          tenant: "B",
          charged:
            (output.amount as number) * (1 - (output.discount as number)),
          strategy: "enterprise",
        };
      },
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
    // 注册租户工作流
    await engine.register(tenantAWorkflow);
    await engine.register(tenantBWorkflow);

    // 租户 A 下单
    const idA = await engine.start("tenant-a-order", {
      amount: 100,
      tenantId: "tenant-a",
    });
    const resultA = await engine.waitForCompletion(idA);
    console.log("Tenant A result:", resultA.state?.nodes?.process?.output);

    // 租户 B 下单
    const idB = await engine.start("tenant-b-order", {
      amount: 100,
      discount: 0.3,
      tenantId: "tenant-b",
    });
    const resultB = await engine.waitForCompletion(idB);
    console.log("Tenant B result:", resultB.state?.nodes?.process?.output);
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
