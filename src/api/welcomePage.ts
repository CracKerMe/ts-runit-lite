/**
 * 首页使用说明：介绍核心节点类型、常用 API 端点和快速上手示例。
 */

import { NODE_DOCS } from "./nodeDocs";

interface NodeTypeInfo {
  type: string;
  label: string;
  desc: string;
}

const NODE_TYPES: NodeTypeInfo[] = NODE_DOCS.map(
  ({ type, label, shortDescription: desc }) => ({ type, label, desc }),
);

interface EndpointInfo {
  method: string;
  path: string;
  desc: string;
}

const ENDPOINTS: EndpointInfo[] = [
  { method: "GET", path: "/workflow-api/v1/health", desc: "健康检查" },
  {
    method: "GET",
    path: "/workflow-api/v1/workflows",
    desc: "查询工作流定义列表",
  },
  {
    method: "POST",
    path: "/workflow-api/v1/workflows",
    desc: "注册新的工作流定义",
  },
  {
    method: "POST",
    path: "/workflow-api/v1/instances",
    desc: "启动一个工作流实例",
  },
  {
    method: "GET",
    path: "/workflow-api/v1/instances/:id",
    desc: "查询实例状态",
  },
  {
    method: "POST",
    path: "/workflow-api/v1/instances/:id/signal",
    desc: "向运行中实例发送 Signal",
  },
  { method: "GET", path: "/workflow-api/v1/events", desc: "触发/查询事件" },
  { method: "GET", path: "/workflow-api/v1/templates", desc: "查询节点模板" },
  {
    method: "GET",
    path: "/workflow-api/v1/analytics",
    desc: "查询运行分析指标",
  },
  { method: "GET", path: "/workflow-api/v1/dlq", desc: "查询死信队列" },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function generateWelcomeHtml(port: number): string {
  const nodeCards = NODE_TYPES.map(
    (n) =>
      `<a class="node-card" href="/docs/nodes/${encodeURIComponent(n.type)}" aria-label="查看 ${escapeHtml(n.label)} 节点文档"><div class="node-head"><code>${escapeHtml(n.type)}</code><span class="node-label">${escapeHtml(n.label)}</span><span class="node-link">查看详情 →</span></div><p>${escapeHtml(n.desc)}</p></a>`,
  ).join("\n");

  const endpointRows = ENDPOINTS.map(
    (e) =>
      `<tr><td><span class="method method-${e.method.toLowerCase()}">${e.method}</span></td><td><code>${escapeHtml(e.path)}</code></td><td>${escapeHtml(e.desc)}</td></tr>`,
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ts-workflow-engine-lite</title>
<script>
(function(){var t;try{t=localStorage.getItem("tswe-theme")}catch(e){}if(t!=="light"&&t!=="dark"){t=window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.setAttribute("data-theme",t)})();
</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" />
<style>
  :root {
    color-scheme: dark;
    --bg: #08090a;
    --bg-panel: #0f1011;
    --bg-surface: #191a1b;
    --text-primary: #f7f8f8;
    --text-secondary: #d0d6e0;
    --text-muted: #8a8f98;
    --text-subtle: #62666d;
    --brand: #5e6ad2;
    --accent: #7170ff;
    --accent-hover: #828fff;
    --border-subtle: rgba(255,255,255,0.05);
    --border-standard: rgba(255,255,255,0.08);
    --border-strong: #23252a;
    --border-hover: #34343a;
    --hairline: #34343a;
    --overlay-1: rgba(255,255,255,0.02);
    --overlay-2: rgba(255,255,255,0.05);
    --overlay-3: rgba(255,255,255,0.06);
    --overlay-4: rgba(255,255,255,0.03);
    --grid-line: rgba(255,255,255,0.035);
    --glow: rgba(94,106,210,0.26);
    --wf-glow: rgba(94,106,210,0.07);
    --wf-edge: rgba(255,255,255,0.10);
    --wf-fill-idle: rgba(255,255,255,0.03);
    --wf-node-fill: rgba(94,106,210,0.16);
    --wf-node-stroke: #7170ff;
    --wf-node-glow: rgba(113,112,255,0.4);
    --wf-green-fill: rgba(16,185,129,0.12);
    --wf-green-stroke: #10b981;
    --wf-green-glow: rgba(16,185,129,0.35);
    --flow-line: rgba(113,112,255,0.55);
    --flow-dash: rgba(113,112,255,0.8);
    --flow-soft: rgba(113,112,255,0.4);
    --tag-active: #a5aaff;
    --code-text: #c3c8d4;
    --btn-text: #e2e4e7;
    --selection-bg: rgba(94,106,210,0.45);
    --shadow-line: rgba(0,0,0,0.2);
    --terminal-shadow: rgba(0,0,0,0.5);
    --header-bg: rgba(15,16,17,0.82);
    --focus-ring: rgba(94,106,210,0.22);
    --chip-bg: rgba(94,106,210,0.14);
    --chip-border: rgba(94,106,210,0.28);
    --chip-text: #a5aaff;
    --brand-chip-bg: rgba(94,106,210,0.12);
    --callout-bg: rgba(94,106,210,0.08);
    --accent-glow: rgba(113,112,255,0.7);
    --green: #10b981;
    --green-text: #34d399;
    --green-bg: rgba(16,185,129,0.1);
    --green-border: rgba(16,185,129,0.2);
    --green-glow: rgba(16,185,129,0.9);
    --red: #eb5757;
    --red-bg: rgba(235,87,87,0.1);
    --red-border: rgba(235,87,87,0.22);
    --amber: #fc7840;
    --amber-bg: rgba(252,120,64,0.1);
    --amber-border: rgba(252,120,64,0.22);
    --running-text: #828fff;
    --font-sans: "Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif;
    --font-mono: "Berkeley Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  :root[data-theme="light"] {
    color-scheme: light;
    --bg: #ffffff;
    --bg-panel: #f7f8fa;
    --bg-surface: #eef0f4;
    --text-primary: #17181c;
    --text-secondary: #3d414a;
    --text-muted: #6b7080;
    --text-subtle: #8a8f98;
    --brand: #5e6ad2;
    --accent: #5e6ad2;
    --accent-hover: #4f58c7;
    --border-subtle: rgba(13,16,26,0.07);
    --border-standard: rgba(13,16,26,0.11);
    --border-strong: #e0e2e8;
    --border-hover: #c9ccd5;
    --hairline: #d6d8df;
    --overlay-1: rgba(13,16,26,0.024);
    --overlay-2: rgba(13,16,26,0.055);
    --overlay-3: rgba(13,16,26,0.055);
    --overlay-4: rgba(13,16,26,0.02);
    --grid-line: rgba(15,18,30,0.05);
    --glow: rgba(94,106,210,0.14);
    --wf-glow: rgba(94,106,210,0.06);
    --wf-edge: rgba(19,22,32,0.14);
    --wf-fill-idle: rgba(13,16,26,0.02);
    --wf-node-fill: rgba(94,106,210,0.10);
    --wf-node-stroke: #5e6ad2;
    --wf-node-glow: rgba(94,106,210,0.32);
    --wf-green-fill: rgba(5,150,105,0.10);
    --wf-green-stroke: #059669;
    --wf-green-glow: rgba(5,150,105,0.3);
    --flow-line: rgba(94,106,210,0.55);
    --flow-dash: rgba(94,106,210,0.75);
    --flow-soft: rgba(94,106,210,0.35);
    --tag-active: #4c55c8;
    --code-text: #44484f;
    --btn-text: #3d4149;
    --selection-bg: rgba(94,106,210,0.22);
    --shadow-line: rgba(19,22,32,0.06);
    --terminal-shadow: rgba(23,25,35,0.16);
    --header-bg: rgba(255,255,255,0.82);
    --focus-ring: rgba(94,106,210,0.18);
    --chip-bg: rgba(94,106,210,0.10);
    --chip-border: rgba(94,106,210,0.30);
    --chip-text: #4c55c8;
    --brand-chip-bg: rgba(94,106,210,0.09);
    --callout-bg: rgba(94,106,210,0.06);
    --accent-glow: rgba(94,106,210,0.45);
    --green: #059669;
    --green-text: #047857;
    --green-bg: rgba(5,150,105,0.09);
    --green-border: rgba(5,150,105,0.25);
    --green-glow: rgba(5,150,105,0.5);
    --red: #d92d20;
    --red-bg: rgba(217,45,32,0.08);
    --red-border: rgba(217,45,32,0.25);
    --amber: #b93815;
    --amber-bg: rgba(185,56,21,0.08);
    --amber-border: rgba(185,56,21,0.25);
    --running-text: #4c55c8;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    font-family: var(--font-sans);
    font-feature-settings: "cv01", "ss03";
    background: var(--bg);
    color: var(--text-secondary);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  ::selection { background: var(--selection-bg); color: var(--text-primary); }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 6px; }

  /* ── Hero：网格线 + 靛紫光晕 + 大标题 ─────────────── */
  header {
    position: relative;
    overflow: hidden;
    padding: 112px 24px 84px;
    text-align: center;
    background: var(--bg);
    border-bottom: 1px solid var(--border-subtle);
  }
  header::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(var(--grid-line) 1px, transparent 1px),
      linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
    background-size: 56px 56px;
    -webkit-mask-image: radial-gradient(ellipse 95% 85% at 50% 0%, black 25%, transparent 72%);
    mask-image: radial-gradient(ellipse 95% 85% at 50% 0%, black 25%, transparent 72%);
  }
  header::after {
    content: "";
    position: absolute;
    top: -260px;
    left: 50%;
    transform: translateX(-50%);
    width: 980px;
    height: 520px;
    background: radial-gradient(ellipse at center, var(--glow), transparent 65%);
    pointer-events: none;
  }
  header > * { position: relative; z-index: 1; }
  .overline {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 28px;
    font-size: 12px;
    font-weight: 510;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .overline::before, .overline::after {
    content: "";
    width: 24px;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--hairline));
  }
  .overline::after { background: linear-gradient(90deg, var(--hairline), transparent); }
  header h1 {
    margin: 0 0 20px;
    font-size: 60px;
    font-weight: 510;
    line-height: 1.03;
    letter-spacing: -1.32px;
    color: var(--text-primary);
    text-wrap: balance;
  }
  header .sub {
    margin: 0 auto;
    max-width: 560px;
    font-size: 18px;
    font-weight: 400;
    line-height: 1.6;
    letter-spacing: -0.165px;
    color: var(--text-muted);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-top: 28px;
    padding: 6px 14px 6px 11px;
    border-radius: 9999px;
    background: var(--overlay-1);
    color: var(--text-secondary);
    font-size: 12.5px;
    font-weight: 510;
    letter-spacing: -0.02px;
    border: 1px solid var(--border-strong);
  }
  .badge::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 8px var(--green-glow);
  }
  .hero-cta { display: flex; justify-content: center; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
  .hero-cta a {
    display: inline-flex;
    align-items: center;
    padding: 10px 20px;
    background: var(--overlay-1);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    color: var(--btn-text);
    text-decoration: none;
    font-size: 14.5px;
    font-weight: 510;
    letter-spacing: -0.14px;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .hero-cta a:hover { background: var(--overlay-2); border-color: var(--border-hover); color: var(--text-primary); }
  .hero-cta a.primary { background: var(--brand); border-color: var(--brand); color: #fff; }
  .hero-cta a.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  .hero-links { margin-top: 22px; font-size: 13px; font-weight: 510; letter-spacing: -0.13px; color: var(--text-subtle); }
  .hero-links a { color: var(--text-muted); text-decoration: none; margin: 0 8px; }
  .hero-links a:hover { color: var(--text-primary); }

  /* ── 动效层：入场 / 光晕呼吸 / 终端光标（reduced-motion 时全部静止）── */
  @media (prefers-reduced-motion: no-preference) {
    header > * { opacity: 0; animation: heroRise 0.9s cubic-bezier(0.16,1,0.3,1) forwards; }
    header > :nth-child(1) { animation-delay: 0.05s; }
    header > :nth-child(2) { animation-delay: 0.14s; }
    header > :nth-child(3) { animation-delay: 0.23s; }
    header > :nth-child(4) { animation-delay: 0.32s; }
    header > :nth-child(5) { animation-delay: 0.42s; }
    header > :nth-child(6) { animation-delay: 0.52s; }
    header > :nth-child(7) { animation-delay: 0.66s; }
    header::after { animation: glowPulse 9s ease-in-out infinite alternate; }
    .terminal pre code::after {
      content: "▊";
      margin-left: 2px;
      color: var(--accent);
      animation: caretBlink 1.1s steps(2, start) infinite;
    }
    .wf-node rect { animation: wfNodeGlow 6s linear infinite; }
    .wf-node .wf-label { animation: wfTextGlow 6s linear infinite; }
    .wf-node .wf-tag { animation: wfTagGlow 6s linear infinite; }
    .wf-n2 rect, .wf-n2 .wf-label, .wf-n2 .wf-tag { animation-delay: 0.9s; }
    .wf-n3 rect, .wf-n3 .wf-label, .wf-n3 .wf-tag { animation-delay: 1.8s; }
    .wf-nb1 rect, .wf-nb1 .wf-label, .wf-nb1 .wf-tag,
    .wf-nb2 rect, .wf-nb2 .wf-label, .wf-nb2 .wf-tag { animation-delay: 2.7s; }
    .wf-n4 rect, .wf-n4 .wf-label, .wf-n4 .wf-tag { animation-delay: 3.6s; }
    .wf-n4 rect { animation-name: wfNodeGlowGreen; }
    .wf-n4 .wf-tag { animation-name: wfTagGlowGreen; }
    .wf-flow { animation: wfDash 1.4s linear infinite; }
  }
  @keyframes heroRise {
    from { opacity: 0; transform: translateY(22px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes glowPulse { from { opacity: 0.6; } to { opacity: 1; } }
  @keyframes caretBlink { 50% { opacity: 0; } }
  @keyframes wfNodeGlow {
    0% { fill: var(--wf-fill-idle); stroke: var(--wf-edge); filter: none; }
    1.5%, 11% { fill: var(--wf-node-fill); stroke: var(--wf-node-stroke); filter: drop-shadow(0 0 12px var(--wf-node-glow)); }
    15%, 100% { fill: var(--wf-fill-idle); stroke: var(--wf-edge); filter: none; }
  }
  @keyframes wfNodeGlowGreen {
    0% { fill: var(--wf-fill-idle); stroke: var(--wf-edge); filter: none; }
    1.5%, 12% { fill: var(--wf-green-fill); stroke: var(--wf-green-stroke); filter: drop-shadow(0 0 12px var(--wf-green-glow)); }
    16%, 100% { fill: var(--wf-fill-idle); stroke: var(--wf-edge); filter: none; }
  }
  @keyframes wfTextGlow { 0% { fill: var(--text-muted); } 1.5%, 11% { fill: var(--text-primary); } 15%, 100% { fill: var(--text-muted); } }
  @keyframes wfTagGlow { 0% { fill: var(--text-subtle); } 1.5%, 11% { fill: var(--tag-active); } 15%, 100% { fill: var(--text-subtle); } }
  @keyframes wfTagGlowGreen { 0% { fill: var(--text-subtle); } 1.5%, 12% { fill: var(--green-text); } 16%, 100% { fill: var(--text-subtle); } }
  @keyframes wfDash { to { stroke-dashoffset: -13; } }

  /* ── 终端窗口（双主题下保持暗色，作为视觉锚点）──── */
  .terminal {
    --bg-panel: #101114;
    --border-standard: rgba(255,255,255,0.09);
    --border-subtle: rgba(255,255,255,0.06);
    --overlay-1: rgba(255,255,255,0.03);
    --text-secondary: #d0d6e0;
    --text-subtle: #6f7480;
    color-scheme: dark;
    max-width: 760px;
    margin: 56px auto 0;
    text-align: left;
    background: var(--bg-panel);
    border: 1px solid var(--border-standard);
    border-radius: 12px;
    box-shadow: 0 24px 64px var(--terminal-shadow), var(--shadow-line) 0 0 0 1px;
    overflow: hidden;
  }
  .terminal-bar {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--overlay-1);
  }
  .terminal-bar i { width: 11px; height: 11px; border-radius: 50%; }
  .terminal-bar i:nth-child(1) { background: #eb5757; opacity: 0.85; }
  .terminal-bar i:nth-child(2) { background: #f5c451; opacity: 0.75; }
  .terminal-bar i:nth-child(3) { background: #10b981; opacity: 0.85; }
  .terminal-bar span {
    margin-left: 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-subtle);
  }
  .terminal pre { border: none; box-shadow: none; background: transparent; margin: 0; padding: 20px 22px; }

  /* ── 数据统计带 ───────────────────────────────── */
  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    max-width: 1120px;
    margin: 0 auto;
    background: var(--overlay-1);
    border: 1px solid var(--border-standard);
    border-radius: 12px;
    overflow: hidden;
  }
  .stat { padding: 30px 28px; border-left: 1px solid var(--border-subtle); }
  .stat:first-child { border-left: none; }
  .stat b {
    display: block;
    font-size: 32px;
    font-weight: 590;
    line-height: 1.1;
    letter-spacing: -0.38px;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .stat span {
    display: block;
    margin-top: 6px;
    font-size: 13px;
    font-weight: 510;
    letter-spacing: -0.02px;
    color: var(--text-muted);
  }
  @media (max-width: 860px) {
    .stats { grid-template-columns: repeat(2, 1fr); }
    .stat:nth-child(3) { border-left: none; }
    .stat:nth-child(n+3) { border-top: 1px solid var(--border-subtle); }
  }

  /* ── 主体 ────────────────────────────────────── */
  main {
    max-width: 1120px;
    margin: 0 auto;
    padding: 40px 24px 112px;
  }
  section { margin-bottom: 104px; }
  .eyebrow {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 0 0 14px;
    font-size: 11.5px;
    font-weight: 510;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-subtle);
  }
  .eyebrow::before {
    content: "";
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent-glow);
  }
  h2 {
    margin: 0 0 28px;
    font-size: 30px;
    font-weight: 510;
    line-height: 1.2;
    letter-spacing: -0.36px;
    color: var(--text-primary);
  }
  h2 .more {
    font-size: 13.5px;
    font-weight: 510;
    letter-spacing: -0.13px;
    color: var(--accent);
    text-decoration: none;
    margin-left: 14px;
  }
  h2 .more:hover { color: var(--accent-hover); }
  .section-head { margin-bottom: 32px; }
  .section-head p { margin: 8px 0 0; font-size: 15px; letter-spacing: -0.11px; color: var(--text-muted); max-width: 640px; }

  pre {
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-line) 0 0 0 1px;
    border-radius: 8px;
    padding: 16px 18px;
    overflow-x: auto;
    font-size: 13px;
    line-height: 1.55;
  }
  pre code { background: none; padding: 0; border: none; color: var(--text-secondary); }

  table { width: 100%; border-collapse: collapse; font-size: 14px; letter-spacing: -0.11px; }
  th, td { text-align: left; padding: 13px 14px; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
  th {
    color: var(--text-muted);
    font-weight: 510;
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  tbody tr { transition: background 0.1s; }
  tbody tr:hover { background: var(--overlay-1); }
  code {
    background: var(--overlay-3);
    padding: 2px 7px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--code-text);
  }
  .method {
    display: inline-block;
    min-width: 56px;
    text-align: center;
    padding: 3px 8px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 510;
    border: 1px solid transparent;
  }
  .method-get { background: var(--green-bg); color: var(--green-text); border-color: var(--green-border); }
  .method-post { background: var(--chip-bg); color: var(--running-text); border-color: var(--chip-border); }

  /* ── 节点类型：卡片网格 ─────────────────────────── */
  .nodes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  @media (max-width: 900px) { .nodes { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 600px) { .nodes { grid-template-columns: 1fr; } }
  .node-card {
    display: block;
    color: inherit;
    text-decoration: none;
    background: var(--overlay-1);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 16px 18px;
    transition: background 0.15s, border-color 0.15s;
  }
  .node-card:hover { background: var(--overlay-2); border-color: var(--border-hover); }
  .node-head { display: flex; align-items: center; gap: 10px; margin-bottom: 7px; }
  .node-link { margin-left: auto; font-size: 11px; color: var(--accent); opacity: 0; transition: opacity 0.15s; }
  .node-card:hover .node-link, .node-card:focus-visible .node-link { opacity: 1; }
  .node-head code { background: var(--brand-chip-bg); color: var(--tag-active); padding: 2px 8px; font-size: 12px; }
  .node-label { font-size: 13.5px; font-weight: 590; letter-spacing: -0.13px; color: var(--text-primary); }
  .node-card p { margin: 0; font-size: 12.5px; line-height: 1.55; letter-spacing: -0.02px; color: var(--text-muted); }

  /* ── 概念卡片：三列 ───────────────────────────── */
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
  .grid .card:last-child { grid-column: 1 / -1; }
  .card {
    display: block;
    background: var(--overlay-1);
    border: 1px solid var(--border-standard);
    border-radius: 12px;
    padding: 24px 26px;
    text-decoration: none;
    transition: background 0.15s, border-color 0.15s;
  }
  .card:hover { background: var(--overlay-2); border-color: var(--border-hover); }
  .card h3 {
    margin: 0 0 9px;
    font-size: 16px;
    font-weight: 590;
    letter-spacing: -0.2px;
    color: var(--text-primary);
  }
  .card p { margin: 0; font-size: 13.5px; line-height: 1.6; letter-spacing: -0.02px; color: var(--text-muted); }
  .card code { font-size: 12px; }

  /* ── 执行示意：动画流水线 ─────────────────────── */
  .wf-stage {
    background:
      radial-gradient(ellipse 62% 85% at 50% 0%, var(--wf-glow), transparent 72%),
      var(--overlay-1);
    border: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-line) 0 0 0 1px;
    border-radius: 14px;
    padding: 26px 22px 16px;
  }
  .wf-stage svg { display: block; width: 100%; height: auto; }
  .wf-node rect { fill: var(--wf-fill-idle); stroke: var(--wf-edge); stroke-width: 1; }
  .wf-node .wf-label { font-size: 14px; font-weight: 590; letter-spacing: -0.14px; fill: var(--text-muted); }
  .wf-node .wf-tag {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.16em;
    fill: var(--text-subtle);
  }
  .wf-edge { fill: none; stroke: var(--wf-edge); stroke-width: 1.5; }
  .wf-flow {
    fill: none;
    stroke: var(--flow-line);
    stroke-width: 1.5;
    stroke-dasharray: 3 10;
    stroke-linecap: round;
  }
  .wf-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 26px;
    justify-content: center;
    margin-top: 14px;
    padding: 14px 0 6px;
    border-top: 1px solid var(--border-subtle);
  }
  .wf-legend span {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 510;
    letter-spacing: -0.02px;
    color: var(--text-muted);
  }
  .wf-legend i.dot {
    width: 9px;
    height: 9px;
    border-radius: 3px;
    background: var(--chip-bg);
    border: 1px solid var(--accent);
  }
  .wf-legend i.dash {
    width: 24px;
    height: 2px;
    border-radius: 2px;
    background: repeating-linear-gradient(90deg, var(--flow-dash) 0 3px, transparent 3px 9px);
  }
  .wf-legend i.par {
    width: 15px;
    height: 12px;
    border: 1px solid var(--wf-edge);
    border-radius: 3px;
    background: linear-gradient(180deg, var(--flow-soft) 0 38%, transparent 38% 62%, var(--flow-soft) 62%);
  }
  .wf-legend .cycle { color: var(--text-subtle); font-family: var(--font-mono); font-size: 11px; }

  /* ── 主题切换 ─────────────────────────────────── */
  button.theme-toggle {
    position: fixed;
    top: 18px;
    right: 20px;
    z-index: 60;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    padding: 0;
    background: var(--overlay-1);
    border: 1px solid var(--border-standard);
    border-radius: 9px;
    color: var(--text-muted);
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  button.theme-toggle:hover { background: var(--overlay-2); border-color: var(--border-hover); color: var(--text-primary); }
  .theme-toggle svg { width: 17px; height: 17px; display: block; }
  :root[data-theme="dark"] .theme-toggle .i-moon { display: none; }
  :root[data-theme="light"] .theme-toggle .i-sun { display: none; }

  /* ── 代码复制按钮 ─────────────────────────────── */
  .code-wrap { position: relative; }
  .code-copy {
    position: absolute;
    top: 10px;
    right: 10px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 510;
    letter-spacing: -0.02px;
    color: var(--text-muted);
    background: var(--overlay-2);
    border: 1px solid var(--border-standard);
    border-radius: 5px;
    cursor: pointer;
    opacity: 0;
    transition: color 0.15s, border-color 0.15s, opacity 0.15s;
  }
  .code-wrap:hover .code-copy, .code-copy:focus-visible { opacity: 1; }
  .code-copy:hover { color: var(--text-primary); border-color: var(--hairline); }
  .code-copy.copied { color: var(--green-text); border-color: var(--green-border); opacity: 1; }

  /* ── 节点类型筛选 ─────────────────────────────── */
  .filter-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
  .filter-tabs button {
    padding: 6px 14px;
    font-family: var(--font-sans);
    font-size: 12.5px;
    font-weight: 510;
    letter-spacing: -0.06px;
    color: var(--text-muted);
    background: var(--overlay-1);
    border: 1px solid var(--border-standard);
    border-radius: 9999px;
    cursor: pointer;
    transition: color 0.15s, background 0.15s, border-color 0.15s;
  }
  .filter-tabs button:hover { color: var(--text-primary); border-color: var(--hairline); }
  .filter-tabs button.active {
    color: #fff;
    background: var(--brand);
    border-color: var(--brand);
  }
  :root[data-theme="light"] .filter-tabs button.active { color: #fff; }
  .node-card.hidden { display: none; }

  /* ── FAQ ─────────────────────────────────────── */
  .faq { display: grid; gap: 10px; }
  .faq details {
    background: var(--overlay-1);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    transition: border-color 0.15s;
  }
  .faq details:hover { border-color: var(--hairline); }
  .faq details[open] { border-color: var(--border-standard); background: var(--overlay-4); }
  .faq summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 15px 18px;
    font-size: 14px;
    font-weight: 590;
    letter-spacing: -0.14px;
    color: var(--text-primary);
    cursor: pointer;
    list-style: none;
  }
  .faq summary::-webkit-details-marker { display: none; }
  .faq summary::after {
    content: "+";
    font-size: 16px;
    font-weight: 400;
    color: var(--text-subtle);
    flex: 0 0 auto;
  }
  .faq details[open] summary::after { content: "−"; color: var(--accent); }
  .faq .faq-a {
    margin: 0;
    padding: 0 18px 15px;
    font-size: 13.5px;
    line-height: 1.7;
    color: var(--text-secondary);
  }
  .faq .faq-a code {
    background: var(--overlay-3);
    padding: 1px 6px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--code-text);
  }
  .wf-note {
    margin: 14px 2px 0;
    font-size: 13px;
    line-height: 1.65;
    color: var(--text-muted);
  }
  .wf-note code {
    background: var(--overlay-3);
    padding: 1px 6px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--code-text);
  }
  .wf-note a { color: var(--accent); text-decoration: none; }
  .wf-note a:hover { color: var(--accent-hover); }

  footer {
    text-align: center;
    padding: 32px 24px;
    border-top: 1px solid var(--border-subtle);
    color: var(--text-subtle);
    font-size: 12px;
    font-weight: 510;
    letter-spacing: -0.02px;
  }
</style>
</head>
<body>
<header>
  <p class="overline">Workflow Engine</p>
  <h1>ts-workflow-engine-lite</h1>
  <p class="sub">轻量级 TypeScript 工作流引擎，为单进程应用而生 —— 无需 Redis 与数据库，本地文件持久化，开箱即用。</p>
  <span class="badge">API 服务运行中 &middot; 端口 ${port}</span>
  <div class="hero-cta">
    <a class="primary" href="/playground">Playground &middot; 在线运行示例</a>
    <a href="/api-docs">Swagger API 文档</a>
  </div>
  <div class="hero-links">
    <a href="/docs/concepts">核心概念文档</a>&middot;<a href="/api-docs/openapi.json">OpenAPI JSON</a>&middot;<a href="/workflow-api/v1/health">健康检查</a>&middot;<a href="https://github.com/CracKerMe/ts-runit-lite" target="_blank" rel="noopener">GitHub 仓库</a>&middot;<a href="https://crackerme.github.io/ts-runit-lite/" target="_blank" rel="noopener">项目介绍页（在线）</a>&middot;<a href="/index.html" target="_blank" rel="noopener">项目介绍页（本地）</a>
  </div>

  <div class="terminal">
    <div class="terminal-bar"><i></i><i></i><i></i><span>quickstart</span></div>
    <pre><code># 查询工作流列表
curl http://localhost:${port}/workflow-api/v1/workflows

# 启动一个工作流实例
curl -X POST http://localhost:${port}/workflow-api/v1/instances \\
  -H "Content-Type: application/json" \\
  -d '{"workflowId": "your-workflow-id", "input": {}}'
</code></pre>
  </div>
</header>
<main>

  <section>
    <div class="stats">
      <div class="stat"><b>15</b><span>内置节点类型</span></div>
      <div class="stat"><b>20+</b><span>表达式内置函数</span></div>
      <div class="stat"><b>${ENDPOINTS.length}</b><span>REST API 端点</span></div>
      <div class="stat"><b>0</b><span>Redis / 数据库依赖</span></div>
    </div>
  </section>

  <section>
    <div class="section-head">
      <p class="eyebrow">Execution</p>
      <h2>一次执行的完整旅程</h2>
      <p>以「订单履约」为例：条件校验、会员路由、并行权益计算与 join 汇聚，全部由引擎在单进程内调度完成。</p>
    </div>
    <div class="wf-stage">
      <svg viewBox="0 0 1040 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="工作流执行示意图：从收到订单到履约完成的节点流转">
        <g class="wf-edges">
          <path class="wf-edge" d="M162,122 H222"/>
          <path class="wf-flow" d="M162,122 H222"/>
          <path class="wf-edge" d="M378,122 H438"/>
          <path class="wf-flow" d="M378,122 H438"/>
          <path class="wf-edge" d="M594,114 C624,114 624,70 654,70"/>
          <path class="wf-flow" d="M594,114 C624,114 624,70 654,70"/>
          <path class="wf-edge" d="M594,130 C624,130 624,174 654,174"/>
          <path class="wf-flow" d="M594,130 C624,130 624,174 654,174"/>
          <path class="wf-edge" d="M802,70 C832,70 832,114 862,114"/>
          <path class="wf-flow" d="M802,70 C832,70 832,114 862,114"/>
          <path class="wf-edge" d="M802,174 C832,174 832,130 862,130"/>
          <path class="wf-flow" d="M802,174 C832,174 832,130 862,130"/>
        </g>
        <g class="wf-node wf-n1">
          <rect x="14" y="96" width="148" height="52" rx="10"/>
          <text class="wf-label" x="88" y="120" text-anchor="middle">收到订单</text>
          <text class="wf-tag" x="88" y="137" text-anchor="middle">START</text>
        </g>
        <g class="wf-node wf-n2">
          <rect x="222" y="96" width="156" height="52" rx="10"/>
          <text class="wf-label" x="300" y="120" text-anchor="middle">校验金额</text>
          <text class="wf-tag" x="300" y="137" text-anchor="middle">CONDITION</text>
        </g>
        <g class="wf-node wf-n3">
          <rect x="438" y="96" width="156" height="52" rx="10"/>
          <text class="wf-label" x="516" y="120" text-anchor="middle">会员路由</text>
          <text class="wf-tag" x="516" y="137" text-anchor="middle">ROUTER</text>
        </g>
        <g class="wf-node wf-nb1">
          <rect x="654" y="48" width="148" height="44" rx="9"/>
          <text class="wf-label" x="728" y="68" text-anchor="middle">金牌权益</text>
          <text class="wf-tag" x="728" y="84" text-anchor="middle">GOLD</text>
        </g>
        <g class="wf-node wf-nb2">
          <rect x="654" y="152" width="148" height="44" rx="9"/>
          <text class="wf-label" x="728" y="172" text-anchor="middle">标准权益</text>
          <text class="wf-tag" x="728" y="188" text-anchor="middle">STD</text>
        </g>
        <g class="wf-node wf-n4">
          <rect x="862" y="96" width="164" height="52" rx="10"/>
          <text class="wf-label" x="944" y="120" text-anchor="middle">履约完成</text>
          <text class="wf-tag" x="944" y="137" text-anchor="middle">JOIN</text>
        </g>
      </svg>
      <div class="wf-legend">
        <span><i class="dot"></i>节点激活</span>
        <span><i class="dash"></i>数据流向</span>
        <span><i class="par"></i>并行分支</span>
        <span class="cycle">LOOP 6s</span>
      </div>
    </div>
  </section>

  <section>
    <div class="section-head">
      <p class="eyebrow">Example</p>
      <h2>一份可以直接跑的定义</h2>
      <p>真实的工作流定义就是一份 JSON：condition 按表达式分流，transform 用表达式重塑输出。复制到 Playground 即可运行。</p>
    </div>
    <div class="terminal">
      <div class="terminal-bar"><i></i><i></i><i></i><span>workflow-definition.json</span></div>
      <div class="code-wrap">
        <button type="button" class="code-copy" data-copy-target="wf-example">复制 JSON</button>
<pre id="wf-example"><code>{
  "id": "price-quote",
  "name": "条件路由与转换示例",
  "version": "1.0.0",
  "startNode": "check-amount",
  "nodes": {
    "check-amount": {
      "id": "check-amount",
      "type": "condition",
      "config": {
        "condition": "context.amount > 1000",
        "trueBranch": "premium-quote",
        "falseBranch": "standard-quote"
      }
    },
    "premium-quote": {
      "id": "premium-quote",
      "type": "transform",
      "config": {
        "output": {
          "tier": "'premium'",
          "price": "round(context.amount * 0.85, 2)",
          "message": "'VIP 折扣已应用'"
        }
      },
      "next": []
    },
    "standard-quote": {
      "id": "standard-quote",
      "type": "transform",
      "config": {
        "output": {
          "tier": "'standard'",
          "price": "round(context.amount * 0.95, 2)",
          "message": "'标准折扣已应用'"
        }
      },
      "next": []
    }
  }
}</code></pre>
      </div>
    </div>
    <p class="wf-note">启动输入 <code>{"amount": 1500}</code> 时，实例将走 premium 分支并输出 <code>{"tier": "premium", "price": 1275}</code>。<a href="/playground">去 Playground 改改参数试试 &rarr;</a></p>
  </section>

  <section>
    <div class="section-head">
      <p class="eyebrow">Node Types</p>
      <h2>15 种节点类型</h2>
      <p>从条件分支到并行汇聚，覆盖工作流编排的核心原语，全部在单进程内完成调度与持久化。</p>
    </div>
    <div class="filter-tabs" role="tablist" aria-label="节点类型筛选">
      <button type="button" class="active" data-cat="all">全部 ${NODE_TYPES.length}</button>
      <button type="button" data-cat="basic">基础动作</button>
      <button type="button" data-cat="control">控制流</button>
      <button type="button" data-cat="io">集成 IO</button>
      <button type="button" data-cat="gov">流程治理</button>
    </div>
    <div class="nodes">
${nodeCards}
    </div>
  </section>

  <section>
    <div class="section-head">
      <p class="eyebrow">REST API</p>
      <h2>常用 API 端点</h2>
      <p>所有能力均通过 REST API 暴露，可被任意语言与平台消费。</p>
    </div>
    <table>
      <thead><tr><th>方法</th><th>路径</th><th>说明</th></tr></thead>
      <tbody>
${endpointRows}
      </tbody>
    </table>
  </section>

  <section>
    <div class="section-head">
      <p class="eyebrow">Concepts</p>
      <h2>核心概念 <a class="more" href="/docs/concepts">查看完整文档 &rarr;</a></h2>
    </div>
    <div class="grid">
      <a class="card" href="/docs/concepts/node-output">
        <h3>节点输出引用</h3>
        <p>使用 <code>\${nodeId.output.path}</code> 引用前置节点的输出，支持表达式计算，如 <code>\${node1.output.price * 0.8}</code>。</p>
      </a>
      <a class="card" href="/docs/concepts/expressions">
        <h3>表达式引擎</h3>
        <p>支持数学/比较/逻辑运算与 20+ 内置函数，如 <code>\${max(a, b)}</code>、<code>\${round(price * 1.1, 2)}</code>。含运算符优先级与函数目录。</p>
      </a>
      <a class="card" href="/docs/concepts/concurrency#cas">
        <h3>并发控制（CAS）</h3>
        <p>实例携带 version 字段，更新时检测版本冲突并自动重试，避免 Lost Update。</p>
      </a>
      <a class="card" href="/docs/concepts/storage">
        <h3>本地文件持久化</h3>
        <p>默认使用 LocalFileStorage，数据保存在 <code>.ts-workflow-engine-data/</code>，支持重启恢复，可选 <code>FSYNC_ON_WRITE</code> 换取更强的持久性。</p>
      </a>
      <a class="card" href="/docs/concepts/fanout-join">
        <h3>并行扇出与结果汇聚</h3>
        <p>next 扇出并行分支、join 汇聚（all/any）、transform 整形，组合成一条无需 action 闭包的纯 JSON 数据流水线。</p>
      </a>
      <a class="card" href="/docs/concepts/worker-pool">
        <h3>Worker 线程池</h3>
        <p>HTTP 节点可卸载到 worker 线程执行，支持按实例粘性路由回已绑定的 worker。</p>
      </a>
      <a class="card" href="/docs/concepts/embedding">
        <h3>外部集成增强</h3>
        <p><code>createWorkflowRouter()</code> 挂载到宿主 Express 应用，具名错误类支持 <code>instanceof</code> 判断。</p>
      </a>
    </div>
  </section>

  <section>
    <div class="section-head">
      <p class="eyebrow">FAQ</p>
      <h2>常见问题</h2>
      <p>关于持久化、集成与运行时干预的高频疑问，点击展开。</p>
    </div>
    <div class="faq">
      <details>
        <summary>数据存在哪里？进程重启会丢吗？</summary>
        <p class="faq-a">默认使用 LocalFileStorage，实例状态落盘到 <code>.ts-workflow-engine-data/</code> 目录。重启后自动从磁盘恢复进行中的实例继续调度；对更高持久性要求可开启 <code>FSYNC_ON_WRITE</code>。</p>
      </details>
      <details>
        <summary>如何挂载到我现有的 Express 应用？</summary>
        <p class="faq-a">调用 <code>createWorkflowRouter()</code> 得到标准 Express Router，<code>app.use("/workflow-api/v1", router)</code> 即可。引擎也可完全脱离 Express 以 headless 模式运行，具名错误类（如 WorkflowNotFoundError）支持 <code>instanceof</code> 精确捕获。</p>
      </details>
      <details>
        <summary>实例卡在某个节点了，如何干预？</summary>
        <p class="faq-a">通过 Instance Control API 对失败节点执行 retry / skip / compensate；等待型节点（wait / event / approval）可用 <code>POST /instances/:id/signal</code> 注入信号唤醒，事件类节点也可由 <code>/events</code> 触发。</p>
      </details>
      <details>
        <summary>并发更新同一实例会互相覆盖吗？</summary>
        <p class="faq-a">不会。实例携带 version 字段，写入采用 CAS（比较并交换）检测版本冲突并自动重试，避免 Lost Update；详见文档「并发控制（CAS）」章节。</p>
      </details>
      <details>
        <summary>HTTP 节点发起慢请求会阻塞进程吗？</summary>
        <p class="faq-a">可配置 Worker 线程池，把 HTTP 节点卸载到 worker 执行，并支持按实例粘性路由回已绑定的 worker，主线程不被慢 IO 拖住；配合 Lease/Heartbeat 机制处理 worker 异常场景。</p>
      </details>
      <details>
        <summary>反复失败的节点最终会去哪？</summary>
        <p class="faq-a">超过重试策略后进入死信队列（<code>GET /workflow-api/v1/dlq</code> 可查询），不会无限循环占用调度资源，也便于事后排查与补偿。</p>
      </details>
    </div>
  </section>
</main>
<footer>ts-workflow-engine-lite v3.0.2</footer>
<button type="button" id="themeToggle" class="theme-toggle" aria-label="切换亮暗主题" title="切换亮暗主题">
  <svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
  <svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
</button>
<script>
(function(){var b=document.getElementById("themeToggle");if(!b)return;b.addEventListener("click",function(){var d=document.documentElement,t=d.getAttribute("data-theme")==="light"?"dark":"light";d.setAttribute("data-theme",t);try{localStorage.setItem("tswe-theme",t)}catch(e){}})})();
</script>
<script>
(function(){
  /* 节点分类：为每张卡片打 data-cat，并绑定筛选 tabs */
  var CATS={action:"basic",wait:"basic",transform:"basic",condition:"control",router:"control",loop:"control",join:"control",http:"io",sql:"io",queue:"io",event:"io",notification:"io",approval:"gov",rollback:"gov",subworkflow:"gov"};
  var cards=document.querySelectorAll(".nodes .node-card");
  Array.prototype.forEach.call(cards,function(c){
    var code=c.querySelector(".node-head code");
    if(!code)return;
    c.setAttribute("data-cat",CATS[code.textContent.trim()]||"basic");
  });
  var tabs=document.querySelectorAll(".filter-tabs button");
  Array.prototype.forEach.call(tabs,function(t){
    t.addEventListener("click",function(){
      Array.prototype.forEach.call(tabs,function(x){x.classList.remove("active")});
      t.classList.add("active");
      var cat=t.getAttribute("data-cat");
      Array.prototype.forEach.call(cards,function(c){
        c.classList.toggle("hidden",cat!=="all"&&c.getAttribute("data-cat")!==cat);
      });
    });
  });

  /* 代码复制：点击复制目标 pre 的文本 */
  function bindCopy(btn){
    btn.addEventListener("click",function(){
      var id=btn.getAttribute("data-copy-target");
      var pre=id?document.getElementById(id):btn.closest(".code-wrap").querySelector("pre");
      if(!pre)return;
      var text=pre.textContent;
      function done(){
        btn.classList.add("copied");
        var old=btn.textContent;
        btn.textContent="已复制 ✓";
        setTimeout(function(){btn.classList.remove("copied");btn.textContent=old;},1600);
      }
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(done,function(){fallback()});
      }else{fallback()}
      function fallback(){
        var ta=document.createElement("textarea");
        ta.value=text;ta.style.position="fixed";ta.style.opacity="0";
        document.body.appendChild(ta);ta.select();
        try{document.execCommand("copy");done()}catch(e){}
        document.body.removeChild(ta);
      }
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll(".code-copy"),bindCopy);
})();
</script>
</body>
</html>`;
}
