// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import { BoundedMap } from "./BoundedMap";
import { Logger } from "./Logger";

/**
 * Error thrown when a secret provider is not implemented.
 */
export class UnsupportedSecretProviderError extends Error {
  constructor(provider: string) {
    super(
      `Secret provider '${provider}' is not implemented. ` +
        "Use 'env' for development, or implement the provider before enabling it in production.",
    );
    this.name = "UnsupportedSecretProviderError";
  }
}

/**
 * Secret provider interface for retrieving secrets from various backends
 */
export interface SecretProvider {
  getSecret(name: string): Promise<string | null>;
  setSecret(name: string, value: string): Promise<void>;
  listSecrets(): Promise<string[]>;
}

/**
 * Environment variable-based secret provider (default)
 */
export class EnvSecretProvider implements SecretProvider {
  private prefix: string;

  constructor(prefix = "") {
    this.prefix = prefix;
  }

  async getSecret(name: string): Promise<string | null> {
    const key = this.prefix ? `${this.prefix}_${name}` : name;
    return process.env[key] || null;
  }

  async setSecret(name: string, value: string): Promise<void> {
    const key = this.prefix ? `${this.prefix}_${name}` : name;
    process.env[key] = value;
  }

  async listSecrets(): Promise<string[]> {
    const prefix = this.prefix ? `${this.prefix}_` : "";
    return Object.keys(process.env)
      .filter((key) => key.startsWith(prefix))
      .map((key) => (prefix ? key.slice(prefix.length) : key));
  }
}

/**
 * HashiCorp Vault secret provider (not yet implemented).
 * Throws on construction to prevent silent misconfiguration.
 */
export class VaultSecretProvider implements SecretProvider {
  constructor() {
    throw new UnsupportedSecretProviderError("vault");
  }

  async getSecret(_name: string): Promise<string | null> {
    throw new UnsupportedSecretProviderError("vault");
  }

  async setSecret(_name: string, _value: string): Promise<void> {
    throw new UnsupportedSecretProviderError("vault");
  }

  async listSecrets(): Promise<string[]> {
    throw new UnsupportedSecretProviderError("vault");
  }
}

/**
 * AWS Secrets Manager provider (not yet implemented).
 * Throws on construction to prevent silent misconfiguration.
 */
export class AwsSecretsManagerProvider implements SecretProvider {
  constructor() {
    throw new UnsupportedSecretProviderError("aws-secrets-manager");
  }

  async getSecret(_name: string): Promise<string | null> {
    throw new UnsupportedSecretProviderError("aws-secrets-manager");
  }

  async setSecret(_name: string, _value: string): Promise<void> {
    throw new UnsupportedSecretProviderError("aws-secrets-manager");
  }

  async listSecrets(): Promise<string[]> {
    throw new UnsupportedSecretProviderError("aws-secrets-manager");
  }
}

/**
 * Unified secret manager that resolves ${secret:xxx} patterns in configuration
 */
export class SecretManager {
  private provider: SecretProvider;
  private cache: BoundedMap<string, string>;

  constructor(
    provider: SecretProvider,
    cacheTtlMs = 60000,
    cacheMaxSize = 1000,
  ) {
    this.provider = provider;
    this.cache = new BoundedMap<string, string>({
      maxSize: cacheMaxSize,
      ttlMs: cacheTtlMs,
    });
  }

  /**
   * Get a secret by name
   */
  async getSecret(name: string): Promise<string | null> {
    // Check cache first (BoundedMap handles TTL automatically)
    const cached = this.cache.get(name);
    if (cached !== undefined) {
      return cached;
    }

    const value = await this.provider.getSecret(name);

    // Cache the result (even if null to avoid repeated lookups)
    if (value !== null) {
      this.cache.set(name, value);
    }

    return value;
  }

  /**
   * Set a secret
   */
  async setSecret(name: string, value: string): Promise<void> {
    await this.provider.setSecret(name, value);
    // Update cache
    this.cache.set(name, value);
  }

  /**
   * List available secrets
   */
  async listSecrets(): Promise<string[]> {
    return this.provider.listSecrets();
  }

  /**
   * Resolve ${secret:xxx} patterns in a configuration object
   */
  async resolve(config: Record<string, any>): Promise<Record<string, any>> {
    const resolved = { ...config };

    for (const [key, value] of Object.entries(resolved)) {
      if (typeof value === "string") {
        resolved[key] = await this.resolveString(value);
      } else if (typeof value === "object" && value !== null) {
        resolved[key] = await this.resolve(value);
      }
    }

    return resolved;
  }

  /**
   * Resolve ${secret:xxx} patterns in a string
   */
  async resolveString(template: string): Promise<string> {
    const secretPattern = /\$\{secret:([^}]+)\}/g;
    let result = template;

    for (const match of template.matchAll(secretPattern)) {
      const secretName = match[1];
      const secretValue = await this.getSecret(secretName);

      if (secretValue === null) {
        Logger.warn(
          "system",
          "secret-manager",
          `Secret not found: ${secretName}`,
        );
        // Leave unreplaced pattern but log a clear warning
        continue;
      }

      result = result.replaceAll(match[0], secretValue);
    }

    return result;
  }

  /**
   * Clear the secret cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Dispose of the cache timer. Call when SecretManager is no longer needed.
   */
  dispose(): void {
    this.cache.dispose();
  }

  /**
   * Create a SecretManager with the appropriate provider based on environment
   */
  static create(): SecretManager {
    const providerType = process.env.SECRET_PROVIDER || "env";

    let provider: SecretProvider;

    switch (providerType.toLowerCase()) {
      case "vault":
        provider = new VaultSecretProvider();
        break;
      case "aws":
      case "aws-secrets-manager":
        provider = new AwsSecretsManagerProvider();
        break;
      default:
        provider = new EnvSecretProvider();
        break;
    }

    Logger.info(
      "system",
      "secret-manager",
      `Secret manager initialized with ${providerType} provider`,
    );

    return new SecretManager(provider);
  }
}
