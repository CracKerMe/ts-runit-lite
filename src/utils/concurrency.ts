/**
 * 有界并发工具。
 *
 * 用于替换 `for (const x of xs) { await f(x) }` 这类串行 await 循环：
 * 串行循环的总延迟是 N × 单次往返，在启动恢复（读取成千上万个 JSON 文件）
 * 和指标聚合（逐实例加载指标）这类路径上会成为主要瓶颈。
 *
 * 之所以不直接用 `Promise.all(xs.map(f))`：那会一次性发起 N 个并发操作，
 * 在文件描述符和内存上都没有上限。
 */

/** 默认并发度。兼顾磁盘 I/O 吞吐与文件描述符占用。 */
export const DEFAULT_CONCURRENCY = 16;

/**
 * 启动恢复时的并发度，可用 `STORAGE_RESTORE_CONCURRENCY` 覆盖。
 *
 * 默认的 16 对机械盘是稳妥值，但对 NVMe 偏保守；实例数上万时，
 * `connect()` 的耗时本身就会成为可用规模的天花板。
 */
export function getRestoreConcurrency(): number {
  const raw = process.env.STORAGE_RESTORE_CONCURRENCY;
  if (!raw) return DEFAULT_CONCURRENCY;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONCURRENCY;
}

/**
 * 以受限并发对 `items` 逐项执行 `worker`，返回与输入顺序一致的结果数组。
 *
 * 任意一项抛错都会导致整体 reject（语义与 `Promise.all` 一致）。
 * 需要「单项失败不影响整体」时，请在 `worker` 内部自行捕获。
 *
 * @param items 待处理项
 * @param worker 单项处理函数，接收元素与其下标
 * @param concurrency 最大并发数，非正数会被归一为 1
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<R[]> {
  if (items.length === 0) return [];

  const limit = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  const results: R[] = Array.from({ length: items.length });
  let nextIndex = 0;

  // 启动 `limit` 条流水线，每条不断领取下一个未处理的下标，
  // 直到队列耗尽。相比分批（chunk）执行，慢任务不会阻塞整批。
  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * 与 `mapWithConcurrency` 相同，但不保留返回值。
 * 用于只关心副作用的场景（如恢复时逐条写入内存索引）。
 */
export async function forEachWithConcurrency<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<void> {
  await mapWithConcurrency(items, worker, concurrency);
}
