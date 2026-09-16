import { describe, expect, it } from "vitest";
import { type Task, TaskQueueManager } from "../../engine/TaskQueueManager";

describe("TaskQueueManager", () => {
  it("reports whether a queue has a registered worker", () => {
    const manager = new TaskQueueManager();
    manager.createQueue({ name: "activities", type: "activity" });

    expect(manager.hasWorkerFor("activities")).toBe(false);

    manager.registerWorker("w1", ["activities"], async () => undefined);
    expect(manager.hasWorkerFor("activities")).toBe(true);

    manager.unregisterWorker("w1");
    expect(manager.hasWorkerFor("activities")).toBe(false);
  });

  it("settles submit() with the worker's return value", async () => {
    const manager = new TaskQueueManager();
    manager.registerWorker("w1", ["activities"], async (task: Task) => ({
      echoed: (task.payload as { value: number }).value * 2,
    }));

    const result = await manager.submit<{ echoed: number }>("activities", {
      value: 21,
    });

    expect(result).toEqual({ echoed: 42 });
  });

  it("rejects submit() when the worker throws, without re-queueing", async () => {
    const manager = new TaskQueueManager();
    let calls = 0;
    manager.registerWorker("w1", ["activities"], async () => {
      calls += 1;
      throw new Error("handler exploded");
    });

    await expect(manager.submit("activities", {})).rejects.toThrow(
      "handler exploded",
    );

    // A failing submitted task must not be retried forever.
    expect(calls).toBe(1);
    expect(manager.getPendingCount("activities")).toBe(0);
  });

  it("respects per-worker concurrency limits", async () => {
    const manager = new TaskQueueManager();
    let active = 0;
    let maxObserved = 0;

    manager.registerWorker(
      "w1",
      ["activities"],
      async () => {
        active += 1;
        maxObserved = Math.max(maxObserved, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return "done";
      },
      { maxConcurrent: 1 },
    );

    await Promise.all([
      manager.submit("activities", { n: 1 }),
      manager.submit("activities", { n: 2 }),
      manager.submit("activities", { n: 3 }),
    ]);

    expect(maxObserved).toBe(1);
  });

  it("rejects pending submissions when the queue is deleted", async () => {
    const manager = new TaskQueueManager();
    manager.createQueue({ name: "activities", type: "activity" });

    // No worker registered, so the task stays pending.
    const pending = manager.submit("activities", {});
    expect(manager.getPendingCount("activities")).toBe(1);

    manager.deleteQueue("activities");

    await expect(pending).rejects.toThrow(
      "Queue deleted while task pending: activities",
    );
  });

  it("routes tasks through a routing function", async () => {
    const manager = new TaskQueueManager();
    manager.createQueue({
      name: "inbound",
      type: "activity",
      routing: (task) =>
        (task as { priority: string }).priority === "high"
          ? "fast-lane"
          : "slow-lane",
    });

    const seen: string[] = [];
    manager.registerWorker(
      "w1",
      ["fast-lane", "slow-lane"],
      async (task: Task) => {
        seen.push(task.queueName);
        return null;
      },
    );

    await manager.submit("inbound", { priority: "high" });
    await manager.submit("inbound", { priority: "low" });

    expect(seen).toEqual(["fast-lane", "slow-lane"]);
  });
});
