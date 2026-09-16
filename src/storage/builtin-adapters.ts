import { registerStorageAdapter } from "./registry";
import { MemoryStorage } from "./MemoryStorage";
import { LocalFileStorage } from "./LocalFileStorage";

/**
 * Register the built-in storage adapters: "memory" and "local-file".
 * Call this once at startup before any storage creation.
 */
export function registerBuiltinStorageAdapters(): void {
  registerStorageAdapter("memory", async () => {
    const storage = new MemoryStorage();
    await storage.connect();
    return storage;
  });

  registerStorageAdapter("local-file", async (config) => {
    const directory =
      (config.directory as string) ??
      process.env.STORAGE_DIR ??
      ".ts-workflow-engine-data";
    const fsyncOnWrite =
      (config.fsyncOnWrite as boolean) ?? process.env.FSYNC_ON_WRITE === "true";
    const storage = new LocalFileStorage({ directory, fsyncOnWrite });
    await storage.connect();
    return storage;
  });
}
