export const getWorkflowEngineConfig = () => {
  return {
    logLevel: process.env.WORKFLOW_ENGINE_LOG_LEVEL || "INFO",
    maxInstances: Number.parseInt(
      process.env.WORKFLOW_ENGINE_MAX_INSTANCES || "1000",
      10,
    ),
    instanceTtlHours: Number.parseInt(
      process.env.INSTANCE_TTL_HOURS || "24",
      10,
    ),
    cleanupIntervalMs: Number.parseInt(
      process.env.CLEANUP_INTERVAL_MS || "3600000",
      10,
    ),
  };
};
