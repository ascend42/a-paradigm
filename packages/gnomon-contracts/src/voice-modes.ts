/**
 * @symbol #contract-voice-modes
 * @symbol #send-word-matcher
 *
 * Voice capture x send policy (TD-2026-10-21-514, spec §14.7 "Voice submodes"). Pure data and pure functions, frozen,
 * platform-neutral. NOT a clientApiId input: nothing here is in CLIENT_API_DESCRIPTOR (the golden test pins the id).
 *
 *   capture       ptt (hold a key) | open (ambient, VAD) | toggle (a key turns the mic on and off; ambient while on)
 *   send policy   key (Enter / Send / the send hotkey) | countdown (a push-to-talk draft sends after the ring)
 *                 | word (a spoken send word) | pieces (ambient speech is sent in pieces)
 *   presets       Talk (ptt x countdown) · Dictate (open|toggle x key) · Send word (open|toggle x word)
 *                 · Pieces (open|toggle x pieces)
 *
 * A countdown is never valid with ambient capture (open | toggle): ambient speech never sends itself on a timer
 * (TD-2026-10-20-125). `word` and `pieces` need ambient capture (a push-to-talk release already is the send gesture).
 *
 * Origin: every turn the kernel sends carries a kernel-stamped `origin` (hand | voice). Hand = typed, Enter / Send,
 * the send hotkey, a push-to-talk release (the key hold was the gesture). Voice = sent by a spoken send word or as a
 * piece. A voice-origin turn is CLAMPED (^voice-origin-clamp, #supervisor): nothing write-capable auto-passes.
 *
 * #send-word-matcher: ONE matcher, shared by the GUI dictation reducer, the voice client (short words by adjacency)
 * and the kernel (the claim check and the fail-closed backstop), so every side agrees on what the send word is.
 *   exact     the whole cleaned utterance equals the cleaned send word
 *   variant   it equals an enrolled ASR variant (from "Teach Gnomon your send word"); a variant is held only when it
 *             passes the variant guard (acceptableVariant), on every path (canonicalSendWord)
 *   near      same word count, phonetic key within SEND_WORD_NEAR_DISTANCE (Metaphone, Levenshtein) — never sent
 *             and never appended; the GUI asks "Did you say '<word>'?"
 *   none      anything else (a sentence that merely contains the word is none: the word is a standalone utterance)
 */

import { sha256Tagged } from './internal.js';

export const CAPTURE_KINDS = Object.freeze(['ptt', 'open', 'toggle'] as const);
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export const SEND_POLICIES = Object.freeze(['key', 'countdown', 'word', 'pieces'] as const);
export type SendPolicy = (typeof SEND_POLICIES)[number];

/**
 * How a turn was sent (the transcript label). `key` and `release` are hand; `word`, `piece` and `hotkey` are voice:
 * `hotkey` is the voice app's send-now press (⌃⌥Return), reported by the voice principal and unverifiable by the
 * kernel, so it is a voice-origin trigger (Aegis M-5).
 */
export const SENT_BY = Object.freeze(['key', 'release', 'word', 'piece', 'hotkey'] as const);
export type SentBy = (typeof SENT_BY)[number];

/** The kernel-stamped origin of every turn.sent. */
export const VOICE_ORIGINS = Object.freeze(['hand', 'voice'] as const);
export type VoiceOrigin = (typeof VOICE_ORIGINS)[number];

/** The sentBy values the kernel stamps on a voice-origin turn (request.voice.send.claim{by}). */
export const VOICE_SENT_BY = Object.freeze(['word', 'piece', 'hotkey'] as const);
export type VoiceSentBy = (typeof VOICE_SENT_BY)[number];

export const VOICE_PRESETS = Object.freeze({
  talk: Object.freeze({ capture: 'ptt', send: 'countdown' }),
  dictate: Object.freeze({ capture: 'open', send: 'key' }),
  'send-word': Object.freeze({ capture: 'open', send: 'word' }),
  pieces: Object.freeze({ capture: 'open', send: 'pieces' }),
} as const satisfies Record<string, { capture: CaptureKind; send: SendPolicy }>);
export type VoicePreset = keyof typeof VOICE_PRESETS;
export const VOICE_PRESET_IDS = Object.freeze(Object.keys(VOICE_PRESETS) as VoicePreset[]);

/** The liability modes: turned on only through the explicit one-time acknowledgement (TD-2026-10-21-514). */
export const LIABILITY_SEND_POLICIES = Object.freeze(['word', 'pieces'] as const);
export const VOICE_LIABILITY_ACK_TEXT = 'I understand a misheard or other voice can send for me; edits will still ask.';
/**
 * Aegis M-4: the hash a voice.session.start{send:'word'|'pieces'} must carry as `liabilityAck` (the human's own
 * attach, after the acknowledgement dialog); the kernel writes {principal, ackHash} into the start row it signs.
 */
export const VOICE_LIABILITY_ACK_HASH: string = sha256Tagged(VOICE_LIABILITY_ACK_TEXT);

const isCapture = (c: unknown): c is CaptureKind => (CAPTURE_KINDS as readonly unknown[]).includes(c);
const isSend = (s: unknown): s is SendPolicy => (SEND_POLICIES as readonly unknown[]).includes(s);

/** Is (capture, send) a valid pair? countdown only with ptt; word and pieces only with ambient capture. */
export function validPair(capture: unknown, send: unknown): boolean {
  if (!isCapture(capture) || !isSend(send)) return false;
  if (send === 'countdown') return capture === 'ptt';
  if (send === 'word' || send === 'pieces') return capture !== 'ptt';
  return true;
}

/** The origin a sentBy implies (unknown values are hand: the kernel stamps voice only from its own claim). */
export function originOf(sentBy: unknown): VoiceOrigin {
  return sentBy === 'word' || sentBy === 'piece' || sentBy === 'hotkey' ? 'voice' : 'hand';
}

/** The preset a pair is, or null for a custom pair. */
export function presetOf(capture: unknown, send: unknown): VoicePreset | null {
  if (!validPair(capture, send)) return null;
  if (capture === 'ptt' && send === 'countdown') return 'talk';
  if (capture === 'ptt') return null;
  return send === 'key' ? 'dictate' : send === 'word' ? 'send-word' : send === 'pieces' ? 'pieces' : null;
}

// ---- #send-word-matcher -------------------------------------------------------------------------------------------

export const SEND_WORD_MAX_WORDS = 3;
export const SEND_WORD_MAX_CHARS = 32;
export const SEND_WORD_MAX_VARIANTS = 8;
/** Levenshtein bound on the phonetic key for a near miss (and for accepting a variant at enrolment). */
export const SEND_WORD_NEAR_DISTANCE = 2;
/** a draft must be visible (painted, page visible, session focused) this long before the word may send it */
export const SEND_WORD_VISIBLE_MS = 1000;
/** the GUI's "Sending… Esc keeps it" grace */
export const SEND_WORD_GRACE_MS = 1000;
/** a word turn is claimable this long after the kernel received it */
export const SEND_WORD_CLAIM_MAX_AGE_MS = 30_000;
/** a claim binds the next voice send of that connection for this long */
export const SEND_CLAIM_TTL_MS = 5_000;
/** short words by adjacency: below this a segment is not speaker-verified; the word must start within ADJ of the speaker */
export const SEND_WORD_SHORT_MS = 1500;
export const SEND_WORD_ADJACENT_MS = 2000;
/** pieces: a gap this long closes a piece; a piece never grows past the cap */
export const PIECE_GAP_MS = 1500;
export const PIECE_CAP_MS = 8000;

/** Words that are approval or command phrases: never a send word (a send word must not be confusable with a decision). */
export const SEND_WORD_RESERVED = Object.freeze([
  'allow', 'deny', 'approve', 'approved', 'reject', 'rejected', 'accept', 'always', 'yes', 'no', 'undo', 'confirm',
  'confirmed', 'cancel', 'stop', 'stop speaking', 'hold', 'wait', 'resume', 'withdraw', 'answer', 'arm', 'disarm',
  'approve plan', 'allow always', 'yes allow', 'never',
] as const);
/** Very common words: allowed, but the enrolment dialog warns (they are said often by accident). */
export const SEND_WORD_COMMON = Object.freeze([
  'ok', 'okay', 'right', 'so', 'well', 'yeah', 'yep', 'thanks', 'thank you', 'done', 'go', 'next', 'and', 'the', 'now',
  'please', 'sure', 'good', 'great', 'cool', 'alright', 'send',
] as const);
/** Never the product name: nobody should have to say (or know how to pronounce) "Gnomon" to use voice. */
export const SEND_WORD_SUGGESTIONS = Object.freeze(['send', 'send it', 'over', 'ship it', 'over and out'] as const);

export interface SendWord {
  text: string;
  variants: readonly string[];
}
export type SendWordMatch = 'exact' | 'variant' | 'near' | 'none';
export type SendWordInvalid = 'empty' | 'too-many-words' | 'too-long' | 'chars' | 'reserved';

/** Clean an utterance: NFKC, lower case, punctuation to spaces (apostrophes dropped), whitespace collapsed. */
export function normalizeUtterance(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text.normalize('NFKC').toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

/** Validate a candidate send word. ok ⇒ its cleaned form; warn 'common' for a very common word. */
export function validateSendWord(word: unknown): { ok: true; text: string; warn?: 'common' } | { ok: false; reason: SendWordInvalid } {
  if (typeof word !== 'string') return { ok: false, reason: 'empty' };
  if (/[^\p{L}\p{N}\s'’.,!?-]/u.test(word)) return { ok: false, reason: 'chars' };
  const t = normalizeUtterance(word);
  if (!t) return { ok: false, reason: 'empty' };
  if (t.length > SEND_WORD_MAX_CHARS) return { ok: false, reason: 'too-long' };
  const words = t.split(' ');
  if (words.length > SEND_WORD_MAX_WORDS) return { ok: false, reason: 'too-many-words' };
  if (!words.every((w) => /^\p{L}[\p{L}\p{N}]*$/u.test(w))) return { ok: false, reason: 'chars' };
  if ((SEND_WORD_RESERVED as readonly string[]).includes(t) || words.some((w) => (SEND_WORD_RESERVED as readonly string[]).includes(w))) return { ok: false, reason: 'reserved' };
  return (SEND_WORD_COMMON as readonly string[]).includes(t) ? { ok: true, text: t, warn: 'common' } : { ok: true, text: t };
}

/**
 * A held send word in canonical form (cleaned text; cleaned unique variants ≠ text that pass the variant guard,
 * #send-word-matcher acceptableVariant; at most SEND_WORD_MAX_VARIANTS), or null. Aegis M-3: EVERY path that holds a
 * word goes through here (the trial save, the raw CLI and {op:'start', variants}, the send-word.json read-back in the
 * kernel and the voice client), so a variant the guard refuses is DROPPED wherever it came from (a file written before
 * the guard reads back without it).
 */
export function canonicalSendWord(v: unknown): SendWord | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as { text?: unknown; variants?: unknown };
  const ok = validateSendWord(o.text);
  if (!ok.ok) return null;
  const raw = Array.isArray(o.variants) ? o.variants : [];
  if (raw.length > SEND_WORD_MAX_VARIANTS || !raw.every((x) => typeof x === 'string')) return null;
  const variants = [...new Set(raw.map((x) => normalizeUtterance(x)).filter((x) => x && x !== ok.text && acceptableVariant(x, ok.text)))];
  return Object.freeze({ text: ok.text, variants: Object.freeze(variants) });
}

/** Match a whole utterance against the send word. A sentence that merely contains the word is 'none'. */
export function matchSendWord(text: unknown, word: SendWord | null | undefined): SendWordMatch {
  if (!word) return 'none';
  const t = normalizeUtterance(text);
  const w = normalizeUtterance(word.text);
  if (!t || !w) return 'none';
  if (t === w) return 'exact';
  if (word.variants.some((v) => normalizeUtterance(v) === t)) return 'variant';
  const tw = t.split(' ');
  if (tw.length !== w.split(' ').length) return 'none';
  const a = phoneticKey(t);
  const b = phoneticKey(w);
  if (!a || !b) return 'none';
  return levenshtein(a, b) <= SEND_WORD_NEAR_DISTANCE ? 'near' : 'none';
}

/** exact or variant: the utterance IS the send word (a command, never text). */
export function isSendWord(text: unknown, word: SendWord | null | undefined): boolean {
  const m = matchSendWord(text, word);
  return m === 'exact' || m === 'variant';
}

/** A variant is at least this many characters (cleaned): "so", "of", "or" are never a variant. */
export const SEND_WORD_VARIANT_MIN_CHARS = 3;
/** At or below this phonetic key length (spaces not counted) a variant must be within distance 1; above it, 2. */
export const SEND_WORD_VARIANT_SHORT_KEY = 3;
/**
 * Function words and lone fillers an ASR emits on their own all the time (Aegis H-1): never a variant, unless the
 * variant IS the word. Within Metaphone distance 2, "send" (SNT) reached "and", "end", "so", and "over" (OFR) reached
 * "of", "or", "for"; a stored variant matches exactly (isSendWord), so a lone "and" would have sent in word mode.
 */
export const SEND_WORD_VARIANT_STOP = Object.freeze([
  'a', 'an', 'and', 'end', 'the', 'of', 'or', 'for', 'nor', 'to', 'too', 'in', 'on', 'at', 'it', 'is', 'as', 'be', 'by',
  'if', 'so', 'but', 'not', 'off', 'up', 'yet', 'all', 'any', 'are', 'was', 'were', 'has', 'had', 'have', 'do', 'did',
  'does', 'can', 'will', 'just', 'that', 'this', 'then', 'than', 'there', 'here', 'what', 'when', 'who', 'how', 'why',
  'you', 'your', 'me', 'my', 'we', 'our', 'they', 'them', 'he', 'she', 'his', 'her', 'its', 'with', 'from', 'into',
  'um', 'uh', 'er', 'erm', 'ah', 'oh', 'hm', 'hmm', 'mm', 'mhm', 'huh', 'eh', 'hey', 'hi', 'like', 'see', 'say', 'said',
] as const);

/**
 * The variant guard (Aegis H-1 / M-3; spec §14.7 trial semantics): may `heard` be stored as a variant of `word`? The
 * word itself always may. Any other utterance must:
 *   - have the SAME word count as the word;
 *   - be at least SEND_WORD_VARIANT_MIN_CHARS characters (cleaned);
 *   - not be a very common word (SEND_WORD_COMMON), nor made only of common words, function words and fillers
 *     (SEND_WORD_VARIANT_STOP);
 *   - not be an approval or command phrase (validateSendWord);
 *   - be within the RELATIVE phonetic bound: Levenshtein ≤ 1 on the Metaphone key when the word's key is at most
 *     SEND_WORD_VARIANT_SHORT_KEY characters, else ≤ SEND_WORD_NEAR_DISTANCE.
 * Decided: a real mishearing that passes ("sand", "sent", "set" for "send") is kept; the human can drop any collected
 * variant at save ({op:'save', dropVariants}).
 */
export function acceptableVariant(heard: unknown, word: string): boolean {
  const t = normalizeUtterance(heard);
  const w = normalizeUtterance(word);
  if (!t || !w || t.length > SEND_WORD_MAX_CHARS * 2) return false;
  if (t === w) return true;
  const tw = t.split(' ');
  if (tw.length !== w.split(' ').length) return false;
  if (t.length < SEND_WORD_VARIANT_MIN_CHARS) return false;
  const common = SEND_WORD_COMMON as readonly string[];
  const stop = SEND_WORD_VARIANT_STOP as readonly string[];
  if (common.includes(t) || tw.every((x) => stop.includes(x) || common.includes(x))) return false;
  if (!validateSendWord(t).ok) return false;
  const a = phoneticKey(t);
  const b = phoneticKey(w);
  if (a === '' || b === '') return false;
  const bound = b.replace(/ /g, '').length <= SEND_WORD_VARIANT_SHORT_KEY ? 1 : SEND_WORD_NEAR_DISTANCE;
  return levenshtein(a, b) <= bound;
}

// ---- the attended send-word trial ("Teach your send word"; spec §14.7 "Voice submodes", trial semantics) -----------

/** A trial asks for at most this many takes (one, plus up to three retries after a mishearing). */
export const SEND_WORD_TRIAL_MAX_TAKES = 4;
/**
 * What one take of the word being taught was:
 *   correct  it cleans to the word itself (a save needs at least one)
 *   variant  a mishearing that passes the variant guard (acceptableVariant): kept as a variant
 *   unlike   heard, but not like the word (shown, never kept)
 *   unclear  no words, or longer than a send word can be (its text is never kept or shown)
 */
export type TrialTakeVerdict = 'correct' | 'variant' | 'unlike' | 'unclear';
export interface SendWordTrialState {
  /** the word being taught (cleaned) */
  word: string;
  /** takes counted so far (the ONE take counter; the take being asked for is takes + 1) */
  takes: number;
  maxTakes: number;
  /** takes heard as the word itself */
  correct: number;
  /** mishearings kept as variants (in order, unique, at most SEND_WORD_MAX_VARIANTS) */
  variants: string[];
  /** the last take: what was heard (cleaned; null when unclear) and its verdict */
  last: { heard: string | null; verdict: TrialTakeVerdict } | null;
  /** listening (say it) · ready (a correct take: save) · exhausted (maxTakes, none correct: pick again or retry) */
  state: 'listening' | 'ready' | 'exhausted';
}

/** The text of a take that may be kept or shown: cleaned, at most SEND_WORD_MAX_WORDS words and 2×MAX_CHARS, else null. */
export function trialTakeText(heard: unknown): string | null {
  const t = normalizeUtterance(heard);
  if (!t || t.length > SEND_WORD_MAX_CHARS * 2 || t.split(' ').length > SEND_WORD_MAX_WORDS) return null;
  return t;
}

/** Classify one take of `word`. */
export function classifyTrialTake(heard: unknown, word: string): { heard: string | null; verdict: TrialTakeVerdict } {
  const t = trialTakeText(heard);
  const w = normalizeUtterance(word);
  if (t === null || !w) return { heard: null, verdict: 'unclear' };
  if (t === w) return { heard: t, verdict: 'correct' };
  // the variant guard: never an approval, command, common or function word; same word count; the relative bound
  if (acceptableVariant(t, w)) return { heard: t, verdict: 'variant' };
  return { heard: t, verdict: 'unlike' };
}

/** A fresh trial of a valid word (null for a word validateSendWord refuses). */
export function startSendWordTrial(word: unknown, maxTakes = SEND_WORD_TRIAL_MAX_TAKES): SendWordTrialState | null {
  const v = validateSendWord(word);
  if (!v.ok) return null;
  return { word: v.text, takes: 0, maxTakes, correct: 0, variants: [], last: null, state: 'listening' };
}

/**
 * Count one take (PURE; the kernel's VoiceControl is the one place it runs for a live trial, status.voice.sendWordTrial
 * shows the result). Once ready or exhausted, a take changes nothing: the counter never runs past maxTakes.
 */
export function recordTrialTake(s: SendWordTrialState, heard: unknown): SendWordTrialState {
  if (s.state !== 'listening') return s;
  const c = classifyTrialTake(heard, s.word);
  const takes = s.takes + 1;
  const correct = s.correct + (c.verdict === 'correct' ? 1 : 0);
  const variants = c.verdict === 'variant' && c.heard && !s.variants.includes(c.heard) && s.variants.length < SEND_WORD_MAX_VARIANTS ? [...s.variants, c.heard] : s.variants;
  const state = correct > 0 ? 'ready' : takes >= s.maxTakes ? 'exhausted' : 'listening';
  return { ...s, takes, correct, variants, last: c, state };
}

/** The take being asked for (1-based), or null when the trial is not listening: "Take {n} of up to {maxTakes}". */
export const trialTakeNumber = (s: SendWordTrialState): number | null => (s.state === 'listening' ? s.takes + 1 : null);

/**
 * The save rule: the word and its collected variants minus any the human dropped (`dropVariants`, compared cleaned; an
 * entry that is not a collected variant is ignored), or null when no take was heard as the word itself.
 */
export function trialSaveable(s: SendWordTrialState, dropVariants: readonly string[] = []): SendWord | null {
  if (s.correct < 1) return null;
  const drop = new Set(dropVariants.map((x) => normalizeUtterance(x)));
  return canonicalSendWord({ text: s.word, variants: s.variants.filter((v) => !drop.has(v)) });
}

/** Levenshtein distance (small strings only). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n]!;
}

/** The phonetic key of a cleaned utterance: the Metaphone code of each word, joined by spaces. */
export function phoneticKey(text: string): string {
  return normalizeUtterance(text).split(' ').filter(Boolean).map(metaphone).filter(Boolean).join(' ');
}

const VOWELS = 'AEIOU';
/** Lawrence Philips' original Metaphone (1990), primary code, for one ASCII-folded word. */
export function metaphone(word: string): string {
  let w = word.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!w) return '';
  // initial exceptions
  if (/^(KN|GN|PN|AE|WR)/.test(w)) w = w.slice(1);
  if (w[0] === 'X') w = `S${w.slice(1)}`;
  if (w.startsWith('WH')) w = `W${w.slice(2)}`;
  const at = (i: number): string => w[i] ?? '';
  const isV = (c: string): boolean => c !== '' && VOWELS.includes(c);
  let out = '';
  for (let i = 0; i < w.length; i++) {
    const c = w[i]!;
    if (c === at(i - 1) && c !== 'C') continue; // doubled letters except C
    switch (c) {
      case 'A': case 'E': case 'I': case 'O': case 'U':
        if (i === 0) out += c;
        break;
      case 'B':
        if (!(i === w.length - 1 && at(i - 1) === 'M')) out += 'B';
        break;
      case 'C':
        if (at(i + 1) === 'I' && at(i + 2) === 'A') out += 'X';
        else if (at(i + 1) === 'H') { out += at(i - 1) === 'S' ? 'K' : 'X'; i++; }
        else if ('IEY'.includes(at(i + 1)) && at(i + 1) !== '') { if (at(i - 1) !== 'S') out += 'S'; }
        else out += 'K';
        break;
      case 'D':
        if (at(i + 1) === 'G' && 'EIY'.includes(at(i + 2)) && at(i + 2) !== '') { out += 'J'; i++; }
        else out += 'T';
        break;
      case 'G':
        if (at(i + 1) === 'H' && i + 2 < w.length && !isV(at(i + 2))) break; // GH not at the end and not before a vowel
        if (at(i + 1) === 'N' && (i + 2 === w.length || (at(i + 2) === 'E' && at(i + 3) === 'D' && i + 4 === w.length))) break;
        if ('IEY'.includes(at(i + 1)) && at(i + 1) !== '' && at(i - 1) !== 'G') out += 'J';
        else out += 'K';
        break;
      case 'H':
        if (isV(at(i + 1)) && !'CSPTG'.includes(at(i - 1) || '_')) out += 'H';
        break;
      case 'K':
        if (at(i - 1) !== 'C') out += 'K';
        break;
      case 'P':
        if (at(i + 1) === 'H') { out += 'F'; i++; } else out += 'P';
        break;
      case 'Q': out += 'K'; break;
      case 'S':
        if (at(i + 1) === 'H') { out += 'X'; i++; }
        else if (at(i + 1) === 'I' && (at(i + 2) === 'O' || at(i + 2) === 'A')) out += 'X';
        else out += 'S';
        break;
      case 'T':
        if (at(i + 1) === 'I' && (at(i + 2) === 'O' || at(i + 2) === 'A')) out += 'X';
        else if (at(i + 1) === 'H') { out += '0'; i++; }
        else if (!(at(i + 1) === 'C' && at(i + 2) === 'H')) out += 'T';
        break;
      case 'V': out += 'F'; break;
      case 'W': case 'Y':
        if (isV(at(i + 1))) out += c;
        break;
      case 'X': out += 'KS'; break;
      case 'Z': out += 'S'; break;
      default: out += c; // F J L M N R
    }
  }
  return out;
}
