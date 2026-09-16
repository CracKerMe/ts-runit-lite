import { describe, expect, it } from "vitest";
import { AppConfigSchema } from "../AppConfig";

describe("AppConfigSchema", () => {
  it("keeps archive configuration optional for existing config objects", () => {
    const config = AppConfigSchema.parse({
      redis: {},
      resources: {},
      engine: {},
      api: {},
      auth: {},
      cluster: {},
      workerPool: {},
      actionSandbox: {},
      rateLimit: {},
    });

    expect(config.storage).toEqual({
      type: "file",
      directory: ".ts-workflow-engine-data",
      fsyncOnWrite: false,
    });
    expect(config.archive).toEqual({
      enabled: false,
      retentionDays: 90,
      cleanupIntervalMs: 21_600_000,
    });
  });
});
