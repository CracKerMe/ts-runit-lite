// oxlint-disable no-array-sort -- toSorted() requires ES2023; this project targets ES2022
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const examplesRoot = path.resolve("examples");

function listExamples(): string[] {
  return fs
    .readdirSync(examplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name.replace(/\.ts$/, ""))
    .sort();
}

function usage(available: string[]): void {
  console.error(
    "Usage: pnpm example <name> [-- <args passed to the example>]\n",
  );
  console.error("Available examples:");
  for (const name of available) console.error(`  ${name}`);
}

const [requested, ...forwarded] = process.argv.slice(2);
const available = listExamples();

if (!requested) {
  usage(available);
  process.exit(1);
}

if (!available.includes(requested)) {
  console.error(`Unknown example: ${requested}\n`);
  usage(available);
  process.exit(1);
}

const target = path.join(examplesRoot, `${requested}.ts`);
const result = spawnSync("tsx", [target, ...forwarded], { stdio: "inherit" });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
