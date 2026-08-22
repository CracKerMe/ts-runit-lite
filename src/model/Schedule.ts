// oxlint-disable no-explicit-any -- dynamic types used throughout this module
export type OverlapPolicy =
  | "skip"
  | "buffer_one"
  | "buffer_all"
  | "cancel_other"
  | "terminate_other"
  | "allow_all";

/** Daily time window expressed as "HH:MM" strings (24-hour). */
export interface TimeWindow {
  /** Inclusive start time, e.g. "08:00" */
  start: string;
  /** Inclusive end time, e.g. "18:00" */
  end: string;
}

export interface ScheduleSpec {
  interval?: string;
  startTime?: Date;
  endTime?: Date;
  jitter?: number;
  timezone?: string;
  /**
   * Optional daily time window. When set, the scheduler will only fire
   * if the current wall-clock time (in the local timezone) falls within
   * [start, end] (both inclusive, HH:MM format).
   */
  timeWindow?: TimeWindow;
}

export interface SchedulePolicy {
  overlap?: OverlapPolicy;
  catchupWindow?: number;
  pauseOnFailure?: boolean;
  maxActions?: number;
}

export interface Schedule {
  id: string;
  workflowId: string;
  spec: ScheduleSpec;
  policy?: SchedulePolicy;
  paused?: boolean;
  notes?: string;
  lastActionTime?: Date;
  lastCompletionResult?: any;
  lastFailure?: any;
}

export const DEFAULT_SCHEDULE_POLICY: Required<SchedulePolicy> = {
  overlap: "skip",
  catchupWindow: 86400000,
  pauseOnFailure: false,
  maxActions: 0,
};

export function shouldRunAction(
  policy: SchedulePolicy,
  runningCount: number,
): boolean {
  const effectivePolicy = { ...DEFAULT_SCHEDULE_POLICY, ...policy };
  const { overlap, maxActions } = effectivePolicy;

  if (maxActions > 0 && runningCount >= maxActions) {
    return false;
  }

  switch (overlap) {
    case "skip":
      return runningCount === 0;
    case "buffer_one":
    case "buffer_all":
    case "cancel_other":
    case "terminate_other":
      return true;
    case "allow_all":
      return true;
    default:
      return runningCount === 0;
  }
}

export function calculateJitter(jitter: number): number {
  return Math.floor(Math.random() * jitter);
}

export function isInTimeWindow(
  spec: ScheduleSpec,
  now: Date = new Date(),
): boolean {
  if (spec.startTime && now < spec.startTime) {
    return false;
  }
  if (spec.endTime && now > spec.endTime) {
    return false;
  }
  if (spec.timeWindow) {
    const { start, end } = spec.timeWindow;
    const [startHour, startMin] = start.split(":").map(Number);
    const [endHour, endMin] = end.split(":").map(Number);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    if (nowMinutes < startMinutes || nowMinutes > endMinutes) {
      return false;
    }
  }
  return true;
}
