import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    exclude: ["node_modules", "dist", "src/benchmarks/**"],

    // Silent logger in tests to reduce noise
    reporters: process.env.CI ? ["verbose"] : ["default"],

    // Suppress console output from production Logger in tests
    onConsoleLog: () => false,

    // Test file timeout
    testTimeout: 10_000,
    hookTimeout: 10_000,

    // Sequence configuration
    sequence: {
      shuffle: false, // Deterministic order for reproducibility
    },

    // Pool configuration for better resource usage
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // Avoid Redis port conflicts
      },
    },

    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/api/console/web/**",
        "src/api/console/tracing/**",
      ],
      // Minimum coverage thresholds for core modules
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
    },
  },
});
