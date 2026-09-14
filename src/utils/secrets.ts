import { Logger } from "./Logger";
import { SecretManager } from "./SecretManager";

/**
 * Process-wide SecretManager used to resolve `${secret:name}` patterns in node
 * configuration. Kept in its own module so node executors can reach it without
 * importing bootstrap (which would create an import cycle).
 */
let secretManager: SecretManager | null = null;

/**
 * Install the SecretManager used for node config resolution.
 * Called from bootstrap based on `SECRET_PROVIDER`.
 */
export function setSecretManager(manager: SecretManager | null): void {
  secretManager = manager;
}

export function getSecretManager(): SecretManager | null {
  return secretManager;
}

/**
 * Dispose the active SecretManager and clear the registry.
 */
export function disposeSecretManager(): void {
  secretManager?.dispose();
  secretManager = null;
}

/**
 * Resolve `${secret:name}` patterns in a node configuration object.
 *
 * Returns the config unchanged when no SecretManager is installed, so node
 * execution stays a no-op cost for applications that do not use secrets.
 */
export async function resolveSecrets<T>(config: T): Promise<T> {
  if (!secretManager || config === null || typeof config !== "object") {
    return config;
  }

  try {
    return (await secretManager.resolve(
      config as Record<string, unknown>,
    )) as T;
  } catch (error) {
    Logger.warn("system", "secret-manager", "Secret resolution failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
