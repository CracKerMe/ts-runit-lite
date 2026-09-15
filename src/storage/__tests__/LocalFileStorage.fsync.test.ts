// oxlint-disable no-explicit-any -- test spies on fs.promises internals
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { LocalFileStorage } from "../LocalFileStorage";

describe("LocalFileStorage – fsyncOnWrite option", () => {
  let directory: string;
  let storage: LocalFileStorage | undefined;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "ts-runit-fsync-"));
  });

  afterEach(async () => {
    await storage?.close();
    fs.rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const sampleInstance = (id: string): WorkflowInstance => ({
    instanceId: id,
    workflowId: "wf",
    currentNodes: ["n1"],
    status: "running",
    context: {},
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it("does not open a file handle at all by default (rename-only durability)", async () => {
    storage = new LocalFileStorage(directory);
    await storage.connect();

    // fsync requires an open FileHandle to call .sync() on; the default,
    // non-fsync write path uses fs.promises.writeFile + rename and never
    // needs to open a handle at all.
    const openSpy = vi.spyOn(fs.promises, "open");

    await storage.saveInstance(sampleInstance("inst-no-fsync"));

    expect(openSpy).not.toHaveBeenCalled();

    const restored = await storage.loadInstance("inst-no-fsync");
    expect(restored?.instanceId).toBe("inst-no-fsync");
  });

  it("fsyncs the temp file and the parent directory when fsyncOnWrite is true", async () => {
    storage = new LocalFileStorage({ directory, fsyncOnWrite: true });
    await storage.connect();

    const fileSyncCalls: string[] = [];
    const dirSyncCalls: string[] = [];
    const realOpen = fs.promises.open.bind(fs.promises);

    vi.spyOn(fs.promises, "open").mockImplementation(
      async (...args: Parameters<typeof fs.promises.open>) => {
        const handle = await realOpen(...args);
        const target = String(args[0]);
        const originalSync = handle.sync.bind(handle);
        handle.sync = async () => {
          if (target.endsWith(".tmp") || target.includes(".tmp")) {
            fileSyncCalls.push(target);
          } else {
            dirSyncCalls.push(target);
          }
          return originalSync();
        };
        return handle;
      },
    );

    await storage.saveInstance(sampleInstance("inst-fsync"));

    expect(fileSyncCalls.length).toBeGreaterThan(0);
    expect(dirSyncCalls.length).toBeGreaterThan(0);
    expect(dirSyncCalls[0]).toBe(path.join(directory, "instances"));

    // The write must still be correct and readable after the fsync path.
    const restored = await storage.loadInstance("inst-fsync");
    expect(restored?.instanceId).toBe("inst-fsync");
  });

  it("coalesces concurrent directory fsyncs for the same collection", async () => {
    storage = new LocalFileStorage({ directory, fsyncOnWrite: true });
    await storage.connect();

    const realOpen = fs.promises.open.bind(fs.promises);
    let dirOpenCount = 0;
    vi.spyOn(fs.promises, "open").mockImplementation(
      async (...args: Parameters<typeof fs.promises.open>) => {
        const target = String(args[0]);
        if (target === path.join(directory, "instances")) {
          dirOpenCount++;
        }
        return realOpen(...args);
      },
    );

    await Promise.all([
      storage.saveInstance(sampleInstance("inst-a")),
      storage.saveInstance(sampleInstance("inst-b")),
      storage.saveInstance(sampleInstance("inst-c")),
    ]);

    // Coalescing means we should not open the directory once per write;
    // overlapping fsyncs for the same directory share a single in-flight
    // operation.
    expect(dirOpenCount).toBeLessThan(3);
    expect(dirOpenCount).toBeGreaterThan(0);
  });
});
