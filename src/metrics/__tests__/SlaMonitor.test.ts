import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SlaRule } from "../SlaMonitor";
import { SlaMonitor } from "../SlaMonitor";

describe("SlaMonitor", () => {
  let monitor: SlaMonitor;

  beforeEach(() => {
    monitor = new SlaMonitor();
  });

  const createRule = (overrides: Partial<SlaRule> = {}): SlaRule => ({
    id: "rule-1",
    workflowId: "workflow-1",
    metric: "completion_time",
    threshold: 5000,
    operator: "lt",
    windowMs: 60000,
    ...overrides,
  });

  describe("addRule", () => {
    it("should add a rule", () => {
      monitor.addRule(createRule());

      const rules = monitor.getRules();
      expect(rules.length).toBe(1);
      expect(rules[0].id).toBe("rule-1");
    });

    it("should add multiple rules", () => {
      monitor.addRule(createRule({ id: "rule-1" }));
      monitor.addRule(createRule({ id: "rule-2" }));

      const rules = monitor.getRules();
      expect(rules.length).toBe(2);
    });
  });

  describe("removeRule", () => {
    it("should remove a rule", () => {
      monitor.addRule(createRule());
      monitor.removeRule("rule-1");

      const rules = monitor.getRules();
      expect(rules.length).toBe(0);
    });

    it("should handle removing non-existent rule", () => {
      monitor.removeRule("non-existent");
      // Should not throw
    });
  });

  describe("getRules", () => {
    it("should return all rules", () => {
      monitor.addRule(createRule({ id: "rule-1", workflowId: "wf-1" }));
      monitor.addRule(createRule({ id: "rule-2", workflowId: "wf-2" }));

      const allRules = monitor.getRules();
      expect(allRules.length).toBe(2);
    });

    it("should filter rules by workflow", () => {
      monitor.addRule(createRule({ id: "rule-1", workflowId: "wf-1" }));
      monitor.addRule(createRule({ id: "rule-2", workflowId: "wf-2" }));

      const wf1Rules = monitor.getRules("wf-1");
      expect(wf1Rules.length).toBe(1);
      expect(wf1Rules[0].workflowId).toBe("wf-1");
    });
  });

  describe("getStatus", () => {
    it("should return healthy status when no violations", () => {
      monitor.addRule(createRule());

      const status = monitor.getStatus("workflow-1");

      expect(status.isHealthy).toBe(true);
      expect(status.violations.length).toBe(0);
      expect(status.rules.length).toBe(1);
    });
  });

  describe("events", () => {
    it("should emit violation events", () => {
      const violationHandler = vi.fn();
      monitor.on("violation", violationHandler);

      // This is a structural test - actual violation detection
      // requires metric values from storage
      monitor.addRule(createRule());

      expect(monitor.listenerCount("violation")).toBe(1);
    });
  });

  describe("clearOldViolations", () => {
    it("should clear old violations", () => {
      // This is a structural test
      monitor.clearOldViolations();
      // Should not throw
    });
  });
});
