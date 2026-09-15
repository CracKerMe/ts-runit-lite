import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { MemoryStorage } from "../MemoryStorage";

/**
 * 回归测试：排序必须发生在分页之前。
 *
 * 此前 `queryInstances` 先按 Map 插入序切片，再由服务层对已切好的那一页排序，
 * 导致翻页时出现重复行与丢失行。
 */

function makeInstance(
  id: string,
  createdAtMs: number,
  workflowId = "wf-1",
): WorkflowInstance {
  return {
    instanceId: id,
    workflowId,
    currentNodes: ["node-1"],
    status: "running",
    context: {},
    history: [],
    createdAt: new Date(createdAtMs),
    updatedAt: new Date(createdAtMs),
    retries: {},
    state: { nodes: {} },
  };
}

describe("MemoryStorage.queryInstances — sort before paginate", () => {
  let storage: MemoryStorage;

  const TOTAL = 25;
  const PAGE_SIZE = 10;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.connect();

    // 以打乱的插入顺序写入，确保 Map 插入序与 createdAt 序不一致。
    // 若排序发生在切片之后，这一点就会暴露出来。
    const order = [
      12, 3, 24, 0, 18, 7, 21, 1, 15, 9, 4, 22, 11, 2, 19, 6, 23, 8, 16, 5, 20,
      10, 17, 13, 14,
    ];
    for (const i of order) {
      // createdAt 与序号反向，进一步区分插入序与排序结果
      await storage.saveInstance(
        makeInstance(
          `inst-${String(i).padStart(2, "0")}`,
          1_700_000_000_000 + i * 1000,
        ),
      );
    }
  });

  async function collectAllPages(
    sortBy: "createdAt" | "updatedAt" | "status",
    sortOrder: "asc" | "desc",
  ): Promise<string[]> {
    const ids: string[] = [];
    const pages = Math.ceil(TOTAL / PAGE_SIZE);
    for (let page = 1; page <= pages; page++) {
      const { instances } = await storage.queryInstances({
        page,
        pageSize: PAGE_SIZE,
        sortBy,
        sortOrder,
      });
      ids.push(...instances.map((i) => i.instanceId));
    }
    return ids;
  }

  it("paginates a sorted set without duplicating or dropping rows", async () => {
    const ids = await collectAllPages("createdAt", "asc");

    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
  });

  it("returns globally sorted order across page boundaries (asc)", async () => {
    const ids = await collectAllPages("createdAt", "asc");

    const expected = Array.from(
      { length: TOTAL },
      (_, i) => `inst-${String(i).padStart(2, "0")}`,
    );
    expect(ids).toEqual(expected);
  });

  it("returns globally sorted order across page boundaries (desc)", async () => {
    const ids = await collectAllPages("createdAt", "desc");

    const expected = Array.from(
      { length: TOTAL },
      (_, i) => `inst-${String(TOTAL - 1 - i).padStart(2, "0")}`,
    );
    expect(ids).toEqual(expected);
  });

  it("page 2 contains the globally-2nd page, not a re-sorted arbitrary window", async () => {
    const { instances } = await storage.queryInstances({
      page: 2,
      pageSize: PAGE_SIZE,
      sortBy: "createdAt",
      sortOrder: "asc",
    });

    expect(instances.map((i) => i.instanceId)).toEqual([
      "inst-10",
      "inst-11",
      "inst-12",
      "inst-13",
      "inst-14",
      "inst-15",
      "inst-16",
      "inst-17",
      "inst-18",
      "inst-19",
    ]);
  });

  it("defaults to a deterministic order when no sort is requested", async () => {
    const first = await storage.queryInstances({
      page: 1,
      pageSize: PAGE_SIZE,
    });
    const second = await storage.queryInstances({
      page: 1,
      pageSize: PAGE_SIZE,
    });

    expect(first.instances.map((i) => i.instanceId)).toEqual(
      second.instances.map((i) => i.instanceId),
    );
    // 默认 createdAt desc
    expect(first.instances[0]!.instanceId).toBe("inst-24");
  });

  it("reports the full matching total, not the page length", async () => {
    const { instances, total } = await storage.queryInstances({
      page: 1,
      pageSize: PAGE_SIZE,
    });

    expect(instances).toHaveLength(PAGE_SIZE);
    expect(total).toBe(TOTAL);
  });

  it("applies sorting after filtering, over the filtered set only", async () => {
    await storage.saveInstance(
      makeInstance("other-1", 1_700_000_999_000, "wf-2"),
    );

    const { instances, total } = await storage.queryInstances({
      workflowId: "wf-2",
      page: 1,
      pageSize: PAGE_SIZE,
      sortBy: "createdAt",
      sortOrder: "desc",
    });

    expect(total).toBe(1);
    expect(instances.map((i) => i.instanceId)).toEqual(["other-1"]);
  });
});
