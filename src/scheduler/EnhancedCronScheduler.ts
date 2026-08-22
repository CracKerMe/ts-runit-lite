// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import { schedule as nodeCronSchedule, type ScheduledTask } from "node-cron";
import {
  calculateJitter,
  DEFAULT_SCHEDULE_POLICY,
  isInTimeWindow,
  type OverlapPolicy,
  type Schedule,
  type SchedulePolicy,
  type ScheduleSpec,
  shouldRunAction,
} from "../model/Schedule";
import type { StorageProvider } from "../storage/StorageProvider";
import { createLeaseStore } from "../utils/LeaseStore";
import { Logger } from "../utils/Logger";

export interface EnhancedCronStartableEngine {
  start(workflowId: string, context?: Record<string, any>): Promise<string>;
}

interface RunningAction {
  workflowId: string;
  instanceId: string;
  startTime: Date;
}

export class EnhancedCronScheduler {
  private schedules: Map<string, Schedule> = new Map();
  private runningActions: Map<string, RunningAction[]> = new Map();
  private instanceJobs: Record<string, ScheduledTask> = {};
  private lastCompletionResults: Map<string, any> = new Map();
  private lastFailures: Map<string, any> = new Map();

  constructor(_storage?: StorageProvider) {
    createLeaseStore();
  }

  createSchedule(
    scheduleId: string,
    workflowId: string,
    spec: ScheduleSpec,
    policy?: SchedulePolicy,
  ): Schedule {
    const schedule: Schedule = {
      id: scheduleId,
      workflowId,
      spec,
      policy,
      paused: false,
    };
    this.schedules.set(scheduleId, schedule);
    Logger.info("system", "scheduler", `Schedule created: ${scheduleId}`);
    return schedule;
  }

  async startSchedule(
    scheduleId: string,
    engine: EnhancedCronStartableEngine,
  ): Promise<void> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) {
      throw new Error(`Schedule not found: ${scheduleId}`);
    }

    if (schedule.spec.interval) {
      const task = nodeCronSchedule(schedule.spec.interval, async () => {
        await this.executeScheduleAction(schedule, engine);
      });
      this.instanceJobs[scheduleId] = task;
    }
  }

  private async executeScheduleAction(
    scheduleItem: Schedule,
    engine: EnhancedCronStartableEngine,
  ): Promise<void> {
    // 检查暂停状态：paused 为 true 时直接跳过，不执行任何动作
    if (scheduleItem.paused) {
      Logger.debug(
        "system",
        "scheduler",
        `Action skipped: schedule is paused: ${scheduleItem.id}`,
      );
      return;
    }

    const effectivePolicy = {
      overlap: "skip" as OverlapPolicy,
      catchupWindow: 86400000,
      ...scheduleItem.policy,
    };

    const runningCount =
      this.runningActions.get(scheduleItem.workflowId)?.length ?? 0;

    if (!shouldRunAction(effectivePolicy, runningCount)) {
      Logger.debug(
        "system",
        "scheduler",
        `Action skipped due to overlap policy: ${scheduleItem.id}`,
      );
      return;
    }

    // For cancel_other / terminate_other: clear the tracked running list so
    // the new execution is treated as the sole active run. Callers are
    // responsible for actually cancelling the engine instances if needed.
    if (
      runningCount > 0 &&
      (effectivePolicy.overlap === "cancel_other" ||
        effectivePolicy.overlap === "terminate_other")
    ) {
      const displaced = this.runningActions.get(scheduleItem.workflowId) ?? [];
      Logger.info(
        "system",
        "scheduler",
        `Overlap policy '${effectivePolicy.overlap}': displacing ${displaced.length} running action(s) for ${scheduleItem.id}`,
        { instanceIds: displaced.map((r) => r.instanceId) },
      );
      this.runningActions.set(scheduleItem.workflowId, []);
    }

    if (!isInTimeWindow(scheduleItem.spec)) {
      Logger.debug(
        "system",
        "scheduler",
        `Action skipped: outside time window: ${scheduleItem.id}`,
      );
      return;
    }

    let delay = 0;
    if (scheduleItem.spec.jitter) {
      delay = calculateJitter(scheduleItem.spec.jitter);
      Logger.debug(
        "system",
        "scheduler",
        `Jitter applied: ${delay}ms for ${scheduleItem.id}`,
      );
    }

    setTimeout(async () => {
      const instanceId = await engine.start(scheduleItem.workflowId, {
        _scheduleId: scheduleItem.id,
        _lastCompletionResult: this.lastCompletionResults.get(
          scheduleItem.workflowId,
        ),
        _lastFailure: this.lastFailures.get(scheduleItem.workflowId),
      });

      const running: RunningAction = {
        workflowId: scheduleItem.workflowId,
        instanceId,
        startTime: new Date(),
      };

      const existing = this.runningActions.get(scheduleItem.workflowId) ?? [];
      if (effectivePolicy.overlap === "buffer_all") {
        existing.push(running);
        // 必须写回 Map，否则首次执行时局部数组不会被追踪
        this.runningActions.set(scheduleItem.workflowId, existing);
      } else {
        this.runningActions.set(scheduleItem.workflowId, [running]);
      }

      scheduleItem.lastActionTime = new Date();
    }, delay);
  }

  pauseSchedule(scheduleId: string, notes?: string): void {
    const schedule = this.schedules.get(scheduleId);
    if (schedule) {
      schedule.paused = true;
      schedule.notes = notes;
      Logger.info("system", "scheduler", `Schedule paused: ${scheduleId}`);
    }
  }

  resumeSchedule(scheduleId: string, notes?: string): void {
    const schedule = this.schedules.get(scheduleId);
    if (schedule) {
      schedule.paused = false;
      schedule.notes = notes;
      Logger.info("system", "scheduler", `Schedule resumed: ${scheduleId}`);
    }
  }

  async backfill(
    scheduleId: string,
    startTime: Date,
    endTime: Date,
    engine: EnhancedCronStartableEngine,
  ): Promise<void> {
    const scheduleItem = this.schedules.get(scheduleId);
    if (!scheduleItem) {
      throw new Error(`Schedule not found: ${scheduleId}`);
    }

    const catchupWindow =
      scheduleItem.policy?.catchupWindow ??
      DEFAULT_SCHEDULE_POLICY.catchupWindow;
    const now = Date.now();
    // Clamp startTime so we never backfill further back than catchupWindow allows
    const windowStart = new Date(
      Math.max(startTime.getTime(), now - catchupWindow),
    );

    if (windowStart > endTime) {
      Logger.warn(
        "system",
        "scheduler",
        `Backfill skipped: entire range [${startTime.toISOString()}, ${endTime.toISOString()}] is outside catchupWindow (${catchupWindow}ms) for ${scheduleId}`,
      );
      return;
    }

    Logger.info(
      "system",
      "scheduler",
      `Backfilling schedule ${scheduleId} from ${windowStart.toISOString()} to ${endTime.toISOString()}`,
    );

    for (let t = windowStart.getTime(); t <= endTime.getTime(); t += 60000) {
      if (isInTimeWindow({ ...scheduleItem.spec, startTime: new Date(t) })) {
        await this.executeScheduleAction(scheduleItem, engine);
      }
    }
  }

  recordCompletion(workflowId: string, result: unknown): void {
    this.lastCompletionResults.set(workflowId, result);
    const scheduleItem = Array.from(this.schedules.values()).find(
      (s) => s.workflowId === workflowId,
    );
    if (scheduleItem) {
      scheduleItem.lastCompletionResult = result;
    }
  }

  recordFailure(workflowId: string, failure: unknown): void {
    this.lastFailures.set(workflowId, failure);
    const scheduleItem = Array.from(this.schedules.values()).find(
      (s) => s.workflowId === workflowId,
    );
    if (scheduleItem) {
      scheduleItem.lastFailure = failure;
      if (scheduleItem.policy?.pauseOnFailure) {
        this.pauseSchedule(
          scheduleItem.id,
          `Paused due to failure: ${(failure as Error)?.message}`,
        );
      }
    }
  }

  completeAction(workflowId: string, instanceId: string): void {
    const running = this.runningActions.get(workflowId);
    if (running) {
      const index = running.findIndex((r) => r.instanceId === instanceId);
      if (index >= 0) {
        running.splice(index, 1);
      }
    }
  }

  getSchedule(scheduleId: string): Schedule | undefined {
    return this.schedules.get(scheduleId);
  }

  listSchedules(): Schedule[] {
    return Array.from(this.schedules.values());
  }

  deleteSchedule(scheduleId: string): void {
    this.stopSchedule(scheduleId);
    this.schedules.delete(scheduleId);
    Logger.info("system", "scheduler", `Schedule deleted: ${scheduleId}`);
  }

  stopSchedule(scheduleId: string): void {
    if (this.instanceJobs[scheduleId]) {
      this.instanceJobs[scheduleId].stop();
      delete this.instanceJobs[scheduleId];
    }
  }

  stopAll(): void {
    for (const jobId of Object.keys(this.instanceJobs)) {
      this.stopSchedule(jobId);
    }
    Logger.info("system", "scheduler", "All schedules stopped");
  }
}
