/**
 * API 模块导出
 */

export { ApiError, ErrorCode, errorHandler } from "./ErrorHandler";
export { EventHistoryManager } from "./EventHistory";
/** @deprecated 内置文档站已改用 generateConceptIndexHtml / generateConceptDocHtml
 * （Dify 式版式，按主题分页）；此导出保留给仍依赖旧单页锚点版式的宿主应用。 */
export { generateConceptsDocHtml } from "./docsPage";
export { generateApiEndpointHtml, generateApiIndexHtml } from "./docs/apiPages";
export {
  generateConceptDocHtml,
  generateConceptIndexHtml,
} from "./docs/conceptPages";
export { generateNodeDocHtml, generateNodeIndexHtml } from "./docs/nodePages";
/** @deprecated 内置文档站已改用 generateApiIndexHtml（Dify 式版式）；
 * 此导出保留给仍依赖 Swagger UI 页面的宿主应用。 */
export { generateApiDocsHtml, openApiSpec } from "./openapi";
export { generateWelcomeHtml } from "./welcomePage";
export type { ApiServerConfig } from "./server";
export { startApiServer } from "./server";
export { WebhookManager } from "./WebhookManager";
