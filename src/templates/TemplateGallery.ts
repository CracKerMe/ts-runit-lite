// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import type { WorkflowDefinition } from "../model/Workflow";
import { Logger } from "../utils/Logger";

/**
 * Template parameter definition
 */
export interface TemplateParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object";
  description: string;
  required: boolean;
  defaultValue?: any;
}

/**
 * Template usage example
 */
export interface TemplateExample {
  name: string;
  description: string;
  input: Record<string, any>;
}

/**
 * Workflow template with metadata
 */
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  definition: WorkflowDefinition;
  parameters: TemplateParameter[];
  examples: TemplateExample[];
  author: string;
  version: string;
  downloads: number;
  rating: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Template search result with relevance score
 */
export interface TemplateSearchResult {
  template: WorkflowTemplate;
  score: number;
  matchedFields: string[];
}

/**
 * Template gallery manages workflow templates with search, categorization,
 * and parameterized instantiation.
 */
export class TemplateGallery {
  private templates: Map<string, WorkflowTemplate> = new Map();

  /**
   * Register a new template
   */
  register(template: WorkflowTemplate): void {
    this.templates.set(template.id, {
      ...template,
      createdAt: template.createdAt || Date.now(),
      updatedAt: Date.now(),
      downloads: template.downloads || 0,
      rating: template.rating || 0,
    });

    Logger.info("system", "template-gallery", "Template registered", {
      id: template.id,
      name: template.name,
      category: template.category,
    });
  }

  /**
   * Unregister a template
   */
  unregister(id: string): boolean {
    const deleted = this.templates.delete(id);
    if (deleted) {
      Logger.info("system", "template-gallery", "Template unregistered", {
        id,
      });
    }
    return deleted;
  }

  /**
   * Get a template by ID
   */
  getById(id: string): WorkflowTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * List all templates
   */
  listAll(): WorkflowTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * List templates by category
   */
  listByCategory(category: string): WorkflowTemplate[] {
    return this.listAll().filter((t) => t.category === category);
  }

  /**
   * List all categories
   */
  listCategories(): string[] {
    const categories = new Set(this.listAll().map((t) => t.category));
    return Array.from(categories).sort();
  }

  /**
   * Search templates by tags
   */
  searchByTags(tags: string[]): WorkflowTemplate[] {
    const tagSet = new Set(tags.map((t) => t.toLowerCase()));
    return this.listAll().filter((t) =>
      t.tags.some((tag) => tagSet.has(tag.toLowerCase())),
    );
  }

  /**
   * Full-text search across name, description, tags
   */
  search(query: string): TemplateSearchResult[] {
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(Boolean);

    const results: TemplateSearchResult[] = [];

    for (const template of this.templates.values()) {
      let score = 0;
      const matchedFields: string[] = [];

      // Search in name
      if (template.name.toLowerCase().includes(queryLower)) {
        score += 10;
        matchedFields.push("name");
      }

      // Search in description
      if (template.description.toLowerCase().includes(queryLower)) {
        score += 5;
        matchedFields.push("description");
      }

      // Search in tags
      const matchingTags = template.tags.filter((tag) =>
        queryTerms.some((term) => tag.toLowerCase().includes(term)),
      );
      if (matchingTags.length > 0) {
        score += matchingTags.length * 3;
        matchedFields.push("tags");
      }

      // Search in category
      if (template.category.toLowerCase().includes(queryLower)) {
        score += 2;
        matchedFields.push("category");
      }

      // Boost by rating and downloads
      score += template.rating * 0.5;
      score += Math.log10(template.downloads + 1) * 0.3;

      if (score > 0) {
        results.push({ template, score, matchedFields });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Instantiate a template with parameters
   */
  instantiate(
    templateId: string,
    params: Record<string, any>,
  ): WorkflowDefinition {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Validate required parameters
    for (const param of template.parameters) {
      if (param.required && !(param.name in params)) {
        if (param.defaultValue !== undefined) {
          params[param.name] = param.defaultValue;
        } else {
          throw new Error(`Missing required parameter: ${param.name}`);
        }
      }
    }

    // Apply defaults for optional parameters
    for (const param of template.parameters) {
      if (!(param.name in params) && param.defaultValue !== undefined) {
        params[param.name] = param.defaultValue;
      }
    }

    // Deep clone the definition
    const definition = JSON.parse(JSON.stringify(template.definition));

    // Replace parameter placeholders
    const instantiated = this.replaceParams(definition, params);

    // Increment download count
    template.downloads++;

    Logger.info("system", "template-gallery", "Template instantiated", {
      templateId,
      params: Object.keys(params),
    });

    return instantiated;
  }

  /**
   * Replace ${param.name} placeholders in an object
   */
  private replaceParams(obj: any, params: Record<string, any>): any {
    if (typeof obj === "string") {
      return obj.replace(/\$\{param\.([^}]+)\}/g, (match, paramName) => {
        return params[paramName] !== undefined
          ? String(params[paramName])
          : match;
      });
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.replaceParams(item, params));
    }

    if (obj !== null && typeof obj === "object") {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.replaceParams(value, params);
      }
      return result;
    }

    return obj;
  }

  /**
   * Get template statistics
   */
  getStats(): {
    totalTemplates: number;
    categories: number;
    averageRating: number;
    totalDownloads: number;
  } {
    const templates = this.listAll();
    const totalDownloads = templates.reduce((sum, t) => sum + t.downloads, 0);
    const avgRating =
      templates.length > 0
        ? templates.reduce((sum, t) => sum + t.rating, 0) / templates.length
        : 0;

    return {
      totalTemplates: templates.length,
      categories: this.listCategories().length,
      averageRating: avgRating,
      totalDownloads,
    };
  }
}
