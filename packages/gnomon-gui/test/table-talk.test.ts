/**
 * #gui TABLE TALK (TD-2026-10-20-294): a reply's speak block becomes the "said aloud" line (hidden from the body); the
 * agent's own labels (bold at line start, any scheme) become chips; a heuristic reply (no block) has no highlight; a
 * replayed user message shows the human's text only (the <gnomon-voice> guidance block never reaches the transcript).
 */
import { describe, expect, it } from 'vitest';
import { chatItems, replyParts, splitSpeak, type Row } from '../src/core/store.js';

const H = 'hs:01JAAAAAAAAAAAAAAAAAAAAAAA';
const F = '```';
const ev = (seq: number, line: unknown): Row => ({ seq, kind: 'turn.event', view: 'full', session: H, payload: { hsid: H, type: 'assistant', seq, line: JSON.stringify(line) } }) as Row;
const reply = (seq: number, text: string) => ev(seq, { type: 'assistant', message: { content: [{ type: 'text', text }] } });

describe('#gui table talk', () => {
  it('the speak block is the said line and is hidden from the body', () => {
    const { items } = chatItems([reply(1, `${F}speak\nTwo fixes, **A** and B, are below. Which one?\n${F}\n\n**A.** Patch the check\n**B.** Rewrite the parser`)]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ role: 'assistant', said: 'Two fixes, A and B, are below. Which one?', text: '**A.** Patch the check\n**B.** Rewrite the parser' });
    expect(items[0]!.text).not.toContain('speak');
  });
  it('a heuristic reply (no block) gets no said line and an unchanged body', () => {
    const { items } = chatItems([reply(1, 'Here is the plan.\n\nMore detail.')]);
    expect(items[0]!.said).toBeUndefined();
    expect(items[0]!.text).toBe('Here is the plan.\n\nMore detail.');
    expect(splitSpeak(`${F}speak\nhttps://x.example 123456\n${F}\nbody`)).toEqual({ said: null, body: `${F}speak\nhttps://x.example 123456\n${F}\nbody` });
  });
  it('an unclosed block runs to its first blank line; the rest stays in the body', () => {
    expect(splitSpeak(`${F}speak\nI fixed it. Run the tests?\n\nreference here`)).toEqual({ said: 'I fixed it. Run the tests?', body: 'reference here' });
  });
  it('labels are whatever the agent used: letters, numbers, names; none ⇒ one plain part', () => {
    expect(replyParts('Intro\n**A.** first\n**B)** second')).toEqual([{ text: 'Intro' }, { label: 'A', text: 'first' }, { label: 'B', text: 'second' }]);
    expect(replyParts('1. **1** run it\n- **2:** check it')).toEqual([{ label: '1', text: 'run it' }, { label: '2', text: 'check it' }]);
    expect(replyParts('**the parser** — the risky one\nplain')).toEqual([{ label: 'the parser', text: 'the risky one' }, { text: 'plain' }]);
    expect(replyParts('one thing, **bold** in the middle')).toEqual([{ text: 'one thing, **bold** in the middle' }]);
  });
  it('a replayed user message shows the first text block only (never the guidance)', () => {
    const { items } = chatItems([ev(1, { type: 'user', message: { content: [{ type: 'text', text: 'fix it' }, { type: 'text', text: '<gnomon-voice>\nVoice is attached\n</gnomon-voice>' }] } })]);
    expect(items.map((i) => [i.role, i.text])).toEqual([['user', 'fix it']]);
  });
});
