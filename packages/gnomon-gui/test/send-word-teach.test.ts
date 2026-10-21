/** "Teach Gnomon your send word" (TD-2026-10-21-514): the guided steps, pure. */
import { describe, expect, it } from 'vitest';
import { initialTeach, reduceTeach, teachCommit, teachLine, type TeachEvent, type TeachState } from '../src/core/send-word-teach.js';

const run = (s: TeachState, ...es: TeachEvent[]): TeachState => es.reduce(reduceTeach, s);
const heard = (text: string | null): TeachEvent => ({ type: 'heard', text });

describe('teach the send word', () => {
  it('pick → lead-in → three takes (variants kept) → test → done → commit', () => {
    let s = run(initialTeach(), { type: 'pick', text: 'Ship it!' });
    expect(s.step).toBe('leadin');
    expect(teachLine(s)).toMatch(/^Say: “Gnomon, I'm teaching my send word”/);
    s = run(s, heard("Gnomon I'm teaching my send word"), heard('ship it'), heard('Ship at.'), heard('banana bread'));
    expect(s.step).toBe('takes');
    expect(s.heard).toBe('banana bread');
    expect(s.hint).toMatch(/does not sound like/);
    s = run(s, heard('ship it'));
    expect(s.step).toBe('test');
    expect(s.variants).toEqual(['ship at']);
    s = run(s, heard('ship at'));
    expect(s.step).toBe('done');
    expect(teachCommit(s)).toEqual({ op: 'start', word: 'ship it', variants: ['ship at'] });
  });
  it('validation: approval words are refused; a common word asks once', () => {
    expect(run(initialTeach(), { type: 'pick', text: 'approve' })).toMatchObject({ step: 'pick', hint: expect.stringMatching(/approval or command/) });
    const c = run(initialTeach(), { type: 'pick', text: 'okay' });
    expect(c.step).toBe('confirm-common');
    expect(run(c, { type: 'confirmCommon', yes: true }).step).toBe('leadin');
    expect(run(c, { type: 'confirmCommon', yes: false }).step).toBe('pick');
  });
  it('a withheld take (no words) asks again and counts nothing', () => {
    const s = run(initialTeach(), { type: 'pick', text: 'over and out' }, heard('teaching now'), heard(null));
    expect(s).toMatchObject({ step: 'takes', takes: [], heard: null });
    expect(teachCommit(s)).toBeNull();
  });
});
