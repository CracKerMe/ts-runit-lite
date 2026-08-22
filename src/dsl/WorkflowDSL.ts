export interface DSLWorkflow {
  id: string;
  name: string;
  version?: string;
  description?: string;
  nodes: DSLNode[];
  startNode: string;
  triggers?: DSLTrigger[];
}

export interface DSLNode {
  id: string;
  type: string;
  config?: Record<string, unknown>;
  next?: string[];
  failureNext?: string[];
  conditionalNext?: DSLConditionalBranch[];
  defaultNext?: string;
  retryPolicy?: DSLRetryPolicy;
}

export interface DSLConditionalBranch {
  condition: string;
  target: string;
}

export interface DSLRetryPolicy {
  maxRetries?: number;
  backoffMs?: number;
  backoffMultiplier?: number;
  maximumAttempts?: number;
  initialInterval?: number;
  backoffCoefficient?: number;
  maximumInterval?: number;
  nonRetryableErrors?: string[];
}

export interface DSLTrigger {
  type: "event" | "cron" | "signal";
  config: Record<string, unknown>;
}

export type DSLValue =
  | string
  | number
  | boolean
  | null
  | DSLValue[]
  | { [key: string]: DSLValue };
