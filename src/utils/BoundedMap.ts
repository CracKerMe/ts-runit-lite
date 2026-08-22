/**
 * A Map with automatic TTL expiration and capacity limits.
 *
 * Prevents unbounded memory growth in long-running processes.
 * Entries are lazily evicted on access and periodically via a cleanup timer.
 */

export interface BoundedMapOptions<K, V> {
  /** Maximum number of entries (default: 1000) */
  maxSize?: number;
  /** TTL in milliseconds (default: 60000 = 1 minute) */
  ttlMs?: number;
  /** Cleanup interval in milliseconds (default: ttlMs / 2) */
  cleanupIntervalMs?: number;
  /** Optional callback when an entry is evicted */
  onEvict?: (key: K, value: V, reason: "ttl" | "capacity") => void;
}

export class BoundedMap<K, V> implements Map<K, V> {
  private readonly store = new Map<K, { value: V; expiresAt: number }>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly onEvict?: (
    key: K,
    value: V,
    reason: "ttl" | "capacity",
  ) => void;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: BoundedMapOptions<K, V> = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.ttlMs = options.ttlMs ?? 60_000;
    this.onEvict = options.onEvict;

    const cleanupMs = options.cleanupIntervalMs ?? this.ttlMs / 2;
    if (cleanupMs > 0 && this.ttlMs > 0) {
      this.cleanupTimer = setInterval(() => this.evictExpired(), cleanupMs);
      // Don't let the timer keep the process alive
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    }
  }

  get [Symbol.toStringTag](): string {
    return "BoundedMap";
  }

  // ── Map Interface Implementation ─────────────────────────────────────────

  get size(): number {
    return this.store.size;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      this.onEvict?.(key, entry.value, "ttl");
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): this {
    // Evict if at capacity and key is new
    if (!this.store.has(key) && this.store.size >= this.maxSize) {
      this.evictOldest();
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
    return this;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  forEach(
    callbackfn: (value: V, key: K, map: Map<K, V>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key] of this.store) {
      const value = this.get(key);
      if (value !== undefined) {
        callbackfn.call(thisArg, value, key, this as unknown as Map<K, V>);
      }
    }
  }

  *entries(): IterableIterator<[K, V]> {
    for (const [key] of this.store) {
      const value = this.get(key);
      if (value !== undefined) {
        yield [key, value];
      }
    }
  }

  *keys(): IterableIterator<K> {
    for (const key of this.store.keys()) {
      if (this.has(key)) {
        yield key;
      }
    }
  }

  *values(): IterableIterator<V> {
    for (const [key] of this.store) {
      const value = this.get(key);
      if (value !== undefined) {
        yield value;
      }
    }
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Stop the cleanup timer. Call this when the map is no longer needed.
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Manually trigger eviction of expired entries.
   */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
        this.onEvict?.(key, entry.value, "ttl");
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Get cache statistics for monitoring.
   */
  stats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    };
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private evictOldest(): void {
    const firstKey = this.store.keys().next().value;
    if (firstKey !== undefined) {
      const entry = this.store.get(firstKey);
      this.store.delete(firstKey);
      if (entry) {
        this.onEvict?.(firstKey, entry.value, "capacity");
      }
    }
  }
}
