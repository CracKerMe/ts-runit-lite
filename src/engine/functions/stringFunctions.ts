import { createHash, randomUUID } from "node:crypto";
import type { FunctionModule } from "./types";

export const stringFunctions: FunctionModule = {
  uuid: {
    args: [],
    impl: (): string => randomUUID(),
    description: "生成 UUID v4",
  },
  base64Encode: {
    args: ["value: string"],
    impl: (value: unknown): string =>
      Buffer.from(String(value), "utf8").toString("base64"),
    description: "Base64 编码",
  },
  base64Decode: {
    args: ["encoded: string"],
    impl: (encoded: unknown): string =>
      Buffer.from(String(encoded), "base64").toString("utf8"),
    description: "Base64 解码",
  },
  sha256: {
    args: ["value: string"],
    impl: (value: unknown): string =>
      createHash("sha256").update(String(value)).digest("hex"),
    description: "SHA-256 哈希（hex）",
  },
  md5: {
    args: ["value: string"],
    impl: (value: unknown): string =>
      createHash("md5").update(String(value)).digest("hex"),
    description: "MD5 哈希（hex，仅用于非安全场景）",
  },
  slugify: {
    args: ["value: string"],
    impl: (value: unknown): string =>
      String(value)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    description: "转换为 URL-safe slug",
  },
  truncate: {
    args: ["value: string", "maxLength: number"],
    impl: (value: unknown, maxLength: number): string => {
      const s = String(value);
      return s.length > maxLength ? `${s.slice(0, maxLength)}…` : s;
    },
    description: "截断字符串，超长时追加省略号",
  },
  padStart: {
    args: ["value: string", "targetLength: number", "pad?: string"],
    impl: (value: unknown, targetLength: number, pad = " "): string =>
      String(value).padStart(targetLength, String(pad)),
    description: "左侧填充到指定长度",
  },
  padEnd: {
    args: ["value: string", "targetLength: number", "pad?: string"],
    impl: (value: unknown, targetLength: number, pad = " "): string =>
      String(value).padEnd(targetLength, String(pad)),
    description: "右侧填充到指定长度",
  },
  replace: {
    args: ["value: string", "search: string", "replacement: string"],
    impl: (value: unknown, search: string, replacement: string): string =>
      String(value).split(String(search)).join(String(replacement)),
    description: "替换所有匹配的子串",
  },
  split: {
    args: ["value: string", "separator: string"],
    impl: (value: unknown, separator: string): string[] =>
      String(value).split(String(separator)),
    description: "按分隔符拆分为数组",
  },
};
