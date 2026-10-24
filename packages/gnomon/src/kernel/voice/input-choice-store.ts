/**
 * @symbol #gnomon-voice
 *
 * The human's voice input choice, persisted (founder request 2026-10-23: "a clear input selection inside gnomon"; the
 * choice is remembered across restarts and survives the device disconnecting). <home>/voice/input.json, 0600 in a 0700
 * dir: {format, id: device id | null (follow the system default), name}. Written atomically; a missing or malformed
 * file reads as "follow the system default". Not a security boundary: it only picks which microphone captures.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const INPUT_CHOICE_FILE = 'input.json';
export const INPUT_CHOICE_FORMAT = 'gnomon-voice-input:v1';

export function inputChoicePath(home: string): string {
  return path.join(home, 'voice', INPUT_CHOICE_FILE);
}

/** The persisted choice, or null when there is none (or it is unreadable / malformed: never guessed). */
export function readInputChoice(home: string): { id: string | null; name: string | null } | null {
  try {
    const j = JSON.parse(fs.readFileSync(inputChoicePath(home), 'utf8')) as Record<string, unknown>;
    if (j.format !== INPUT_CHOICE_FORMAT) return null;
    if (j.id !== null && typeof j.id !== 'string') return null;
    return { id: j.id as string | null, name: typeof j.name === 'string' ? j.name : null };
  } catch {
    return null;
  }
}

export function writeInputChoice(home: string, c: { id: string | null; name: string | null }): void {
  const dir = path.dirname(inputChoicePath(home));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${INPUT_CHOICE_FILE}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify({ format: INPUT_CHOICE_FORMAT, id: c.id, name: c.name }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, inputChoicePath(home));
}
