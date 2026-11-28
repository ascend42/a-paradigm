/**
 * The content tray's model (design component content-tray; boards S1.1 pass B): the wells come from the content
 * palette's own names, and a typed colour goes through the ONE shared check. A refused colour is never applied and
 * never stepped to a passing one: the nearest swatch is an offer.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT_SWATCH_NAMES, contentColourCheck, nightOf } from '@a-company/gnomon-contracts';
import { customEntry, heldRefusals, judgeToken, trayRefusalLine, MARKER_OFF_TITLE, TRAY_FILL, TRAY_LINE, TRAY_WEIGHTS, wellName } from '../src/core/board-tray.js';
import { BOARD_WEIGHTS } from '../src/core/board.js';

describe('#gui-board content tray rows', () => {
  it('line: ink, graphite, then the hues with a line value (lemon has none)', () => {
    expect(TRAY_LINE).toEqual(['ink', 'graphite', 'leaf', 'sky', 'cobalt', 'orchid', 'raspberry']);
    for (const t of TRAY_LINE) expect(contentColourCheck(t, 'line'), t).toEqual({ ok: true });
  });
  it('fill: none (the slashed well), paper, then every hue', () => {
    expect(TRAY_FILL).toEqual([null, 'paper', 'lemon', 'leaf', 'sky', 'cobalt', 'orchid', 'raspberry']);
    for (const t of TRAY_FILL) if (t !== null) expect(contentColourCheck(t, 'fill'), t).toEqual({ ok: true });
  });
  it('every well is a name the palette publishes, and every published name is a well', () => {
    const wells = new Set([...TRAY_LINE, ...TRAY_FILL.filter((t): t is string => t !== null)]);
    expect([...wells].sort()).toEqual([...CONTENT_SWATCH_NAMES].sort());
  });
  it('weights are fine, bold and marker (2, 4, 8); a well names itself', () => {
    expect(TRAY_WEIGHTS).toEqual(Object.keys(BOARD_WEIGHTS));
    expect(MARKER_OFF_TITLE).toBe('Marker is for the Stroke tool');
    expect([wellName(null), wellName('cobalt'), wellName('custom:#00897B')]).toEqual(['none', 'cobalt', 'custom']);
  });
});

describe('#gui-board custom colour', () => {
  it('a passing colour becomes a storable token with its night values printed (the specimen\'s line)', () => {
    const c = customEntry('#00897b', 'line');
    expect(c).toEqual({ ok: true, token: 'custom:#00897B', hex: '#00897B', night: { line: nightOf('#00897B', 'line'), fill: nightOf('#00897B', 'fill') }, line: 'custom · at night #47B3A4 as a line, #0F5950 as a fill' });
    expect(customEntry('808080', 'fill').ok).toBe(true); // the # may be left out (#00897B is too dark a fill: ink on it 4.24)
  });

  it.each([
    ['#B4382A', 'line', 'that is the failed colour', 'raspberry'],
    ['#C08A73', 'fill', 'that is a project colour', 'raspberry'],
    ['#5B4FD6', 'line', 'that is the knot colour', 'cobalt'],
  ] as Array<[string, 'line' | 'fill', string, string]>)('refused: %s as a %s → "%s", offering %s', (hex, role, why, offer) => {
    const c = customEntry(hex, role);
    expect(c).toEqual({ ok: false, why, offer, line: `✕ not used · ${why}` });
    // the refusal carries nothing storable: no token, no colour stepped towards a passing one
    expect(Object.keys(c).sort()).toEqual(['line', 'offer', 'ok', 'why']);
    expect(contentColourCheck(`custom:${hex}`, role).ok).toBe(false);
  });

  it('refuses exactly when the shared check refuses, and offers exactly what it offers', () => {
    for (const hex of ['#00897B', '#B4382A', '#FF7A00', '#111111', '#C08A73', '#5B4FD6', '#FF7A66', '#FFC15A', '#A79CFF', '#F6E3B8', '#8FB0AE', '#FFFFFF', '#000000']) {
      for (const role of ['line', 'fill'] as const) {
        const want = contentColourCheck(`custom:${hex}`, role);
        const got = customEntry(hex, role);
        expect(got.ok, `${hex} ${role}`).toBe(want.ok);
        if (!want.ok && !got.ok) expect(got.offer, `${hex} ${role}`).toBe(want.offer);
        if (!got.ok) expect(got.line).toMatch(/^✕ not used · \S/);
      }
    }
  });

  it('a colour the night theme reserves says so; a fill that would hide the ink says that', () => {
    const night = ['#FF7A66', '#FFC15A', '#A79CFF'].map((h) => customEntry(h, 'line')).filter((c) => !c.ok);
    // a light day value that keeps clear of the reserved colours is refused by the contrast rule instead, in its words
    for (const c of night) expect(c.line).toMatch(/^✕ not used · ((at night this is|that is) (the failed colour|the warning colour|the knot colour|a project colour)|too faint to see on the board)$/);
    const guard = customEntry('#111111', 'fill');
    expect(guard).toMatchObject({ ok: false, why: 'as a fill it would hide the ink drawn on it', offer: null });
  });

  it('contrast_rule: the refusal row says why in the record\'s words and offers one swatch that works', () => {
    // a line too faint for the board; neutral, and not exempt
    expect(customEntry('#F8F5EE', 'line')).toEqual({ ok: false, why: 'too faint to see on the board', offer: 'sky', line: '✕ not used · too faint to see on the board' });
    // a fair line is an unfair paragraph: the text tool holds it to 4.5
    expect(customEntry('#767676', 'line').ok).toBe(true);
    expect(customEntry('#767676', 'line', { text: true })).toEqual({ ok: false, why: 'too faint to read as words', offer: 'graphite', line: '✕ not used · too faint to read as words' });
    expect(customEntry('#686868', 'line', { text: true }).ok).toBe(true);
    // a fill the ink would be too faint on
    expect(customEntry('#404040', 'fill')).toMatchObject({ ok: false, why: 'words would be too faint on it', line: '✕ not used · words would be too faint on it' });
    // orange passes as a fill and not as a line
    expect([customEntry('#FF8800', 'fill').ok, customEntry('#FF8800', 'line').ok]).toEqual([true, false]);
    // the pair, against the mark's other colour as the tool would draw it: 'Use ink' or 'Use paper'
    expect(customEntry('#858585', 'line', { other: 'cobalt' })).toEqual({ ok: false, why: "it would not show against this mark's fill", offer: 'ink', line: "✕ not used · it would not show against this mark's fill" });
    expect(customEntry('#858585', 'line', { other: 'lemon' }).ok).toBe(true);
    expect(customEntry('#22EE66', 'fill', { other: 'custom:#CC0066' })).toEqual({ ok: false, why: "this mark's line would not show against it at night", offer: 'paper', line: "✕ not used · this mark's line would not show against it at night" });
    expect(customEntry('#22EE66', 'fill', { other: 'ink' }).ok).toBe(true);
    // every offer passes, so pressing it always applies
    for (const [hex, role, ctx] of [['#F8F5EE', 'line', {}], ['#767676', 'line', { text: true }], ['#404040', 'fill', {}]] as const) {
      const c = customEntry(hex, role, ctx);
      expect(!c.ok && contentColourCheck(c.offer, role, ctx).ok).toBe(true);
    }
  });

  it('Mika P0b: the role after "not used", the chosen colour before a mark exists, the pair against every selected mark, and the held style', () => {
    expect(trayRefusalLine('too faint to see on the board', 'line')).toBe('✕ not used as a line · too faint to see on the board');
    expect(trayRefusalLine('too faint to see on the board', null)).toBe('✕ not used · too faint to see on the board');
    // before a mark exists (the tool's own style) the pair words name the chosen colour (C1, the orchestrator's ruling)
    expect(customEntry('#858585', 'line', { other: 'cobalt', chosen: true })).toMatchObject({ ok: false, why: "it would not show against the chosen fill", offer: 'ink' });
    expect(customEntry('#22EE66', 'fill', { other: 'custom:#CC0066', chosen: true })).toMatchObject({ ok: false, why: "the chosen line would not show against it at night", offer: 'paper' });
    // a selection: every selected mark's other colour is judged (S2a)
    expect(judgeToken('custom:#858585', 'line', { others: ['lemon', 'cobalt'] })).toMatchObject({ ok: false, offer: 'ink', contrast: true });
    expect(judgeToken('custom:#858585', 'line', { others: ['lemon', null] }).ok).toBe(true);
    expect(judgeToken('custom:#767676', 'line', { text: true, others: [] })).toMatchObject({ ok: false, why: 'too faint to read as words', offer: 'graphite' });
    // the held style as the next tool would draw it (S1): one entry per failing role, each with its own key
    expect(heldRefusals({ line: 'custom:#767676', fill: null }, { line: { text: true, chosen: true }, fill: null })).toEqual([{ role: 'line', why: 'too faint to read as words', offer: 'graphite', line: '✕ not used as a line · too faint to read as words' }]);
    expect(heldRefusals({ line: 'custom:#858585', fill: 'cobalt' }, { line: { other: 'cobalt', chosen: true }, fill: { other: 'custom:#858585', chosen: true } }).map((r) => [r.role, r.offer, r.line])).toEqual([
      ['line', 'ink', "✕ not used as a line · it would not show against the chosen fill"],
      ['fill', 'paper', "✕ not used as a fill · the chosen line would not show against it"],
    ]);
    expect(heldRefusals({ line: 'custom:#767676', fill: null }, { line: { other: null, chosen: true }, fill: null })).toEqual([]);
  });

  it('what is not six hex digits is not a colour, in plain words', () => {
    for (const bad of ['', '#12', 'red', '#GGGGGG', '#1234567', 'custom:#00897B']) expect(customEntry(bad, 'line')).toMatchObject({ ok: false, offer: null, why: 'six hex digits make a colour, like #00897B' });
  });
});
