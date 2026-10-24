/** #gui voice presets (TD-2026-10-21-514): preset parse, liability ack per user, send ceiling, labels. Pure. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACK_KEY_PREFIX, ACK_TEXT, acked, ackedAt, ackWhen, riskSentence, saidTag, voiceWho, attachSend, choosePreset, parsePreset, policyOf, recordAck, sendWordOf, sentLabel } from '../src/core/voice-presets.js';
import { chatItems } from '../src/core/store.js';
import { captureOf, parseCapturePref } from '../src/core/voice-presets.js';
import { clientRequest } from '../src/core/voice-client.js';

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
    expect(ACK_TEXT).toBe('Anyone near my mic can send for me: the send word sends my whole draft, and it runs like a message I typed.');
    // Aegis L-1 (TD-2026-10-23-496): an acknowledgement of the OLD text no longer counts: the risk check is offered again
    const old = new Map<string, string>([[`${ACK_KEY_PREFIX}p:abcdefgh/me`, 'I understand a misheard or other voice can send for me; edits will still ask.']]);
    const store = { getItem: (k: string) => old.get(k) ?? null, setItem: (k: string, v: string) => void old.set(k, v), removeItem: (k: string) => void old.delete(k) };
    expect(acked(store as never, 'p:abcdefgh/me')).toBe(false);
    // TD-2026-10-23-939 re-version: the TD-2026-10-23-496 text ("Edits will still ask") no longer counts either
    old.set(`${ACK_KEY_PREFIX}p:abcdefgh/me`, 'Anyone near my mic can send for me: the send word sends my whole draft. Edits will still ask.');
    expect(acked(store as never, 'p:abcdefgh/me')).toBe(false);
    expect(choosePreset('send-word', { acked: acked(store as never, 'p:abcdefgh/me'), sendWord: { text: 'over', variants: [] } })).toBe('needs-ack');
    expect(choosePreset('send-word', { acked: acked(st, 'p:a/me'), sendWord: null })).toBe('needs-ack');
    expect(choosePreset('dictate', { acked: false, sendWord: null })).toBe('apply');
    expect(ackedAt(st, 'p:a/me')).toBeNull();
    recordAck(st, 'p:a/me', new Date('2026-10-21T09:00:00.000Z'));
    expect(acked(st, 'p:a/me')).toBe(true);
    expect(ackedAt(st, 'p:a/me')).toBe('2026-10-21T09:00:00.000Z'); // Luna #3: the risk row says when
    expect(ackedAt(st, 'p:a/other')).toBeNull();
    expect(ackWhen('2026-10-21T09:00:00.000Z', new Date('2026-10-21T12:00:00.000Z'))).toBe('today');
    expect(ackWhen(null)).toBe('');
    expect(riskSentence({ word: 'send it' })).toBe("When you say “send it”, Gnomon sends everything in the draft, even words it couldn't check as you. Anyone near your mic, or a video playing, can send with this word, and a voice-sent turn runs under your run mode and Always rules, like a message you typed.");
    expect(riskSentence({ word: null, pieces: true })).not.toMatch(/asks you first/);
    expect(acked(st, 'p:a/other')).toBe(false);
    expect(choosePreset('send-word', { acked: true, sendWord: null })).toBe('needs-word');
    expect(choosePreset('send-word', { acked: true, sendWord: { text: 'over', variants: [] } })).toBe('apply');
    expect(choosePreset('pieces', { acked: true, sendWord: null })).toBe('apply');
  });
  it('the capture kind the voice app starts with: Talk is ptt; ambient presets follow the listening choice', () => {
    expect(captureOf('talk', 'toggle')).toBe('ptt');
    expect(captureOf('send-word', parseCapturePref('toggle'))).toBe('toggle');
    expect(captureOf('dictate', parseCapturePref(null))).toBe('open');
    expect(clientRequest('start', 'toggle')).toEqual({ kind: 'request.voice.client', payload: { op: 'start', capture: 'toggle' } });
    expect(clientRequest('stop', 'toggle')).toEqual({ kind: 'request.voice.client', payload: { op: 'stop' } });
  });
  it('the transcript carries the sent label on a voice message', () => {
    const rows = [
      { seq: 5, kind: 'voice.turn.user', session: 'hs:1', payload: { turnId: '1', speakerId: 'spk:abcdefgh/matt', speakerEnrolled: true, forwardable: true, text: 'fix it', mode: 'conversation' } },
      { seq: 6, kind: 'turn.sent', session: 'hs:1', payload: { source: 'voice', origin: 'voice', sentBy: 'word', voiceTurnSeqs: [5], voiceTurnSeq: 5 } },
    ];
    const it = chatItems(rows.map((r) => ({ ...r, view: 'full' })) as never).items.find((x) => x.role === 'user');
    expect(it).toMatchObject({ sentLabel: 'spoken · sent by send word' });
    expect(it).not.toHaveProperty('asksFirst'); // TD-2026-10-23-939: the plain origin, nothing asks first
  });
  it('reads the held word and labels sent turns from turn.sent', () => {
    expect(sendWordOf({ voice: { sendWord: { text: 'Over', variants: [] } } })).toEqual({ text: 'over', variants: [] });
    expect(sendWordOf({ voice: {} })).toBeNull();
    expect(sentLabel({ origin: 'voice', sentBy: 'word', source: 'voice' })).toEqual({ label: 'spoken · sent by send word' });
    expect(sentLabel({ origin: 'voice', sentBy: 'piece' })).toEqual({ label: 'spoken · sent as a piece' });
    expect(sentLabel({ origin: 'hand', source: 'voice' })).toEqual({ label: 'spoken · sent by you' });
    expect(sentLabel({ origin: 'hand' })).toBeNull();
    expect(sentLabel({ origin: 'voice', sentBy: 'hotkey' })).toEqual({ label: 'spoken · sent by send-now' });
    expect(sentLabel({ origin: 'hand', sentBy: 'release', source: 'voice' })).toEqual({ label: 'spoken · sent on release' });
  });
});

describe('voice-sent labels in words (Luna #10)', () => {
  it('"you · voice · spoken · sent by <how>", "voice · said aloud", "voice · spoken part"; no glyph in the page sites', () => {
    expect(voiceWho({ speaker: 'you', edited: false, sent: 'spoken · sent by send word' })).toEqual({ who: 'you · voice', sent: '· spoken · sent by send word' });
    expect(voiceWho({ speaker: 'matt', edited: false, sent: null })).toEqual({ who: 'matt · voice', sent: '· spoken' });
    expect(voiceWho({ speaker: 'voice', edited: false, sent: null }).who).toBe('voice'); // the unnamed-speaker fallback (store speakerName) never doubles
    expect(voiceWho({ speaker: 'you', edited: true, sent: 'spoken · sent by you' }).sent).toBe('· spoken · sent by you · edited');
    expect([saidTag('kernel'), saidTag('reply')]).toEqual(['voice · said aloud', 'voice · spoken part']); // board gnomon-status-colour: the word, never a hue
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const app = readFileSync(path.join(root, 'src', 'ui', 'app.ts'), 'utf8');
    const html = readFileSync(path.join(root, 'static', 'index.html'), 'utf8');
    for (const glyph of ['`🎙', "'🎙", '🔊 said aloud', '🗣 spoken part', '`⚠ ${dev}`']) expect(app, glyph).not.toContain(glyph);
    expect(html).not.toMatch(/⏹ Stop speaking/);
  });
});
