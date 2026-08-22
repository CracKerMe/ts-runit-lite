// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import type { WorkflowInstance } from "../model/Instance";
import { getNestedValue } from "./ExpressionEvaluator";

/**
 * 实例高级搜索：内存过滤 + 排序 + 分页 + 聚合。
 * Memory/Redis 模式统一基于 InstanceManager 的内存映射执行。
 */

export type SearchOperator =
  | "eq"
  | "ne"
  | "in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "contains";

export interface SearchFilter {
  /** 支持顶层字段与嵌套路径，如 "searchAttributes.region" */
  field: string;
  operator: SearchOperator;
  value: unknown;
}

export interface SearchQuery {
  filters?: SearchFilter[];
  sort?: Array<{ field: string; order: "asc" | "desc" }>;
  /** 1-based，默认 1 */
  page?: number;
  /** 默认 20，上限 100 */
  pageSize?: number;
}

export interface SearchResult {
  instances: WorkflowInstance[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
  aggregations: {
    byStatus: Record<string, number>;
    byWorkflow: Record<string, number>;
  };
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
type ComparableValue = string | number | bigint | boolean;

/** 日期字段统一转毫秒时间戳后比较，其余保持原值 */
function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  return value;
}

/** 过滤值与实例字段比较时，尽量对齐类型（时间字符串 → 时间戳） */
function normalizeAgainst(filterValue: unknown, fieldValue: unknown): unknown {
  if (
    fieldValue instanceof Date &&
    (typeof filterValue === "string" || typeof filterValue === "number")
  ) {
    return new Date(filterValue).getTime();
  }
  return filterValue;
}

function compareValues(a: unknown, b: unknown): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 0;
  if (na === undefined || na === null) return -1;
  if (nb === undefined || nb === null) return 1;

  if (typeof na === "string" && typeof nb === "string") {
    return na.localeCompare(nb);
  }

  if (
    (typeof na === "number" ||
      typeof na === "bigint" ||
      typeof na === "boolean") &&
    (typeof nb === "number" ||
      typeof nb === "bigint" ||
      typeof nb === "boolean")
  ) {
    const left = na as ComparableValue;
    const right = nb as ComparableValue;
    return left > right ? 1 : -1;
  }

  return String(na).localeCompare(String(nb));
}

function matchesFilter(
  instance: WorkflowInstance,
  filter: SearchFilter,
): boolean {
  const raw = getNestedValue(
    instance as unknown as Record<string, any>,
    filter.field,
  );
  const fieldValue = normalize(raw);

  switch (filter.operator) {
    case "eq":
      return fieldValue === normalize(normalizeAgainst(filter.value, raw));
    case "ne":
      return fieldValue !== normalize(normalizeAgainst(filter.value, raw));
    case "in":
      return (
        Array.isArray(filter.value) &&
        filter.value.some(
          (v) => fieldValue === normalize(normalizeAgainst(v, raw)),
        )
      );
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (raw === undefined || raw === null) return false;
      const target = normalize(normalizeAgainst(filter.value, raw));
      const cmp = compareValues(raw, target);
      if (filter.operator === "gt") return cmp > 0;
      if (filter.operator === "gte") return cmp >= 0;
      if (filter.operator === "lt") return cmp < 0;
      return cmp <= 0;
    }
    case "between": {
      if (!Array.isArray(filter.value) || filter.value.length !== 2) {
        throw new Error(
          `between operator requires a [min, max] array for field ${filter.field}`,
        );
      }
      if (raw === undefined || raw === null) return false;
      const min = normalize(normalizeAgainst(filter.value[0], raw));
      const max = normalize(normalizeAgainst(filter.value[1], raw));
      return compareValues(raw, min) >= 0 && compareValues(raw, max) <= 0;
    }
    case "contains":
      return String(raw ?? "").includes(String(filter.value));
    default:
      throw new Error(`Unsupported operator: ${String(filter.operator)}`);
  }
}

export function searchInstances(
  instances: WorkflowInstance[],
  query: SearchQuery,
): SearchResult {
  let filtered = instances;
  for (const filter of query.filters ?? []) {
    filtered = filtered.filter((instance) => matchesFilter(instance, filter));
  }

  // 聚合基于过滤后的全集（分页前）
  const byStatus: Record<string, number> = {};
  const byWorkflow: Record<string, number> = {};
  for (const instance of filtered) {
    byStatus[instance.status] = (byStatus[instance.status] ?? 0) + 1;
    byWorkflow[instance.workflowId] =
      (byWorkflow[instance.workflowId] ?? 0) + 1;
  }

  if (query.sort?.length) {
    const sortSpecs = query.sort;
    filtered = [...filtered].sort((a, b) => {
      for (const spec of sortSpecs) {
        const av = getNestedValue(
          a as unknown as Record<string, any>,
          spec.field,
        );
        const bv = getNestedValue(
          b as unknown as Record<string, any>,
          spec.field,
        );
        const cmp = compareValues(av, bv);
        if (cmp !== 0) return spec.order === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  }

  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE),
  );
  const totalCount = filtered.length;
  const totalPages = Math.ceil(totalCount / pageSize) || 0;
  const start = (page - 1) * pageSize;

  return {
    instances: filtered.slice(start, start + pageSize),
    pagination: { page, pageSize, totalCount, totalPages },
    aggregations: { byStatus, byWorkflow },
  };
}
