/**
 * 节点参考页：/docs/nodes 与 /docs/nodes/:type。
 *
 * 结构信息来自 WorkflowSchema（Zod → JSON Schema），语义来自
 * nodeParamDocs.ts，版式来自 renderer.ts。
 */

import {
  getNodeConfigJsonSchema,
  TaskNodeSchema,
} from "../../model/WorkflowSchema";
import { z } from "zod";
import { NODE_DOCS } from "../nodeDocs";
import {
  COMMON_FIELD_DESCRIPTIONS,
  NODE_CONFIG_DESCRIPTIONS,
  NODE_EXAMPLES,
  NODE_NAV_GROUPS,
  NODE_OUTPUT_DESCRIPTIONS,
  NO_CONFIG_NOTES,
} from "./nodeParamDocs";
import { paramsFromJsonSchema, type ParamDoc } from "./params";
import {
  escapeHtml,
  renderDocPage,
  type CodeBlockGroup,
  type DocPage,
  type NavGroup,
  type ParamSection,
  type TopbarLink,
} from "./renderer";

const TOPBAR: TopbarLink[] = [
  { href: "/docs/nodes", label: "节点参考" },
  { href: "/api-docs", label: "REST API" },
  { href: "/docs/concepts", label: "核心概念" },
  { href: "/playground", label: "Playground" },
];

function topbarFor(active: string): TopbarLink[] {
  return TOPBAR.map((l) => ({ ...l, active: l.href === active }));
}

/** 顶层 TaskNode 字段（去掉 config —— 它在"配置参数"区单独展开）。 */
function commonParams(): ParamDoc[] {
  const schema = z.toJSONSchema(TaskNodeSchema, {
    target: "draft-2020-12",
  }) as Parameters<typeof paramsFromJsonSchema>[0];

  return paramsFromJsonSchema(schema, COMMON_FIELD_DESCRIPTIONS).filter(
    (p) => p.name !== "config",
  );
}

/** 只保留与该节点类型相关的顶层字段，避免每页都列 20 个无关字段。 */
const TYPE_RELEVANT_COMMON: Record<string, string[]> = {
  action: [
    "id",
    "type",
    "next",
    "failureNext",
    "maxRetries",
    "retryPolicy",
    "heartbeat",
  ],
  wait: ["id", "type", "next", "timeout"],
  event: ["id", "type", "onEvent", "next", "timeout"],
  rollback: ["id", "type", "rollbackTo", "next", "maxRetries"],
  subworkflow: [
    "id",
    "type",
    "subworkflowId",
    "subworkflowInput",
    "waitForCompletion",
    "next",
  ],
};

const BASE_COMMON = ["id", "type", "next", "failureNext", "maxRetries"];

function commonParamsFor(type: string): ParamDoc[] {
  const allowed = new Set(TYPE_RELEVANT_COMMON[type] ?? BASE_COMMON);
  return commonParams().filter((p) => allowed.has(p.name));
}

/** 把输出说明表转成 ParamDoc[]。键为 "" 表示整个 output 是一个值而非对象。 */
function outputParams(type: string): {
  params: ParamDoc[];
  note?: string;
} {
  const map = NODE_OUTPUT_DESCRIPTIONS[type];
  if (!map) return { params: [] };

  if (map[""] !== undefined) {
    return { params: [], note: escapeHtml(map[""]) };
  }

  return {
    params: Object.entries(map).map(([name, description]) => ({
      name,
      // 输出形状不在 Zod schema 里（引擎运行时写入），类型由示例推断。
      type: inferOutputType(type, name),
      required: false,
      description,
    })),
  };
}

/** 从输出示例 JSON 里反推字段类型，省去再维护一张类型表。 */
function inferOutputType(type: string, field: string): string {
  try {
    const sample = NODE_EXAMPLES[type]?.output;
    if (!sample) return "any";
    const parsed = JSON.parse(sample) as Record<string, unknown>;
    const value = parsed[field];
    if (value === undefined || value === null) return "any";
    if (Array.isArray(value)) {
      return value.length > 0 ? `${typeof value[0]}[]` : "any[]";
    }
    return typeof value;
  } catch {
    return "any";
  }
}

function navGroups(activeType?: string): NavGroup[] {
  const byType = new Map(NODE_DOCS.map((n) => [n.type, n]));
  return [
    {
      title: "总览",
      items: [
        {
          href: "/docs/nodes",
          label: "全部节点类型",
          active: activeType === undefined,
        },
      ],
    },
    ...NODE_NAV_GROUPS.map((group) => ({
      title: group.title,
      items: group.types
        .filter((t) => byType.has(t))
        .map((t) => ({
          href: `/docs/nodes/${t}`,
          label: byType.get(t)!.label,
          active: t === activeType,
        })),
    })),
  ];
}

/** 侧栏顺序 = 分组顺序，用于上一页/下一页。 */
const ORDERED_TYPES = NODE_NAV_GROUPS.flatMap((g) => g.types);

function pagerFor(type: string): Pick<DocPage, "prev" | "next"> {
  const byType = new Map(NODE_DOCS.map((n) => [n.type, n]));
  const i = ORDERED_TYPES.indexOf(type);
  const prevType = i > 0 ? ORDERED_TYPES[i - 1] : undefined;
  const nextType =
    i >= 0 && i < ORDERED_TYPES.length - 1 ? ORDERED_TYPES[i + 1] : undefined;

  return {
    prev: prevType
      ? { href: `/docs/nodes/${prevType}`, label: byType.get(prevType)!.label }
      : { href: "/docs/nodes", label: "全部节点类型" },
    next: nextType
      ? { href: `/docs/nodes/${nextType}`, label: byType.get(nextType)!.label }
      : undefined,
  };
}

/** 单个节点类型的参考页。类型不存在时返回 null，由路由转 404。 */
export function generateNodeDocHtml(type: string): string | null {
  const doc = NODE_DOCS.find((n) => n.type === type);
  if (!doc) return null;

  const configSchema = getNodeConfigJsonSchema(type);
  const configParams = paramsFromJsonSchema(
    configSchema as Parameters<typeof paramsFromJsonSchema>[0],
    NODE_CONFIG_DESCRIPTIONS[type] ?? {},
  );

  const sections: ParamSection[] = [
    {
      title: "通用字段",
      subtitle: "TaskNode",
      params: commonParamsFor(type),
    },
  ];

  if (configParams.length > 0) {
    sections.push({
      title: "配置参数",
      subtitle: `config · ${type[0].toUpperCase()}${type.slice(1)}NodeConfig`,
      params: configParams,
    });
  } else {
    sections.push({
      title: "配置参数",
      note: NO_CONFIG_NOTES[type] ?? "该节点类型没有声明式 config 字段。",
      params: [],
    });
  }

  const output = outputParams(type);
  sections.push({
    title: "输出",
    subtitle: "output",
    note:
      output.note ??
      `执行成功后写入 <code>output</code>，后续节点可用 <code>\${${escapeHtml(type)}NodeId.output.xxx}</code> 引用。`,
    params: output.params,
  });

  sections.push({
    title: "使用建议",
    note: `${escapeHtml(doc.useCase)} ${escapeHtml(doc.notes)}`,
    params: [],
  });

  const example = NODE_EXAMPLES[type];
  const codeGroups: CodeBlockGroup[] = [];
  if (example) {
    codeGroups.push({
      title: "节点定义",
      badge: "JSON",
      samples: [{ label: "定义", language: "json", code: example.definition }],
    });
    codeGroups.push({
      title: "输出示例",
      badge: "output",
      badgeTone: "green",
      samples: [{ label: "输出", language: "json", code: example.output }],
    });
  }

  const page: DocPage = {
    eyebrow: "节点类型",
    title: doc.label,
    lede: doc.intro,
    signature: `type: "${type}"`,
    sections,
    codeGroups,
    nav: navGroups(type),
    ...pagerFor(type),
  };

  return renderDocPage(page, topbarFor("/docs/nodes"));
}

/** 节点总览页：15 种类型一览 + 通用字段。 */
export function generateNodeIndexHtml(): string {
  const overviewParams: ParamDoc[] = NODE_DOCS.map((n) => ({
    name: n.type,
    type: n.label.replace(/^\S+\s/, ""),
    required: false,
    description: `${n.shortDescription}。${n.useCase}`,
  }));

  const sections: ParamSection[] = [
    {
      title: "节点类型",
      subtitle: `共 ${NODE_DOCS.length} 种`,
      note: "点击左侧导航进入单个节点的完整参数参考。",
      params: overviewParams,
    },
    {
      title: "通用字段",
      subtitle: "所有节点共享 · TaskNode",
      params: commonParams(),
    },
  ];

  const page: DocPage = {
    eyebrow: "参考",
    title: "节点类型参考",
    lede: "15 种节点类型的完整字段参考。类型、必填与枚举值均由引擎的 Zod schema 直接生成，与运行时校验同源。",
    sections,
    codeGroups: [
      {
        title: "最小工作流",
        badge: "JSON",
        samples: [
          {
            label: "定义",
            language: "json",
            code: `{
  "id": "order-flow",
  "name": "订单流程",
  "startNode": "validate",
  "nodes": {
    "validate": {
      "id": "validate",
      "type": "action",
      "action": "validateOrder",
      "next": ["charge"]
    },
    "charge": {
      "id": "charge",
      "type": "http",
      "config": {
        "method": "POST",
        "url": "https://pay.example.com/charge"
      }
    }
  }
}`,
          },
        ],
      },
    ],
    nav: navGroups(undefined),
    next: {
      href: `/docs/nodes/${ORDERED_TYPES[0]}`,
      label: NODE_DOCS.find((n) => n.type === ORDERED_TYPES[0])!.label,
    },
  };

  return renderDocPage(page, topbarFor("/docs/nodes"));
}
