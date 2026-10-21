/** #gui voice presets (TD-2026-10-21-514): preset parse, liability ack per user, send ceiling, labels. Pure. */
import { describe, expect, it } from 'vitest';
import { ACK_TEXT, acked, attachSend, choosePreset, CLAMP_CHIP, parsePreset, policyOf, recordAck, sendWordOf, sentLabel } from '../src/core/voice-presets.js';

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
