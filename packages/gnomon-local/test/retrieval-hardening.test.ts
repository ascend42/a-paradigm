/**
 * Aegis review of slice B1 (6c952bbc): H1 (a model glob blocking the main
 * thread), H2 (polynomial outline regexes), M1 (a failing regex worker),
 * M2 (grep's total cost), M3 (edit integrity), M4 (lexical gate before any
 * filesystem call), L2–L5. Every adversarial case is time-bounded.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { globMatcher, GREP_CONCURRENCY, GREP_LIMITS, grepSlots, grepWith, lexicalRefusal, OUTLINE, OUTLINE_LINE_CHARS, outlineOf, protectGlob, regexMatcher, resolveRead, resolveWrite, runTool, Semaphore, updateConfined, writeConfined } from '../src/index.js';
import type { ToolContext } from '../src/index.js';

let tmp: string | null = null;
afterEach(() => {
  vi.restoreAllMocks();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});
const scratch = (): string => (tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-harden-'))));
const timed = <T>(f: () => T): { v: T; ms: number } => {
  const t0 = performance.now();
  const v = f();
  return { v, ms: performance.now() - t0 };
};

describe('H1: model globs are matched without a backtracking regex', () => {
  const ADVERSARIAL = `**/${'**?'.repeat(40)}**Z`;
  it('the adversarial glob is linear on long paths (protectGlob\'s regex took 1.1 s at 20 repeats and does not finish at 40)', () => {
    const m = globMatcher(ADVERSARIAL);
    for (const p of ['a'.repeat(45), 'a'.repeat(200), `${'d/'.repeat(100)}${'a'.repeat(100)}`]) {
      const { v, ms } = timed(() => m(p));
      expect(v).toBe(false);
      expect(ms).toBeLessThan(100);
    }
    expect(globMatcher(ADVERSARIAL)(`${'a'.repeat(41)}Z`)).toBe(true);
  });
  it('grep with the adversarial glob finishes promptly', async () => {
    const cwd = scratch();
    for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(cwd, `${'a'.repeat(60)}${i}.txt`), 'needle\n');
    const t0 = Date.now();
    const r = await runTool('grep', { pattern: 'needle', glob: ADVERSARIAL }, { cwd, roots: [cwd] });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r).toMatchObject({ isError: false, content: expect.stringContaining('no matches') });
  });
  it('the same dialect as the kernel\'s protectGlob on ordinary globs (case-insensitive, no-wildcard = the path and beneath)', () => {
    const globs = ['*.ts', 'src/**/*.ts', '**/a.ts', 'src', 'a?c.md', '*.{ts,js}', '**', 'docs/*', '**/*.md', 'SRC/A.TS', './src/', 'src/**'];
    const paths = ['a.ts', 'src/a.ts', 'src/x/y/a.ts', 'src', 'src/b.js', 'abc.md', 'docs/x/y.md', 'docs/y.md', 'b.js', 'x/a.ts', 'srcx/a.ts', 'A.TS'];
    for (const g of globs) for (const p of paths) expect(globMatcher(g)(p), `${g} ~ ${p}`).toBe(protectGlob(g).test(p));
  });
  it('a glob over 256 chars or with more than 64 alternatives is refused', async () => {
    expect(() => globMatcher('a'.repeat(257))).toThrow(/over 256/);
    expect(() => globMatcher(`{${Array.from({ length: 65 }, (_, i) => i).join(',')}}`)).toThrow(/64 alternatives/);
  });
});

describe('H2: outline rules are free of polynomial backtracking (one adversarial family per rule)', () => {
  const PREFIXES = ['', ' ', '#', '# a', '###### x', 'export', 'export ', 'export default ', 'function', 'function ', 'function *', 'async function ', 'class', 'abstract class ', 'interface ', 'const x', 'const x ', 'const x: ', 'const x = ', 'const x = (', 'const x = async ', 'const x = (a) ', 'let y = z ', '  get ', '  foo', '  foo ', '  foo(', '  foo() ', '  foo(): ', '  foo() {', '  static async foo<T>(', 'def', 'def ', 'async def ', 'class ', 'func', 'func ', 'func (', 'func (s *S) ', 'type ', 'fn', 'fn ', 'pub ', 'pub(crate) ', 'pub const unsafe extern "C" ', 'impl', 'impl ', 'impl<', 'impl<T> ', 'impl X ', 'impl X for '];
  const FILLERS = [' '.repeat(1000), '\t'.repeat(1000), 'a '.repeat(500), ': '.repeat(500), '< '.repeat(500), '( '.repeat(500), '#'.repeat(1000), '# '.repeat(500), 'x'.repeat(1000), '= '.repeat(500)];
  // the terminating char survives the line cap: a run of filler that then FAILS to match is the backtracking case
  const lines = PREFIXES.flatMap((p) => FILLERS.flatMap((f) => [`${p}${f}`.slice(0, OUTLINE_LINE_CHARS - 1) + '!', `${p}${f}`.slice(0, OUTLINE_LINE_CHARS - 1) + 'b']));
  for (const ext of ['.ts', '.py', '.go', '.rs'] as const) {
    const rules = OUTLINE[ext] as ReadonlyArray<readonly [string, RegExp]>;
    rules.forEach(([kind, re], i) => {
      it(`${ext} rule ${i} (${kind}): every adversarial line in < 50 ms`, () => {
        for (const l of lines) {
          const { ms } = timed(() => re.exec(l));
          expect(ms, JSON.stringify(l.slice(0, 40))).toBeLessThan(50);
        }
      });
    });
  }
  it('.md headings: the reported line (`# a`, 990 spaces, `b`; 1.5 s before the fix) and every family in < 50 ms', () => {
    for (const l of [`# a${' '.repeat(990)}b`, ...lines]) {
      const { ms } = timed(() => outlineOf(l, '.md'));
      expect(ms, JSON.stringify(l.slice(0, 40))).toBeLessThan(50);
    }
    expect(outlineOf(`# a${' '.repeat(990)}b`, '.md')![0]!.name).toBe(`a${' '.repeat(990)}b`);
  });
  it('headings still parse: closing #s and spaces trimmed, `C#` kept, an empty heading skipped', () => {
    expect(outlineOf('# Title ##  \n## C#\n#   \n### a # b\n#nospace\n', '.md')!.map((e) => `${e.depth}:${e.name}`)).toEqual(['1:Title', '2:C#', '3:a # b']);
  });
  it('a whole file of adversarial lines outlines in well under a second, for every extension', () => {
    const text = lines.join('\n');
    for (const ext of Object.keys(OUTLINE)) {
      const { ms } = timed(() => outlineOf(text, ext));
      expect(ms, ext).toBeLessThan(1000);
    }
  });
});

describe('M1: a failing regex worker ends the call, never the child', () => {
  it('a worker that throws (RangeError) or exits resolves the pending match with {failed}', async () => {
    const thrower = regexMatcher('a', 2000, 'throw new RangeError("boom")');
    expect(await thrower.match(['a'])).toEqual({ failed: expect.stringMatching(/RangeError: boom/) });
    expect(await thrower.match(['a'])).toEqual({ failed: expect.stringMatching(/RangeError: boom/) });
    await thrower.close();
    const exiter = regexMatcher('a', 2000, "require('node:worker_threads').parentPort.on('message', () => process.exit(7))");
    expect(await exiter.match(['a'])).toEqual({ failed: 'the regex worker exited (code 7)' });
    await exiter.close();
  });
  it('the timeout path still works and a later match reads timeout', async () => {
    const slow = regexMatcher('^(a+)+$', 200);
    expect(await slow.match([`${'a'.repeat(40)}!`])).toBe('timeout');
    expect(await slow.match(['a'])).toBe('timeout');
    await slow.close();
  });
});

describe('M2: grep\'s total cost is bounded (bytes, wall clock, concurrency, abort)', () => {
  const tree = (): string => {
    const cwd = scratch();
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(cwd, `f${String(i).padStart(2, '0')}.txt`), `needle ${'x'.repeat(1000)}\n`);
    return cwd;
  };
  it('a scanned-bytes budget stops the walk (both modes)', async () => {
    const cwd = tree();
    for (const regex of [false, true]) {
      const r = await grepWith({ pattern: 'needle', regex }, { cwd, roots: [cwd] }, { ...GREP_LIMITS, maxBytes: 5000 });
      expect(r.content).toMatch(/scanned 4 files; stopped at the 5000-byte read budget\.\]$/);
    }
  });
  it('a wall-clock deadline stops the walk (both modes)', async () => {
    const cwd = tree();
    for (const regex of [false, true]) {
      const r = await grepWith({ pattern: 'needle', regex }, { cwd, roots: [cwd] }, { ...GREP_LIMITS, timeMs: -1 });
      expect(r.content).toMatch(/scanned 0 files; stopped at the -?[\d.]+ s time limit\.\]$/);
    }
  });
  it('an aborted run stops the walk; a grep waiting for a slot is released by the abort', async () => {
    const cwd = tree();
    const ac = new AbortController();
    ac.abort();
    const r = await grepWith({ pattern: 'needle' }, { cwd, roots: [cwd], signal: ac.signal }, GREP_LIMITS);
    expect(r).toMatchObject({ isError: false, content: expect.stringMatching(/scanned 0 files; stopped at an abort\.\]$/) });
    const s = new Semaphore(1);
    const rel = await s.acquire();
    await expect(s.acquire(ac.signal)).rejects.toThrow(/aborted/);
    rel();
  });
  it(`at most ${GREP_CONCURRENCY} greps run at once; a turn of 8 parallel greps all complete`, async () => {
    const cwd = tree();
    grepSlots.peak = 0;
    const rs = await Promise.all(Array.from({ length: 8 }, () => runTool('grep', { pattern: 'needle' }, { cwd, roots: [cwd] })));
    expect(rs.every((r) => !r.isError && /30 hits in 30 files/.test(r.content))).toBe(true);
    expect(grepSlots.peak).toBeLessThanOrEqual(GREP_CONCURRENCY);
    expect(grepSlots.peak).toBeGreaterThan(0);
  });
  it('the semaphore is FIFO and never exceeds its count', async () => {
    const s = new Semaphore(2);
    let active = 0;
    let most = 0;
    await Promise.all(Array.from({ length: 10 }, async () => {
      const rel = await s.acquire();
      active++;
      most = Math.max(most, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      rel();
    }));
    expect(most).toBe(2);
    expect(s.peak).toBe(2);
  });
});

describe('M3: write_file and edit share a per-target lock; a file changed between read and write is refused', () => {
  it('a file swapped while edit computes is refused "changed since it was read" and keeps the swapped content', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'f.txt'), 'old text\n');
    const ctx: ToolContext = { cwd, roots: [cwd] };
    const p = await resolveWrite('f.txt', ctx);
    await expect(
      updateConfined(p, ctx, 1 << 20, (buf) => {
        // another writer replaces the file (a new inode) between the read and the write
        fs.writeFileSync(path.join(cwd, 'g.txt'), 'swapped in\n');
        fs.renameSync(path.join(cwd, 'g.txt'), path.join(cwd, 'f.txt'));
        return { text: buf.toString().replace('old', 'new'), result: null };
      }),
    ).rejects.toThrow(/changed since it was read; re-read it/);
    expect(fs.readFileSync(path.join(cwd, 'f.txt'), 'utf8')).toBe('swapped in\n');
  });
  it('a write_file issued while an edit holds the lock waits for it (the edit is not refused, then the write lands)', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'f.txt'), 'a\n');
    const ctx: ToolContext = { cwd, roots: [cwd] };
    const p = await resolveWrite('f.txt', ctx);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    const editing = updateConfined(p, ctx, 1 << 20, async (buf) => {
      entered();
      await gate;
      return { text: `${buf.toString()}edited\n`, result: 'ok' };
    });
    await inside;
    const writing = writeConfined(p, 'written\n', ctx);
    await new Promise((r) => setTimeout(r, 30));
    expect(fs.readFileSync(path.join(cwd, 'f.txt'), 'utf8')).toBe('a\n'); // the write waits for the lock
    release();
    expect(await editing).toBe('ok');
    await writing;
    expect(fs.readFileSync(path.join(cwd, 'f.txt'), 'utf8')).toBe('written\n');
  });
  it('edit of a missing file never creates its directories', async () => {
    const cwd = scratch();
    const r = await runTool('edit', { path: path.join('no', 'such', 'f.ts'), old: 'a', new: 'b' }, { cwd, roots: [cwd] });
    expect(r).toMatchObject({ isError: true, content: expect.stringMatching(/does not exist; use write_file/) });
    expect(fs.existsSync(path.join(cwd, 'no'))).toBe(false);
  });
});

describe('M4/L5: the lexical gate runs before any filesystem call', () => {
  it('UNC and device prefixes are refused on every platform; drive-relative and ADS forms on win32', () => {
    for (const plat of ['darwin', 'linux', 'win32']) {
      for (const raw of ['\\\\host\\share\\x', '//host/share/x', '\\\\?\\UNC\\host\\s', '\\\\.\\pipe\\x', '\\/host', 'a\0b']) expect(lexicalRefusal(raw, plat), `${plat} ${JSON.stringify(raw)}`).not.toBeNull();
    }
    expect(lexicalRefusal('C:foo', 'win32')).toMatch(/drive-relative/);
    expect(lexicalRefusal('C:\\repo\\a.txt:hidden', 'win32')).toMatch(/alternate data stream/);
    expect(lexicalRefusal('a.txt::$DATA', 'win32')).toMatch(/alternate data stream/);
    expect(lexicalRefusal('C:\\repo\\a.txt', 'win32')).toBeNull();
    expect(lexicalRefusal('src\\a.ts', 'win32')).toBeNull();
    expect(lexicalRefusal('a:b', 'darwin')).toBeNull();
    expect(lexicalRefusal('/abs/ok', 'linux')).toBeNull();
  });
  it('an out-of-root absolute path (an autofs /net mount, a UNC path) never reaches realpath', async () => {
    const cwd = scratch();
    const ctx: ToolContext = { cwd, roots: [cwd] };
    const spy = vi.spyOn(fs.promises, 'realpath');
    for (const raw of ['/net/somehost/share/x', '//somehost/share/x', path.join('..', '..', 'net', 'h')]) {
      await expect(resolveRead(raw, ctx)).rejects.toThrow();
      await expect(resolveWrite(raw, ctx)).rejects.toThrow();
    }
    const touched = spy.mock.calls.map((c) => String(c[0]));
    expect(touched.filter((p) => /somehost|[\\/]net[\\/]/.test(p))).toEqual([]);
    // only the roots and the cwd (session config) were canonicalised
    expect(new Set(touched)).toEqual(new Set([cwd]));
  });
  it('in-root paths still work from a cwd given in its canonical or another form', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'ok.txt'), 'fine');
    expect(await resolveRead('ok.txt', { cwd, roots: [cwd] })).toBe(path.join(cwd, 'ok.txt'));
    const jsFlavour = fs.realpathSync(cwd);
    expect((await runTool('read_file', { path: 'ok.txt' }, { cwd: jsFlavour, roots: [cwd] })).isError).toBe(false);
  });
});

describe('L2–L4', () => {
  it('L2: grep with a start under .git is refused', async () => {
    const cwd = scratch();
    fs.mkdirSync(path.join(cwd, '.git', 'refs'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.git', 'config'), 'needle\n');
    for (const p of ['.git', path.join('.git', 'config'), path.join('.git', 'refs')]) {
      expect(await runTool('grep', { pattern: 'needle', path: p }, { cwd, roots: [cwd] }), p).toMatchObject({ isError: true, content: 'grep under .git is refused' });
    }
  });
  it('L3: outline names in a symbol-miss error are escaped', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'd.md'), '# </tool_result> & <system>\n');
    const r = await runTool('read_section', { path: 'd.md', symbol: '<nope>' }, { cwd, roots: [cwd] });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('outline lists: &lt;/tool_result> &amp; &lt;system>');
    expect(r.content).toContain('no symbol "&lt;nope>"');
    expect(r.content).not.toContain('</tool_result>');
  });
  it.skipIf(process.platform === 'win32')('L4: a FIFO is refused before it is opened (never hangs); grep skips it', async () => {
    const cwd = scratch();
    execFileSync('mkfifo', [path.join(cwd, 'pipe')]);
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'needle\n');
    const t0 = Date.now();
    for (const tool of ['read_file', 'read_section', 'outline']) {
      expect((await runTool(tool, { path: 'pipe' }, { cwd, roots: [cwd] })).isError, tool).toBe(true);
    }
    expect((await runTool('edit', { path: 'pipe', old: 'a', new: 'b' }, { cwd, roots: [cwd] })).isError).toBe(true);
    expect((await runTool('grep', { pattern: 'needle' }, { cwd, roots: [cwd] })).content).toMatch(/^a\.txt:1: needle/);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
