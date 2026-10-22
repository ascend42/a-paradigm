/**
 * @symbol #approval-broker
 *
 * #approval-broker decision classes (spec §3.4 "Decision classes", D38,
 * S25-C2, P8-D86–D88). Pure data + one function: which decisions a card kind
 * takes, and the BASE presence class of each (kind, decision) pair.
 *
 *   fresh   fresh presence (the helper's prompt) for this one decision
 *   cached  the per-connection cached unlock may carry it (§3.1 approvals key)
 *   root    fresh presence AND the root key (install, use-api-token, peer-pair)
 *   none    no presence (`withdraw` on a held card, §14.7)
 *
 * Readings where the spec is silent (reported): a decision the spec does not
 * class explicitly takes `fresh` (the stricter class; fail closed); kinds
 * whose cards are raised only by later milestones (voice-arm, voice-share,
 * grant: Move 4; handoff, declassify, peer-pair: Move 2) are classed but the
 * broker raises none of them in M1.6. Strictness (base ⊓ level) is M2.10.
 */
import type { CardDecision, CardFlag, CardKind } from '@a-company/gnomon-contracts';

export type DecisionClass = 'fresh' | 'cached' | 'root' | 'none';

/** Valid decisions per kind with their base class. */
export const KIND_DECISIONS: Readonly<Record<CardKind, Readonly<Partial<Record<CardDecision, DecisionClass>>>>> = Object.freeze({
  permission: { allow: 'cached', deny: 'cached', always: 'fresh' },
  budget: { resume: 'fresh', deny: 'fresh' },
  knot: { resolve: 'fresh', deny: 'fresh' },
  tend: { accept: 'fresh', reject: 'fresh' },
  verdict: { accept: 'fresh', reject: 'fresh' },
  'merge-conflict': { resolve: 'fresh', deny: 'fresh' },
  'gate-class': { allow: 'fresh', deny: 'fresh' },
  install: { install: 'root', deny: 'fresh' },
  fallback: { 'fallback-cloud': 'fresh', deny: 'fresh' },
  'ask-user': { answer: 'cached' },
  plan: { 'approve-plan': 'cached', reject: 'cached' },
  'api-token': { 'use-api-token': 'root', deny: 'fresh' },
  'voice-share': { allow: 'fresh', deny: 'fresh' },
  'voice-arm': { allow: 'fresh', deny: 'fresh' },
  grant: { allow: 'root', deny: 'fresh' },
  handoff: { accept: 'fresh', reject: 'cached' },
  declassify: { accept: 'fresh', reject: 'fresh' },
  'peer-pair': { accept: 'root', reject: 'fresh' },
  reconsider: { extend: 'fresh', restart: 'fresh', reject: 'cached' },
  // TD-2026-10-19-298 (Aegis V2a L2): a `strictness` card is raised for detail.op 'mode.loosen' (run-mode.ts) AND
  // 'voice.widen' (#gnomon-voice); a consumer that reads strictness cards must branch on detail.op — voice.widen is
  // not a strictness or run-mode change
  // TD-2026-10-20-514 (Aegis Q3): a voice.enrol strictness card raises allow to ROOT via RaiseInput.rootDecisions
  // (its effect uses the root key: never standing, never by voice); mode.loosen / voice.widen stay fresh
  strictness: { allow: 'fresh', deny: 'cached' },
  incident: { accept: 'cached', reject: 'cached' },
  // P8-D98 (TD-2026-10-19-528 F3): gnomon daemon stop raises a signed daemon-stop card decided with Touch ID (fresh).
  'daemon-stop': { accept: 'fresh', reject: 'fresh' },
  // ── 8.0:loops (docs/specs/gnomon-loops.md §3.1, §3.3) — loop rows live in THIS block only ─────────────────────
  // loop-trust: trusting a loop's content hash is root class like `grant` (fresh presence AND the root key, the
  //   loop.trusted row signed in the same touch); no `always` decision exists on it, it is in NEVER_STANDING_KINDS
  //   (standing-grant.ts) and voice never decides it (contracts VOICE_ALLOWLIST: hand-only, deny included).
  // loop-choice: a loop's decide card. `continue` lets the loop go on: fresh presence, hand-only (no voice);
  //   `stop` is deny-direction: the cached unlock carries it (voice-eligible in the spec, deferred to 8.1).
  'loop-trust': { allow: 'root', deny: 'fresh' },
  'loop-choice': { continue: 'fresh', stop: 'cached' },
});

/** Kinds the M1.6 broker raises (the rest are classed for their milestones, never raised here). */
/** P8-D92: the meter raises no `budget` card, so `budget` is not among them (it stays a spec card kind). */
export const M16_RAISABLE_KINDS: readonly CardKind[] = Object.freeze(['permission', 'gate-class', 'install', 'fallback', 'ask-user', 'plan', 'api-token'] as CardKind[]);

/** Decisions that create a standing rule (B8: never under a cached unlock, never under an arm). */
export const STANDING_DECISIONS: readonly string[] = Object.freeze(['always', 'install']);

export function validDecisions(kind: string): string[] {
  const t = (KIND_DECISIONS as Record<string, Record<string, DecisionClass>>)[kind];
  return t ? Object.keys(t) : [];
}

/** The base class of (kind, decision), raised by the card's flags; undefined = not a decision of this kind. */
export function baseClass(kind: string, decision: string, flags: readonly (CardFlag | string)[] = []): DecisionClass | undefined {
  if (decision === 'withdraw') return 'none';
  const c = (KIND_DECISIONS as Record<string, Record<string, DecisionClass>>)[kind]?.[decision];
  if (c === undefined) return undefined;
  // a card flagged irreversible is fresh-presence whatever its kind (§3.4); a peer-flagged cached decision takes presence (peer-presence)
  if (c === 'cached' && (flags.includes('irreversible') || flags.includes('peer'))) return 'fresh';
  return c;
}
