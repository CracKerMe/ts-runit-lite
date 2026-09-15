import { describe, expect, it } from "vitest";
import { nodeTemplates } from "../workflows/shared";

const ALL_TASK_TYPES = [
  "action",
  "wait",
  "event",
  "rollback",
  "subworkflow",
  "http",
  "sql",
  "queue",
  "condition",
  "router",
  "loop",
  "approval",
  "notification",
  "join",
  "transform",
];

describe("nodeTemplates catalog", () => {
  it("has exactly one entry per TaskType", () => {
    const types = nodeTemplates.map((t) => t.type).sort();
    expect(types).toEqual([...ALL_TASK_TYPES].sort());
  });

  it("attaches a typed configSchema for declarative node types", () => {
    const http = nodeTemplates.find((t) => t.type === "http")!;
    expect(http.configSchema).toMatchObject({
      required: expect.arrayContaining(["method", "url"]),
    });
  });

  it("has a null configSchema for types with no declarative config (action)", () => {
    const action = nodeTemplates.find((t) => t.type === "action")!;
    expect(action.configSchema).toBeNull();
  });

  it("attaches type-specific ports for control-flow node types", () => {
    const condition = nodeTemplates.find((t) => t.type === "condition")!;
    expect(condition.ports).toEqual(
      expect.arrayContaining(["condition-true", "condition-false"]),
    );

    const router = nodeTemplates.find((t) => t.type === "router")!;
    expect(router.ports).toEqual(
      expect.arrayContaining(["router-route", "router-default"]),
    );
  });

  it("every entry gets the common edge kinds as ports", () => {
    for (const entry of nodeTemplates) {
      expect(entry.ports).toEqual(
        expect.arrayContaining([
          "next",
          "failure",
          "conditional",
          "default",
          "rollback",
        ]),
      );
    }
  });
});
