/**
 * change-note:v1 (spec §4.11, §3.4 "Change notes on cards"; A35-16..18,
 * S35-11, P8-D86–D88). Reserved in M1.1 so `clientApiId` does not move in
 * Move 2 (M2.11 uses it).
 *
 * Two parts, kept structurally apart (B16: agent claims are never authority):
 *   - `agentClaims` — what the agent says it tested, the risk it claims, and
 *     how it says to revert. UNTRUSTED: sanitized under §4.5 by the kernel,
 *     rendered below the kernel-owned region as `agent-claimed`, never
 *     executed (`revert.steps`), never offered as a control.
 *   - `kernel` — computed by the kernel only: `verified{n, of}` from cited
 *     kernel-signed `oracle.result` ids, the risk floor and effective tier,
 *     and the kernel's own revert action computed from refs.
 *
 * Forms: on `contract.claim{op:'built', note}` the agent sends `agentClaims`
 * ONLY (form `claim`: a `kernel` part is refused); on a card, `contract.built`
 * and `brief:v1` the note carries both (form `card`). The form is REQUIRED on
 * every call: there is no default, so a caller cannot validate an agent's
 * note under the kernel's (looser-to-satisfy) shape by omission.
 *
 * Enumerations (risk tier, revert how) are ADDITIVE with FAIL-SAFE semantics
 * (orchestrator ruling, round 2): a client renders an unknown value but reads
 * it as the strictest known one — unknown tier ⇒ `high`, unknown agent revert
 * how ⇒ `manual`, unknown kernel revert how ⇒ `none` (no kernel-offered
 * action; `manual` is not a kernel value) — and a card carrying one is not
 * decidable (card.ts `hasUnknownFailSafeValue`).
 */

import { Checker, utf8, type ValidateOptions } from './internal.js';
import { ANY_PRINCIPAL_PATTERN } from './principal.js';
import { parseRef, validateRefV1 } from './ref.js';

export const CHANGE_NOTE_V1 = 'change-note:v1' as const;

export const RISK_TIERS = ['low', 'medium', 'high'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];
export const AGENT_REVERT_HOWS = ['auto', 'command', 'manual'] as const;
export const KERNEL_REVERT_HOWS = ['auto', 'none'] as const;

/* fail-safe readings of additive values (strictest known value) */
export function failSafeRiskTier(t: unknown): RiskTier {
  return (RISK_TIERS as readonly unknown[]).includes(t) ? (t as RiskTier) : 'high';
}
export function failSafeAgentRevertHow(h: unknown): (typeof AGENT_REVERT_HOWS)[number] {
  return (AGENT_REVERT_HOWS as readonly unknown[]).includes(h) ? (h as (typeof AGENT_REVERT_HOWS)[number]) : 'manual';
}
export function failSafeKernelRevertHow(h: unknown): (typeof KERNEL_REVERT_HOWS)[number] {
  return (KERNEL_REVERT_HOWS as readonly unknown[]).includes(h) ? (h as (typeof KERNEL_REVERT_HOWS)[number]) : 'none';
}
const known = (list: readonly string[], v: unknown) => v === undefined || (typeof v === 'string' && list.includes(v));
/** True if the note carries a tier or revert how this release does not know (⇒ its card is not decidable). */
export function changeNoteHasUnknownValue(note: unknown): boolean {
  if (!note || typeof note !== 'object') return false;
  const n = note as { agentClaims?: any; kernel?: any };
  return !(
    known(RISK_TIERS, n.agentClaims?.risk?.tier) &&
    known(AGENT_REVERT_HOWS, n.agentClaims?.revert?.how) &&
    known(RISK_TIERS, n.kernel?.risk?.floor) &&
    known(RISK_TIERS, n.kernel?.risk?.effective) &&
    known(KERNEL_REVERT_HOWS, n.kernel?.revert?.how)
  );
}

/** UTF-8 byte caps (§4.11). */
export const CHANGE_NOTE_LIMITS = Object.freeze({ summaryBytes: 1024, whyBytes: 512, stepsBytes: 1024 });

export interface ChangeNoteAgentClaims {
  testedHow: { summary: string; refs: string[] };
  risk: { tier: RiskTier; why: string; blast: string[] };
  revert: { how: (typeof AGENT_REVERT_HOWS)[number]; steps: string; reversible: boolean };
  draftedBy: string;
}

export interface ChangeNoteKernel {
  verified: { n: number; of: number };
  risk: { floor: RiskTier; effective: RiskTier; reasons: string[] };
  revert: { how: (typeof KERNEL_REVERT_HOWS)[number]; ref?: string };
}

export interface ChangeNoteV1 {
  agentClaims: ChangeNoteAgentClaims;
  /** absent on the agent's `contract.claim` param; always present once the kernel has seen it. */
  kernel?: ChangeNoteKernel;
}

export const CHANGE_NOTE_V1_KEYS = ['agentClaims', 'kernel'] as const;
export const CHANGE_NOTE_AGENT_KEYS = ['testedHow', 'risk', 'revert', 'draftedBy'] as const;
export const CHANGE_NOTE_KERNEL_KEYS = ['verified', 'risk', 'revert'] as const;

export type ChangeNoteForm = 'claim' | 'card';

const tierRank = (t: unknown): number => (RISK_TIERS as readonly unknown[]).indexOf(t);

function capped(c: Checker, path: string, v: unknown, max: number): void {
  if (c.str(path, v) && utf8(v).length > max) c.fail(path, `at most ${max} UTF-8 bytes`);
}

export function validateChangeNoteV1(
  value: unknown,
  opts: ValidateOptions & { form: ChangeNoteForm },
): string[] {
  const c = new Checker(opts.mode ?? 'strict');
  const form = opts.form;
  if (form !== 'claim' && form !== 'card') {
    c.fail('', "form must be 'claim' or 'card'");
    return c.errors;
  }
  if (!c.obj('', value)) return c.errors;
  const v = value;
  c.closed('', v, CHANGE_NOTE_V1_KEYS);
  c.required('', v, form === 'card' ? CHANGE_NOTE_V1_KEYS : ['agentClaims']);
  // The agent never writes the kernel's part — in either validation mode.
  if (form === 'claim' && 'kernel' in v) c.fail('kernel', 'computed by the kernel; never sent by the agent (B16)');

  if ('agentClaims' in v && c.obj('agentClaims', v.agentClaims)) {
    const a = v.agentClaims;
    c.closed('agentClaims', a, CHANGE_NOTE_AGENT_KEYS);
    c.required('agentClaims', a, CHANGE_NOTE_AGENT_KEYS);
    if ('testedHow' in a && c.obj('agentClaims.testedHow', a.testedHow)) {
      const t = a.testedHow;
      c.closed('agentClaims.testedHow', t, ['summary', 'refs']);
      c.required('agentClaims.testedHow', t, ['summary', 'refs']);
      if ('summary' in t) capped(c, 'agentClaims.testedHow.summary', t.summary, CHANGE_NOTE_LIMITS.summaryBytes);
      if ('refs' in t && c.arr('agentClaims.testedHow.refs', t.refs)) {
        t.refs.forEach((r, i) => {
          for (const e of validateRefV1(r, { mode: c.mode })) c.fail(`agentClaims.testedHow.refs[${i}]`, e);
        });
      }
    }
    if ('risk' in a && c.obj('agentClaims.risk', a.risk)) {
      const r = a.risk;
      c.closed('agentClaims.risk', r, ['tier', 'why', 'blast']);
      c.required('agentClaims.risk', r, ['tier', 'why', 'blast']);
      if ('tier' in r) c.additiveEnum('agentClaims.risk.tier', r.tier, RISK_TIERS);
      if ('why' in r) capped(c, 'agentClaims.risk.why', r.why, CHANGE_NOTE_LIMITS.whyBytes);
      if ('blast' in r && c.arr('agentClaims.risk.blast', r.blast)) {
        r.blast.forEach((s, i) => {
          if (c.str(`agentClaims.risk.blast[${i}]`, s) && parseRef(s)?.scheme !== 'sym') {
            c.fail(`agentClaims.risk.blast[${i}]`, 'must be a sym: ref');
          }
        });
      }
    }
    if ('revert' in a && c.obj('agentClaims.revert', a.revert)) {
      const r = a.revert;
      c.closed('agentClaims.revert', r, ['how', 'steps', 'reversible']);
      c.required('agentClaims.revert', r, ['how', 'steps', 'reversible']);
      if ('how' in r) c.additiveEnum('agentClaims.revert.how', r.how, AGENT_REVERT_HOWS);
      if ('steps' in r) capped(c, 'agentClaims.revert.steps', r.steps, CHANGE_NOTE_LIMITS.stepsBytes);
      if ('reversible' in r) c.bool('agentClaims.revert.reversible', r.reversible);
    }
    if ('draftedBy' in a) c.str('agentClaims.draftedBy', a.draftedBy, ANY_PRINCIPAL_PATTERN, 'a principalId');
  }

  if (form === 'card' && 'kernel' in v && c.obj('kernel', v.kernel)) {
    const k = v.kernel;
    c.closed('kernel', k, CHANGE_NOTE_KERNEL_KEYS);
    c.required('kernel', k, CHANGE_NOTE_KERNEL_KEYS);
    if ('verified' in k && c.obj('kernel.verified', k.verified)) {
      const q = k.verified;
      c.closed('kernel.verified', q, ['n', 'of']);
      c.required('kernel.verified', q, ['n', 'of']);
      if ('n' in q) c.int('kernel.verified.n', q.n, 0);
      if ('of' in q) c.int('kernel.verified.of', q.of, 0);
      if (typeof q.n === 'number' && typeof q.of === 'number' && q.n > q.of) c.fail('kernel.verified', 'n must be <= of');
    }
    if ('risk' in k && c.obj('kernel.risk', k.risk)) {
      const r = k.risk;
      c.closed('kernel.risk', r, ['floor', 'effective', 'reasons']);
      c.required('kernel.risk', r, ['floor', 'effective', 'reasons']);
      if ('floor' in r) c.additiveEnum('kernel.risk.floor', r.floor, RISK_TIERS);
      if ('effective' in r) c.additiveEnum('kernel.risk.effective', r.effective, RISK_TIERS);
      if ('reasons' in r && c.arr('kernel.risk.reasons', r.reasons)) r.reasons.forEach((s, i) => c.str(`kernel.risk.reasons[${i}]`, s));
      // effective = max(agent tier, floor) (§3.4): an agent can raise its tier, never lower it.
      // Strict (producer): EXACTLY the max. Tolerant (client): at least each of them.
      const agentTier = (v.agentClaims as { risk?: { tier?: unknown } } | undefined)?.risk?.tier;
      const e = tierRank(r.effective);
      const f = tierRank(r.floor);
      const a = tierRank(agentTier);
      if (c.mode === 'strict' && e >= 0 && f >= 0 && a >= 0) {
        if (e !== Math.max(f, a)) c.fail('kernel.risk.effective', "must equal max(kernel floor, agent's claimed tier)");
      } else {
        if (e >= 0 && f >= 0 && e < f) c.fail('kernel.risk.effective', 'must be >= the kernel floor');
        if (e >= 0 && a >= 0 && e < a) c.fail('kernel.risk.effective', "must be >= the agent's claimed tier");
      }
    }
    if ('revert' in k && c.obj('kernel.revert', k.revert)) {
      const r = k.revert;
      c.closed('kernel.revert', r, ['how', 'ref']);
      c.required('kernel.revert', r, ['how']);
      if ('how' in r) c.additiveEnum('kernel.revert.how', r.how, KERNEL_REVERT_HOWS);
      if ('ref' in r) for (const e of validateRefV1(r.ref, { mode: c.mode })) c.fail('kernel.revert.ref', e);
    }
  }
  return c.errors;
}

export function isChangeNoteV1(value: unknown, opts: ValidateOptions & { form: ChangeNoteForm }): value is ChangeNoteV1 {
  return validateChangeNoteV1(value, opts).length === 0;
}
