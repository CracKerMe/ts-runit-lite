import fs from "node:fs";
import path from "node:path";

const distRoot = path.resolve("dist");
const files: string[] = [];

function walk(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (fullPath.endsWith(".js") || fullPath.endsWith(".d.ts")) files.push(fullPath);
  }
}

function resolveSpecifier(filePath: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  if (/\.(?:js|json|node|css|wasm)$/.test(specifier)) return specifier;
  const absolute = path.resolve(path.dirname(filePath), specifier);
  if (fs.existsSync(`${absolute}.js`)) return `${specifier}.js`;
  if (fs.existsSync(path.join(absolute, "index.js"))) return `${specifier.replace(/\/$/, "")}/index.js`;
  throw new Error(`Cannot resolve ESM import ${specifier} from ${filePath}`);
}

walk(distRoot);
const importPattern = /((?:from\s+|import\s*\(\s*)["'])(\.\.?\/[^"']+)(["'])/g;

for (const filePath of files) {
  const source = fs.readFileSync(filePath, "utf8");
  const updated = source.replace(importPattern, (_match, prefix, specifier, suffix) =>
    `${prefix}${resolveSpecifier(filePath, specifier)}${suffix}`,
  );
  if (updated !== source) fs.writeFileSync(filePath, updated);
}
