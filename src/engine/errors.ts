/**
 * Named error classes for the most common engine-level failure modes.
 *
 * These exist so external callers can `instanceof`-check specific failure
 * conditions (missing workflow, missing instance, CAS/lock conflicts)
 * instead of pattern-matching `Error.message` strings, which are not a
 * stable contract across versions.
 *
 * Less common failures (timeouts, abort, max-instances limit, invalid
 * state transitions) still throw plain `Error` — only the high-frequency
 * lookup/concurrency failures listed in CLAUDE.md are covered here.
 */

/** Thrown when a workflow definition (optionally at a specific version) cannot be found in the registry. */
export class WorkflowNotFoundError extends Error {
  readonly workflowId: string;
  readonly version?: string;

  constructor(workflowId: string, version?: string) {
    super(
      `Workflow ${workflowId}${version ? ` version ${version}` : ""} not found`,
    );
    this.name = "WorkflowNotFoundError";
    this.workflowId = workflowId;
    this.version = version;
  }
}

/** Thrown when a workflow instance id does not resolve to a stored instance. */
export class InstanceNotFoundError extends Error {
  readonly instanceId: string;

  constructor(instanceId: string) {
    super(`Workflow instance ${instanceId} not found`);
    this.name = "InstanceNotFoundError";
    this.instanceId = instanceId;
  }
}

/**
 * Thrown when optimistic concurrency control (CAS) fails to persist an
 * instance update after exhausting its retry budget — i.e. another writer
 * kept winning the race on `instance.version`.
 */
export class ConcurrencyConflictError extends Error {
  readonly instanceId: string;
  readonly attempts: number;

  constructor(instanceId: string, attempts: number) {
    super(
      `Failed to persist instance ${instanceId} after ${attempts} CAS retries (concurrent modification)`,
    );
    this.name = "ConcurrencyConflictError";
    this.instanceId = instanceId;
    this.attempts = attempts;
  }
}

/** Thrown when a distributed/in-process lock could not be acquired within the configured retry budget. */
export class LockAcquisitionError extends Error {
  readonly resourceId: string;

  constructor(resourceId: string) {
    super(`Failed to acquire lock for resource: ${resourceId}`);
    this.name = "LockAcquisitionError";
    this.resourceId = resourceId;
  }
}
