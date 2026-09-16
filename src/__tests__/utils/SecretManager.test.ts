import { beforeEach, describe, expect, it } from "vitest";
import { EnvSecretProvider, SecretManager } from "../../utils/SecretManager";

describe("SecretManager", () => {
  let manager: SecretManager;
  let provider: EnvSecretProvider;

  beforeEach(() => {
    provider = new EnvSecretProvider("TEST_SECRET");
    manager = new SecretManager(provider);
  });

  describe("EnvSecretProvider", () => {
    it("should get secrets from environment", async () => {
      process.env.TEST_SECRET_MY_KEY = "my-value";

      const value = await provider.getSecret("MY_KEY");
      expect(value).toBe("my-value");

      delete process.env.TEST_SECRET_MY_KEY;
    });

    it("should return null for non-existent secrets", async () => {
      const value = await provider.getSecret("NON_EXISTENT");
      expect(value).toBeNull();
    });

    it("should set secrets", async () => {
      await provider.setSecret("NEW_KEY", "new-value");

      const value = await provider.getSecret("NEW_KEY");
      expect(value).toBe("new-value");

      delete process.env.TEST_SECRET_NEW_KEY;
    });

    it("should list secrets", async () => {
      process.env.TEST_SECRET_KEY1 = "value1";
      process.env.TEST_SECRET_KEY2 = "value2";

      const secrets = await provider.listSecrets();
      expect(secrets).toContain("KEY1");
      expect(secrets).toContain("KEY2");

      delete process.env.TEST_SECRET_KEY1;
      delete process.env.TEST_SECRET_KEY2;
    });
  });

  describe("SecretManager", () => {
    it("should get and cache secrets", async () => {
      process.env.TEST_SECRET_CACHED = "cached-value";

      const value1 = await manager.getSecret("CACHED");
      const value2 = await manager.getSecret("CACHED");

      expect(value1).toBe("cached-value");
      expect(value2).toBe("cached-value");

      delete process.env.TEST_SECRET_CACHED;
    });

    it("should resolve secret references in strings", async () => {
      process.env.TEST_SECRET_API_KEY = "sk-123";

      const resolved = await manager.resolveString("Bearer ${secret:API_KEY}");

      expect(resolved).toBe("Bearer sk-123");

      delete process.env.TEST_SECRET_API_KEY;
    });

    it("should leave unresolved secrets as-is", async () => {
      const resolved = await manager.resolveString(
        "Value: ${secret:NON_EXISTENT}",
      );

      expect(resolved).toBe("Value: ${secret:NON_EXISTENT}");
    });

    it("should resolve secrets in config objects", async () => {
      process.env.TEST_SECRET_DB_HOST = "localhost";
      process.env.TEST_SECRET_DB_PASS = "password";

      const config = {
        host: "${secret:DB_HOST}",
        password: "${secret:DB_PASS}",
        port: 5432,
      };

      const resolved = await manager.resolve(config);

      expect(resolved.host).toBe("localhost");
      expect(resolved.password).toBe("password");
      expect(resolved.port).toBe(5432);

      delete process.env.TEST_SECRET_DB_HOST;
      delete process.env.TEST_SECRET_DB_PASS;
    });

    it("should resolve nested config objects", async () => {
      process.env.TEST_SECRET_KEY = "nested-value";

      const config = {
        database: {
          connection: {
            key: "${secret:KEY}",
          },
        },
      };

      const resolved = await manager.resolve(config);

      expect(resolved.database.connection.key).toBe("nested-value");

      delete process.env.TEST_SECRET_KEY;
    });

    it("should clear cache", async () => {
      process.env.TEST_SECRET_CLEAR = "value";

      await manager.getSecret("CLEAR");
      manager.clearCache();

      // Should still work after cache clear
      const value = await manager.getSecret("CLEAR");
      expect(value).toBe("value");

      delete process.env.TEST_SECRET_CLEAR;
    });
  });

  describe("create factory", () => {
    it("should create with env provider by default", () => {
      const mgr = SecretManager.create();
      expect(mgr).toBeInstanceOf(SecretManager);
    });
  });
});
