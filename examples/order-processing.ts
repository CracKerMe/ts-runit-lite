import { bootstrap, destroyContainer } from "../src/index";
import { exampleWorkflow } from "../src/demo/exampleWorkflow";

async function main(): Promise<void> {
  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
  });

  try {
    await engine.register(exampleWorkflow);
    const instanceId = await engine.start(exampleWorkflow.id, {
      orderId: "ORD-DEMO-001",
      orderAmount: 500,
      email: "demo@example.com",
      items: ["商品A", "商品B"],
    });
    const instance = await engine.waitForCompletion(instanceId);
    console.log({ instanceId, status: instance.status, state: instance.state });
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
