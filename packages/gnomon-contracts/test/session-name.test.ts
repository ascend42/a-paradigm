/**
 * 8.0:session-rename: request.session.rename{hsid, name} → session.renamed{hsid, name}. The name is display text:
 * normalizeSessionName is the ONE normalisation (the §4.5 sanitizer, whitespace folded, trimmed, bounded) and
 * isSessionName the structural check validateKindPayload runs on both rows.
 */
import { describe, expect, it } from 'vitest';
import {
  CLIENT_API_DESCRIPTOR,
  defaultLabelsFor,
  EVENT_KINDS,
  isSessionName,
  kindOwner,
  KIND_PAYLOADS,
  normalizeSessionName,
  sanitizeDisplayText,
  SESSION_NAME_INPUT_MAX,
  SESSION_NAME_MAX,
  validateKindPayload,
} from '../src/index.js';

const HSID = 'hsid:v1:01J9Z8Y7X6W5V4T3S2R1Q0P9N8';

describe('normalizeSessionName: the one normalisation', () => {
  it('trims and folds every whitespace run (tab, newline, NBSP) to one space', () => {
    expect(normalizeSessionName('  Refactor   the\tlog\nreader  ')).toEqual({ ok: true, name: 'Refactor the log reader', flags: [] });
    expect(normalizeSessionName('a  b')).toMatchObject({ ok: true, name: 'a b' });
  });
  it("empty (or only whitespace) is '' — the reset to the derived title", () => {
    expect(normalizeSessionName('')).toEqual({ ok: true, name: '', flags: [] });
    expect(normalizeSessionName('   \t ')).toEqual({ ok: true, name: '', flags: [] });
  });
  it('runs the §4.5 sanitizer: invisible characters stripped, bidi controls made visible, flags kept', () => {
    const r = normalizeSessionName('pay​ment ‮evil');
    expect(r).toEqual({ ok: true, name: `payment ${sanitizeDisplayText('‮').text}evil`, flags: ['hidden-chars', 'bidi'] });
  });
  it('refuses control characters (C0 but tab/LF/CR, DEL, C1) instead of dropping them silently', () => {
    for (const s of ['a\u0000b', 'a\u001bb', 'a\u007fb', 'a\u0085b', 'a\u0007']) expect(normalizeSessionName(s)).toEqual({ ok: false, why: 'control-character' });
    expect(normalizeSessionName('a\r\nb')).toMatchObject({ ok: true, name: 'a b' });
  });
  it(`bounds the length: at most ${SESSION_NAME_MAX} code points after normalisation, ${SESSION_NAME_INPUT_MAX} code units in`, () => {
    expect(normalizeSessionName('x'.repeat(SESSION_NAME_MAX))).toMatchObject({ ok: true });
    expect(normalizeSessionName('x'.repeat(SESSION_NAME_MAX + 1))).toEqual({ ok: false, why: 'too-long' });
    // code points, not code units: 80 astral characters fit
    expect(normalizeSessionName('😀'.repeat(SESSION_NAME_MAX))).toMatchObject({ ok: true });
    expect(normalizeSessionName(`${' '.repeat(SESSION_NAME_INPUT_MAX)}x`)).toEqual({ ok: false, why: 'too-long' });
    // surrounding whitespace does not count once trimmed
    expect(normalizeSessionName(`  ${'x'.repeat(SESSION_NAME_MAX)}  `)).toMatchObject({ ok: true });
  });
  it('refuses a format character the sanitizer keeps, and a non-string', () => {
    expect(normalizeSessionName('a؀b')).toEqual({ ok: false, why: 'format-character' });
    expect(normalizeSessionName(42)).toEqual({ ok: false, why: 'not-a-string' });
    expect(normalizeSessionName(null)).toEqual({ ok: false, why: 'not-a-string' });
  });
  it('the output passes isSessionName and is a fixed point', () => {
    for (const s of ['  a  b ', 'pay​ment', '‮RLO', 'ünïcödé 日本語', '😀 emoji', '']) {
      const r = normalizeSessionName(s);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(isSessionName(r.name)).toBe(true);
      expect(normalizeSessionName(r.name)).toMatchObject({ ok: true, name: r.name });
    }
  });
});

describe('isSessionName: the structural check of the rows', () => {
  it('accepts normalised names and refuses the rest', () => {
    expect(isSessionName('Fix the build')).toBe(true);
    expect(isSessionName('')).toBe(true);
    for (const bad of [' lead', 'trail ', 'two  spaces', 'tab\there', 'nl\nhere', 'a b', 'a​b', 'a\u0000b', 'x'.repeat(SESSION_NAME_MAX + 1), '\ud800', 7, null]) expect(isSessionName(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe('the kinds', () => {
  it('request.session.rename and session.renamed are kernel-owned, closed {hsid, name}, name a sensitive field', () => {
    for (const k of ['request.session.rename', 'session.renamed']) {
      expect(kindOwner(k)).toBe('kernel');
      expect(KIND_PAYLOADS[k]).toEqual(['hsid', 'name']);
      expect(EVENT_KINDS[k]!.reserved).toBe('8.0:session-rename');
      expect(EVENT_KINDS[k]!.fieldLabels).toEqual({ name: 'sensitive' });
      expect(defaultLabelsFor(k)).toEqual({ audience: 'private', sensitivity: 'normal' });
      expect(validateKindPayload(k, { hsid: HSID, name: 'Fix the build' })).toEqual([]);
      expect(validateKindPayload(k, { hsid: HSID, name: '' })).toEqual([]);
      expect(validateKindPayload(k, { hsid: HSID, name: ' untrimmed' }).length).toBeGreaterThan(0);
      expect(validateKindPayload(k, { hsid: HSID, name: 'x'.repeat(SESSION_NAME_MAX + 1) }).length).toBeGreaterThan(0);
      expect(validateKindPayload(k, { hsid: 'not-an-hsid', name: 'a' }).length).toBeGreaterThan(0);
      expect(validateKindPayload(k, { hsid: HSID }).length).toBeGreaterThan(0);
      expect(validateKindPayload(k, { hsid: HSID, name: 'a', route: 'x' }).length).toBeGreaterThan(0);
    }
  });
  it('the descriptor publishes the limits (so clientApiId covers them)', () => {
    expect((CLIENT_API_DESCRIPTOR as unknown as { sessionRename: unknown }).sessionRename).toEqual({ nameMax: SESSION_NAME_MAX, inputMax: SESSION_NAME_INPUT_MAX, reset: '' });
  });
});
