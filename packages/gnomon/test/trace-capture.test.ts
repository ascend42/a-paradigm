/**
 * #trace-capture units: the per-folder toggle (trace/mode.ts), the writer (trace/capture.ts) and the session-policy
 * falsifiers (a session can neither flip its tracing nor read, hide or alter its trace). POSIX modes and
 * O_NOFOLLOW are asserted, hence darwin + linux (registry row).
 */
// @gnomon-platform: darwin, linux
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setTraceMode, traceModeOf, tracedFolders, traceFoldersPath, TRACE_FOLDERS_FILE } from '../src/kernel/trace/mode.js';
import { openTraceStream, redactArgv, secretShaped, traceDirOf, traceFileName, TraceRefused, type TraceSink } from '../src/kernel/trace/capture.js';
import { buildSessionPolicy, type PolicyPath } from '../src/kernel/manifest/policy.js';

let root = '';
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = '';
});
function world(): { home: string; project: string } {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-trace-')));
  const home = path.join(root, 'home');
  const project = path.join(root, 'repo');
  fs.mkdirSync(project);
  return { home, project };
}
const HSID = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const mode = (p: string): number => fs.lstatSync(p).mode & 0o777;
const lines = (f: string): Array<{ t: string; dir: string; line: unknown }> => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const covers = (d: PolicyPath, p: string): boolean => (d.match === 'literal' ? d.path === p : d.match === 'prefix' ? p.startsWith(d.path) : d.match === 'subpath' ? p === d.path || p.startsWith(`${d.path}${path.sep}`) : false);
const settle = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('#trace-capture toggle (trace/mode.ts)', () => {
  it('on / off / list, keyed by realpath; the file is 0600 in a 0700 home', () => {
    const { home, project } = world();
    const link = path.join(root, 'link-to-repo');
    fs.symlinkSync(project, link);
    expect(traceModeOf(home, project)).toBe(false);
    setTraceMode(home, link, true);
    expect(traceModeOf(home, project)).toBe(true);
    expect(traceModeOf(home, link)).toBe(true);
    expect(tracedFolders(home)).toEqual([project]);
    expect(mode(traceFoldersPath(home))).toBe(0o600);
    expect(mode(home)).toBe(0o700);
    setTraceMode(home, project, true);
    expect(tracedFolders(home)).toEqual([project]);
    setTraceMode(home, project, false);
    expect(traceModeOf(home, project)).toBe(false);
    expect(tracedFolders(home)).toEqual([]);
    expect(fs.readdirSync(home).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  it('a relative or missing folder throws; an unresolvable folder reads off', () => {
    const { home, project } = world();
    expect(() => setTraceMode(home, 'repo', true)).toThrow(TypeError);
    expect(() => setTraceMode(home, path.join(root, 'nope'), true)).toThrow();
    expect(traceModeOf(home, path.join(root, 'nope'))).toBe(false);
    expect(traceModeOf(home, project)).toBe(false);
  });
  it('a damaged, symlinked or group-readable toggle file reads off (fail closed) and is rewritten by the next set', () => {
    const { home, project } = world();
    setTraceMode(home, project, true);
    fs.chmodSync(traceFoldersPath(home), 0o644);
    expect(traceModeOf(home, project)).toBe(false);
    fs.rmSync(traceFoldersPath(home));
    const elsewhere = path.join(root, 'planted.json');
    fs.writeFileSync(elsewhere, JSON.stringify({ schemaVersion: 'gnomon-trace-folders:v1', folders: [project] }), { mode: 0o600 });
    fs.symlinkSync(elsewhere, traceFoldersPath(home));
    expect(traceModeOf(home, project)).toBe(false);
    fs.rmSync(traceFoldersPath(home));
    fs.writeFileSync(traceFoldersPath(home), '{not json', { mode: 0o600 });
    expect(traceModeOf(home, project)).toBe(false);
    setTraceMode(home, project, true);
    expect(traceModeOf(home, project)).toBe(true);
  });
  it('no project file can switch it on: a toggle file or trace dir inside the project is never read', () => {
    const { home, project } = world();
    fs.mkdirSync(path.join(project, '.gnomon', 'trace'), { recursive: true });
    fs.writeFileSync(path.join(project, '.gnomon', TRACE_FOLDERS_FILE), JSON.stringify({ schemaVersion: 'gnomon-trace-folders:v1', folders: [project] }), { mode: 0o600 });
    fs.writeFileSync(path.join(project, '.gnomon', 'project.yaml'), 'trace: on\n');
    expect(traceModeOf(home, project)).toBe(false);
    expect(tracedFolders(home)).toEqual([]);
  });
});

describe('#trace-capture writer (trace/capture.ts)', () => {
  it('creates <project>/.gnomon/trace (0700) with a .gitignore of * and a 0600 file named without ":"', async () => {
    const { project } = world();
    fs.writeFileSync(path.join(project, '.gitignore'), 'node_modules\n');
    const t = openTraceStream(project, HSID);
    expect(path.basename(t.file)).toBe('hsid-v1-01HZZZZZZZZZZZZZZZZZZZZZZZ.jsonl');
    expect(traceFileName(HSID)).not.toContain(':');
    expect(path.dirname(t.file)).toBe(traceDirOf(project));
    t.in('{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n');
    t.out('{"type":"system","subtype":"init"}');
    t.out('not json');
    t.ctl({ event: 'exit', code: 0, signal: null });
    await t.close();
    expect(mode(traceDirOf(project))).toBe(0o700);
    expect(mode(t.file)).toBe(0o600);
    expect(fs.readFileSync(path.join(traceDirOf(project), '.gitignore'), 'utf8')).toBe('*\n');
    expect(fs.readFileSync(path.join(project, '.gitignore'), 'utf8')).toBe('node_modules\n'); // the repo's own is never touched
    const got = lines(t.file);
    expect(got.map((l) => l.dir)).toEqual(['in', 'out', 'out', 'ctl']);
    expect(got[0]!.line).toEqual({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } });
    expect(got[2]!.line).toBe('not json');
    for (const l of got) expect(l.t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(fs.readFileSync(t.file, 'utf8')).not.toContain('\r');
  });
  it('a resumed session appends to its own file; a planted symlink file, .gnomon link or trace link refuses', async () => {
    const { project } = world();
    const a = openTraceStream(project, HSID);
    a.ctl({ event: 'one' });
    await a.close();
    const b = openTraceStream(project, HSID);
    b.ctl({ event: 'two' });
    await b.close();
    expect(lines(a.file).map((l) => (l.line as { event: string }).event)).toEqual(['one', 'two']);
    // a file swapped for a link
    const other = 'hsid:v1:01HYYYYYYYYYYYYYYYYYYYYYYY';
    fs.symlinkSync(path.join(root, 'victim'), path.join(traceDirOf(project), traceFileName(other)));
    expect(() => openTraceStream(project, other)).toThrow(TraceRefused);
    // trace dir is a link
    const p2 = path.join(root, 'repo2');
    fs.mkdirSync(path.join(p2, '.gnomon'), { recursive: true });
    fs.mkdirSync(path.join(root, 'elsewhere'));
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(p2, '.gnomon', 'trace'));
    expect(() => openTraceStream(p2, HSID)).toThrow(expect.objectContaining({ reason: 'trace-unsafe' }));
    // .gnomon is a link
    const p3 = path.join(root, 'repo3');
    fs.mkdirSync(p3);
    fs.symlinkSync(path.join(root, 'elsewhere'), path.join(p3, '.gnomon'));
    expect(() => openTraceStream(p3, HSID)).toThrow(expect.objectContaining({ reason: 'trace-unsafe' }));
    expect(fs.readdirSync(path.join(root, 'elsewhere'))).toEqual([]);
    // a trace dir wider than owner-only
    const p4 = path.join(root, 'repo4');
    fs.mkdirSync(path.join(p4, '.gnomon', 'trace'), { recursive: true });
    fs.chmodSync(path.join(p4, '.gnomon', 'trace'), 0o755);
    expect(() => openTraceStream(p4, HSID)).toThrow(expect.objectContaining({ reason: 'trace-unsafe' }));
  });
  it('the file bound stops capture with one ctl capped note', async () => {
    const { project } = world();
    const t = openTraceStream(project, HSID, { fileBoundBytes: 4096 });
    const big = JSON.stringify({ type: 'assistant', text: 'x'.repeat(200) });
    for (let i = 0; i < 100; i++) t.out(big);
    await t.close();
    const got = lines(t.file);
    expect(fs.statSync(t.file).size).toBeLessThanOrEqual(4096);
    expect(got.at(-1)).toMatchObject({ dir: 'ctl', line: { event: 'capped', capBytes: 4096 } });
    expect(got.filter((l) => l.dir === 'ctl')).toHaveLength(1);
    expect(t.stats().capped).toBe(true);
  });
  it('a slow disk never blocks the session: pushes return at once, overflow is dropped and counted', async () => {
    const { project } = world();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const written: string[] = [];
    const slow = (fd: number): TraceSink => ({
      write: async (text) => {
        await gate; // the disk hangs until the test lets go
        written.push(text);
      },
      close: async () => fs.closeSync(fd),
    });
    const t = openTraceStream(project, HSID, { sink: slow, queueBoundLines: 8 });
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) t.out(JSON.stringify({ type: 'stream_event', i }));
    expect(performance.now() - t0).toBeLessThan(500);
    expect(t.stats().dropped).toBeGreaterThan(0);
    release();
    await settle(10);
    t.out(JSON.stringify({ type: 'result', i: 'last' }));
    await t.close();
    const recs = written.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { dir: string; line: Record<string, unknown> });
    const dropped = recs.find((r) => r.dir === 'ctl' && r.line.event === 'dropped');
    expect(dropped?.line.count).toBeGreaterThan(400);
    expect(recs.at(-1)!.line).toEqual({ type: 'result', i: 'last' });
  });
  it('asserts no key or token: secret-shaped records are replaced by a hash, counted in a ctl note', async () => {
    const { project } = world();
    const t = openTraceStream(project, HSID, { secrets: ['s3cret-session-value'] });
    t.out(JSON.stringify({ type: 'assistant', text: '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----' }));
    t.out(JSON.stringify({ type: 'assistant', text: 'token grt:v1:ABCDEF.xyz' }));
    t.in(`${JSON.stringify({ type: 'user', text: 'sk-ant-api03-abcdefghijk' })}\n`);
    t.out(JSON.stringify({ type: 'assistant', text: 'env s3cret-session-value' }));
    t.out(JSON.stringify({ type: 'assistant', text: 'fine' }));
    await t.close();
    const text = fs.readFileSync(t.file, 'utf8');
    for (const s of ['PRIVATE KEY', 'grt:v1:', 'sk-ant-', 's3cret-session-value']) expect(text).not.toContain(s);
    const got = lines(t.file);
    expect(got.filter((l) => (l.line as { redacted?: string }).redacted === 'secret-shaped')).toHaveLength(4);
    expect(got.at(-1)).toMatchObject({ dir: 'ctl', line: { event: 'redacted', count: 4 } });
    expect(secretShaped('{"a":"b"}')).toBe(false);
  });
  it('redactArgv hides the system prompt text, keeps the flags', () => {
    expect(redactArgv(['-p', '--append-system-prompt', 'be terse', '--model', 'x', '--append-system-prompt=secret'])).toEqual([
      '-p', '--append-system-prompt', expect.stringMatching(/^<redacted sha256:[0-9a-f]{64} bytes=8>$/), '--model', 'x', '--append-system-prompt=<redacted bytes=6>',
    ]);
  });
});

describe('#trace-capture session-policy falsifiers', () => {
  const policyFor = (home: string, project: string) =>
    buildSessionPolicy({ home, cwd: project, userClaudeDir: path.join(root, 'u', '.claude'), userHome: path.join(root, 'u'), managedSettingsPaths: [], linkedFolders: [], endpointPort: null });
  it('the session cannot flip tracing: the toggle file in the Gnomon home is read- and write-denied', () => {
    const { home, project } = world();
    fs.mkdirSync(home);
    const pol = policyFor(home, project);
    const f = traceFoldersPath(home);
    expect(pol.denyWrite.some((d) => covers(d, f))).toBe(true);
    expect(pol.denyRead.some((d) => covers(d, f))).toBe(true);
    expect(pol.allowRead.some((d) => covers(d, f))).toBe(false);
    expect(pol.allowWrite.some((d) => covers(d, f))).toBe(false);
  });
  it('<cwd>/.gnomon/trace is read- and write-denied (the dir itself too) and <cwd>/.gnomon cannot be renamed or replaced', () => {
    const { home, project } = world();
    const pol = policyFor(home, project);
    const dir = path.join(project, '.gnomon', 'trace');
    for (const p of [dir, path.join(dir, traceFileName(HSID)), path.join(dir, '.gitignore')]) {
      expect(pol.denyRead.some((d) => covers(d, p)), p).toBe(true);
      expect(pol.denyReadAlways.some((d) => covers(d, p)), p).toBe(true);
      expect(pol.denyWrite.some((d) => covers(d, p)), p).toBe(true);
      expect(pol.allowWrite.some((d) => covers(d, p)), p).toBe(false);
    }
    expect(pol.denyWrite).toContainEqual({ path: path.join(project, '.gnomon'), match: 'literal', class: 'trace' });
    // the rest of .gnomon stays as it was (only the literal dir and trace/)
    expect(pol.denyWrite.some((d) => covers(d, path.join(project, '.gnomon', 'project.yaml')))).toBe(false);
  });
});
