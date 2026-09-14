import { afterEach, describe, expect, it } from "vitest";
import {
  appendHistory,
  getMaxInstanceHistory,
  type WorkflowInstance,
} from "../Instance";

function makeInstance(): WorkflowInstance {
  return {
    instanceId: "inst-history",
    workflowId: "wf",
    currentNodes: [],
    status: "running",
    context: {},
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("appendHistory", () => {
  const saved = process.env.MAX_INSTANCE_HISTORY;

  afterEach(() => {
    if (saved === undefined) delete process.env.MAX_INSTANCE_HISTORY;
    else process.env.MAX_INSTANCE_HISTORY = saved;
  });

  it("appends entries below the cap without trimming", () => {
    process.env.MAX_INSTANCE_HISTORY = "10";
    const instance = makeInstance();

    for (let i = 0; i < 5; i++) {
      appendHistory(instance, {
        nodeId: `node-${i}`,
        timestamp: new Date(),
        status: "started",
      });
    }

    expect(instance.history).toHaveLength(5);
    expect(instance.history[0].nodeId).toBe("node-0");
  });

  it("trims from the front, keeping the most recent entries", () => {
    // 回归守卫：history 无上限时，每次节点流转都会把整个实例（含完整
    // history）序列化落盘，N 次流转写出 Θ(N²) 字节。
    process.env.MAX_INSTANCE_HISTORY = "50";
    const instance = makeInstance();

    for (let i = 0; i < 100; i++) {
      appendHistory(instance, {
        nodeId: `node-${i}`,
        timestamp: new Date(),
        status: "started",
      });
    }

    expect(instance.history).toHaveLength(50);
    // 保留的是最近 50 条：node-50 .. node-99
    expect(instance.history[0].nodeId).toBe("node-50");
    expect(instance.history.at(-1)?.nodeId).toBe("node-99");
  });

  it("stays bounded across many appends", () => {
    process.env.MAX_INSTANCE_HISTORY = "10";
    const instance = makeInstance();

    for (let i = 0; i < 1000; i++) {
      appendHistory(instance, {
        nodeId: `node-${i}`,
        timestamp: new Date(),
        status: "success",
      });
      expect(instance.history.length).toBeLessThanOrEqual(10);
    }

    expect(instance.history.at(-1)?.nodeId).toBe("node-999");
  });

  it("falls back to the default cap for an invalid env value", () => {
    process.env.MAX_INSTANCE_HISTORY = "abc";
    expect(getMaxInstanceHistory()).toBe(1000);

    process.env.MAX_INSTANCE_HISTORY = "0";
    expect(getMaxInstanceHistory()).toBe(1000);
  });
});
