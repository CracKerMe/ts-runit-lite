import { beforeEach, describe, expect, it } from "vitest";
import { SearchAttributeTracker } from "../../engine/SearchAttributeTracker";

describe("SearchAttributeTracker – large result sets", () => {
  let manager: SearchAttributeTracker;

  beforeEach(() => {
    manager = new SearchAttributeTracker();
    manager.registerAttribute({ name: "region", type: "keyword" });
  });

  function indexMany(count: number, status = "running"): void {
    for (let i = 0; i < count; i++) {
      manager.index(
        `inst-${i}`,
        { region: i % 2 === 0 ? "eu" : "us" },
        { workflowId: "wf-1", status },
      );
    }
  }

  it("returns the true count beyond 10000 matches", () => {
    // 回归守卫：count() 曾实现为 query({...q, limit: 10000}).length，
    // 超过一万条时返回被截断的 10000——一个错误的数字，而不只是慢。
    indexMany(15_000);

    expect(manager.count({ workflowId: "wf-1" })).toBe(15_000);
    expect(manager.count({ status: ["running"] })).toBe(15_000);
    expect(manager.count({ attributes: { region: "eu" } })).toBe(7500);
  });

  it("does not let the query offset distort count()", () => {
    // 回归守卫：旧实现把调用方的 offset 一起透传给 query，
    // 于是 count 会少算掉被跳过的那部分。
    indexMany(100);

    expect(manager.count({ workflowId: "wf-1", offset: 40 })).toBe(100);
  });

  it("returns zero for a query matching nothing", () => {
    indexMany(10);
    expect(manager.count({ workflowId: "does-not-exist" })).toBe(0);
  });

  it("keeps query pagination semantics intact", () => {
    indexMany(50);

    const firstPage = manager.query({ workflowId: "wf-1", limit: 10 });
    const secondPage = manager.query({
      workflowId: "wf-1",
      offset: 10,
      limit: 10,
    });

    expect(firstPage).toHaveLength(10);
    expect(secondPage).toHaveLength(10);
    // 两页不能重叠
    expect(firstPage.filter((id) => secondPage.includes(id))).toEqual([]);
    // 且合起来是前 20 条
    expect([...firstPage, ...secondPage]).toEqual(
      Array.from({ length: 20 }, (_, i) => `inst-${i}`),
    );
  });

  it("applies combined filters consistently in query and count", () => {
    indexMany(200);
    manager.index(
      "odd-one",
      { region: "eu" },
      { workflowId: "wf-2", status: "failed" },
    );

    const q = { workflowId: "wf-1", attributes: { region: "eu" } };
    expect(manager.count(q)).toBe(100);
    expect(manager.query({ ...q, limit: 1_000_000 })).toHaveLength(100);
  });

  it("handles an offset past the end of the result set", () => {
    indexMany(10);
    expect(
      manager.query({ workflowId: "wf-1", offset: 50, limit: 10 }),
    ).toEqual([]);
  });
});
