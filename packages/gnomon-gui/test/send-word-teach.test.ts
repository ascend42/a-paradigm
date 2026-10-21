/** "Teach your send word" (TD-2026-10-21-514, spec §14.7 trial semantics): the guided steps over the kernel's trial, pure. */
import { describe, expect, it } from 'vitest';
import { recordTrialTake, startSendWordTrial, trialTakeNumber, type SendWordTrialState } from '@a-company/gnomon-contracts';
import { initialTeach, reduceTeach, teachCommit, teachHeardLine, teachLine, teachVariantsLine, TEACH_SUGGESTIONS, type TeachEvent, type TeachState } from '../src/core/send-word-teach.js';
import { initialDictation, reduceDictation } from '../src/core/dictation.js';
import { chatItems, type Row } from '../src/core/store.js';

const run = (s: TeachState, ...es: TeachEvent[]): TeachState => es.reduce(reduceTeach, s);
/** status.voice.sendWordTrial exactly as the kernel's trialStatus() shapes it */
const status = (t: SendWordTrialState | null): TeachEvent => ({ type: 'status', status: { voice: { sendWordTrial: t ? { word: t.word, state: t.state, take: trialTakeNumber(t), takes: t.takes, maxTakes: t.maxTakes, correct: t.correct, variants: t.variants, last: t.last, until: '2026-10-21T00:02:00.000Z' } : null } } });
const takes = (word: string, ...heard: string[]): SendWordTrialState => heard.reduce(recordTrialTake, startSendWordTrial(word)!);

describe('teach the send word', () => {
  it('one take heard correctly is enough: no lead-in, never the product name, save commits {op:save}', () => {
    let s = run(initialTeach(), { type: 'pick', text: 'Send it!' });
    expect(s.step).toBe('takes');
    expect(teachLine(s)).toBe('Say “send it” once to test · Take 1 of up to 4');
    expect(teachLine(s)).not.toMatch(/gnomon/i);
    s = run(s, status(takes('send it')), status(takes('send it', 'Send it.')));
    expect(s.step).toBe('done');
    expect(teachHeardLine(s)).toBe('I heard: “send it”');
    expect(teachCommit(s)).toEqual({ op: 'save' });
  });

  it('misheard then correct: "I heard x. Say it again", the mishearing is a variant, one counter', () => {
    let s = run(initialTeach(), { type: 'pick', text: 'ship it' }, status(takes('ship it', 'ship hit')));
    expect(s.step).toBe('takes');
    expect(teachHeardLine(s)).toBe('I heard “ship hit”. Say it again.');
    expect(teachLine(s)).toBe('Say “ship it” again · Take 2 of up to 4');
    expect(teachVariantsLine(s)).toBe('Also accepted when heard as “ship hit”');
    expect(teachCommit(s)).toBeNull(); // the save rule: no correct take yet
    s = run(s, status(takes('ship it', 'ship hit', 'ship it')));
    expect(s).toMatchObject({ step: 'done', trial: { variants: ['ship hit'], correct: 1, takes: 2 } });
    expect(teachCommit(s)).toEqual({ op: 'save' });
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
