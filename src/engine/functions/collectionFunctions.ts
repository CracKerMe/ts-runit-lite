// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import type { FunctionModule } from "./types";

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export const collectionFunctions: FunctionModule = {
  flatten: {
    args: ["array: unknown[]"],
    impl: (value: unknown): unknown[] =>
      asArray(value).flat(Number.POSITIVE_INFINITY),
    description: "展开任意深度的嵌套数组",
  },
  unique: {
    args: ["array: unknown[]"],
    impl: (value: unknown): unknown[] => [...new Set(asArray(value))],
    description: "数组去重",
  },
  chunk: {
    args: ["array: unknown[]", "size: number"],
    impl: (value: unknown, size: number): unknown[][] => {
      const arr = asArray(value);
      const n = Math.max(1, Math.floor(size));
      const result: unknown[][] = [];
      for (let i = 0; i < arr.length; i += n) {
        result.push(arr.slice(i, i + n));
      }
      return result;
    },
    description: "按指定大小分片",
  },
  groupBy: {
    args: ["array: object[]", "field: string"],
    impl: (value: unknown, field: string): Record<string, unknown[]> => {
      const result: Record<string, unknown[]> = {};
      for (const item of asArray(value)) {
        const key = String((item as Record<string, unknown>)?.[field]);
        if (!result[key]) {
          result[key] = [];
        }
        result[key].push(item);
      }
      return result;
    },
    description: "按字段值分组",
  },
  sortBy: {
    args: ["array: object[]", "field: string", "order?: 'asc'|'desc'"],
    impl: (value: unknown, field: string, order = "asc"): unknown[] => {
      const dir = order === "desc" ? -1 : 1;
      return [...asArray(value)].sort((a, b) => {
        const av = (a as Record<string, any>)?.[field];
        const bv = (b as Record<string, any>)?.[field];
        if (av === bv) return 0;
        return (av > bv ? 1 : -1) * dir;
      });
    },
    description: "按字段排序（asc/desc）",
  },
  pick: {
    args: ["object: object", "fields: string[]"],
    impl: (obj: unknown, fields: unknown): Record<string, unknown> => {
      const source = (obj ?? {}) as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const field of asArray(fields)) {
        const key = String(field);
        if (key in source) result[key] = source[key];
      }
      return result;
    },
    description: "选取对象的指定字段",
  },
  omit: {
    args: ["object: object", "fields: string[]"],
    impl: (obj: unknown, fields: unknown): Record<string, unknown> => {
      const source = (obj ?? {}) as Record<string, unknown>;
      const excluded = new Set(asArray(fields).map(String));
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(source)) {
        if (!excluded.has(key)) result[key] = value;
      }
      return result;
    },
    description: "排除对象的指定字段",
  },
  first: {
    args: ["array: unknown[]"],
    impl: (value: unknown): unknown => asArray(value)[0],
    description: "返回数组第一个元素",
  },
  last: {
    args: ["array: unknown[]"],
    impl: (value: unknown): unknown => {
      const arr = asArray(value);
      return arr[arr.length - 1];
    },
    description: "返回数组最后一个元素",
  },
  count: {
    args: ["array: unknown[]"],
    impl: (value: unknown): number => asArray(value).length,
    description: "返回数组长度",
  },
  sum: {
    args: ["array: number[]"],
    impl: (value: unknown): number =>
      asArray(value).reduce<number>((acc, v) => acc + Number(v), 0),
    description: "数值数组求和",
  },
  avg: {
    args: ["array: number[]"],
    impl: (value: unknown): number => {
      const arr = asArray(value);
      if (arr.length === 0) return 0;
      return arr.reduce<number>((acc, v) => acc + Number(v), 0) / arr.length;
    },
    description: "数值数组求平均",
  },
  keys: {
    args: ["object: object"],
    impl: (obj: unknown): string[] =>
      Object.keys((obj ?? {}) as Record<string, unknown>),
    description: "返回对象所有键",
  },
  values: {
    args: ["object: object"],
    impl: (obj: unknown): unknown[] =>
      Object.values((obj ?? {}) as Record<string, unknown>),
    description: "返回对象所有值",
  },
};
