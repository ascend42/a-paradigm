/**
 * TD-2026-10-21-514: the capture x send-policy contract and #send-word-matcher (pure, frozen, no clientApiId move).
 */
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_KINDS, CLIENT_API_ID, SEND_POLICIES, SENT_BY, VOICE_ORIGINS, VOICE_PRESETS, acceptableVariant, canonicalSendWord,
  isSendWord, matchSendWord, metaphone, originOf, presetOf, validPair, validateSendWord,
} from '../src/index.js';

describe('voice modes (TD-2026-10-21-514)', () => {
  it('the closed sets are frozen', () => {
    expect([...CAPTURE_KINDS]).toEqual(['ptt', 'open', 'toggle']);
    expect([...SEND_POLICIES]).toEqual(['key', 'countdown', 'word', 'pieces']);
    expect([...SENT_BY]).toEqual(['key', 'release', 'word', 'piece', 'hotkey']);
    expect([...VOICE_ORIGINS]).toEqual(['hand', 'voice']);
    for (const x of [CAPTURE_KINDS, SEND_POLICIES, SENT_BY, VOICE_ORIGINS, VOICE_PRESETS, VOICE_PRESETS.talk]) expect(Object.isFrozen(x)).toBe(true);
  });

  it('a countdown is never valid with ambient capture; word and pieces need ambient capture', () => {
    expect(validPair('ptt', 'countdown')).toBe(true);
    expect(validPair('open', 'countdown')).toBe(false);
    expect(validPair('toggle', 'countdown')).toBe(false);
    for (const c of ['ptt', 'open', 'toggle']) expect(validPair(c, 'key')).toBe(true);
    for (const s of ['word', 'pieces']) {
      expect(validPair('ptt', s)).toBe(false);
      expect(validPair('open', s)).toBe(true);
      expect(validPair('toggle', s)).toBe(true);
    }
    expect(validPair('open', 'shout')).toBe(false);
    for (const p of Object.values(VOICE_PRESETS)) expect(validPair(p.capture, p.send)).toBe(true);
    expect(presetOf('toggle', 'word')).toBe('send-word');
    expect(presetOf('ptt', 'countdown')).toBe('talk');
  });

  it('origin is voice only for word and piece', () => {
    expect(originOf('word')).toBe('voice');
    expect(originOf('piece')).toBe('voice');
    expect(originOf('hotkey')).toBe('voice'); // Aegis M-5: the voice app's send-now press
    for (const x of ['key', 'release', undefined, 'voice', 7]) expect(originOf(x)).toBe('hand');
  });

  it('the module is not a clientApiId input (the golden literal is unchanged)', () => {
    expect(CLIENT_API_ID).toBe('sha256:c4e2c7d97cd09b0809eb2a1672e4bf37bf570b640abb0a6b9735bb4eeabfe2c9');
  });
});

describe('#send-word-matcher', () => {
  const w = canonicalSendWord({ text: 'Over and out', variants: ['over an out', 'Over and out!'] })!;
  it('canonicalises: cleaned text, unique variants different from the text', () => {
    expect(w).toEqual({ text: 'over and out', variants: ['over an out'] });
    expect(canonicalSendWord({ text: 'approve' })).toBeNull();
    expect(canonicalSendWord({ text: 'over', variants: new Array(9).fill('x') })).toBeNull();
  });

  it('exact, variant, near, none — a sentence containing the word is none', () => {
    expect(matchSendWord('Over and out.', w)).toBe('exact');
    expect(matchSendWord('over an out', w)).toBe('variant');
    expect(matchSendWord('over and about', w)).toBe('near');
    expect(matchSendWord('please do it over and out', w)).toBe('none');
    expect(matchSendWord('fix the tests', w)).toBe('none');
    expect(isSendWord('over and out', w)).toBe(true);
    expect(isSendWord('over and about', w)).toBe(false);
    expect(matchSendWord('over', null)).toBe('none');
  });

  it('validation refuses approval and command phrases and warns on common words', () => {
    expect(validateSendWord('allow')).toEqual({ ok: false, reason: 'reserved' });
    expect(validateSendWord('yes please')).toEqual({ ok: false, reason: 'reserved' });
    expect(validateSendWord('one two three four')).toEqual({ ok: false, reason: 'too-many-words' });
    expect(validateSendWord('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(validateSendWord('<script>')).toEqual({ ok: false, reason: 'chars' });
    expect(validateSendWord('okay')).toEqual({ ok: true, text: 'okay', warn: 'common' });
    expect(validateSendWord('Ship it!')).toEqual({ ok: true, text: 'ship it' });
  });

  it('metaphone keys and variant acceptance', () => {
    expect(metaphone('Thomas')).toBe('0MS');
    expect(metaphone('knight')).toBe('NT');
    expect(metaphone('phone')).toBe('FN');
    expect(acceptableVariant('ship at', 'ship it')).toBe(true);
    expect(acceptableVariant('banana bread', 'ship it')).toBe(false);
  });
});
