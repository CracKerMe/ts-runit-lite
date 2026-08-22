import type { WorkflowDefinition } from "../model/Workflow";

export type TemplateParameterType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array";

export interface TemplateParameter {
  name: string;
  type: TemplateParameterType;
  description: string;
  required: boolean;
  default?: unknown;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  parameters: TemplateParameter[];
  definition: WorkflowDefinition;
  tags: string[];
}

export interface TemplateInstanceRequest {
  templateId: string;
  name: string;
  parameters: Record<string, unknown>;
}
