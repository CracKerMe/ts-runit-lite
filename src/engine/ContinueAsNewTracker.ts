import { Logger } from "../utils/Logger";

export interface ContinueAsNewOptions {
  workflowId?: string;
  input?: Record<string, unknown>;
  searchAttributes?: Record<string, unknown>;
}

export interface ContinueAsNewResult {
  newInstanceId: string;
  previousInstanceId: string;
}

export class ContinueAsNewTracker {
  private pendingContinuations: Map<string, ContinueAsNewOptions> = new Map();

  prepareContinueAsNew(
    instanceId: string,
    options: ContinueAsNewOptions,
  ): ContinueAsNewResult {
    this.pendingContinuations.set(instanceId, options);

    const newInstanceId = options.workflowId
      ? `${options.workflowId}-${Date.now()}`
      : `${instanceId}-continued-${Date.now()}`;

    Logger.info(
      "system",
      "continue-as-new",
      `ContinueAsNew prepared: ${instanceId} -> ${newInstanceId}`,
    );

    return {
      newInstanceId,
      previousInstanceId: instanceId,
    };
  }

  hasPendingContinuation(instanceId: string): boolean {
    return this.pendingContinuations.has(instanceId);
  }

  getContinuation(instanceId: string): ContinueAsNewOptions | undefined {
    return this.pendingContinuations.get(instanceId);
  }

  clearContinuation(instanceId: string): void {
    this.pendingContinuations.delete(instanceId);
  }

  /** 是否存在针对该实例的待处理续期。 */
  isActive(instanceId: string): boolean {
    return this.hasPendingContinuation(instanceId);
  }
}

export const continueAsNewTracker = new ContinueAsNewTracker();
