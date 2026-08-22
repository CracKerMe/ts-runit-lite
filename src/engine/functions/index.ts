// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import { collectionFunctions } from "./collectionFunctions";
import { dateFunctions } from "./dateFunctions";
import { stringFunctions } from "./stringFunctions";
import { typeFunctions } from "./typeFunctions";
import type { FunctionImpl, FunctionModule } from "./types";

export type { FunctionImpl, FunctionModule } from "./types";
export { collectionFunctions, dateFunctions, stringFunctions, typeFunctions };

const MODULES: Record<string, FunctionModule> = {
  string: stringFunctions,
  collection: collectionFunctions,
  type: typeFunctions,
  date: dateFunctions,
};

export interface FunctionCatalogEntry {
  name: string;
  category: string;
  description: string;
  args: string[];
}

/**
 * 返回函数目录，供 API（GET /functions）与控制台自动补全使用。
 */
export function getFunctionCatalog(): FunctionCatalogEntry[] {
  const catalog: FunctionCatalogEntry[] = [];
  for (const [category, module] of Object.entries(MODULES)) {
    for (const [name, def] of Object.entries(module)) {
      catalog.push({
        name,
        category,
        description: def.description,
        args: def.args,
      });
    }
  }
  return catalog;
}

/**
 * 将函数库注册到表达式引擎。
 * @param register - 表达式引擎的 registerFunction
 * @param isRegistered - 可选：已注册检查，避免覆盖既有同名函数
 */
export function registerFunctionLibrary(
  register: (name: string, fn: (...args: any[]) => any) => void,
  isRegistered?: (name: string) => boolean,
): void {
  for (const module of Object.values(MODULES)) {
    for (const [name, def] of Object.entries(module) as Array<
      [string, FunctionImpl]
    >) {
      if (isRegistered?.(name)) continue;
      register(name, def.impl);
    }
  }
}
