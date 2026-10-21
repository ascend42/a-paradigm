/**
 * @symbol ^voice-origin-clamp
 * @symbol !voice-clamp-applied
 *
 * The voice-origin clamp (TD-2026-10-21-514, spec §14.7 "Voice submodes"). While a voice-origin turn (sent by a
 * spoken send word or as a piece) is outstanding — from its turn.sent to the turn.result that closes it, or until
 * the session ends if it never closes (fail closed) — #supervisor lets NOTHING write-capable auto-pass:
 *   - the auto-edits pass (modeRef 'mode:auto-edits') is skipped;
 *   - every `always` rule, exact and prefix (modeRef 'rule:<cardId>'), is skipped;
 *   - only a provably read-only Bash command (#shell-readonly; the '*:read-only' modeRefs) still passes.
 * Default deny: clampAllows() admits ONLY the read-only modeRefs, so a modeRef added later is clamped unless it is
 * added here deliberately (G-VOX-18 enumerates every modeRef the supervisor writes).
 *
 * Dictate (Aegis 2026-10-21): a human's Enter that sent an unverified voice's words (sentBy 'unverified', turn.sent
 * origin 'voice-unverified') is clamped the same way, fail closed.
 *
 * Every other tool call raises a card carrying detail.origin 'voice', detail.sentBy and the kernel-composed line
 * VOICE_CLAMP_LINE(sentBy); the answer's session.inject row carries clamp:'voice' (!voice-clamp-applied).
 */
import type { VoiceSentBy } from '@a-company/gnomon-contracts';
import { wrappedBlock } from '../manifest/install.js';
import { READ_ONLY_ASK_MODE_REF, READ_ONLY_MODE_REF } from './auto-edits.js';

/** The modeRefs a clamp still admits: provably read-only commands only. */
export const CLAMP_ADMITS: readonly string[] = Object.freeze([READ_ONLY_MODE_REF, READ_ONLY_ASK_MODE_REF]);

/** May an approval.auto with this modeRef pass while a voice-origin turn is outstanding? Default deny. */
export function clampAllows(modeRef: string): boolean {
  return CLAMP_ADMITS.includes(modeRef);
}

/** The kernel-composed card line of a clamped request. */
export function voiceClampLine(sentBy: VoiceSentBy): string {
  if (sentBy === 'unverified') return 'Asked during a turn holding words from a voice Gnomon did not verify as yours. Check this was you.';
  return `Asked during a voice-sent turn (${sentBy === 'piece' ? 'sent as a piece' : sentBy === 'hotkey' ? 'sent by the voice app’s send key' : 'sent by send word'}). Check this was you.`;
}

/**
 * The card a clamped request raises: detail.origin 'voice' + detail.sentBy, the kernel-composed line first, the
 * wrapped block rebuilt from the new lines (so the shown block and the lines agree; contentHash covers both).
 */
export function withVoiceOrigin<P extends { detail: Record<string, unknown>; lines: string[]; block: Record<string, unknown> }>(plan: P, sentBy: VoiceSentBy): P {
  const lines = [voiceClampLine(sentBy), ...plan.lines];
  return { ...plan, detail: { ...plan.detail, origin: 'voice', sentBy }, lines, block: wrappedBlock(lines).block };
}

/** The per-turn guidance note a piece reaches the agent with (#supervisor appends it to the turn's guidance block). */
export function pieceGuidance(n: number): string {
  return `Voice piece ${n} of an ongoing thought, spoken aloud and sent as it was heard: if it looks incomplete, wait for more before acting; respond only when the thought is complete or clearly asks for a reply.`;
}

/**
 * The outstanding voice-origin turns of one session: turn ids → how they were sent. Closed by the results that
 * close those turns; never cleared otherwise (a turn that never closes keeps the clamp until the session ends).
 */
export class VoiceClampBook {
  readonly #open = new Map<string, VoiceSentBy>();
  /** Aegis M-3: voice turns whose own replay line (Claude consuming that message) has been seen */
  readonly #replayed = new Set<string>();
  /** pieces sent since the last non-piece turn (the N of "piece N") */
  #pieces = 0;

  sent(turn: string, sentBy: VoiceSentBy | null): void {
    if (sentBy === null) {
      this.#pieces = 0;
      return;
    }
    this.#open.set(turn, sentBy);
    if (sentBy === 'piece') this.#pieces++;
    else this.#pieces = 0;
  }

  /** the next piece's number (1-based) before sent() records it */
  nextPiece(): number {
    return this.#pieces + 1;
  }

  /** Claude consumed this turn's message (its replay line): only a LATER result may close it. */
  replayed(turn: string | undefined): void {
    if (turn !== undefined && this.#open.has(turn)) this.#replayed.add(turn);
  }

  /**
   * A result closed these turns. Aegis M-3: a voice turn closes only when its own replay was seen BEFORE this result;
   * a voice turn the result names but Claude never consumed (folded behind a hand turn, or a stream we did not see)
   * stays clamped (fail closed) until a later result after its replay, or the session's end.
   */
  closed(turns: readonly string[]): void {
    for (const t of turns) {
      if (!this.#open.has(t) || !this.#replayed.has(t)) continue;
      this.#open.delete(t);
      this.#replayed.delete(t);
    }
  }

  /** the outstanding voice turns (a result that closes the turn queue hands back the ones it could not close) */
  outstanding(): string[] {
    return [...this.#open.keys()];
  }

  /** the sentBy of the latest outstanding voice turn, or null when nothing is clamped */
  active(): VoiceSentBy | null {
    let last: VoiceSentBy | null = null;
    for (const v of this.#open.values()) last = v;
    return last;
  }
}
