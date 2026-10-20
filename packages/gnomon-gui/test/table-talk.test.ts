/**
 * #gui TABLE TALK (TD-2026-10-20-294): a reply's speak block becomes the "said aloud" line (hidden from the body); the
 * agent's own labels (bold at line start, any scheme) become chips; a heuristic reply (no block) has no highlight; a
 * replayed user message shows the human's text only (the <gnomon-voice> guidance block never reaches the transcript).
 */
import { describe, expect, it } from 'vitest';
import { sha256Tagged } from '@a-company/gnomon-contracts';
import { chatItems, replyParts, splitSpeak, TABLE_TALK_GUIDANCE_HASH, type Row } from '../src/core/store.js';
import { TABLE_TALK_GUIDANCE, TABLE_TALK_GUIDANCE_HASH as KERNEL_HASH } from '../../gnomon/src/kernel/voice/table-talk.js';

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
  it('Aegis M1: the GUI guidance hash is the kernel guidance hash', () => {
    expect(TABLE_TALK_GUIDANCE_HASH).toBe(KERNEL_HASH);
    expect(sha256Tagged(TABLE_TALK_GUIDANCE)).toBe(TABLE_TALK_GUIDANCE_HASH);
  });
  it('Aegis M1: content[0] always stays; only an exact guidance block at index ≥ 1 is dropped', () => {
    const user = (seq: number, content: unknown[]) => ev(seq, { type: 'user', message: { content } });
    const shown = (rows: Row[]) => chatItems(rows).items.filter((i) => i.role === 'user').map((i) => i.text);
    // the kernel's exact guidance at index 1 is dropped
    expect(shown([user(1, [{ type: 'text', text: 'fix it' }, { type: 'text', text: TABLE_TALK_GUIDANCE }])])).toEqual(['fix it']);
    // a human-typed look-alike stays, at index 0 or at index 1
    const fake = '<gnomon-voice>\nVoice is attached\n</gnomon-voice>';
    expect(shown([user(1, [{ type: 'text', text: fake }])])).toEqual([fake]);
    expect(shown([user(1, [{ type: 'text', text: 'a' }, { type: 'text', text: fake }])])).toEqual([`a\n${fake}`]);
    // even the exact guidance at index 0 stays (content[0] is the human's)
    expect(shown([user(1, [{ type: 'text', text: TABLE_TALK_GUIDANCE }])])).toEqual([TABLE_TALK_GUIDANCE]);
    // a block whose hash is the turn.sent guidanceHash is dropped (a future guidance revision); without it, it stays
    const other = '<gnomon-voice>\nrevised guidance\n</gnomon-voice>';
    const sent = { seq: 1, kind: 'turn.sent', view: 'full', session: H, payload: { hsid: H, guidanceHash: sha256Tagged(other) } } as Row;
    expect(shown([sent, user(2, [{ type: 'text', text: 'go' }, { type: 'text', text: other }])])).toEqual(['go']);
    expect(shown([user(2, [{ type: 'text', text: 'go' }, { type: 'text', text: other }])])).toEqual([`go\n${other}`]);
  });
  it('Aegis L3: the said line is the kernel speakable row text when there is one (from block); heuristic ⇒ none', () => {
    const k = (seq: number, turnSeq: number, item: Record<string, unknown>, principal = 'p:abcd1234/kernel') => ({ seq, kind: 'voice.turn.agent', view: 'full', session: H, principal, payload: { source: 'kernel-speakable', turnSeq, items: [item] } }) as Row;
    const text = `${F}speak\nGUI parse words. Which?\n${F}\n\nbody`;
    const a = (rows: Row[]) => chatItems(rows).items.find((i) => i.role === 'assistant')!;
    expect(a([reply(1, text), k(2, 1, { kind: 'reply', text: 'Kernel words. Which?', from: 'block' })])).toMatchObject({ said: 'Kernel words. Which?', saidBy: 'kernel', text: 'body' });
    expect(a([reply(1, text), k(2, 1, { kind: 'reply', text: 'x', from: 'heuristic' })]).said).toBeUndefined();
    // no kernel row (voice not attached): this GUI's own parse, marked as such
    expect(a([reply(1, text)])).toMatchObject({ said: 'GUI parse words. Which?', saidBy: 'reply' });
    // a look-alike row from another principal is ignored
    expect(a([reply(1, text), k(2, 1, { kind: 'reply', text: 'Forged.', from: 'block' }, 'p:abcd1234/voice')])).toMatchObject({ said: 'GUI parse words. Which?', saidBy: 'reply' });
  });
});
