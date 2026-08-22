import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Logger } from "../utils/Logger";
import type { WorkflowTemplate } from "./TemplateGallery";

/**
 * Extract workflow templates from practices-demo directory
 */
export function extractTemplatesFromDemos(demoDir: string): WorkflowTemplate[] {
  const templates: WorkflowTemplate[] = [];

  try {
    const files = readdirSync(demoDir).filter((f) => f.endsWith(".ts"));

    for (const file of files) {
      try {
        const filePath = join(demoDir, file);
        const content = readFileSync(filePath, "utf-8");
        const template = extractTemplateFromFile(file, content);

        if (template) {
          templates.push(template);
        }
      } catch (err: unknown) {
        Logger.warn(
          "system",
          "template-extract",
          `Failed to extract from ${file}`,
          {
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }

    Logger.info("system", "template-extract", "Templates extracted", {
      totalFiles: files.length,
      extracted: templates.length,
    });
  } catch (err: unknown) {
    Logger.error(
      "system",
      "template-extract",
      "Failed to read demo directory",
      err instanceof Error ? err.message : String(err),
    );
  }

  return templates;
}

/**
 * Extract a template from a single demo file
 */
function extractTemplateFromFile(
  fileName: string,
  content: string,
): WorkflowTemplate | null {
  // Try to find workflow definition in the file
  const workflowMatch = content.match(
    /(?:const|let|var)\s+\w+\s*[:=]\s*({[\s\S]*?id:\s*["'][^"']+["'][\s\S]*?})/,
  );

  if (!workflowMatch) {
    return null;
  }

  // Extract metadata from comments
  const nameMatch = content.match(/@name\s+(.+)/);
  const descMatch = content.match(/@description\s+(.+)/);
  const categoryMatch = content.match(/@category\s+(.+)/);
  const tagsMatch = content.match(/@tags\s+(.+)/);
  const difficultyMatch = content.match(/@difficulty\s+(.+)/);

  // Generate ID from filename
  const id = basename(fileName, ".ts")
    .replace(/-demo$/, "")
    .replace(/[^a-z0-9-]/gi, "-")
    .toLowerCase();

  // Extract tags
  const tags = tagsMatch
    ? tagsMatch[1].split(",").map((t) => t.trim())
    : [id.split("-")[0]];

  // Determine category
  const category = categoryMatch
    ? categoryMatch[1].trim()
    : guessCategory(content);

  // Determine difficulty
  const difficulty = difficultyMatch
    ? (difficultyMatch[1].trim() as "beginner" | "intermediate" | "advanced")
    : guessDifficulty(content);

  return {
    id,
    name: nameMatch?.[1]?.trim() || formatName(id),
    description:
      descMatch?.[1]?.trim() || `Workflow template extracted from ${fileName}`,
    category,
    tags,
    difficulty,
    definition: {
      id,
      name: nameMatch?.[1]?.trim() || formatName(id),
      nodes: {},
      startNode: "",
    },
    parameters: [],
    examples: [],
    author: "ts-runit",
    version: "1.0.0",
    downloads: 0,
    rating: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Guess category from content
 */
function guessCategory(content: string): string {
  const contentLower = content.toLowerCase();

  if (contentLower.includes("approval")) return "approval";
  if (contentLower.includes("notification")) return "notification";
  if (contentLower.includes("http")) return "integration";
  if (contentLower.includes("llm") || contentLower.includes("ai")) return "ai";
  if (contentLower.includes("loop")) return "automation";
  if (contentLower.includes("condition")) return "routing";

  return "general";
}

/**
 * Guess difficulty from content
 */
function guessDifficulty(
  content: string,
): "beginner" | "intermediate" | "advanced" {
  const contentLower = content.toLowerCase();

  // Count complexity indicators
  let complexity = 0;

  if (contentLower.includes("subworkflow")) complexity += 2;
  if (contentLower.includes("parallel")) complexity += 1;
  if (contentLower.includes("loop")) complexity += 1;
  if (contentLower.includes("condition")) complexity += 1;
  if (contentLower.includes("approval")) complexity += 1;
  if (contentLower.includes("saga")) complexity += 2;
  if (contentLower.includes("fanout")) complexity += 2;

  if (complexity >= 4) return "advanced";
  if (complexity >= 2) return "intermediate";
  return "beginner";
}

/**
 * Format an ID into a readable name
 */
function formatName(id: string): string {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
