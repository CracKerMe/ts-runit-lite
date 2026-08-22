// oxlint-disable no-explicit-any -- dynamic types used throughout this module
/**
 * 输入输出数据校验器
 * 自研的 JSON Schema 子集校验实现（与 SchemaValidator 校验工作流"结构"不同，
 * 本模块校验工作流启动输入与节点输出"数据"）。
 *
 * 支持关键字：type / required / properties / items / enum /
 * minimum / maximum / minLength / maxLength / pattern / format(email)
 *
 * 校验模式通过环境变量 SCHEMA_VALIDATION 控制：
 * - strict：校验失败抛出 DataValidationError
 * - warn：校验失败仅记录警告
 * - off：不校验（默认，向后兼容）
 */

export interface DataValidationIssue {
  path: string;
  message: string;
}

export interface DataValidationResult {
  valid: boolean;
  issues: DataValidationIssue[];
}

export type ValidationMode = "strict" | "warn" | "off";

export class DataValidationError extends Error {
  constructor(public readonly issues: DataValidationIssue[]) {
    super(
      `Data validation failed: ${issues
        .map((i) => `${i.path} ${i.message}`)
        .join("; ")}`,
    );
    this.name = "DataValidationError";
  }
}

export function getValidationMode(): ValidationMode {
  const mode = (process.env.SCHEMA_VALIDATION || "off").toLowerCase();
  if (mode === "strict" || mode === "warn") return mode;
  return "off";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validateValue(
  schema: Record<string, any>,
  value: unknown,
  path: string,
  issues: DataValidationIssue[],
): void {
  // type
  if (schema.type !== undefined) {
    const actual = typeOf(value);
    const expected: string[] = Array.isArray(schema.type)
      ? schema.type
      : [schema.type];
    const matches = expected.some((t) =>
      t === "integer"
        ? actual === "number" && Number.isInteger(value)
        : actual === t,
    );
    if (!matches) {
      issues.push({
        path,
        message: `must be of type ${expected.join("|")}, got ${actual}`,
      });
      return; // 类型不匹配时后续关键字无意义
    }
  }

  // enum
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    issues.push({
      path,
      message: `must be one of: ${schema.enum.map(String).join(", ")}`,
    });
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      issues.push({ path, message: `must be >= ${schema.minimum}` });
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      issues.push({ path, message: `must be <= ${schema.maximum}` });
    }
  }

  if (typeof value === "string") {
    if (
      typeof schema.minLength === "number" &&
      value.length < schema.minLength
    ) {
      issues.push({
        path,
        message: `length must be >= ${schema.minLength}`,
      });
    }
    if (
      typeof schema.maxLength === "number" &&
      value.length > schema.maxLength
    ) {
      issues.push({
        path,
        message: `length must be <= ${schema.maxLength}`,
      });
    }
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          issues.push({
            path,
            message: `must match pattern ${schema.pattern}`,
          });
        }
      } catch {
        issues.push({
          path,
          message: `schema has invalid pattern: ${schema.pattern}`,
        });
      }
    }
    if (schema.format === "email" && !EMAIL_PATTERN.test(value)) {
      issues.push({ path, message: "must be a valid email address" });
    }
  }

  if (
    Array.isArray(value) &&
    schema.items &&
    typeof schema.items === "object"
  ) {
    value.forEach((item, index) => {
      validateValue(schema.items, item, `${path}/${index}`, issues);
    });
  }

  if (
    typeOf(value) === "object" &&
    (schema.properties || Array.isArray(schema.required))
  ) {
    const obj = value as Record<string, unknown>;
    const base = path === "/" ? "" : path;

    for (const field of (schema.required as string[]) ?? []) {
      if (obj[field] === undefined) {
        issues.push({ path: `${base}/${field}`, message: "is required" });
      }
    }

    if (schema.properties && typeof schema.properties === "object") {
      for (const [field, fieldSchema] of Object.entries(
        schema.properties as Record<string, Record<string, any>>,
      )) {
        if (obj[field] !== undefined) {
          validateValue(fieldSchema, obj[field], `${base}/${field}`, issues);
        }
      }
    }
  }
}

/**
 * 按 Schema 校验数据，返回全部问题（不抛异常）。
 */
export function validateAgainstSchema(
  schema: Record<string, any>,
  data: unknown,
  basePath = "/",
): DataValidationResult {
  const issues: DataValidationIssue[] = [];
  validateValue(schema, data, basePath, issues);
  return { valid: issues.length === 0, issues };
}
