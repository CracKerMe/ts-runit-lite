/**
 * 环境变量数值解析工具。
 *
 * 为什么不用 `Number.parseInt`：`Number.parseInt("100abc", 10)` 静默返回 100，
 * 会掩盖配置笔误；`Number("100abc")` 返回 NaN，可以走回退分支并告警。
 *
 * 为什么不用 `??` 兜底：`??` 只处理 null/undefined，**不捕获 NaN**。
 * 形如 `Number.parseInt(x, 10) ?? 30000` 的写法会把 NaN 原样透传给
 * `setInterval`（被 Node 强制为 1ms）或比较运算（`n >= NaN` 恒为 false）。
 */

export interface ParseEnvIntOptions {
  /** 允许的最小值（含）。越界时回退到默认值。 */
  min?: number;
  /** 允许的最大值（含）。越界时回退到默认值。 */
  max?: number;
}

/**
 * 解析环境变量为整数，非法值一律回退到默认值。
 *
 * 回退场景：未设置、空串、非数字、NaN、Infinity、越界。
 *
 * @param value 原始环境变量值
 * @param defaultValue 非法时使用的默认值
 * @param options 可选的取值范围约束
 */
export function parseEnvInt(
  value: string | undefined,
  defaultValue: number,
  options: ParseEnvIntOptions = {},
): number {
  if (value === undefined || value.trim() === "") return defaultValue;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;

  const truncated = Math.trunc(parsed);
  const { min, max } = options;
  if (min !== undefined && truncated < min) return defaultValue;
  if (max !== undefined && truncated > max) return defaultValue;

  return truncated;
}
