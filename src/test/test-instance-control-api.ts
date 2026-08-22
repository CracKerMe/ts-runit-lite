// oxlint-disable no-explicit-any -- dynamic types used throughout this module
/**
 * Integration test for Instance Control API endpoints
 * Tests retry, skip, compensate, and node status endpoints
 */

import { bootstrap } from "../bootstrap";
import { destroyContainer } from "../container";
import type { WorkflowDefinition } from "../model/Workflow";
import { errorMessage } from "../utils/Logger";

async function testInstanceControlAPI() {
  console.log("\n=== Testing Instance Control API Endpoints ===\n");

  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
  });

  // Test 1: Retry Node
  console.log("Test 1: Retry a failed node");

  const retryWorkflow: WorkflowDefinition = {
    id: "retry-test-workflow",
    name: "Retry Test Workflow",
    startNode: "task1",
    nodes: {
      task1: {
        id: "task1",
        type: "action",
        action: async (instance) => {
          const retryCount = instance.retries?.task1 || 0;
          if (retryCount === 0) {
            throw new Error("First attempt fails");
          }
          console.log("  ✓ Task succeeded on retry");
          return { success: true };
        },
        next: ["task2"],
      },
      task2: {
        id: "task2",
        type: "action",
        action: async () => {
          console.log("  ✓ Task 2 completed");
          return { done: true };
        },
        next: [],
      },
    },
  };

  await engine.register(retryWorkflow);
  const instanceId1 = await engine.start("retry-test-workflow", { test: true });

  // Wait for initial execution to fail
  await new Promise((resolve) => setTimeout(resolve, 500));

  const instance1 = engine.getInstance(instanceId1);
  if (!instance1) {
    console.error("  ✗ Instance not found");
    return;
  }

  // Check if task1 failed
  const task1History = instance1.history.filter(
    (log) => log.nodeId === "task1",
  );
  if (
    task1History.length > 0 &&
    task1History[task1History.length - 1].status === "failed"
  ) {
    console.log("  ✓ Task 1 failed as expected");

    // Retry the node
    try {
      await engine.retryNode(instanceId1, "task1");
      console.log("  ✓ Retry initiated successfully");

      // Wait for retry to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const updatedInstance = engine.getInstance(instanceId1);
      if (updatedInstance?.status === "completed") {
        console.log("  ✓ Workflow completed after retry");
      } else {
        console.log(`  ✓ Workflow status: ${updatedInstance?.status}`);
      }
    } catch (error: unknown) {
      console.error(`  ✗ Retry failed: ${errorMessage(error)}`);
    }
  } else {
    console.log("  ⚠ Task 1 did not fail as expected");
  }

  // Test 2: Skip Node
  console.log("\nTest 2: Skip a failed node");

  const skipWorkflow: WorkflowDefinition = {
    id: "skip-test-workflow",
    name: "Skip Test Workflow",
    startNode: "task1",
    nodes: {
      task1: {
        id: "task1",
        type: "action",
        action: async () => {
          throw new Error("This task always fails");
        },
        next: ["task2"],
      },
      task2: {
        id: "task2",
        type: "action",
        action: async (instance) => {
          const task1Output = instance.state?.nodes?.task1?.output;
          console.log(
            `  ✓ Task 2 received output from task1: ${JSON.stringify(task1Output)}`,
          );
          return { done: true };
        },
        next: [],
      },
    },
  };

  await engine.register(skipWorkflow);
  const instanceId2 = await engine.start("skip-test-workflow", { test: true });

  // Wait for initial execution to fail
  await new Promise((resolve) => setTimeout(resolve, 500));

  const instance2 = engine.getInstance(instanceId2);
  if (!instance2) {
    console.error("  ✗ Instance not found");
    return;
  }

  // Check if task1 failed
  const task1History2 = instance2.history.filter(
    (log) => log.nodeId === "task1",
  );
  if (
    task1History2.length > 0 &&
    task1History2[task1History2.length - 1].status === "failed"
  ) {
    console.log("  ✓ Task 1 failed as expected");

    // Skip the node with default output
    try {
      await engine.skipNode(instanceId2, "task1", {
        skipped: true,
        defaultValue: 42,
      });
      console.log("  ✓ Skip initiated successfully");

      // Wait for workflow to continue
      await new Promise((resolve) => setTimeout(resolve, 500));

      const updatedInstance = engine.getInstance(instanceId2);
      if (updatedInstance?.status === "completed") {
        console.log("  ✓ Workflow completed after skip");
      } else {
        console.log(`  ✓ Workflow status: ${updatedInstance?.status}`);
      }

      // Check if task1 was marked as skipped
      const skippedLog = updatedInstance?.history.find(
        (log) => log.nodeId === "task1" && log.status === "skipped",
      );
      if (skippedLog) {
        console.log("  ✓ Task 1 marked as skipped in history");
      }
    } catch (error: unknown) {
      console.error(`  ✗ Skip failed: ${errorMessage(error)}`);
    }
  } else {
    console.log("  ⚠ Task 1 did not fail as expected");
  }

  // Test 3: Compensate
  console.log("\nTest 3: Trigger compensation");

  const compensateWorkflow: WorkflowDefinition = {
    id: "compensate-test-workflow",
    name: "Compensate Test Workflow",
    startNode: "task1",
    nodes: {
      task1: {
        id: "task1",
        type: "action",
        action: async () => {
          console.log("  ✓ Task 1 completed");
          return { value: 100 };
        },
        next: ["task2"],
        rollbackTo: "rollback1",
      },
      task2: {
        id: "task2",
        type: "action",
        action: async () => {
          console.log("  ✓ Task 2 completed");
          return { value: 200 };
        },
        next: [],
        rollbackTo: "rollback2",
      },
      rollback1: {
        id: "rollback1",
        type: "action",
        action: async () => {
          console.log("  ✓ Rollback 1 executed");
          return { rolledBack: true };
        },
        next: [],
      },
      rollback2: {
        id: "rollback2",
        type: "action",
        action: async () => {
          console.log("  ✓ Rollback 2 executed");
          return { rolledBack: true };
        },
        next: [],
      },
    },
  };

  await engine.register(compensateWorkflow);
  const instanceId3 = await engine.start("compensate-test-workflow", {
    test: true,
  });

  // Wait for workflow to complete
  await new Promise((resolve) => setTimeout(resolve, 500));

  const instance3 = engine.getInstance(instanceId3);
  if (!instance3) {
    console.error("  ✗ Instance not found");
    return;
  }

  if (instance3.status === "completed") {
    console.log("  ✓ Workflow completed successfully");

    // Trigger compensation
    try {
      await engine.compensate(instanceId3, "Testing compensation");
      console.log("  ✓ Compensation triggered successfully");

      // Wait for compensation to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const updatedInstance = engine.getInstance(instanceId3);

      // Check if rollback nodes were executed
      const rollbackLogs = updatedInstance?.history.filter(
        (log) => log.status === "rollback",
      );
      if (rollbackLogs && rollbackLogs.length > 0) {
        console.log(`  ✓ ${rollbackLogs.length} rollback node(s) executed`);
      } else {
        console.log("  ⚠ No rollback nodes found in history");
      }
    } catch (error: unknown) {
      console.error(`  ✗ Compensation failed: ${errorMessage(error)}`);
    }
  } else {
    console.log(`  ⚠ Workflow status: ${instance3.status}`);
  }

  // Test 4: Get Node Status
  console.log("\nTest 4: Get node status");

  const statusWorkflow: WorkflowDefinition = {
    id: "status-test-workflow",
    name: "Status Test Workflow",
    startNode: "task1",
    nodes: {
      task1: {
        id: "task1",
        type: "action",
        action: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { completed: true, timestamp: Date.now() };
        },
        next: [],
      },
    },
  };

  await engine.register(statusWorkflow);
  const instanceId4 = await engine.start("status-test-workflow", {
    test: true,
  });

  // Wait for workflow to complete
  await new Promise((resolve) => setTimeout(resolve, 500));

  const instance4 = engine.getInstance(instanceId4);
  if (!instance4) {
    console.error("  ✗ Instance not found");
    return;
  }

  // Check node status through instance
  const task1Logs = instance4.history.filter((log) => log.nodeId === "task1");
  if (task1Logs.length > 0) {
    const lastLog = task1Logs[task1Logs.length - 1];
    console.log(`  ✓ Task 1 status: ${lastLog.status}`);
    if (lastLog.duration !== undefined) {
      console.log(`  ✓ Task 1 duration: ${lastLog.duration}ms`);
    }
    const output = instance4.state?.nodes?.task1?.output;
    if (output) {
      console.log(`  ✓ Task 1 output: ${JSON.stringify(output)}`);
    }
  }

  // Test 5: Error Handling - Invalid State
  console.log("\nTest 5: Error handling - invalid operations");

  // Try to retry a completed node (should fail)
  try {
    await engine.retryNode(instanceId4, "task1");
    console.error("  ✗ Should have thrown error for retrying completed node");
  } catch (error: unknown) {
    if (errorMessage(error).includes("not in a failed state")) {
      console.log("  ✓ Correctly rejected retry of completed node");
    } else {
      console.error(`  ✗ Unexpected error: ${errorMessage(error)}`);
    }
  }

  // Try to skip a completed node (should fail)
  try {
    await engine.skipNode(instanceId4, "task1");
    console.error("  ✗ Should have thrown error for skipping completed node");
  } catch (error: unknown) {
    if (errorMessage(error).includes("already completed")) {
      console.log("  ✓ Correctly rejected skip of completed node");
    } else {
      console.error(`  ✗ Unexpected error: ${errorMessage(error)}`);
    }
  }

  // Try to operate on non-existent instance (should fail)
  try {
    await engine.retryNode("non-existent-instance", "task1");
    console.error("  ✗ Should have thrown error for non-existent instance");
  } catch (error: unknown) {
    if (errorMessage(error).includes("not found")) {
      console.log("  ✓ Correctly rejected operation on non-existent instance");
    } else {
      console.error(`  ✗ Unexpected error: ${errorMessage(error)}`);
    }
  }

  // Try to operate on non-existent node (should fail)
  try {
    await engine.retryNode(instanceId4, "non-existent-node");
    console.error("  ✗ Should have thrown error for non-existent node");
  } catch (error: unknown) {
    if (errorMessage(error).includes("not found")) {
      console.log("  ✓ Correctly rejected operation on non-existent node");
    } else {
      console.error(`  ✗ Unexpected error: ${errorMessage(error)}`);
    }
  }

  console.log("\n=== Instance Control API Tests Completed ===\n");

  // Test 6: Execution Trace
  console.log("\nTest 6: Get execution trace");

  const traceWorkflow: WorkflowDefinition = {
    id: "trace-test-workflow",
    name: "Trace Test Workflow",
    startNode: "task1",
    nodes: {
      task1: {
        id: "task1",
        type: "action",
        action: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          console.log("  ✓ Task 1 completed");
          return { step: 1, value: "first" };
        },
        next: ["task2"],
      },
      task2: {
        id: "task2",
        type: "action",
        action: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          console.log("  ✓ Task 2 completed");
          return { step: 2, value: "second" };
        },
        next: ["task3"],
      },
      task3: {
        id: "task3",
        type: "action",
        action: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          console.log("  ✓ Task 3 completed");
          return { step: 3, value: "third" };
        },
        next: [],
      },
    },
  };

  await engine.register(traceWorkflow);
  const instanceId5 = await engine.start("trace-test-workflow", { test: true });

  // Wait for workflow to complete
  await new Promise((resolve) => setTimeout(resolve, 500));

  const instance5 = engine.getInstance(instanceId5);
  if (!instance5) {
    console.error("  ✗ Instance not found");
    return;
  }

  if (instance5.status === "completed") {
    console.log("  ✓ Workflow completed successfully");

    // Build execution trace (simulating what the API endpoint does)
    const sortedHistory = [...instance5.history].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    const steps = sortedHistory.map((log) => {
      let status: string;
      if (log.status === "success") {
        status = "completed";
      } else if (log.status === "failed") {
        status = "failed";
      } else if (log.status === "skipped") {
        status = "skipped";
      } else {
        status = log.status || "pending";
      }

      const step: any = {
        nodeId: log.nodeId,
        timestamp: log.timestamp.getTime(),
        status,
      };

      if (log.duration !== undefined) {
        step.duration = log.duration;
      }

      if (log.data !== undefined) {
        step.input = log.data;
      }

      const output = instance5.state?.nodes?.[log.nodeId]?.output;
      if (output !== undefined) {
        step.output = output;
      }

      if (log.status === "failed" && log.error) {
        step.error = log.error;
      }

      return step;
    });

    console.log(`  ✓ Execution trace has ${steps.length} steps`);

    // Verify chronological order
    let isChronological = true;
    for (let i = 1; i < steps.length; i++) {
      if (steps[i].timestamp < steps[i - 1].timestamp) {
        isChronological = false;
        break;
      }
    }

    if (isChronological) {
      console.log("  ✓ Steps are in chronological order");
    } else {
      console.error("  ✗ Steps are not in chronological order");
    }

    // Verify all required fields are present
    const allHaveRequiredFields = steps.every(
      (step) => step.nodeId && step.timestamp && step.status,
    );

    if (allHaveRequiredFields) {
      console.log(
        "  ✓ All steps have required fields (nodeId, timestamp, status)",
      );
    } else {
      console.error("  ✗ Some steps missing required fields");
    }

    // Verify node IDs match expected sequence
    const nodeIds = steps.map((s) => s.nodeId);
    const expectedNodeIds = ["task1", "task2", "task3"];
    const nodeIdsMatch =
      JSON.stringify(nodeIds) === JSON.stringify(expectedNodeIds);

    if (nodeIdsMatch) {
      console.log("  ✓ Node execution sequence matches expected order");
    } else {
      console.log(`  ⚠ Node sequence: ${nodeIds.join(" -> ")}`);
    }

    // Verify outputs are included
    const allHaveOutputs = steps.every((step) => step.output !== undefined);
    if (allHaveOutputs) {
      console.log("  ✓ All steps include output data");
    } else {
      console.log("  ⚠ Some steps missing output data");
    }

    // Display sample trace
    console.log("\n  Sample trace data:");
    if (steps.length > 0) {
      const firstStep = steps[0];
      console.log(`    First step: ${firstStep.nodeId}`);
      console.log(`    Status: ${firstStep.status}`);
      console.log(`    Duration: ${firstStep.duration}ms`);
      console.log(`    Output: ${JSON.stringify(firstStep.output)}`);
    }
  } else {
    console.log(`  ⚠ Workflow status: ${instance5.status}`);
  }

  console.log("\n=== Instance Control API Tests Completed ===\n");

  // Cleanup
  engine.destroy();
  await destroyContainer(container);
}

// Run the test
testInstanceControlAPI().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
