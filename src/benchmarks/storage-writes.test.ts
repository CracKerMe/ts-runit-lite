// oxlint-disable no-explicit-any -- benchmark file uses dynamic shapes
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../model/Instance";
import { LocalFileStorage } from "../storage/LocalFileStorage";
import { MemoryStorage } from "../storage/MemoryStorage";
import type { NodeMetrics } from "../storage/StorageProvider";

/**
 * 磁盘写入路径的基准。
 *
 * `hot-paths.test.ts` 只测 MemoryStorage——也就是 clone 成本，磁盘路径从未被
 * 测量过。本文件补上这一块，为存储层吞吐改造提供可对比的基线：
 *
 *   1. casUpdateInstance 的 ops/s（实例携带 200 条 history）
 *   2. updateNodeMetrics 的 ops/s **与累计写入字节数**
 *      —— 字节数是关键指标：当前 updateNodeMetrics 会重写整份
 *      metrics/<instanceId>.json（含所有其他节点），总写入量是 Θ(nodes²)。
 *      拆成每节点一个文件后应退化为线性。
 *   3. 完整节点循环：updateNodeMetrics×2 + casUpdateInstance
 *   4. 以上在 fsyncOnWrite: true 下再跑一遍
 *
 * 断言刻意放宽——目的是产出数字并守住"没有严重劣化"的底线，真正的信号是
 * 打印出来的 ops/s 与字节数增长曲线。
 */

/** 递归累加一个目录下所有文件的字节数。 */
function dirBytes(dir: string): number {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirBytes(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

/**
 * 统计一段异步操作期间 fs.promises.rename 的调用次数。
 *
 * rename 是 persist() 的落盘动作，一次 rename == 一次整文件重写，因此它是
 * 写放大最直接的计数器（区别于字节数，它衡量的是"写了几次"而非"写了多少"）。
 */
async function countRenames<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; renames: number }> {
  const original = fs.promises.rename;
  let renames = 0;
  (fs.promises as any).rename = async (...args: any[]) => {
    renames++;
    return (original as any)(...args);
  };
  try {
    const result = await fn();
    return { result, renames };
  } finally {
    (fs.promises as any).rename = original;
  }
}

/**
 * 统计一段异步操作期间**累计写入**的字节数。
 *
 * 这是衡量 Θ(nodes²) 的正确指标——不是最终留在磁盘上的字节数（那只是最后
 * 一次写入的大小，两种布局下都差不多），而是"一共往磁盘上写了多少"。
 *
 * persist() 有两条写入路径：默认的 fs.promises.writeFile，以及 fsyncOnWrite
 * 时的 FileHandle.writeFile。两条都要拦截，否则 fsync 模式下计数为 0。
 */
async function countBytesWritten<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; bytes: number; writes: number }> {
  const originalWriteFile = fs.promises.writeFile;
  const originalOpen = fs.promises.open;
  let bytes = 0;
  let writes = 0;

  const record = (data: unknown): void => {
    writes++;
    bytes += typeof data === "string" ? Buffer.byteLength(data) : 0;
  };

  (fs.promises as any).writeFile = async (
    file: any,
    data: any,
    ...rest: any[]
  ) => {
    record(data);
    return (originalWriteFile as any)(file, data, ...rest);
  };
  (fs.promises as any).open = async (...args: any[]) => {
    const handle = await (originalOpen as any)(...args);
    const handleWriteFile = handle.writeFile.bind(handle);
    handle.writeFile = async (data: any, ...rest: any[]) => {
      record(data);
      return handleWriteFile(data, ...rest);
    };
    return handle;
  };

  try {
    const result = await fn();
    return { result, bytes, writes };
  } finally {
    (fs.promises as any).writeFile = originalWriteFile;
    (fs.promises as any).open = originalOpen;
  }
}

async function timeItAsync(
  label: string,
  iterations: number,
  fn: (i: number) => Promise<void>,
): Promise<number> {
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) await fn(i);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  const opsPerSec = Math.round((iterations / elapsedMs) * 1000);
  console.log(
    `  ${label}: ${elapsedMs.toFixed(1)}ms for ${iterations} ops ` +
      `(${opsPerSec.toLocaleString()} ops/s)`,
  );
  return elapsedMs;
}

function makeInstance(historyLength: number): WorkflowInstance {
  return {
    instanceId: "bench-inst",
    workflowId: "wf-bench",
    currentNodes: ["node-1"],
    status: "running",
    context: {
      payload: { items: Array.from({ length: 20 }, (_, i) => ({ i })) },
    },
    history: Array.from({ length: historyLength }, (_, i) => ({
      timestamp: new Date(1_700_000_000_000 + i),
      nodeId: `node-${i}`,
      status: "completed",
      message: `step ${i}`,
    })) as any,
    createdAt: new Date(1_700_000_000_000),
    updatedAt: new Date(1_700_000_000_000),
    retries: {},
    state: { nodes: {} },
  } as WorkflowInstance;
}

function makeNodeMetrics(nodeId: string, status: NodeMetrics["status"]) {
  return {
    nodeId,
    nodeType: "action",
    startTime: 1_700_000_000_000,
    endTime: status === "completed" ? 1_700_000_000_500 : undefined,
    duration: status === "completed" ? 500 : undefined,
    retryCount: 0,
    status,
  } satisfies NodeMetrics;
}

describe("LocalFileStorage — write path throughput", () => {
  let directory: string;
  let storage: LocalFileStorage;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "tswe-bench-"));
  });

  afterEach(async () => {
    await storage?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("casUpdateInstance (history=200)", async () => {
    storage = new LocalFileStorage(directory);
    await storage.connect();

    const instance = makeInstance(200);
    await storage.saveInstance(instance);

    const ITERATIONS = 500;
    const { result: elapsed } = await countRenames(() =>
      timeItAsync("casUpdateInstance (history=200)", ITERATIONS, async (i) => {
        await storage.casUpdateInstance({
          ...instance,
          version: i + 1,
          currentNodes: [`node-${i}`],
        } as WorkflowInstance);
      }),
    );

    expect(elapsed).toBeLessThan(60_000);
  });

  /**
   * 这是证明 Θ(nodes²) 是否被修掉的核心基准。
   *
   * 当前实现下，第 k 个节点的 metrics 写入会重写前 k 个节点的全部 metrics，
   * 因此累计字节数 ~ O(n²)。按节点拆文件后应 ~ O(n)。
   *
   * 我们测两个规模并打印比值：规模翻倍时，平方级增长的比值 ~4x，线性 ~2x。
   */
  it("updateNodeMetrics — cumulative bytes written vs node count", async () => {
    async function measure(nodeCount: number): Promise<{
      written: number;
      writes: number;
      onDisk: number;
      elapsedMs: number;
    }> {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tswe-bench-m-"));
      const store = new LocalFileStorage(dir);
      await store.connect();
      await store.saveInstance({
        ...makeInstance(0),
        instanceId: "metrics-inst",
      } as WorkflowInstance);

      const started = process.hrtime.bigint();
      const { bytes, writes } = await countBytesWritten(async () => {
        for (let i = 0; i < nodeCount; i++) {
          await store.updateNodeMetrics(
            "metrics-inst",
            `node-${i}`,
            makeNodeMetrics(`node-${i}`, "running"),
          );
          await store.updateNodeMetrics(
            "metrics-inst",
            `node-${i}`,
            makeNodeMetrics(`node-${i}`, "completed"),
          );
        }
      });
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

      const onDisk = dirBytes(path.join(dir, "metrics"));
      await store.close();
      fs.rmSync(dir, { recursive: true, force: true });
      return { written: bytes, writes, onDisk, elapsedMs };
    }

    // 这个用例自己管理临时目录；给 afterEach 一个可关闭的实例
    storage = new LocalFileStorage(directory);
    await storage.connect();

    const small = await measure(50);
    const large = await measure(100);

    // 关键区分：
    //  - onDisk  = 最终静止在磁盘上的字节数，两种布局下都差不多（≈一份记录）
    //  - written = 累计写入磁盘的字节数，这才是 Θ(nodes²) 暴露的地方
    console.log(
      `  metrics  50 nodes: ${small.writes} writes, ` +
        `${small.written.toLocaleString()} bytes WRITTEN, ` +
        `${small.onDisk.toLocaleString()} bytes on disk, ${small.elapsedMs.toFixed(1)}ms`,
    );
    console.log(
      `  metrics 100 nodes: ${large.writes} writes, ` +
        `${large.written.toLocaleString()} bytes WRITTEN, ` +
        `${large.onDisk.toLocaleString()} bytes on disk, ${large.elapsedMs.toFixed(1)}ms`,
    );

    const ratio = large.written / Math.max(small.written, 1);
    console.log(
      `  CUMULATIVE bytes-written growth (100 vs 50 nodes): ` +
        `${ratio.toFixed(2)}x  (linear≈2.00x, quadratic≈4.00x)`,
    );

    // 防劣化下限。拆成每节点一个文件后这个比值应当落到 ~2x；
    // 现状（整份记录重写）应当接近 4x。不在此硬断言方向，避免把 CI
    // 绑死在某一个实现上——数字本身才是信号。
    expect(large.writes).toBeGreaterThan(0);
    expect(large.elapsedMs).toBeLessThan(60_000);
  });

  it("full node loop — 2x updateNodeMetrics + casUpdateInstance", async () => {
    storage = new LocalFileStorage(directory);
    await storage.connect();

    const instance = makeInstance(200);
    await storage.saveInstance(instance);

    const NODES = 200;
    const { bytes } = await countBytesWritten(async () => {
      const { renames } = await countRenames(async () => {
        await timeItAsync("full node loop", NODES, async (i) => {
          await storage.updateNodeMetrics(
            "bench-inst",
            `node-${i}`,
            makeNodeMetrics(`node-${i}`, "running"),
          );
          await storage.updateNodeMetrics(
            "bench-inst",
            `node-${i}`,
            makeNodeMetrics(`node-${i}`, "completed"),
          );
          await storage.casUpdateInstance({
            ...instance,
            version: i + 1,
            currentNodes: [`node-${i}`],
          } as WorkflowInstance);
        });
      });

      console.log(
        `  full node loop: ${renames} renames for ${NODES} nodes ` +
          `(${(renames / NODES).toFixed(2)} writes/node)`,
      );
      expect(renames).toBeGreaterThan(0);
    });

    console.log(
      `  full node loop: ${bytes.toLocaleString()} cumulative bytes written ` +
        `(${Math.round(bytes / NODES).toLocaleString()} bytes/node)`,
    );
  });

  /**
   * 并发写同一条记录时的写合并效果。
   *
   * 热路径上编排器是逐个 await 的，很少有可合并的窗口；真正受益的是并发
   * 场景——并行分支同时推进同一个实例、或 load-test 那样的批量启动。
   */
  it("write coalescing — concurrent writes to one key", async () => {
    for (const burst of [10, 50, 200]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tswe-bench-c-"));
      const store = new LocalFileStorage(dir);
      await store.connect();

      const started = process.hrtime.bigint();
      const { renames } = await countRenames(async () => {
        await Promise.all(
          Array.from({ length: burst }, (_, i) =>
            store.saveInstance({
              ...makeInstance(0),
              instanceId: "hot",
              context: { n: i },
            } as WorkflowInstance),
          ),
        );
      });
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

      console.log(
        `  burst=${String(burst).padStart(3)}  renames=${String(renames).padStart(3)}  ` +
          `(${(burst / Math.max(renames, 1)).toFixed(1)}x fewer writes)  ${elapsedMs.toFixed(1)}ms`,
      );

      await store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }

    storage = new LocalFileStorage(directory);
    await storage.connect();
  });

  it("fsyncOnWrite: true — same three paths", async () => {
    storage = new LocalFileStorage({ directory, fsyncOnWrite: true });
    await storage.connect();

    const instance = makeInstance(200);
    await storage.saveInstance(instance);

    const ITERATIONS = 200;
    await timeItAsync(
      "casUpdateInstance (fsync=true, history=200)",
      ITERATIONS,
      async (i) => {
        await storage.casUpdateInstance({
          ...instance,
          version: i + 1,
          currentNodes: [`node-${i}`],
        } as WorkflowInstance);
      },
    );

    await timeItAsync(
      "updateNodeMetrics (fsync=true)",
      ITERATIONS,
      async (i) => {
        await storage.updateNodeMetrics(
          "bench-inst",
          `node-${i}`,
          makeNodeMetrics(`node-${i}`, "completed"),
        );
      },
    );

    const elapsed = await timeItAsync(
      "full node loop (fsync=true)",
      ITERATIONS,
      async (i) => {
        await storage.updateNodeMetrics(
          "bench-inst",
          `n-${i}`,
          makeNodeMetrics(`n-${i}`, "running"),
        );
        await storage.updateNodeMetrics(
          "bench-inst",
          `n-${i}`,
          makeNodeMetrics(`n-${i}`, "completed"),
        );
        await storage.casUpdateInstance({
          ...instance,
          version: ITERATIONS + i + 1,
          currentNodes: [`n-${i}`],
        } as WorkflowInstance);
      },
    );

    expect(elapsed).toBeLessThan(120_000);
  });
});

/**
 * 启动恢复的耗时。
 *
 * 这不提升稳态吞吐，但直接决定"多少实例还能开得起机"——几万条记录时
 * connect() 本身就是可用规模的天花板。
 */
describe("LocalFileStorage — startup restore", () => {
  it("connect() with a populated data directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tswe-bench-r-"));
    const seed = new LocalFileStorage(dir);
    await seed.connect();

    const RECORDS = 3000;
    for (let i = 0; i < RECORDS; i++) {
      await seed.saveInstance({
        ...makeInstance(20),
        instanceId: `inst-${i}`,
      } as WorkflowInstance);
      await seed.updateNodeMetrics(
        `inst-${i}`,
        "n1",
        makeNodeMetrics("n1", "completed"),
      );
    }
    await seed.close();

    const reopened = new LocalFileStorage(dir);
    const started = process.hrtime.bigint();
    await reopened.connect();
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    const restored = await reopened.listInstances();
    console.log(
      `  connect() restored ${restored.length} instances + ${RECORDS} metrics ` +
        `in ${elapsedMs.toFixed(1)}ms (${Math.round((RECORDS / elapsedMs) * 1000).toLocaleString()} records/s)`,
    );
    expect(restored).toHaveLength(RECORDS);

    await reopened.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

/**
 * 查询路径：二级索引的收益。
 *
 * 索引只在"过滤后的结果集远小于总量"时有意义——那恰好是生产上的常态
 * （几万条实例里查某个 workflow 的第一页）。选择度越高收益越大。
 */
describe("MemoryStorage — indexed query throughput", () => {
  it("queryInstances at 50k instances, varying selectivity", async () => {
    const storage = new MemoryStorage();
    await storage.connect();

    const TOTAL = 50_000;
    for (let i = 0; i < TOTAL; i++) {
      await storage.saveInstance({
        instanceId: `inst-${i}`,
        // 1 条命中 wf-rare，5% 命中 wf-warm，其余 wf-bulk
        workflowId: i === 0 ? "wf-rare" : i % 20 === 0 ? "wf-warm" : "wf-bulk",
        currentNodes: [],
        status: i % 3 === 0 ? "completed" : "running",
        context: {},
        history: [],
        createdAt: new Date(1_700_000_000_000 + i),
        updatedAt: new Date(1_700_000_000_000 + i),
      } as WorkflowInstance);
    }

    for (const [label, workflowId] of [
      ["1 of 50k    ", "wf-rare"],
      ["2.5k of 50k ", "wf-warm"],
      ["47k of 50k  ", "wf-bulk"],
    ] as const) {
      await timeItAsync(`queryInstances ${label}`, 200, async () => {
        await storage.queryInstances({ workflowId, page: 1, pageSize: 50 });
      });
    }

    // 无过滤条件：退回全量扫描，作为对照
    await timeItAsync("queryInstances no filter ", 200, async () => {
      await storage.queryInstances({ page: 1, pageSize: 50 });
    });

    await storage.close();
  });
});
