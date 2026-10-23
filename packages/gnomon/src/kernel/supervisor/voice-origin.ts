/**
 * @symbol #voice-origin
 *
 * Voice-sent turns (TD-2026-10-23-939, which supersedes TD-2026-10-21-514's edits-ask-first clamp; spec §14.7
 * "Voice submodes"). A turn sent by voice (Dictate's Enter with unverified words, the send word, a piece, the voice
 * app's send-now) gets EXACTLY the permissions of a typed turn: the session's run mode, the human's saved Always rules
 * and standing grants apply unchanged, and its cards are the cards a typed turn would raise. The human owns their
 * environment: the run mode they set is the control.
 *
 * What stays:
 *   - the origin stamp: every turn.sent carries origin hand | voice | voice-unverified and, for a voice turn, sentBy
 *     (word | piece | hotkey | unverified), for the record (#supervisor);
 *   - voice never approves anything: cards, grants, trust and mode changes refuse the voice principal and the voice
 *     intent form (#approval-broker, voice-off / voice-hand-only);
 *   - a piece reaches the agent with the piece note on the per-turn guidance block (pieceGuidance).
 */
import type { VoiceSentBy } from '@a-company/gnomon-contracts';

/** The per-turn guidance note a piece reaches the agent with (#supervisor appends it to the turn's guidance block). */
export function pieceGuidance(n: number): string {
  return `Voice piece ${n} of an ongoing thought, spoken aloud and sent as it was heard: if it looks incomplete, wait for more before acting; respond only when the thought is complete or clearly asks for a reply.`;
}

/** The piece counter of one session: pieces sent since the last non-piece turn (the N of "piece N"). */
export class VoicePieceCounter {
  #pieces = 0;

  /** a turn was sent (sentBy null = a hand turn): a piece counts up, anything else starts over */
  sent(sentBy: VoiceSentBy | null): void {
    this.#pieces = sentBy === 'piece' ? this.#pieces + 1 : 0;
  }

  /** the next piece's number (1-based) before sent() records it */
  nextPiece(): number {
    return this.#pieces + 1;
  }
}
