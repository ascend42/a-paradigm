/**
 * @symbol #contract-voice-allowlist
 *
 * The voice allowlist for #gnomon-voice and #approval-broker's broker check (4) (spec §14.7 "The allowlist", TD-2026-10-19-194; `$voice-approval`, `^voice-armed`).
 * Pure data + pure functions: which (card kind, decision) pairs voice may decide under each voice class.
 * This list is the AUTHORITATIVE hand-only mechanism: anything it does not name is hand-only (default deny).
 * `#approval-broker`'s presence classes (packages/gnomon/src/kernel/broker/classes.ts) say how a HAND decision is
 * taken, never whether voice may take it.
 *
 * Spec citations (docs/specs/gnomon.md as of TD-2026-10-19-194):
 *   - D58 (line 146), §14.7 "Toggles" (line 1347): toggle 1 `reversible` = `tool.permission` allow/deny, `ask-user`
 *     answer, `plan` approve-plan; toggle 2 `gate` adds `gate-class`, `fallback-cloud`, `resume`.
 *   - D61 (line 149): `judgment` adds KNOT `resolve` and verdict `accept|reject`.
 *   - D62 (line 150): the grant sets are cumulative — [reversible] ⊂ [reversible, gate] ⊂ [reversible, gate, judgment].
 *   - §14.7 "Never by voice" (line 1416): install, use-api-token, always, voice-arm, grant, every root-signed verb,
 *     voice-share, flagged cards, strictness / run-mode / level changes, incident, reconsider restart|extend, judgment
 *     kinds without the sub-opt-in.
 *   - D64–D67 (line 164) + §14.7 "Exception (D66, S26-L3)" (line 1416): with toggle 1 on, `deny` and `reject` by voice
 *     are accepted on every card KIND, inside a reversible arm, with no hold.
 *   - §14.7 "Hold, echo, undo": `undo` during the hold is a `withdraw` on a held card; deny-direction skips the hold.
 *
 * Readings (reported with TD-2026-10-19-194): flags veto every approving and deny decision — the D66 exception names
 * card kinds, and a flagged card is voice-ineligible (§14.7 self-approval guards); `merge-conflict` `resolve` and
 * `tend` `accept` are not KNOT/verdict and stay hand-only. Founder ruling: `incident` and `daemon-stop` take no
 * voice decision at all, deny included.
 *
 * `withdraw` (`undo` during the hold, §14.7 Hold, echo, undo): undo is never narrower than the hold. It is ok for any
 * known class on any kind that has an approving row at some class, and flags never block it. The CALLER must also
 * check that the card's state is `held` and that it is held under the same `armId` (not knowable from these args).
 *
 * Not in this list (later slices): the strictness overlay and null-level ceiling, the `manual` run-mode deny-only
 * clamp, arm custody and every runtime broker check — callers pass the EFFECTIVE class.
 */

import { CARD_KINDS, type CardDecision, type CardKind } from './card.js';

/** The voice classes, cumulative in this order (D62). Same strings as VOICE_ELIGIBILITY minus `none`. */
export const VOICE_CLASSES = ['reversible', 'gate', 'judgment'] as const;
export type VoiceClass = (typeof VOICE_CLASSES)[number];

/** One kind's row. `approve` maps each class to the approving decisions it ADDS; `deny` is the D66 row. */
export interface VoiceAllowRow {
  approve: Readonly<Partial<Record<VoiceClass, readonly CardDecision[]>>>;
  /** D66: deny-direction decisions voice may take under any class, with no hold. */
  deny: readonly CardDecision[];
}

const row = (approve: VoiceAllowRow['approve'], deny: readonly CardDecision[]): VoiceAllowRow =>
  Object.freeze({ approve: Object.freeze({ ...approve }), deny: Object.freeze([...deny]) });

/**
 * Every CardKind has a row (the Record type forces it at compile time; test/voice-allowlist.test.ts forces it at
 * run time). A kind with an empty `approve` is hand-only for every approving decision. The deny-direction decision
 * per kind is the one #approval-broker's KIND_DECISIONS gives that kind (`deny` or `reject`), except the founder-ruled
 * fully hand-only kinds `incident` and `daemon-stop` (empty deny rows).
 */
export const VOICE_ALLOWLIST: Readonly<Record<CardKind, VoiceAllowRow>> = Object.freeze({
  // toggle 1 (D58, §14.7 Toggles)
  permission: row({ reversible: ['allow', 'deny'] }, ['deny']), // `always` never by voice (§14.7 Never)
  // Aegis L1 (2026-10-24, #gui-ask-card): voice never answers a question (broker #approve refuses voice); ask-user
  // takes no deny-direction decision, so the row is empty: hand only
  'ask-user': row({}, []),
  plan: row({ reversible: ['approve-plan'] }, ['reject']),
  // toggle 2 (D58, §14.7 Toggles)
  'gate-class': row({ gate: ['allow'] }, ['deny']),
  fallback: row({ gate: ['fallback-cloud'] }, ['deny']),
  budget: row({ gate: ['resume'] }, ['deny']),
  // judgment sub-opt-in (D61)
  knot: row({ judgment: ['resolve'] }, ['deny']),
  verdict: row({ judgment: ['accept', 'reject'] }, ['reject']),
  // hand-only for approving; D66 deny row only (§14.7 Never by voice + Exception D66)
  tend: row({}, ['reject']),
  'merge-conflict': row({}, ['deny']),
  install: row({}, ['deny']),
  'api-token': row({}, ['deny']),
  'voice-share': row({}, ['deny']),
  'voice-arm': row({}, ['deny']),
  grant: row({}, ['deny']),
  handoff: row({}, ['reject']),
  declassify: row({}, ['reject']),
  'peer-pair': row({}, ['reject']),
  reconsider: row({}, ['reject']), // restart|extend never by voice
  strictness: row({}, ['deny']), // every run-mode or level change is hand-only
  // FOUNDER RULING (TD-2026-10-19-677, Aegis M2): fully hand-only by voice, deny/reject included — the D66 exception.
  incident: row({}, []),
  'daemon-stop': row({}, []), // `daemon stop` is root-signed-class (§14.7 Never)
  // ── 8.0:loops (docs/specs/gnomon-loops.md §3.1, §7) ──
  // loop-trust is root class and "never by voice", deny included (§3.1, §7: voice cannot trust or resume loops).
  'loop-trust': row({}, []),
  // loop-choice: `continue` is hand-only fresh presence; `stop` is voice-eligible in the spec (§3.3), but voice on
  // loop-choice is deferred to 8.1 (founder scope, docs/plans/gnomon-loops-build.md), so it is hand-only in 8.0.
  'loop-choice': row({}, []),
});

/** Refusal reasons this module can name (all reserved in refusal.ts VOICE_REFUSAL_REASONS). */
export type VoiceAllowRefusal = 'voice-off' | 'voice-class' | 'voice-hand-only' | 'voice-ineligible';

export type VoiceAllowResult =
  | { ok: true; hold: boolean; via: VoiceClass | 'deny' | 'withdraw' }
  | { ok: false; reason: VoiceAllowRefusal };

const isVoiceClass = (c: unknown): c is VoiceClass => (VOICE_CLASSES as readonly unknown[]).includes(c);

/** The approving decisions a kind admits at `cls`, cumulative (D62). Unknown kind or class ⇒ none. */
export function voiceApprovingDecisions(cls: string, kind: string): CardDecision[] {
  if (!isVoiceClass(cls)) return [];
  const r = (VOICE_ALLOWLIST as Record<string, VoiceAllowRow>)[kind];
  if (!r) return [];
  const upTo = VOICE_CLASSES.slice(0, VOICE_CLASSES.indexOf(cls) + 1);
  return upTo.flatMap((c) => [...(r.approve[c] ?? [])]);
}

/**
 * May voice, under the EFFECTIVE class `cls`, take `decision` on a card of `kind` carrying `flags`?
 * `flags` is required (Aegis M1): a caller must state the card's flags, never default them away.
 * Order: unknown class ⇒ voice-off; withdraw ⇒ ok iff the kind has an approving row at ANY class (flags ignored;
 * caller checks state `held` + same armId); any flag ⇒ voice-ineligible; D66 deny row ⇒ ok, no hold; approving row
 * ⇒ ok with hold; a row at a higher class ⇒ voice-class;
 * else ⇒ voice-hand-only (default deny; also every unknown kind or decision).
 */
export function voiceDecisionCheck(cls: string, kind: string, decision: string, flags: readonly string[]): VoiceAllowResult {
  if (!isVoiceClass(cls)) return { ok: false, reason: 'voice-off' };
  const r = (VOICE_ALLOWLIST as Record<string, VoiceAllowRow>)[kind];
  if (decision === 'withdraw') {
    return r && voiceApprovingDecisions('judgment', kind).length > 0 ? { ok: true, hold: false, via: 'withdraw' } : { ok: false, reason: 'voice-hand-only' };
  }
  if (flags.length > 0) return { ok: false, reason: 'voice-ineligible' };
  if (!r) return { ok: false, reason: 'voice-hand-only' };
  const approving = voiceApprovingDecisions(cls, kind) as string[];
  if (r.deny.includes(decision as CardDecision)) return { ok: true, hold: false, via: 'deny' };
  if (approving.includes(decision)) return { ok: true, hold: true, via: lowestClassAdmitting(r, decision) ?? cls };
  if (voiceApprovingDecisions('judgment', kind).includes(decision as CardDecision)) return { ok: false, reason: 'voice-class' };
  return { ok: false, reason: 'voice-hand-only' };
}

/** The lowest (first, D62 order) voice class whose row admits `decision`. */
function lowestClassAdmitting(r: VoiceAllowRow, decision: string): VoiceClass | undefined {
  return VOICE_CLASSES.find((c) => (r.approve[c] as readonly string[] | undefined)?.includes(decision));
}

/** Boolean form of voiceDecisionCheck. */
export function voiceMayDecide(cls: string, kind: string, decision: string, flags: readonly string[]): boolean {
  return voiceDecisionCheck(cls, kind, decision, flags).ok;
}

/** Sanity: the allowlist covers exactly CARD_KINDS (also asserted by the test). */
export function voiceAllowlistCoversCardKinds(): boolean {
  const keys = Object.keys(VOICE_ALLOWLIST).sort();
  const kinds = [...CARD_KINDS].sort();
  return keys.length === kinds.length && keys.every((k, i) => k === kinds[i]);
}
