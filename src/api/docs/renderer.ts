/**
 * Dify 式文档页渲染器：左侧导航 / 中间逐参数条目 / 右侧常驻代码面板。
 *
 * 节点页与 REST 端点页共用这里的版式，区别只在喂进来的 DocPage 数据。
 */

import type { ParamDoc } from "./params";

export interface CodeSample {
  /** 语言 tab 上的标签，如 `cURL`、`JSON`。 */
  label: string;
  /** 用于语法高亮 class 的语言标识。 */
  language: string;
  code: string;
}

export interface CodeBlockGroup {
  /** 面板标题，如 `请求示例` / `200`。 */
  title: string;
  /** HTTP 状态码等副标题，可选。 */
  badge?: string;
  badgeTone?: "green" | "red" | "neutral";
  samples: CodeSample[];
}

export interface ParamSection {
  /** 区块标题：`Authorizations` / `请求体` / `配置参数` / `响应`。 */
  title: string;
  /** 区块下方的补充说明（支持已转义的行内 HTML）。 */
  note?: string;
  /** 内容类型等副标题，如 `application/json`。 */
  subtitle?: string;
  params: ParamDoc[];
  /**
   * 锚点 id，用于右栏目录跳转与 scrollspy 高亮。
   * 参数型页面可省略；概念型页面每节都应提供。
   */
  id?: string;
  /**
   * 散文正文（已转义的 HTML 片段）。概念页用它承载段落、表格与 callout；
   * 参数型页面不需要，留空即可。
   */
  body?: string;
}

export interface NavItem {
  href: string;
  label: string;
  /** 方法徽章（端点导航用）。 */
  method?: string;
  active?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface DocPage {
  /** 面包屑上级，如 `节点类型` / `实例管理`。 */
  eyebrow: string;
  title: string;
  /** 标题下方的一句话摘要。 */
  lede: string;
  /** HTTP 方法 + 路径，仅端点页有。 */
  method?: string;
  path?: string;
  /** 节点页显示 `type: "http"` 之类的签名行。 */
  signature?: string;
  sections: ParamSection[];
  codeGroups: CodeBlockGroup[];
  nav: NavGroup[];
  /** 页脚的上一页 / 下一页。 */
  prev?: { href: string; label: string };
  next?: { href: string; label: string };
  /**
   * 页面专属的内联脚本，在公共脚本之前执行。
   * 目前仅概念总览页用它做旧锚点重定向。内容由调用方保证安全。
   */
  inlineScript?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const METHOD_TONE: Record<string, string> = {
  GET: "get",
  POST: "post",
  PUT: "put",
  PATCH: "patch",
  DELETE: "delete",
};

/**
 * 渲染单个参数条目。Dify 的关键信息层级是：
 *   参数名（等宽、醒目） → 类型/必填/默认值徽章 → 说明段落 → 可选值 → 子字段。
 * 子字段用 <details> 折叠，对应 Dify 的 "Show child attributes"。
 */
function renderParam(param: ParamDoc, depth = 0): string {
  const badges: string[] = [
    `<span class="p-type">${escapeHtml(param.type)}</span>`,
  ];

  if (param.required) {
    badges.push(`<span class="p-req">必填</span>`);
  }
  if (param.defaultValue !== undefined) {
    badges.push(
      `<span class="p-default">默认: <code>${escapeHtml(param.defaultValue)}</code></span>`,
    );
  }
  if (param.deprecated) {
    badges.push(`<span class="p-deprecated">已弃用</span>`);
  }

  const description = param.description
    ? `<p class="p-desc">${escapeHtml(param.description)}</p>`
    : `<p class="p-desc p-desc-missing">暂无说明。</p>`;

  const enumRow = param.enumValues?.length
    ? `<p class="p-enum"><span>可选值</span>${param.enumValues
        .map((v) => `<code>${escapeHtml(v)}</code>`)
        .join("")}</p>`
    : "";

  const children = param.children?.length
    ? `<details class="p-children">
        <summary><span class="chev" aria-hidden="true"></span>展开子字段 (${param.children.length})</summary>
        <div class="p-children-body">
          ${param.children.map((c) => renderParam(c, depth + 1)).join("\n")}
        </div>
      </details>`
    : "";

  return `<div class="param" data-depth="${depth}">
    <div class="p-head">
      <code class="p-name">${escapeHtml(param.name)}</code>
      ${badges.join("\n      ")}
    </div>
    ${description}
    ${enumRow}
    ${children}
  </div>`;
}

function renderSection(section: ParamSection): string {
  if (section.params.length === 0 && !section.note && !section.body) return "";

  const subtitle = section.subtitle
    ? `<span class="sec-sub">${escapeHtml(section.subtitle)}</span>`
    : "";
  const note = section.note ? `<p class="sec-note">${section.note}</p>` : "";
  const body = section.body
    ? `<div class="sec-body">${section.body}</div>`
    : "";
  const id = section.id ? ` id="${escapeHtml(section.id)}"` : "";

  return `<section class="param-section"${id}>
    <h2 class="sec-title">${escapeHtml(section.title)}${subtitle}</h2>
    ${note}
    ${body}
    <div class="param-list">
      ${section.params.map((p) => renderParam(p)).join("\n")}
    </div>
  </section>`;
}

/**
 * 代码面板：多 sample 时渲染 tab 切换，单 sample 直接平铺。
 * 复制按钮读的是 <pre> 的 textContent，无需把源码再序列化进 JS。
 */
function renderCodeGroup(group: CodeBlockGroup, groupIndex: number): string {
  const tone = group.badgeTone ?? "neutral";
  const badge = group.badge
    ? `<span class="code-badge tone-${tone}">${escapeHtml(group.badge)}</span>`
    : "";

  const tabs =
    group.samples.length > 1
      ? `<div class="code-tabs" role="tablist">
          ${group.samples
            .map(
              (s, i) =>
                `<button type="button" role="tab" class="code-tab${i === 0 ? " active" : ""}" data-group="${groupIndex}" data-index="${i}" aria-selected="${i === 0}">${escapeHtml(s.label)}</button>`,
            )
            .join("\n          ")}
        </div>`
      : "";

  const panes = group.samples
    .map(
      (s, i) =>
        `<pre class="code-pane${i === 0 ? " active" : ""}" data-group="${groupIndex}" data-index="${i}"><code class="lang-${escapeHtml(s.language)}">${escapeHtml(s.code)}</code></pre>`,
    )
    .join("\n");

  return `<div class="code-group">
    <div class="code-head">
      <span class="code-title">${escapeHtml(group.title)}</span>
      ${badge}
      ${tabs}
      <button type="button" class="code-copy" data-group="${groupIndex}" aria-label="复制代码">复制</button>
    </div>
    ${panes}
  </div>`;
}

function renderNav(nav: NavGroup[]): string {
  return nav
    .map(
      (group) => `<div class="nav-group">
      <div class="nav-title">${escapeHtml(group.title)}</div>
      ${group.items
        .map((item) => {
          const method = item.method
            ? `<span class="nav-method m-${METHOD_TONE[item.method] ?? "neutral"}">${escapeHtml(item.method)}</span>`
            : "";
          return `<a class="nav-item${item.active ? " active" : ""}" href="${escapeHtml(item.href)}">${method}<span class="nav-label">${escapeHtml(item.label)}</span></a>`;
        })
        .join("\n      ")}
    </div>`,
    )
    .join("\n");
}

const STYLES = `
*, *::before, *::after { box-sizing: border-box; }
:root {
  color-scheme: dark;
  --bg: #08090a;
  --bg-panel: #0f1011;
  --bg-code: #0c0d0e;
  --text-primary: #f7f8f8;
  --text-secondary: #c9ced8;
  --text-muted: #8a8f98;
  --text-subtle: #62666d;
  --accent: #7170ff;
  --accent-soft: rgba(113,112,255,0.13);
  --border: rgba(255,255,255,0.08);
  --border-soft: rgba(255,255,255,0.05);
  --overlay: rgba(255,255,255,0.04);
  --overlay-2: rgba(255,255,255,0.07);
  --code-text: #c3c8d4;
  --req: #fc7840;
  --req-bg: rgba(252,120,64,0.11);
  --req-border: rgba(252,120,64,0.28);
  --green: #34d399;
  --green-bg: rgba(16,185,129,0.12);
  --red: #f87171;
  --red-bg: rgba(235,87,87,0.12);
  --header-bg: rgba(8,9,10,0.85);
  --font-sans: "Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #ffffff;
  --bg-panel: #f7f8fa;
  --bg-code: #f4f5f8;
  --text-primary: #17181c;
  --text-secondary: #40444d;
  --text-muted: #6b7080;
  --text-subtle: #8a8f98;
  --accent: #5e6ad2;
  --accent-soft: rgba(94,106,210,0.10);
  --border: rgba(13,16,26,0.11);
  --border-soft: rgba(13,16,26,0.07);
  --overlay: rgba(13,16,26,0.035);
  --overlay-2: rgba(13,16,26,0.06);
  --code-text: #3f434b;
  --req: #b93815;
  --req-bg: rgba(185,56,21,0.08);
  --req-border: rgba(185,56,21,0.24);
  --green: #047857;
  --green-bg: rgba(5,150,105,0.10);
  --red: #b42318;
  --red-bg: rgba(217,45,32,0.09);
  --header-bg: rgba(255,255,255,0.85);
}
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; text-decoration: none; }
code { font-family: var(--font-mono); }

/* ── 顶栏 ───────────────────────────────────────── */
.topbar {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; gap: 16px;
  padding: 0 24px; height: 56px;
  background: var(--header-bg);
  backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--border-soft);
}
.brand { font-size: 14px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.2px; white-space: nowrap; flex-shrink: 0; }
.topbar-links { display: flex; gap: 4px; margin-left: 8px; overflow-x: auto; scrollbar-width: none; }
.topbar-links::-webkit-scrollbar { display: none; }
.topbar-links a { white-space: nowrap; flex-shrink: 0; }
.topbar-links a {
  font-size: 13px; font-weight: 500; color: var(--text-muted);
  padding: 5px 10px; border-radius: 6px; transition: 0.12s;
}
.topbar-links a:hover { background: var(--overlay); color: var(--text-primary); }
.topbar-links a.active { color: var(--text-primary); background: var(--overlay); }
.topbar-spacer { flex: 1; }
.theme-toggle {
  width: 32px; height: 32px; display: grid; place-items: center;
  background: transparent; border: 1px solid var(--border); border-radius: 7px;
  color: var(--text-muted); cursor: pointer; transition: 0.12s;
}
.theme-toggle:hover { color: var(--text-primary); background: var(--overlay); }
.theme-toggle svg { width: 15px; height: 15px; }
:root[data-theme="dark"] .i-sun { display: none; }
:root[data-theme="light"] .i-moon { display: none; }

/* ── 三栏骨架 ───────────────────────────────────── */
.shell { display: grid; grid-template-columns: 252px minmax(0,1fr); max-width: 1600px; margin: 0 auto; }
.sidebar {
  position: sticky; top: 56px; align-self: start;
  height: calc(100vh - 56px); overflow-y: auto;
  padding: 24px 12px 60px; border-right: 1px solid var(--border-soft);
}
.nav-group { margin-bottom: 22px; }
.nav-title {
  font-size: 11px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--text-subtle); padding: 0 10px; margin-bottom: 6px;
}
.nav-item {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 10px; border-radius: 6px; margin-bottom: 1px;
  font-size: 13.5px; color: var(--text-muted); transition: 0.12s;
}
.nav-item:hover { background: var(--overlay); color: var(--text-primary); }
.nav-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 550; }
.nav-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-method {
  font-family: var(--font-mono); font-size: 9.5px; font-weight: 700;
  letter-spacing: 0.03em; padding: 2px 4px; border-radius: 4px;
  min-width: 38px; text-align: center; flex-shrink: 0;
}
.m-get { color: #34d399; background: rgba(16,185,129,0.13); }
.m-post { color: #60a5fa; background: rgba(59,130,246,0.14); }
.m-put { color: #fbbf24; background: rgba(245,158,11,0.14); }
.m-patch { color: #c084fc; background: rgba(168,85,247,0.14); }
.m-delete { color: #f87171; background: rgba(239,68,68,0.14); }
.m-neutral { color: var(--text-muted); background: var(--overlay-2); }

.content { display: grid; grid-template-columns: minmax(0,1fr) 480px; gap: 48px; padding: 40px 40px 120px; align-items: start; }
.main { min-width: 0; }
.rail { position: sticky; top: 88px; display: flex; flex-direction: column; gap: 16px; }

/* ── 页头 ───────────────────────────────────────── */
.eyebrow { font-size: 12.5px; font-weight: 550; color: var(--accent); letter-spacing: -0.05px; margin-bottom: 8px; }
.page-title { font-size: 32px; font-weight: 600; line-height: 1.2; letter-spacing: -0.7px; color: var(--text-primary); margin: 0 0 10px; }
.lede { font-size: 15.5px; color: var(--text-muted); margin: 0 0 20px; max-width: 62ch; }
.endpoint {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 14px; margin-bottom: 36px;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 9px;
}
.endpoint .ep-method {
  font-family: var(--font-mono); font-size: 11px; font-weight: 700;
  padding: 3px 7px; border-radius: 5px;
}
.endpoint .ep-path { font-family: var(--font-mono); font-size: 13.5px; color: var(--text-primary); word-break: break-all; }
.signature {
  display: inline-block; margin-bottom: 36px; padding: 10px 14px;
  background: var(--bg-panel); border: 1px solid var(--border); border-radius: 9px;
  font-family: var(--font-mono); font-size: 13.5px; color: var(--text-primary);
}

/* ── 参数区 ─────────────────────────────────────── */
.param-section { margin-bottom: 44px; }
.sec-title {
  font-size: 19px; font-weight: 600; letter-spacing: -0.3px; color: var(--text-primary);
  margin: 0 0 4px; padding-bottom: 10px; border-bottom: 1px solid var(--border);
  display: flex; align-items: baseline; gap: 10px;
}
.sec-sub { font-size: 12.5px; font-weight: 450; color: var(--text-subtle); font-family: var(--font-mono); }
.sec-note { font-size: 14px; color: var(--text-muted); margin: 12px 0 0; }
/* ── 散文正文（概念页）─────────────────────────── */
.sec-body { margin-top: 14px; }
.sec-body > *:first-child { margin-top: 0; }
.sec-body > *:last-child { margin-bottom: 0; }
.sec-body p { font-size: 14.5px; color: var(--text-secondary); margin: 12px 0; max-width: 72ch; }
.sec-body strong { color: var(--text-primary); font-weight: 600; }
.sec-body a { color: var(--accent); text-decoration: none; }
.sec-body a:hover { text-decoration: underline; text-underline-offset: 3px; }
.sec-body code {
  font-family: var(--font-mono); font-size: 12.5px; color: var(--code-text);
  background: var(--overlay); border: 1px solid var(--border-soft);
  padding: 1px 5px; border-radius: 4px;
}
.sec-body h3 {
  font-size: 15.5px; font-weight: 600; letter-spacing: -0.2px;
  color: var(--text-primary); margin: 28px 0 10px;
}
.sec-body ul { margin: 12px 0; padding-left: 20px; }
.sec-body li { font-size: 14.5px; color: var(--text-secondary); margin: 6px 0; }
.sec-body pre {
  background: var(--bg-code); border: 1px solid var(--border); border-radius: 9px;
  padding: 14px; margin: 14px 0; overflow-x: auto;
  font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6;
  color: var(--code-text);
}
.sec-body pre code { background: none; border: none; padding: 0; font-size: 12.5px; }
.sec-body table {
  width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13.5px;
  border: 1px solid var(--border); border-radius: 9px; overflow: hidden;
}
.sec-body th {
  text-align: left; font-weight: 600; color: var(--text-primary);
  background: var(--bg-panel); padding: 9px 12px;
  border-bottom: 1px solid var(--border); font-size: 12.5px;
}
.sec-body td {
  padding: 9px 12px; color: var(--text-secondary);
  border-bottom: 1px solid var(--border-soft); vertical-align: top;
}
.sec-body tr:last-child td { border-bottom: none; }
.callout {
  margin: 14px 0; padding: 12px 14px;
  background: var(--accent-soft); border: 1px solid var(--border);
  border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0;
  font-size: 14px; color: var(--text-secondary);
}
.callout p { margin: 0; font-size: 14px; }
.callout p + p { margin-top: 8px; }

.param-list { margin-top: 4px; }
.param { padding: 18px 0; border-bottom: 1px solid var(--border-soft); }
.param:last-child { border-bottom: none; }
.p-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 5px; }
.p-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.p-type { font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); }
.p-req {
  font-size: 11px; font-weight: 600; color: var(--req);
  background: var(--req-bg); border: 1px solid var(--req-border);
  padding: 1px 6px; border-radius: 4px;
}
.p-default { font-size: 11.5px; color: var(--text-subtle); }
.p-default code { font-size: 11.5px; background: var(--overlay); padding: 1px 4px; border-radius: 3px; }
.p-deprecated {
  font-size: 11px; font-weight: 600; color: var(--red);
  background: var(--red-bg); padding: 1px 6px; border-radius: 4px;
}
.p-desc { font-size: 14px; color: var(--text-secondary); margin: 0; max-width: 68ch; }
.p-desc-missing { color: var(--text-subtle); font-style: italic; }
.p-enum { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 8px 0 0; font-size: 12.5px; }
.p-enum > span { color: var(--text-subtle); }
.p-enum code {
  font-size: 12px; color: var(--code-text); background: var(--overlay);
  border: 1px solid var(--border-soft); padding: 1px 6px; border-radius: 4px;
}
.p-children { margin-top: 12px; }
.p-children > summary {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer; list-style: none;
  font-size: 12.5px; font-weight: 550; color: var(--accent);
  padding: 4px 9px; border: 1px solid var(--border); border-radius: 6px;
  transition: 0.12s;
}
.p-children > summary::-webkit-details-marker { display: none; }
.p-children > summary:hover { background: var(--overlay); }
.chev {
  width: 0; height: 0; border-left: 4px solid currentColor;
  border-top: 3.5px solid transparent; border-bottom: 3.5px solid transparent;
  transition: transform 0.15s;
}
.p-children[open] > summary .chev { transform: rotate(90deg); }
.p-children-body {
  margin-top: 8px; padding-left: 16px;
  border-left: 2px solid var(--border);
}
.p-children-body .param { padding: 14px 0; }

/* ── 右栏代码面板 ───────────────────────────────── */
.code-group {
  background: var(--bg-code); border: 1px solid var(--border);
  border-radius: 10px; overflow: hidden;
}
.code-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px 8px 14px;
  background: var(--bg-panel); border-bottom: 1px solid var(--border);
}
.code-title { font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
.code-badge { font-family: var(--font-mono); font-size: 11px; font-weight: 650; padding: 2px 6px; border-radius: 4px; }
.tone-green { color: var(--green); background: var(--green-bg); }
.tone-red { color: var(--red); background: var(--red-bg); }
.tone-neutral { color: var(--text-muted); background: var(--overlay-2); }
.code-tabs { display: flex; gap: 2px; margin-left: 4px; overflow-x: auto; }
.code-tab {
  font-family: var(--font-sans); font-size: 11.5px; font-weight: 550;
  color: var(--text-subtle); background: transparent; border: none;
  padding: 3px 8px; border-radius: 5px; cursor: pointer; white-space: nowrap; transition: 0.12s;
}
.code-tab:hover { color: var(--text-primary); background: var(--overlay); }
.code-tab.active { color: var(--text-primary); background: var(--overlay-2); }
.code-copy {
  margin-left: auto; font-family: var(--font-sans); font-size: 11.5px; font-weight: 550;
  color: var(--text-subtle); background: transparent;
  border: 1px solid var(--border); border-radius: 5px;
  padding: 3px 9px; cursor: pointer; transition: 0.12s; flex-shrink: 0;
}
.code-copy:hover { color: var(--text-primary); background: var(--overlay); }
.code-pane {
  display: none; margin: 0; padding: 14px;
  max-height: 420px; overflow: auto;
  font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6;
  color: var(--code-text); white-space: pre; tab-size: 2;
}
.code-pane.active { display: block; }

/* ── 页脚 ───────────────────────────────────────── */
.pager { display: flex; justify-content: space-between; gap: 16px; margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--border); }
.pager a { display: flex; flex-direction: column; gap: 2px; padding: 12px 16px; border: 1px solid var(--border); border-radius: 9px; transition: 0.12s; max-width: 48%; }
.pager a:hover { border-color: var(--accent); background: var(--overlay); }
.pager .dir { font-size: 11.5px; color: var(--text-subtle); }
.pager .lbl { font-size: 14px; font-weight: 550; color: var(--text-primary); }
.pager .to-next { margin-left: auto; text-align: right; }

/* ── 响应式 ─────────────────────────────────────── */
@media (max-width: 1280px) {
  .content { grid-template-columns: minmax(0,1fr); gap: 32px; }
  .rail { position: static; }
}
@media (max-width: 900px) {
  /* 窄屏优先保证导航可用：品牌名让位给四个入口链接。 */
  .topbar { padding: 0 12px; gap: 8px; }
  .brand { display: none; }
  .shell { grid-template-columns: minmax(0,1fr); }
  .sidebar {
    position: static; height: auto; max-height: 260px;
    border-right: none; border-bottom: 1px solid var(--border-soft);
  }
  .content { padding: 28px 16px 80px; }
  .page-title { font-size: 26px; }
}
`;

const SCRIPT = `
(function(){
  // 代码面板 tab 切换：按 data-group 定位同组的 pane。
  document.addEventListener("click", function(e){
    var tab = e.target.closest(".code-tab");
    if (tab) {
      var g = tab.dataset.group, i = tab.dataset.index;
      document.querySelectorAll('.code-tab[data-group="'+g+'"]').forEach(function(t){
        var on = t.dataset.index === i;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", String(on));
      });
      document.querySelectorAll('.code-pane[data-group="'+g+'"]').forEach(function(p){
        p.classList.toggle("active", p.dataset.index === i);
      });
      return;
    }

    var copy = e.target.closest(".code-copy");
    if (copy) {
      var pane = document.querySelector('.code-pane[data-group="'+copy.dataset.group+'"].active');
      if (!pane) return;
      navigator.clipboard.writeText(pane.textContent).then(function(){
        var prev = copy.textContent;
        copy.textContent = "已复制";
        setTimeout(function(){ copy.textContent = prev; }, 1400);
      }).catch(function(){
        copy.textContent = "复制失败";
        setTimeout(function(){ copy.textContent = "复制"; }, 1400);
      });
    }
  });

  var toggle = document.getElementById("themeToggle");
  if (toggle) {
    toggle.addEventListener("click", function(){
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("tswe-theme", next); } catch (err) {}
    });
  }

  // 让侧栏滚动到当前高亮项，长列表下不至于停在顶部。
  var active = document.querySelector(".nav-item.active");
  if (active && active.scrollIntoView) {
    active.scrollIntoView({ block: "center" });
  }
})();
`;

export interface TopbarLink {
  href: string;
  label: string;
  active?: boolean;
}

/** 组装完整 HTML 文档。 */
export function renderDocPage(page: DocPage, topbar: TopbarLink[]): string {
  const endpointBlock = page.method
    ? `<div class="endpoint">
        <span class="ep-method m-${METHOD_TONE[page.method] ?? "neutral"}">${escapeHtml(page.method)}</span>
        <span class="ep-path">${escapeHtml(page.path ?? "")}</span>
      </div>`
    : page.signature
      ? `<div class="signature">${escapeHtml(page.signature)}</div>`
      : "";

  const pager =
    page.prev || page.next
      ? `<nav class="pager">
          ${
            page.prev
              ? `<a href="${escapeHtml(page.prev.href)}"><span class="dir">← 上一页</span><span class="lbl">${escapeHtml(page.prev.label)}</span></a>`
              : ""
          }
          ${
            page.next
              ? `<a class="to-next" href="${escapeHtml(page.next.href)}"><span class="dir">下一页 →</span><span class="lbl">${escapeHtml(page.next.label)}</span></a>`
              : ""
          }
        </nav>`
      : "";

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(page.title)} - ts-workflow-engine-lite</title>
<script>
(function(){var t;try{t=localStorage.getItem("tswe-theme")}catch(e){}if(t!=="light"&&t!=="dark"){t=window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.setAttribute("data-theme",t)})();
</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" />
<style>${STYLES}</style>
${page.inlineScript ? `<script>${page.inlineScript}</script>` : ""}
</head>
<body>
<div class="topbar">
  <a class="brand" href="/">ts-workflow-engine-lite</a>
  <div class="topbar-links">
    ${topbar
      .map(
        (l) =>
          `<a href="${escapeHtml(l.href)}"${l.active ? ' class="active"' : ""}>${escapeHtml(l.label)}</a>`,
      )
      .join("\n    ")}
  </div>
  <div class="topbar-spacer"></div>
  <button type="button" id="themeToggle" class="theme-toggle" aria-label="切换亮暗主题" title="切换亮暗主题">
    <svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
    <svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
  </button>
</div>

<div class="shell">
  <aside class="sidebar">
    ${renderNav(page.nav)}
  </aside>

  <div class="content">
    <main class="main">
      <div class="eyebrow">${escapeHtml(page.eyebrow)}</div>
      <h1 class="page-title">${escapeHtml(page.title)}</h1>
      <p class="lede">${escapeHtml(page.lede)}</p>
      ${endpointBlock}
      ${page.sections.map(renderSection).join("\n")}
      ${pager}
    </main>

    <aside class="rail">
      ${page.codeGroups.map((g, i) => renderCodeGroup(g, i)).join("\n")}
    </aside>
  </div>
</div>

<script>${SCRIPT}</script>
</body>
</html>`;
}
