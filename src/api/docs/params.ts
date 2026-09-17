/**
 * 参数文档的统一中间表示（ParamDoc）与两个适配器：
 *   - JSON Schema（由 WorkflowSchema 的 Zod 定义生成）→ ParamDoc[]，用于节点配置
 *   - OpenAPI 的 schema/参数对象 → ParamDoc[]，用于 REST 端点
 *
 * 渲染层（renderer.ts）只认 ParamDoc，不关心来源，因此节点页与端点页
 * 共用同一套 Dify 式的逐参数版式。
 */

export interface ParamDoc {
  /** 参数名，嵌套字段用裸名（层级由 children 表达）。 */
  name: string;
  /** 展示用类型串，如 `string`、`number`、`object[]`、`enum<string>`。 */
  type: string;
  required: boolean;
  /** 默认值的字面量展示，缺省时为 undefined。 */
  defaultValue?: string;
  /** 枚举可选值，渲染成 "可选值" 一行。 */
  enumValues?: string[];
  /** 人工撰写的说明；schema 不携带语义，必须由 descriptions 表补齐。 */
  description?: string;
  /** 嵌套字段（object 的属性，或 array<object> 的元素属性）。 */
  children?: ParamDoc[];
  /** 该参数已弃用/兼容保留。 */
  deprecated?: boolean;
}

interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  enum?: unknown[];
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  additionalProperties?: JsonSchemaNode | boolean;
  default?: unknown;
  description?: string;
  deprecated?: boolean;
  $ref?: string;
}

/** 说明文案覆盖表：键为点分路径（如 `retryPolicy.backoff`）。 */
export type DescriptionMap = Record<string, string>;

function literal(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  return JSON.stringify(value) ?? String(value);
}

/**
 * 把 JSON Schema 的类型信息压成一个可读串。
 * 规则对齐 Dify：枚举显示为 `enum<string>`，数组显示为 `T[]`，
 * record 显示为 `object`，无类型信息显示为 `any`。
 */
function describeType(schema: JsonSchemaNode): string {
  if (schema.enum && schema.enum.length > 0) {
    const base = typeof schema.enum[0];
    return `enum<${base === "object" ? "any" : base}>`;
  }

  // anyOf 里若含枚举分支（如 notification.channel），以枚举为主类型展示，
  // 具体可选值由 collectEnum 补在下方，避免类型串退化成无信息的 `string`。
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches && branches.length > 0) {
    const enumBranch = branches.find((b) => b.enum && b.enum.length > 0);
    if (enumBranch) {
      const others = branches.filter((b) => b !== enumBranch);
      const base = typeof (enumBranch.enum as unknown[])[0];
      return others.length > 0
        ? `enum<${base}> | ${others.map(describeType).join(" | ")}`
        : `enum<${base}>`;
    }
    return branches.map(describeType).join(" | ");
  }

  const raw = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  if (raw === "array") {
    const item = schema.items ? describeType(schema.items) : "any";
    return `${item}[]`;
  }

  if (!raw) return "any";
  return raw;
}

function collectEnum(schema: JsonSchemaNode): string[] | undefined {
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum.map((v) => String(v));
  }
  const branches = schema.anyOf ?? schema.oneOf;
  const enumBranch = branches?.find((b) => b.enum && b.enum.length > 0);
  if (enumBranch?.enum) {
    return enumBranch.enum.map((v) => String(v));
  }
  return undefined;
}

/**
 * 取出可展开的子字段：object 直接取 properties，array<object> 取
 * items.properties（Dify 对 `object[]` 也是这样展开的）。
 */
function childSchemaOf(
  schema: JsonSchemaNode,
): { node: JsonSchemaNode; viaItems: boolean } | null {
  if (schema.properties) return { node: schema, viaItems: false };
  if (schema.items?.properties) return { node: schema.items, viaItems: true };
  return null;
}

/**
 * 把一个 object JSON Schema 摊平成 ParamDoc[]。
 * `descriptions` 按点分路径覆盖说明文案；`pathPrefix` 供递归拼路径。
 */
export function paramsFromJsonSchema(
  schema: JsonSchemaNode | null | undefined,
  descriptions: DescriptionMap = {},
  pathPrefix = "",
): ParamDoc[] {
  if (!schema?.properties) return [];

  const requiredSet = new Set(schema.required ?? []);

  return Object.entries(schema.properties).map(([name, prop]) => {
    const path = pathPrefix ? `${pathPrefix}.${name}` : name;
    const nested = childSchemaOf(prop);

    const doc: ParamDoc = {
      name,
      type: describeType(prop),
      required: requiredSet.has(name),
      description: descriptions[path] ?? prop.description,
      deprecated: prop.deprecated === true,
    };

    const enumValues = collectEnum(prop);
    if (enumValues) doc.enumValues = enumValues;
    if (prop.default !== undefined) doc.defaultValue = literal(prop.default);

    if (nested) {
      const children = paramsFromJsonSchema(nested.node, descriptions, path);
      if (children.length > 0) doc.children = children;
    }

    return doc;
  });
}

/**
 * 从 OpenAPI 的 parameter 对象数组（path/query/header 参数）生成 ParamDoc[]。
 * `in` 作为标签拼进类型串，对齐 Dify 的 `string` `header` `required` 徽章组。
 */
interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: JsonSchemaNode;
  deprecated?: boolean;
}

export function paramsFromOpenApiParameters(
  parameters: OpenApiParameter[] | undefined,
): ParamDoc[] {
  if (!parameters || parameters.length === 0) return [];
  return parameters.map((p) => {
    const doc: ParamDoc = {
      name: p.name,
      type: p.schema ? describeType(p.schema) : "string",
      required: p.required === true,
      description: p.description,
      deprecated: p.deprecated === true,
    };
    const enumValues = p.schema ? collectEnum(p.schema) : undefined;
    if (enumValues) doc.enumValues = enumValues;
    if (p.schema?.default !== undefined) {
      doc.defaultValue = literal(p.schema.default);
    }
    return doc;
  });
}

/**
 * 解析 OpenAPI 的 `$ref` 并把 body/response schema 摊成 ParamDoc[]。
 * 只解析 `#/components/schemas/X` 形式；解析不到时返回空数组而不是抛错，
 * 以免一个未定义的 ref 让整页文档挂掉。
 */
export function paramsFromOpenApiSchema(
  schema: JsonSchemaNode | undefined,
  components: Record<string, JsonSchemaNode>,
  descriptions: DescriptionMap = {},
  seen: Set<string> = new Set(),
): ParamDoc[] {
  const resolved = resolveRef(schema, components, seen);
  if (!resolved) return [];

  // 顶层是数组时展开其元素属性，使响应体为列表的端点也能逐字段列出。
  if (resolved.type === "array" && resolved.items) {
    const item = resolveRef(resolved.items, components, seen);
    return paramsFromJsonSchema(item, descriptions);
  }

  return paramsFromJsonSchema(
    inlineRefs(resolved, components, seen),
    descriptions,
  );
}

function resolveRef(
  schema: JsonSchemaNode | undefined,
  components: Record<string, JsonSchemaNode>,
  seen: Set<string>,
): JsonSchemaNode | undefined {
  if (!schema) return undefined;
  if (!schema.$ref) return schema;

  const key = schema.$ref.replace("#/components/schemas/", "");
  // 循环引用保护：同一个 ref 在一条解析链上只展开一次。
  if (seen.has(key)) return undefined;
  seen.add(key);
  return components[key];
}

/**
 * 递归把 properties 中的 `$ref` 就地替换成被引用的 schema，
 * 让 paramsFromJsonSchema 能一路展开嵌套对象。
 */
function inlineRefs(
  schema: JsonSchemaNode,
  components: Record<string, JsonSchemaNode>,
  seen: Set<string>,
): JsonSchemaNode {
  if (!schema.properties) return schema;

  const properties: Record<string, JsonSchemaNode> = {};
  for (const [name, prop] of Object.entries(schema.properties)) {
    // 每个分支用独立的 seen 副本，避免兄弟字段互相误判为循环。
    const branchSeen = new Set(seen);
    const target = prop.$ref ? resolveRef(prop, components, branchSeen) : prop;
    if (!target) {
      properties[name] = { type: "object" };
      continue;
    }
    if (prop.$ref) {
      properties[name] = inlineRefs(target, components, branchSeen);
    } else if (prop.items?.$ref) {
      const item = resolveRef(prop.items, components, branchSeen);
      properties[name] = {
        ...prop,
        items: item
          ? inlineRefs(item, components, branchSeen)
          : { type: "object" },
      };
    } else if (prop.properties) {
      properties[name] = inlineRefs(prop, components, branchSeen);
    } else {
      properties[name] = prop;
    }
  }

  return { ...schema, properties };
}
