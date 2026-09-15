import type { WorkflowInstance } from "../../model/Instance";
import { Logger } from "../../utils/Logger";

/**
 * Join node configuration
 *
 * The engine executes a fan-out batch (nodes listed together in a `next`
 * array) sequentially within the same tick before advancing to the next
 * batch (see ExecutionOrchestrator.execute — nodeBatch is processed with a
 * `for...of` + `await` loop and merged into one deduped `nextNodes` batch).
 * That means every node in `waitFor` is guaranteed to have already written
 * its output to `instance.state.nodes` by the time a join node listed as
 * their common `next` target runs — there is no cross-branch race to
 * arbitrate and no CAS/locking is needed for a single-process engine.
 *
 * `mode: "all"` (default) requires every id in `waitFor` to have completed.
 * `mode: "any"` proceeds as soon as at least one has completed.
 */
export interface JoinNodeConfig {
  /** Node IDs whose outputs this join waits for. */
  waitFor: string[];
  /** "all" (default): every waitFor node must have output. "any": at least one. */
  mode?: "all" | "any";
}

/**
 * Join node output: the outputs of all resolved `waitFor` nodes, keyed by
 * node id, plus which ones were missing (only possible in "any" mode, or
 * when a branch was skipped by upstream routing).
 */
export interface JoinNodeOutput {
  /** nodeId -> output, for every waitFor node that had completed. */
  results: Record<string, unknown>;
  /** waitFor node ids that had no recorded output at join time. */
  missing: string[];
}

/**
 * Execute a join node: gather outputs from `config.waitFor` node ids.
 *
 * Throws if `mode` is "all" (the default) and any listed node has not
 * produced output yet — this indicates a workflow definition where the join
 * was reached without all of its declared predecessors running (e.g. it was
 * wired into a `next` fan-out that doesn't actually include every branch).
 */
export async function execute(
  config: JoinNodeConfig,
  instance: WorkflowInstance,
): Promise<JoinNodeOutput> {
  if (
    !config?.waitFor ||
    !Array.isArray(config.waitFor) ||
    config.waitFor.length === 0
  ) {
    throw new Error("Join node requires a non-empty config.waitFor array");
  }

  const mode = config.mode ?? "all";
  const nodes = instance.state?.nodes ?? {};

  const results: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const nodeId of config.waitFor) {
    const nodeState = nodes[nodeId];
    if (nodeState && nodeState.output !== undefined) {
      results[nodeId] = nodeState.output;
    } else {
      missing.push(nodeId);
    }
  }

  if (mode === "all" && missing.length > 0) {
    const message = `Join node is missing output from: ${missing.join(", ")} (waitFor=[${config.waitFor.join(", ")}])`;
    Logger.error(instance.instanceId, "join-node", message);
    throw new Error(message);
  }

  if (mode === "any" && Object.keys(results).length === 0) {
    const message = `Join node (mode=any) found no completed branches among: ${config.waitFor.join(", ")}`;
    Logger.error(instance.instanceId, "join-node", message);
    throw new Error(message);
  }

  Logger.log(
    instance.instanceId,
    "join-node",
    `Join resolved (mode=${mode}): ${Object.keys(results).length}/${config.waitFor.length} branches`,
    { resolved: Object.keys(results), missing },
  );

  return { results, missing };
}

export const JoinNodeExecutor = {
  execute,
};
