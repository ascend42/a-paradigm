/**
 * @symbol #gnomon-voice
 *
 * The voice client's read of the held send word (TD-2026-10-21-514, spec §14.7 "Voice submodes"): the kernel keeps it
 * at `<home>/voice/send-word.json` (0600; status.voice.sendWord reaches the human class only, so the client reads the
 * file, re-read only when it changes). Used ONLY for short words by adjacency: a segment too short to verify that IS
 * the send word (#send-word-matcher) is attributed to the draft speaker with speakerBasis 'adjacent'. The kernel
 * re-checks every condition; a broken file holds no word (fail closed). The word being TAUGHT is a separate source
 * (trialWordFileSource): a trial take needs no adjacency.
 */
import fs from 'node:fs';
import path from 'node:path';
import { canonicalSendWord, type SendWord } from '@a-company/gnomon-contracts';

/** The held word (adjacency only). */
export function sendWordFileSource(home: string): () => SendWord | null {
  return fileSource(path.join(home, 'voice', 'send-word.json'), () => true);
}

/**
 * The word being taught (send-word-trial.json, until its expiry), or null: while it is live the client sends each
 * segment's short text as a TAKE (no adjacency, whoever spoke; spec §14.7 trial semantics). The kernel decides; this
 * only stops the client withholding a take's text. A broken or expired file is no trial.
 */
export function trialWordFileSource(home: string, now: () => number = Date.now): () => SendWord | null {
  return fileSource(path.join(home, 'voice', 'send-word-trial.json'), (j) => typeof j.until === 'number' && now() <= j.until);
}

function fileSource(file: string, live: (j: { until?: unknown }) => boolean): () => SendWord | null {
  let key = '';
  let word: SendWord | null = null;
  let raw: { until?: unknown } = {};
  return () => {
    let k = 'absent';
    try {
      const st = fs.statSync(file);
      k = `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch {
      k = 'absent';
    }
    if (k === key) return word && live(raw) ? word : null;
    key = k;
    word = null;
    if (k === 'absent') return null;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { format?: unknown; text?: unknown; variants?: unknown; until?: unknown };
      raw = j;
      if (j.format === 'gnomon-send-word:v1') word = canonicalSendWord({ text: j.text, variants: j.variants });
    } catch {
      word = null;
    }
    return word && live(raw) ? word : null;
  };
}
