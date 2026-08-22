import {
  bootstrap,
  destroyContainer,
  type WorkflowDefinition,
} from "../src/index";

async function main(): Promise<void> {
  const workflow: WorkflowDefinition = {
    id: "hello",
    name: "Hello workflow",
    startNode: "greet",
    nodes: {
      greet: {
        id: "greet",
        type: "action",
        action: async (instance) => ({
          message: `Hello, ${instance?.context?.name ?? "world"}!`,
        }),
        next: [],
      },
    },
  };

  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
    logLevel: "WARN",
  });

  try {
    await engine.register(workflow);
    const instanceId = await engine.start(workflow.id, { name: "Ada" });
    const instance = await engine.waitForCompletion(instanceId);
    console.log(instance.state?.nodes?.greet?.output);
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
