/**
 * #gui-dictation send word (TD-2026-10-21-514, $send-by-word): the word is a command (never appended), sends only a
 * draft visible ≥ 1 s (painted, page visible, focused, attached), a near miss asks, the 1 s grace (Esc keeps it) and
 * the claim the send carries. Pure reducer.
 */
import { describe, expect, it } from 'vitest';
import { canonicalSendWord } from '@a-company/gnomon-contracts';
import { DRAFT_CONTROLS, WORD_GRACE_LINE, dictationNote, draftState, initialDictation, reduceDictation, sendClaim, sendRequest, wordReady, type DictationEvent, type DictationState } from '../src/core/dictation.js';

const A = 'hs:01JAAAAAAAAAAAAAAAAAAAAAAA';
const WORD = canonicalSendWord({ text: 'over and out', variants: ['over an out'] })!;
const fwd = (text: string): Record<string, unknown> => ({ forwardable: true, text, mode: 'conversation' });
const turn = (seq: number, text: string, now: number): DictationEvent => ({ type: 'turnRow', seq, hsid: A, payload: fwd(text), now });
const run = (s: DictationState, ...es: DictationEvent[]): DictationState => es.reduce(reduceDictation, s);

function wordState(): DictationState {
  return run(initialDictation(5000), { type: 'start', sinceSeq: 0, now: 0 }, { type: 'context', attached: A, focused: A, now: 0 }, { type: 'setPolicy', policy: 'word', sendWord: WORD, now: 0 });
}

describe('send word (#gui-dictation)', () => {
  it('a visible draft + the word: grace, then a send carrying the claim; the word is never in the text', () => {
    let s = run(wordState(), turn(1, 'rename the module', 100), { type: 'painted', now: 120 });
    expect(wordReady(s, 1200)).toBe(true);
    s = run(s, turn(2, 'Over and out.', 1300));
    expect(s.text).toBe('rename the module');
    expect(s.grace).toEqual({ seq: 2, startedAt: 1300 });
    expect(draftState(s)).toBe('word-grace');
    expect(DRAFT_CONTROLS['word-grace'].grace).toBe(true);
    expect(dictationNote(s)).toBe(WORD_GRACE_LINE);
    s = run(s, { type: 'tick', now: 2000 });
    expect(s.sending).toBe(false);
    s = run(s, { type: 'tick', now: 2310 });
    expect(s.sending).toBe(true);
    expect(sendClaim(s)).toEqual({ hsid: A, by: 'word', turnSeq: 2 });
    expect(sendRequest(s)).toEqual({ hsid: A, content: [{ text: 'rename the module' }], source: 'voice' });
    s = run(s, { type: 'sent', now: 2400 });
    expect(s.claim).toBeNull();
  });

  it('does nothing with no draft, before 1 s of visibility, unpainted, hidden page or unfocused', () => {
    expect(run(wordState(), turn(1, 'over and out', 100)).grace).toBeNull(); // no draft
    const d = run(wordState(), turn(1, 'fix it', 100), { type: 'painted', now: 100 });
    expect(run(d, turn(2, 'over and out', 900)).grace).toBeNull(); // visible 0.8 s
    expect(run(wordState(), turn(1, 'fix it', 100), turn(2, 'over and out', 5000)).grace).toBeNull(); // never painted
    expect(run(d, { type: 'pageVisible', visible: false, now: 500 }, turn(2, 'over and out', 5000)).grace).toBeNull();
    expect(run(d, { type: 'context', attached: A, focused: 'hs:other', now: 500 }, { type: 'context', attached: A, focused: A, now: 600 }, turn(2, 'over and out', 1300)).grace).toBeNull(); // focus loss reset it
  });

  it('any text change resets visibility; a painted event while hidden or unfocused does not stamp', () => {
    let s = run(wordState(), turn(1, 'fix it', 100), { type: 'painted', now: 100 }, turn(2, 'and the docs', 1500));
    expect(s.visibleSince).toBeNull();
    expect(run(s, turn(3, 'over and out', 2000)).grace).toBeNull();
    s = run(s, { type: 'userEdit', text: 'fix it and the docs!', now: 1600 });
    expect(s.visibleSince).toBeNull();
    expect(run(s, { type: 'pageVisible', visible: false, now: 1700 }, { type: 'painted', now: 1800 }).visibleSince).toBeNull();
  });

  it('a near miss is neither sent nor appended and asks; Esc during the grace keeps the draft (held)', () => {
    let s = run(wordState(), turn(1, 'fix it', 100), { type: 'painted', now: 100 }, turn(2, 'over and about', 1500));
    expect(s.text).toBe('fix it');
    expect(s.grace).toBeNull();
    expect(dictationNote(s)).toBe("Did you say 'over and out'? Say it again or press Enter");
    s = run(s, turn(3, 'over an out', 1600)); // an enrolled variant
    expect(s.grace?.seq).toBe(3);
    s = run(s, { type: 'graceCancel', now: 1900 }, { type: 'tick', now: 3000 });
    expect(s.sending).toBe(false);
    expect(s.hold).toBe(true);
    expect(s.text).toBe('fix it');
  });

  it('under the word policy nothing counts down; the countdown policy keeps the old ring', () => {
    const s = run(wordState(), turn(1, 'fix it', 100), { type: 'painted', now: 100 }, { type: 'tick', now: 60_000 });
    expect(s.sending).toBe(false);
    expect(dictationNote(s)).toBe("draft · say 'over and out' or press Enter");
  });
});
