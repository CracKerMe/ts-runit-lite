import { describe, expect, it } from "vitest";
import { getMetrics, recordApiRequest } from "../index";

/** 数一个指标在 Prometheus 输出里有多少条时间序列。 */
function seriesCount(output: string, metricName: string): number {
  return output
    .split("\n")
    .filter(
      (line) => line.startsWith(`${metricName}{`) || line === metricName,
    ).length;
}

describe("metrics – label cardinality", () => {
  it("caps the number of series a single metric can hold", () => {
    // 回归守卫：指标 Map 从不驱逐。未匹配路由的 404 请求其 path 完全由
    // 调用方控制（扫描器 URL 既不含 UUID 也不含数字段），会原样成为永久
    // 标签行——未认证即可无限增长内存并让 /metrics 无法抓取。
    for (let i = 0; i < 3000; i++) {
      recordApiRequest("GET", `/scanner-probe-${i}.php`, 404, 0.01);
    }

    const output = getMetrics();
    const count = seriesCount(output, "workflow_api_requests_total");

    // 硬上限是 1000，加上溢出桶和本套件其它用例留下的少量序列
    expect(count).toBeLessThanOrEqual(1100);
  });

  it("folds overflowing labels into a single overflow bucket", () => {
    for (let i = 0; i < 3000; i++) {
      recordApiRequest("GET", `/another-probe-${i}`, 404, 0.01);
    }

    const output = getMetrics();
    expect(output).toContain("overflow");
  });

  it("keeps counting requests after the cap is reached", () => {
    // 溢出不能丢计数——counter 的总量仍要单调递增
    const before = getMetrics();
    const beforeTotal = [...before.matchAll(/workflow_api_requests_total\{[^}]*\}\s+(\d+)/g)]
      .reduce((sum, m) => sum + Number(m[1]), 0);

    for (let i = 0; i < 50; i++) {
      recordApiRequest("GET", `/post-cap-${i}`, 404, 0.01);
    }

    const after = getMetrics();
    const afterTotal = [...after.matchAll(/workflow_api_requests_total\{[^}]*\}\s+(\d+)/g)]
      .reduce((sum, m) => sum + Number(m[1]), 0);

    expect(afterTotal).toBe(beforeTotal + 50);
  });
});
