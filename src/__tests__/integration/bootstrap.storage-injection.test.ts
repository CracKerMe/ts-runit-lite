/**
 * Integration tests for `bootstrap({ storage })` — the injection point that
 * lets an embedder hand the engine a custom StorageProvider (e.g. a
 * database-backed adapter) instead of the built-in memory/file storage.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrap } from "../../bootstrap";
import { destroyContainer } from "../../container";
import { MemoryStorage } from "../../storage/MemoryStorage";

describe("bootstrap({ storage })", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the injected storage provider instance as-is", async () => {
    const storage = new MemoryStorage();
    const ctx = await bootstrap({
      storage,
      skipValidation: true,
      skipGracefulShutdown: true,
    });

    try {
      expect(ctx.container.storage).toBe(storage);
    } finally {
      await destroyContainer(ctx.container);
    }
  });

  it("calls connect() exactly once on the injected provider", async () => {
    const storage = new MemoryStorage();
    const connectSpy = vi.spyOn(storage, "connect");

    const ctx = await bootstrap({
      storage,
      skipValidation: true,
      skipGracefulShutdown: true,
    });

    try {
      expect(connectSpy).toHaveBeenCalledTimes(1);
    } finally {
      await destroyContainer(ctx.container);
    }
  });

  it("ignores storageType/storageDirectory when storage is supplied", async () => {
    const storage = new MemoryStorage();
    const ctx = await bootstrap({
      storage,
      storageType: "file",
      storageDirectory: "/nonexistent/should-not-be-used",
      skipValidation: true,
      skipGracefulShutdown: true,
    });

    try {
      // If the file adapter had been constructed instead, this would not be
      // reference-equal to our MemoryStorage instance.
      expect(ctx.container.storage).toBe(storage);
    } finally {
      await destroyContainer(ctx.container);
    }
  });

  it("falls back to the default storage type when storage is not supplied", async () => {
    const ctx = await bootstrap({
      storageType: "memory",
      skipValidation: true,
      skipGracefulShutdown: true,
    });

    try {
      expect(ctx.container.storage).toBeInstanceOf(MemoryStorage);
    } finally {
      await destroyContainer(ctx.container);
    }
  });
});
