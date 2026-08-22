/**
 * Single source of truth for "is authentication enabled?".
 *
 * Used by:
 *   - auth.ts  (JWT / API-key middleware)
 *   - rbac.ts  (RBAC middleware)
 *   - TenantMiddleware.ts  (tenant resolution)
 *
 * Logic:
 *   1. If AUTH_ENABLED is explicitly set, honour it.
 *   2. Otherwise, production (NODE_ENV=production) defaults to enabled (fail-closed).
 *   3. Non-production defaults to disabled (fail-open for DX).
 */

let _cached: boolean | null = null;
let _cachedAuth: string | undefined;
let _cachedNodeEnv: string | undefined;

export function isAuthEnabled(): boolean {
  const auth = process.env.AUTH_ENABLED;
  const nodeEnv = process.env.NODE_ENV;

  // Bust cache when either env var changes (unit tests mutate env between cases)
  if (_cached !== null && _cachedAuth === auth && _cachedNodeEnv === nodeEnv) {
    return _cached;
  }

  if (auth !== undefined) {
    _cached = auth === "true";
  } else {
    _cached = nodeEnv === "production";
  }

  _cachedAuth = auth;
  _cachedNodeEnv = nodeEnv;
  return _cached;
}

/**
 * Reset cached value (for testing only).
 */
export function resetAuthEnabledCache(): void {
  _cached = null;
  _cachedAuth = undefined;
  _cachedNodeEnv = undefined;
}
