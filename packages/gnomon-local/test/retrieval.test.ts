/**
 * Slice B1 (TD-2026-10-27-833): the retrieval tools — grep, outline,
 * read_section, edit — and the bounded list_dir. G-LCL-11: grep and outline
 * never leave the session roots, never follow a symlink or a hard link out;
 * regex limits; binaries skipped; deterministic order; edit's exactly-one
 * rule with the protect and .git refusals of write_file.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRegex, GREP_LINE_CHARS, GREP_MAX_HITS, LIST_MAX_ENTRIES, outlineOf, protectGlob, PROTECTED_PREFIX, runTool, SpillStore, TOOL_ORDER, TOOLS, surfaceTools } from '../src/index.js';
import type { ToolContext } from '../src/index.js';

let tmp: string | null = null;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});
const scratch = (): string => (tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-retrieval-'))));

// A directory link is a junction on win32 (no privilege needed); a file symlink needs Developer Mode or admin there.
const linkDir = (target: string, p: string) => fs.symlinkSync(target, p, 'junction');
const linkFile = (target: string, p: string): boolean => {
  try {
    fs.symlinkSync(target, p);
    return true;
  } catch (e) {
    if (process.platform === 'win32' && (e as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw e;
  }
};

/** repo/ (the root) and outside/ (a sibling holding SECRET), with every escape route planted inside repo/. */
function world() {
  const root = scratch();
  const cwd = path.join(root, 'repo');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'node_modules', 'dep'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.ts'), 'export const SECRET = "id_rsa";\n');
  fs.writeFileSync(path.join(outside, 'hl-target.ts'), 'const SECRET = 1;\n');
  fs.writeFileSync(path.join(cwd, '.git', 'config'), 'SECRET in git config\n');
  fs.writeFileSync(path.join(cwd, 'node_modules', 'dep', 'i.js'), 'SECRET in a dep\n');
  fs.writeFileSync(path.join(cwd, 'src', 'b.ts'), 'export function beta() {\n  return "SECRET beta";\n}\n');
  fs.writeFileSync(path.join(cwd, 'src', 'a.ts'), 'export function alpha() {\n  return "SECRET alpha";\n}\n');
  fs.writeFileSync(path.join(cwd, 'z.md'), '# Title\nSECRET in docs\n');
  fs.writeFileSync(path.join(cwd, 'bin.dat'), Buffer.from([0x53, 0x45, 0x43, 0x52, 0x45, 0x54, 0x00, 0x01]));
  linkDir(outside, path.join(cwd, 'dirlink'));
  const fileLink = linkFile(path.join(outside, 'secret.ts'), path.join(cwd, 'filelink.ts'));
  fs.linkSync(path.join(outside, 'hl-target.ts'), path.join(cwd, 'hardlink.ts'));
  const ctx: ToolContext = { cwd, roots: [cwd] };
  return { root, cwd, outside, ctx, fileLink };
}

describe('G-LCL-11: grep never leaves the roots, never follows a symlink or a hard link', () => {
  it('a walk of the root finds only in-root, singly-linked, non-binary files outside .git and node_modules, in name order', async () => {
    const { ctx } = world();
    const r = await runTool('grep', { pattern: 'SECRET' }, ctx);
    expect(r.isError).toBe(false);
    const hits = r.content.split('\n').filter((l) => !l.startsWith('[grep:'));
    expect(hits).toEqual(['src/a.ts:2: return "SECRET alpha";', 'src/b.ts:2: return "SECRET beta";', 'z.md:2: SECRET in docs']);
    expect(r.content).not.toContain('id_rsa');
    expect(r.content).not.toMatch(/git config|a dep|hl-target|hardlink/);
    expect(r.content).toMatch(/skipped: .*1 binary/);
    expect(r.content).toMatch(/\d+ links/);
  });
  it('grep with path= outside, ../, a symlinked dir or a symlinked file is refused; a hard-linked file is refused', async () => {
    const { ctx, outside, fileLink } = world();
    for (const p of [outside, path.join('..', 'outside'), 'dirlink', path.join('dirlink', 'secret.ts'), ...(fileLink ? ['filelink.ts'] : []), 'hardlink.ts']) {
      const r = await runTool('grep', { pattern: 'SECRET', path: p }, ctx);
      expect(r.isError, p).toBe(true);
      expect(r.content).not.toContain('id_rsa');
    }
  });
  it('outline never reads outside the roots, through a symlink, or a hard link', async () => {
    const { ctx, outside, fileLink } = world();
    for (const p of [path.join(outside, 'secret.ts'), path.join('..', 'outside', 'secret.ts'), path.join('dirlink', 'secret.ts'), ...(fileLink ? ['filelink.ts'] : []), 'hardlink.ts']) {
      const r = await runTool('outline', { path: p }, ctx);
      expect(r.isError, p).toBe(true);
      expect(r.content).not.toContain('SECRET');
    }
    expect(await runTool('outline', { path: path.join('src', 'a.ts') }, ctx)).toMatchObject({ isError: false, content: expect.stringContaining('1: export function alpha() {') });
  });
  it('read_section refuses the same escapes', async () => {
    const { ctx, outside, fileLink } = world();
    for (const p of [path.join(outside, 'secret.ts'), path.join('dirlink', 'secret.ts'), ...(fileLink ? ['filelink.ts'] : []), 'hardlink.ts']) {
      const r = await runTool('read_section', { path: p, from: 1, to: 2 }, ctx);
      expect(r.isError, p).toBe(true);
      expect(r.content).not.toContain('id_rsa');
    }
  });
  it('the order is deterministic (code-unit name order, depth first) across runs', async () => {
    const { cwd, ctx } = world();
    for (const n of ['B.ts', 'a.ts', '_x.ts', 'Z', 'aa.ts']) fs.writeFileSync(path.join(cwd, n), 'needle\n');
    const runs = await Promise.all([1, 2, 3].map(() => runTool('grep', { pattern: 'needle' }, ctx)));
    expect(new Set(runs.map((r) => r.content)).size).toBe(1);
    expect(runs[0]!.content.split('\n').filter((l) => !l.startsWith('[')).map((l) => l.split(':')[0])).toEqual(['B.ts', 'Z', '_x.ts', 'a.ts', 'aa.ts']);
  });
});

describe('grep: literal by default, regex opt-in and limited, bounded output', () => {
  it('literal by default: regex metacharacters are plain text', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'f.txt'), 'a.b\naxb\n(x)+\n');
    const ctx = { cwd, roots: [cwd] };
    expect((await runTool('grep', { pattern: 'a.b' }, ctx)).content.split('\n')[0]).toBe('f.txt:1: a.b');
    expect((await runTool('grep', { pattern: '(x)+' }, ctx)).content.split('\n')[0]).toBe('f.txt:3: (x)+');
    const re = await runTool('grep', { pattern: 'a.b', regex: true }, ctx);
    expect(re.content.split('\n').slice(0, 2)).toEqual(['f.txt:1: a.b', 'f.txt:2: axb']);
  });
  it('regex limits: length cap, no backreference, no lookbehind, must compile', async () => {
    expect(checkRegex('a'.repeat(257))).toMatch(/over 256/);
    expect(checkRegex('(a)\\1')).toMatch(/backreference/);
    expect(checkRegex('(?<n>a)\\k<n>')).toMatch(/backreference/);
    expect(checkRegex('(?<=a)b')).toMatch(/lookbehind/);
    expect(checkRegex('(?<!a)b')).toMatch(/lookbehind/);
    expect(checkRegex('([a-')).toMatch(/invalid/);
    expect(checkRegex('\\\\1')).toBeNull(); // an escaped backslash then "1" is not a backreference
    expect(checkRegex('foo|ba[rz]\\d+')).toBeNull();
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'f.txt'), 'aa\n');
    const r = await runTool('grep', { pattern: '(a)\\1', regex: true }, { cwd, roots: [cwd] });
    expect(r).toMatchObject({ isError: true, content: expect.stringMatching(/^regex refused: backreferences/) });
  });
  it('a catastrophic regex is stopped by the time limit, never hangs the child', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'f.txt'), `${'a'.repeat(40)}!\n`);
    const t0 = Date.now();
    const r = await runTool('grep', { pattern: '^(a+)+$', regex: true }, { cwd, roots: [cwd] });
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.isError).toBe(false);
    expect(r.content).toMatch(/regex time limit/);
  }, 20_000);
  it('caps: at most 60 hits (max lowers it), lines cut to 200 chars, glob filters', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'many.ts'), Array.from({ length: 100 }, (_, i) => `hit ${i}`).join('\n'));
    fs.writeFileSync(path.join(cwd, 'long.js'), `hit ${'x'.repeat(1000)}\n`);
    const ctx = { cwd, roots: [cwd] };
    const all = await runTool('grep', { pattern: 'hit' }, ctx);
    expect(all.content.split('\n').filter((l) => !l.startsWith('[grep:'))).toHaveLength(GREP_MAX_HITS);
    expect(all.content).toMatch(/stopped at the 60-hit cap/);
    expect((await runTool('grep', { pattern: 'hit', max: 5 }, ctx)).content.split('\n')).toHaveLength(6);
    const long = await runTool('grep', { pattern: 'hit', glob: '*.js' }, ctx);
    const line = long.content.split('\n')[0]!;
    expect(line.startsWith('long.js:1: hit')).toBe(true);
    expect(line.length).toBeLessThanOrEqual('long.js:1: '.length + GREP_LINE_CHARS + 1);
    expect(long.content).not.toContain('many.ts');
  });
});

describe('outline: deterministic extraction by extension', () => {
  it('ts/js: functions, classes, methods, types, exported consts and arrows, with line numbers', () => {
    const src = ['import x from "y";', 'export interface Opts { a: number }', 'export type Id = string;', 'export class Store {', '  private m = 1;', '  async get(id: Id): Promise<number> {', '    if (id) {', '      return 1;', '    }', '  }', '}', 'export const run = async (a: number) => {', '};', 'function helper() {}', 'export const LIMIT = 3;'].join('\n');
    expect(outlineOf(src, '.ts')!.map((e) => `${e.line}:${e.kind}:${e.name}`)).toEqual(['2:type:Opts', '3:type:Id', '4:class:Store', '6:method:get', '12:function:run', '14:function:helper', '15:export:LIMIT']);
  });
  it('py, go, rs and md headings (not inside fences); unknown extensions have none', () => {
    expect(outlineOf('class A:\n    def m(self):\n        pass\nasync def f():\n    pass\n', '.py')!.map((e) => e.name)).toEqual(['A', 'm', 'f']);
    expect(outlineOf('package x\nfunc (s *S) Run() error {\n}\ntype S struct {}\nfunc main() {}\n', '.go')!.map((e) => e.name)).toEqual(['Run', 'S', 'main']);
    expect(outlineOf('pub struct P;\nimpl P {\n    pub fn new() -> Self { P }\n}\nfn main() {}\n', '.rs')!.map((e) => e.name)).toEqual(['P', 'P', 'new', 'main']);
    expect(outlineOf('# A\ntext\n```\n# not a heading\n```\n## B\n', '.md')!.map((e) => `${e.depth}:${e.name}`)).toEqual(['1:A', '2:B']);
    expect(outlineOf('x', '.txt')).toBeNull();
  });
});

describe('read_section: lines, a symbol via outline, paging', () => {
  it('from/to and symbol sections', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'm.ts'), ['export function one() {', '  return 1;', '}', 'export function two() {', '  return 2;', '}'].join('\n'));
    const ctx = { cwd, roots: [cwd] };
    expect((await runTool('read_section', { path: 'm.ts', from: 2, to: 3 }, ctx)).content).toBe('[read_section m.ts: lines 2-3 of 6.]\n  return 1;\n}');
    const sym = await runTool('read_section', { path: 'm.ts', symbol: 'two' }, ctx);
    expect(sym.content).toBe('[read_section m.ts (function two): lines 4-6 of 6.]\nexport function two() {\n  return 2;\n}');
    expect(await runTool('read_section', { path: 'm.ts', symbol: 'nope' }, ctx)).toMatchObject({ isError: true, content: expect.stringContaining('outline lists: one, two') });
    expect((await runTool('read_section', { path: 'm.ts', from: 99 }, ctx)).isError).toBe(true);
  });
  it('a section over the cap is paged and names the next from', async () => {
    const cwd = scratch();
    fs.writeFileSync(path.join(cwd, 'big.txt'), Array.from({ length: 500 }, (_, i) => `line ${i + 1} ${'y'.repeat(40)}`).join('\n'));
    const r = await runTool('read_section', { path: 'big.txt' }, { cwd, roots: [cwd], resultCap: 2000 });
    expect(r.content.length).toBeLessThanOrEqual(2000);
    const m = /lines 1-(\d+) of 500\. Call read_section path="big.txt" from=(\d+) for more\./.exec(r.content)!;
    expect(Number(m[2])).toBe(Number(m[1]) + 1);
  });
  it('an unknown or expired handle is a clear error', async () => {
    const cwd = scratch();
    expect(await runTool('read_section', { handle: '@r9' }, { cwd, roots: [cwd], spill: new SpillStore() })).toMatchObject({ isError: true, content: expect.stringMatching(/unknown or expired/) });
  });
});

describe('edit: exactly one occurrence, the write confinement of write_file', () => {
  const setup = () => {
    const cwd = scratch();
    fs.mkdirSync(path.join(cwd, '.git'));
    fs.writeFileSync(path.join(cwd, '.git', 'config'), 'x = 1\n');
    fs.writeFileSync(path.join(cwd, 'f.ts'), 'const a = 1;\nconst b = 2;\nconst b2 = 2;\n');
    return { cwd, ctx: { cwd, roots: [cwd] } as ToolContext };
  };
  it('one match ⇒ replaced; 0 and >1 are refused with a clear message and change nothing', async () => {
    const { cwd, ctx } = setup();
    expect(await runTool('edit', { path: 'f.ts', old: 'const a = 1;', new: 'const a = 10;' }, ctx)).toEqual({ content: 'edited f.ts: replaced 1 occurrence at line 1 (1 line → 1)', isError: false });
    expect(fs.readFileSync(path.join(cwd, 'f.ts'), 'utf8')).toBe('const a = 10;\nconst b = 2;\nconst b2 = 2;\n');
    const none = await runTool('edit', { path: 'f.ts', old: 'const c', new: 'x' }, ctx);
    expect(none).toMatchObject({ isError: true, content: expect.stringMatching(/not found .*\(0 matches\)/) });
    const many = await runTool('edit', { path: 'f.ts', old: '= 2;', new: '= 3;' }, ctx);
    expect(many).toMatchObject({ isError: true, content: expect.stringMatching(/matches 2 times .*\(lines 2, 3\)/) });
    expect(fs.readFileSync(path.join(cwd, 'f.ts'), 'utf8')).toBe('const a = 10;\nconst b = 2;\nconst b2 = 2;\n');
    expect((await runTool('edit', { path: 'missing.ts', old: 'a', new: 'b' }, ctx)).content).toMatch(/does not exist; use write_file/);
  });
  it('protect globs and .git are refused like write_file (the protected prefix the kernel reads)', async () => {
    const { cwd, ctx } = setup();
    const protect = [protectGlob('f.ts')];
    const r = await runTool('edit', { path: 'f.ts', old: 'const a = 1;', new: 'x' }, { ...ctx, protect });
    expect(r.isError).toBe(true);
    expect(r.content.startsWith(PROTECTED_PREFIX)).toBe(true);
    for (const p of [path.join('.git', 'config'), path.join('.GIT', 'config'), path.join('git~1', 'config')]) expect((await runTool('edit', { path: p, old: 'x = 1', new: 'x = 2' }, ctx)).isError, p).toBe(true);
    expect(fs.readFileSync(path.join(cwd, '.git', 'config'), 'utf8')).toBe('x = 1\n');
  });
  it('outside the roots, a symlinked dir, a symlink final component or a hard link: refused, nothing outside changes', async () => {
    const { outside, ctx, fileLink } = world();
    for (const p of [path.join(outside, 'secret.ts'), path.join('..', 'outside', 'secret.ts'), path.join('dirlink', 'secret.ts'), ...(fileLink ? ['filelink.ts'] : []), 'hardlink.ts']) {
      expect((await runTool('edit', { path: p, old: 'SECRET', new: 'PWNED' }, ctx)).isError, p).toBe(true);
    }
    expect(fs.readFileSync(path.join(outside, 'secret.ts'), 'utf8')).toContain('id_rsa');
    expect(fs.readFileSync(path.join(outside, 'hl-target.ts'), 'utf8')).toBe('const SECRET = 1;\n');
  });
  it('parallel edits of one file are serialised (neither is lost)', async () => {
    const { cwd, ctx } = setup();
    const [x, y] = await Promise.all([runTool('edit', { path: 'f.ts', old: 'const a = 1;', new: 'const a = 7;' }, ctx), runTool('edit', { path: 'f.ts', old: 'const b2 = 2;', new: 'const b2 = 9;' }, ctx)]);
    expect([x.isError, y.isError]).toEqual([false, false]);
    expect(fs.readFileSync(path.join(cwd, 'f.ts'), 'utf8')).toBe('const a = 7;\nconst b = 2;\nconst b2 = 9;\n');
  });
});

describe('list_dir is bounded; the surface order is fixed; compact descriptions keep the key usage', () => {
  it(`list_dir prints at most ${LIST_MAX_ENTRIES} entries, then how many more`, async () => {
    const cwd = scratch();
    for (let i = 0; i < LIST_MAX_ENTRIES + 25; i++) fs.writeFileSync(path.join(cwd, `f${String(i).padStart(3, '0')}`), '');
    fs.mkdirSync(path.join(cwd, 'zz-dir'));
    const r = await runTool('list_dir', {}, { cwd, roots: [cwd] });
    const lines = r.content.split('\n');
    expect(lines).toHaveLength(LIST_MAX_ENTRIES + 1);
    expect(lines.at(-1)).toBe('[list_dir: 26 more entries not shown (1 dirs, 25 files); use grep with glob= or list a subdirectory.]');
  });
  it('TOOLS, every surface and the text-tool prompt follow TOOL_ORDER', () => {
    expect(TOOL_ORDER).toEqual(['list_dir', 'read_file', 'read_section', 'grep', 'outline', 'edit', 'write_file']);
    expect(TOOLS.map((t) => t.name)).toEqual([...TOOL_ORDER]);
    expect(surfaceTools([...TOOLS].reverse(), 'compact').map((t) => t.name)).toEqual([...TOOL_ORDER]);
    expect(surfaceTools([...TOOLS].reverse(), 'full').map((t) => t.name)).toEqual([...TOOL_ORDER]);
  });
  it('the compact surface (first line, 120 chars) still says how to call each new tool', () => {
    const c = Object.fromEntries(surfaceTools(TOOLS, 'compact').map((t) => [t.name, t.description]));
    for (const d of Object.values(c)) expect(d.length).toBeLessThanOrEqual(120);
    expect(c.grep).toMatch(/literal; regex=true/);
    expect(c.grep).toMatch(/path:line: text/);
    expect(c.read_section).toMatch(/from\.\.to/);
    expect(c.read_section).toMatch(/handle="@r1"/);
    expect(c.outline).toMatch(/line numbers/);
    expect(c.edit).toMatch(/one exact occurrence of old with new/);
    expect(c.list_dir).toMatch(/at most 200 entries/);
  });
});
