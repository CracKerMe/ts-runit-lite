import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CronScheduler } from "../../scheduler/CronScheduler";

function makeEngine(startFn?: () => Promise<string>) {
  return {
    start: startFn ?? vi.fn().mockResolvedValue("instance-id"),
  };
}

describe("CronScheduler", () => {
  let scheduler: CronScheduler;

  beforeEach(() => {
    // Clean up any static jobs from previous tests
    CronScheduler.stopAll();
    scheduler = new CronScheduler();
  });

  afterEach(() => {
    scheduler.stopAll();
  });

  // ── static schedule / stop / stopAll ──────────────────────────────────────

  describe("static schedule()", () => {
    it("should register a cron job in the static jobs map", () => {
      const engine = makeEngine();
      CronScheduler.schedule("wf-static", "* * * * *", engine);
      expect(CronScheduler.jobs["wf-static"]).toBeDefined();
      CronScheduler.stop("wf-static");
    });
  });

  describe("static stop()", () => {
    it("should remove the job from the static jobs map", () => {
      const engine = makeEngine();
      CronScheduler.schedule("wf-stop", "* * * * *", engine);
      CronScheduler.stop("wf-stop");
      expect(CronScheduler.jobs["wf-stop"]).toBeUndefined();
    });

    it("should be a no-op for a non-existent workflow", () => {
      expect(() => CronScheduler.stop("ghost")).not.toThrow();
    });
  });

  describe("static stopAll()", () => {
    it("should remove all static cron jobs", () => {
      const engine = makeEngine();
      CronScheduler.schedule("wf-a", "* * * * *", engine);
      CronScheduler.schedule("wf-b", "* * * * *", engine);
      CronScheduler.stopAll();
      expect(Object.keys(CronScheduler.jobs)).toHaveLength(0);
    });
  });

  // ── instance scheduleJob / stopJob / stopAll ───────────────────────────────

  describe("scheduleJob()", () => {
    it("should register a cron job in instance jobs", () => {
      const engine = makeEngine();
      scheduler.scheduleJob("wf-inst-1", "* * * * *", engine);
      expect(scheduler.getActiveJobs()).toContain("wf-inst-1");
    });

    it("should replace an existing job when called again for the same workflowId", () => {
      const engine = makeEngine();
      scheduler.scheduleJob("wf-replace", "* * * * *", engine);
      scheduler.scheduleJob("wf-replace", "0 * * * *", engine); // different expression
      const jobs = scheduler.getActiveJobs();
      const count = jobs.filter((id) => id === "wf-replace").length;
      expect(count).toBe(1);
    });
  });

  describe("stopJob()", () => {
    it("should remove a job from the active list", () => {
      const engine = makeEngine();
      scheduler.scheduleJob("wf-del", "* * * * *", engine);
      scheduler.stopJob("wf-del");
      expect(scheduler.getActiveJobs()).not.toContain("wf-del");
    });

    it("should be a no-op for a non-existent job", () => {
      expect(() => scheduler.stopJob("ghost")).not.toThrow();
    });
  });

  describe("instance stopAll()", () => {
    it("should stop all instance jobs", () => {
      const engine = makeEngine();
      scheduler.scheduleJob("wf-x", "* * * * *", engine);
      scheduler.scheduleJob("wf-y", "* * * * *", engine);
      scheduler.stopAll();
      // getActiveJobs merges static + instance; after stopAll both should be empty
      const remaining = scheduler
        .getActiveJobs()
        .filter((id) => id === "wf-x" || id === "wf-y");
      expect(remaining).toHaveLength(0);
    });
  });

  describe("getActiveJobs()", () => {
    it("should return ids from both static and instance jobs", () => {
      const engine = makeEngine();
      CronScheduler.schedule("wf-static-active", "* * * * *", engine);
      scheduler.scheduleJob("wf-instance-active", "* * * * *", engine);
      const jobs = scheduler.getActiveJobs();
      expect(jobs).toContain("wf-static-active");
      expect(jobs).toContain("wf-instance-active");
      // cleanup
      CronScheduler.stop("wf-static-active");
    });
  });
});
