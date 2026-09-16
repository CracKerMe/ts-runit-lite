import { Logger } from "../utils/Logger";
import type { StorageProvider } from "./StorageProvider";

/**
 * Factory function that creates and connects a storage provider.
 */
export type StorageFactory = (
  config: Record<string, unknown>,
) => Promise<StorageProvider>;

const registry = new Map<string, StorageFactory>();

/**
 * Register a storage adapter by name.
 *
 * @example
 * registerStorageAdapter("sqlite", async (config) => {
 *   const storage = new SqliteStorage({ path: config.path as string });
 *   await storage.connect();
 *   return storage;
 * });
 */
export function registerStorageAdapter(
  name: string,
  factory: StorageFactory,
): void {
  registry.set(name, factory);
  Logger.info("system", "storage", `Storage adapter registered: ${name}`);
}

/**
 * Remove a previously registered storage adapter.
 * Returns true if the adapter was removed, false if it wasn't found.
 */
export function unregisterStorageAdapter(name: string): boolean {
  return registry.delete(name);
}

/**
 * List all registered storage adapter names.
 */
export function listStorageAdapters(): string[] {
  return [...registry.keys()];
}

/**
 * Create a storage provider using a registered adapter.
 *
 * Resolution order:
 * 1. Explicit `name` parameter
 * 2. `STORAGE_ADAPTER` environment variable
 * 3. Default: `"local-file"`
 *
 * @throws If the adapter name is not found in the registry.
 */
export async function createStorageFromRegistry(
  name?: string,
  config?: Record<string, unknown>,
): Promise<StorageProvider> {
  const adapterName = name ?? process.env.STORAGE_ADAPTER ?? "local-file";
  const factory = registry.get(adapterName);
  if (!factory) {
    const available = [...registry.keys()].join(", ");
    throw new Error(
      `Unknown storage adapter: "${adapterName}". Registered adapters: ${available}`,
    );
  }
  Logger.info(
    "system",
    "storage",
    `Creating storage with adapter: ${adapterName}`,
  );
  return factory(config ?? {});
}
