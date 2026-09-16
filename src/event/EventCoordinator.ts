// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import { evaluateCondition } from "../engine/ExpressionEvaluator";
import { recordEventWaitEnd, recordEventWaitStart } from "../metrics/index";
import type {
  EventWaitingState,
  StorageProvider,
} from "../storage/StorageProvider";
import { Logger } from "../utils/Logger";
import type { EventBus } from "./EventBus";
import {
  type AsyncEventDeduplicator,
  createDeduplicator,
} from "./EventDeduplicator";

/**
 * Options for waiting for an event
 */
export interface WaitForEventOptions {
  condition?: string; // Expression to match event
  requireInstanceIdMatch?: boolean; // Only accept payloads targeting this instanceId
  timeoutMs?: number; // Timeout in milliseconds
  onTimeout?: () => void; // Handler to execute on timeout
  onEvent?: (payload: any) => void; // Handler to execute when event arrives
}

/**
 * Internal tracking for event waiting
 */
interface EventWaitingTracker {
  state: EventWaitingState;
  timeoutId?: NodeJS.Timeout;
  eventHandler?: (data: any) => void;
  onTimeout?: () => void;
  onEvent?: (payload: any) => void;
}

/**
 * EventCoordinator manages event waiting with persistent state and timeout handling.
 * It integrates with the EventBus for subscriptions and StorageProvider for persistence.
 */
export class EventCoordinator {
  private eventBus: EventBus;
  private storage: StorageProvider;
  private deduplicator: AsyncEventDeduplicator;
  private waitingTrackers = new Map<string, EventWaitingTracker>();

  constructor(
    eventBus: EventBus,
    storage: StorageProvider,
    deduplicator?: AsyncEventDeduplicator,
  ) {
    this.eventBus = eventBus;
    this.storage = storage;
    this.deduplicator = deduplicator ?? createDeduplicator();
  }

  /**
   * Wait for an event with optional timeout and condition
   * Persists the waiting state to storage for recovery after system restart
   */
  async waitForEvent(
    instanceId: string,
    nodeId: string,
    eventType: string,
    options: WaitForEventOptions = {},
  ): Promise<void> {
    const { condition, requireInstanceIdMatch, timeoutMs, onTimeout, onEvent } =
      options;

    // Calculate deadline if timeout is specified
    const deadline = timeoutMs ? Date.now() + timeoutMs : undefined;

    // Create waiting state
    const state: EventWaitingState = {
      instanceId,
      nodeId,
      eventType,
      condition,
      requireInstanceIdMatch,
      timeoutMs,
      deadline,
      createdAt: Date.now(),
    };

    // Persist to storage
    await this.storage.saveEventWaitingState(state);
    Logger.info(
      instanceId,
      nodeId,
      `Event waiting state persisted for event ${eventType}`,
      { deadline, timeoutMs },
    );

    // Record Prometheus metric for event waiting
    // Note: We need workflowId, but it's not passed to this method
    // We'll need to get it from the instance
    const instance = await this.storage.loadInstance(instanceId);
    if (instance) {
      recordEventWaitStart(instance.workflowId);
    }

    // Subscribe to event bus
    await this.subscribeToEvent(state, onTimeout, onEvent);
  }

  /**
   * Subscribe to an event and set up timeout monitoring
   */
  private async subscribeToEvent(
    state: EventWaitingState,
    onTimeout?: () => void,
    onEvent?: (payload: any) => void,
  ): Promise<void> {
    const key = `${state.instanceId}:${state.nodeId}`;

    // Check if already subscribed
    if (this.waitingTrackers.has(key)) {
      Logger.warn(
        state.instanceId,
        state.nodeId,
        `Already subscribed to event ${state.eventType}`,
      );
      return;
    }

    let processed = false; // Flag to ensure first-match-only

    // Create event handler
    const eventHandler = async (data: any) => {
      // First-match-only: ignore if already processed
      if (processed) {
        Logger.debug(
          state.instanceId,
          state.nodeId,
          `Event ${state.eventType} already processed, ignoring`,
        );
        return;
      }

      if (state.requireInstanceIdMatch) {
        if (!data || data.instanceId !== state.instanceId) {
          Logger.debug(
            state.instanceId,
            state.nodeId,
            `Event ${state.eventType} instanceId mismatch, ignoring`,
            {
              expected: state.instanceId,
              received: data?.instanceId,
            },
          );
          return;
        }
      }

      // Check if timeout has expired
      if (state.deadline && Date.now() > state.deadline) {
        Logger.info(
          state.instanceId,
          state.nodeId,
          `Event ${state.eventType} arrived after timeout, ignoring`,
        );
        return;
      }

      if (state.condition) {
        const instance = await this.storage.loadInstance(state.instanceId);
        if (!instance) {
          Logger.warn(
            state.instanceId,
            state.nodeId,
            `Instance not found while evaluating condition for ${state.eventType}`,
          );
          return;
        }

        const matched = evaluateCondition(state.condition, {
          context: instance.context,
          state: instance.state,
          event: data,
        });

        if (!matched) {
          Logger.debug(
            state.instanceId,
            state.nodeId,
            `Event ${state.eventType} condition not matched, ignoring`,
            { condition: state.condition },
          );
          return;
        }
      }

      // Cross-node claim: after restart every node restores all waiting
      // states, so a broadcast event would fire onEvent on each of them.
      // createdAt keeps the key unique per wait, allowing the same
      // instance/node to wait for the same event type again later.
      const claimKey = `wait:${state.instanceId}:${state.nodeId}:${state.eventType}:${state.createdAt}`;
      if (await this.deduplicator.isDuplicate(claimKey)) {
        Logger.debug(
          state.instanceId,
          state.nodeId,
          `Event ${state.eventType} already claimed by another node, ignoring`,
        );
        processed = true;
        await this.cleanup(state.instanceId, state.nodeId);
        return;
      }

      // Mark as processed
      processed = true;

      Logger.info(
        state.instanceId,
        state.nodeId,
        `Event ${state.eventType} received and matched`,
      );

      // Clean up
      await this.cleanup(state.instanceId, state.nodeId);

      // Execute event handler
      if (onEvent) {
        onEvent(data);
      }
    };

    // Set up timeout monitoring if deadline is specified
    let timeoutId: NodeJS.Timeout | undefined;
    if (state.deadline) {
      const timeoutDelay = state.deadline - Date.now();
      if (timeoutDelay > 0) {
        timeoutId = setTimeout(async () => {
          // Check if already processed
          if (processed) {
            return;
          }

          processed = true;

          Logger.info(
            state.instanceId,
            state.nodeId,
            `Timeout expired for event ${state.eventType}`,
          );

          // Clean up
          await this.cleanup(state.instanceId, state.nodeId);

          // Execute timeout handler
          if (onTimeout) {
            onTimeout();
          }
        }, timeoutDelay);
      } else {
        // Deadline already passed
        Logger.warn(
          state.instanceId,
          state.nodeId,
          `Deadline already passed for event ${state.eventType}`,
        );
        processed = true;
        await this.cleanup(state.instanceId, state.nodeId);
        if (onTimeout) {
          onTimeout();
        }
        return;
      }
    }

    // Store tracker
    const tracker: EventWaitingTracker = {
      state,
      timeoutId,
      eventHandler,
      onTimeout,
      onEvent,
    };
    this.waitingTrackers.set(key, tracker);

    // Subscribe to event bus
    this.eventBus.on(state.eventType, eventHandler);

    Logger.debug(
      state.instanceId,
      state.nodeId,
      `Subscribed to event ${state.eventType}`,
      { deadline: state.deadline },
    );
  }

  /**
   * Clean up event subscription and timeout
   */
  private async cleanup(instanceId: string, nodeId: string): Promise<void> {
    const key = `${instanceId}:${nodeId}`;
    const tracker = this.waitingTrackers.get(key);

    if (!tracker) {
      return;
    }

    // Clear timeout
    if (tracker.timeoutId) {
      clearTimeout(tracker.timeoutId);
    }

    // Unsubscribe from event bus
    if (tracker.eventHandler) {
      this.eventBus.off(tracker.state.eventType, tracker.eventHandler);
    }

    // Remove from trackers
    this.waitingTrackers.delete(key);

    // Delete from storage
    await this.storage.deleteEventWaitingState(instanceId, nodeId);

    // Record Prometheus metric for event waiting end
    const instance = await this.storage.loadInstance(instanceId);
    if (instance) {
      recordEventWaitEnd(instance.workflowId);
    }

    Logger.debug(instanceId, nodeId, "Event waiting state cleaned up");
  }

  /**
   * Cancel waiting for an event
   */
  async cancelWait(instanceId: string, nodeId: string): Promise<void> {
    await this.cleanup(instanceId, nodeId);
    Logger.info(instanceId, nodeId, "Event wait cancelled");
  }

  /**
   * Handle timeout for a specific waiting state
   */
  async handleTimeout(instanceId: string, nodeId: string): Promise<void> {
    const key = `${instanceId}:${nodeId}`;
    const tracker = this.waitingTrackers.get(key);

    if (!tracker) {
      Logger.warn(
        instanceId,
        nodeId,
        "No waiting state found for timeout handling",
      );
      return;
    }

    Logger.info(
      instanceId,
      nodeId,
      `Handling timeout for event ${tracker.state.eventType}`,
    );

    // Clean up
    await this.cleanup(instanceId, nodeId);

    // Execute timeout handler
    if (tracker.onTimeout) {
      tracker.onTimeout();
    }
  }

  /**
   * Restore all waiting states from storage after system restart
   * Resubscribes to EventBus and resumes timeout monitoring
   *
   * @param shouldSkip - Returns true for (instanceId, nodeId) pairs that will
   * be re-subscribed with live onEvent/onTimeout handlers by the normal
   * instance-resume path (WorkflowEngine.resumeRunningInstances re-entering
   * executeNode). Those must be skipped here: subscribeToEvent() is a no-op
   * once a tracker already exists for the key, so restoring them first would
   * permanently strand the resumed instance behind a dead-end subscription
   * with no way to advance the workflow when the event arrives.
   */
  async restoreWaitingStates(
    shouldSkip?: (instanceId: string, nodeId: string) => boolean,
  ): Promise<void> {
    Logger.info(
      "system",
      "event-coordinator",
      "Restoring event waiting states from storage",
    );

    const states = await this.storage.loadAllEventWaitingStates();

    Logger.info(
      "system",
      "event-coordinator",
      `Found ${states.length} waiting states to restore`,
    );

    for (const state of states) {
      if (shouldSkip?.(state.instanceId, state.nodeId)) {
        Logger.debug(
          state.instanceId,
          state.nodeId,
          `Skipping waiting-state restore for ${state.eventType} — instance will be resumed directly`,
        );
        continue;
      }

      // Check if deadline has already passed
      if (state.deadline && Date.now() > state.deadline) {
        Logger.info(
          state.instanceId,
          state.nodeId,
          `Deadline already passed for event ${state.eventType}, cleaning up`,
        );
        await this.storage.deleteEventWaitingState(
          state.instanceId,
          state.nodeId,
        );
        continue;
      }

      // Resubscribe to event
      // Note: We don't have the original onTimeout and onEvent handlers after restart
      // The workflow engine will need to provide these when it resumes
      await this.subscribeToEvent(state);

      Logger.info(
        state.instanceId,
        state.nodeId,
        `Restored event waiting for ${state.eventType}`,
      );
    }

    Logger.info(
      "system",
      "event-coordinator",
      `Restored ${states.length} event waiting states`,
    );
  }

  /**
   * Get all currently waiting states
   */
  getWaitingStates(): EventWaitingState[] {
    return Array.from(this.waitingTrackers.values()).map(
      (tracker) => tracker.state,
    );
  }

  /**
   * Get a specific waiting state
   */
  getWaitingState(
    instanceId: string,
    nodeId: string,
  ): EventWaitingState | undefined {
    const key = `${instanceId}:${nodeId}`;
    const tracker = this.waitingTrackers.get(key);
    return tracker?.state;
  }

  /**
   * Release subscriptions, pending timers, and the deduplication cleanup
   * interval owned by this coordinator.
   */
  destroy(): void {
    for (const [key, tracker] of this.waitingTrackers) {
      if (tracker.timeoutId) {
        clearTimeout(tracker.timeoutId);
      }
      if (tracker.eventHandler) {
        this.eventBus.off(tracker.state.eventType, tracker.eventHandler);
      }
      this.waitingTrackers.delete(key);
    }
    this.deduplicator.destroy();
  }
}
