/**
 * @symbol #gnomon-voice
 * @symbol #send-word-matcher
 *
 * The held send word's file (TD-2026-10-21-514, spec §14.7 "Voice submodes"): `<home>/voice/send-word.json`, 0600,
 * written atomically (temp file in the same 0700 directory, then rename). The kernel reads it through a stat-keyed
 * cache, so the GUI's request.voice.sendword (via the daemon) and the raw CLI (`gnomon voice send-word set|clear`)
 * land in one place. The stored word is canonical (#send-word-matcher canonicalSendWord); a file that does not parse
 * to one holds NO word (fail closed: a broken file never makes a word send).
 *
 * Windows CI: no ':' in the file name; JSON with LF.
 */
import fs from 'node:fs';
import path from 'node:path';
import { canonicalSendWord, type SendWord } from '@a-company/gnomon-contracts';
import { voiceDir } from './enrolment.js';

export const SEND_WORD_FILE = 'send-word.json';
export const SEND_WORD_FORMAT = 'gnomon-send-word:v1';

export function sendWordPath(home: string): string {
  return path.join(voiceDir(home), SEND_WORD_FILE);
}

/** Read the held send word (null when there is none or the file is not a canonical word). */
export function readSendWord(home: string): SendWord | null {
  let raw: string;
  try {
    raw = fs.readFileSync(sendWordPath(home), 'utf8');
  } catch {
    return null;
  }
  try {
    const j = JSON.parse(raw) as { format?: unknown; text?: unknown; variants?: unknown };
    if (j.format !== SEND_WORD_FORMAT) return null;
    return canonicalSendWord({ text: j.text, variants: j.variants });
  } catch {
    return null;
  }
}

/** Write (or with null, delete) the held send word. Throws TypeError for a word that is not valid. */
export function writeSendWord(home: string, word: { text: string; variants?: readonly string[] } | null): SendWord | null {
  const file = sendWordPath(home);
  if (word === null) {
    fs.rmSync(file, { force: true });
    return null;
  }
  const c = canonicalSendWord({ text: word.text, variants: word.variants ?? [] });
  if (!c) throw new TypeError('the send word is 1-3 words, never an approval or command phrase, with at most 8 variants');
  const dir = voiceDir(home);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${SEND_WORD_FILE}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify({ format: SEND_WORD_FORMAT, text: c.text, variants: [...c.variants] }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return c;
}

/** A stat-keyed reader: re-reads only when the file's mtime/size/ino changes (absent ⇒ null). */
export function cachedSendWordSource(home: string): () => SendWord | null {
  let key = '';
  let word: SendWord | null = null;
  return () => {
    let k: string;
    try {
      const st = fs.statSync(sendWordPath(home));
      k = `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch {
      k = 'absent';
    }
    if (k !== key) {
      key = k;
      word = k === 'absent' ? null : readSendWord(home);
    }
    return word;
  };
}

/** request.voice.sendword{op:'start', word, variants?} | {op:'clear'} — the payload's strict shape (TypeError ⇒ BAD_REQUEST). */
export function parseSendWordRequest(payload: unknown): { op: 'start'; text: string; variants: string[] } | { op: 'clear' } {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError("request.voice.sendword takes {op:'start', word, variants?} | {op:'clear'}");
  const p = payload as Record<string, unknown>;
  if (p.op === 'clear') {
    if (Object.keys(p).length !== 1) throw new TypeError("{op:'clear'} takes no other field");
    return { op: 'clear' };
  }
  if (p.op !== 'start') throw new TypeError("op is 'start' or 'clear'");
  if (Object.keys(p).some((k) => k !== 'op' && k !== 'word' && k !== 'variants')) throw new TypeError("{op:'start'} takes word and variants?");
  if (typeof p.word !== 'string') throw new TypeError('word is a string');
  if (p.variants !== undefined && (!Array.isArray(p.variants) || !p.variants.every((v) => typeof v === 'string'))) throw new TypeError('variants is a string array');
  return { op: 'start', text: p.word, variants: (p.variants as string[] | undefined) ?? [] };
}
