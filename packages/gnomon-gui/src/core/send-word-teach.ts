/**
 * @symbol #gui-dictation
 *
 * "Teach your send word" (TD-2026-10-21-514, spec §14.7 "Voice submodes", trial semantics): the inline teaching under
 * the send-word row of the Voice settings sheet (#gui-voice-settings; Atelier 2026-10-21-gnomon-voice, teach.html),
 * as a PURE reducer over the KERNEL's attended trial. The kernel is the one take counter (status.voice.sendWordTrial,
 * from #send-word-matcher recordTrialTake); this reducer only mirrors it, so the row can never show two counts.
 *   pick       a suggestion or 1-3 custom words; validated (validateSendWord: never an approval or command phrase; a
 *              very common word asks for a second confirmation)
 *   takes      the GUI starts the trial (request.voice.sendword{op:'start', word, trial:true}); "Say <word> once, on
 *              its own." and the one counter "take n of up to 4", then "I heard: …". No lead-in sentence, and never the
 *              product name. A mishearing asks again and is kept as an accepted variant.
 *   done       a take was heard as the word itself: the risk check (the exact text plus "I understand") sits right
 *              before save (request.voice.sendword{op:'save'}; the kernel commits the word plus the variants its
 *              mishearings collected, and refuses a save with no correct take)
 *   exhausted  four takes, none heard as the word: try again or pick another word
 * While the row teaches, every voice turn is a take (the kernel stamps trialTake) and never a draft.
 */
import { SEND_WORD_SUGGESTIONS, SEND_WORD_TRIAL_MAX_TAKES, validateSendWord, type TrialTakeVerdict } from '@a-company/gnomon-contracts';

export const TEACH_SUGGESTIONS = SEND_WORD_SUGGESTIONS;

export type TeachStep = 'pick' | 'confirm-common' | 'takes' | 'done' | 'exhausted';
/** status.voice.sendWordTrial as the GUI reads it (the kernel's one counter). */
export interface TrialView {
  word: string;
  state: 'listening' | 'ready' | 'exhausted';
  /** the take being asked for (1-based), null unless listening */
  take: number | null;
  takes: number;
  maxTakes: number;
  correct: number;
  variants: string[];
  last: { heard: string | null; verdict: TrialTakeVerdict } | null;
}
export interface TeachState {
  step: TeachStep;
  word: string;
  /** the kernel's trial, as last read from status (null until it shows up) */
  trial: TrialView | null;
  /** the line under the step (a validation reason, a refusal), or null */
  hint: string | null;
  /** the risk check's "I understand" box (pre-ticked when this user already acknowledged) */
  ack: boolean;
  /** collected variants the human ticked to keep (every other one is sent as dropVariants on save) */
  kept: string[];
}

export type TeachEvent =
  | { type: 'pick'; text: string }
  | { type: 'confirmCommon'; yes: boolean }
  /** a status read: the whole status object (status.voice.sendWordTrial is read from it) */
  | { type: 'status'; status: unknown }
  | { type: 'restart' }
  /** the risk check's box */
  | { type: 'ack'; on: boolean }
  /** the kernel refused the save (code: its refusal reason, e.g. sendword-no-trial) */
  | { type: 'saveRefused'; reason: string; code?: string | null }
  /** tick (keep) or untick one collected variant */
  | { type: 'keepVariant'; variant: string; on: boolean };

export const initialTeach = (acked = false): TeachState => ({ step: 'pick', word: '', trial: null, hint: null, ack: acked, kept: [] });

const REASONS: Readonly<Record<string, string>> = Object.freeze({
  empty: 'Type a word or pick a suggestion.',
  'too-many-words': 'Use 1 to 3 words.',
  'too-long': 'That is too long for a send word.',
  chars: 'Letters and numbers only.',
  reserved: 'That is an approval or command word: a send word must never sound like a decision.',
});

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const VERDICTS: readonly string[] = ['correct', 'variant', 'unlike', 'unclear'];

/** status.voice.sendWordTrial → TrialView (null when absent or malformed: fail closed, nothing is shown as counted). */
export function trialViewOf(status: unknown): TrialView | null {
  const t = obj(obj(obj(status)?.voice)?.sendWordTrial);
  if (!t || typeof t.word !== 'string' || (t.state !== 'listening' && t.state !== 'ready' && t.state !== 'exhausted')) return null;
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
  const takes = n(t.takes);
  const correct = n(t.correct);
  if (takes === null || correct === null) return null;
  const last = obj(t.last);
  return {
    word: t.word,
    state: t.state,
    take: n(t.take),
    takes,
    maxTakes: n(t.maxTakes) ?? SEND_WORD_TRIAL_MAX_TAKES,
    correct,
    variants: Array.isArray(t.variants) ? t.variants.filter((v): v is string => typeof v === 'string') : [],
    last: last && VERDICTS.includes(String(last.verdict)) ? { heard: typeof last.heard === 'string' ? last.heard : null, verdict: last.verdict as TrialTakeVerdict } : null,
  };
}

export function reduceTeach(s: TeachState, e: TeachEvent): TeachState {
  switch (e.type) {
    case 'restart':
      return initialTeach(s.ack);
    case 'ack':
      return { ...s, ack: e.on };
    case 'keepVariant': {
      if (!s.trial?.variants.includes(e.variant)) return s;
      const kept = s.kept.filter((v) => v !== e.variant);
      return { ...s, kept: e.on ? [...kept, e.variant] : kept };
    }
    case 'saveRefused':
      if (e.code === 'sendword-no-trial') return { ...initialTeach(s.ack), hint: 'The time to test the word ran out. Pick it again.' };
      return { ...s, hint: e.reason };
    case 'pick': {
      if (s.step !== 'pick' && s.step !== 'confirm-common') return s;
      const v = validateSendWord(e.text);
      if (!v.ok) return { ...s, step: 'pick', hint: REASONS[v.reason] ?? 'Not a usable send word.' };
      if (v.warn === 'common') return { ...s, step: 'confirm-common', word: v.text, hint: `“${v.text}” is a very common word and may send by accident.` };
      return { ...initialTeach(s.ack), step: 'takes', word: v.text };
    }
    case 'confirmCommon':
      if (s.step !== 'confirm-common') return s;
      return e.yes ? { ...initialTeach(s.ack), step: 'takes', word: s.word } : { ...initialTeach(s.ack), hint: 'Pick another word.' };
    case 'status': {
      if (s.step !== 'takes' && s.step !== 'done' && s.step !== 'exhausted') return s;
      const t = trialViewOf(e.status);
      if (!t || t.word !== s.word) {
        // the trial ended under us (expired, or cleared elsewhere): only once it had been seen
        return s.trial ? { ...initialTeach(s.ack), word: s.word, hint: 'The time to test the word ran out. Pick it again.' } : s;
      }
      const step: TeachStep = t.state === 'ready' ? 'done' : t.state === 'exhausted' ? 'exhausted' : 'takes';
      return { ...s, step, trial: t, kept: s.kept.filter((v) => t.variants.includes(v)) };
    }
  }
}

/** The suggestions the row offers (the design's three, then "your own…"). */
export const TEACH_PICKS: readonly string[] = Object.freeze(SEND_WORD_SUGGESTIONS.slice(0, 3));

/** The row's one prompt per step (the counter is its own line: teachCounter). */
export function teachPrompt(s: TeachState): string {
  switch (s.step) {
    case 'pick':
      return 'Pick a word you’ll say on its own when you finish speaking.';
    case 'confirm-common':
      return 'Use it anyway?';
    case 'takes':
      return (s.trial?.take ?? 1) === 1 ? `Say “${s.word}” once, on its own.` : `Say “${s.word}” again, on its own.`;
    case 'done':
      return '';
    case 'exhausted':
      return `“${s.word}” was not heard in ${s.trial?.maxTakes ?? SEND_WORD_TRIAL_MAX_TAKES} takes. Try again, or pick another word.`;
  }
}

/** The ONE counter, from the kernel's trial: "take n of up to 4 · listening…" while it listens, else ''. */
export function teachCounter(s: TeachState): string {
  if (s.step !== 'takes') return '';
  return `take ${s.trial?.take ?? 1} of up to ${s.trial?.maxTakes ?? SEND_WORD_TRIAL_MAX_TAKES} · listening…`;
}

/** What the last take was heard as ("I heard: …"), or ''. A take too long to be a send word shows no text. */
export function teachHeardLine(s: TeachState): string {
  const l = s.trial?.last;
  if (!l || s.step === 'pick' || s.step === 'confirm-common') return '';
  if (l.verdict === 'unclear' || l.heard === null) return s.step === 'takes' ? 'I could not make that out. Say just the word.' : '';
  if (l.verdict === 'correct') return `I heard: “${l.heard}” ✓`;
  return s.step === 'takes' ? `I heard “${l.heard}”. Say it again.` : `I heard: “${l.heard}”`;
}

/**
 * Variants are an explicit opt-in (Aegis R-1): at save each collected mishearing is an UNTICKED box ("Saying “x” on
 * its own will also send. …"); the save carries every unticked one as `dropVariants` (the kernel's
 * request.voice.sendword{op:'save', dropVariants?: string[]}, at most 8, each at most 64 characters), so only ticked
 * ones are kept. The heard text comes only from status.voice.sendWordTrial.last (take rows are hash-only).
 */
export const TEACH_DROP_VARIANTS = true;
export const DROP_VARIANTS_MAX = 8;
export const DROP_VARIANT_CHARS = 64;

/** While the takes go on: the mishearings heard so far ('' when none); whether one also sends is chosen at save. */
export const teachVariantsLine = (s: TeachState): string => (s.step === 'takes' && s.trial?.variants.length ? `heard so far: ${s.trial.variants.map((v) => `“${v}”`).join(', ')} · you choose at save whether any also sends` : '');

/** At save: each collected variant, its opt-in label and whether it is ticked (unticked = dropped). */
export function teachVariants(s: TeachState): { variant: string; kept: boolean; label: string }[] {
  return (s.trial?.variants ?? []).map((variant) => ({ variant, kept: s.kept.includes(variant), label: `Saying “${variant}” on its own will also send. You said “${s.word}”; I heard “${variant}”.` }));
}

/** The risk check shows right before save (a take was heard as the word). */
export const teachShowsRisk = (s: TeachState): boolean => s.step === 'done';

/** The save request: the kernel holds the takes, so it carries nothing else. Only once a take was heard correctly AND the risk box is ticked. */
export function teachCommit(s: TeachState): { op: 'save'; dropVariants?: string[] } | null {
  if (s.step !== 'done' || (s.trial?.correct ?? 0) === 0 || !s.ack) return null;
  // Aegis R-1: keeping a mishearing is an explicit opt-in; every unticked one is dropped
  const drop = s.trial!.variants.filter((v) => !s.kept.includes(v)).slice(0, DROP_VARIANTS_MAX);
  return drop.length ? { op: 'save', dropVariants: drop } : { op: 'save' };
}
