/** "Teach your send word" (TD-2026-10-21-514, spec §14.7 trial semantics): the guided steps over the kernel's trial, pure. */
import { describe, expect, it } from 'vitest';
import { recordTrialTake, startSendWordTrial, trialTakeNumber, type SendWordTrialState } from '@a-company/gnomon-contracts';
import { initialTeach, reduceTeach, teachCommit, teachCounter, teachHeardLine, teachPrompt, teachShowsRisk, teachVariantsLine, TEACH_PICKS, TEACH_SUGGESTIONS, type TeachEvent, type TeachState } from '../src/core/send-word-teach.js';
import { initialDictation, reduceDictation } from '../src/core/dictation.js';
import { chatItems, type Row } from '../src/core/store.js';

const run = (s: TeachState, ...es: TeachEvent[]): TeachState => es.reduce(reduceTeach, s);
/** status.voice.sendWordTrial exactly as the kernel's trialStatus() shapes it */
const status = (t: SendWordTrialState | null): TeachEvent => ({ type: 'status', status: { voice: { sendWordTrial: t ? { word: t.word, state: t.state, take: trialTakeNumber(t), takes: t.takes, maxTakes: t.maxTakes, correct: t.correct, variants: t.variants, last: t.last, until: '2026-10-21T00:02:00.000Z' } : null } } });
const takes = (word: string, ...heard: string[]): SendWordTrialState => heard.reduce(recordTrialTake, startSendWordTrial(word)!);

describe('teach the send word', () => {
  it('one take heard correctly is enough: no lead-in, never the product name; the risk check sits right before save', () => {
    let s = run(initialTeach(), { type: 'pick', text: 'Send it!' });
    expect(s.step).toBe('takes');
    expect(teachPrompt(s)).toBe('Say “send it” once, on its own.');
    expect(teachCounter(s)).toBe('take 1 of up to 4 · listening…'); // the ONE counter
    expect(`${teachPrompt(s)} ${teachCounter(s)}`).not.toMatch(/gnomon/i);
    expect(teachShowsRisk(s)).toBe(false);
    s = run(s, status(takes('send it')), status(takes('send it', 'Send it.')));
    expect(s.step).toBe('done');
    expect(teachHeardLine(s)).toBe('I heard: “send it” ✓');
    expect(teachCounter(s)).toBe('');
    expect(teachShowsRisk(s)).toBe(true);
    expect(teachCommit(s)).toBeNull(); // the "I understand" box is not ticked yet
    s = run(s, { type: 'ack', on: true });
    expect(teachCommit(s)).toEqual({ op: 'save' });
    // a user who already acknowledged starts with the box ticked
    expect(initialTeach(true).ack).toBe(true);
  });

  it('misheard then correct: "I heard x. Say it again", the mishearing is a variant, one counter', () => {
    let s = run(initialTeach(), { type: 'pick', text: 'ship it' }, status(takes('ship it', 'ship hit')));
    expect(s.step).toBe('takes');
    expect(teachHeardLine(s)).toBe('I heard “ship hit”. Say it again.');
    expect(teachPrompt(s)).toBe('Say “ship it” again, on its own.');
    expect(teachCounter(s)).toBe('take 2 of up to 4 · listening…');
    expect(teachVariantsLine(s)).toBe('kept as a variant: “ship hit”');
    expect(run(s, { type: 'ack', on: true }).step).toBe('takes');
    expect(teachCommit(run(s, { type: 'ack', on: true }))).toBeNull(); // the save rule: no correct take yet
    s = run(s, status(takes('ship it', 'ship hit', 'ship it')), { type: 'ack', on: true });
    expect(s).toMatchObject({ step: 'done', trial: { variants: ['ship hit'], correct: 1, takes: 2 } });
    expect(teachCommit(s)).toEqual({ op: 'save' });
  });

  it('the kernel refusing the save: its words under the row; a trial that ran out goes back to pick', () => {
    const done = run(initialTeach(true), { type: 'pick', text: 'over' }, status(takes('over', 'over')));
    expect(done.step).toBe('done');
    const r = run(done, { type: 'saveRefused', reason: 'no take was heard as the word itself yet', code: 'sendword-no-correct-take' });
    expect(r).toMatchObject({ step: 'done', hint: 'no take was heard as the word itself yet' });
    expect(run(done, { type: 'saveRefused', reason: 'x', code: 'sendword-no-trial' })).toMatchObject({ step: 'pick', ack: true, hint: expect.stringMatching(/ran out/) });
  });

  it('the row offers the design’s three picks plus your own; none names the product', () => {
    expect(TEACH_PICKS).toEqual(['send', 'send it', 'over']);
    expect(teachPrompt(initialTeach())).toBe('Pick a word you’ll say on its own when you finish speaking.');
  });

  it('four misses exhaust the trial; a sentence shows no text', () => {
    let s = run(initialTeach(), { type: 'pick', text: 'over and out' }, status(takes('over and out', 'I am teaching my send word now')));
    expect(teachHeardLine(s)).toBe('I could not make that out. Say just the word.');
    s = run(s, status(takes('over and out', 'a', 'b', 'c', 'd')));
    expect(s.step).toBe('exhausted');
    expect(teachCommit(s)).toBeNull();
  });

  it('validation: approval words are refused; a common word asks once; no suggestion names the product', () => {
    expect(run(initialTeach(), { type: 'pick', text: 'approve' })).toMatchObject({ step: 'pick', hint: expect.stringMatching(/approval or command/) });
    const c = run(initialTeach(), { type: 'pick', text: 'send' });
    expect(c.step).toBe('confirm-common');
    expect(run(c, { type: 'confirmCommon', yes: true }).step).toBe('takes');
    expect(run(c, { type: 'confirmCommon', yes: false }).step).toBe('pick');
    expect(TEACH_SUGGESTIONS.some((w) => /gnomon/i.test(w))).toBe(false);
  });

  it('a trial that is not up yet changes nothing; one that ends after it was seen goes back to pick', () => {
    const s = run(initialTeach(), { type: 'pick', text: 'over' });
    expect(run(s, status(null))).toBe(s);
    const seen = run(s, status(takes('over')), status(null));
    expect(seen).toMatchObject({ step: 'pick', hint: expect.stringMatching(/ran out/) });
  });
});

describe('a take never reaches the transcript or the draft', () => {
  const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
  // an unverified speaker's take, as the kernel stamps it: accepted for the dialog, never forwardable
  const take = (seq: number, text: string): Row => ({ seq, kind: 'voice.turn.user', view: 'full', session: A, payload: { turnId: `t${seq}`, speakerId: 'spk:unknown-1', speakerEnrolled: false, forwarded: false, forwardable: false, trialTake: true, trialVerdict: 'correct', text, mode: 'ptt' } });
  it('chatItems hides trialTake rows (no "voice app says: not sent", no "in composer")', () => {
    expect(chatItems([take(1, 'send'), take(2, 'sand')]).items).toEqual([]);
  });
  it('the dictation reducer never appends a take, even one wrongly stamped forwardable', () => {
    const s0 = reduceDictation(reduceDictation(initialDictation(), { type: 'start', sinceSeq: 0, now: 0 }), { type: 'context', attached: A, focused: A, now: 0 });
    const s1 = reduceDictation(s0, { type: 'turnRow', seq: 1, hsid: A, payload: { ...take(1, 'send').payload as object, forwardable: true }, now: 1 });
    expect(s1.parts).toEqual([]);
    expect(s1.text).toBe('');
    // control: the same row without trialTake is a draft
    const { trialTake: _t, ...plain } = { ...(take(1, 'send').payload as Record<string, unknown>), forwardable: true };
    expect(reduceDictation(s0, { type: 'turnRow', seq: 1, hsid: A, payload: plain, now: 1 }).text).toBe('send');
  });
});
