import type { WorkflowDefinition } from "../model/Workflow";
import { Logger } from "../utils/Logger";
import type {
  TemplateInstanceRequest,
  TemplateParameter,
  WorkflowTemplate,
} from "./WorkflowTemplate";

const PARAMETER_PATTERN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const EXACT_PARAMETER_PATTERN = /^\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}$/;

export class TemplateRegistry {
  private readonly templates = new Map<string, WorkflowTemplate>();

  register(template: WorkflowTemplate): void {
    if (this.templates.has(template.id)) {
      throw new Error(`Template ${template.id} already registered`);
    }

    this.templates.set(template.id, template);
    Logger.info("system", "templates", "Template registered", {
      templateId: template.id,
      name: template.name,
    });
  }

  get(id: string): WorkflowTemplate | undefined {
    return this.templates.get(id);
  }

  list(category?: string): WorkflowTemplate[] {
    const templates = Array.from(this.templates.values());
    return category
      ? templates.filter((template) => template.category === category)
      : templates;
  }

  instantiate(request: TemplateInstanceRequest): WorkflowDefinition {
    const template = this.templates.get(request.templateId);
    if (!template) {
      throw new Error(`Template ${request.templateId} not found`);
    }

    this.validateParameters(template.parameters, request.parameters);

    const definition = this.cloneDefinition(template.definition);
    definition.id = this.slugify(request.name);
    definition.name = request.name;

    return this.interpolateParameters(
      definition,
      request.parameters,
      template.parameters,
    ) as WorkflowDefinition;
  }

  clear(): void {
    this.templates.clear();
  }

  private validateParameters(
    templateParameters: TemplateParameter[],
    parameters: Record<string, unknown>,
  ): void {
    for (const parameter of templateParameters) {
      if (
        parameter.required &&
        !(parameter.name in parameters) &&
        parameter.default === undefined
      ) {
        throw new Error(`Missing required parameter: ${parameter.name}`);
      }
    }
  }

  private cloneDefinition(definition: WorkflowDefinition): WorkflowDefinition {
    return JSON.parse(JSON.stringify(definition)) as WorkflowDefinition;
  }

  private slugify(name: string): string {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || "workflow";
  }

  private resolveParameter(
    name: string,
    parameters: Record<string, unknown>,
    templateParameters: TemplateParameter[],
  ): unknown {
    if (name in parameters) {
      return parameters[name];
    }

    const templateParameter = templateParameters.find(
      (parameter) => parameter.name === name,
    );
    return templateParameter?.default;
  }

  private interpolateParameters(
    value: unknown,
    parameters: Record<string, unknown>,
    templateParameters: TemplateParameter[],
  ): unknown {
    if (typeof value === "string") {
      const exactMatch = value.match(EXACT_PARAMETER_PATTERN);
      if (exactMatch) {
        const parameterValue = this.resolveParameter(
          exactMatch[1] as string,
          parameters,
          templateParameters,
        );
        return parameterValue === undefined ? value : parameterValue;
      }

      return value.replace(PARAMETER_PATTERN, (match, name: string) => {
        const parameterValue = this.resolveParameter(
          name,
          parameters,
          templateParameters,
        );
        return parameterValue === undefined ? match : String(parameterValue);
      });
    }

    if (Array.isArray(value)) {
      return value.map((item) =>
        this.interpolateParameters(item, parameters, templateParameters),
      );
    }

    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        result[key] = this.interpolateParameters(
          item,
          parameters,
          templateParameters,
        );
      }
      return result;
    }

    return value;
  }
}

export const templateRegistry = new TemplateRegistry();
