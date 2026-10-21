/**
 * @symbol #gui-dictation
 *
 * "Teach Gnomon your send word" (TD-2026-10-21-514, spec §14.7 "Voice submodes"): the guided dialog, as a PURE
 * reducer. Steps:
 *   pick    a suggestion or 1-3 custom words; validated (#send-word-matcher validateSendWord: never an approval or
 *           command phrase; a very common word asks for a second confirmation in the dialog)
 *   leadin  the human says one ordinary sentence ("Gnomon, I'm teaching my send word"): a verified turn, so the
 *           short takes that follow are attributed to them by adjacency (the kernel holds the word as a TRIAL)
 *   takes   say the word TAKES_NEEDED times; each shows "I heard: …"; a take that cleans to the word or to a
 *           phonetic variant within the bound counts (variants are kept); anything else is shown and retried
 *   test    one more take, matched exactly as a send would be (exact or a stored variant)
 *   done    the dialog commits {word, variants} (request.voice.sendword{op:'start'})
 * While the dialog is open, every voice turn goes here and never into a draft.
 */
import { acceptableVariant, isSendWord, normalizeUtterance, SEND_WORD_MAX_VARIANTS, SEND_WORD_SUGGESTIONS, validateSendWord } from '@a-company/gnomon-contracts';

export const TAKES_NEEDED = 3;
export const TEACH_SUGGESTIONS = SEND_WORD_SUGGESTIONS;
export const LEADIN_LINE = "Gnomon, I'm teaching my send word";

export type TeachStep = 'pick' | 'confirm-common' | 'leadin' | 'takes' | 'test' | 'done';
export interface TeachState {
  step: TeachStep;
  word: string;
  takes: string[];
  variants: string[];
  /** the last thing heard ("I heard: …"), or null */
  heard: string | null;
  /** the line under the step (a validation reason, a retry hint), or null */
  hint: string | null;
}

export type TeachEvent =
  | { type: 'pick'; text: string }
  | { type: 'confirmCommon'; yes: boolean }
  | { type: 'heard'; text: string | null }
  | { type: 'restart' };

export const initialTeach = (): TeachState => ({ step: 'pick', word: '', takes: [], variants: [], heard: null, hint: null });

const REASONS: Readonly<Record<string, string>> = Object.freeze({
  empty: 'Type a word or pick a suggestion.',
  'too-many-words': 'Use 1 to 3 words.',
  'too-long': 'That is too long for a send word.',
  chars: 'Letters and numbers only.',
  reserved: 'That is an approval or command word: Gnomon never lets a send word sound like a decision.',
});

export function reduceTeach(s: TeachState, e: TeachEvent): TeachState {
  switch (e.type) {
    case 'restart':
      return initialTeach();
    case 'pick': {
      if (s.step !== 'pick' && s.step !== 'confirm-common') return s;
      const v = validateSendWord(e.text);
      if (!v.ok) return { ...s, step: 'pick', hint: REASONS[v.reason] ?? 'Not a usable send word.' };
      if (v.warn === 'common') return { ...s, step: 'confirm-common', word: v.text, hint: `“${v.text}” is a very common word and may send by accident.` };
      return { ...initialTeach(), step: 'leadin', word: v.text };
    }
    case 'confirmCommon':
      if (s.step !== 'confirm-common') return s;
      return e.yes ? { ...initialTeach(), step: 'leadin', word: s.word } : { ...initialTeach(), hint: 'Pick another word.' };
    case 'heard': {
      const shown = e.text === null ? null : normalizeUtterance(e.text);
      if (s.step === 'leadin') {
        if (!shown) return { ...s, heard: null, hint: 'I could not hear that clearly. Say the whole sentence again.' };
        return { ...s, step: 'takes', heard: shown, hint: null };
      }
      if (s.step === 'takes') {
        if (!shown) return { ...s, heard: null, hint: 'I could not hear that clearly. Say the sentence once more, then the word.' };
        if (!acceptableVariant(shown, s.word)) return { ...s, heard: shown, hint: `That does not sound like “${s.word}”. Try again.` };
        const variants = shown !== s.word && !s.variants.includes(shown) && s.variants.length < SEND_WORD_MAX_VARIANTS ? [...s.variants, shown] : s.variants;
        const takes = [...s.takes, shown];
        return { ...s, takes, variants, heard: shown, hint: null, step: takes.length >= TAKES_NEEDED ? 'test' : 'takes' };
      }
      if (s.step === 'test') {
        if (!shown) return { ...s, heard: null, hint: 'I could not hear that clearly. Say it again.' };
        if (isSendWord(shown, { text: s.word, variants: s.variants })) return { ...s, step: 'done', heard: shown, hint: null };
        return { ...s, heard: shown, hint: `That would not send. Say “${s.word}” again.` };
      }
      return s;
    }
  }
}

/** The dialog's heading line per step. */
export function teachLine(s: TeachState): string {
  switch (s.step) {
    case 'pick':
      return 'Pick a send word: 1 to 3 words you would not say by accident.';
    case 'confirm-common':
      return 'Use it anyway?';
    case 'leadin':
      return `Say: “${LEADIN_LINE}”`;
    case 'takes':
      return `Now say “${s.word}” on its own · take ${Math.min(s.takes.length + 1, TAKES_NEEDED)} of ${TAKES_NEEDED}`;
    case 'test':
      return `Test: say “${s.word}” once more, as you would to send`;
    case 'done':
      return `Done. Say “${s.word}” after a draft has been on screen for a second to send it; edits will still ask first.`;
  }
}

/** The commit payload (request.voice.sendword{op:'start', word, variants}). */
export const teachCommit = (s: TeachState): { op: 'start'; word: string; variants: string[] } | null => (s.step === 'done' ? { op: 'start', word: s.word, variants: [...s.variants] } : null);
