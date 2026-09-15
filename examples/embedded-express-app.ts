/**
 * Demonstrates mounting the workflow API as a router inside a host
 * application's own Express app, instead of running the standalone server
 * from `startApiServer`. See the "Mounting into an existing Express app"
 * section of the README for details on what this router does and doesn't
 * include (no helmet/CORS/auth/rate-limit — add your own upstream).
 */
import express from "express";
import {
  bootstrap,
  createWorkflowRouter,
  destroyContainer,
  type WorkflowDefinition,
} from "../src/index";

async function main(): Promise<void> {
  const workflow: WorkflowDefinition = {
    id: "hello-router",
    name: "Hello via mounted router",
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
  await engine.register(workflow);

  // This is the host application's own Express app — the workflow engine
  // does not own the port, body parser, or any other middleware here.
  const app = express();
  app.use(express.json());
  app.use(
    "/workflow-api/v1",
    await createWorkflowRouter(engine, container.storage),
  );

  const server = app.listen(0, async () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}/workflow-api/v1`;

    const startRes = await fetch(`${base}/workflows/${workflow.id}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: { name: "Ada" } }),
    });
    const startBody = (await startRes.json()) as {
      data?: { instanceId?: string };
    };
    console.log("start response:", startBody);

    const instanceId = startBody.data?.instanceId;
    if (instanceId) {
      const instance = await engine.waitForCompletion(instanceId);
      console.log("final output:", instance.state?.nodes?.greet?.output);
    }

    server.close(async () => {
      engine.destroy();
      await destroyContainer(container);
    });
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
