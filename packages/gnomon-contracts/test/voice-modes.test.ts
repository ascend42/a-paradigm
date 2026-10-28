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
    expect([...VOICE_ORIGINS]).toEqual(['hand', 'voice', 'voice-unverified']);
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
    expect(originOf('unverified')).toBe('voice-unverified'); // Dictate: Enter sent an unverified voice's words (clamped)
    for (const x of ['key', 'release', undefined, 'voice', 7]) expect(originOf(x)).toBe('hand');
  });

  it('the module is not a clientApiId input (the golden literal is unchanged)', () => {
    expect(CLIENT_API_ID).toBe('sha256:fed7e22ca4e35405f65592e3a3d829b33beeaada98b7321483496f4dd185c4a3');
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

  it('Aegis H-1: the variant guard refuses function words, common words, short takes and a different word count', () => {
    // the poisoning cases: each is within Metaphone distance 2 of the word's key
    for (const heard of ['and', 'end', 'so', 'the', 'a']) expect(acceptableVariant(heard, 'send'), heard).toBe(false);
    for (const heard of ['of', 'or', 'for', 'off']) expect(acceptableVariant(heard, 'over'), heard).toBe(false);
    expect(acceptableVariant('okay', 'over')).toBe(false); // SEND_WORD_COMMON
    expect(acceptableVariant('send it', 'send')).toBe(false); // word count
    expect(acceptableVariant('send', 'send it')).toBe(false);
    expect(acceptableVariant('and it', 'send it')).toBe(false); // only function words
    expect(acceptableVariant('approve', 'approve')).toBe(true); // the word itself always is (validateSendWord refuses it elsewhere)
    expect(acceptableVariant('deny', 'dent')).toBe(false); // never a command or approval phrase
    // the relative bound: a 3-character key (SNT) allows distance 1 only
    expect(metaphone('send')).toBe('SNT');
    expect(acceptableVariant('sand', 'send')).toBe(true); // decided: a real mishearing that passes is kept (droppable at save)
    expect(acceptableVariant('sent', 'send')).toBe(true);
    expect(metaphone('slim')).toBe('SLM');
    expect(acceptableVariant('slim', 'send')).toBe(false); // distance 2: the old flat bound took it, the relative bound does not
    expect(acceptableVariant('ship at', 'ship it')).toBe(true); // a longer key keeps distance 2
  });

  it('Aegis M-3: canonicalSendWord applies the variant guard on every path (a stored poisoned variant is dropped)', () => {
    expect(canonicalSendWord({ text: 'send', variants: ['and', 'so', 'sand', 'end', 'sent'] })).toEqual({ text: 'send', variants: ['sand', 'sent'] });
    expect(canonicalSendWord({ text: 'over', variants: ['of', 'or', 'for'] })).toEqual({ text: 'over', variants: [] });
    expect(canonicalSendWord({ text: 'ship it', variants: ['shipped'] })).toEqual({ text: 'ship it', variants: [] }); // word count
    const w = canonicalSendWord({ text: 'send', variants: ['and'] })!;
    expect(isSendWord('and', w)).toBe(false);
    expect(isSendWord('send', w)).toBe(true);
  });
});

describe('the attended send-word trial (spec §14.7 trial semantics)', () => {
  it('one correct take is ready to save, with no lead-in', async () => {
    const { startSendWordTrial, recordTrialTake, trialSaveable, trialTakeNumber } = await import('../src/index.js');
    const s0 = startSendWordTrial('send')!;
    expect(trialTakeNumber(s0)).toBe(1);
    const s1 = recordTrialTake(s0, 'Send.');
    expect(s1).toMatchObject({ takes: 1, correct: 1, state: 'ready', last: { heard: 'send', verdict: 'correct' } });
    expect(trialTakeNumber(s1)).toBeNull();
    expect(trialSaveable(s1)).toEqual({ text: 'send', variants: [] });
  });
  it('a near mishearing is kept as a variant; the save waits for a correct take', async () => {
    const { startSendWordTrial, recordTrialTake, trialSaveable, trialTakeNumber } = await import('../src/index.js');
    let s = recordTrialTake(startSendWordTrial('send')!, 'sand');
    expect(s).toMatchObject({ takes: 1, correct: 0, state: 'listening', variants: ['sand'], last: { verdict: 'variant' } });
    expect(trialSaveable(s)).toBeNull();
    expect(trialTakeNumber(s)).toBe(2);
    s = recordTrialTake(s, 'Naman, I am teaching my send word');
    expect(s.last).toEqual({ heard: null, verdict: 'unclear' }); // too long: never kept or shown
    s = recordTrialTake(s, 'send');
    expect(trialSaveable(s)).toEqual({ text: 'send', variants: ['sand'] });
    // the counter stops: a take after ready changes nothing
    expect(recordTrialTake(s, 'send')).toBe(s);
  });
  it('Aegis H-1: a poisoning take is unlike, never a variant; the human can drop a collected variant at save', async () => {
    const { startSendWordTrial, recordTrialTake, classifyTrialTake, trialSaveable } = await import('../src/index.js');
    for (const heard of ['and', 'so', 'end']) expect(classifyTrialTake(heard, 'send').verdict, heard).toBe('unlike');
    for (const heard of ['of', 'or', 'for']) expect(classifyTrialTake(heard, 'over').verdict, heard).toBe('unlike');
    let s = startSendWordTrial('send')!;
    for (const heard of ['and', 'sand', 'sent']) s = recordTrialTake(s, heard);
    expect(s.variants).toEqual(['sand', 'sent']);
    s = recordTrialTake(s, 'send');
    expect(trialSaveable(s)).toEqual({ text: 'send', variants: ['sand', 'sent'] });
    expect(trialSaveable(s, ['Sent!', 'not collected'])).toEqual({ text: 'send', variants: ['sand'] });
  });
  it('a command or approval phrase is never a variant; four misses exhaust the trial', async () => {
    const { startSendWordTrial, recordTrialTake, classifyTrialTake, trialTakeNumber, SEND_WORD_TRIAL_MAX_TAKES } = await import('../src/index.js');
    expect(classifyTrialTake('stop', 'top').verdict).toBe('unlike');
    expect(classifyTrialTake('hello there', 'send').verdict).toBe('unlike');
    let s = startSendWordTrial('over')!;
    for (let i = 0; i < SEND_WORD_TRIAL_MAX_TAKES + 2; i++) s = recordTrialTake(s, 'banana');
    expect(s).toMatchObject({ takes: SEND_WORD_TRIAL_MAX_TAKES, correct: 0, state: 'exhausted' });
    expect(trialTakeNumber(s)).toBeNull();
    expect(startSendWordTrial('approve')).toBeNull();
  });
  it('no suggestion is the product name', async () => {
    const { SEND_WORD_SUGGESTIONS } = await import('../src/index.js');
    expect(SEND_WORD_SUGGESTIONS.some((w) => /gnomon/i.test(w))).toBe(false);
    expect(SEND_WORD_SUGGESTIONS.slice(0, 3)).toEqual(['send', 'send it', 'over']);
  });
});
