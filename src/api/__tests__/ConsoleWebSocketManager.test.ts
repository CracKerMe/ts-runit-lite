// oxlint-disable no-explicit-any -- test file needs a minimal fake WebSocket
import { describe, expect, it, vi } from "vitest";
import type { HookPayload } from "../../event/HookManager";
import { MemoryStorage } from "../../storage/MemoryStorage";
import {
  ConsoleWebSocketManager,
  type ConsoleHookMessage,
} from "../ConsoleWebSocketManager";

function fakeSocket() {
  const sent: unknown[] = [];
  return {
    readyState: 1,
    send: vi.fn((raw: string) => sent.push(JSON.parse(raw))),
    on: vi.fn(),
    sent,
  };
}

describe("ConsoleWebSocketManager message shapes", () => {
  it("sends a typed 'connected' message with mode 'global' on connect", () => {
    const manager = new ConsoleWebSocketManager();
    const ws = fakeSocket();

    manager.handleGlobalConnection(ws as any, {} as any);

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toMatchObject({ type: "connected", mode: "global" });
  });

  it("broadcasts a typed 'hook' message with `data` set to the HookPayload", () => {
    const manager = new ConsoleWebSocketManager();
    const globalWs = fakeSocket();
    manager.handleGlobalConnection(globalWs as any, {} as any);
    globalWs.sent.length = 0; // discard the initial "connected" message

    const payload: HookPayload = {
      event: "node.started",
      timestamp: "2026-01-01T00:00:00.000Z",
      instanceId: "inst-1",
      workflowId: "wf-1",
      nodeId: "n1",
      status: "running",
    };
    manager.broadcastHook(payload);

    expect(globalWs.sent).toHaveLength(1);
    const message = globalWs.sent[0] as ConsoleHookMessage;
    expect(message.type).toBe("hook");
    expect(message.event).toBe("node.started");
    expect(message.instanceId).toBe("inst-1");
    expect(message.data).toEqual(payload);
  });

  it("sends the initial instance snapshot as a typed 'connected' message with mode 'instance'", async () => {
    const storage = new MemoryStorage();
    await storage.connect();
    await storage.saveInstance({
      instanceId: "inst-1",
      workflowId: "wf-1",
      status: "running",
      state: {},
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any);

    const manager = new ConsoleWebSocketManager(storage);
    const ws = fakeSocket();
    manager.handleConnection(ws as any, "inst-1", {} as any);

    await new Promise((resolve) => setImmediate(resolve));

    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]).toMatchObject({
      type: "connected",
      mode: "instance",
      instanceId: "inst-1",
    });
    expect((ws.sent[0] as any).instance).toMatchObject({
      instanceId: "inst-1",
    });

    await storage.close();
  });

  it("responds to a 'ping' message with a typed 'pong'", () => {
    const manager = new ConsoleWebSocketManager();
    const ws = fakeSocket();
    manager.handleGlobalConnection(ws as any, {} as any);
    ws.sent.length = 0;

    const messageHandler = ws.on.mock.calls.find(
      (call: any[]) => call[0] === "message",
    )?.[1] as (buf: Buffer) => void;
    messageHandler(Buffer.from(JSON.stringify({ type: "ping" })));

    expect(ws.sent).toEqual([expect.objectContaining({ type: "pong" })]);
  });
});
