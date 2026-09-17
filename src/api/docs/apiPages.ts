/**
 * REST 端点参考页：/api-docs 与 /api-docs/:tag/:opIndex。
 *
 * 数据全部来自 openapi.ts 的 openApiSpec —— 端点、参数、请求体、响应
 * schema 与示例都已在那里定义，这里只做 OpenAPI → ParamDoc → Dify 版式
 * 的转换，不重复维护第二份端点清单。
 */

import { openApiSpec } from "../openapi";
import {
  paramsFromOpenApiParameters,
  paramsFromOpenApiSchema,
  type ParamDoc,
} from "./params";
import {
  escapeHtml,
  renderDocPage,
  type CodeBlockGroup,
  type CodeSample,
  type DocPage,
  type NavGroup,
  type ParamSection,
  type TopbarLink,
} from "./renderer";

const TOPBAR: TopbarLink[] = [
  { href: "/docs/nodes", label: "节点参考" },
  { href: "/api-docs", label: "REST API", active: true },
  { href: "/docs/concepts", label: "核心概念" },
  { href: "/playground", label: "Playground" },
];

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

interface Operation {
  /** 稳定的页面标识，形如 `instances-post-0`。 */
  slug: string;
  method: string;
  path: string;
  summary: string;
  description?: string;
  tag: string;
  raw: Record<string, unknown>;
}

interface SpecLike {
  paths: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<string, unknown>;
    examples?: Record<string, unknown>;
  };
  servers?: { url: string }[];
  tags?: { name: string; description?: string }[];
}

const spec = openApiSpec as unknown as SpecLike;
const components = (spec.components?.schemas ?? {}) as Record<string, never>;
const exampleStore = (spec.components?.examples ?? {}) as Record<
  string,
  { value?: unknown; summary?: string }
>;
const BASE_URL = spec.servers?.[0]?.url ?? "/workflow-api/v1";

/** 把 slug 里不安全的字符规整掉，保证能放进 URL。 */
function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** 展开 spec.paths 为扁平的操作列表，顺序即侧栏顺序。 */
function collectOperations(): Operation[] {
  const ops: Operation[] = [];

  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method] as
        | {
            tags?: string[];
            summary?: string;
            description?: string;
          }
        | undefined;
      if (!op) continue;

      const tag = op.tags?.[0] ?? "other";
      ops.push({
        slug: `${slugify(tag)}-${method}-${slugify(path)}`,
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? `${method.toUpperCase()} ${path}`,
        description: op.description,
        tag,
        raw: op as Record<string, unknown>,
      });
    }
  }

  return ops;
}

const OPERATIONS = collectOperations();

/** 按 spec.tags 的声明顺序分组，未声明的 tag 排在后面。 */
function groupedOperations(): { tag: string; ops: Operation[] }[] {
  const declared = (spec.tags ?? []).map((t) => t.name);
  const byTag = new Map<string, Operation[]>();

  for (const op of OPERATIONS) {
    const list = byTag.get(op.tag) ?? [];
    list.push(op);
    byTag.set(op.tag, list);
  }

  const ordered = [
    ...declared.filter((t) => byTag.has(t)),
    ...[...byTag.keys()].filter((t) => !declared.includes(t)),
  ];

  return ordered.map((tag) => ({ tag, ops: byTag.get(tag)! }));
}

const TAG_LABELS: Record<string, string> = {
  workflows: "工作流定义",
  instances: "实例管理",
  events: "事件",
  webhooks: "Webhook",
  dlq: "死信队列",
  system: "系统",
  templates: "模板",
  analytics: "分析",
  functions: "函数注册",
  other: "其他",
};

function tagLabel(tag: string): string {
  return TAG_LABELS[tag] ?? tag;
}

function navGroups(activeSlug?: string): NavGroup[] {
  return [
    {
      title: "总览",
      items: [
        {
          href: "/api-docs",
          label: "全部端点",
          active: activeSlug === undefined,
        },
      ],
    },
    ...groupedOperations().map(({ tag, ops }) => ({
      title: tagLabel(tag),
      items: ops.map((op) => ({
        href: `/api-docs/${op.slug}`,
        label: op.summary,
        method: op.method,
        active: op.slug === activeSlug,
      })),
    })),
  ];
}

/** 解析 `#/components/examples/X` 引用，取出示例值。 */
function resolveExample(node: unknown): unknown {
  if (!node || typeof node !== "object") return undefined;
  const obj = node as { $ref?: string; value?: unknown };
  if (obj.$ref) {
    const key = obj.$ref.replace("#/components/examples/", "");
    return exampleStore[key]?.value;
  }
  return obj.value;
}

interface MediaType {
  schema?: Record<string, never>;
  example?: unknown;
  examples?: Record<string, unknown>;
}

function firstExample(media: MediaType | undefined): unknown {
  if (!media) return undefined;
  if (media.example !== undefined) return media.example;
  const entries = Object.values(media.examples ?? {});
  for (const entry of entries) {
    const value = resolveExample(entry);
    if (value !== undefined) return value;
  }
  return undefined;
}

function jsonOf(media: MediaType | undefined): MediaType | undefined {
  return media;
}

/** 请求体区：schema 摊成参数列表。 */
function requestBodySection(op: Operation): ParamSection | null {
  const body = op.raw.requestBody as
    | {
        description?: string;
        required?: boolean;
        content?: Record<string, MediaType>;
      }
    | undefined;
  if (!body?.content) return null;

  const media = body.content["application/json"];
  const params = paramsFromOpenApiSchema(media?.schema, components);

  return {
    title: "请求体",
    subtitle: "application/json",
    note: body.description ? escapeHtml(body.description) : undefined,
    params,
  };
}

/**
 * 通用参数的兜底说明，键为 `<in>:<name>`。
 *
 * openApiSpec 里这些参数只声明了类型没写 description，而同名参数在 40+ 个
 * 端点上反复出现；与其在 spec 里抄 40 遍，不如在渲染层兜底一次。端点自己
 * 写了 description 时以端点为准（见下方 `?? `）。
 */
const FALLBACK_PARAM_DESCRIPTIONS: Record<string, string> = {
  "path:id": "目标资源 ID。",
  "path:name": "目标资源名称。",
  "path:deliveryId": "Webhook 投递记录 ID。",
  "query:workflowId": "按工作流 ID 过滤。该字段走二级索引，建议尽量带上。",
  "query:instanceId": "按实例 ID 过滤，走二级索引。",
  "query:status": "按状态过滤，走二级索引。",
  "query:limit": "单页返回条数上限。",
  "query:offset": "分页偏移量，从 0 开始。",
  "query:webhookId": "按 Webhook ID 过滤。",
  "query:event": "按事件名过滤。",
  "query:type": "按类型过滤。",
};

/** 路径 / 查询 / 头参数分区。 */
function parameterSections(op: Operation): ParamSection[] {
  const raw = (op.raw.parameters ?? []) as { name: string; in: string }[];

  const params = paramsFromOpenApiParameters(
    op.raw.parameters as Parameters<typeof paramsFromOpenApiParameters>[0],
  ).map((p, i) => ({
    ...p,
    description:
      p.description ??
      FALLBACK_PARAM_DESCRIPTIONS[`${raw[i]?.in ?? "query"}:${p.name}`],
  }));
  if (params.length === 0) return [];

  const byLocation = new Map<string, ParamDoc[]>();

  params.forEach((p, i) => {
    const location = raw[i]?.in ?? "query";
    const list = byLocation.get(location) ?? [];
    list.push(p);
    byLocation.set(location, list);
  });

  const titles: Record<string, string> = {
    path: "路径参数",
    query: "查询参数",
    header: "请求头参数",
    cookie: "Cookie 参数",
  };

  return [...byLocation.entries()].map(([location, list]) => ({
    title: titles[location] ?? `${location} 参数`,
    subtitle: location,
    params: list,
  }));
}

/** 响应区：取 2xx 响应的 schema 摊成字段列表。 */
function responseSection(op: Operation): ParamSection | null {
  const responses = op.raw.responses as
    | Record<
        string,
        { description?: string; content?: Record<string, MediaType> }
      >
    | undefined;
  if (!responses) return null;

  const successCode = Object.keys(responses).find((c) => c.startsWith("2"));
  if (!successCode) return null;

  const response = responses[successCode];
  const media = jsonOf(response.content?.["application/json"]);
  const params = paramsFromOpenApiSchema(media?.schema, components);

  return {
    title: "响应",
    subtitle: `${successCode} · application/json`,
    note: response.description ? escapeHtml(response.description) : undefined,
    params,
  };
}

/** 生成 cURL 示例。请求体取 spec 里的示例，没有就省略 --data。 */
function curlSample(op: Operation): string {
  const body = op.raw.requestBody as
    | { content?: Record<string, MediaType> }
    | undefined;
  const bodyExample = firstExample(body?.content?.["application/json"]);

  // 路径参数用尖括号占位，提示调用方需要替换。
  const path = op.path.replace(/\{(\w+)\}/g, "<$1>");

  const lines = [
    `curl --request ${op.method} \\`,
    `  --url 'https://{host}${BASE_URL}${path}' \\`,
    `  --header 'Authorization: Bearer <token>'`,
  ];

  if (bodyExample !== undefined) {
    lines[lines.length - 1] += ` \\`;
    lines.push(`  --header 'Content-Type: application/json' \\`);
    lines.push(`  --data '${JSON.stringify(bodyExample, null, 2)}'`);
  }

  return lines.join("\n");
}

function codeGroups(op: Operation): CodeBlockGroup[] {
  const groups: CodeBlockGroup[] = [];

  const requestSamples: CodeSample[] = [
    { label: "cURL", language: "bash", code: curlSample(op) },
  ];

  const body = op.raw.requestBody as
    | { content?: Record<string, MediaType> }
    | undefined;
  const bodyExample = firstExample(body?.content?.["application/json"]);
  if (bodyExample !== undefined) {
    requestSamples.push({
      label: "请求体",
      language: "json",
      code: JSON.stringify(bodyExample, null, 2),
    });
  }

  groups.push({
    title: "请求",
    badge: op.method,
    samples: requestSamples,
  });

  const responses = op.raw.responses as
    | Record<string, { content?: Record<string, MediaType> }>
    | undefined;

  if (responses) {
    const samples: CodeSample[] = [];
    let primaryCode: string | undefined;

    for (const [code, response] of Object.entries(responses)) {
      const value = firstExample(response.content?.["application/json"]);
      if (value === undefined) continue;
      primaryCode ??= code;
      samples.push({
        label: code,
        language: "json",
        code: JSON.stringify(value, null, 2),
      });
    }

    if (samples.length > 0) {
      groups.push({
        title: "响应示例",
        badge: primaryCode,
        badgeTone: primaryCode?.startsWith("2") ? "green" : "red",
        samples,
      });
    }
  }

  return groups;
}

const AUTH_SECTION: ParamSection = {
  title: "鉴权",
  note: "启用 <code>AUTH_ENABLED=true</code> 时所有端点都需要凭证。二选一：<code>Authorization: Bearer &lt;JWT&gt;</code>，或 <code>X-API-Key: &lt;key&gt;</code>。缺失或无效时返回 401。",
  params: [
    {
      name: "Authorization",
      type: "string",
      required: false,
      description:
        "Bearer JWT。签发密钥由 JWT_SECRET 配置，生产环境要求至少 32 字符。",
    },
    {
      name: "X-API-Key",
      type: "string",
      required: false,
      description: "API Key 方式的替代凭证，与 Authorization 二选一即可。",
    },
  ],
};

function pagerFor(slug: string): Pick<DocPage, "prev" | "next"> {
  const i = OPERATIONS.findIndex((o) => o.slug === slug);
  const prev = i > 0 ? OPERATIONS[i - 1] : undefined;
  const next =
    i >= 0 && i < OPERATIONS.length - 1 ? OPERATIONS[i + 1] : undefined;

  return {
    prev: prev
      ? { href: `/api-docs/${prev.slug}`, label: prev.summary }
      : { href: "/api-docs", label: "全部端点" },
    next: next
      ? { href: `/api-docs/${next.slug}`, label: next.summary }
      : undefined,
  };
}

/** 单个端点页。slug 不存在时返回 null，由路由转 404。 */
export function generateApiEndpointHtml(slug: string): string | null {
  const op = OPERATIONS.find((o) => o.slug === slug);
  if (!op) return null;

  const sections: ParamSection[] = [AUTH_SECTION, ...parameterSections(op)];

  const bodySection = requestBodySection(op);
  if (bodySection) sections.push(bodySection);

  const resSection = responseSection(op);
  if (resSection) sections.push(resSection);

  const page: DocPage = {
    eyebrow: tagLabel(op.tag),
    title: op.summary,
    lede: op.description ?? `${op.method} ${BASE_URL}${op.path}`,
    method: op.method,
    path: `${BASE_URL}${op.path}`,
    sections,
    codeGroups: codeGroups(op),
    nav: navGroups(slug),
    ...pagerFor(slug),
  };

  return renderDocPage(page, TOPBAR);
}

/** 端点总览页。 */
export function generateApiIndexHtml(): string {
  const sections: ParamSection[] = [
    AUTH_SECTION,
    ...groupedOperations().map(({ tag, ops }) => ({
      title: tagLabel(tag),
      subtitle: `${ops.length} 个端点`,
      params: ops.map((op) => ({
        name: `${op.method} ${op.path}`,
        type: tag,
        required: false,
        description: op.summary,
      })),
    })),
  ];

  const page: DocPage = {
    eyebrow: "参考",
    title: "REST API",
    lede: `共 ${OPERATIONS.length} 个端点，基础路径 ${BASE_URL}。点击左侧导航查看单个端点的参数、请求体与响应字段。`,
    sections,
    codeGroups: [
      {
        title: "快速验证",
        badge: "bash",
        samples: [
          {
            label: "cURL",
            language: "bash",
            code: `# 列出已注册的工作流
curl 'http://localhost:3345${BASE_URL}/workflows'

# 启动一个实例
curl --request POST \\
  --url 'http://localhost:3345${BASE_URL}/workflows/order-flow/start' \\
  --header 'Content-Type: application/json' \\
  --data '{ "input": { "orderId": "ord_8412" } }'`,
          },
          {
            label: "OpenAPI",
            language: "bash",
            code: `# 机器可读的完整规范
curl 'http://localhost:3345/api-docs/openapi.json'`,
          },
        ],
      },
    ],
    nav: navGroups(undefined),
    next: OPERATIONS[0]
      ? {
          href: `/api-docs/${OPERATIONS[0].slug}`,
          label: OPERATIONS[0].summary,
        }
      : undefined,
  };

  return renderDocPage(page, TOPBAR);
}
