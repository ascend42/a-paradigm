/**
 * @symbol #gnomon-voice
 *
 * The voice client's read of the held send word (TD-2026-10-21-514, spec §14.7 "Voice submodes"): the kernel keeps it
 * at `<home>/voice/send-word.json` (0600; status.voice.sendWord reaches the human class only, so the client reads the
 * file, re-read only when it changes). Used ONLY for short words by adjacency: a segment too short to verify that IS
 * the send word (#send-word-matcher) is attributed to the draft speaker with speakerBasis 'adjacent'. The kernel
 * re-checks every condition; a broken file holds no word (fail closed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { canonicalSendWord, type SendWord } from '@a-company/gnomon-contracts';

export function sendWordFileSource(home: string): () => SendWord | null {
  const file = path.join(home, 'voice', 'send-word.json');
  let key = '';
  let word: SendWord | null = null;
  return () => {
    let k = 'absent';
    try {
      const st = fs.statSync(file);
      k = `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch {
      k = 'absent';
    }
    if (k === key) return word;
    key = k;
    word = null;
    if (k === 'absent') return null;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { format?: unknown; text?: unknown; variants?: unknown };
      if (j.format === 'gnomon-send-word:v1') word = canonicalSendWord({ text: j.text, variants: j.variants });
    } catch {
      word = null;
    }
    return word;
  };
}
