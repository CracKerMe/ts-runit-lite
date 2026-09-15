/**
 * Demonstrates catching the named error classes exported for the most
 * common failure modes — missing workflow, missing instance, and CAS
 * concurrency conflicts — instead of matching `Error.message` strings.
 */
import {
  bootstrap,
  destroyContainer,
  InstanceNotFoundError,
  WorkflowNotFoundError,
  type WorkflowDefinition,
} from "../src/index";

async function main(): Promise<void> {
  const workflow: WorkflowDefinition = {
    id: "error-handling-demo",
    name: "Error handling demo",
    startNode: "step",
    nodes: {
      step: {
        id: "step",
        type: "action",
        action: async () => ({ done: true }),
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

    // 1. WorkflowNotFoundError — starting a workflow id that was never registered.
    try {
      await engine.start("does-not-exist", {});
    } catch (error: unknown) {
      if (error instanceof WorkflowNotFoundError) {
        console.log(
          `Caught WorkflowNotFoundError for "${error.workflowId}" as expected`,
        );
      } else {
        throw error;
      }
    }

    // 2. InstanceNotFoundError — querying/signaling an instance id that
    //    doesn't exist (typo, already-archived, or from a different STORAGE_DIR).
    try {
      await engine.query("no-such-instance-id", "status");
    } catch (error: unknown) {
      if (error instanceof InstanceNotFoundError) {
        console.log(
          `Caught InstanceNotFoundError for "${error.instanceId}" as expected`,
        );
      } else {
        throw error;
      }
    }

    // 3. Normal path still works.
    const instanceId = await engine.start(workflow.id, {});
    const instance = await engine.waitForCompletion(instanceId);
    console.log("completed instance status:", instance.status);
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
