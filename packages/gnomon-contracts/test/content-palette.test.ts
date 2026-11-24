/**
 * content-palette:v1 (Luna's S1.1 design; Aegis rulings 1 to 4). The vectors and the tables come from the design
 * record (`.atelier/systems/gnomon/design-system.yaml`, `content_palette`); this file checks the package against
 * them, and checks that the package's copies of the foundations colours still equal the foundations.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONTENT_EDGE_ON_FILL_MIN_RATIO, CONTENT_FILL_GUARD_TOKENS, CONTENT_MIN_DISTANCE, CONTENT_NEUTRALS, CONTENT_PALETTE_V1, CONTENT_RESERVED_COLOURS, CONTENT_RESERVED_EXCEPTIONS, CONTENT_SWATCH_NAME_PATTERN,
  CONTENT_SWATCH_NAMES, CONTENT_SWATCHES, CONTENT_THEME_TOKENS, CUSTOM_COLOUR_PATTERN, LAB_QUANTUM, NIGHT_TRANSFORM, SRGB_LINEAR,
  colourDistanceQSq, coloursClear, contentColourCheck, contentPaletteProblems, contrastRatio, customColourPasses, isContentColour, isNeutralColour, nearestSwatch, nightOf, oklabQ, resolveContentColour,
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
  const vectors: Array<{ v: string; pass: boolean; worst?: [string, 'day' | 'line' | 'fill']; offer?: [string, string]; night?: [string, string] }> = [
    { v: '#C08A73', pass: false, worst: ['0.000', 'day'], offer: ['raspberry', 'raspberry'] },
    { v: '#B4382A', pass: false, worst: ['0.000', 'day'], offer: ['raspberry', 'raspberry'] },
    { v: '#5B4FD6', pass: false, worst: ['0.000', 'day'], offer: ['cobalt', 'cobalt'] },
    { v: '#FF0000', pass: false, worst: ['0.035', 'line'], offer: ['raspberry', 'raspberry'] },
    { v: '#E53935', pass: false, worst: ['0.036', 'line'], offer: ['raspberry', 'raspberry'] },
    { v: '#8A2BE2', pass: false, worst: ['0.050', 'line'], offer: ['orchid', 'orchid'] },
    { v: '#7B3FA0', pass: false, worst: ['0.059', 'line'], offer: ['orchid', 'orchid'] },
    { v: '#6D4C41', pass: false, worst: ['0.033', 'line'], offer: ['sky', 'cobalt'] },
    { v: '#FFF59D', pass: true, worst: ['0.066', 'day'] },
    { v: '#FF8800', pass: true, worst: ['0.079', 'line'], night: ['#E38230', '#6A4225'] },
    { v: '#1E90FF', pass: true, worst: ['0.096', 'line'], night: ['#54A1F9', '#304F72'] },
    { v: '#00897B', pass: true, worst: ['0.103', 'day'], night: ['#47B3A4', '#0F5950'] },
    { v: '#FFD700', pass: true, worst: ['0.128', 'day'], night: ['#BA9C00', '#4C400B'] },
    { v: '#808080', pass: true, night: ['#9E9E9E', '#4D4D4D'] },
  ];

  it("Luna's vectors, including the 0.059 fail and the 0.066 pass", () => {
    for (const t of vectors) {
      for (const role of ['line', 'fill'] as const) {
        expect([t.v, role, customColourPasses(t.v, role)]).toEqual([t.v, role, t.pass]);
        expect(contentColourCheck(`custom:${t.v}`, role).ok).toBe(t.pass);
        expect(contentColourCheck(`custom:${t.v.toLowerCase()}`, role).ok).toBe(t.pass);
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
    expect(resolveContentColour('custom:#1e90ff', 'line', 'day')).toBe('#1E90FF');
    expect(resolveContentColour('custom:#1e90ff', 'line', 'night')).toBe('#54A1F9');
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
  it('no second copy of the OKLab matrices exists under packages/', () => {
    // split so this file does not match itself
    const needles = [['0.4122', '2147'], ['1.9779', '9849'], ['4.0767', '4166'], ['0.2104', '5425'], ['0.3963', '3777']].map((p) => p.join(''));
    // build output and the packaged app are copies of source, not second implementations
    const skip = new Set(['node_modules', 'dist', '.git', '.build', 'build', 'coverage', '.turbo', 'release', 'out', 'DerivedData', '.next']);
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx|mts|js|mjs|cjs|jsx|css|html|swift|py)$/.test(e.name) && fs.statSync(full).size < 8_000_000) {
          const text = fs.readFileSync(full, 'utf8');
          if (needles.some((n) => text.includes(n))) hits.push(path.relative(repo, full).split(path.sep).join('/'));
        }
      }
    };
    walk(path.join(repo, 'packages'));
    expect(hits.sort()).toEqual(['packages/gnomon-contracts/src/content-palette.ts']);
  });
});
