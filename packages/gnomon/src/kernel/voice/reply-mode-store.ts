/**
 * @symbol #voice-reply-mode
 *
 * The human's voice REPLY MODE, persisted (founder request 2026-10-23: "a setting where they can choose to have it just
 * type back and not speak"). 'speak' = Speak and show (the default), 'show' = Show only: the voice app plays no spoken
 * reply; the speakable projection, the GUI's arrangement (the spoken part over the body, choices, slips) and voice
 * input are unchanged. <home>/voice/reply.json, 0600 in a 0700 dir: {format, mode}. Written atomically; a missing or
 * malformed file reads as 'speak'. Per human: <home> is the human's own Gnomon home. Not a security boundary.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const REPLY_MODES = Object.freeze(['speak', 'show'] as const);
export type ReplyMode = (typeof REPLY_MODES)[number];
export const REPLY_MODE_FILE = 'reply.json';
export const REPLY_MODE_FORMAT = 'gnomon-voice-reply:v1';

export const isReplyMode = (m: unknown): m is ReplyMode => m === 'speak' || m === 'show';

export function replyModePath(home: string): string {
  return path.join(home, 'voice', REPLY_MODE_FILE);
}

/** The persisted mode, or null when there is none (or it is unreadable / malformed). */
export function readReplyMode(home: string): ReplyMode | null {
  try {
    const j = JSON.parse(fs.readFileSync(replyModePath(home), 'utf8')) as Record<string, unknown>;
    return j.format === REPLY_MODE_FORMAT && isReplyMode(j.mode) ? j.mode : null;
  } catch {
    return null;
  }
}

export function writeReplyMode(home: string, mode: ReplyMode): void {
  const dir = path.dirname(replyModePath(home));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${REPLY_MODE_FILE}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify({ format: REPLY_MODE_FORMAT, mode }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, replyModePath(home));
}
