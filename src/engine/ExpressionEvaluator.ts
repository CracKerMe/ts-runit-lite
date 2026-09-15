// oxlint-disable no-explicit-any -- Expression evaluator handles dynamic types by design
import { Logger } from "../utils/Logger";
import { registerFunctionLibrary } from "./functions/index";

export interface ExpressionTraceEntry {
  expression: string;
  result: unknown;
  context: Record<string, unknown>;
  duration: number;
}

let traceEnabled = false;
let expressionTraces: ExpressionTraceEntry[] = [];

export async function withExpressionTrace<T>(fn: () => Promise<T>): Promise<T> {
  const previousEnabled = traceEnabled;
  const previousTraces = expressionTraces;
  traceEnabled = true;
  expressionTraces = [];
  try {
    return await fn();
  } finally {
    traceEnabled = previousEnabled;
    if (!previousEnabled) {
      // keep collected traces available for immediate read after top-level run
    } else {
      expressionTraces = previousTraces;
    }
  }
}

export function getExpressionTraces(): ExpressionTraceEntry[] {
  return [...expressionTraces];
}

/**
 * Enhanced expression evaluator with operator precedence and custom functions
 * Supports mathematical, comparison, and logical operators with proper precedence
 * Implements Shunting Yard algorithm for parsing
 */

/**
 * Token types for expression parsing
 */
enum TokenType {
  NUMBER = "NUMBER",
  STRING = "STRING",
  BOOLEAN = "BOOLEAN",
  NULL = "NULL",
  IDENTIFIER = "IDENTIFIER",
  OPERATOR = "OPERATOR",
  LPAREN = "LPAREN",
  RPAREN = "RPAREN",
  LBRACKET = "LBRACKET",
  RBRACKET = "RBRACKET",
  COMMA = "COMMA",
  ARROW = "ARROW",
  DOT = "DOT",
  EOF = "EOF",
}

interface Token {
  type: TokenType;
  value: any;
  position: number;
}

/**
 * Operator definitions with precedence and associativity
 * Higher precedence = evaluated first
 */
interface OperatorDef {
  precedence: number;
  associativity: "left" | "right";
  unary?: boolean;
  fn: (...args: any[]) => any;
}

const OPERATORS: Record<string, OperatorDef> = {
  // Pipe operator (lowest precedence) — left-to-right function application
  "|": {
    precedence: 0,
    associativity: "left",
    fn: (_a: any, _b: any) => {
      // Pipe is handled specially in parseExpression — this is a placeholder
      throw new Error("Pipe operator should be handled by the parser");
    },
  },
  // Logical OR
  "||": {
    precedence: 1,
    associativity: "left",
    fn: (a: any, b: any) => Boolean(a) || Boolean(b),
  },
  // Logical AND
  "&&": {
    precedence: 2,
    associativity: "left",
    fn: (a: any, b: any) => Boolean(a) && Boolean(b),
  },
  // Equality
  "==": {
    precedence: 3,
    associativity: "left",
    fn: (a: any, b: any) => a === b,
  },
  "!=": {
    precedence: 3,
    associativity: "left",
    fn: (a: any, b: any) => a !== b,
  },
  "===": {
    precedence: 3,
    associativity: "left",
    fn: (a: any, b: any) => a === b,
  },
  "!==": {
    precedence: 3,
    associativity: "left",
    fn: (a: any, b: any) => a !== b,
  },
  // Comparison
  "<": {
    precedence: 4,
    associativity: "left",
    fn: (a: any, b: any) => a < b,
  },
  ">": {
    precedence: 4,
    associativity: "left",
    fn: (a: any, b: any) => a > b,
  },
  "<=": {
    precedence: 4,
    associativity: "left",
    fn: (a: any, b: any) => a <= b,
  },
  ">=": {
    precedence: 4,
    associativity: "left",
    fn: (a: any, b: any) => a >= b,
  },
  // Additive
  "+": {
    precedence: 5,
    associativity: "left",
    fn: (a: any, b: any) => a + b,
  },
  "-": {
    precedence: 5,
    associativity: "left",
    fn: (a: any, b: any) => a - b,
  },
  // Multiplicative
  "*": {
    precedence: 6,
    associativity: "left",
    fn: (a: any, b: any) => a * b,
  },
  "/": {
    precedence: 6,
    associativity: "left",
    fn: (a: any, b: any) => a / b,
  },
  "%": {
    precedence: 6,
    associativity: "left",
    fn: (a: any, b: any) => a % b,
  },
  // Exponentiation (highest precedence for binary operators)
  "**": {
    precedence: 7,
    associativity: "right",
    fn: (a: any, b: any) => a ** b,
  },
  // Unary operators
  "!": {
    precedence: 8,
    associativity: "right",
    unary: true,
    fn: (a: any) => !a,
  },
  "u-": {
    precedence: 8,
    associativity: "right",
    unary: true,
    fn: (a: any) => -a,
  },
};

/**
 * Custom function registry
 */
const FUNCTIONS: Record<string, (...args: any[]) => any> = {};

/**
 * Register a custom function for use in expressions
 */
export function registerFunction(
  name: string,
  fn: (...args: any[]) => any,
): void {
  FUNCTIONS[name] = fn;
}

/**
 * Initialize built-in functions
 */
function initializeBuiltInFunctions(): void {
  // Math functions
  registerFunction("abs", (x: number) => Math.abs(x));
  registerFunction("ceil", (x: number) => Math.ceil(x));
  registerFunction("floor", (x: number) => Math.floor(x));
  registerFunction("round", (x: number, decimals = 0) => {
    // Support optional decimal precision: round(x) or round(x, 2)
    if (decimals === 0) return Math.round(x);
    const factor = 10 ** decimals;
    return Math.round(x * factor) / factor;
  });
  registerFunction("min", (...args: number[]) => Math.min(...args));
  registerFunction("max", (...args: number[]) => Math.max(...args));
  registerFunction("sqrt", (x: number) => Math.sqrt(x));
  registerFunction("pow", (x: number, y: number) => x ** y);

  // String functions
  registerFunction("length", (s: string | any[]) => {
    if (typeof s === "string") return s.length;
    if (Array.isArray(s)) return s.length;
    return 0;
  });
  registerFunction("substring", (s: string, start: number, end?: number) => {
    return s.substring(start, end);
  });
  registerFunction("toLowerCase", (s: string) => s.toLowerCase());
  registerFunction("toUpperCase", (s: string) => s.toUpperCase());
  registerFunction("trim", (s: string) => s.trim());
  registerFunction("concat", (...args: any[]) => args.join(""));
  registerFunction("includes", (s: string | any[], search: any) => {
    if (typeof s === "string") return s.includes(String(search));
    if (Array.isArray(s)) return s.includes(search);
    return false;
  });
  registerFunction("startsWith", (s: string, prefix: string) =>
    s.startsWith(prefix),
  );
  registerFunction("endsWith", (s: string, suffix: string) =>
    s.endsWith(suffix),
  );

  // Date functions
  registerFunction("now", () => Date.now());
  registerFunction("parse", (s: string) => Date.parse(s));
  registerFunction("format", (timestamp: number, format?: string) => {
    const date = new Date(timestamp);
    if (!format) return date.toISOString();

    // Simple format support (ISO by default)
    // Could be extended with more format options
    return date.toISOString();
  });
  registerFunction("addDays", (timestamp: number, days: number) => {
    return timestamp + days * 24 * 60 * 60 * 1000;
  });
  registerFunction("addHours", (timestamp: number, hours: number) => {
    return timestamp + hours * 60 * 60 * 1000;
  });
  registerFunction(
    "diff",
    (timestamp1: number, timestamp2: number, unit = "ms") => {
      const diff = timestamp1 - timestamp2;
      switch (unit) {
        case "ms":
          return diff;
        case "s":
          return diff / 1000;
        case "m":
          return diff / (1000 * 60);
        case "h":
          return diff / (1000 * 60 * 60);
        case "d":
          return diff / (1000 * 60 * 60 * 24);
        default:
          return diff;
      }
    },
  );

  // Array functions
  registerFunction("join", (arr: any[], separator = ",") => {
    if (!Array.isArray(arr)) return String(arr);
    return arr.join(separator);
  });
  registerFunction("map", (arr: any[], fn: any) => {
    if (!Array.isArray(arr)) return [];
    if (typeof fn === "function") return arr.map(fn);
    return arr;
  });
  registerFunction("filter", (arr: any[], fn: any) => {
    if (!Array.isArray(arr)) return [];
    if (typeof fn === "function") return arr.filter(fn);
    return arr;
  });
  registerFunction("reduce", (arr: any[], fn: any, initial?: any) => {
    if (!Array.isArray(arr)) return initial;
    if (typeof fn === "function") {
      return initial !== undefined ? arr.reduce(fn, initial) : arr.reduce(fn);
    }
    return initial;
  });
  registerFunction("find", (arr: any[], fn: any) => {
    if (!Array.isArray(arr)) return undefined;
    if (typeof fn === "function") return arr.find(fn);
    return undefined;
  });
  registerFunction("some", (arr: any[], fn: any) => {
    if (!Array.isArray(arr)) return false;
    if (typeof fn === "function") return arr.some(fn);
    return false;
  });
  registerFunction("every", (arr: any[], fn: any) => {
    if (!Array.isArray(arr)) return false;
    if (typeof fn === "function") return arr.every(fn);
    return false;
  });
  registerFunction("flat", (arr: any[], depth = 1) => {
    if (!Array.isArray(arr)) return [];
    return arr.flat(depth);
  });
  registerFunction("flatMap", (arr: any[], fn: any) => {
    if (!Array.isArray(arr)) return [];
    if (typeof fn === "function") return arr.flatMap(fn);
    return arr;
  });
}

// Initialize built-in functions on module load
initializeBuiltInFunctions();

// Register the extended function library (string/collection/type/date).
// Existing built-in names take precedence and are never overwritten.
registerFunctionLibrary(registerFunction, (name) => name in FUNCTIONS);

/**
 * Tokenizer for expression parsing
 */
class Tokenizer {
  private expression: string;
  private position = 0;
  private current: string;

  constructor(expression: string) {
    this.expression = expression;
    this.current = expression[0] || "";
  }

  private advance(): void {
    this.position++;
    this.current =
      this.position < this.expression.length
        ? this.expression[this.position]
        : "";
  }

  private peek(offset = 1): string {
    const pos = this.position + offset;
    return pos < this.expression.length ? this.expression[pos] : "";
  }

  private skipWhitespace(): void {
    while (this.current && /\s/.test(this.current)) {
      this.advance();
    }
  }

  private readNumber(): Token {
    const start = this.position;
    let value = "";

    while (this.current && /[\d.]/.test(this.current)) {
      value += this.current;
      this.advance();
    }

    return {
      type: TokenType.NUMBER,
      value: Number.parseFloat(value),
      position: start,
    };
  }

  private readString(quote: string): Token {
    const start = this.position;
    let value = "";
    this.advance(); // Skip opening quote

    while (this.current && this.current !== quote) {
      if (this.current === "\\") {
        this.advance();
        // Handle escape sequences
        const ch: string = this.current;
        if (ch === "n") {
          value += "\n";
        } else if (ch === "t") {
          value += "\t";
        } else if (ch === "r") {
          value += "\r";
        } else if (ch === "\\") {
          value += "\\";
        } else if (ch === quote) {
          value += quote;
        } else {
          value += ch;
        }
      } else {
        value += this.current;
      }
      this.advance();
    }

    if (this.current === quote) {
      this.advance(); // Skip closing quote
    }

    return {
      type: TokenType.STRING,
      value,
      position: start,
    };
  }

  private readIdentifier(): Token {
    const start = this.position;
    let value = "";

    while (this.current && /[a-zA-Z0-9_.]/.test(this.current)) {
      value += this.current;
      this.advance();
    }

    // Check for boolean literals
    if (value === "true") {
      return { type: TokenType.BOOLEAN, value: true, position: start };
    }
    if (value === "false") {
      return { type: TokenType.BOOLEAN, value: false, position: start };
    }
    if (value === "null") {
      return { type: TokenType.NULL, value: null, position: start };
    }

    return {
      type: TokenType.IDENTIFIER,
      value,
      position: start,
    };
  }

  private readOperator(): Token {
    const start = this.position;

    // Check for three-character operators first
    const threeChar = this.current + this.peek() + this.peek(2);
    if (["===", "!=="].includes(threeChar)) {
      this.advance();
      this.advance();
      this.advance();
      return {
        type: TokenType.OPERATOR,
        value: threeChar,
        position: start,
      };
    }

    // Arrow =>
    if (this.current === "=" && this.peek() === ">") {
      this.advance();
      this.advance();
      return { type: TokenType.ARROW, value: "=>", position: start };
    }

    // Check for two-character operators
    const twoChar = this.current + this.peek();
    if (["==", "!=", "<=", ">=", "&&", "||", "**"].includes(twoChar)) {
      this.advance();
      this.advance();
      return {
        type: TokenType.OPERATOR,
        value: twoChar,
        position: start,
      };
    }

    // Dot for method chaining
    if (this.current === ".") {
      this.advance();
      return { type: TokenType.DOT, value: ".", position: start };
    }

    // Brackets for array literals / indexing
    if (this.current === "[") {
      this.advance();
      return { type: TokenType.LBRACKET, value: "[", position: start };
    }
    if (this.current === "]") {
      this.advance();
      return { type: TokenType.RBRACKET, value: "]", position: start };
    }

    // Single character operators
    const oneChar = this.current;
    this.advance();
    return {
      type: TokenType.OPERATOR,
      value: oneChar,
      position: start,
    };
  }

  public nextToken(): Token {
    this.skipWhitespace();

    if (!this.current) {
      return { type: TokenType.EOF, value: null, position: this.position };
    }

    // Numbers
    if (/\d/.test(this.current)) {
      return this.readNumber();
    }

    // Strings
    if (this.current === '"' || this.current === "'") {
      return this.readString(this.current);
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(this.current)) {
      return this.readIdentifier();
    }

    // Parentheses
    if (this.current === "(") {
      const token = {
        type: TokenType.LPAREN,
        value: "(",
        position: this.position,
      };
      this.advance();
      return token;
    }
    if (this.current === ")") {
      const token = {
        type: TokenType.RPAREN,
        value: ")",
        position: this.position,
      };
      this.advance();
      return token;
    }

    // Comma
    if (this.current === ",") {
      const token = {
        type: TokenType.COMMA,
        value: ",",
        position: this.position,
      };
      this.advance();
      return token;
    }

    // Operators
    if ("+-*/%<>=!&|".includes(this.current)) {
      return this.readOperator();
    }

    throw new Error(
      `Unexpected character '${this.current}' at position ${this.position}`,
    );
  }

  public tokenize(): Token[] {
    const tokens: Token[] = [];
    let token = this.nextToken();

    while (token.type !== TokenType.EOF) {
      tokens.push(token);
      token = this.nextToken();
    }

    tokens.push(token); // Add EOF token
    return tokens;
  }
}

// ── Token cache ────────────────────────────────────────────────────────────
//
// 工作流里的表达式是定义中的**静态字符串**，只有 context 在变：
// 同一个条件边、router 分支或 loop 体每轮都会用同样的字符串重新求值。
// 此前每次 evaluate() 都从头做字符级词法分析，是引擎侧最明显的重复计算。
//
// 只缓存 token，不缓存 AST：ExpressionParser 的构造函数接收 context 且
// 解析与求值是交织的，并不产出可复用的纯 AST。token 层缓存安全且无侵入
// ——解析器只按下标读取 tokens 并自己维护 position，既不改写数组也不
// 改写 Token 对象（lambda 体用的是 slice()，同样是只读）。

/** 表达式 token 缓存上限。动态拼接的表达式不会撑爆内存。 */
const TOKEN_CACHE_MAX_SIZE = 2000;

/** 超过该长度的表达式不入缓存，避免少数超长字符串占满容量。 */
const TOKEN_CACHE_MAX_EXPRESSION_LENGTH = 4000;

const tokenCache = new Map<string, Token[]>();

/**
 * 取得表达式的 token 序列，命中缓存则跳过整个词法分析。
 *
 * 返回的数组由所有调用方共享，**调用方不得修改**。
 */
function tokenizeCached(expression: string): Token[] {
  if (expression.length > TOKEN_CACHE_MAX_EXPRESSION_LENGTH) {
    return new Tokenizer(expression).tokenize();
  }

  const cached = tokenCache.get(expression);
  if (cached) return cached;

  const tokens = new Tokenizer(expression).tokenize();

  // 简单的插入序淘汰即可：工作流表达式集合是有界且稳定的，
  // 到达上限通常意味着调用方在动态拼接表达式。
  if (tokenCache.size >= TOKEN_CACHE_MAX_SIZE) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  tokenCache.set(expression, tokens);

  return tokens;
}

/** 清空 token 缓存。测试与内存诊断用。 */
export function clearExpressionCache(): void {
  tokenCache.clear();
}

/** token 缓存统计，用于监控。 */
export function getExpressionCacheStats(): {
  size: number;
  maxSize: number;
} {
  return { size: tokenCache.size, maxSize: TOKEN_CACHE_MAX_SIZE };
}

/**
 * Expression parser using Shunting Yard algorithm
 */
class ExpressionParser {
  private tokens: Token[];
  private position = 0;
  private context: Record<string, any>;

  constructor(tokens: Token[], context: Record<string, any>) {
    this.tokens = tokens;
    this.context = context;
  }

  private currentToken(): Token {
    return (
      this.tokens[this.position] || {
        type: TokenType.EOF,
        value: null,
        position: -1,
      }
    );
  }

  private advance(): void {
    this.position++;
  }

  /**
   * Parse a lambda expression: `param => body` or `(p1, p2) => body`
   * Must be called when the current token is IDENTIFIER or LPAREN that starts a lambda.
   * Only consumes the tokens if a valid `=>` follows.
   */
  private tryParseLambda(): ((...args: any[]) => any) | null {
    const saved = this.position;

    const paramNames: string[] = [];

    if (this.currentToken().type === TokenType.LPAREN) {
      // Multi-param: (a, b) => body
      this.advance(); // skip '('
      while (this.currentToken().type === TokenType.IDENTIFIER) {
        paramNames.push(this.currentToken().value);
        this.advance();
        if (this.currentToken().type === TokenType.COMMA) {
          this.advance();
        }
      }
      if (this.currentToken().type !== TokenType.RPAREN) {
        this.position = saved;
        return null;
      }
      this.advance(); // skip ')'
    } else if (this.currentToken().type === TokenType.IDENTIFIER) {
      // Single param: n => body
      paramNames.push(this.currentToken().value);
      this.advance();
    } else {
      return null;
    }

    if (this.currentToken().type !== TokenType.ARROW) {
      this.position = saved;
      return null;
    }
    this.advance(); // skip '=>'

    // Parse the body expression — consume tokens until we hit a delimiter
    const bodyStart = this.position;
    // Parse until we hit a comma, rparen, rbracket, or EOF
    this.parseExpression(true, true, true);
    const bodyEnd = this.position;

    // Build a lambda that re-evaluates the body with injected params
    const lambda = (...args: any[]): any => {
      const paramContext = { ...this.context };
      for (let i = 0; i < paramNames.length; i++) {
        paramContext[paramNames[i]] = args[i];
      }
      // Re-parse the body tokens with the new context
      const bodyTokens = this.tokens.slice(bodyStart, bodyEnd);
      const parser = new ExpressionParser(bodyTokens, paramContext);
      return parser.parse();
    };

    return lambda;
  }

  private parseExpression(
    stopAtComma = false,
    stopAtRParen = false,
    stopAtRBracket = false,
  ): any {
    const outputQueue: any[] = [];
    const operatorStack: Token[] = [];
    let expectOperand = true; // Track if we expect an operand (for unary operators)

    while (
      this.currentToken().type !== TokenType.EOF &&
      !(stopAtComma && this.currentToken().type === TokenType.COMMA) &&
      !(stopAtRParen && this.currentToken().type === TokenType.RPAREN) &&
      !(stopAtRBracket && this.currentToken().type === TokenType.RBRACKET)
    ) {
      const token = this.currentToken();

      if (
        token.type === TokenType.NUMBER ||
        token.type === TokenType.STRING ||
        token.type === TokenType.BOOLEAN ||
        token.type === TokenType.NULL
      ) {
        outputQueue.push(token.value);
        this.advance();
        expectOperand = false;
      } else if (token.type === TokenType.IDENTIFIER) {
        // Check if it's a lambda (param => body) — peek ahead for ARROW
        if (expectOperand) {
          const lambda = this.tryParseLambda();
          if (lambda) {
            outputQueue.push(lambda);
            expectOperand = false;
            continue;
          }
        }

        // Check if it's a function call or method call
        this.advance();
        if (this.currentToken().type === TokenType.LPAREN) {
          // Function call
          const funcName = token.value;
          this.advance(); // Skip '('
          const args: any[] = [];

          if (this.currentToken().type !== TokenType.RPAREN) {
            // Try lambda first
            const lambda = this.tryParseLambda();
            if (lambda) {
              args.push(lambda);
            } else {
              args.push(this.parseExpression(true, true, false));
            }

            while (this.currentToken().type === TokenType.COMMA) {
              this.advance(); // Skip ','
              const lambdaArg = this.tryParseLambda();
              if (lambdaArg) {
                args.push(lambdaArg);
              } else {
                args.push(this.parseExpression(true, true, false));
              }
            }
          }

          if (this.currentToken().type !== TokenType.RPAREN) {
            throw new Error(`Expected ')' after function arguments`);
          }
          this.advance(); // Skip ')'

          // Execute function
          const func = FUNCTIONS[funcName];
          if (!func) {
            throw new Error(`Unknown function: ${funcName}`);
          }
          const result = func(...args);
          outputQueue.push(result);

          // Support method chaining: result.method(args)
          while (this.currentToken().type === TokenType.DOT) {
            this.advance(); // skip '.'
            if (this.currentToken().type !== TokenType.IDENTIFIER) {
              throw new Error(`Expected method name after '.'`);
            }
            const methodName = this.currentToken().value;
            this.advance();
            if (this.currentToken().type !== TokenType.LPAREN) {
              throw new Error(`Expected '(' after method name '${methodName}'`);
            }
            this.advance(); // skip '('
            const methodArgs: any[] = [outputQueue.pop()]; // receiver is first arg
            if (this.currentToken().type !== TokenType.RPAREN) {
              const lambdaArg = this.tryParseLambda();
              if (lambdaArg) {
                methodArgs.push(lambdaArg);
              } else {
                methodArgs.push(this.parseExpression(true, true, false));
              }
              while (this.currentToken().type === TokenType.COMMA) {
                this.advance();
                const la = this.tryParseLambda();
                if (la) {
                  methodArgs.push(la);
                } else {
                  methodArgs.push(this.parseExpression(true, true, false));
                }
              }
            }
            if (this.currentToken().type !== TokenType.RPAREN) {
              throw new Error(`Expected ')' after method arguments`);
            }
            this.advance();
            const method = FUNCTIONS[methodName];
            if (!method) {
              throw new Error(`Unknown function: ${methodName}`);
            }
            outputQueue.push(method(...methodArgs));
          }
        } else {
          // Variable reference
          let value = getNestedValue(this.context, token.value);

          // Support method chaining on variable values
          while (this.currentToken().type === TokenType.DOT) {
            this.advance(); // skip '.'
            if (this.currentToken().type !== TokenType.IDENTIFIER) {
              throw new Error(`Expected method name after '.'`);
            }
            const methodName = this.currentToken().value;
            this.advance();
            if (this.currentToken().type !== TokenType.LPAREN) {
              // Property access, not method call
              value = getNestedValue(value ?? {}, methodName);
              continue;
            }
            this.advance(); // skip '('
            const methodArgs: any[] = [value]; // receiver is first arg
            if (this.currentToken().type !== TokenType.RPAREN) {
              const lambdaArg = this.tryParseLambda();
              if (lambdaArg) {
                methodArgs.push(lambdaArg);
              } else {
                methodArgs.push(this.parseExpression(true, true, false));
              }
              while (this.currentToken().type === TokenType.COMMA) {
                this.advance();
                const la = this.tryParseLambda();
                if (la) {
                  methodArgs.push(la);
                } else {
                  methodArgs.push(this.parseExpression(true, true, false));
                }
              }
            }
            if (this.currentToken().type !== TokenType.RPAREN) {
              throw new Error(`Expected ')' after method arguments`);
            }
            this.advance();
            const method = FUNCTIONS[methodName];
            if (!method) {
              throw new Error(`Unknown function: ${methodName}`);
            }
            value = method(...methodArgs);
          }

          outputQueue.push(value);
        }
        expectOperand = false;
      } else if (token.type === TokenType.OPERATOR) {
        let op = token.value;

        // Handle unary minus
        if (op === "-" && expectOperand) {
          op = "u-";
        }

        const opDef = OPERATORS[op];

        if (!opDef) {
          throw new Error(`Unknown operator: ${op}`);
        }

        // Pipe operator: special handling — evaluate left, apply right as function
        if (op === "|") {
          // Pop all remaining operators to evaluate the left side first
          while (operatorStack.length > 0) {
            const topToken = operatorStack[operatorStack.length - 1];
            if (topToken.type !== TokenType.OPERATOR) break;
            const topOp = OPERATORS[topToken.value];
            if (!topOp) break;
            if (topOp.precedence <= opDef.precedence) break;
            outputQueue.push(operatorStack.pop());
          }
          // Evaluate what's in the output queue so far
          const leftValue = this.evaluateRPN([...outputQueue]);
          outputQueue.length = 0;
          operatorStack.length = 0;

          // The right side should be a function name or function call
          this.advance(); // skip '|'
          const rightValue = this.parseExpression(true, true, false);

          // rightValue is the result of evaluating the right side
          // If leftValue is a function result and rightValue is also — apply right to left
          if (typeof rightValue === "function") {
            outputQueue.push(rightValue(leftValue));
          } else {
            // If right side evaluated to a non-function, treat pipe as apply-to-function
            // Try: rightValue is a function name that was looked up
            throw new Error(
              "Pipe operator expects a function on the right side",
            );
          }
          expectOperand = false;
          continue;
        }

        // Handle unary operators
        if (opDef.unary) {
          operatorStack.push({ ...token, value: op });
          this.advance();
          expectOperand = true;
          continue;
        }

        // Shunting Yard algorithm
        while (operatorStack.length > 0) {
          const topToken = operatorStack[operatorStack.length - 1];
          if (topToken.type !== TokenType.OPERATOR) break;

          const topOp = OPERATORS[topToken.value];
          if (!topOp) break;

          const shouldPop =
            (opDef.associativity === "left" &&
              opDef.precedence <= topOp.precedence) ||
            (opDef.associativity === "right" &&
              opDef.precedence < topOp.precedence);

          if (!shouldPop) break;

          outputQueue.push(operatorStack.pop());
        }

        operatorStack.push({ ...token, value: op });
        this.advance();
        expectOperand = true;
      } else if (token.type === TokenType.LPAREN) {
        operatorStack.push(token);
        this.advance();
        expectOperand = true;
      } else if (token.type === TokenType.RPAREN) {
        // Pop operators until we find the matching '('
        while (
          operatorStack.length > 0 &&
          operatorStack[operatorStack.length - 1].type !== TokenType.LPAREN
        ) {
          outputQueue.push(operatorStack.pop());
        }

        if (
          operatorStack.length === 0 ||
          operatorStack[operatorStack.length - 1].type !== TokenType.LPAREN
        ) {
          throw new Error("Mismatched parentheses");
        }

        operatorStack.pop(); // Remove '('
        this.advance();
        expectOperand = false;
      } else if (token.type === TokenType.LBRACKET) {
        // Array literal: [a, b, c]
        this.advance(); // skip '['
        const elements: any[] = [];
        if (this.currentToken().type !== TokenType.RBRACKET) {
          elements.push(this.parseExpression(true, false, true));
          while (this.currentToken().type === TokenType.COMMA) {
            this.advance();
            elements.push(this.parseExpression(true, false, true));
          }
        }
        if (this.currentToken().type !== TokenType.RBRACKET) {
          throw new Error(`Expected ']' after array elements`);
        }
        this.advance();
        outputQueue.push(elements);
        expectOperand = false;
      } else if (token.type === TokenType.RBRACKET) {
        break; // Stop — handled by caller
      } else if (token.type === TokenType.ARROW) {
        // Should not appear outside a lambda — if we're here, it's a syntax error
        throw new Error(
          `Unexpected '=>' — arrow operator must follow a parameter`,
        );
      } else {
        throw new Error(`Unexpected token: ${token.type}`);
      }
    }

    // Pop remaining operators
    while (operatorStack.length > 0) {
      const token = operatorStack.pop()!;
      if (token.type === TokenType.LPAREN || token.type === TokenType.RPAREN) {
        throw new Error("Mismatched parentheses");
      }
      outputQueue.push(token);
    }

    // Evaluate RPN (Reverse Polish Notation)
    return this.evaluateRPN(outputQueue);
  }

  private evaluateRPN(queue: any[]): any {
    const stack: any[] = [];

    for (const item of queue) {
      if (
        item &&
        typeof item === "object" &&
        item.type === TokenType.OPERATOR
      ) {
        const opDef = OPERATORS[item.value];

        if (opDef.unary) {
          if (stack.length < 1) {
            throw new Error(
              `Not enough operands for unary operator ${item.value}`,
            );
          }
          const operand = stack.pop();
          stack.push(opDef.fn(operand));
        } else {
          if (stack.length < 2) {
            throw new Error(`Not enough operands for operator ${item.value}`);
          }
          const right = stack.pop();
          const left = stack.pop();
          stack.push(opDef.fn(left, right));
        }
      } else {
        stack.push(item);
      }
    }

    if (stack.length !== 1) {
      throw new Error("Invalid expression");
    }

    return stack[0];
  }

  public parse(): any {
    return this.parseExpression();
  }
}

/**
 * Evaluate an expression with the given context
 */
export function evaluate(
  expression: string,
  context: Record<string, any> = {},
): any {
  const startTime = Date.now();
  try {
    const tokens = tokenizeCached(expression);
    const parser = new ExpressionParser(tokens, context);
    const result = parser.parse();
    if (traceEnabled) {
      expressionTraces.push({
        expression,
        result,
        context: { ...context },
        duration: Date.now() - startTime,
      });
    }
    return result;
  } catch (error) {
    Logger.error(
      "system",
      "expression",
      `Error evaluating expression: ${expression}`,
      error instanceof Error ? error.stack : String(error),
    );
    throw error;
  }
}

/**
 * 从上下文中获取嵌套属性值
 * 支持点号分隔的路径，如 "context.user.name"
 * 支持数组方法调用链
 */
export function getNestedValue(obj: Record<string, any>, path: string): any {
  const parts = path.split(".");
  let current: any = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // 支持数组索引，如 "items[0]"
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      current = current[arrayMatch[1]];
      if (Array.isArray(current)) {
        current = current[Number.parseInt(arrayMatch[2], 10)];
      } else {
        return undefined;
      }
    } else {
      current = current[part];
    }
  }

  return current;
}

/**
 * 求值条件表达式
 * Uses the new enhanced evaluator with backward compatibility
 */
export function evaluateCondition(
  expression: string,
  context: Record<string, any>,
): boolean {
  try {
    return Boolean(evaluate(expression, context));
  } catch (error) {
    Logger.error(
      "system",
      "expression",
      `Error evaluating expression: ${expression}`,
      error instanceof Error ? error.stack : String(error),
    );
    return false;
  }
}

/**
 * 验证表达式语法（不执行）
 */
export function validateExpression(expression: string): {
  valid: boolean;
  error?: string;
} {
  try {
    // Check for dangerous patterns first
    const dangerousPatterns = [
      /\beval\b/,
      /\bFunction\b/,
      /\bimport\b/,
      /\brequire\b/,
      /\bprocess\b/,
      /\bglobal\b/,
      /\bwindow\b/,
      /\bdocument\b/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(expression)) {
        return {
          valid: false,
          error: "Expression contains forbidden patterns",
        };
      }
    }

    // Try to tokenize and parse
    const tokens = tokenizeCached(expression);
    // Validate by parsing with empty context — will throw on syntax errors
    const parser = new ExpressionParser(tokens, {});
    parser.parse();

    return { valid: true };
  } catch (error) {
    // Arrow expressions (lambdas) reference params that don't exist in empty context —
    // that's expected, so treat "Unknown function" on a param name as valid syntax
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg.startsWith("Unknown function: ") && expression.includes("=>")) {
      return { valid: true };
    }
    return {
      valid: false,
      error: msg,
    };
  }
}

/**
 * 根据条件分支配置确定下一个节点
 */
export function resolveConditionalNext(
  conditionalNext: Array<{ condition: string; target: string }>,
  defaultNext: string | undefined,
  context: Record<string, any>,
): string | null {
  for (const branch of conditionalNext) {
    if (evaluateCondition(branch.condition, context)) {
      Logger.debug(
        "system",
        "expression",
        `Condition matched: ${branch.condition} -> ${branch.target}`,
      );
      return branch.target;
    }
  }

  if (defaultNext) {
    Logger.debug(
      "system",
      "expression",
      `Using default branch: ${defaultNext}`,
    );
    return defaultNext;
  }

  return null;
}

/**
 * 解析节点输出引用
 * 支持 ${nodeId.output} 或 ${nodeId.output.path.to.value}
 */
export function resolveNodeOutput(
  nodeId: string,
  path: string | undefined,
  state: { nodes?: Record<string, { output?: unknown }> } | undefined,
): unknown {
  if (!state?.nodes?.[nodeId]) {
    Logger.warn("system", "expression", `Node output not found: ${nodeId}`);
    return undefined;
  }

  const nodeState = state.nodes[nodeId];
  if (nodeState.output === undefined) {
    Logger.warn("system", "expression", `Node ${nodeId} has no output`);
    return undefined;
  }

  // 如果没有指定路径，返回整个输出
  if (!path) {
    return nodeState.output;
  }

  // 使用 getNestedValue 安全读取嵌套属性
  if (typeof nodeState.output === "object" && nodeState.output !== null) {
    return getNestedValue(nodeState.output as Record<string, any>, path);
  }

  Logger.warn(
    "system",
    "expression",
    `Cannot access path ${path} on non-object output of node ${nodeId}`,
  );
  return undefined;
}

/** 匹配 `${nodeId.output}` / `${nodeId.output.path}` */
const NODE_OUTPUT_PATTERN = /\$\{(\w+)\.output(?:\.([\w.]+))?\}/g;

/** 匹配普通上下文变量 `${variable}` / `${context.path}` */
const CONTEXT_PATTERN = /\$\{([\w.]+)\}/g;

/**
 * 替换字符串中的表达式占位符
 * 支持 ${variable}、${nodeId.output.path} 等
 *
 * 正则提到模块作用域：这两个函数在每个节点执行时都会被调用，
 * 没必要每次重建带 lastIndex 状态的 RegExp 对象。
 * （`String#replace` 会自行重置 lastIndex，因此共享 `g` 正则是安全的。）
 */
export function interpolateExpressions(
  template: string,
  context: Record<string, any>,
  state?: { nodes?: Record<string, { output?: unknown }> },
): string {
  // 先替换节点输出引用
  let result = template.replace(NODE_OUTPUT_PATTERN, (match, nodeId, path) => {
    const value = resolveNodeOutput(nodeId, path, state);
    return value !== undefined ? String(value) : match;
  });

  // 再替换普通上下文变量 ${variable} 或 ${context.path}
  result = result.replace(CONTEXT_PATTERN, (match, path) => {
    // 跳过已经处理过的 output 引用
    if (path.includes(".output")) {
      return match;
    }
    const value = getNestedValue(context, path);
    return value !== undefined ? String(value) : match;
  });

  return result;
}

/** `interpolateObject` 的最大递归深度。 */
export const MAX_INTERPOLATION_DEPTH = 100;

/**
 * 插值深度超限或检测到循环引用时抛出。
 *
 * 用具名错误类而非裸 Error，便于调用方 `instanceof` 判断，
 * 与 WorkflowNotFoundError 等既有错误类保持一致。
 */
export class InterpolationDepthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterpolationDepthError";
  }
}

/**
 * 解析对象中的所有表达式
 * 递归处理对象和数组
 *
 * 递归带深度上限与循环引用检测：自引用对象（例如 HTTP 节点的响应被回灌进
 * context）此前会导致栈溢出——那是不可捕获的、直接终止进程的失败，而不是
 * 一个能被节点错误处理接住的异常。
 */
export function interpolateObject<T>(
  obj: T,
  context: Record<string, any>,
  state?: { nodes?: Record<string, { output?: unknown }> },
): T {
  return interpolateObjectInternal(obj, context, state, 0, new WeakSet());
}

function interpolateObjectInternal<T>(
  obj: T,
  context: Record<string, any>,
  state: { nodes?: Record<string, { output?: unknown }> } | undefined,
  depth: number,
  seen: WeakSet<object>,
): T {
  if (typeof obj === "string") {
    return interpolateExpressions(obj, context, state) as T;
  }

  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (depth >= MAX_INTERPOLATION_DEPTH) {
    throw new InterpolationDepthError(
      `Interpolation exceeded maximum depth of ${MAX_INTERPOLATION_DEPTH}; ` +
        "the value is nested too deeply or contains a cycle",
    );
  }

  if (seen.has(obj as object)) {
    throw new InterpolationDepthError(
      "Interpolation encountered a circular reference",
    );
  }
  seen.add(obj as object);

  try {
    if (Array.isArray(obj)) {
      return obj.map((item) =>
        interpolateObjectInternal(item, context, state, depth + 1, seen),
      ) as T;
    }

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateObjectInternal(
        value,
        context,
        state,
        depth + 1,
        seen,
      );
    }
    return result as T;
  } finally {
    // 出栈时移除：同一个对象在树中多处出现（DAG 形状）是合法的，
    // 只有真正的环才应当报错。
    seen.delete(obj as object);
  }
}
