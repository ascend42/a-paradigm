/** #gui-dictation Pieces ($send-by-pieces, TD-2026-10-21-514): gap / cap batching, hold while busy, the piece claim. */
import { describe, expect, it } from 'vitest';
import { dictationNote, draftState, initialDictation, pieceDue, pieceFraction, reduceDictation, sendClaim, sendRequest, type DictationEvent, type DictationState } from '../src/core/dictation.js';

const A = 'hs:01JAAAAAAAAAAAAAAAAAAAAAAA';
const turn = (seq: number, text: string, now: number): DictationEvent => ({ type: 'turnRow', seq, hsid: A, payload: { forwardable: true, text, mode: 'conversation' }, now });
const run = (s: DictationState, ...es: DictationEvent[]): DictationState => es.reduce(reduceDictation, s);
const pieces = (): DictationState => run(initialDictation(5000), { type: 'start', sinceSeq: 0, now: 0 }, { type: 'context', attached: A, focused: A, now: 0 }, { type: 'setPolicy', policy: 'pieces', sendWord: null, now: 0 });

describe('Pieces', () => {
  it('a 1500 ms gap closes the piece: it sends with the piece claim and the parts in order', () => {
    let s = run(pieces(), turn(1, 'so the idea is', 100), turn(2, 'split the parser', 600));
    expect(draftState(s)).toBe('piece-ring');
    expect(pieceDue(s, 2000)).toBe(false);
    expect(pieceFraction(s, 1350)).toBeCloseTo(0.5, 1);
    s = run(s, { type: 'tick', now: 2100 });
    expect(s.sending).toBe(true);
    expect(sendClaim(s)).toEqual({ hsid: A, by: 'piece', turnSeqs: [1, 2] });
    expect(sendRequest(s)).toEqual({ hsid: A, content: [{ text: 'so the idea is' }, { text: 'split the parser' }], source: 'voice' });
    s = run(s, { type: 'sent', now: 2200 });
    expect(s.parts).toEqual([]);
  });

  it('the cap: a piece never grows past 8000 ms, even while speech continues', () => {
    let s = run(pieces(), turn(1, 'one', 100));
    for (let t = 1000; t <= 8000; t += 1000) s = run(s, { type: 'activity', activity: 'speaking', now: t }, turn(t, `w${t}`, t));
    expect(s.sending).toBe(false);
    s = run(s, { type: 'tick', now: 8150 });
    expect(s.sending).toBe(true);
  });

  it('holds while the session is busy, and an edit makes it a hand draft (held, Enter sends)', () => {
    let s = run(pieces(), turn(1, 'wait for it', 100), { type: 'busy', busy: true, now: 200 }, { type: 'tick', now: 5000 });
    expect(s.sending).toBe(false);
    expect(dictationNote(s)).toBe('piece waiting · Claude is answering');
    s = run(s, { type: 'busy', busy: false, now: 5100 }, { type: 'tick', now: 6700 });
    expect(s.sending).toBe(true);
    const e = run(pieces(), turn(1, 'wait for it', 100), { type: 'userEdit', text: 'wait for it!', now: 200 }, { type: 'tick', now: 9000 });
    expect(e.sending).toBe(false);
    expect(dictationNote(e)).toBe('piece held · Enter sends');
  });
});
