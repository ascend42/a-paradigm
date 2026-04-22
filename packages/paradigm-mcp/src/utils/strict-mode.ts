/**
 * strict-mode — shared helpers for the PARADIGM_STRICT=1 opt-in flag.
 *
 * v5.38.0 behavior (flag OFF by default):
 *   - safeLoad treats ALL `errorClass` as fatal (including `other`).
 *   - Any lossy transformation in the consistency manifest causes the indexer
 *     to ERROR not warn.
 *   - writeAndConfirm's verify-callback failure is a hard failure with no
 *     degraded-write fallback.
 *   - Duplicate YAML keys → error not warning (always was; here for parity).
 *
 * v5.39.0 plan: flip default to ON after a field-observation window.
 */

export const PARADIGM_STRICT_ENV = 'PARADIGM_STRICT';
export const STRICT_DEFAULT = false;

/**
 * Check whether strict mode is enabled via environment variable.
 *
 * Accepts `1`, `true`, `TRUE`, `yes`, `on` as truthy. Any other value
 * (including `0`, `false`, empty string) falls back to the default.
 */
export function isStrictMode(): boolean {
  const v = process.env[PARADIGM_STRICT_ENV];
  if (v === undefined || v === '') return STRICT_DEFAULT;
  const lower = v.toLowerCase();
  if (lower === '1' || lower === 'true' || lower === 'yes' || lower === 'on') return true;
  return STRICT_DEFAULT;
}
