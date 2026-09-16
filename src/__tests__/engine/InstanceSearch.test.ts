// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { searchInstances } from "../../engine/InstanceSearch";

function makeInstance(
  overrides: Partial<WorkflowInstance> & { instanceId: string },
): WorkflowInstance {
  return {
    workflowId: "order-processing",
    currentNodes: [],
    status: "running",
    context: {},
    history: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as WorkflowInstance;
}

const instances: WorkflowInstance[] = [
  makeInstance({
    instanceId: "i1",
    status: "running",
    searchAttributes: { region: "us-east", amount: 500 },
    createdAt: new Date("2026-01-01T00:00:00Z"),
  }),
  makeInstance({
    instanceId: "i2",
    status: "completed",
    searchAttributes: { region: "us-east", amount: 2000 },
    createdAt: new Date("2026-02-01T00:00:00Z"),
  }),
  makeInstance({
    instanceId: "i3",
    status: "paused",
    workflowId: "user-registration",
    searchAttributes: { region: "eu-west", amount: 1500 },
    createdAt: new Date("2026-03-01T00:00:00Z"),
  }),
  makeInstance({
    instanceId: "i4",
    status: "running",
    workflowId: "user-registration",
    createdAt: new Date("2026-04-01T00:00:00Z"),
  }),
];

describe("searchInstances", () => {
  it("eq operator should filter by exact value", () => {
    const result = searchInstances(instances, {
      filters: [{ field: "status", operator: "eq", value: "paused" }],
    });
    expect(result.instances.map((i) => i.instanceId)).toEqual(["i3"]);
  });

  it("in operator should match any of the values", () => {
    const result = searchInstances(instances, {
      filters: [
        { field: "status", operator: "in", value: ["running", "paused"] },
      ],
    });
    expect(result.instances).toHaveLength(3);
  });

  it("gt operator on searchAttributes nested field", () => {
    const result = searchInstances(instances, {
      filters: [
        { field: "searchAttributes.amount", operator: "gt", value: 1000 },
      ],
    });
    expect(result.instances.map((i) => i.instanceId).sort()).toEqual([
      "i2",
      "i3",
    ]);
  });

  it("between operator on createdAt with ISO strings", () => {
    const result = searchInstances(instances, {
      filters: [
        {
          field: "createdAt",
          operator: "between",
          value: ["2026-01-15", "2026-03-15"],
        },
      ],
    });
    expect(result.instances.map((i) => i.instanceId).sort()).toEqual([
      "i2",
      "i3",
    ]);
  });

  it("contains operator should match substrings", () => {
    const result = searchInstances(instances, {
      filters: [
        { field: "workflowId", operator: "contains", value: "registration" },
      ],
    });
    expect(result.instances).toHaveLength(2);
  });

  it("multiple filters combine with AND", () => {
    const result = searchInstances(instances, {
      filters: [
        { field: "status", operator: "eq", value: "running" },
        { field: "workflowId", operator: "eq", value: "order-processing" },
      ],
    });
    expect(result.instances.map((i) => i.instanceId)).toEqual(["i1"]);
  });

  it("sort should order results", () => {
    const result = searchInstances(instances, {
      sort: [{ field: "createdAt", order: "desc" }],
    });
    expect(result.instances.map((i) => i.instanceId)).toEqual([
      "i4",
      "i3",
      "i2",
      "i1",
    ]);
  });

  it("pagination should slice results and report totals", () => {
    const result = searchInstances(instances, {
      sort: [{ field: "createdAt", order: "asc" }],
      page: 2,
      pageSize: 2,
    });
    expect(result.instances.map((i) => i.instanceId)).toEqual(["i3", "i4"]);
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 2,
      totalCount: 4,
      totalPages: 2,
    });
  });

  it("pageSize should be capped at 100", () => {
    const result = searchInstances(instances, { pageSize: 5000 });
    expect(result.pagination.pageSize).toBe(100);
  });

  it("aggregations should count by status and workflow", () => {
    const result = searchInstances(instances, {});
    expect(result.aggregations.byStatus).toEqual({
      running: 2,
      completed: 1,
      paused: 1,
    });
    expect(result.aggregations.byWorkflow).toEqual({
      "order-processing": 2,
      "user-registration": 2,
    });
  });

  it("unknown operator should throw", () => {
    expect(() =>
      searchInstances(instances, {
        filters: [{ field: "status", operator: "regex" as any, value: ".*" }],
      }),
    ).toThrow(/Unsupported operator/);
  });
});
