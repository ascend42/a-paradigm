/**
 * @symbol #gnomon-voice
 *
 * TABLE TALK per-turn guidance (TD-2026-10-20-294, spec §14.9). While voice is attached to a session, every
 * `session.send` to it (typed or voice) carries this text as a SECOND text block of the user message, wrapped in
 * `<gnomon-voice>…</gnomon-voice>`. It is the compact form of the TABLE-TALK PROTOCOL (docs/guides/table-talk.md,
 * protocol P-gnomon-table-talk-voice-replies): the reply opens with a ```speak block for the ear and keeps
 * everything else below it for the eye.
 *
 * The bytes are FROZEN (a test pins TABLE_TALK_GUIDANCE_HASH): a change is a protocol change and moves the
 * `guidanceHash` that `turn.sent` carries. The human's own text is hashed alone (`contentHash`), so replay and
 * `gnomon trace` never see the guidance as part of the turn.
 */

import { createHash } from 'node:crypto';

/** The guidance body (≤ 160 words), distilled from docs/guides/table-talk.md. */
export const TABLE_TALK_BODY = [
  'Voice is attached: the human is listening and looking at this screen. Talk as if sitting beside them.',
  'Start your reply with a ```speak block: 1-3 short spoken sentences, under 300 characters, second person, plain words. Point at the screen instead of reading it. End with ONE clear question they can answer in a word or two.',
  'Label things so they can say them back, in bold at line start below the block: letters A, B, C for alternatives; numbers for ordered steps; short names for files or parts; positions like "the first card" for things shown; no label for one thing.',
  'Never say aloud: code, paths, flags, URLs, long numbers, jargon. Put them below the block as reference.',
  'Asked for an opinion: give one, with the reason in a few words.',
  "Errors: say what failed and what you'll do next. Long work: say \"I'm on it, I'll tell you when it's done.\"",
].join('\n');

/** The exact second text block the supervisor writes (opening and closing tags included). */
export const TABLE_TALK_GUIDANCE = `<gnomon-voice>\n${TABLE_TALK_BODY}\n</gnomon-voice>`;

/** `turn.sent{guidanceHash}`: an opaque digest of the guidance bytes (never the text; the text is public code). */
export const TABLE_TALK_GUIDANCE_HASH = `sha256:${createHash('sha256').update(TABLE_TALK_GUIDANCE).digest('hex')}`;

/** Digest of any guidance block (the supervisor logs this for whatever block it wrote). */
export function guidanceHashOf(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}
