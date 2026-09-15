import { afterEach, describe, expect, it } from "vitest";
import {
  configureActionSandboxIsolation,
  evaluateActionSandboxed,
  evaluateConditionSandboxed,
  evaluateSandboxed,
  isSandboxAvailable,
  shutdownActionSandboxIsolation,
} from "../SandboxEvaluator";

describe("SandboxEvaluator", () => {
  describe("evaluateSandboxed", () => {
    it("should evaluate simple expressions", () => {
      const result = evaluateSandboxed("1 + 2");
      expect(result).toBe(3);
    });

    it("should evaluate expressions with context", () => {
      const result = evaluateSandboxed("x + y", {
        x: 10,
        y: 20,
      });
      expect(result).toBe(30);
    });

    it("should evaluate string expressions", () => {
      const result = evaluateSandboxed("'hello' + ' ' + 'world'");
      expect(result).toBe("hello world");
    });

    it("should evaluate comparison expressions", () => {
      const result = evaluateSandboxed("x > 10", { x: 15 });
      expect(result).toBe(true);
    });

    it("should allow Math operations", () => {
      const result = evaluateSandboxed("Math.max(a, b)", { a: 10, b: 20 });
      expect(result).toBe(20);
    });

    it("should allow Date operations", () => {
      const result = evaluateSandboxed("Date.now()");
      expect(typeof result).toBe("number");
    });

    it("should block require", () => {
      expect(() => {
        evaluateSandboxed("require('fs')");
      }).toThrow("blocked pattern");
    });

    it("should block process access", () => {
      expect(() => {
        evaluateSandboxed("process.env");
      }).toThrow("blocked pattern");
    });

    it("should block eval", () => {
      expect(() => {
        evaluateSandboxed("eval('1+1')");
      }).toThrow("blocked pattern");
    });

    it("should block Function constructor", () => {
      expect(() => {
        evaluateSandboxed("new Function('return 1')()");
      }).toThrow("blocked pattern");
    });

    it("should block __proto__ access", () => {
      expect(() => {
        evaluateSandboxed("obj.__proto__", { obj: {} });
      }).toThrow("blocked pattern");
    });

    it("should handle timeout", () => {
      expect(() => {
        evaluateSandboxed(
          "(function() { while(true) {} })()",
          {},
          { timeoutMs: 50 },
        );
      }).toThrow();
    });
  });

  describe("evaluateConditionSandboxed", () => {
    it("should return boolean for truthy expressions", () => {
      const result = evaluateConditionSandboxed("x > 5", {
        x: 10,
      });
      expect(result).toBe(true);
    });

    it("should return boolean for falsy expressions", () => {
      const result = evaluateConditionSandboxed("x > 5", {
        x: 3,
      });
      expect(result).toBe(false);
    });

    it("should return false for invalid expressions", () => {
      const result = evaluateConditionSandboxed("require('fs')");
      expect(result).toBe(false);
    });
  });

  describe("isSandboxAvailable", () => {
    it("should return true when VM module is available", () => {
      expect(isSandboxAvailable()).toBe(true);
    });
  });

  describe("evaluateActionSandboxed", () => {
    afterEach(async () => {
      // Isolation config is process-global; always reset it so other test
      // files (and other tests in this file) see the default in-process path.
      await shutdownActionSandboxIsolation();
    });

    it("falls back to the in-process vm path when isolation is not configured", async () => {
      const result = await evaluateActionSandboxed("x + y", { x: 1, y: 2 });
      expect(result).toBe(3);
    });

    it("still blocks dangerous patterns on the fallback path", async () => {
      await expect(evaluateActionSandboxed("process.env", {})).rejects.toThrow(
        "blocked pattern",
      );
    });

    it("routes to a worker thread when isolation is configured, with the same semantics", async () => {
      configureActionSandboxIsolation({
        minWorkers: 0,
        maxWorkers: 1,
        taskTimeoutMs: 2000,
        idleTimeoutMs: 30000,
      });

      const result = await evaluateActionSandboxed(
        "(function(instance) { return instance.status; })(instance)",
        { instance: { status: "completed" } },
      );
      expect(result).toBe("completed");

      await expect(evaluateActionSandboxed("process.env", {})).rejects.toThrow(
        "blocked pattern",
      );
    }, 10000);

    it("uses the configured isolation timeout when the caller gives no override", async () => {
      configureActionSandboxIsolation({
        minWorkers: 0,
        maxWorkers: 1,
        taskTimeoutMs: 20,
        idleTimeoutMs: 30000,
      });

      await expect(
        evaluateActionSandboxed("(function() { while (true) {} })()"),
      ).rejects.toThrow(/timed out/i);
    }, 10000);
  });
});
