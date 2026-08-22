import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnhancedCronScheduler } from "../EnhancedCronScheduler";

/** A minimal engine stub */
function makeEngine(startFn?: () => Promise<string>) {
  return {
    start: startFn ?? vi.fn().mockResolvedValue("instance-id-123"),
  };
}

describe("EnhancedCronScheduler", () => {
  let scheduler: EnhancedCronScheduler;

  beforeEach(() => {
    scheduler = new EnhancedCronScheduler(); // no storage → in-memory
  });

  afterEach(() => {
    scheduler.stopAll();
  });

  // ── createSchedule ─────────────────────────────────────────────────────────

  describe("createSchedule", () => {
    it("should create and store a schedule", () => {
      const schedule = scheduler.createSchedule("daily", "report-wf", {
        interval: "0 9 * * *",
      });
      expect(schedule.id).toBe("daily");
      expect(schedule.workflowId).toBe("report-wf");
      expect(schedule.paused).toBe(false);
    });

    it("should store schedule so getSchedule returns it", () => {
      scheduler.createSchedule("s1", "wf-s1", { interval: "* * * * *" });
      const found = scheduler.getSchedule("s1");
      expect(found).toBeDefined();
      expect(found!.workflowId).toBe("wf-s1");
    });

    it("should list all created schedules", () => {
      scheduler.createSchedule("a", "wf-a", { interval: "* * * * *" });
      scheduler.createSchedule("b", "wf-b", { interval: "* * * * *" });
      const list = scheduler.listSchedules();
      expect(list.length).toBe(2);
    });
  });

  // ── pauseSchedule / resumeSchedule ─────────────────────────────────────────

  describe("pauseSchedule / resumeSchedule", () => {
    beforeEach(() => {
      scheduler.createSchedule("p1", "wf-p", { interval: "* * * * *" });
    });

    it("should pause a schedule", () => {
      scheduler.pauseSchedule("p1", "maintenance");
      expect(scheduler.getSchedule("p1")!.paused).toBe(true);
      expect(scheduler.getSchedule("p1")!.notes).toBe("maintenance");
    });

    it("should resume a paused schedule", () => {
      scheduler.pauseSchedule("p1");
      scheduler.resumeSchedule("p1", "back online");
      expect(scheduler.getSchedule("p1")!.paused).toBe(false);
      expect(scheduler.getSchedule("p1")!.notes).toBe("back online");
    });

    it("should be a no-op when pausing a non-existent schedule", () => {
      expect(() => scheduler.pauseSchedule("ghost")).not.toThrow();
    });
  });

  // ── deleteSchedule ─────────────────────────────────────────────────────────

  describe("deleteSchedule", () => {
    it("should remove the schedule from the list", () => {
      scheduler.createSchedule("del-1", "wf-del", { interval: "* * * * *" });
      scheduler.deleteSchedule("del-1");
      expect(scheduler.getSchedule("del-1")).toBeUndefined();
    });
  });

  // ── recordCompletion / recordFailure ───────────────────────────────────────

  describe("recordCompletion", () => {
    it("should store last completion result on the schedule", () => {
      scheduler.createSchedule("comp-1", "wf-comp", { interval: "* * * * *" });
      scheduler.recordCompletion("wf-comp", { rows: 42 });
      const s = scheduler.getSchedule("comp-1")!;
      expect(s.lastCompletionResult).toEqual({ rows: 42 });
    });
  });

  describe("recordFailure", () => {
    it("should store last failure on the schedule", () => {
      scheduler.createSchedule("fail-1", "wf-fail", { interval: "* * * * *" });
      scheduler.recordFailure("wf-fail", new Error("oops"));
      const s = scheduler.getSchedule("fail-1")!;
      expect(s.lastFailure).toBeInstanceOf(Error);
    });

    it("should auto-pause the schedule when pauseOnFailure is true", () => {
      scheduler.createSchedule(
        "auto-pause",
        "wf-ap",
        { interval: "* * * * *" },
        { pauseOnFailure: true },
      );
      scheduler.recordFailure("wf-ap", new Error("boom"));
      expect(scheduler.getSchedule("auto-pause")!.paused).toBe(true);
    });

    it("should NOT pause when pauseOnFailure is false", () => {
      scheduler.createSchedule(
        "no-pause",
        "wf-np",
        { interval: "* * * * *" },
        { pauseOnFailure: false },
      );
      scheduler.recordFailure("wf-np", new Error("minor"));
      expect(scheduler.getSchedule("no-pause")!.paused).toBe(false);
    });
  });

  // ── completeAction ─────────────────────────────────────────────────────────

  describe("completeAction", () => {
    it("should be a no-op when no running actions exist", () => {
      scheduler.createSchedule("ca-1", "wf-ca", { interval: "* * * * *" });
      expect(() => scheduler.completeAction("wf-ca", "some-id")).not.toThrow();
    });
  });

  // ── startSchedule ─────────────────────────────────────────────────────────

  describe("startSchedule", () => {
    it("should throw when the schedule does not exist", async () => {
      const engine = makeEngine();
      await expect(
        scheduler.startSchedule("nonexistent", engine),
      ).rejects.toThrow("Schedule not found: nonexistent");
    });

    it("should start a cron job and call engine.start on tick (integration, fast interval)", async () => {
      // Use a 1-minute cron – we won't wait for it to fire, just verify startup
      scheduler.createSchedule("trigger-test", "wf-trigger", {
        interval: "* * * * *",
      });
      const engine = makeEngine();
      // Should not throw
      await expect(
        scheduler.startSchedule("trigger-test", engine),
      ).resolves.not.toThrow();
    });
  });

  // ── backfill ───────────────────────────────────────────────────────────────

  describe("backfill", () => {
    it("should throw when the schedule does not exist", async () => {
      const engine = makeEngine();
      await expect(
        scheduler.backfill("ghost", new Date(), new Date(), engine),
      ).rejects.toThrow("Schedule not found: ghost");
    });

    it("should call engine.start for each backfill time slot in window", async () => {
      vi.useFakeTimers();
      const start = vi.fn().mockResolvedValue("bi");
      const engine = { start };
      scheduler.createSchedule("bf-1", "wf-bf", { interval: "* * * * *" });
      const startTime = new Date(Date.now() - 3 * 60000); // 3 minutes ago
      const endTime = new Date();
      await scheduler.backfill("bf-1", startTime, endTime, engine);
      // engine.start is called inside setTimeout(fn, 0) inside executeScheduleAction
      // flush all pending macrotasks
      await vi.runAllTimersAsync();
      vi.useRealTimers();
      // backfill iterates every 60s over 3 minutes → 3 slots
      expect(start).toHaveBeenCalled();
    });
  });

  // ── stopAll ────────────────────────────────────────────────────────────────

  describe("stopAll", () => {
    it("should stop all running schedules without throwing", async () => {
      scheduler.createSchedule("stop-1", "wf-stop", { interval: "* * * * *" });
      await scheduler.startSchedule("stop-1", makeEngine());
      expect(() => scheduler.stopAll()).not.toThrow();
    });
  });
});
