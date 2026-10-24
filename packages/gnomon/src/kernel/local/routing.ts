/**
 * @symbol #local-runner
 * @symbol #supervisor
 *
 * Routing by declared model (spec §13.3, §6.1 step 2; D21): `local` ⇒ a
 * capable local model or a `fallback` card (MODEL_UNAVAILABLE; never an
 * automatic fall back); `claude` ⇒ Claude under law 7; `any` ⇒ local if
 * capable, else Claude, logged `session.routed{declared, chosen, reason}`.
 * Capable = the probe reached the endpoint, tools are on (live-detected, or
 * the model is configured for the text-tool fallback) and n_ctx ≥ the task
 * floor. An unknown n_ctx is NOT capable (fail closed). Routing never
 * considers Claude Code against a local endpoint (D37).
 */
import type { LocalCapabilities } from './probe.js';

export type DeclaredModel = 'local' | 'claude' | 'any';
export type RouteReason = 'capable' | 'declared-claude' | 'no-endpoint' | 'no-runner' | 'probe-failed' | 'no-tools' | 'ctx-unknown' | 'ctx-below-floor';

export interface Route {
  chosen: 'local' | 'claude' | 'fallback';
  reason: RouteReason;
  /** which tool path a capable local session uses */
  tools?: 'native' | 'text';
}

export function capability(caps: LocalCapabilities | null, floor: number, textTools: boolean): { capable: boolean; reason: RouteReason; tools?: 'native' | 'text' } {
  if (!caps) return { capable: false, reason: 'no-endpoint' };
  if (!caps.ok) return { capable: false, reason: 'probe-failed' };
  if (!caps.tools && !textTools) return { capable: false, reason: 'no-tools' };
  if (caps.nCtx === null) return { capable: false, reason: 'ctx-unknown' };
  if (caps.nCtx < floor) return { capable: false, reason: 'ctx-below-floor' };
  return { capable: true, reason: 'capable', tools: caps.tools ? 'native' : 'text' };
}

export function routeModel(declared: DeclaredModel, cap: { capable: boolean; reason: RouteReason; tools?: 'native' | 'text' }, runnerPresent: boolean): Route {
  if (declared === 'claude') return { chosen: 'claude', reason: 'declared-claude' };
  const ok = cap.capable && runnerPresent;
  const reason: RouteReason = cap.capable && !runnerPresent ? 'no-runner' : cap.reason;
  if (ok) return { chosen: 'local', reason, ...(cap.tools ? { tools: cap.tools } : {}) };
  return declared === 'any' ? { chosen: 'claude', reason } : { chosen: 'fallback', reason };
}
