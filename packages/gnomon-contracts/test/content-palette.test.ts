/**
 * content-palette:v1 (Luna's S1.1 design; Aegis rulings 1 to 4). The vectors and the tables come from the design
 * record (`.atelier/systems/gnomon/design-system.yaml`, `content_palette`); this file checks the package against
 * them, and checks that the package's copies of the foundations colours still equal the foundations.
 */
import * as fs from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONTENT_CONTRAST_FLOORS, CONTENT_CONTRAST_SURFACES, CONTENT_CONTRAST_WORDS, CONTENT_EDGE_ON_FILL_MIN_RATIO, CONTENT_FILL_GUARD_TOKENS, CONTENT_MIN_DISTANCE, CONTENT_NEUTRALS, CONTENT_PALETTE_V1, CONTENT_RESERVED_COLOURS, CONTENT_RESERVED_EXCEPTIONS, CONTENT_SWATCH_NAME_PATTERN,
  CONTENT_SWATCH_NAMES, CONTENT_SWATCHES, CONTENT_THEME_TOKENS, CUSTOM_COLOUR_PATTERN, LAB_QUANTUM, NIGHT_TRANSFORM, SRGB_LINEAR,
  colourDistanceQSq, coloursClear, contentColourCheck, contentContrastFix, contentContrastWords, contentPairCheck, contrastClears, resolveContentPair, contentPaletteProblems, contrastRatio, customColourPasses, isContentColour, isNeutralColour, nearestSwatch, nightOf, oklabQ, resolveContentColour,
} from '../src/content-palette.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..', '..');
const dist = (a: string, b: string): number => Math.sqrt(colourDistanceQSq(a, b)) / LAB_QUANTUM;
const worst = (hex: string, theme: 'day' | 'night'): number => Math.min(...Object.values(CONTENT_RESERVED_COLOURS[theme]).map((r) => dist(hex, r)));

describe('content-palette:v1 tables', () => {
  it('contentPaletteProblems() is empty', () => {
    expect(contentPaletteProblems()).toEqual([]);
    expect(CONTENT_PALETTE_V1).toBe('content-palette:v1');
    expect(CONTENT_MIN_DISTANCE).toBe(0.06);
    expect(CONTENT_EDGE_ON_FILL_MIN_RATIO).toBe(3);
  });

  it('names: the protocol list, neutrals first', () => {
    expect(CONTENT_SWATCH_NAMES).toEqual(['ink', 'graphite', 'paper', 'lemon', 'leaf', 'sky', 'cobalt', 'orchid', 'raspberry']);
    for (const n of CONTENT_SWATCH_NAMES) expect(CONTENT_SWATCH_NAME_PATTERN.test(n)).toBe(true);
    expect(Object.isFrozen(CONTENT_SWATCH_NAMES) && Object.isFrozen(CONTENT_SWATCHES) && Object.isFrozen(CONTENT_SWATCHES[0]!.day)).toBe(true);
  });

  it('the linearisation table is 256 literal entries of the sRGB transfer function', () => {
    expect(SRGB_LINEAR).toHaveLength(256);
    expect(SRGB_LINEAR[0]).toBe(0);
    expect(SRGB_LINEAR[255]).toBe(1);
    for (let i = 0; i < 256; i++) {
      const c = i / 255;
      expect(Math.abs(SRGB_LINEAR[i]! - (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))).toBeLessThan(1e-15);
      if (i > 0) expect(SRGB_LINEAR[i]!).toBeGreaterThan(SRGB_LINEAR[i - 1]!);
    }
  });

  it('OKLab reference points, as integers', () => {
    expect(oklabQ('#FFFFFF')).toEqual([10000, 0, 0]);
    expect(oklabQ('#000000')).toEqual([0, 0, 0]);
    expect(oklabQ('#FF0000')).toEqual([6280, 2249, 1258]);
    expect(oklabQ('#00FF00')).toEqual([8664, -2339, 1795]);
    expect(oklabQ('#0000FF')).toEqual([4520, -325, -3115]);
    expect(oklabQ('#ff0000')).toEqual(oklabQ('#FF0000'));
    for (const bad of ['FF0000', '#FFF', '#GG0000', '', 'red']) expect(oklabQ(bad)).toBeNull();
  });

  it('distance is symmetric, an integer, zero on itself and Infinity on a malformed value', () => {
    const all = [...Object.values(CONTENT_RESERVED_COLOURS.day), ...CONTENT_SWATCHES.flatMap((s) => Object.values(s.day))];
    for (const a of all) {
      expect(colourDistanceQSq(a, a)).toBe(0);
      for (const b of all) {
        const d = colourDistanceQSq(a, b);
        expect(Number.isInteger(d)).toBe(true);
        expect(colourDistanceQSq(b, a)).toBe(d);
      }
    }
    expect(colourDistanceQSq('#000000', 'nope')).toBe(Infinity);
    expect(coloursClear('#000000', 'nope')).toBe(true);
  });

  it('every named night value is the fixed transform of its day value', () => {
    const table: Record<string, { line?: [string, string]; fill?: [string, string] }> = {
      lemon: { fill: ['#F3F287', '#373500'] },
      leaf: { line: ['#007835', '#63C37B'], fill: ['#BAF6C5', '#194224'] },
      sky: { line: ['#067092', '#5EB4D9'], fill: ['#C0EDFF', '#133E4C'] },
      cobalt: { line: ['#1957BB', '#83B2FE'], fill: ['#CDDFFE', '#2F3D56'] },
      orchid: { line: ['#8E389B', '#D789E2'], fill: ['#F4D4FE', '#492F51'] },
      raspberry: { line: ['#B62268', '#EE79A4'], fill: ['#FFD9E2', '#4B2E36'] },
    };
    expect(CONTENT_SWATCHES.map((s) => s.name)).toEqual(Object.keys(table));
    for (const s of CONTENT_SWATCHES) {
      for (const role of ['line', 'fill'] as const) {
        const want = table[s.name]![role];
        expect([s.day[role], s.night[role]]).toEqual(want ? [...want] : [undefined, undefined]);
        if (want) expect(nightOf(want[0], role)).toBe(want[1]);
      }
    }
    expect(NIGHT_TRANSFORM).toEqual({ line: { lFrom: 1.24, lMin: 0.7, lMax: 0.88, cMax: 0.15 }, fill: { lFrom: 1.26, lMin: 0.3, lMax: 0.42, cMax: 0.07 }, gamut: { cStep: 0.002, tolerance: 0.0005 } });
  });

  it('named clearance: no named value is within the minimum of a reserved colour (smallest: cobalt night line to state.knot)', () => {
    let min = Infinity;
    let where = '';
    for (const s of CONTENT_SWATCHES) {
      for (const theme of ['day', 'night'] as const) {
        for (const [role, v] of Object.entries(s[theme])) {
          for (const [name, r] of Object.entries(CONTENT_RESERVED_COLOURS[theme])) {
            expect(coloursClear(v, r)).toBe(true);
            const d = dist(v, r);
            if (d < min) [min, where] = [d, `${s.name} ${theme} ${role} ${name}`];
          }
        }
      }
    }
    expect(where).toBe('cobalt night line state.knot');
    expect(min.toFixed(3)).toBe('0.068');
  });

  it('measured contrast: named lines on the ground, and a named edge on its own fill', () => {
    const ground = { day: '#EDE8DC', night: '#0F1116' };
    const want = { day: { leaf: 4.6, sky: 4.59, cobalt: 5.5, orchid: 5.39, raspberry: 5.03 }, night: { leaf: 8.65, sky: 8.1, cobalt: 8.78, orchid: 7.7, raspberry: 7.11 } };
    for (const theme of ['day', 'night'] as const) {
      for (const [name, ratio] of Object.entries(want[theme])) {
        const s = CONTENT_SWATCHES.find((x) => x.name === name)!;
        expect(contrastRatio(s[theme].line!, ground[theme]).toFixed(2)).toBe(ratio.toFixed(2));
        expect(contrastRatio(s[theme].line!, s[theme].fill!)).toBeGreaterThanOrEqual(CONTENT_EDGE_ON_FILL_MIN_RATIO);
      }
    }
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(contrastRatio('#000000', 'nope')).toBe(1);
  });
});

describe('the shared check (validator and picker)', () => {
  // Luna's vectors: value, verdict, worst distance and where, the swatch offered (line / fill), night values
  // `pass` is the distance rule; `final` is the shared check (distance and contrast) as [line, fill] when it differs
  const vectors: Array<{ v: string; pass: boolean; final?: [boolean, boolean]; worst?: [string, 'day' | 'line' | 'fill']; offer?: [string, string]; night?: [string, string] }> = [
    { v: '#C08A73', pass: false, worst: ['0.000', 'day'], offer: ['raspberry', 'raspberry'] },
    { v: '#B4382A', pass: false, worst: ['0.000', 'day'], offer: ['raspberry', 'raspberry'] },
    { v: '#5B4FD6', pass: false, worst: ['0.000', 'day'], offer: ['cobalt', 'cobalt'] },
    { v: '#FF0000', pass: false, worst: ['0.035', 'line'], offer: ['raspberry', 'raspberry'] },
    { v: '#E53935', pass: false, worst: ['0.036', 'line'], offer: ['raspberry', 'raspberry'] },
    { v: '#8A2BE2', pass: false, worst: ['0.050', 'line'], offer: ['orchid', 'orchid'] },
    { v: '#7B3FA0', pass: false, worst: ['0.059', 'line'], offer: ['orchid', 'orchid'] },
    { v: '#6D4C41', pass: false, worst: ['0.033', 'line'], offer: ['sky', 'cobalt'] },
    { v: '#FFF59D', pass: true, final: [false, true], worst: ['0.066', 'day'] },
    { v: '#FF8800', pass: true, final: [false, true], worst: ['0.079', 'line'], night: ['#E38230', '#6A4225'] },
    { v: '#1E90FF', pass: true, final: [false, true], worst: ['0.096', 'line'], night: ['#54A1F9', '#304F72'] },
    { v: '#00897B', pass: true, final: [true, false], worst: ['0.103', 'day'], night: ['#47B3A4', '#0F5950'] },
    { v: '#FFD700', pass: true, final: [false, true], worst: ['0.128', 'day'], night: ['#BA9C00', '#4C400B'] },
    { v: '#808080', pass: true, final: [true, true], night: ['#9E9E9E', '#4D4D4D'] },
  ];

  it("Luna's vectors, including the 0.059 fail and the 0.066 pass", () => {
    for (const t of vectors) {
      for (const role of ['line', 'fill'] as const) {
        expect([t.v, role, customColourPasses(t.v, role)]).toEqual([t.v, role, t.pass]);
        const want = t.pass && (t.final ? t.final[role === 'line' ? 0 : 1] : true);
        expect([t.v, role, contentColourCheck(`custom:${t.v}`, role).ok]).toEqual([t.v, role, want]);
        expect(contentColourCheck(`custom:${t.v.toLowerCase()}`, role).ok).toBe(want);
      }
      if (t.worst) {
        const d = t.worst[1] === 'day' ? worst(t.v, 'day') : worst(nightOf(t.v, t.worst[1]), 'night');
        expect([t.v, d.toFixed(3)]).toEqual([t.v, t.worst[0]]);
        const overall = Math.min(worst(t.v, 'day'), worst(nightOf(t.v, 'line'), 'night'), worst(nightOf(t.v, 'fill'), 'night'));
        expect(overall.toFixed(3)).toBe(t.worst[0]);
      }
      if (t.offer) {
        expect([nearestSwatch(t.v, 'line'), nearestSwatch(t.v, 'fill')]).toEqual(t.offer);
        expect(contentColourCheck(`custom:${t.v}`, 'line')).toEqual({ ok: false, offer: t.offer[0] });
        expect(contentColourCheck(`custom:${t.v}`, 'fill')).toEqual({ ok: false, offer: t.offer[1] });
      }
      if (t.night) expect([nightOf(t.v, 'line'), nightOf(t.v, 'fill')]).toEqual(t.night);
    }
    expect(nearestSwatch('#FFF59D', 'line')).not.toBe('lemon');
  });

  it('ruling 1: the neutral exemption is for a line only; a fill on ink or the key edge is refused with no offer', () => {
    for (const v of ['#16150F', '#2A2925']) {
      expect(isNeutralColour(v)).toBe(true);
      expect(customColourPasses(v, 'line')).toBe(true);
      expect(customColourPasses(v, 'fill')).toBe(false);
      expect(contentColourCheck(`custom:${v}`, 'fill')).toEqual({ ok: false, offer: null });
      expect(contentColourCheck(`custom:${v.toLowerCase()}`, 'fill')).toEqual({ ok: false, offer: null });
    }
    expect(dist('#16150F', CONTENT_THEME_TOKENS.day['text.primary'])).toBe(0);
    expect(dist('#2A2925', CONTENT_THEME_TOKENS.day['line.key-edge'])).toBe(0);
    expect(CONTENT_FILL_GUARD_TOKENS).toEqual(['text.primary', 'line.key-edge']);
    // a neutral that is nowhere near ink passes as a fill by measurement, not by exemption
    expect(isNeutralColour('#808080')).toBe(true);
    expect(customColourPasses('#808080', 'fill')).toBe(true);
    // every named fill, paper included, keeps clear of both guards in both themes
    for (const theme of ['day', 'night'] as const) {
      const fills = [...CONTENT_SWATCHES.map((s) => s[theme].fill!), CONTENT_THEME_TOKENS[theme]['surface.sheet']];
      for (const f of fills) for (const g of CONTENT_FILL_GUARD_TOKENS) expect(dist(f, CONTENT_THEME_TOKENS[theme][g])).toBeGreaterThanOrEqual(0.52);
    }
  });

  it('tokens: a name is valid only in a role it has; anything else is refused', () => {
    const line = ['ink', 'graphite', 'leaf', 'sky', 'cobalt', 'orchid', 'raspberry'];
    const fill = ['paper', 'lemon', 'leaf', 'sky', 'cobalt', 'orchid', 'raspberry'];
    for (const n of CONTENT_SWATCH_NAMES) {
      expect(isContentColour(n, 'line')).toBe(line.includes(n));
      expect(isContentColour(n, 'fill')).toBe(fill.includes(n));
    }
    expect(Object.keys(CONTENT_NEUTRALS)).toEqual(['ink', 'graphite', 'paper']);
    for (const bad of [undefined, null, 5, {}, '', 'none', 'red', 'Leaf', 'toString', 'constructor', '__proto__', '#1E90FF', 'custom:1E90FF', 'custom:#1E90F', 'custom:#1E90FF00', 'custom:#1E90FG', ' custom:#1E90FF', 'custom:#1E90FF\n', 'terracotta.fill', 'state.fail']) {
      for (const role of ['line', 'fill'] as const) expect(contentColourCheck(bad, role)).toEqual({ ok: false, offer: null });
    }
    expect(CUSTOM_COLOUR_PATTERN.test('custom:#1e90ff') && CUSTOM_COLOUR_PATTERN.test('custom:#1E90FF')).toBe(true);
  });

  it('a custom colour equal to each reserved colour is refused in both roles', () => {
    for (const theme of ['day', 'night'] as const) {
      for (const [name, r] of Object.entries(CONTENT_RESERVED_COLOURS[theme])) {
        if (theme === 'night') continue; // a custom value is a DAY value; night reserved colours are met through the transform
        for (const role of ['line', 'fill'] as const) expect([name, role, contentColourCheck(`custom:${r}`, role).ok]).toEqual([name, role, false]);
      }
    }
  });
});

describe('the resolver (renderer): total, never trusts a stored row', () => {
  it('named and neutral tokens resolve by role and theme', () => {
    expect(resolveContentColour('ink', 'line', 'day')).toBe('#16150F');
    expect(resolveContentColour('ink', 'line', 'night')).toBe('#E8F4F0');
    expect(resolveContentColour('graphite', 'line', 'night')).toBe('#86998F');
    expect(resolveContentColour('paper', 'fill', 'day')).toBe('#F8F5EE');
    expect(resolveContentColour('paper', 'fill', 'night')).toBe('#171A21');
    expect(resolveContentColour('cobalt', 'line', 'day')).toBe('#1957BB');
    expect(resolveContentColour('cobalt', 'fill', 'night')).toBe('#2F3D56');
    expect(resolveContentColour('lemon', 'fill', 'night')).toBe('#373500');
  });

  it('a passing custom colour is drawn as stored by day and transformed at night', () => {
    expect(resolveContentColour('custom:#00897b', 'line', 'day')).toBe('#00897B');
    expect(resolveContentColour('custom:#00897b', 'line', 'night')).toBe('#47B3A4');
    expect(resolveContentColour('custom:#1E90FF', 'fill', 'night')).toBe('#304F72');
  });

  it('a token that fails the current check draws as ink (line) or no fill; it is never stepped towards a passing colour', () => {
    const failing: unknown[] = ['custom:#B4382A', 'custom:#7B3FA0', 'custom:#C08A73', 'lemon-ish', 'state.fail', '#B4382A', '', null, undefined, 7, {}, [], 'custom:#zzzzzz'];
    for (const t of failing) {
      expect(resolveContentColour(t, 'line', 'day')).toBe('#16150F');
      expect(resolveContentColour(t, 'line', 'night')).toBe('#E8F4F0');
      expect(resolveContentColour(t, 'fill', 'day')).toBeNull();
      expect(resolveContentColour(t, 'fill', 'night')).toBeNull();
    }
    expect(resolveContentColour('lemon', 'line', 'day')).toBe('#16150F');
    expect(resolveContentColour('ink', 'fill', 'day')).toBeNull();
    expect(resolveContentColour('custom:#16150F', 'fill', 'night')).toBeNull();
    expect(resolveContentColour('custom:#16150F', 'line', 'day')).toBe('#16150F');
    // whatever is stored, no resolved colour is within the minimum of a reserved colour
    for (const theme of ['day', 'night'] as const) {
      for (const r of [...Object.values(CONTENT_RESERVED_COLOURS.day), ...Object.values(CONTENT_RESERVED_COLOURS.night)]) {
        for (const role of ['line', 'fill'] as const) {
          const out = resolveContentColour(`custom:${r}`, role, theme);
          if (out !== null) expect(worst(out, theme)).toBeGreaterThanOrEqual(CONTENT_MIN_DISTANCE - 1 / LAB_QUANTUM);
        }
      }
    }
  });

  it('nightOf is total', () => {
    expect(nightOf('nope', 'line')).toBe('#E8F4F0');
    expect(nightOf('nope', 'fill')).toBe('#171A21');
    for (const v of ['#000000', '#FFFFFF', '#FF00FF', '#00FFFF', '#FFFF00']) for (const role of ['line', 'fill'] as const) expect(nightOf(v, role)).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('the package copies equal the design foundations', () => {
  const yaml = fs.readFileSync(path.join(repo, '.atelier', 'systems', 'gnomon', 'design-system.yaml'), 'utf8').split(/\r?\n/);
  const start = yaml.findIndex((l) => /^foundations:\s*$/.test(l));
  const colour = yaml.findIndex((l, i) => i > start && /^ {2}color:\s*$/.test(l));
  const block: string[] = [];
  for (let i = colour + 1; i < yaml.length && !/^ {2}\S/.test(yaml[i]!); i++) block.push(yaml[i]!);
  const section = (name: string): string[] => {
    const at = block.findIndex((l) => new RegExp(`^ {4}${name}:`).test(l));
    const out: string[] = [];
    for (let i = at + 1; i < block.length && !/^ {4}\S/.test(block[i]!); i++) out.push(block[i]!);
    return out;
  };
  const flat = (lines: string[]): Record<string, string> => Object.fromEntries(lines.map((l) => /^ {6}([a-z.-]+): "([^"]+)"/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => [m[1]!, m[2]!]));
  const day = flat(section('day'));
  const night = flat(section('night'));
  const project = Object.fromEntries(section('project').map((l) => /^ {6}([a-z-]+):\s*\{ fill: "(#[0-9A-F]{6})", ink: "(#[0-9A-F]{6})", night: "(#[0-9A-F]{6})" \}/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => [m[1]!, { fill: m[2]!, ink: m[3]!, night: m[4]! }]));

  it('the foundations block was read', () => {
    expect(Object.keys(project)).toEqual(['terracotta', 'sage', 'slate', 'ochre', 'rose-clay', 'sea-grey']);
    expect(Object.keys(day).filter((k) => k.startsWith('state.'))).toEqual(['state.fail', 'state.warn-ink', 'state.warn-edge', 'state.warn-bg', 'state.knot']);
    expect(Object.keys(night).filter((k) => k.startsWith('state.'))).toEqual(['state.fail', 'state.warn-ink', 'state.warn-edge', 'state.warn-bg', 'state.knot']);
  });

  it('theme tokens equal the foundations', () => {
    for (const k of Object.keys(CONTENT_THEME_TOKENS.day) as Array<keyof typeof CONTENT_THEME_TOKENS.day>) {
      expect(CONTENT_THEME_TOKENS.day[k]).toBe(day[k]);
      expect(CONTENT_THEME_TOKENS.night[k]).toBe(night[k]);
    }
  });

  it('reserved colours equal the mineral and semantic foundations, with night state.warn-bg the one named exception', () => {
    const wantDay: Record<string, string> = {};
    const wantNight: Record<string, string> = {};
    for (const [name, p] of Object.entries(project)) {
      wantDay[`${name}.fill`] = p.fill;
      wantDay[`${name}.ink`] = p.ink;
      wantNight[name] = p.night;
    }
    for (const [k, v] of Object.entries(day)) if (k.startsWith('state.')) wantDay[k] = v;
    const exceptions: string[] = [];
    for (const [k, v] of Object.entries(night)) {
      if (!k.startsWith('state.')) continue;
      if (/^#[0-9A-F]{6}$/.test(v)) wantNight[k] = v;
      else exceptions.push(`night:${k}`);
    }
    expect(CONTENT_RESERVED_COLOURS.day).toEqual(wantDay);
    // by VALUE at night: warn-edge and warn-ink are one colour there, listed once
    expect(new Set(Object.values(CONTENT_RESERVED_COLOURS.night))).toEqual(new Set(Object.values(wantNight)));
    for (const [k, v] of Object.entries(CONTENT_RESERVED_COLOURS.night)) expect(wantNight[k]).toBe(v);
    expect(exceptions).toEqual([...CONTENT_RESERVED_EXCEPTIONS]);
  });

  it('the exception is a wash with no single value: its composites are computed here, and its edge and text are reserved', () => {
    const m = /^rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)$/.exec(night['state.warn-bg']!)!;
    const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    const over = (under: string): string => {
      const u = [1, 3, 5].map((i) => parseInt(under.slice(i, i + 2), 16));
      return `#${[r, g, b].map((c, i) => Math.round(c * a + u[i]! * (1 - a)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    };
    const composites = [over(night['surface.ground']!), over(night['surface.sheet']!)];
    // the design record states the same two values in words; they are found there, not typed here
    const leftOut = yaml.find((l) => /^\s+left_out:/.test(l))!;
    for (const c of composites) expect(leftOut.includes(c)).toBe(true);
    // near-neutral darks: a distance rule against them would refuse every dark fill, which is why it is left out
    for (const c of composites) {
      expect(isNeutralColour(c)).toBe(true);
      expect(oklabQ(c)![0]).toBeLessThan(0.35 * LAB_QUANTUM);
    }
    const nightFills = CONTENT_SWATCHES.map((s) => s.night.fill!);
    const nearest = Math.min(...nightFills.flatMap((f) => composites.map((c) => dist(f, c))));
    // every named night fill is still clear of both composites by the palette minimum (and close: under 0.1 away)
    expect(nearest).toBeGreaterThanOrEqual(CONTENT_MIN_DISTANCE);
    for (const f of nightFills) for (const c of composites) expect(coloursClear(f, c)).toBe(true);
    expect(nearest).toBeLessThan(0.1);
    // the wash's own colour is the reserved warn-ink, so its edge and text are protected
    expect(`#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase()).toBe(CONTENT_RESERVED_COLOURS.night['state.warn-ink']);
  });
});

describe('one implementation', () => {
  // split so this file does not match itself
  const needles = [['0.4122', '2147'], ['1.9779', '9849'], ['4.0767', '4166'], ['0.2104', '5425'], ['0.3963', '3777']].map((p) => p.join(''));
  // build output and the packaged app are copies of source, not second implementations
  const skip = new Set(['node_modules', 'dist', '.git', '.build', 'build', 'coverage', '.turbo', 'release', 'out', 'DerivedData', '.next']);
  /**
   * The ONE generated copy (S1.3): the dimension mod's dim-shape.mjs is bundled from this package's source, and
   * packages/gnomon/test/dimension-mod.test.ts rebuilds it and compares bytes. Exempt by its EXACT path (posix
   * separators, relative to the repo root): a file of that name anywhere else is a second copy like any other.
   */
  const GENERATED_COPY = 'packages/gnomon-mods/dimension/dim-shape.mjs';
  const scan = (root: string): string[] => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx|mts|js|mjs|cjs|jsx|css|html|swift|py)$/.test(e.name) && fs.statSync(full).size < 8_000_000) {
          const rel = path.relative(root, full).split(path.sep).join('/');
          if (rel === GENERATED_COPY) continue;
          if (needles.some((n) => fs.readFileSync(full, 'utf8').includes(n))) hits.push(rel);
        }
      }
    };
    walk(path.join(root, 'packages'));
    return hits.sort();
  };

  it('no second copy of the OKLab matrices exists under packages/', () => {
    expect(scan(repo)).toEqual(['packages/gnomon-contracts/src/content-palette.ts']);
    // the exempt file exists, is the generated one, and does hold the matrices (so the exemption is doing real work)
    const generated = fs.readFileSync(path.join(repo, ...GENERATED_COPY.split('/')), 'utf8');
    expect(generated.startsWith('// GENERATED by packages/gnomon/scripts/build-dimension-mod.mjs from packages/gnomon-contracts/src/dim.ts.')).toBe(true);
    expect(needles.some((n) => generated.includes(n))).toBe(true);
  });

  it('the exemption is one exact path: a dim-shape.mjs anywhere else, generated header or not, is still caught', () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'oklab-'));
    try {
      const header = '// GENERATED by packages/gnomon/scripts/build-dimension-mod.mjs from packages/gnomon-contracts/src/dim.ts.\n';
      const body = `${header}const m = ${needles[0]};\n`;
      const put = (rel: string): void => {
        const full = path.join(fake, ...rel.split('/'));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body);
      };
      put(GENERATED_COPY);
      put('packages/gnomon-mods/dimension/sub/dim-shape.mjs');
      put('packages/gnomon-mods/other/dim-shape.mjs');
      put('packages/acme/gnomon-mods/dimension/dim-shape.mjs');
      put('packages/gnomon-gui/src/dim-shape.mjs');
      expect(scan(fake)).toEqual(['packages/acme/gnomon-mods/dimension/dim-shape.mjs', 'packages/gnomon-gui/src/dim-shape.mjs', 'packages/gnomon-mods/dimension/sub/dim-shape.mjs', 'packages/gnomon-mods/other/dim-shape.mjs']);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });
});

describe('contrast_rule (Luna 2026-11-25, Aegis S1.2 nit 6)', () => {
  const surfaces = { day: ['#EDE8DC', '#F8F5EE'], night: ['#0F1116', '#171A21'] };

  it('the floors, the surfaces and the words are the record', () => {
    expect(CONTENT_CONTRAST_FLOORS).toEqual({ line: 3, text: 4.5, fillText: 4.5 });
    expect(CONTENT_CONTRAST_SURFACES).toEqual(['surface.ground', 'surface.sheet']);
    for (const theme of ['day', 'night'] as const) expect(CONTENT_CONTRAST_SURFACES.map((k) => CONTENT_THEME_TOKENS[theme][k])).toEqual(surfaces[theme]);
    expect(CONTENT_CONTRAST_WORDS).toEqual({
      'faint-line': 'too faint to see on the board',
      'faint-text': 'too faint to read as words',
      'faint-fill': 'words would be too faint on it',
      'pair-line': "it would not show against this mark's fill",
      'pair-fill': "this mark's line would not show against it",
    });
    expect(contentContrastWords('pair-line', true)).toBe("it would not show against this mark's fill at night");
    expect(contentContrastWords('faint-text', false)).toBe('too faint to read as words');
    expect(contentContrastFix('faint-line', false, 'sky')).toBe('Too faint to see on the board: use sky, or a custom colour with at least 3:1 against the board in both themes.');
    expect(contentContrastFix('pair-fill', true, 'paper')).toBe("This mark's line would not show against it at night: use paper, or a fill with at least 3:1 against the line in both themes.");
  });

  it('the ratio is compared as integers with no rounding up', () => {
    expect(contrastClears('#000000', '#FFFFFF', 21)).toBe(true);
    expect(contrastClears('#696969', '#EDE8DC', 4.5)).toBe(false); // 4.49
    expect(contrastRatio('#696969', '#EDE8DC').toFixed(2)).toBe('4.49');
    expect(contrastClears('#686868', '#EDE8DC', 4.5)).toBe(true); // 4.56
    expect(contrastClears('#868686', '#EDE8DC', 3)).toBe(false); // 2.98
    expect(contrastClears('#858585', '#EDE8DC', 3)).toBe(true); // 3.02
    // a night pair that prints as 3.00 and is under it: refused
    const l = nightOf('#4466CC', 'line');
    const f = nightOf('#00EE00', 'fill');
    expect(contrastRatio(l, f).toFixed(2)).toBe('3.00');
    expect(contrastRatio(l, f)).toBeLessThan(3);
    expect(contrastClears(l, f, 3)).toBe(false);
    expect(contrastClears('nope', '#FFFFFF', 1)).toBe(false);
  });

  // the record's test_vectors, each with its measured ratio
  const roleVectors: Array<{ v: string; use: 'line' | 'text' | 'fill'; pass: boolean; ratio?: [string, string, string] }> = [
    { v: '#F8F5EE', use: 'line', pass: false, ratio: ['#F8F5EE', '#F8F5EE', '1.00'] },
    { v: '#868686', use: 'line', pass: false, ratio: ['#868686', '#EDE8DC', '2.98'] },
    { v: '#858585', use: 'line', pass: true, ratio: ['#858585', '#EDE8DC', '3.02'] },
    { v: '#858585', use: 'text', pass: false },
    { v: '#767676', use: 'line', pass: true, ratio: ['#767676', '#EDE8DC', '3.72'] },
    { v: '#767676', use: 'text', pass: false, ratio: ['#767676', '#F8F5EE', '4.17'] },
    { v: '#696969', use: 'text', pass: false, ratio: ['#696969', '#EDE8DC', '4.49'] },
    { v: '#686868', use: 'text', pass: true, ratio: ['#686868', '#EDE8DC', '4.56'] },
    { v: '#00897B', use: 'line', pass: true, ratio: ['#00897B', '#EDE8DC', '3.53'] },
    { v: '#00897B', use: 'text', pass: false },
    { v: '#00897B', use: 'fill', pass: false, ratio: ['#16150F', '#00897B', '4.24'] },
    { v: '#1E90FF', use: 'line', pass: false, ratio: ['#1E90FF', '#EDE8DC', '2.65'] },
    { v: '#1E90FF', use: 'fill', pass: true, ratio: ['#16150F', '#1E90FF', '5.65'] },
    { v: '#FF8800', use: 'line', pass: false, ratio: ['#FF8800', '#EDE8DC', '1.96'] },
    { v: '#FF8800', use: 'fill', pass: true, ratio: ['#16150F', '#FF8800', '7.64'] },
    { v: '#FFD700', use: 'line', pass: false },
    { v: '#FFD700', use: 'fill', pass: true },
    { v: '#404040', use: 'fill', pass: false, ratio: ['#16150F', '#404040', '1.76'] },
    { v: '#767676', use: 'fill', pass: false, ratio: ['#16150F', '#767676', '4.03'] },
    { v: '#808080', use: 'line', pass: true, ratio: ['#808080', '#EDE8DC', '3.23'] },
    { v: '#808080', use: 'text', pass: false },
    { v: '#808080', use: 'fill', pass: true, ratio: ['#16150F', '#808080', '4.63'] },
  ];

  it("the record's vectors, by role, with the refusal's words and offer", () => {
    for (const t of roleVectors) {
      const role = t.use === 'fill' ? 'fill' : 'line';
      const use = { text: t.use === 'text' };
      const c = contentColourCheck(`custom:${t.v}`, role, use);
      expect([t.v, t.use, c.ok]).toEqual([t.v, t.use, t.pass]);
      expect(contentColourCheck(`custom:${t.v.toLowerCase()}`, role, use).ok).toBe(t.pass);
      if (t.ratio) expect([t.v, t.use, contrastRatio(t.ratio[0], t.ratio[1]).toFixed(2)]).toEqual([t.v, t.use, t.ratio[2]]);
      if (!c.ok) {
        expect([t.v, t.use, c.why, c.night]).toEqual([t.v, t.use, t.use === 'fill' ? 'faint-fill' : t.use === 'text' ? 'faint-text' : 'faint-line', false]);
        // the offer is a named token of the role, and it passes every part
        expect(contentColourCheck(c.offer, role, use).ok).toBe(true);
      }
    }
    // night ink on the night transform of #808080 as a fill: 7.50
    expect(contrastRatio('#E8F4F0', nightOf('#808080', 'fill')).toFixed(2)).toBe('7.50');
    // neutral, and not exempt: #F8F5EE passes the distance rule as a line and fails the floor
    expect(isNeutralColour('#F8F5EE') && customColourPasses('#F8F5EE', 'line')).toBe(true);
    expect(contentColourCheck('custom:#F8F5EE', 'line')).toEqual({ ok: false, offer: 'sky', why: 'faint-line', night: false });
    // the consequence the record names: orange, gold and dodger blue pass as fills and not as lines
    for (const v of ['#FF8800', '#FFD700', '#1E90FF']) expect([v, isContentColour(`custom:${v}`, 'fill'), isContentColour(`custom:${v}`, 'line')]).toEqual([v, true, false]);
  });

  it('every named swatch passes every part, in both themes', () => {
    const lines = CONTENT_SWATCH_NAMES.filter((n) => isContentColour(n, 'line'));
    const fills = CONTENT_SWATCH_NAMES.filter((n) => isContentColour(n, 'fill'));
    expect(lines).toEqual(['ink', 'graphite', 'leaf', 'sky', 'cobalt', 'orchid', 'raspberry']);
    expect(fills).toEqual(['paper', 'lemon', 'leaf', 'sky', 'cobalt', 'orchid', 'raspberry']);
    for (const n of lines) {
      expect([n, contentColourCheck(n, 'line', { text: true }).ok]).toEqual([n, true]);
      for (const theme of ['day', 'night'] as const) for (const s of surfaces[theme]) expect(contrastRatio(resolveContentColour(n, 'line', theme)!, s)).toBeGreaterThanOrEqual(4.5);
      for (const f of fills) for (const field of ['line', 'fill'] as const) expect([n, f, contentPairCheck(n, f, field).ok]).toEqual([n, f, true]);
    }
    for (const f of fills) for (const theme of ['day', 'night'] as const) expect(contrastRatio(CONTENT_THEME_TOKENS[theme]['text.primary'], resolveContentColour(f, 'fill', theme)!)).toBeGreaterThanOrEqual(4.5);
  });

  it('the pair: a line on its own fill, judged on the field being written', () => {
    // each passes alone, the pair does not (2.74 by day)
    expect(isContentColour('custom:#858585', 'line') && isContentColour('cobalt', 'fill')).toBe(true);
    expect(contrastRatio('#858585', '#CDDFFE').toFixed(2)).toBe('2.74');
    expect(contentPairCheck('custom:#858585', 'cobalt', 'line')).toEqual({ ok: false, offer: 'ink', why: 'pair-line', night: false });
    expect(contentPairCheck('custom:#858585', 'cobalt', 'fill')).toEqual({ ok: false, offer: 'paper', why: 'pair-fill', night: false });
    expect(contrastRatio('#858585', '#F3F287').toFixed(2)).toBe('3.14');
    expect(contentPairCheck('custom:#858585', 'lemon', 'line').ok).toBe(true);
    expect(contrastRatio('#00897B', '#CDDFFE').toFixed(2)).toBe('3.20');
    expect(contentPairCheck('custom:#00897B', 'cobalt', 'line').ok).toBe(true);
    // the validator's own night vector, replacing the record's 'sampled at 2.83': passes by day, fails at night
    const [l, f] = ['#CC0066', '#22EE66'];
    expect(isContentColour(`custom:${l}`, 'line') && isContentColour(`custom:${f}`, 'fill')).toBe(true);
    expect(contrastRatio(l, f).toFixed(2)).toBe('3.59');
    expect(contrastRatio(nightOf(l, 'line'), nightOf(f, 'fill')).toFixed(2)).toBe('2.82');
    expect(contentPairCheck(`custom:${l}`, `custom:${f}`, 'fill')).toEqual({ ok: false, offer: 'paper', why: 'pair-fill', night: true });
    // the offers always pass
    expect(contentPairCheck('ink', `custom:${f}`, 'line').ok && contentPairCheck(`custom:${l}`, 'paper', 'fill').ok).toBe(true);
    expect(contentPairCheck('ink', 'cobalt', 'line').ok && contentPairCheck('custom:#858585', 'paper', 'fill').ok).toBe(true);
    // no fill, or a token that fails alone: no pair is judged here
    for (const none of [null, undefined]) expect(contentPairCheck('custom:#858585', none, 'line').ok).toBe(true);
    expect(contentPairCheck('custom:#FF8800', 'cobalt', 'line').ok).toBe(true);
  });

  it('at paint: a stored colour that now fails draws as ink or no fill, a failing pair draws its line as ink; nothing is rewritten', () => {
    // stored before the rule: an orange line, a faint fill, a text colour that is a fair line
    expect(resolveContentColour('custom:#FF8800', 'line', 'day')).toBe('#16150F');
    expect(resolveContentColour('custom:#FF8800', 'line', 'night')).toBe('#E8F4F0');
    expect(resolveContentColour('custom:#404040', 'fill', 'day')).toBeNull();
    expect(resolveContentColour('custom:#767676', 'line', 'day')).toBe('#767676');
    expect(resolveContentColour('custom:#767676', 'line', 'day', { text: true })).toBe('#16150F');
    expect(resolveContentPair('custom:#858585', 'cobalt', 'day')).toEqual({ line: '#16150F', fill: '#CDDFFE' });
    expect(resolveContentPair('custom:#858585', 'lemon', 'day')).toEqual({ line: '#858585', fill: '#F3F287' });
    expect(resolveContentPair('custom:#CC0066', 'custom:#22EE66', 'night')).toEqual({ line: '#E8F4F0', fill: nightOf('#22EE66', 'fill') });
    // the rule is both themes, so a pair that fails at night is a failing pair by day too (as a single colour is)
    expect(resolveContentPair('custom:#CC0066', 'custom:#22EE66', 'day')).toEqual({ line: '#16150F', fill: '#22EE66' });
    expect(resolveContentPair('custom:#858585', null, 'day')).toEqual({ line: '#858585', fill: null });
    expect(resolveContentPair('custom:#858585', 'custom:#404040', 'day')).toEqual({ line: '#858585', fill: null });
  });
});
