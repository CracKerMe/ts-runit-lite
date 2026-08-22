import { beforeEach, describe, expect, it } from "vitest";
import { builtinTemplates, registerBuiltinTemplates } from "../builtin/index";
import { TemplateRegistry } from "../TemplateRegistry";
import type { WorkflowTemplate } from "../WorkflowTemplate";

describe("TemplateRegistry", () => {
  let registry: TemplateRegistry;

  const mockTemplate: WorkflowTemplate = {
    id: "http-callback",
    name: "HTTP Callback",
    description: "Simple HTTP callback workflow",
    category: "integration",
    version: "1.0.0",
    parameters: [
      {
        name: "callbackUrl",
        type: "string",
        description: "Callback URL",
        required: true,
      },
      {
        name: "method",
        type: "string",
        description: "HTTP method",
        required: false,
        default: "POST",
      },
      {
        name: "payload",
        type: "object",
        description: "Request payload",
        required: false,
        default: { source: "template" },
      },
    ],
    definition: {
      id: "placeholder",
      name: "Placeholder",
      startNode: "callback",
      nodes: {
        callback: {
          id: "callback",
          type: "http",
          config: {
            method: "{{method}}",
            url: "{{callbackUrl}}",
            body: "{{payload}}",
            label: "Call {{callbackUrl}}",
          },
        },
      },
    },
    tags: ["http", "callback"],
  };

  beforeEach(() => {
    registry = new TemplateRegistry();
  });

  it("should register and retrieve template", () => {
    registry.register(mockTemplate);

    expect(registry.get("http-callback")).toBe(mockTemplate);
  });

  it("should reject duplicate template ids", () => {
    registry.register(mockTemplate);

    expect(() => registry.register(mockTemplate)).toThrow(
      "Template http-callback already registered",
    );
  });

  it("should list templates by category", () => {
    registry.register(mockTemplate);

    expect(registry.list("integration")).toEqual([mockTemplate]);
    expect(registry.list("ai")).toEqual([]);
  });

  it("should instantiate template with parameters and defaults", () => {
    registry.register(mockTemplate);

    const result = registry.instantiate({
      templateId: "http-callback",
      name: "My Callback",
      parameters: { callbackUrl: "https://example.com/hook" },
    });

    expect(result.id).toBe("my-callback");
    expect(result.name).toBe("My Callback");
    expect(result.nodes.callback.config?.url).toBe("https://example.com/hook");
    expect(result.nodes.callback.config?.method).toBe("POST");
    expect(result.nodes.callback.config?.body).toEqual({ source: "template" });
    expect(result.nodes.callback.config?.label).toBe(
      "Call https://example.com/hook",
    );
  });

  it("should throw on missing required parameter", () => {
    registry.register(mockTemplate);

    expect(() =>
      registry.instantiate({
        templateId: "http-callback",
        name: "Bad",
        parameters: {},
      }),
    ).toThrow("Missing required parameter: callbackUrl");
  });

  it("should register built-in templates idempotently", () => {
    registerBuiltinTemplates(registry);
    registerBuiltinTemplates(registry);

    expect(registry.list()).toHaveLength(builtinTemplates.length);
    expect(registry.get("http-callback")).toBeDefined();
  });
});
