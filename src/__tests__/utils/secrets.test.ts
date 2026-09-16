import { afterEach, describe, expect, it } from "vitest";
import {
  EnvSecretProvider,
  SecretManager,
  UnsupportedSecretProviderError,
} from "../../utils/SecretManager";
import {
  disposeSecretManager,
  getSecretManager,
  resolveSecrets,
  setSecretManager,
} from "../../utils/secrets";

describe("secret resolution registry", () => {
  afterEach(() => {
    disposeSecretManager();
    delete process.env.DB_PASSWORD;
    delete process.env.API_TOKEN;
  });

  it("returns config unchanged when no manager is installed", async () => {
    setSecretManager(null);
    const config = { url: "https://x/${secret:API_TOKEN}" };

    await expect(resolveSecrets(config)).resolves.toEqual(config);
  });

  it("resolves ${secret:name} from the env provider", async () => {
    process.env.API_TOKEN = "tok-123";
    setSecretManager(new SecretManager(new EnvSecretProvider()));

    const resolved = await resolveSecrets({
      url: "https://api.test/v1",
      headers: { Authorization: "Bearer ${secret:API_TOKEN}" },
    });

    expect(resolved.headers.Authorization).toBe("Bearer tok-123");
  });

  it("resolves secrets nested in objects", async () => {
    process.env.DB_PASSWORD = "s3cret";
    setSecretManager(new SecretManager(new EnvSecretProvider()));

    const resolved = await resolveSecrets({
      connection: {
        host: "localhost",
        auth: { password: "${secret:DB_PASSWORD}" },
      },
    });

    expect(resolved.connection.auth.password).toBe("s3cret");
  });

  it("leaves unknown secrets unreplaced rather than emitting undefined", async () => {
    setSecretManager(new SecretManager(new EnvSecretProvider()));

    const resolved = await resolveSecrets({
      token: "${secret:DOES_NOT_EXIST}",
    });

    expect(resolved.token).toBe("${secret:DOES_NOT_EXIST}");
  });

  it("passes through non-object configs untouched", async () => {
    setSecretManager(new SecretManager(new EnvSecretProvider()));

    await expect(resolveSecrets(undefined)).resolves.toBeUndefined();
    await expect(resolveSecrets(null)).resolves.toBeNull();
  });

  it("tracks and disposes the installed manager", () => {
    const manager = new SecretManager(new EnvSecretProvider());
    setSecretManager(manager);
    expect(getSecretManager()).toBe(manager);

    disposeSecretManager();
    expect(getSecretManager()).toBeNull();
  });
});

describe("SecretManager.createFor", () => {
  it("builds an env-backed manager", async () => {
    process.env.API_TOKEN = "from-env";
    const manager = SecretManager.createFor("env");

    await expect(manager.getSecret("API_TOKEN")).resolves.toBe("from-env");
    manager.dispose();
    delete process.env.API_TOKEN;
  });

  it("throws for declared-but-unimplemented providers", () => {
    // Fails fast at startup rather than silently degrading to env lookups.
    expect(() => SecretManager.createFor("vault")).toThrow(
      UnsupportedSecretProviderError,
    );
    expect(() => SecretManager.createFor("aws-secrets-manager")).toThrow(
      UnsupportedSecretProviderError,
    );
  });
});
