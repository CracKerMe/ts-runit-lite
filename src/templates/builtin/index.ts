import type { TemplateRegistry } from "../TemplateRegistry";
import { httpCallbackTemplate } from "./HttpCallbackTemplate";

export const builtinTemplates = [httpCallbackTemplate];

export function registerBuiltinTemplates(
  registry: TemplateRegistry,
): TemplateRegistry {
  for (const template of builtinTemplates) {
    if (!registry.get(template.id)) {
      registry.register(template);
    }
  }
  return registry;
}
