import { EventEmitter } from "node:events";
import { Logger } from "../utils/Logger";
import { type Breakpoint, BreakpointTracker } from "./BreakpointTracker";

export type DebuggerState =
  | "idle"
  | "running"
  | "paused"
  | "stepping"
  | "completed";

export interface DebugSnapshot {
  instanceId: string | null;
  state: DebuggerState;
  currentNodeId: string | null;
  variables: Record<string, unknown>;
  callStack: string[];
  breakpoints: Breakpoint[];
}

export class WorkflowDebugger extends EventEmitter {
  private readonly breakpoints = new BreakpointTracker();
  private state: DebuggerState = "idle";
  private instanceId: string | null = null;
  private variables: Record<string, unknown> = {};
  private callStack: string[] = [];
  private stepResolve: (() => void) | null = null;

  attach(instanceId: string): void {
    this.instanceId = instanceId;
    this.state = "idle";
    this.variables = {};
    this.callStack = [];
    Logger.info("system", "debugger", "Attached to workflow instance", {
      instanceId,
    });
  }

  detach(): void {
    const detachedInstanceId = this.instanceId;
    this.resumeExecution();
    this.instanceId = null;
    this.state = "idle";
    this.variables = {};
    this.callStack = [];
    Logger.info("system", "debugger", "Detached from workflow instance", {
      instanceId: detachedInstanceId,
    });
  }

  addBreakpoint(nodeId: string, condition?: string): Breakpoint {
    if (!this.instanceId) {
      throw new Error("No instance attached");
    }

    return this.breakpoints.add(this.instanceId, nodeId, condition);
  }

  removeBreakpoint(id: string): boolean {
    return this.breakpoints.remove(id);
  }

  toggleBreakpoint(id: string, enabled?: boolean): Breakpoint | undefined {
    return this.breakpoints.toggle(id, enabled);
  }

  pause(): void {
    this.state = "paused";
    this.emit("paused", this.getSnapshot());
  }

  resume(): void {
    this.state = "running";
    this.resumeExecution();
    this.emit("resumed", this.getSnapshot());
  }

  step(): Promise<void> {
    this.state = "stepping";
    this.resumeExecution();

    return new Promise((resolve) => {
      this.stepResolve = resolve;
    });
  }

  stepOver(): Promise<void> {
    return this.step();
  }

  onNodeEnter(
    instanceId: string,
    nodeId: string,
    context: Record<string, unknown>,
  ): void {
    if (this.instanceId !== instanceId) {
      return;
    }

    this.callStack.push(nodeId);
    this.variables = context;

    const breakpoint = this.breakpoints.shouldBreak(
      instanceId,
      nodeId,
      context,
    );
    if (!breakpoint && this.state !== "stepping") {
      if (this.state === "idle") {
        this.state = "running";
      }
      return;
    }

    this.state = "paused";
    const snapshot = this.getSnapshot();
    this.emit("breakpoint-hit", { breakpoint, nodeId, snapshot });
    this.emit("paused", snapshot);

    if (this.stepResolve) {
      this.stepResolve();
      this.stepResolve = null;
    }
  }

  onNodeExit(instanceId: string, nodeId: string): void {
    if (this.instanceId !== instanceId) {
      return;
    }

    const index = this.callStack.lastIndexOf(nodeId);
    if (index !== -1) {
      this.callStack.splice(index, 1);
    }

    if (this.callStack.length === 0 && this.state === "running") {
      this.state = "completed";
    }
  }

  getSnapshot(): DebugSnapshot {
    return {
      instanceId: this.instanceId,
      state: this.state,
      currentNodeId: this.callStack[this.callStack.length - 1] ?? null,
      variables: this.variables,
      callStack: [...this.callStack],
      breakpoints: this.breakpoints.list(this.instanceId ?? undefined),
    };
  }

  getState(): DebuggerState {
    return this.state;
  }

  private resumeExecution(): void {
    if (this.stepResolve) {
      this.stepResolve();
      this.stepResolve = null;
    }
  }
}

export const workflowDebugger = new WorkflowDebugger();
