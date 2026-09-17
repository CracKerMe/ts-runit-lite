#!/usr/bin/env node

/**
 * Executable entry point for the workflow engine.
 * Runs the engine with optional API server (START_API_SERVER=true).
 */

import { closeApiServer, startApiServer } from "./api/server";
import { bootstrap, loadEnv } from "./bootstrap";
import { getShutdownInstance, watchParentProcess } from "./lifecycle";
import { Logger } from "./utils/Logger";
import { pathToFileURL } from "node:url";

export async function main(): Promise<void> {
  loadEnv();
  Logger.info("system", "init", "Starting workflow engine...");

  const { engine, container } = await bootstrap();

  if (process.env.START_API_SERVER === "true") {
    const server = await startApiServer(engine, container.storage);

    // Stop accepting connections as the FIRST step of the single shutdown
    // chain, before the engine and storage are torn down.
    getShutdownInstance()?.registerCallbackFirst(async () => {
      Logger.info("system", "shutdown", "Closing API server...");
      await closeApiServer(server);
    });

    Logger.info("system", "api", "API server is running");
  }

  // Ctrl+C 下 `tsx watch` 可能先于本进程退出（或被强杀），信号就再也送不到
  // 这里。那样本进程会被 init 收养并继续持有监听端口，watcher 重启时报
  // "Previous process hasn't exited yet"。主动检测被收养并走优雅关闭。
  watchParentProcess(() => {
    // 复用统一的关闭链；拿不到实例（比如关闭已在进行中）就直接退出。
    const shutdown = getShutdownInstance();
    if (shutdown && !shutdown.isInProgress()) {
      void shutdown.trigger("parent-exit");
    } else if (!shutdown) {
      process.exit(0);
    }
  });

  Logger.info("system", "init", "Workflow engine started successfully");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    Logger.error(
      "system",
      "fatal",
      "Fatal error during startup",
      error instanceof Error ? error.stack : String(error),
    );
    process.exitCode = 1;
  });
}
