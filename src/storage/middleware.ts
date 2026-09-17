import { Logger } from "../utils/Logger";
import type { StorageProvider } from "./StorageProvider";

/**
 * Records call duration for every `StorageProvider` method via `onTiming`.
 * Does not change return values or error behavior — a rejected call still
 * rejects, `onTiming` just never fires for it.
 *
 * @example
 * const storage = withStorageMetrics(baseStorage, (method, durationMs) => {
 *   metrics.record(`storage.${method}`, durationMs);
 * });
 */
export function withStorageMetrics(
  inner: StorageProvider,
  onTiming: (methodName: string, durationMs: number) => void,
): StorageProvider {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string") {
        return value;
      }

      return async (...args: unknown[]) => {
        const start = Date.now();
        try {
          return await (value as (...a: unknown[]) => unknown).apply(
            target,
            args,
          );
        } finally {
          onTiming(prop, Date.now() - start);
        }
      };
    },
  }) as StorageProvider;
}

export interface CacheStorageMiddlewareOptions {
  /** Cache entry lifetime in milliseconds. Defaults to 5000. */
  ttlMs?: number;
  /** Method names to cache reads for. Defaults to `["loadInstance", "loadWorkflow"]`. */
  cacheMethods?: string[];
  /** Method names whose call invalidates every cached entry. Defaults to write methods for cached reads. */
  invalidateMethods?: string[];
}

/**
 * Adds a short-lived in-memory read cache in front of a `StorageProvider`.
 * Cached methods are matched by name and keyed on their first argument
 * (the id); any call to an invalidating method clears the whole cache,
 * since most write methods don't cheaply map back to which cached key(s)
 * they affect.
 *
 * Intended for read-heavy embedded deployments backed by `LocalFileStorage`
 * or a database adapter where repeated `loadInstance`/`loadWorkflow` calls
 * within a short window are common (e.g. multiple nodes in one execution
 * step reading the same instance). Not safe to combine with multi-process
 * deployments sharing one storage backend — the cache has no invalidation
 * signal from other processes.
 */
export function withStorageCache(
  inner: StorageProvider,
  options: CacheStorageMiddlewareOptions = {},
): StorageProvider {
  const ttlMs = options.ttlMs ?? 5000;
  const cacheMethods = new Set(
    options.cacheMethods ?? ["loadInstance", "loadWorkflow"],
  );
  const invalidateMethods = new Set(
    options.invalidateMethods ?? [
      "saveInstance",
      "casUpdateInstance",
      "deleteInstance",
      "saveWorkflow",
      "deleteWorkflow",
      "saveWorkflowWithMetadata",
      "saveWorkflowVersion",
    ],
  );

  const cache = new Map<string, { value: unknown; expiresAt: number }>();

  return new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string") {
        return value;
      }
      const method = value as (...a: unknown[]) => unknown;

      if (cacheMethods.has(prop)) {
        return async (...args: unknown[]) => {
          const key = `${prop}:${String(args[0])}`;
          const cached = cache.get(key);
          if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
          }
          const result = await method.apply(target, args);
          cache.set(key, { value: result, expiresAt: Date.now() + ttlMs });
          return result;
        };
      }

      if (invalidateMethods.has(prop)) {
        return async (...args: unknown[]) => {
          const result = await method.apply(target, args);
          cache.clear();
          Logger.info("system", "storage-cache", "Cache invalidated", {
            triggeredBy: prop,
          });
          return result;
        };
      }

      return method.bind(target);
    },
  }) as StorageProvider;
}
