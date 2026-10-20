/**
 * K1 (#paradigm-context-mod, #mod-host): the paradigm-slice:v1 projector.
 * Bounds; malformed files skipped and counted; symlinks and escapes refused;
 * no absolute path anywhere in the slice (seeded property test);
 * sanitisation (bidi / control characters); sensitivity secret dropped; the
 * paradigm.read:summary capability is a manifest form and refuses egress.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CAPABILITY_FORMS } from '@a-company/gnomon-contracts';
import { capabilityForm, validateManifest } from '../src/kernel/manifest/manifest.js';
import { displayTitle, MAX_ENTRIES, MAX_FILE_BYTES, MAX_TASK_PARSED, PARADIGM_SLICE_V1, ParadigmSliceCache, paradigmSlice, PATH_GLYPH, projectHue, readYamlSubset, redactPaths, SCALAR_MAX, SLICE_BYTE_BUDGET, SLICE_TOP, TITLE_MAX } from '../src/kernel/modhost/paradigm-slice.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function repo(name = 'proj'): { root: string; home: string; P: string } {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pslice-')));
  dirs.push(base);
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git'));
  return { root, home: path.join(base, 'home-elsewhere'), P: path.join(root, '.paradigm') };
}
const put = (p: string, text: string): void => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const task = (P: string, day: string, n: number, o: { priority?: string; status?: string; blurb?: string; extra?: string } = {}): void =>
  put(path.join(P, 'tasks', 'entries', day, `T-${day}-${String(n).padStart(3, '0')}.yaml`), `id: T-${day}-${String(n).padStart(3, '0')}\nblurb: |-\n  ${o.blurb ?? `Task ${n}`}\n  second line\npriority: ${o.priority ?? 'medium'}\nstatus: ${o.status ?? 'open'}\ntags:\n  - gnomon\ncreated: '${day}T0${n % 10}:00:00.000Z'\n${o.extra ?? ''}`);
const decision = (P: string, id: string, ts: string, title: string, extra = ''): void =>
  put(path.join(P, 'decisions', `${id}.yaml`), `id: ${id}\ntimestamp: '${ts}'\ntitle: ${title}\ndecision: >-\n  long text\n  folded\nparticipants:\n  - id: founder\n    role: human\nstatus: active\n${extra}`);
const lore = (P: string, day: string, id: string, ts: string, title: string, symbols: string[], extra = ''): void =>
  put(path.join(P, 'lore', 'entries', day, `${id}.lore`), `id: ${id}\ntype: insight\ntimestamp: '${ts}'\ntitle: ${title}\nsymbols_touched:\n${symbols.map((s) => `  - '${s}'`).join('\n')}\nreferences:\n  decision_id: TD-1\n${extra}`);

function walkStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) walkStrings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) walkStrings(x, out);
  return out;
}
const ABS = [/(^|[\s(=:'"])\/[^\s/]+\/[^\s]*/, /[A-Za-z]:\\/, /~\//];

describe('K1 YAML subset reader', () => {
  it('reads the js-yaml shapes Paradigm writes', () => {
    const y = readYamlSubset("id: T-1\nblurb: |-\n  line one\n  line two\npriority: high\ntags:\n  - a\n  - 'b c'\ncreated: '2026-10-20T08:24:13.939Z'\nrefs: [x, 'y']\nnested:\n  k: v\nfolded: >-\n  a\n  b\n");
    expect(y).toMatchObject({ id: 'T-1', blurb: 'line one\nline two', priority: 'high', tags: ['a', 'b c'], created: '2026-10-20T08:24:13.939Z', refs: ['x', 'y'], nested: null, folded: 'a b' });
  });
  it('refuses malformed text (tab indent, duplicate key, stray line, alias/tag, unterminated quote)', () => {
    for (const t of ['id: a\n\tx: 1\n', 'id: a\nid: b\n', 'id: a\nnot a key line\n', 'id: *alias\n', "title: 'open\n", 'id: !tag x\n', '  indented: 1\n']) expect(readYamlSubset(t), JSON.stringify(t)).toBeNull();
  });
});

describe('K1 paradigm-slice:v1 projector', () => {
  it('bounds: counts every active task, top 5 (high first), last 5 decisions and lore, symbols from those entries', () => {
    const { root, home, P } = repo();
    for (let i = 1; i <= 9; i++) task(P, '2026-10-19', i, { priority: i === 7 || i === 8 ? 'high' : 'medium' });
    task(P, '2026-10-20', 1, { status: 'done' });
    task(P, '2026-10-20', 2, { status: 'in-progress', priority: 'low' });
    for (let i = 1; i <= 8; i++) decision(P, `TD-2026-10-1${i}-${100 + i}`, `2026-10-1${i}T01:00:00.000Z`, `Decision ${i}`);
    for (let i = 1; i <= 7; i++) lore(P, `2026-10-1${i}`, `L-2026-10-1${i}-a-001`, `2026-10-1${i}T02:00:00.000Z`, `Lore ${i}`, [`#sym-${i}`, '#gui', 'not a symbol']);
    const s = paradigmSlice(path.join(root, 'packages', 'x'), { home, now: Date.parse('2026-10-20T12:00:00Z') });
    fs.mkdirSync(path.join(root, 'packages', 'x'), { recursive: true });
    expect(s.v).toBe(PARADIGM_SLICE_V1);
    expect(s.state).toBe('ok');
    expect(s.name).toBe('proj');
    expect(s.tasks!.open).toBe(10);
    expect(s.tasks!.high).toBe(2);
    expect(s.tasks!.count).toEqual({ n: SLICE_TOP, of: 10 });
    expect(s.tasks!.items.map((t) => t.id).slice(0, 2).sort()).toEqual(['T-2026-10-19-007', 'T-2026-10-19-008']);
    expect(s.tasks!.items[0]!.title).toMatch(/^Task [78]$/); // first line of the blurb only
    expect(s.decisions!.items.map((d) => d.title)).toEqual(['Decision 8', 'Decision 7', 'Decision 6', 'Decision 5', 'Decision 4']);
    expect(s.decisions!.items[0]!.date).toBe('2026-10-18');
    expect(s.decisions!.count).toEqual({ n: 5, of: 8 });
    expect(s.lore!.items.map((l) => l.id)[0]).toBe('L-2026-10-17-a-001');
    expect(s.lore!.items[0]!.type).toBe('insight');
    expect(s.lore!.count).toEqual({ n: 5, of: 7 });
    expect(s.symbols).toEqual(['#sym-7', '#gui', '#sym-6', '#sym-5', '#sym-4', '#sym-3']);
    expect(s.newest).toBe('2026-10-18');
    expect(s.at).toBe('2026-10-20');
    expect(s.project).toBe(projectHue(path.join(root, 'packages', 'x')));
    expect(s.skipped).toEqual({ malformed: 0, refused: 0, secret: 0, truncated: false });
  });

  it('titles are capped at 120 code points, one line, and §4.5-sanitised (bidi glyphs, controls removed, flagged)', () => {
    const { root, home, P } = repo();
    decision(P, 'TD-2026-10-20-001', '2026-10-20T01:00:00.000Z', `"a\\u202Eb\\u0007c\\u001b[31mred ${'x'.repeat(300)}"`);
    const t = paradigmSlice(root, { home }).decisions!.items[0]!;
    expect([...t.title].length).toBeLessThanOrEqual(TITLE_MAX);
    expect(t.title.startsWith('a\u27e8RLO\u27e9bcred ')).toBe(true);
    expect(t.title.endsWith('\u2026')).toBe(true);
    expect(t.flags).toEqual(['hidden-chars', 'bidi']);
    expect(t.title).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/);
    expect(displayTitle('one\ntwo\tthree').text).toBe('one two three');
  });

  it('malformed files are skipped and counted, never half-read', () => {
    const { root, home, P } = repo();
    task(P, '2026-10-20', 1);
    put(path.join(P, 'tasks', 'entries', '2026-10-20', 'T-2026-10-20-002.yaml'), 'id: T-2\nid: T-dup\n');
    put(path.join(P, 'decisions', 'TD-2026-10-20-002.yaml'), 'title: \'unterminated\n');
    put(path.join(P, 'decisions', 'TD-2026-10-20-003.yaml'), 'id: TD-2026-10-20-003\n'); // no title
    decision(P, 'TD-2026-10-20-004', '2026-10-20T01:00:00.000Z', 'Fine');
    put(path.join(P, 'lore', 'entries', '2026-10-20', 'L-x.lore'), '\tid: x\n');
    const s = paradigmSlice(root, { home });
    expect(s.tasks!.open).toBe(1);
    expect(s.decisions!.items.map((d) => d.id)).toEqual(['TD-2026-10-20-004']);
    expect(s.lore!.items).toEqual([]);
    expect(s.skipped!.malformed).toBe(4);
  });

  it('symlinks are refused (a linked file, a linked store dir, a linked .paradigm) and an oversize file too', () => {
    const { root, home, P } = repo();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pslice-out-'));
    dirs.push(outside);
    put(path.join(outside, 'TD-2026-10-20-009.yaml'), 'id: TD-2026-10-20-009\ntitle: OUTSIDE SECRET\n');
    fs.mkdirSync(path.join(P, 'decisions'), { recursive: true });
    fs.symlinkSync(path.join(outside, 'TD-2026-10-20-009.yaml'), path.join(P, 'decisions', 'TD-2026-10-20-009.yaml'));
    fs.mkdirSync(path.join(outside, 'entries', '2026-10-20'), { recursive: true });
    put(path.join(outside, 'entries', '2026-10-20', 'L-o.lore'), 'id: L-o\ntitle: OUTSIDE LORE\n');
    fs.mkdirSync(path.join(P, 'lore'));
    fs.symlinkSync(path.join(outside, 'entries'), path.join(P, 'lore', 'entries'));
    put(path.join(P, 'decisions', 'TD-2026-10-20-010.yaml'), `id: TD-2026-10-20-010\ntitle: big\npad: '${'x'.repeat(MAX_FILE_BYTES)}'\n`);
    const s = paradigmSlice(root, { home });
    expect(JSON.stringify(s)).not.toMatch(/OUTSIDE/);
    expect(s.decisions!.items).toEqual([]);
    expect(s.skipped!.refused).toBe(3);
    // a symlinked .paradigm is never a root
    const { root: r2, home: h2 } = repo('linked');
    fs.rmSync(path.join(r2, '.paradigm'), { recursive: true });
    fs.symlinkSync(root + path.sep + '.paradigm', path.join(r2, '.paradigm'));
    const s2 = paradigmSlice(r2, { home: h2 });
    expect(s2.state).toBe('absent');
    expect(s2.skipped!.refused).toBe(1);
  });

  it('a path escaping through a linked date dir is refused', () => {
    const { root, home, P } = repo();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pslice-esc-'));
    dirs.push(outside);
    put(path.join(outside, 'T-2026-10-20-001.yaml'), 'id: T-2026-10-20-001\nblurb: ESCAPED\nstatus: open\n');
    fs.mkdirSync(path.join(P, 'tasks', 'entries'), { recursive: true });
    fs.symlinkSync(outside, path.join(P, 'tasks', 'entries', '2026-10-20'));
    const s = paradigmSlice(root, { home });
    expect(JSON.stringify(s)).not.toMatch(/ESCAPED/);
    expect(s.tasks!.open).toBe(0);
    expect(s.skipped!.refused).toBeGreaterThanOrEqual(1);
  });

  it('sensitivity secret is dropped and counted', () => {
    const { root, home, P } = repo();
    task(P, '2026-10-20', 1, { blurb: 'HIDDEN TASK', extra: 'sensitivity: secret\n' });
    decision(P, 'TD-2026-10-20-001', '2026-10-20T01:00:00.000Z', 'HIDDEN DECISION', 'sensitivity: secret\n');
    lore(P, '2026-10-20', 'L-1', '2026-10-20T01:00:00.000Z', 'HIDDEN LORE', ['#secret-sym'], "sensitivity: 'secret'\n");
    const s = paradigmSlice(root, { home });
    expect(JSON.stringify(s)).not.toMatch(/HIDDEN|secret-sym/);
    expect(s.skipped!.secret).toBe(3);
  });

  it('no .paradigm ⇒ absent; the walk stops at the .git holder and never reaches the home', () => {
    const { root, home } = repo();
    fs.rmSync(path.join(root, '.paradigm'), { recursive: true });
    fs.mkdirSync(path.join(path.dirname(root), '.paradigm')); // above the repo's .git: never used
    expect(paradigmSlice(root, { home }).state).toBe('absent');
    const h = repo('h');
    expect(paradigmSlice(path.join(h.root, 'x'), { home: h.root }).state).toBe('absent'); // the cwd is under the home root itself
  });

  it('property: no absolute path anywhere in the slice (seeded titles, ids, symbols, names)', () => {
    let seed = 0x5eed1234;
    const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const { root, home, P } = repo('repo-root');
    const frags = [root, home, '/Users/matt/code/x', '/etc/passwd', '~/secrets/key', 'C:\\Users\\m\\x', '\\\\server\\share\\f', '(/tmp/a/b)', 'see /private/var/x.yaml', 'a/b ratio', 'https://x.com/a/b', 'plain', '\u202e', '\u0007', path.join(P, 'decisions')];
    const title = (): string => {
      const s = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => pick(frags)).join(pick([' ', '', '=', ':']));
      return `'${s.replace(/'/g, "''")}'`;
    };
    for (let i = 1; i <= 40; i++) {
      task(P, '2026-10-20', i, { blurb: title().slice(1, -1).replace(/''/g, "'") });
      decision(P, `TD-2026-10-20-${String(i).padStart(3, '0')}`, `2026-10-20T0${i % 10}:00:00.000Z`, title());
      lore(P, '2026-10-20', `L-${i}`, `2026-10-20T0${i % 10}:00:00.000Z`, title(), [pick(['#ok', root, '/abs/path', '#gui'])]);
    }
    for (let k = 0; k < 5; k++) {
      const s = paradigmSlice(path.join(root, pick(['', 'a', 'a/b'])), { home });
      expect(s.state).toBe('ok');
      for (const str of walkStrings(s)) {
        expect(str.includes(root) || str.includes(home) || str.includes(os.tmpdir()), str).toBe(false);
        for (const re of ABS) expect(re.test(str), `${re} in ${JSON.stringify(str)}`).toBe(false);
      }
    }
    expect(redactPaths('x /a/b y')).toBe(`x ${PATH_GLYPH} y`);
    expect(redactPaths('and/or 1/2 https://h/a/b')).toBe('and/or 1/2 https://h/a/b');
  });

  it('the cache serves within its TTL and recomputes after', () => {
    const { root, home, P } = repo();
    const c = new ParadigmSliceCache(1000);
    expect(c.get(root, 0, { home }).tasks!.open).toBe(0);
    task(P, '2026-10-20', 1);
    expect(c.get(root, 500, { home }).tasks!.open).toBe(0);
    expect(c.get(root, 1500, { home }).tasks!.open).toBe(1);
  });
});

/** wall-clock ms of fn (the hostile inputs below took seconds to minutes under the old regexes) */
const timed = (fn: () => unknown): number => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};
const BOUND_MS = 250;

describe('Aegis H1: no super-linear regex over file text', () => {
  it('a long whitespace run inside a scalar ("title: a" + 60,000 spaces + "b", and a 64 KiB variant) completes well under the bound', () => {
    for (const n of [60_000, 64 * 1024]) {
      for (const tail of ['b', '#c', '\u2028', 'b #c']) {
        const text = `id: TD-1\ntitle: a${' '.repeat(n)}${tail}\n`;
        let y: ReturnType<typeof readYamlSubset> = null;
        expect(timed(() => (y = readYamlSubset(text))), `${n} ${JSON.stringify(tail)}`).toBeLessThan(BOUND_MS);
        // over SCALAR_MAX: skipped whole like a nested value (or the line is malformed), never half-read
        if (y) expect((y as Record<string, unknown>).title).toBeNull();
      }
    }
  });
  it('the same hostile file through the whole slice: under the bound, the decision skipped as malformed', () => {
    const { root, home, P } = repo();
    put(path.join(P, 'decisions', 'TD-2026-10-20-001.yaml'), `id: TD-2026-10-20-001\ntitle: a${' '.repeat(MAX_FILE_BYTES - 64)}b\n`);
    let s: ReturnType<typeof paradigmSlice> | undefined;
    expect(timed(() => (s = paradigmSlice(root, { home })))).toBeLessThan(BOUND_MS);
    expect(s!.decisions!.items).toEqual([]);
    expect(s!.skipped!.malformed).toBe(1);
  });
  it('a long whitespace run in a list item, a flow list and a quoted scalar stays linear too', () => {
    const sp = ' '.repeat(60_000);
    for (const text of [`tags:\n  - a${sp}b\n`, `refs: [a,${sp}b]\n`, `title: 'a'${sp}x\n`, `title: "a"${sp}x\n`, `k:${sp}\n`, `title: |${sp}x\n`]) expect(timed(() => readYamlSubset(text)), JSON.stringify(text.slice(0, 12))).toBeLessThan(BOUND_MS);
  });
  it('a title is cut to SCALAR_MAX before the sanitiser and the path regexes (a 1 MiB title, whitespace or slashes)', () => {
    for (const raw of [`a${' '.repeat(1 << 20)}b`, '/a'.repeat(1 << 19), `\\\\${'x'.repeat(1 << 20)}`]) {
      let t = { text: '', flags: [] as string[] };
      expect(timed(() => (t = displayTitle(raw)))).toBeLessThan(BOUND_MS);
      expect([...t.text].length).toBeLessThanOrEqual(TITLE_MAX);
    }
    expect(SCALAR_MAX).toBeLessThanOrEqual(4096);
  });
  it('comments still strip as before (the linear scan): only a # after a space or a tab starts one', () => {
    expect(readYamlSubset('a: x # c\nb: x#y\nc: "q" # c\nd: x\t# c\ne: #only\n')).toMatchObject({ a: 'x', b: 'x#y', c: 'q', d: 'x', e: '' });
  });
});

describe('Aegis M2: the root walk runs in realpath space and never reads the home', () => {
  it('a cwd that is a symlink to the home (or below it through the link) is never rooted at the home', () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pslice-home-')));
    dirs.push(base);
    const home = path.join(base, 'home');
    put(path.join(home, '.paradigm', 'decisions', 'TD-2026-10-20-001.yaml'), 'id: TD-2026-10-20-001\ntitle: HOME SECRET\n');
    fs.mkdirSync(path.join(home, 'sub'));
    fs.symlinkSync(home, path.join(base, 'link'));
    for (const cwd of [path.join(base, 'link'), path.join(base, 'link', 'sub')]) {
      const s = paradigmSlice(cwd, { home });
      expect(s.state, cwd).toBe('absent');
      expect(JSON.stringify(s)).not.toMatch(/HOME SECRET/);
    }
    // and the home handed in through a symlink is realpath'ed too
    expect(paradigmSlice(path.join(home, 'sub'), { home: path.join(base, 'link') }).state).toBe('absent');
  });
  it('a case-variant cwd of the home on a case-insensitive file system is the home (compared case-folded)', () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pslice-case-')));
    dirs.push(base);
    const home = path.join(base, 'Home');
    put(path.join(home, '.paradigm', 'decisions', 'TD-2026-10-20-001.yaml'), 'id: TD-2026-10-20-001\ntitle: HOME SECRET\n');
    fs.mkdirSync(path.join(home, 'sub'));
    const variant = path.join(base, 'HOME', 'sub');
    if (!fs.existsSync(variant)) return; // a case-sensitive volume: no variant to name
    const s = paradigmSlice(variant, { home });
    expect(s.state).toBe('absent');
    expect(JSON.stringify(s)).not.toMatch(/HOME SECRET/);
  });
});

describe('Aegis M3: bounded work per slice', () => {
  it('the cache is keyed by the realpath of the .paradigm root: two cwds and a symlink share one entry; the hue stays per cwd', () => {
    const { root, home } = repo();
    fs.mkdirSync(path.join(root, 'a'));
    fs.symlinkSync(root, path.join(path.dirname(root), 'alias'));
    const c = new ParadigmSliceCache(10_000);
    const cwds = [root, path.join(root, 'a'), path.join(path.dirname(root), 'alias')];
    for (const cwd of cwds) {
      const s = c.get(cwd, 0, { home });
      expect(s.state).toBe('ok');
      expect(s.project).toBe(projectHue(cwd));
    }
    expect(c.size).toBe(1);
  });
  it(`tasks parse at most MAX_TASK_PARSED (${MAX_TASK_PARSED}) files; the slice says truncated`, () => {
    const { root, home, P } = repo();
    for (let i = 1; i <= MAX_TASK_PARSED + 40; i++) put(path.join(P, 'tasks', 'entries', '2026-10-20', `T-${String(i).padStart(4, '0')}.yaml`), `id: T-${i}\nblurb: t\nstatus: open\n`);
    const s = paradigmSlice(root, { home });
    expect(s.tasks!.open).toBe(MAX_TASK_PARSED);
    expect(s.skipped!.truncated).toBe(true);
  });
  it(`a total byte budget (${SLICE_BYTE_BUDGET} bytes) per slice: past it nothing more is read`, () => {
    const { root, home, P } = repo();
    const pad = 'x'.repeat(MAX_FILE_BYTES - 200);
    const n = Math.ceil(SLICE_BYTE_BUDGET / (MAX_FILE_BYTES - 100)) + 4;
    for (let i = 1; i <= n; i++) put(path.join(P, 'tasks', 'entries', '2026-10-20', `T-${String(i).padStart(4, '0')}.yaml`), `id: T-${i}\nblurb: t\nstatus: open\npad: '${pad}'\n`);
    const s = paradigmSlice(root, { home });
    expect(s.tasks!.open).toBeLessThan(n);
    expect(s.tasks!.open).toBeGreaterThan(0);
    expect(s.skipped!.truncated).toBe(true);
  });
  it(`a directory is listed by a bounded iteration (MAX_ENTRIES ${MAX_ENTRIES}); the rest is never listed`, () => {
    const { root, home, P } = repo();
    fs.mkdirSync(path.join(P, 'decisions'));
    for (let i = 0; i < MAX_ENTRIES + 8; i++) fs.writeFileSync(path.join(P, 'decisions', `n-${i}`), '');
    const s = paradigmSlice(root, { home });
    expect(s.skipped!.truncated).toBe(true);
    expect(s.decisions!.count.of).toBe(0);
  });
});

describe('Aegis L1 + L3: the opened file is the checked file; realpaths are scrubbed', () => {
  it('a hard link (nlink > 1) naming an outside file is refused', () => {
    const { root, home, P } = repo();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pslice-hl-'));
    dirs.push(outside);
    put(path.join(outside, 'TD-2026-10-20-001.yaml'), 'id: TD-2026-10-20-001\ntitle: OUTSIDE HARDLINK\n');
    fs.mkdirSync(path.join(P, 'decisions'));
    fs.linkSync(path.join(outside, 'TD-2026-10-20-001.yaml'), path.join(P, 'decisions', 'TD-2026-10-20-001.yaml'));
    const s = paradigmSlice(root, { home });
    expect(JSON.stringify(s)).not.toMatch(/OUTSIDE/);
    expect(s.skipped!.refused).toBe(1);
  });
  it('a cwd reached through a symlink: neither its spelling nor its realpath appears in the slice', () => {
    const { root, home, P } = repo();
    fs.mkdirSync(path.join(root, 'sub'));
    const via = path.join(path.dirname(root), 'via');
    fs.symlinkSync(root, via);
    const cwd = path.join(via, 'sub');
    const real = fs.realpathSync(cwd);
    decision(P, 'TD-2026-10-20-001', '2026-10-20T01:00:00.000Z', `'x${real}y and z${cwd}w'`);
    const s = paradigmSlice(cwd, { home });
    expect(s.state).toBe('ok');
    for (const str of walkStrings(s)) expect(str.includes(real) || str.includes(cwd) || str.includes(via), str).toBe(false);
  });
});

describe('K1 paradigm.read:summary capability', () => {
  it('is a manifest capability form; a manifest holding it may list no egress at any tier', () => {
    expect(CAPABILITY_FORMS).toContain('paradigm.read:summary');
    expect(capabilityForm('paradigm.read:summary')).toBe('paradigm.read:summary');
    const m = (egress: unknown) => ({ manifest: 1, kind: 'mod', name: 'ctx', version: '1.0.0', abi: 'mod-abi:v1', provides: { views: [{ id: 'ctx.v', slot: 'sidebar', placement: 'append' }] }, requires: { capabilities: ['paradigm.read:summary'], egress } });
    const net = [{ host: 'example.com', purpose: 'upload' }];
    for (const tier of ['local', 'first-party'] as const) expect(() => validateManifest(m(net), { tier })).toThrow(/paradigm.read:summary cannot list egress/);
    expect(() => validateManifest(m('none'), { tier: 'local' })).not.toThrow();
  });
});
