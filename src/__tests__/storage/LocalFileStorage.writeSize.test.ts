import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendHistory, type WorkflowInstance } from "../../model/Instance";
import { LocalFileStorage } from "../../storage/LocalFileStorage";

describe("LocalFileStorage – persisted payload size", () => {
  let directory: string;
  let storage: LocalFileStorage;
  const savedMax = process.env.MAX_INSTANCE_HISTORY;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "tswe-size-"));
    storage = new LocalFileStorage(directory);
    await storage.connect();
  });

  afterEach(async () => {
    await storage.close();
    fs.rmSync(directory, { recursive: true, force: true });
    if (savedMax === undefined) delete process.env.MAX_INSTANCE_HISTORY;
    else process.env.MAX_INSTANCE_HISTORY = savedMax;
  });

  it("writes compact JSON without indentation", async () => {
    const instance: WorkflowInstance = {
      instanceId: "inst-compact",
      workflowId: "wf",
      currentNodes: ["n1"],
      status: "running",
      context: { a: 1 },
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await storage.saveInstance(instance);

    const raw = await fs.promises.readFile(
      path.join(directory, "instances", "inst-compact.json"),
      "utf8",
    );
    // 缩进后的 JSON 会包含换行 + 前导空格
    expect(raw).not.toMatch(/\n\s+"/);
    // 仍必须是可解析的合法 JSON
    expect(JSON.parse(raw).instanceId).toBe("inst-compact");
  });

  it("keeps the persisted instance bounded as history grows", async () => {
    process.env.MAX_INSTANCE_HISTORY = "20";
    const instance: WorkflowInstance = {
      instanceId: "inst-bounded",
      workflowId: "wf",
      currentNodes: ["n1"],
      status: "running",
      context: {},
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const filePath = path.join(directory, "instances", "inst-bounded.json");
    const sizeAfter = async (): Promise<number> => {
      await storage.saveInstance(instance);
      return (await fs.promises.stat(filePath)).size;
    };

    for (let i = 0; i < 20; i++) {
      appendHistory(instance, {
        nodeId: `node-${i}`,
        timestamp: new Date(),
        status: "success",
      });
    }
    const sizeAtCap = await sizeAfter();

    for (let i = 20; i < 500; i++) {
      appendHistory(instance, {
        nodeId: `node-${i}`,
        timestamp: new Date(),
        status: "success",
      });
    }
    const sizeAfter500 = await sizeAfter();

    // 480 次额外流转后，落盘体积基本持平（仅节点名变长带来的微小差异），
    // 而不是线性增长——这正是 Θ(N²) 写放大的来源。
    expect(sizeAfter500).toBeLessThan(sizeAtCap * 1.3);

    const restored = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    expect(restored.history).toHaveLength(20);
    expect(restored.history.at(-1).nodeId).toBe("node-499");
  });
});
