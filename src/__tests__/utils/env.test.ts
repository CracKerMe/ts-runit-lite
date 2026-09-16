import { describe, expect, it } from "vitest";
import { parseEnvInt } from "../../utils/env";

describe("parseEnvInt", () => {
  const DEFAULT = 42;

  describe("falls back to the default on invalid input", () => {
    const invalid: Array<[string, string | undefined]> = [
      ["undefined", undefined],
      ["empty string", ""],
      ["whitespace only", "   "],
      ["non-numeric", "abc"],
      ["literal NaN", "NaN"],
      ["Infinity", "Infinity"],
      ["-Infinity", "-Infinity"],
      // Number.parseInt would silently return 100 here, hiding a typo.
      ["trailing garbage", "100abc"],
    ];

    for (const [label, value] of invalid) {
      it(`${label}`, () => {
        expect(parseEnvInt(value, DEFAULT)).toBe(DEFAULT);
      });
    }
  });

  describe("parses valid input", () => {
    const valid: Array<[string, string, number]> = [
      ["plain integer", "100", 100],
      ["zero", "0", 0],
      ["negative", "-5", -5],
      ["exponent notation", "1e3", 1000],
      ["surrounding whitespace", " 7 ", 7],
      ["truncates a float", "10.9", 10],
      ["truncates toward zero", "-10.9", -10],
    ];

    for (const [label, value, expected] of valid) {
      it(`${label}`, () => {
        expect(parseEnvInt(value, DEFAULT)).toBe(expected);
      });
    }
  });

  describe("range bounds", () => {
    it("rejects a value below min", () => {
      expect(parseEnvInt("0", DEFAULT, { min: 1 })).toBe(DEFAULT);
    });

    it("accepts a value exactly at min", () => {
      expect(parseEnvInt("1", DEFAULT, { min: 1 })).toBe(1);
    });

    it("rejects a value above max", () => {
      expect(parseEnvInt("101", DEFAULT, { max: 100 })).toBe(DEFAULT);
    });

    it("accepts a value exactly at max", () => {
      expect(parseEnvInt("100", DEFAULT, { max: 100 })).toBe(100);
    });

    it("rejects a negative value when min is 0", () => {
      expect(parseEnvInt("-1", DEFAULT, { min: 0 })).toBe(DEFAULT);
    });

    it("applies bounds after truncation", () => {
      // 1.9 truncates to 1, which satisfies min: 1.
      expect(parseEnvInt("1.9", DEFAULT, { min: 1 })).toBe(1);
      // 0.9 truncates to 0, which violates min: 1.
      expect(parseEnvInt("0.9", DEFAULT, { min: 1 })).toBe(DEFAULT);
    });
  });
});
