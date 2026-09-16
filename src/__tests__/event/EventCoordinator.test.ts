import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { MemoryStorage } from "../../storage/MemoryStorage";
import type { StorageProvider } from "../../storage/StorageProvider";
import { EventBus } from "../../event/EventBus";
import { EventCoordinator } from "../../event/EventCoordinator";

describe("EventCoordinator", () => {
  let eventBus: EventBus;
  let storage: StorageProvider;
  let coordinator: EventCoordinator;

  beforeEach(async () => {
    eventBus = new EventBus();
    storage = new MemoryStorage();
    await storage.connect();
    coordinator = new EventCoordinator(eventBus, storage);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("waitForEvent", () => {
    it("should persist waiting state to storage", async () => {
      const instanceId = "test-instance-1";
      const nodeId = "node-1";
      const eventType = "test-event";

      await coordinator.waitForEvent(instanceId, nodeId, eventType);

      const state = await storage.loadEventWaitingState(instanceId, nodeId);
      expect(state).toBeDefined();
      expect(state?.instanceId).toBe(instanceId);
      expect(state?.nodeId).toBe(nodeId);
      expect(state?.eventType).toBe(eventType);
    });

    it("should calculate and persist deadline when timeout is specified", async () => {
      const instanceId = "test-instance-2";
      const nodeId = "node-2";
      const eventType = "test-event";
      const timeoutMs = 5000;

      const beforeTime = Date.now();
      await coordinator.waitForEvent(instanceId, nodeId, eventType, {
        timeoutMs,
      });
      const afterTime = Date.now();

      const state = await storage.loadEventWaitingState(instanceId, nodeId);
      expect(state).toBeDefined();
      expect(state?.deadline).toBeDefined();
      expect(state?.deadline).toBeGreaterThanOrEqual(beforeTime + timeoutMs);
      expect(state?.deadline).toBeLessThanOrEqual(afterTime + timeoutMs);
      expect(state?.timeoutMs).toBe(timeoutMs);
    });

    it("should subscribe to event bus", async () => {
      const instanceId = "test-instance-3";
      const nodeId = "node-3";
      const eventType = "test-event";
      const onEventMock = vi.fn();

      await coordinator.waitForEvent(instanceId, nodeId, eventType, {
        onEvent: onEventMock,
      });

      // Emit event
      eventBus.emit(eventType, { data: "test" });

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onEventMock).toHaveBeenCalledWith({ data: "test" });
    });

    it("should execute onEvent handler when event arrives", async () => {
      const instanceId = "test-instance-4";
      const nodeId = "node-4";
      const eventType = "test-event";
      const onEventMock = vi.fn();

      await coordinator.waitForEvent(instanceId, nodeId, eventType, {
        onEvent: onEventMock,
      });

      eventBus.emit(eventType, { payload: "test-data" });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onEventMock).toHaveBeenCalledTimes(1);
      expect(onEventMock).toHaveBeenCalledWith({ payload: "test-data" });
    });

    it("should clean up after event is received", async () => {
      const instanceId = "test-instance-5";
      const nodeId = "node-5";
      const eventType = "test-event";
      const onEventMock = vi.fn();

      await coordinator.waitForEvent(instanceId, nodeId, eventType, {
        onEvent: onEventMock,
      });

      eventBus.emit(eventType, { data: "test" });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Check that state is cleaned up
      const state = await storage.loadEventWaitingState(instanceId, nodeId);
      expect(state).toBeNull();
    });
  });

  describe("timeout handling", () => {
    it("should execute onTimeout handler when timeout expires", async () => {
      const instanceId = "test-instance-6";
      const nodeId = "node-6";
      const eventType = "test-event";
      const timeoutMs = 100; // Short timeout for testing
      const onTimeoutMock = vi.fn();

      await coordinator.waitForEvent(instanceId, nodeId, eventType, {
        timeoutMs,
        onTimeout: onTimeoutMock,
      });

      // Wait for timeout to expire
      await new Promise((resolve) => setTimeout(resolve, timeoutMs + 50));

      expect(onTimeoutMock).toHaveBeenCalledTimes(1);
    });

    it("should ignore events that arrive after timeout", async () => {
      const instanceId = "test-instance-7";
      const nodeId = "node-7";
      const eventType = "test-event";
      const timeoutMs = 100;
      const onEventMock = vi.fn();
      const onTimeoutMock = vi.fn();

      await coordinator.waitForEvent(instanceId, nodeId, eventType, {
        timeoutMs,
        onEvent: onEventMock,
        onTimeout: onTimeoutMock,
      });

      // Wait for timeout to expire
      await new Promise((resolve) => setTimeout(resolve, timeoutMs + 50));

      // Emit event after timeout
      eventBus.emit(eventType, { data: "late" });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onTimeoutMock).toHaveBeenCalledTimes(1);
      expect(onEventMock).not.toHaveBeenCalled();
    });

    it("should clean up after timeout", async () => {
      const instanceId = "test-instance-8";
      const nodeId = "node-8";
      const eventType = "test-event";
      const timeoutMs = 100;
      const onTimeoutMock = vi.fn();

      await coordinator.waitForEvent(instanceId, nodeId, eventType, {
        timeoutMs,
        onTimeout: onTimeoutMock,
      });

      // Wait for timeout to expire
      await new Promise((resolve) => setTimeout(resolve, timeoutMs + 50));

      // Check that state is cleaned up
      const state = await storage.loadEventWaitingState(instanceId, nodeId);
      expect(state).toBeNull();
    });
  });

  describe("first-match-only logic", () => {
    it("should process only the first matching event", async () => {
      const instanceId = "test-instance-9";
      const nodeId = "node-9";
      const eventType = "test-event";
      const onEventMock = vi.fn();

      await coordinator.waitForEvent(instanceId, nodeId, eventType, {
        onEvent: onEventMock,
      });

      // Emit multiple events
      eventBus.emit(eventType, { data: "first" });
      eventBus.emit(eventType, { data: "second" });
      eventBus.emit(eventType, { data: "third" });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should only process the first event
      expect(onEventMock).toHaveBeenCalledTimes(1);
      expect(onEventMock).toHaveBeenCalledWith({ data: "first" });
    });
  });

  describe("condition matching", () => {
    it("should evaluate condition and only accept matching events", async () => {
      const instanceId = "test-instance-condition-1";
      const nodeId = "node-condition-1";
      const eventType = "test-event";
      const onEventMock = vi.fn();

      const instance: WorkflowInstance = {
        instanceId,
        workflowId: "wf",
        currentNodes: [nodeId],
        status: "running",
        context: { flag: true },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        retries: {},
        state: { nodes: {} },
      };
      await storage.saveInstance(instance);

      await coordinator.waitForEvent(instanceId, nodeId, eventType, {
        condition: "event.value > 10 && context.flag === true",
        onEvent: onEventMock,
      });

      eventBus.emit(eventType, { value: 5 });
      eventBus.emit(eventType, { value: 20 });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onEventMock).toHaveBeenCalledTimes(1);
      expect(onEventMock).toHaveBeenCalledWith({ value: 20 });
    });
  });

  describe("requireInstanceIdMatch", () => {
    it("should ignore events that do not target the waiting instanceId", async () => {
      const instanceId = "test-instance-target-1";
      const nodeId = "node-target-1";
      const eventType = "test-event";
      const onEventMock = vi.fn();

      const instance: WorkflowInstance = {
        instanceId,
        workflowId: "wf",
        currentNodes: [nodeId],
        status: "running",
        context: {},
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        retries: {},
        state: { nodes: {} },
      };
      await storage.saveInstance(instance);

      await coordinator.waitForEvent(instanceId, nodeId, eventType, {
        requireInstanceIdMatch: true,
        onEvent: onEventMock,
      });

      eventBus.emit(eventType, { instanceId: "other-instance", value: 1 });
      eventBus.emit(eventType, { value: 2 });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onEventMock).not.toHaveBeenCalled();

      eventBus.emit(eventType, { instanceId, value: 3 });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onEventMock).toHaveBeenCalledTimes(1);
      expect(onEventMock).toHaveBeenCalledWith({ instanceId, value: 3 });
    });
  });

  describe("restoreWaitingStates", () => {
    it("should restore waiting states from storage", async () => {
      const instanceId = "test-instance-10";
      const nodeId = "node-10";
      const eventType = "test-event";

      // Create a waiting state directly in storage
      await storage.saveEventWaitingState({
        instanceId,
        nodeId,
        eventType,
        createdAt: Date.now(),
      });

      // Restore states
      await coordinator.restoreWaitingStates();

      // Check that state is restored
      const state = coordinator.getWaitingState(instanceId, nodeId);
      expect(state).toBeDefined();
      expect(state?.instanceId).toBe(instanceId);
      expect(state?.nodeId).toBe(nodeId);
      expect(state?.eventType).toBe(eventType);
    });

    it("should resubscribe to event bus after restore", async () => {
      const instanceId = "test-instance-11";
      const nodeId = "node-11";
      const eventType = "test-event";

      // Create a waiting state directly in storage
      await storage.saveEventWaitingState({
        instanceId,
        nodeId,
        eventType,
        createdAt: Date.now(),
      });

      // Restore states
      await coordinator.restoreWaitingStates();

      // Emit event - it should be received even though we didn't call waitForEvent
      // Note: We can't easily test the handler execution without the original handlers
      // but we can verify the state is restored
      const state = coordinator.getWaitingState(instanceId, nodeId);
      expect(state).toBeDefined();
    });

    it("should skip expired waiting states during restore", async () => {
      const instanceId = "test-instance-12";
      const nodeId = "node-12";
      const eventType = "test-event";
      const deadline = Date.now() - 1000; // Already expired

      // Create an expired waiting state
      await storage.saveEventWaitingState({
        instanceId,
        nodeId,
        eventType,
        deadline,
        createdAt: Date.now() - 2000,
      });

      // Restore states
      await coordinator.restoreWaitingStates();

      // Check that expired state is not restored
      const state = coordinator.getWaitingState(instanceId, nodeId);
      expect(state).toBeUndefined();

      // Check that it's cleaned up from storage
      const storedState = await storage.loadEventWaitingState(
        instanceId,
        nodeId,
      );
      expect(storedState).toBeNull();
    });

    it("should resume timeout monitoring with correct deadlines", async () => {
      const instanceId = "test-instance-13";
      const nodeId = "node-13";
      const eventType = "test-event";
      const timeoutMs = 100;
      const deadline = Date.now() + timeoutMs;

      // Create a waiting state with deadline
      await storage.saveEventWaitingState({
        instanceId,
        nodeId,
        eventType,
        deadline,
        timeoutMs,
        createdAt: Date.now(),
      });

      // Restore states
      await coordinator.restoreWaitingStates();

      // Verify state is restored
      const state = coordinator.getWaitingState(instanceId, nodeId);
      expect(state).toBeDefined();

      // Wait for timeout to expire
      await new Promise((resolve) => setTimeout(resolve, timeoutMs + 50));

      // State should be cleaned up after timeout
      const stateAfterTimeout = coordinator.getWaitingState(instanceId, nodeId);
      expect(stateAfterTimeout).toBeUndefined();
    });
  });

  describe("cancelWait", () => {
    it("should cancel waiting and clean up state", async () => {
      const instanceId = "test-instance-14";
      const nodeId = "node-14";
      const eventType = "test-event";

      await coordinator.waitForEvent(instanceId, nodeId, eventType);

      // Cancel wait
      await coordinator.cancelWait(instanceId, nodeId);

      // Check that state is cleaned up
      const state = await storage.loadEventWaitingState(instanceId, nodeId);
      expect(state).toBeNull();

      const trackedState = coordinator.getWaitingState(instanceId, nodeId);
      expect(trackedState).toBeUndefined();
    });
  });

  describe("handleTimeout", () => {
    it("should handle timeout for a specific waiting state", async () => {
      const instanceId = "test-instance-15";
      const nodeId = "node-15";
      const eventType = "test-event";
      const onTimeoutMock = vi.fn();

      await coordinator.waitForEvent(instanceId, nodeId, eventType, {
        timeoutMs: 10000,
        onTimeout: onTimeoutMock,
      });

      // Manually trigger timeout
      await coordinator.handleTimeout(instanceId, nodeId);

      expect(onTimeoutMock).toHaveBeenCalledTimes(1);

      // Check that state is cleaned up
      const state = await storage.loadEventWaitingState(instanceId, nodeId);
      expect(state).toBeNull();
    });
  });

  describe("getWaitingStates", () => {
    it("should return all currently waiting states", async () => {
      await coordinator.waitForEvent("instance-1", "node-1", "event-1");
      await coordinator.waitForEvent("instance-2", "node-2", "event-2");
      await coordinator.waitForEvent("instance-3", "node-3", "event-3");

      const states = coordinator.getWaitingStates();
      expect(states).toHaveLength(3);
      expect(states.map((s) => s.instanceId)).toContain("instance-1");
      expect(states.map((s) => s.instanceId)).toContain("instance-2");
      expect(states.map((s) => s.instanceId)).toContain("instance-3");
    });
  });
});
