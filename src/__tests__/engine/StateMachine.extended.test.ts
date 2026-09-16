// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { describe, expect, it } from "vitest";
import { StateMachine } from "../../engine/StateMachine";

describe("StateMachine", () => {
  // ── transition ─────────────────────────────────────────────────────────────

  describe("transition()", () => {
    it("pending + start → running", () => {
      expect(StateMachine.transition("pending", "start")).toBe("running");
    });

    it("pending + cancel → cancelled", () => {
      expect(StateMachine.transition("pending", "cancel")).toBe("cancelled");
    });

    it("running + complete → completed", () => {
      expect(StateMachine.transition("running", "complete")).toBe("completed");
    });

    it("running + fail → failed", () => {
      expect(StateMachine.transition("running", "fail")).toBe("failed");
    });

    it("running + rollback → rollback", () => {
      expect(StateMachine.transition("running", "rollback")).toBe("rollback");
    });

    it("running + pause → paused", () => {
      expect(StateMachine.transition("running", "pause")).toBe("paused");
    });

    it("running + cancel → cancelled", () => {
      expect(StateMachine.transition("running", "cancel")).toBe("cancelled");
    });

    it("failed + rollback → rollback", () => {
      expect(StateMachine.transition("failed", "rollback")).toBe("rollback");
    });

    it("rollback + start → running", () => {
      expect(StateMachine.transition("rollback", "start")).toBe("running");
    });

    it("rollback + cancel → cancelled", () => {
      expect(StateMachine.transition("rollback", "cancel")).toBe("cancelled");
    });

    it("paused + resume → running", () => {
      expect(StateMachine.transition("paused", "resume")).toBe("running");
    });

    it("paused + cancel → cancelled", () => {
      expect(StateMachine.transition("paused", "cancel")).toBe("cancelled");
    });

    it("completed state has no valid transitions (returns current)", () => {
      expect(StateMachine.transition("completed", "start" as any)).toBe(
        "completed",
      );
    });

    it("cancelled state has no valid transitions (returns current)", () => {
      expect(StateMachine.transition("cancelled", "start" as any)).toBe(
        "cancelled",
      );
    });

    it("invalid event returns current state (unknown event)", () => {
      expect(StateMachine.transition("running", "teleport" as any)).toBe(
        "running",
      );
    });
  });

  // ── isValidTransition (Bug Fix Verification) ───────────────────────────────

  describe("isValidTransition() — bug fix: must distinguish valid from invalid", () => {
    it("should return true for a valid transition (pending → start)", () => {
      expect(StateMachine.isValidTransition("pending", "start")).toBe(true);
    });

    it("should return true for running → complete", () => {
      expect(StateMachine.isValidTransition("running", "complete")).toBe(true);
    });

    it("should return false for an invalid transition (completed → start)", () => {
      // Bug: before fix this returned true because transition() returned 'completed' which is truthy
      expect(StateMachine.isValidTransition("completed", "start")).toBe(false);
    });

    it("should return false for cancelled → fail", () => {
      expect(StateMachine.isValidTransition("cancelled", "fail")).toBe(false);
    });

    it("should return false for an unknown event", () => {
      expect(StateMachine.isValidTransition("running", "teleport")).toBe(false);
    });

    it("should return false for failed → complete", () => {
      expect(StateMachine.isValidTransition("failed", "complete")).toBe(false);
    });
  });

  // ── canExecute ─────────────────────────────────────────────────────────────

  describe("canExecute()", () => {
    it("should return true when status is running", () => {
      expect(StateMachine.canExecute("running")).toBe(true);
    });

    it("should return true when status is rollback", () => {
      expect(StateMachine.canExecute("rollback")).toBe(true);
    });

    it.each(["pending", "completed", "failed", "paused", "cancelled"] as const)(
      "should return false for status %s",
      (status) => {
        expect(StateMachine.canExecute(status)).toBe(false);
      },
    );
  });

  // ── isCompleted ────────────────────────────────────────────────────────────

  describe("isCompleted()", () => {
    it.each(["completed", "failed", "cancelled"] as const)(
      "should return true for terminal status %s",
      (status) => {
        expect(StateMachine.isCompleted(status)).toBe(true);
      },
    );

    it.each(["pending", "running", "rollback", "paused"] as const)(
      "should return false for non-terminal status %s",
      (status) => {
        expect(StateMachine.isCompleted(status)).toBe(false);
      },
    );
  });

  // ── canRollback ────────────────────────────────────────────────────────────

  describe("canRollback()", () => {
    it.each(["failed", "running"] as const)(
      "should return true for status %s",
      (status) => {
        expect(StateMachine.canRollback(status)).toBe(true);
      },
    );

    it.each([
      "pending",
      "completed",
      "paused",
      "cancelled",
      "rollback",
    ] as const)("should return false for status %s", (status) => {
      expect(StateMachine.canRollback(status)).toBe(false);
    });
  });

  // ── canPause / canResume ───────────────────────────────────────────────────

  describe("canPause()", () => {
    it("should return true only for running", () => {
      expect(StateMachine.canPause("running")).toBe(true);
      expect(StateMachine.canPause("paused")).toBe(false);
      expect(StateMachine.canPause("pending")).toBe(false);
    });
  });

  describe("canResume()", () => {
    it("should return true only for paused", () => {
      expect(StateMachine.canResume("paused")).toBe(true);
      expect(StateMachine.canResume("running")).toBe(false);
    });
  });

  // ── canCancel ─────────────────────────────────────────────────────────────

  describe("canCancel()", () => {
    it.each(["pending", "running", "paused", "rollback"] as const)(
      "should return true for cancellable status %s",
      (status) => {
        expect(StateMachine.canCancel(status)).toBe(true);
      },
    );

    it.each(["completed", "failed", "cancelled"] as const)(
      "should return false for non-cancellable status %s",
      (status) => {
        expect(StateMachine.canCancel(status)).toBe(false);
      },
    );
  });
});
