import crypto from "node:crypto";
import { Logger } from "../../utils/Logger";

type IdempotencyRecord =
  | {
      status: "pending";
      bodyHash: string;
      createdAt: number;
    }
  | {
      status: "completed";
      bodyHash: string;
      createdAt: number;
      completedAt: number;
      value: unknown;
    };

export type ReserveResult =
  | { type: "hit"; value: unknown }
  | { type: "reserved" }
  | { type: "in_progress" }
  | { type: "conflict"; message: string };

function stableStringify(value: unknown): string {
  if (value === null) return JSON.stringify(value);
  if (value === undefined) return "undefined";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

export function hashRequestBody(body: unknown): string {
  const payload = stableStringify(body);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Single-process idempotency store. Request keys are intentionally ephemeral
 * and are not persisted by the workflow storage provider.
 */
export class IdempotencyStore {
  private memory = new Map<
    string,
    { expiresAt: number; record: IdempotencyRecord }
  >();

  private now(): number {
    return Date.now();
  }

  private buildKey(namespace: string, key: string): string {
    return `workflow:idempotency:${namespace}:${key}`;
  }

  async reserve(
    namespace: string,
    key: string,
    bodyHash: string,
    options?: { pendingTtlSeconds?: number },
  ): Promise<ReserveResult> {
    const pendingTtlSeconds = options?.pendingTtlSeconds ?? 60;
    const redisKey = this.buildKey(namespace, key);

    const now = this.now();
    const existing = this.memory.get(redisKey);
    if (existing && existing.expiresAt > now) {
      if (existing.record.bodyHash !== bodyHash) {
        return {
          type: "conflict",
          message: "Idempotency-Key reused with different payload",
        };
      }
      if (existing.record.status === "completed") {
        return { type: "hit", value: existing.record.value };
      }
      return { type: "in_progress" };
    }

    this.memory.set(redisKey, {
      expiresAt: now + pendingTtlSeconds * 1000,
      record: { status: "pending", bodyHash, createdAt: now },
    });
    return { type: "reserved" };
  }

  async complete(
    namespace: string,
    key: string,
    bodyHash: string,
    value: unknown,
    options?: { ttlSeconds?: number },
  ): Promise<void> {
    const ttlSeconds = options?.ttlSeconds ?? 86400;
    const redisKey = this.buildKey(namespace, key);
    const record: IdempotencyRecord = {
      status: "completed",
      bodyHash,
      createdAt: this.now(),
      completedAt: this.now(),
      value,
    };

    this.memory.set(redisKey, {
      expiresAt: this.now() + ttlSeconds * 1000,
      record,
    });
  }

  async fail(namespace: string, key: string): Promise<void> {
    const redisKey = this.buildKey(namespace, key);
    this.memory.delete(redisKey);
    Logger.debug(
      "api",
      "idempotency",
      "Cleared idempotency key after failure",
      {
        namespace,
        key,
      },
    );
  }
}
