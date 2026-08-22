// oxlint-disable no-explicit-any -- dynamic types used throughout this module
/**
 * 表达式函数库的标准函数定义格式。
 * description/args 用于生成函数目录（GET /functions、控制台自动补全）。
 */
export interface FunctionImpl {
  args: string[];
  impl: (...args: any[]) => unknown;
  description: string;
}

export type FunctionModule = Record<string, FunctionImpl>;
