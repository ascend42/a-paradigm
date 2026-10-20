/**
 * @symbol #desk-guidance
 *
 * The Desk's per-turn note (TD-2026-10-20-812 A1, slice S1). While a session has at least one installed, granted,
 * unmuted mod that declares offers, every `session.send` to it carries a `<gnomon-desk>…</gnomon-desk>` note telling
 * the model it MAY end a reply with one ```offer block naming one of those offers.
 *
 * - DESK_BODY is FROZEN (a test pins DESK_BODY_HASH): changing it is a protocol change.
 * - The roster is KERNEL-COMPOSED from manifests only (A7): the mod name, then per offer its kind, phase and title,
 *   all closed tokens or validated single-line text (offer-spec:v1). No third-party prose (summary, restraint) ever
 *   reaches the note.
 * - composeGuidance(voice, desk) returns ONE text block. The supervisor writes it as the user message's SECOND text
 *   block under ONE turn.sent{guidanceHash}: `gnomon trace` (trace-cli.ts extrasAgree, Aegis M2) admits exactly one
 *   extra block, so table talk and the Desk share it. With voice only, the block is exactly TABLE_TALK_GUIDANCE (its
 *   pinned hash does not move).
 */

import type { OfferPhase } from '@a-company/gnomon-contracts';
import { guidanceHashOf } from '../voice/table-talk.js';

/** The note body (about 150 tokens). */
export const DESK_BODY = [
  'The Desk is on: the installed mods below can help in this conversation through their own tools.',
  'Only when one would genuinely help the human right now, you may end your reply with ONE fenced ```offer block and nothing after it:',
  '{"mod": "<mod>", "kind": "<offer kind>", "question": "<one short question asking whether they want it>"}',
  'Name only a mod and kind listed below, in a phase that fits the conversation. At most one offer per reply; most replies carry none.',
  'Never offer a mod the human declined in this conversation. Do not call its tools before the human accepts: you will be told to open it.',
].join('\n');

export const DESK_BODY_HASH = guidanceHashOf(DESK_BODY);

/** One roster entry: what the kernel read from an installed mod's manifest (never model or third-party prose). */
export interface DeskRosterMod {
  name: string;
  offers: ReadonlyArray<{ kind: string; phase: OfferPhase; title: string }>;
}

/** The kernel-composed roster lines: `- <mod>: <kind> (<phase>) "<title>"; …`, sorted by mod name. */
export function rosterLines(mods: readonly DeskRosterMod[]): string[] {
  return [...mods]
    .filter((m) => m.offers.length > 0)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((m) => `- ${m.name}: ${m.offers.map((o) => `${o.kind} (${o.phase}) "${o.title}"`).join('; ')}`);
}

/** The whole `<gnomon-desk>` block for a roster, or null when nothing is offerable. */
export function deskGuidance(mods: readonly DeskRosterMod[]): string | null {
  const lines = rosterLines(mods);
  if (lines.length === 0) return null;
  return `<gnomon-desk>\n${DESK_BODY}\nMods:\n${lines.join('\n')}\n</gnomon-desk>`;
}

/**
 * The ONE extra text block of a turn: voice and desk joined by a blank line (voice first), either alone, or null.
 * Never two blocks (trace-cli extrasAgree admits exactly one).
 */
export function composeGuidance(voice?: string | null, desk?: string | null): string | null {
  const parts = [voice, desk].filter((p): p is string => typeof p === 'string' && p.length > 0);
  return parts.length === 0 ? null : parts.join('\n\n');
}
