/** #gui voice presets (TD-2026-10-21-514): preset parse, liability ack per user, send ceiling, labels. Pure. */
import { describe, expect, it } from 'vitest';
import { ACK_TEXT, acked, attachSend, choosePreset, CLAMP_CHIP, clampedFrom, parsePreset, policyOf, recordAck, sendWordOf, sentLabel } from '../src/core/voice-presets.js';
import { chatItems } from '../src/core/store.js';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('voice presets', () => {
  it('parses, defaults to talk, maps to the send policy and the attach ceiling', () => {
    expect(parsePreset(null)).toBe('talk');
    expect(parsePreset('nonsense')).toBe('talk');
    expect(parsePreset('send-word')).toBe('send-word');
    expect(policyOf('talk')).toBe('countdown');
    expect(attachSend('pieces')).toBe('pieces');
    expect(attachSend('send-word')).toBe('word');
    expect(attachSend('dictate')).toBeNull();
  });
  it('Send word and Pieces need the one-time liability acknowledgement, recorded per user', () => {
    const st = mem();
    expect(ACK_TEXT).toBe('I understand a misheard or other voice can send for me; edits will still ask.');
    expect(choosePreset('send-word', { acked: acked(st, 'p:a/me'), sendWord: null })).toBe('needs-ack');
    expect(choosePreset('dictate', { acked: false, sendWord: null })).toBe('apply');
    recordAck(st, 'p:a/me');
    expect(acked(st, 'p:a/me')).toBe(true);
    expect(acked(st, 'p:a/other')).toBe(false);
    expect(choosePreset('send-word', { acked: true, sendWord: null })).toBe('needs-word');
    expect(choosePreset('send-word', { acked: true, sendWord: { text: 'over', variants: [] } })).toBe('apply');
    expect(choosePreset('pieces', { acked: true, sendWord: null })).toBe('apply');
  });
  it('the clamp chip shows while a voice-origin turn of the session is open (display only)', () => {
    const H = 'hs:1';
    expect(clampedFrom([{ kind: 'turn.sent', session: H, payload: { origin: 'voice', sentBy: 'word' } }], H)).toBe(true);
    expect(clampedFrom([{ kind: 'turn.sent', session: H, payload: { origin: 'voice' } }, { kind: 'turn.result', session: H, payload: {} }], H)).toBe(false);
    expect(clampedFrom([{ kind: 'turn.sent', session: 'hs:2', payload: { origin: 'voice' } }], H)).toBe(false);
    expect(clampedFrom([{ kind: 'turn.sent', session: H, payload: { origin: 'hand' } }], H)).toBe(false);
  });
  it('the transcript carries the sent label on a voice message', () => {
    const rows = [
      { seq: 5, kind: 'voice.turn.user', session: 'hs:1', payload: { turnId: '1', speakerId: 'spk:abcdefgh/matt', speakerEnrolled: true, forwardable: true, text: 'fix it', mode: 'conversation' } },
      { seq: 6, kind: 'turn.sent', session: 'hs:1', payload: { source: 'voice', origin: 'voice', sentBy: 'word', voiceTurnSeqs: [5], voiceTurnSeq: 5 } },
    ];
    const it = chatItems(rows.map((r) => ({ ...r, view: 'full' })) as never).items.find((x) => x.role === 'user');
    expect(it).toMatchObject({ sentLabel: 'spoken · sent by send word', asksFirst: true });
  });
  it('reads the held word and labels sent turns from turn.sent', () => {
    expect(sendWordOf({ voice: { sendWord: { text: 'Over', variants: [] } } })).toEqual({ text: 'over', variants: [] });
    expect(sendWordOf({ voice: {} })).toBeNull();
    expect(sentLabel({ origin: 'voice', sentBy: 'word', source: 'voice' })).toEqual({ label: 'spoken · sent by send word', asksFirst: true });
    expect(sentLabel({ origin: 'voice', sentBy: 'piece' })).toEqual({ label: 'spoken · sent as a piece', asksFirst: true });
    expect(sentLabel({ origin: 'hand', source: 'voice' })).toEqual({ label: 'spoken · sent by you', asksFirst: false });
    expect(sentLabel({ origin: 'hand' })).toBeNull();
    expect(CLAMP_CHIP).toBe('Voice turn: edits ask first');
  });
});
