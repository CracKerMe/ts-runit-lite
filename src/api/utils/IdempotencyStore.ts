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

export interface IdempotencyStoreOptions {
  /** Maximum retained keys before the oldest are evicted (default: 10000). */
  maxSize?: number;
  /** Sweep interval for expired keys in ms (default: 300000 = 5 minutes). */
  cleanupIntervalMs?: number;
}

/**
 * Single-process idempotency store. Request keys are intentionally ephemeral
 * and are not persisted by the workflow storage provider.
 *
 * NOTE: this must be shared across requests to be meaningful. A per-request
 * instance makes every `reserve()` return `reserved`, silently disabling
 * idempotency — see `sharedIdempotencyStore` below.
 */
export class IdempotencyStore {
  private memory = new Map<
    string,
    { expiresAt: number; record: IdempotencyRecord }
  >();

  private readonly maxSize: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: IdempotencyStoreOptions = {}) {
    this.maxSize = options.maxSize ?? 10_000;

    // Entries carry per-entry TTLs (60s pending vs 24h completed), so a
    // fixed-TTL BoundedMap does not fit. Sweep expired keys periodically
    // instead — lazy expiry alone never reclaims keys that are never re-read.
    const cleanupMs = options.cleanupIntervalMs ?? 300_000;
    if (cleanupMs > 0) {
      this.cleanupTimer = setInterval(() => this.evictExpired(), cleanupMs);
      this.cleanupTimer.unref?.();
    }
  }

  private now(): number {
    return Date.now();
  }

  /** Remove every entry whose TTL has elapsed. Returns the count removed. */
  evictExpired(): number {
    const now = this.now();
    let evicted = 0;
    for (const [key, entry] of this.memory) {
      if (entry.expiresAt <= now) {
        this.memory.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  /** Stop the sweep timer. Call on shutdown. */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.memory.clear();
  }

  get size(): number {
    return this.memory.size;
  }

  /**
   * Insert with a capacity bound. Keys are caller-supplied, so an unbounded
   * map is a memory-exhaustion vector.
   */
  private store(
    key: string,
    entry: { expiresAt: number; record: IdempotencyRecord },
  ): void {
    if (!this.memory.has(key) && this.memory.size >= this.maxSize) {
      this.evictExpired();
      if (this.memory.size >= this.maxSize) {
        const oldest = this.memory.keys().next().value;
        if (oldest !== undefined) this.memory.delete(oldest);
      }
    }
    this.memory.set(key, entry);
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

    this.store(redisKey, {
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

    this.store(redisKey, {
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

/**
 * Process-wide idempotency store shared by every route.
 *
 * Idempotency is only meaningful across requests, so route handlers must use
 * this instance rather than constructing their own per request.
 */
export const sharedIdempotencyStore = new IdempotencyStore();
