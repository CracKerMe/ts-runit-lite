import type { FunctionModule } from "./types";

export const typeFunctions: FunctionModule = {
  toNumber: {
    args: ["value: unknown"],
    impl: (value: unknown): number => Number(value),
    description: "转换为数字（无法转换时为 NaN）",
  },
  toString: {
    args: ["value: unknown"],
    impl: (value: unknown): string =>
      typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value),
    description: "转换为字符串（对象序列化为 JSON）",
  },
  toBoolean: {
    args: ["value: unknown"],
    impl: (value: unknown): boolean => {
      if (typeof value === "string") {
        const lowered = value.trim().toLowerCase();
        if (lowered === "false" || lowered === "0" || lowered === "") {
          return false;
        }
        return true;
      }
      return Boolean(value);
    },
    description: "转换为布尔值（'false'/'0'/'' 视为 false）",
  },
  jsonStringify: {
    args: ["value: unknown"],
    impl: (value: unknown): string => JSON.stringify(value),
    description: "JSON 序列化",
  },
  jsonParse: {
    args: ["json: string"],
    impl: (json: unknown): unknown => JSON.parse(String(json)),
    description: "JSON 反序列化",
  },
  typeOf: {
    args: ["value: unknown"],
    impl: (value: unknown): string => {
      if (value === null) return "null";
      if (Array.isArray(value)) return "array";
      return typeof value;
    },
    description: "返回值的类型名（null/array/string/number/...）",
  },
  isEmpty: {
    args: ["value: unknown"],
    impl: (value: unknown): boolean => {
      if (value === null || value === undefined) return true;
      if (typeof value === "string" || Array.isArray(value)) {
        return value.length === 0;
      }
      if (typeof value === "object") {
        return Object.keys(value as Record<string, unknown>).length === 0;
      }
      return false;
    },
    description: "判断是否为空（null/undefined/空串/空数组/空对象）",
  },
  defaultTo: {
    args: ["value: unknown", "fallback: unknown"],
    impl: (value: unknown, fallback: unknown): unknown =>
      value === null || value === undefined ? fallback : value,
    description: "值为 null/undefined 时返回默认值",
  },
};
