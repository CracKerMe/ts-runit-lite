import { describe, expect, it } from "vitest";
import {
  evaluateConditionSandboxed,
  evaluateSandboxed,
  isSandboxAvailable,
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
});
