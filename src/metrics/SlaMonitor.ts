// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import { EventEmitter } from "node:events";
import { Logger } from "../utils/Logger";

/**
 * SLA metric types
 */
export type SlaMetric = "completion_time" | "error_rate" | "cost_per_run";

/**
 * Comparison operators for SLA rules
 */
export type SlaOperator = "lt" | "gt" | "eq" | "lte" | "gte";

/**
 * SLA rule definition
 */
export interface SlaRule {
  id: string;
  workflowId: string;
  metric: SlaMetric;
  threshold: number;
  operator: SlaOperator;
  windowMs: number;
  alertChannel?: string;
  description?: string;
}

/**
 * SLA violation record
 */
export interface SlaViolation {
  ruleId: string;
  workflowId: string;
  instanceId?: string;
  metric: SlaMetric;
  threshold: number;
  actualValue: number;
  detectedAt: number;
  description: string;
}

/**
 * SLA status for a workflow
 */
export interface SlaStatus {
  workflowId: string;
  rules: SlaRule[];
  violations: SlaViolation[];
  lastChecked: number;
  isHealthy: boolean;
}

/**
 * SLA Monitor tracks workflow execution against defined service level agreements.
 * Emits 'violation' events when SLA rules are breached.
 */
export class SlaMonitor extends EventEmitter {
  private rules: Map<string, SlaRule> = new Map();
  private violations: SlaViolation[] = [];
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Start periodic SLA checking
   */
  start(_instanceProvider: () => Promise<any[]>): void {
    // Check every minute
    this.checkInterval = setInterval(() => {
      this.evaluate().catch((err) => {
        Logger.error(
          "system",
          "sla-monitor",
          "SLA check failed",
          err instanceof Error ? err.message : String(err),
        );
      });
    }, 60000);

    Logger.info("system", "sla-monitor", "SLA monitor started");
  }

  /**
   * Stop periodic checking
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    Logger.info("system", "sla-monitor", "SLA monitor stopped");
  }

  /**
   * Add an SLA rule
   */
  addRule(rule: SlaRule): void {
    this.rules.set(rule.id, rule);
    Logger.info("system", "sla-monitor", "SLA rule added", {
      ruleId: rule.id,
      workflowId: rule.workflowId,
      metric: rule.metric,
    });
  }

  /**
   * Remove an SLA rule
   */
  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
    Logger.info("system", "sla-monitor", "SLA rule removed", { ruleId });
  }

  /**
   * Get all rules for a workflow
   */
  getRules(workflowId?: string): SlaRule[] {
    const allRules = Array.from(this.rules.values());
    if (workflowId) {
      return allRules.filter((r) => r.workflowId === workflowId);
    }
    return allRules;
  }

  /**
   * Evaluate all SLA rules
   */
  async evaluate(): Promise<SlaViolation[]> {
    const violations: SlaViolation[] = [];

    for (const rule of this.rules.values()) {
      try {
        const violation = await this.evaluateRule(rule);
        if (violation) {
          violations.push(violation);
          this.violations.push(violation);
          this.emit("violation", violation);
        }
      } catch (err: unknown) {
        Logger.error(
          "system",
          "sla-monitor",
          `Failed to evaluate rule ${rule.id}`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return violations;
  }

  /**
   * Evaluate a single SLA rule
   */
  private async evaluateRule(rule: SlaRule): Promise<SlaViolation | null> {
    // Get current metric value
    const actualValue = await this.getMetricValue(rule);

    if (actualValue === null) {
      return null;
    }

    // Check if SLA is violated
    const violated = this.checkThreshold(
      actualValue,
      rule.operator,
      rule.threshold,
    );

    if (violated) {
      const violation: SlaViolation = {
        ruleId: rule.id,
        workflowId: rule.workflowId,
        metric: rule.metric,
        threshold: rule.threshold,
        actualValue,
        detectedAt: Date.now(),
        description:
          rule.description ||
          `SLA violation: ${rule.metric} ${rule.operator} ${rule.threshold} (actual: ${actualValue})`,
      };

      Logger.warn("system", "sla-monitor", "SLA violation detected", {
        ruleId: rule.id,
        metric: rule.metric,
        threshold: rule.threshold,
        actualValue,
      });

      return violation;
    }

    return null;
  }

  /**
   * Get current metric value for a rule
   */
  private async getMetricValue(_rule: SlaRule): Promise<number | null> {
    // This is a simplified implementation
    // In production, this would query actual metrics from storage
    return null;
  }

  /**
   * Check if a value violates the threshold
   */
  private checkThreshold(
    value: number,
    operator: SlaOperator,
    threshold: number,
  ): boolean {
    switch (operator) {
      case "lt":
        return value >= threshold;
      case "gt":
        return value <= threshold;
      case "eq":
        return value !== threshold;
      case "lte":
        return value > threshold;
      case "gte":
        return value < threshold;
      default:
        return false;
    }
  }

  /**
   * Get SLA status for a workflow
   */
  getStatus(workflowId: string): SlaStatus {
    const rules = this.getRules(workflowId);
    const violations = this.violations.filter(
      (v) => v.workflowId === workflowId,
    );

    // Check if there are any recent violations (last hour)
    const recentViolations = violations.filter(
      (v) => v.detectedAt > Date.now() - 60 * 60 * 1000,
    );

    return {
      workflowId,
      rules,
      violations: recentViolations,
      lastChecked: Date.now(),
      isHealthy: recentViolations.length === 0,
    };
  }

  /**
   * Get all violations
   */
  getViolations(workflowId?: string): SlaViolation[] {
    if (workflowId) {
      return this.violations.filter((v) => v.workflowId === workflowId);
    }
    return [...this.violations];
  }

  /**
   * Clear old violations
   */
  clearOldViolations(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    this.violations = this.violations.filter((v) => v.detectedAt > cutoff);
  }
}

// Singleton instance
export const slaMonitor = new SlaMonitor();
