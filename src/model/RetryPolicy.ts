export interface RetryPolicy {
  initialInterval?: number;
  backoffCoefficient?: number;
  maximumInterval?: number;
  maximumAttempts?: number;
  nonRetryableErrors?: string[];
}

export const DEFAULT_RETRY_POLICY: Required<RetryPolicy> = {
  initialInterval: 1000,
  backoffCoefficient: 2.0,
  maximumInterval: 100000,
  maximumAttempts: 0,
  nonRetryableErrors: [],
};

export function calculateRetryDelay(
  attempt: number,
  policy: RetryPolicy,
): number {
  const initialInterval =
    policy.initialInterval ?? DEFAULT_RETRY_POLICY.initialInterval;
  const backoffCoefficient =
    policy.backoffCoefficient ?? DEFAULT_RETRY_POLICY.backoffCoefficient;
  const maximumInterval =
    policy.maximumInterval ?? DEFAULT_RETRY_POLICY.maximumInterval;

  const delay = initialInterval * backoffCoefficient ** attempt;
  return Math.min(delay, maximumInterval);
}

export function isRetryableError(error: Error, policy: RetryPolicy): boolean {
  const nonRetryableErrors = policy.nonRetryableErrors ?? [];
  if (nonRetryableErrors.length === 0) {
    return true;
  }
  const errorType = error.constructor.name;
  return !nonRetryableErrors.some(
    (nonRetryable) =>
      errorType === nonRetryable || error.message.includes(nonRetryable),
  );
}

export function shouldRetry(attempt: number, policy: RetryPolicy): boolean {
  const maximumAttempts =
    policy.maximumAttempts ?? DEFAULT_RETRY_POLICY.maximumAttempts;
  if (maximumAttempts === 0) {
    return true;
  }
  return attempt < maximumAttempts;
}
