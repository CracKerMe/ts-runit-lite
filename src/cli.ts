#!/usr/bin/env node

/**
 * Executable entry point for the demo and REST API service.
 */

import { closeApiServer, startApiServer } from "./api/server";
import { bootstrap, loadEnv } from "./bootstrap";
import type { WorkflowEngineV2 } from "./engine/WorkflowEngineV2";
import { getShutdownInstance } from "./lifecycle";
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
  } else if (process.env.RUN_DEMO !== "false") {
    const { runDemo } = await import("./demo/index");
    await runDemo(engine as WorkflowEngineV2, container.eventBus);
  }

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
