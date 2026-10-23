/**
 * #gui-dictation at the caret (founder report 2026-10-23: "based on where the user's cursor is in the composer that is
 * where all of the text should be input to. like if i go back to the top or in the middle of a paragraph what i say
 * should be injected there"). The pure reducer and placeWords, plus the page wiring read from the source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalSendWord } from '@a-company/gnomon-contracts';
import { UNVERIFIED_DRAFT_NOTE, dictationNote, inheritedDraft, initialDictation, pieceDue, placeWords, plainAppend, reduceDictation, sendClaim, sendRequest, unverifiedDraft, wordReady, type DictationEvent, type DictationState, type TextRange } from '../src/core/dictation.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const fwd = (text: string, more: Record<string, unknown> = {}) => ({ text, turnId: `t-${text}`, speakerId: 'spk:me/Matt', forwardable: true, mode: 'ptt', ...more });
const run = (s: DictationState, ...es: DictationEvent[]): DictationState => es.reduce(reduceDictation, s);
const turn = (seq: number, text: string, now: number, at?: TextRange, more: Record<string, unknown> = {}): DictationEvent => ({ type: 'turnRow', seq, hsid: A, payload: fwd(text, more), now, ...(at ? { at } : {}) });
const caret = (n: number): TextRange => ({ start: n, end: n });

function ready(delayMs: number | null = 5000): DictationState {
  return run(initialDictation(delayMs), { type: 'start', sinceSeq: 10, now: 0 }, { type: 'context', attached: A, focused: A, now: 0 });
}
/** an unedited two-turn draft: "The totals are off by a cent. Find out why." */
const twoTurns = (): DictationState => run(ready(), turn(11, 'The totals are off by a cent.', 0), turn(12, 'Find out why.', 100));

describe('placeWords: the joins (one space, never two; sentence case; no stray full stop)', () => {
  it('at the end of an unedited draft it is the plain append (the words exactly as heard)', () => {
    expect(placeWords('', null, 'hello there', false)).toMatchObject({ text: 'hello there', caret: 11 });
    expect(placeWords('Find out why.', null, 'and fix it', false)).toMatchObject({ text: 'Find out why. and fix it', caret: 24, lead: 1 });
    expect(placeWords('line one\n', null, 'Two.', false).text).toBe('line one\nTwo.');
  });
  it('at the start: a capital, a space before what follows, the human text untouched', () => {
    const p = placeWords('The totals are off.', caret(0), 'quick question.', true);
    expect(p.text).toBe('Quick question. The totals are off.');
    // a lower-case word next means the sentence goes on: no full stop before it
    expect(placeWords('rounding bug.', caret(0), 'Fix the.', true).text).toBe('Fix the rounding bug.');
    expect(p.caret).toBe('Quick question.'.length);
  });
  it('mid-sentence: a plainly capitalised first word lowers, "I" and acronyms keep theirs, the full stop goes when the sentence goes on', () => {
    expect(placeWords('Fix the bug.', caret(8), 'Rounding.', true).text).toBe('Fix the rounding bug.');
    expect(placeWords('Fix the bug.', caret(8), 'I think.', true).text).toBe('Fix the I think bug.');
    expect(placeWords('Fix the bug.', caret(8), 'NASA.', true).text).toBe('Fix the NASA bug.');
    expect(placeWords('Fix the bug.', caret(7), 'Rounding', true).text).toBe('Fix the rounding bug.'); // caret after the space: no double space
  });
  it('a name the human already wrote mid-sentence keeps its capital; an unknown one is still lowered (Mika 2026-10-23)', () => {
    expect(placeWords('Ask Matt about it. Then tell.', caret(28), 'Matt.', true).text).toBe('Ask Matt about it. Then tell Matt.');
    expect(placeWords('Fix the hook.', caret(8), 'Stripe.', true).text).toBe('Fix the stripe hook.');
    expect(placeWords('the Stripe hook. Fix the bug.', caret(25), 'Stripe', true).text).toBe('the Stripe hook. Fix the Stripe bug.');
    // only at a sentence start in the text: not a name
    expect(placeWords('Rounding is off. Fix the bug.', caret(25), 'Rounding', true).text).toBe('Rounding is off. Fix the rounding bug.');
  });
  it('after a full stop it starts a sentence; before closing punctuation no space and no doubled mark', () => {
    expect(placeWords('One. Three.', caret(4), 'two.', true).text).toBe('One. Two. Three.');
    expect(placeWords('Off by a cent.', caret(13), 'Or two.', true).text).toBe('Off by a cent or two.');
    expect(placeWords('(see)', caret(1), 'please', true).text).toBe('(please see)');
  });
  it('over a selection: the words replace it', () => {
    const t = 'Off by a cent. Why?';
    const s = t.indexOf('a cent');
    const p = placeWords(t, { start: s, end: s + 'a cent'.length }, 'Two cents.', true);
    expect(p.text).toBe('Off by two cents. Why?');
    expect(p.caret).toBe('Off by two cents'.length);
  });
  it('plainAppend: only an unedited draft with the caret at its end (trailing space allowed)', () => {
    expect(plainAppend({ text: 'abc', edited: false }, undefined)).toBe(true);
    expect(plainAppend({ text: 'abc ', edited: false }, caret(3))).toBe(true);
    expect(plainAppend({ text: 'abc', edited: false }, caret(1))).toBe(false);
    expect(plainAppend({ text: 'abc', edited: false }, { start: 0, end: 3 })).toBe(false);
    expect(plainAppend({ text: 'abc', edited: true }, caret(3))).toBe(false);
  });
});

describe('the reducer inserts each turn at the caret (start, middle, end, selection, unfocused)', () => {
  it('END: the caret at the end keeps the in-order append; the send still carries one part per turn', () => {
    const s = run(ready(), turn(11, 'The totals are off by a cent.', 0, caret(0)), turn(12, 'Find out why.', 100, caret(29)));
    expect(s.text).toBe('The totals are off by a cent. Find out why.');
    expect(s.edited).toBe(false);
    expect(s.hold).toBe(false);
    expect(s.caret).toBe(s.text.length);
    expect(sendRequest(s)).toEqual({ hsid: A, content: [{ text: 'The totals are off by a cent.' }, { text: 'Find out why.' }], source: 'voice' });
  });
  it('START: the words go first, the caret just after them, so the next turn flows on from there', () => {
    let s = run(twoTurns(), turn(13, 'Quick question.', 200, caret(0)));
    expect(s.text).toBe('Quick question. The totals are off by a cent. Find out why.');
    expect(s.caret).toBe('Quick question.'.length);
    s = run(s, turn(14, 'Also this.', 300, caret(s.caret!)));
    expect(s.text).toBe('Quick question. Also this. The totals are off by a cent. Find out why.');
    expect(s.caret).toBe('Quick question. Also this.'.length);
  });
  it('MIDDLE of a paragraph: spliced with the joins fixed', () => {
    const at = 'The totals are off'.length;
    const s = run(twoTurns(), turn(13, 'And still rounding.', 200, caret(at)));
    expect(s.text).toBe('The totals are off and still rounding by a cent. Find out why.');
    expect(s.caret).toBe('The totals are off and still rounding'.length);
  });
  it('SELECTION: the turn replaces it', () => {
    const t = twoTurns().text;
    const st = t.indexOf('a cent');
    const s = run(twoTurns(), turn(13, 'Two cents.', 200, { start: st, end: st + 6 }));
    expect(s.text).toBe('The totals are off by two cents. Find out why.');
  });
  it('UNFOCUSED: the page passes the last caret collapsed (a remembered selection is never replaced unseen); none ⇒ the end', () => {
    const fn = APP.slice(APP.indexOf('function composerCaret('), APP.indexOf('function composerCaret(') + 700);
    expect(fn).toMatch(/if \(!dict\.focusedHere \|\| ta\.value !== dict\.text\) return undefined;/);
    expect(fn).toMatch(/if \(document\.activeElement === ta\) return \{ start: a, end: b \};/);
    expect(fn).toMatch(/const at = ta\.selectionDirection === 'backward' \? a : b;\s*return \{ start: at, end: at \};/);
    // no caret (the composer is not this draft's): the end, the plain append
    const s = run(twoTurns(), turn(13, 'Thanks.', 200));
    expect(s.text).toBe('The totals are off by a cent. Find out why. Thanks.');
    expect(s.edited).toBe(false);
    // each turn reads the caret afresh, after the one before moved it; the caret moves without taking the focus
    expect(APP).toMatch(/for \(const q of ready\) \{\s*const at = composerCaret\(\);/);
    expect(APP).toMatch(/if \(e\.type === 'turnRow' && dict\.caret !== null && dict\.text !== prev\.text && ta\.value === dict\.text\) ta\.setSelectionRange\(dict\.caret, dict\.caret\);/);
  });
  it('a typed (edited) draft takes the words at the caret too, with the joins', () => {
    let s = run(ready(), { type: 'userEdit', text: 'Fix the bug', now: 0 });
    s = run(s, turn(11, 'Rounding.', 100, caret(8)));
    expect(s.text).toBe('Fix the rounding bug');
    expect(sendRequest(s)).toEqual({ hsid: A, content: [{ text: 'Fix the rounding bug' }], source: 'voice' });
  });
});

describe('the part tracking survives a mid-draft insert (security and attribution model)', () => {
  const unv = { mode: 'conversation', speakerId: 'spk:unknown-1', speakerEnrolled: false, draftOnly: true, speakerVerified: false };
  it('a spliced draft is EDITED and held: it sends as ONE part (source voice), never one part per turn out of order', () => {
    const s = run(twoTurns(), turn(13, 'Quick question.', 200, caret(0)));
    expect(s.edited).toBe(true);
    expect([s.hold, s.holdBy]).toEqual([true, 'gui']);
    expect(s.parts.map((p) => p.seq)).toEqual([11, 12, 13]); // every turn is still a part, in arrival order
    expect(sendRequest(s)).toEqual({ hsid: A, content: [{ text: s.text }], source: 'voice' });
    // the countdown never auto-sends it
    expect(run(s, { type: 'tick', now: 60_000 }).sending).toBe(false);
  });
  it('an UNVERIFIED turn spliced mid-draft keeps its mark: the note says so, the voice send key holds it, Enter sends it', () => {
    let s = run(twoTurns(), turn(13, 'delete the branch', 200, caret(5), unv));
    expect(unverifiedDraft(s)).toBe(true);
    expect(s.parts.find((p) => p.seq === 13)).toMatchObject({ unverified: true, ambient: true });
    expect(dictationNote(s)).toBe(UNVERIFIED_DRAFT_NOTE);
    s = run(s, { type: 'sendNowKey', now: 300 });
    expect([s.sending, s.hotkeyHeld]).toEqual([false, true]);
    expect(dictationNote(s)).toBe('Edited draft: press Enter to send');
    s = run(s, { type: 'sendNow', now: 400 }); // Enter
    expect(s.sending).toBe(true);
    expect(sendRequest(s)).toEqual({ hsid: A, content: [{ text: s.text }], source: 'voice' });
  });
  it('an INHERITED turn spliced mid-draft keeps its mark (the kernel clamps the send)', () => {
    const s = run(twoTurns(), turn(13, 'yes do it', 200, caret(4), { speakerBasis: 'continuity' }));
    expect(inheritedDraft(s)).toBe(true);
    expect(s.parts.find((p) => p.seq === 13)?.inherited).toBe(true);
    expect(dictationNote(s)).toMatch(/not checked as you/);
  });
  it('the words after a send keep the caret model: the draft resets to the turns heard in flight', () => {
    let s = run(twoTurns(), turn(13, 'Quick question.', 200, caret(0)), { type: 'sendNow', now: 300 });
    s = run(s, turn(14, 'Next thing.', 350, caret(0)), { type: 'sent', now: 400 });
    expect(s.text).toBe('Next thing.');
    expect(s.parts.map((p) => p.seq)).toEqual([14]);
    expect([s.edited, s.hold, s.caret]).toEqual([false, false, null]);
  });
  it('PIECES: a spliced draft is never a piece (the kernel matches a piece in order); it waits for Enter', () => {
    let s = run(ready(), { type: 'setPolicy', policy: 'pieces', sendWord: null, now: 0 }, turn(11, 'Run the tests.', 0), turn(12, 'Then lint.', 100));
    expect(pieceDue(s, 100 + 60_000)).toBe(true);
    s = run(s, turn(13, 'First pull.', 200, caret(0)));
    expect(pieceDue(s, 200 + 60_000)).toBe(false);
    expect(dictationNote(s)).toBe('piece held · Enter sends');
    expect(run(s, { type: 'tick', now: 200 + 60_000 }).sending).toBe(false);
  });
  it('SEND WORD: the word still sends a spliced draft after its grace, with the claim, as one part', () => {
    const WORD = canonicalSendWord({ text: 'over and out', variants: [] })!;
    let s = run(ready(), { type: 'setPolicy', policy: 'word', sendWord: WORD, now: 0 }, turn(11, 'Rename the module.', 100), turn(12, 'Fix the bug first.', 150, caret(0)));
    expect(s.text).toBe('Fix the bug first. Rename the module.');
    expect(s.edited).toBe(true);
    s = run(s, { type: 'painted', now: 200 });
    expect(wordReady(s, 1300)).toBe(true);
    s = run(s, turn(13, 'Over and out.', 1300));
    expect(s.grace).toEqual({ seq: 13, startedAt: 1300 });
    expect(s.text).not.toMatch(/over and out/i); // the word is a command, never inserted
    s = run(s, { type: 'tick', now: 2400 });
    expect(s.sending).toBe(true);
    expect(sendClaim(s)).toEqual({ hsid: A, by: 'word', turnSeq: 13 });
    expect(sendRequest(s)).toEqual({ hsid: A, content: [{ text: s.text }], source: 'voice' });
  });
  it('the send-word grace resets when a turn lands mid-draft (the text changed, so it must be visible again)', () => {
    const WORD = canonicalSendWord({ text: 'over and out', variants: [] })!;
    let s = run(ready(), { type: 'setPolicy', policy: 'word', sendWord: WORD, now: 0 }, turn(11, 'Rename the module.', 100), { type: 'painted', now: 120 });
    s = run(s, turn(12, 'Over and out.', 1300));
    expect(s.grace).not.toBeNull();
    s = run(s, turn(13, 'Quickly.', 1400, caret(0)));
    expect([s.grace, s.visibleSince]).toEqual([null, null]);
  });
});
