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

export const SEND_WORD_TRIAL_FILE = 'send-word-trial.json';
/**
 * The word being taught (the attended trial): written 0600 with an absolute expiry so the voice client knows a trial
 * is on (it then sends every segment's short text as a take, with no adjacency); never read as the held word,
 * cleared on save or clear.
 */
export function writeTrialWord(home: string, word: { text: string } | null, until = 0): void {
  const file = path.join(voiceDir(home), SEND_WORD_TRIAL_FILE);
  if (word === null) return void fs.rmSync(file, { force: true });
  const c = canonicalSendWord({ text: word.text, variants: [] });
  if (!c) throw new TypeError('the send word is 1-3 words, never an approval or command phrase');
  fs.mkdirSync(voiceDir(home), { recursive: true, mode: 0o700 });
  const tmp = path.join(voiceDir(home), `.${SEND_WORD_TRIAL_FILE}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify({ format: SEND_WORD_FORMAT, text: c.text, variants: [], until })}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
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

/**
 * request.voice.sendword — the payload's strict shape (TypeError ⇒ BAD_REQUEST):
 *   {op:'start', word, variants?}   hold `word` (the raw form: the CLI, or a dialog that did its own takes)
 *   {op:'start', word, trial:true}  start (or renew, keeping its takes) the ATTENDED trial of `word`
 *   {op:'save'}                     commit the trial: its word and collected variants, only after a correct take
 *   {op:'clear', trial?}            clear the held word, or with trial:true only the trial (Aegis L-2)
 */
export function parseSendWordRequest(payload: unknown): { op: 'start'; text: string; variants: string[]; trial: boolean } | { op: 'clear'; trial: boolean } | { op: 'save' } {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError("request.voice.sendword takes {op:'start', word, variants?} | {op:'save'} | {op:'clear'}");
  const p = payload as Record<string, unknown>;
  if (p.op === 'save') {
    if (Object.keys(p).some((k) => k !== 'op')) throw new TypeError("{op:'save'} takes nothing else (the kernel holds the trial's takes)");
    return { op: 'save' };
  }
  if (p.op === 'clear') {
    // Aegis L-2: {op:'clear', trial:true} drops only the word being taught; the held send word stays
    if (Object.keys(p).some((k) => k !== 'op' && k !== 'trial') || (p.trial !== undefined && typeof p.trial !== 'boolean')) throw new TypeError("{op:'clear'} takes trial? only");
    return { op: 'clear', trial: p.trial === true };
  }
  if (p.op !== 'start') throw new TypeError("op is 'start', 'save' or 'clear'");
  if (Object.keys(p).some((k) => k !== 'op' && k !== 'word' && k !== 'variants' && k !== 'trial')) throw new TypeError("{op:'start'} takes word, variants? and trial?");
  if (p.trial !== undefined && typeof p.trial !== 'boolean') throw new TypeError('trial is a boolean');
  if (typeof p.word !== 'string') throw new TypeError('word is a string');
  if (p.variants !== undefined && (!Array.isArray(p.variants) || !p.variants.every((v) => typeof v === 'string'))) throw new TypeError('variants is a string array');
  return { op: 'start', text: p.word, variants: (p.variants as string[] | undefined) ?? [], trial: p.trial === true };
}
