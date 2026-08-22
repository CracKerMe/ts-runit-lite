// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import type { Request } from "express";
import type { WorkflowEngineV2 } from "../../engine/WorkflowEngineV2";
import type { StorageProvider } from "../../storage/StorageProvider";
import type { EventHistoryManager } from "../EventHistory";
import type { WebhookManager } from "../WebhookManager";

type ApiRequest = Request<any, any, any, any>;

export function getRequestEngine(
  req: ApiRequest,
): WorkflowEngineV2 | undefined {
  return req.engine;
}

export function requireRequestEngine(req: ApiRequest): WorkflowEngineV2 {
  if (!req.engine) {
    throw new Error("Engine not available");
  }
  return req.engine;
}

export function getRequestStorage(
  req: ApiRequest,
): StorageProvider | undefined {
  return req.storage ?? undefined;
}

export function getRequestWebhookManager(
  req: ApiRequest,
): WebhookManager | undefined {
  return req.webhookManager;
}

export function requireRequestWebhookManager(req: ApiRequest): WebhookManager {
  if (!req.webhookManager) {
    throw new Error("Webhook manager not available");
  }
  return req.webhookManager;
}

export function getRequestEventHistoryManager(
  req: ApiRequest,
): EventHistoryManager | undefined {
  return req.eventHistoryManager;
}

export function requireRequestEventHistoryManager(
  req: ApiRequest,
): EventHistoryManager {
  if (!req.eventHistoryManager) {
    throw new Error("Event history not available");
  }
  return req.eventHistoryManager;
}
