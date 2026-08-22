import type { InstanceStatus } from "../model/Instance";
import { Logger } from "../utils/Logger";

type StateTransitionEvent =
  | "start"
  | "complete"
  | "fail"
  | "rollback"
  | "pause"
  | "resume"
  | "cancel";

function isStateTransitionEvent(event: string): event is StateTransitionEvent {
  return [
    "start",
    "complete",
    "fail",
    "rollback",
    "pause",
    "resume",
    "cancel",
  ].includes(event);
}

export class StateMachine {
  static transition(
    current: InstanceStatus,
    event: StateTransitionEvent,
  ): InstanceStatus {
    const map: Record<InstanceStatus, Record<string, InstanceStatus>> = {
      pending: { start: "running", cancel: "cancelled" },
      running: {
        complete: "completed",
        fail: "failed",
        rollback: "rollback",
        pause: "paused",
        cancel: "cancelled",
      },
      completed: {},
      failed: { rollback: "rollback" },
      rollback: { start: "running", cancel: "cancelled" },
      paused: { resume: "running", cancel: "cancelled" },
      cancelled: {},
    };

    const newStatus = map[current]?.[event];
    if (!newStatus) {
      // 如果状态转换无效，记录警告并返回当前状态
      Logger.warn(
        "system",
        "state-machine",
        `Invalid state transition: ${current} -> ${event}`,
      );
      return current;
    }

    return newStatus;
  }

  static isValidTransition(current: InstanceStatus, event: string): boolean {
    if (!isStateTransitionEvent(event)) {
      return false;
    }
    // transition() returns current when invalid, so compare result != current
    const result = StateMachine.transition(current, event);
    return result !== current;
  }

  // 检查状态是否允许执行操作
  static canExecute(current: InstanceStatus): boolean {
    return current === "running" || current === "rollback";
  }

  // 检查状态是否已完成（终态）
  static isCompleted(current: InstanceStatus): boolean {
    return (
      current === "completed" || current === "failed" || current === "cancelled"
    );
  }

  // 检查状态是否可以回滚
  static canRollback(current: InstanceStatus): boolean {
    return current === "failed" || current === "running";
  }

  // 检查状态是否可以暂停
  static canPause(current: InstanceStatus): boolean {
    return current === "running";
  }

  // 检查状态是否可以恢复
  static canResume(current: InstanceStatus): boolean {
    return current === "paused";
  }

  // 检查状态是否可以取消
  static canCancel(current: InstanceStatus): boolean {
    return (
      current === "pending" ||
      current === "running" ||
      current === "paused" ||
      current === "rollback"
    );
  }
}
