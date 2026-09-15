import { defineConfig } from "vitest/config";

/**
 * 基准测试专用配置。
 *
 * 与 `vitest.config.ts` 分开，原因有二：
 *  - 主配置显式 exclude 了 `src/benchmarks/**`，基准不该拖慢常规测试；
 *  - 主配置用 `singleFork: true` 串行化整个套件，那是为了避免端口冲突，
 *    但会让基准数字受到同进程内其他测试的干扰。
 *
 * 运行：`pnpm bench`
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/benchmarks/**/*.test.ts"],
    exclude: ["node_modules", "dist"],

    reporters: ["verbose"],
    onConsoleLog: () => true, // 基准要打印数字，保留 console 输出

    // 基准跑得比单测久
    testTimeout: 120_000,
    hookTimeout: 120_000,

    sequence: { shuffle: false },

    // 每个基准文件独立进程，避免相互影响 GC 与 JIT 状态
    pool: "forks",
    poolOptions: {
      forks: { singleFork: false },
    },
  },
});
