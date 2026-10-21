/**
 * @symbol #gui-dictation
 *
 * "Teach your send word" (TD-2026-10-21-514, spec §14.7 "Voice submodes", trial semantics): the guided dialog, as a
 * PURE reducer over the KERNEL's attended trial. The kernel is the one take counter (status.voice.sendWordTrial, from
 * #send-word-matcher recordTrialTake); this reducer only mirrors it, so the dialog can never show two counts.
 *   pick       a suggestion or 1-3 custom words; validated (validateSendWord: never an approval or command phrase; a
 *              very common word asks for a second confirmation)
 *   takes      the GUI starts the trial (request.voice.sendword{op:'start', word, trial:true}); "Say <word> once to
 *              test · Take n of up to 4", then "I heard: …". No lead-in sentence, and never the product name.
 *   done       a take was heard as the word itself: save (request.voice.sendword{op:'save'}; the kernel commits the
 *              word plus the variants its mishearings collected, and refuses a save with no correct take)
 *   exhausted  four takes, none heard as the word: try again or pick another word
 * While the dialog is open, every voice turn is a take (the kernel stamps trialTake) and never a draft.
 *
 * The voice UI/UX pass (T-2026-10-21-015) redesigns the dialog's look; this state shape is what it drives.
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
}

export type TeachEvent =
  | { type: 'pick'; text: string }
  | { type: 'confirmCommon'; yes: boolean }
  /** a status read: the whole status object (status.voice.sendWordTrial is read from it) */
  | { type: 'status'; status: unknown }
  | { type: 'restart' };

export const initialTeach = (): TeachState => ({ step: 'pick', word: '', trial: null, hint: null });

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
      return initialTeach();
    case 'pick': {
      if (s.step !== 'pick' && s.step !== 'confirm-common') return s;
      const v = validateSendWord(e.text);
      if (!v.ok) return { ...s, step: 'pick', hint: REASONS[v.reason] ?? 'Not a usable send word.' };
      if (v.warn === 'common') return { ...s, step: 'confirm-common', word: v.text, hint: `“${v.text}” is a very common word and may send by accident.` };
      return { ...initialTeach(), step: 'takes', word: v.text };
    }
    case 'confirmCommon':
      if (s.step !== 'confirm-common') return s;
      return e.yes ? { ...initialTeach(), step: 'takes', word: s.word } : { ...initialTeach(), hint: 'Pick another word.' };
    case 'status': {
      if (s.step !== 'takes' && s.step !== 'done' && s.step !== 'exhausted') return s;
      const t = trialViewOf(e.status);
      if (!t || t.word !== s.word) {
        // the trial ended under us (expired, or cleared elsewhere): only once it had been seen
        return s.trial ? { ...initialTeach(), word: s.word, hint: 'The time to test the word ran out. Pick it again.' } : s;
      }
      const step: TeachStep = t.state === 'ready' ? 'done' : t.state === 'exhausted' ? 'exhausted' : 'takes';
      return { ...s, step, trial: t };
    }
  }
}

/** The dialog's heading line per step ("Take n of up to 4" is the one counter, from the kernel). */
export function teachLine(s: TeachState): string {
  switch (s.step) {
    case 'pick':
      return 'Pick a send word: 1 to 3 words you would not say by accident.';
    case 'confirm-common':
      return 'Use it anyway?';
    case 'takes': {
      const max = s.trial?.maxTakes ?? SEND_WORD_TRIAL_MAX_TAKES;
      const n = s.trial?.take ?? 1;
      return n === 1 ? `Say “${s.word}” once to test · Take 1 of up to ${max}` : `Say “${s.word}” again · Take ${n} of up to ${max}`;
    }
    case 'done':
      return `Heard “${s.word}”. Save it: say it after a draft has been on screen for a second to send; edits will still ask first.`;
    case 'exhausted':
      return `“${s.word}” was not heard in ${s.trial?.maxTakes ?? SEND_WORD_TRIAL_MAX_TAKES} takes. Try again, or pick another word.`;
  }
}

/** What the last take was heard as ("I heard: …"), or ''. A take too long to be a send word shows no text. */
export function teachHeardLine(s: TeachState): string {
  const l = s.trial?.last;
  if (!l || s.step === 'pick' || s.step === 'confirm-common') return '';
  if (l.verdict === 'unclear' || l.heard === null) return s.step === 'takes' ? 'I could not make that out. Say just the word.' : '';
  if (l.verdict === 'correct') return `I heard: “${l.heard}”`;
  return s.step === 'takes' ? `I heard “${l.heard}”. Say it again.` : `I heard: “${l.heard}”`;
}

/** The mishearings that will be saved as variants ('' when none). */
export const teachVariantsLine = (s: TeachState): string => (s.trial?.variants.length ? `Also accepted when heard as ${s.trial.variants.map((v) => `“${v}”`).join(', ')}` : '');

/** The save request: the kernel holds the takes, so it carries nothing else. Only once a take was heard correctly. */
export const teachCommit = (s: TeachState): { op: 'save' } | null => (s.step === 'done' && (s.trial?.correct ?? 0) > 0 ? { op: 'save' } : null);
