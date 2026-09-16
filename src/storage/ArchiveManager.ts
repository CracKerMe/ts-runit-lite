import * as fs from "fs";
import * as path from "path";
import { type HookPayload, onHook } from "../event/HookManager";
import { parseEnvInt } from "../utils/env";
import { errorStack, Logger } from "../utils/Logger";
import type { StorageProvider } from "./StorageProvider";

/**
 * ArchiveManager manages the offloading of terminal state instances (completed/failed/cancelled)
 * from hot storage (memory or local files) to date-partitioned local JSON.
 *
 * This lite implementation intentionally keeps the archive local and
 * filesystem-based; it is not a distributed archive backend.
 */
export class ArchiveManager {
  private archiveDir: string;
  private storage?: StorageProvider;
  /** 最近一次已确保存在的日期分区，避免每次归档都发起 mkdir。 */
  private lastEnsuredDate: string | null = null;
  /** 临时文件名去重计数器，防止同毫秒内的并发写互相覆盖。 */
  private tempCounter = 0;
  private unsubscribe: Array<() => void> = [];
  private cleanupTimer?: NodeJS.Timeout;
  private readonly retentionDays: number;
  private readonly cleanupIntervalMs: number;

  constructor(
    storage?: StorageProvider,
    archiveDir?: string,
    options: { retentionDays?: number; cleanupIntervalMs?: number } = {},
  ) {
    this.storage = storage;
    this.archiveDir =
      archiveDir ||
      process.env.ARCHIVE_DIR ||
      path.join(process.cwd(), "archive");
    this.retentionDays =
      options.retentionDays ??
      parseEnvInt(process.env.ARCHIVE_RETENTION_DAYS, 90, { min: 0 });
    this.cleanupIntervalMs =
      options.cleanupIntervalMs ??
      parseEnvInt(process.env.ARCHIVE_CLEANUP_INTERVAL_MS, 21_600_000, {
        min: 1000,
      });
  }

  public initialize(): void {
    if (this.unsubscribe.length > 0) return;

    if (!fs.existsSync(this.archiveDir)) {
      fs.mkdirSync(this.archiveDir, { recursive: true });
    }

    Logger.info(
      "system",
      "ArchiveManager",
      `Initializing archiver... Data goes to ${this.archiveDir}`,
    );

    // Listen to terminal hooks
    const handler = this.handleTerminalState.bind(this);
    this.unsubscribe = [
      onHook("workflow.completed", handler),
      onHook("workflow.failed", handler),
      onHook("workflow.cancelled", handler),
    ];

    void this.cleanupExpiredArchives();
    this.cleanupTimer = setInterval(
      () => void this.cleanupExpiredArchives(),
      this.cleanupIntervalMs,
    );
  }

  public destroy(): void {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.unsubscribe = [];
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private async handleTerminalState(payload: HookPayload) {
    const instanceId = payload.instanceId;
    if (!instanceId) return;

    try {
      // 1. Fetch full instance detail from Storage
      let instanceData: Record<string, unknown> = payload.data || {};
      if (this.storage) {
        const fullInstance = await this.storage.loadInstance(instanceId);
        if (fullInstance) {
          instanceData = fullInstance as unknown as Record<string, unknown>;
        }
      }

      // 2. Archive to disk
      const dateStr = new Date().toISOString().split("T")[0]!; // YYYY-MM-DD
      const dailyDir = await this.ensureDailyDir(dateStr);

      const filePath = path.join(dailyDir, `${instanceId}.json`);
      const archiveContent = {
        _archivedAt: new Date().toISOString(),
        _terminalEvent: payload.event,
        ...instanceData,
      };

      await this.writeAtomic(filePath, archiveContent);

      Logger.debug(
        "system",
        "ArchiveManager",
        `Successfully archived instance ${instanceId} to ${filePath}`,
      );

      // Delete from hot storage now that the instance is safely archived.
      // A failure here must not undo the successful archive above.
      if (this.storage) {
        try {
          await this.storage.deleteInstance(instanceId);
          // metrics 与实例是分开存的，删实例不会带走它们。不清理的话
          // metrics 会随归档量无上限累积在内存和磁盘上。可选方法，
          // 自定义适配器没实现就跳过。
          await this.storage.deleteInstanceMetrics?.(instanceId);
        } catch (deleteError: unknown) {
          Logger.warn(
            "system",
            "ArchiveManager",
            `Archived instance ${instanceId} but failed to evict from hot storage: ${errorStack(deleteError) ?? String(deleteError)}`,
          );
        }
      }
    } catch (error: unknown) {
      Logger.error(
        "system",
        "ArchiveManager",
        `Failed to archive instance ${instanceId}`,
        errorStack(error),
      );
    }
  }

  async cleanupExpiredArchives(now = Date.now()): Promise<number> {
    if (!Number.isFinite(this.retentionDays) || this.retentionDays <= 0) {
      return 0;
    }

    const threshold = now - this.retentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(this.archiveDir, {
        withFileTypes: true,
      });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) {
        continue;
      }
      const directoryTime = Date.parse(`${entry.name}T00:00:00.000Z`);
      if (!Number.isFinite(directoryTime) || directoryTime >= threshold) {
        continue;
      }
      await fs.promises.rm(path.join(this.archiveDir, entry.name), {
        recursive: true,
        force: true,
      });
      deleted++;
    }

    if (deleted > 0) {
      Logger.info(
        "system",
        "ArchiveManager",
        `Removed ${deleted} expired archive directories`,
      );
    }
    return deleted;
  }

  /**
   * 确保当天的归档目录存在，并缓存最近一次创建的日期。
   *
   * 此前这里用的是 `fs.existsSync` + `fs.mkdirSync`：同步调用，
   * 在每个终态实例的异步 hook 里阻塞事件循环两次系统调用，
   * 而目录其实每天才变一次。
   */
  private async ensureDailyDir(dateStr: string): Promise<string> {
    const dailyDir = path.join(this.archiveDir, dateStr);
    if (this.lastEnsuredDate === dateStr) {
      return dailyDir;
    }

    // recursive: true 在目录已存在时是 no-op，无需先 exists 判断
    await fs.promises.mkdir(dailyDir, { recursive: true });
    this.lastEnsuredDate = dateStr;
    return dailyDir;
  }

  private async writeAtomic(filePath: string, value: unknown): Promise<void> {
    // 同一实例的两个终态事件（如 failed 与 cancelled）可能并发触发，
    // 各自的临时文件必须互不冲突，否则会互相覆盖。
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${this.tempCounter++}.tmp`;
    // 不缩进：归档是冷数据，缩进只会放大 I/O 体积
    // （与 LocalFileStorage 的写入策略保持一致）。
    await fs.promises.writeFile(tempPath, JSON.stringify(value), "utf8");
    await fs.promises.rename(tempPath, filePath);
  }
}
