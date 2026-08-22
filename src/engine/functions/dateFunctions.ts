import type { FunctionModule } from "./types";

const UNIT_MS: Record<string, number> = {
  seconds: 1000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
};

function toTimestamp(value: unknown): number {
  if (typeof value === "number") return value;
  return new Date(String(value)).getTime();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export const dateFunctions: FunctionModule = {
  formatDateUtc: {
    args: ["timestamp: number|string", "pattern?: string"],
    impl: (value: unknown, pattern = "YYYY-MM-DD HH:mm:ss"): string => {
      const d = new Date(toTimestamp(value));
      return pattern
        .replace("YYYY", String(d.getUTCFullYear()))
        .replace("MM", pad2(d.getUTCMonth() + 1))
        .replace("DD", pad2(d.getUTCDate()))
        .replace("HH", pad2(d.getUTCHours()))
        .replace("mm", pad2(d.getUTCMinutes()))
        .replace("ss", pad2(d.getUTCSeconds()));
    },
    description: "按 YYYY-MM-DD HH:mm:ss 模式格式化时间戳（UTC）",
  },
  dateDiff: {
    args: ["start: number|string", "end: number|string", "unit: string"],
    impl: (start: unknown, end: unknown, unit = "ms"): number => {
      const diff = toTimestamp(end) - toTimestamp(start);
      return Math.floor(diff / (UNIT_MS[unit] ?? 1));
    },
    description: "计算两个日期的差值（seconds/minutes/hours/days/weeks）",
  },
  addMinutes: {
    args: ["timestamp: number|string", "minutes: number"],
    impl: (value: unknown, minutes: number): number =>
      toTimestamp(value) + minutes * UNIT_MS.minutes,
    description: "时间戳加减分钟数",
  },
  startOfDayUtc: {
    args: ["timestamp: number|string"],
    impl: (value: unknown): number => {
      const d = new Date(toTimestamp(value));
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    },
    description: "返回当天 00:00:00.000（UTC）的时间戳",
  },
  endOfDayUtc: {
    args: ["timestamp: number|string"],
    impl: (value: unknown): number => {
      const d = new Date(toTimestamp(value));
      return (
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - 1
      );
    },
    description: "返回当天 23:59:59.999（UTC）的时间戳",
  },
  isBefore: {
    args: ["a: number|string", "b: number|string"],
    impl: (a: unknown, b: unknown): boolean => toTimestamp(a) < toTimestamp(b),
    description: "判断 a 是否早于 b",
  },
  isAfter: {
    args: ["a: number|string", "b: number|string"],
    impl: (a: unknown, b: unknown): boolean => toTimestamp(a) > toTimestamp(b),
    description: "判断 a 是否晚于 b",
  },
};
