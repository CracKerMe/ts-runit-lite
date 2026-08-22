import type { WorkflowTemplate } from "../WorkflowTemplate";

export const httpCallbackTemplate: WorkflowTemplate = {
  id: "http-callback",
  name: "HTTP Callback",
  description: "Send an HTTP request to a configurable callback URL.",
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
      description: "Request body payload",
      required: false,
      default: {},
    },
  ],
  definition: {
    id: "http-callback",
    name: "HTTP Callback",
    startNode: "callback",
    nodes: {
      callback: {
        id: "callback",
        type: "http",
        config: {
          method: "{{method}}",
          url: "{{callbackUrl}}",
          body: "{{payload}}",
        },
      },
    },
  },
  tags: ["http", "callback", "integration"],
};
