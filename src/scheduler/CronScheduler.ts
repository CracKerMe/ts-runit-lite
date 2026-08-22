// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import { type ScheduledTask, schedule } from "node-cron";
import type { StorageProvider } from "../storage/StorageProvider";
import { createLeaseStore, type LeaseStore } from "../utils/LeaseStore";
import { Logger } from "../utils/Logger";

export interface CronStartableEngine {
  start(workflowId: string, context?: Record<string, any>): Promise<string>;
}

export class CronScheduler {
  // 静态 jobs 保持向后兼容
  static jobs: Record<string, ScheduledTask> = {};

  // 实例级别的 jobs
  private instanceJobs: Record<string, ScheduledTask> = {};
  private leaseStore: LeaseStore;
  private readonly leaseHolderId: string;

  constructor(_storage?: StorageProvider, holderId?: string) {
    this.leaseStore = createLeaseStore();
    this.leaseHolderId = holderId ?? `cron-${process.pid}-${Date.now()}`;
  }

  private async shouldRunCronTick(workflowId: string): Promise<boolean> {
    const bucket = Math.floor(Date.now() / 1000);
    const key = `workflow:lease:cron:${workflowId}:${bucket}`;
    const ttlMs = 10000;
    return this.leaseStore.acquire(key, this.leaseHolderId, ttlMs);
  }

  static schedule(
    workflowId: string,
    cronExpression: string,
    engine: CronStartableEngine,
  ) {
    const task = schedule(cronExpression, () => {
      Logger.info("system", "cron", `Triggering workflow: ${workflowId}`);
      engine.start(workflowId).catch((err) => {
        Logger.error(
          "system",
          "cron",
          `Failed to start workflow ${workflowId}`,
          err instanceof Error ? err.stack : String(err),
        );
      });
    });
    CronScheduler.jobs[workflowId] = task;
    Logger.debug(
      "system",
      "cron",
      `Scheduled workflow ${workflowId} with cron: ${cronExpression}`,
    );
  }

  static stop(workflowId: string) {
    if (CronScheduler.jobs[workflowId]) {
      CronScheduler.jobs[workflowId].stop();
      delete CronScheduler.jobs[workflowId];
      Logger.debug(
        "system",
        "cron",
        `Stopped cron job for workflow ${workflowId}`,
      );
    }
  }

  /**
   * 停止所有静态调度任务
   */
  static stopAll(): void {
    const jobIds = Object.keys(CronScheduler.jobs);
    for (const workflowId of jobIds) {
      CronScheduler.stop(workflowId);
    }
    Logger.info("system", "cron", `Stopped ${jobIds.length} cron jobs`);
  }

  /**
   * 实例方法：停止所有任务
   */
  stopAll(): void {
    const jobIds = Object.keys(this.instanceJobs);
    for (const workflowId of jobIds) {
      this.stopJob(workflowId);
    }
    // 同时停止静态任务
    CronScheduler.stopAll();
    Logger.info("system", "cron", "Stopped all cron jobs");
  }

  /**
   * 实例方法：调度任务
   */
  scheduleJob(
    workflowId: string,
    cronExpression: string,
    engine: CronStartableEngine,
  ): void {
    // 如果已存在，先停止
    this.stopJob(workflowId);

    const task = schedule(cronExpression, () => {
      void this.shouldRunCronTick(workflowId).then((shouldRun) => {
        if (!shouldRun) {
          Logger.debug(
            "system",
            "cron",
            `Cron tick skipped due to lock: ${workflowId}`,
          );
          return;
        }

        Logger.info("system", "cron", `Triggering workflow: ${workflowId}`);
        engine.start(workflowId).catch((err) => {
          Logger.error(
            "system",
            "cron",
            `Failed to start workflow ${workflowId}`,
            err instanceof Error ? err.stack : String(err),
          );
        });
      });
    });

    this.instanceJobs[workflowId] = task;
    Logger.debug(
      "system",
      "cron",
      `Scheduled workflow ${workflowId} with cron: ${cronExpression}`,
    );
  }

  /**
   * 实例方法：停止单个任务
   */
  stopJob(workflowId: string): void {
    if (this.instanceJobs[workflowId]) {
      this.instanceJobs[workflowId].stop();
      delete this.instanceJobs[workflowId];
      Logger.debug(
        "system",
        "cron",
        `Stopped cron job for workflow ${workflowId}`,
      );
    }
  }

  /**
   * 获取所有活跃的任务 ID
   */
  getActiveJobs(): string[] {
    return [
      ...Object.keys(this.instanceJobs),
      ...Object.keys(CronScheduler.jobs),
    ];
  }
}
