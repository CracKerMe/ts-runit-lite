import { getWorkflowOpenApiSchemas } from "../model/WorkflowSchema";

/**
 * OpenAPI 3.0 规范文档
 */
export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "工作流引擎 API",
    description:
      "基于 TypeScript 的工作流引擎 REST API，覆盖工作流管理、实例控制、Signal/Query/Update、事件、Webhook 与 DLQ 等核心公共接口",
    version: "1.0.0",
    contact: {
      name: "API Support",
    },
  },
  servers: [
    {
      url: "/workflow-api/v1",
      description: "API 基础路径",
    },
  ],
  tags: [
    { name: "workflows", description: "工作流定义管理" },
    { name: "instances", description: "工作流实例管理" },
    { name: "events", description: "事件触发与历史" },
    { name: "webhooks", description: "Webhook 管理" },
    { name: "dlq", description: "死信队列管理" },
    { name: "system", description: "系统端点" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["system"],
        summary: "健康检查",
        responses: {
          "200": {
            description: "服务正常",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/metrics": {
      get: {
        tags: ["system"],
        summary: "获取 Prometheus 格式指标",
        responses: {
          "200": {
            description: "Prometheus 指标",
            content: {
              "text/plain": {
                schema: { type: "string" },
              },
            },
          },
        },
      },
    },
    "/workflows": {
      get: {
        tags: ["workflows"],
        summary: "获取所有工作流定义",
        responses: {
          "200": {
            description: "工作流列表",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
                examples: {
                  success: {
                    $ref: "#/components/examples/WorkflowsListSuccess",
                  },
                },
              },
            },
          },
        },
      },
    },
    "/workflows/import/dsl": {
      post: {
        tags: ["workflows"],
        summary: "通过 DSL 导入工作流",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["dsl"],
                properties: {
                  dsl: {
                    type: "string",
                    description: "YAML-like workflow DSL text",
                  },
                  name: {
                    type: "string",
                    description: "Optional workflow name override",
                  },
                  description: {
                    type: "string",
                    description: "Optional workflow description override",
                  },
                  tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "工作流标签，用于分类与检索。",
                  },
                  overwrite: {
                    type: "boolean",
                    description: "Overwrite existing workflow when true",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "DSL 导入成功",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
          "400": {
            description: "DSL 解析失败或定义校验失败",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
          "409": {
            description: "工作流已存在且未开启覆盖",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/workflows/templates": {
      get: {
        tags: ["workflows"],
        summary: "获取内建工作流模板",
        parameters: [
          {
            name: "category",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "按模板分类过滤",
          },
        ],
        responses: {
          "200": {
            description: "模板列表",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/workflows/import/template": {
      post: {
        tags: ["workflows"],
        summary: "通过模板实例化并导入工作流",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["templateId", "name"],
                properties: {
                  templateId: {
                    type: "string",
                    description: "Registered workflow template ID",
                  },
                  name: {
                    type: "string",
                    description: "Workflow name for the instantiated template",
                  },
                  parameters: {
                    type: "object",
                    description: "Template parameter values",
                  },
                  description: {
                    type: "string",
                    description: "Optional workflow description override",
                  },
                  tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "工作流标签，用于分类与检索。",
                  },
                  overwrite: {
                    type: "boolean",
                    description: "Overwrite existing workflow when true",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "模板导入成功",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
          "400": {
            description: "模板参数错误或工作流定义校验失败",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
          "409": {
            description: "工作流已存在且未开启覆盖",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/workflows/{id}": {
      get: {
        tags: ["workflows"],
        summary: "获取指定工作流定义",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "工作流详情",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
                examples: {
                  success: {
                    $ref: "#/components/examples/WorkflowDetailSuccess",
                  },
                },
              },
            },
          },
          "404": {
            description: "工作流不存在",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
                examples: {
                  error: {
                    $ref: "#/components/examples/NotFoundError",
                  },
                },
              },
            },
          },
        },
      },
    },
    "/workflows/{id}/start": {
      post: {
        tags: ["workflows"],
        summary: "启动工作流实例",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { type: "string" },
            description:
              "Idempotency key for safe retries. Reusing the same key with a different payload returns 409.",
          },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  context: {
                    type: "object",
                    description: "初始上下文数据",
                  },
                  version: {
                    type: "string",
                    description:
                      "要启动的工作流版本号；省略则使用默认（最新）版本",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "实例启动成功",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
                examples: {
                  success: {
                    $ref: "#/components/examples/WorkflowStartSuccess",
                  },
                },
              },
            },
          },
          "200": {
            description: "幂等命中（已启动）",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
          "400": {
            description: "请求参数错误",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
                examples: {
                  error: {
                    $ref: "#/components/examples/ValidationError",
                  },
                },
              },
            },
          },
          "409": {
            description: "幂等冲突或请求处理中",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/instances": {
      get: {
        tags: ["instances"],
        summary: "获取所有实例",
        parameters: [
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: [
                "pending",
                "running",
                "completed",
                "failed",
                "rollback",
                "paused",
                "cancelled",
              ],
            },
          },
          {
            name: "workflowId",
            in: "query",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "实例列表",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
                examples: {
                  success: {
                    $ref: "#/components/examples/InstancesListSuccess",
                  },
                },
              },
            },
          },
        },
      },
    },
    "/instances/{id}": {
      get: {
        tags: ["instances"],
        summary: "获取实例详情",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "实例详情",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
          "404": {
            description: "实例不存在",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
                examples: {
                  error: {
                    $ref: "#/components/examples/NotFoundError",
                  },
                },
              },
            },
          },
        },
      },
    },
    "/instances/{id}/resume": {
      post: {
        tags: ["instances"],
        summary: "恢复暂停的实例",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "恢复成功",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
          "404": {
            description: "实例不存在",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/instances/{id}/cancel": {
      post: {
        tags: ["instances"],
        summary: "取消实例",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "取消成功",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
          "404": {
            description: "实例不存在",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/instances/{id}/pause": {
      post: {
        tags: ["instances"],
        summary: "暂停运行中的实例",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "暂停成功",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
          "404": {
            description: "实例不存在",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/instances/{id}/terminate": {
      post: {
        tags: ["instances"],
        summary: "强制终止实例（已处于终态时幂等返回）",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "终止成功或实例已处于终态",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
          "404": {
            description: "实例不存在",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/instances/{id}/signal": {
      post: {
        tags: ["instances"],
        summary: "发送 Signal 到实例",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: {
                    type: "string",
                    description:
                      "Signal/Query 名称，需与工作流中注册的处理器一致。",
                  },
                  payload: {
                    description:
                      "随 Signal/Query 传入的数据，任意 JSON 可序列化结构。",
                  },
                },
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Signal 已接收",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/instances/{id}/query": {
      post: {
        tags: ["instances"],
        summary: "执行实例 Query",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: {
                    type: "string",
                    description:
                      "Signal/Query 名称，需与工作流中注册的处理器一致。",
                  },
                  payload: {
                    description:
                      "随 Signal/Query 传入的数据，任意 JSON 可序列化结构。",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Query 执行完成",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/instances/{id}/update": {
      post: {
        tags: ["instances"],
        summary: "执行实例 Update",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: {
                    type: "string",
                    description: "Update 名称，需与工作流中注册的处理器一致。",
                  },
                  payload: {
                    description:
                      "随 Update 传入的数据，任意 JSON 可序列化结构。",
                  },
                  correlationId: {
                    type: "string",
                    description:
                      "幂等关联 ID。重复提交相同 correlationId 时返回首次结果，不会重复执行。",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Update 执行完成",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/events/trigger": {
      post: {
        tags: ["events"],
        summary: "触发事件",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { type: "string" },
            description:
              "Idempotency key for safe retries. Reusing the same key with a different payload returns 409.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["event"],
                properties: {
                  event: { type: "string", description: "事件名称" },
                  data: { type: "object", description: "事件数据" },
                  instanceId: { type: "string", description: "目标实例 ID" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "事件触发成功",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
                examples: {
                  success: {
                    $ref: "#/components/examples/EventTriggeredSuccess",
                  },
                },
              },
            },
          },
          "409": {
            description: "幂等冲突或请求处理中",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/webhooks": {
      get: {
        tags: ["webhooks"],
        summary: "获取所有 Webhook",
        responses: {
          "200": {
            description: "Webhook 列表",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
      post: {
        tags: ["webhooks"],
        summary: "创建 Webhook",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CreateWebhook",
              },
            },
          },
        },
        responses: {
          "201": {
            description: "创建成功",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/webhooks/deliveries": {
      get: {
        tags: ["webhooks"],
        summary: "获取 Webhook 投递记录",
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 100 },
          },
          {
            name: "offset",
            in: "query",
            schema: { type: "integer", default: 0 },
          },
          {
            name: "webhookId",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "event",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "workflowId",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "instanceId",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: [
                "pending",
                "retry_scheduled",
                "success",
                "failed",
                "dead_lettered",
              ],
            },
          },
        ],
        responses: {
          "200": {
            description: "投递记录列表",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/webhooks/deliveries/{deliveryId}": {
      get: {
        tags: ["webhooks"],
        summary: "获取单条 Webhook 投递记录",
        parameters: [
          {
            name: "deliveryId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "投递记录",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
          "404": {
            description: "投递记录不存在",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/webhooks/deliveries/{deliveryId}/retry": {
      post: {
        tags: ["webhooks"],
        summary: "手动重试 Webhook 投递",
        parameters: [
          {
            name: "deliveryId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "已重新调度投递",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
          "404": {
            description: "投递记录不存在",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/webhooks/deliveries/retry": {
      post: {
        tags: ["webhooks"],
        summary: "批量重试 Webhook 投递",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  webhookId: {
                    type: "string",
                    description: "只重试该 Webhook 的投递。",
                  },
                  event: {
                    type: "string",
                    description: "只重试该事件名的投递。",
                  },
                  workflowId: {
                    type: "string",
                    description: "只重试该工作流产生的投递。",
                  },
                  instanceId: {
                    type: "string",
                    description: "只重试该实例产生的投递。",
                  },
                  status: {
                    type: "string",
                    enum: ["failed", "dead_lettered"],
                    description:
                      "只重试处于该状态的投递。全部条件缺省时重试所有失败投递。",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "已批量重新调度投递",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/webhooks/deliveries/cleanup": {
      post: {
        tags: ["webhooks"],
        summary: "清理过期 Webhook 投递记录",
        responses: {
          "200": {
            description: "清理完成",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/webhooks/deliveries/cleanup/status": {
      get: {
        tags: ["webhooks"],
        summary: "获取 Webhook 投递清理状态",
        responses: {
          "200": {
            description: "清理状态",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/dlq": {
      get: {
        tags: ["dlq"],
        summary: "获取死信队列条目",
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 100 },
          },
          {
            name: "offset",
            in: "query",
            schema: { type: "integer", default: 0 },
          },
          {
            name: "type",
            in: "query",
            schema: { type: "string", enum: ["event", "task", "workflow"] },
          },
        ],
        responses: {
          "200": {
            description: "DLQ 条目列表",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/dlq/stats": {
      get: {
        tags: ["dlq"],
        summary: "获取 DLQ 统计信息",
        responses: {
          "200": {
            description: "DLQ 统计",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/dlq/{id}/retry": {
      post: {
        tags: ["dlq"],
        summary: "重试 DLQ 条目",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "重试成功",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
          "404": {
            description: "条目不存在",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/events/history": {
      get: {
        tags: ["events"],
        summary: "查询事件历史记录",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", default: 20 },
          },
          {
            name: "offset",
            in: "query",
            required: false,
            schema: { type: "integer", default: 0 },
          },
        ],
        responses: {
          "200": {
            description: "事件历史列表",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/analytics/overview": {
      get: {
        tags: ["analytics"],
        summary: "全局分析概览（事件数、异常数、SLA 违规数）",
        responses: {
          "200": {
            description: "分析概览",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/analytics/workflow/{id}": {
      get: {
        tags: ["analytics"],
        summary: "获取指定工作流的分析数据与 SLA 状态",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "window",
            in: "query",
            required: false,
            description: "统计窗口（毫秒）",
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": {
            description: "工作流分析数据",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/analytics/nodes/{id}": {
      get: {
        tags: ["analytics"],
        summary: "获取指定节点的分析数据",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "workflowId",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "window",
            in: "query",
            required: false,
            description: "统计窗口（毫秒）",
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": {
            description: "节点分析数据",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
          "400": {
            description: "缺少 workflowId 查询参数",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/analytics/anomalies": {
      get: {
        tags: ["analytics"],
        summary: "获取检测到的异常列表",
        parameters: [
          {
            name: "workflowId",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "异常列表",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/analytics/sla": {
      get: {
        tags: ["analytics"],
        summary: "获取 SLA 规则与违规记录",
        parameters: [
          {
            name: "workflowId",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "SLA 状态",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
      post: {
        tags: ["analytics"],
        summary: "创建 SLA 规则",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id", "workflowId", "metric", "threshold"],
                properties: {
                  id: { type: "string", description: "SLA 规则的唯一标识。" },
                  workflowId: {
                    type: "string",
                    description: "该规则约束的工作流 ID。",
                  },
                  metric: {
                    type: "string",
                    description: "被监控的指标名，如执行时长、失败率。",
                  },
                  threshold: {
                    type: "number",
                    description: "触发违规的阈值，超过即记一次 SLA 违规。",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "SLA 规则已创建",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
          "400": {
            description: "缺少必填字段",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/analytics/sla/{id}": {
      delete: {
        tags: ["analytics"],
        summary: "删除 SLA 规则",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "SLA 规则已删除",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/functions": {
      get: {
        tags: ["functions"],
        summary: "获取内置与自定义表达式函数目录",
        responses: {
          "200": {
            description: "函数目录",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
      post: {
        tags: ["functions"],
        summary: "注册自定义表达式函数",
        responses: {
          "201": {
            description: "函数已注册",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/functions/{name}": {
      delete: {
        tags: ["functions"],
        summary: "注销自定义表达式函数",
        parameters: [
          {
            name: "name",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "函数已注销",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/templates": {
      get: {
        tags: ["templates"],
        summary: "列出工作流模板",
        responses: {
          "200": {
            description: "模板列表",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
      post: {
        tags: ["templates"],
        summary: "创建工作流模板",
        responses: {
          "201": {
            description: "模板已创建",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/templates/{id}": {
      get: {
        tags: ["templates"],
        summary: "获取指定模板",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "模板详情",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
      delete: {
        tags: ["templates"],
        summary: "删除指定模板",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "模板已删除",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/workflows/schema": {
      get: {
        tags: ["workflows"],
        summary: "获取 WorkflowDefinition 的 JSON Schema",
        responses: {
          "200": {
            description: "JSON Schema",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/workflows/node-templates": {
      get: {
        tags: ["workflows"],
        summary: "获取可用节点类型模板目录",
        responses: {
          "200": {
            description: "节点模板目录",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/workflows/{id}/graph": {
      get: {
        tags: ["workflows"],
        summary: "获取工作流的 nodes[]/edges[] 图视图",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "工作流图",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
      put: {
        tags: ["workflows"],
        summary: "以图视图更新工作流定义",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "工作流已更新",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/workflows/{id}/variables": {
      get: {
        tags: ["workflows"],
        summary: "获取 `${...}` 表达式变量自动补全候选项",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "before",
            in: "query",
            required: false,
            description: "仅返回该节点 ID 之前（其祖先）的候选项",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "变量候选项",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/workflows/{id}/versions": {
      get: {
        tags: ["workflows"],
        summary: "列出工作流的历史版本",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "版本列表",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessResponse" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      ApiSuccessResponse: {
        type: "object",
        description: "所有成功响应共用的信封结构，业务数据在 data 字段内。",
        required: ["code", "message", "data", "timestamp"],
        properties: {
          code: {
            description: "业务状态码，成功恒为 0（与 HTTP 状态码相互独立）。",
            oneOf: [
              { type: "number", enum: [0] },
              { type: "string", enum: ["0"] },
            ],
          },
          message: { type: "string", description: "可读的结果描述。" },
          data: {
            type: "object",
            description: "业务数据，具体形状随端点而定，见各端点的响应示例。",
          },
          timestamp: {
            type: "string",
            format: "date-time",
            description: "服务端生成响应的时刻（ISO 8601）。",
          },
        },
      },
      ApiErrorResponse: {
        type: "object",
        description: "所有失败响应共用的信封结构。",
        required: ["code", "message", "timestamp"],
        properties: {
          code: {
            description:
              "业务错误码，非 0。取值见 ErrorCode（src/api/ErrorHandler.ts）。",
            oneOf: [{ type: "number" }, { type: "string" }],
          },
          message: { type: "string", description: "可读的错误描述。" },
          error: {
            description: "错误详情，可能是结构化对象、字符串或 null。",
            oneOf: [{ type: "object" }, { type: "string" }, { type: "null" }],
          },
          timestamp: {
            type: "string",
            format: "date-time",
            description: "服务端生成响应的时刻（ISO 8601）。",
          },
        },
      },
      ApiResponse: {
        oneOf: [
          { $ref: "#/components/schemas/ApiSuccessResponse" },
          { $ref: "#/components/schemas/ApiErrorResponse" },
        ],
      },
      CreateWebhook: {
        type: "object",
        required: ["name", "url", "events"],
        properties: {
          name: {
            type: "string",
            description: "Webhook 名称，便于在列表中识别。",
          },
          url: {
            type: "string",
            format: "uri",
            description: "接收投递的目标地址，需可从引擎所在网络访问。",
          },
          events: {
            type: "array",
            items: { type: "string" },
            description: "订阅的事件名列表，至少一个。",
          },
          headers: {
            type: "object",
            description:
              "投递时附加的自定义请求头，值支持 ${secret:NAME} 占位符。",
          },
          secret: {
            type: "string",
            description: "签名密钥，用于让接收方校验投递来源。",
          },
        },
      },
      // WorkflowDefinition, TaskNode, and every per-node-type NodeConfig
      // schema are generated from src/model/WorkflowSchema.ts (Zod) so this
      // spec stays in sync with the TS model instead of drifting from a
      // hand-maintained stub.
      ...getWorkflowOpenApiSchemas(),
      WorkflowInstance: {
        type: "object",
        properties: {
          instanceId: { type: "string" },
          workflowId: { type: "string" },
          status: {
            type: "string",
            enum: [
              "pending",
              "running",
              "completed",
              "failed",
              "rollback",
              "paused",
              "cancelled",
            ],
          },
          currentNodes: { type: "array", items: { type: "string" } },
          context: { type: "object" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
    },
    examples: {
      WorkflowsListSuccess: {
        value: {
          code: 0,
          message: "Workflows retrieved",
          data: {
            workflows: [
              {
                id: "order-processing",
                name: "订单处理流程",
                version: 1,
              },
            ],
            pagination: {
              page: 1,
              pageSize: 50,
              totalCount: 1,
              totalPages: 1,
            },
          },
          timestamp: "2026-02-12T10:00:00.000Z",
        },
      },
      WorkflowDetailSuccess: {
        value: {
          code: 0,
          message: "Workflow retrieved",
          data: {
            id: "order-processing",
            name: "订单处理流程",
            version: 1,
          },
          timestamp: "2026-02-12T10:00:00.000Z",
        },
      },
      WorkflowStartSuccess: {
        value: {
          code: 0,
          message: "Workflow started",
          data: {
            instanceId: "order-processing_0",
          },
          timestamp: "2026-02-12T10:00:00.000Z",
        },
      },
      InstancesListSuccess: {
        value: {
          code: 0,
          message: "Instances retrieved",
          data: {
            instances: [
              {
                id: "order-processing_0",
                workflowId: "order-processing",
                status: "running",
              },
            ],
          },
          timestamp: "2026-02-12T10:00:00.000Z",
        },
      },
      EventTriggeredSuccess: {
        value: {
          code: 0,
          message: "Event email_confirmed triggered successfully",
          data: {
            event: "email_confirmed",
            withInstanceId: false,
          },
          timestamp: "2026-02-12T10:00:00.000Z",
        },
      },
      ValidationError: {
        value: {
          code: 400,
          message: "请求参数无效",
          error: {
            field: "id",
            reason: "must not be empty",
          },
          timestamp: "2026-02-12T10:00:00.000Z",
        },
      },
      NotFoundError: {
        value: {
          code: 404,
          message: "资源不存在",
          error: {
            path: "/workflow-api/v1/workflows/not-found",
          },
          timestamp: "2026-02-12T10:00:00.000Z",
        },
      },
    },
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    },
  },
  security: [{ bearerAuth: [] }, { apiKey: [] }],
};

/**
 * 生成简单的 HTML 文档页面
 */
export function generateApiDocsHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>工作流引擎 API 文档</title>
  <link rel="stylesheet" href="/swagger-ui/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/swagger-ui/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      spec: ${JSON.stringify(openApiSpec)},
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout"
    });
  </script>
</body>
</html>`;
}
