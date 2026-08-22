import { describe, expect, it } from "vitest";
import { DSLParseError, parseDSL } from "../DSLParser";

describe("DSLParser", () => {
  it("should parse simple workflow", () => {
    const dsl = `
id: test-workflow
name: Test Workflow
startNode: step1

step1:
  type: action
  next: ["step2"]

step2:
  type: http
  config: {"method": "GET", "url": "https://api.example.com"}
`;

    const result = parseDSL(dsl);

    expect(result.id).toBe("test-workflow");
    expect(result.startNode).toBe("step1");
    expect(result.nodes.step1).toBeDefined();
    expect(result.nodes.step1.type).toBe("action");
    expect(result.nodes.step1.next).toEqual(["step2"]);
    expect(result.nodes.step2.config).toMatchObject({
      method: "GET",
      url: "https://api.example.com",
    });
  });

  it("should parse conditional branches and retry policy", () => {
    const dsl = `
id: conditional-flow
name: Conditional Flow
version: 1.0.0
startNode: check

check:
  type: condition
  config: {"condition": "\${amount > 100}", "trueBranch": "high", "falseBranch": "low"}
  conditionalNext: [{"condition": "\${amount > 100}", "target": "high"}]
  defaultNext: low
  retryPolicy: {"maxRetries": 3, "backoffMs": 100}

high:
  type: action

low:
  type: action
`;

    const result = parseDSL(dsl);

    expect(result.version).toBe("1.0.0");
    expect(result.nodes.check.config).toBeDefined();
    expect(result.nodes.check.conditionalNext).toEqual([
      { condition: "${amount > 100}", target: "high" },
    ]);
    expect(result.nodes.check.defaultNext).toBe("low");
    expect(result.nodes.check.maxRetries).toBe(3);
  });

  it("should reject workflows without a matching start node", () => {
    const dsl = `
id: invalid-flow
name: Invalid Flow
startNode: missing

step:
  type: action
`;

    expect(() => parseDSL(dsl)).toThrow(DSLParseError);
    expect(() => parseDSL(dsl)).toThrow(
      "startNode 'missing' does not match any node",
    );
  });
});
