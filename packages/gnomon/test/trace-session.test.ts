/**
 * #trace-capture end to end: a FAKE claude (test/fixtures/fake-claude.mjs) under the REAL darwin session profile.
 * A traced cwd gets `<home>/trace/<project key>/<file>.jsonl` (TD-2026-10-19-057; nothing under the project) with the
 * in / out / ctl lines of the actual stream and a `traced: true` session.sandbox row; an untraced cwd gets no file;
 * the session can neither read, write nor rename its trace nor the toggle (runtime falsifier) while the project's own
 * .gnomon stays free (Aegis L7); a hung disk never stalls the session.
 */
// @gnomon-platform: darwin
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { SessionSupervisor } from '../src/kernel/supervisor/supervisor.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { setTraceMode, traceFoldersPath } from '../src/kernel/trace/mode.js';
import { traceDirOf, traceFileName, traceRootOf, TRACE_PROJECT_FILE, type TraceOpenOptions, type TraceSink } from '../src/kernel/trace/capture.js';
import { sessionWorld, setMode, trace, waitFor, type SessionWorld } from './session-helpers.js';

const SANDBOX_OK = darwinFloor().ok;
const HUMAN = 'p:abcdefgh/founder';
let w: SessionWorld;
const live: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const f of live.splice(0)) await f().catch(() => undefined);
  w?.cleanup();
});

function rig(traceOptions?: TraceOpenOptions) {
  w = sessionWorld();
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const log = async (kind: string, payload: Record<string, unknown>): Promise<void> => {
    rows.push({ kind, payload });
  };
  const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: { env: () => ({}), layers: () => [] } });
  const children = new DaemonChildren({ append: log, control: processControlFor('darwin'), boot: 'boot-test', graceMs: 500 });
  const sup = new SessionSupervisor({
    log, children, fuse, home: w.home, userHome: w.userHome, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(w.home, 'gnomon.sock'), claudePath: w.claude,
    env: () => ({ HOME: '/x', PATH: '/usr/bin:/bin' }), platform: 'darwin', watchMs: 200, allowScripts: true, ...(traceOptions ? { traceOptions } : {}),
  });
  live.push(() => children.stopAll('test-end'));
  return { rows, sup, kinds: (k: string) => rows.filter((r) => r.kind === k) };
}
const open = (s: SessionSupervisor) => s.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: w.cwd });
const read = (f: string) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { t: string; dir: string; line: Record<string, unknown> });

describe.runIf(SANDBOX_OK)('#trace-capture with a fake claude (darwin session profile)', () => {
  it('a traced cwd: in / out / ctl lines match the stream; traced:true on session.sandbox and status; modes 0700 / 0600', async () => {
    const r = rig();
    setTraceMode(w.home, w.cwd, true);
    const s = await open(r.sup);
    expect(r.kinds('session.sandbox').find((x) => x.payload.profile)!.payload.traced).toBe(true);
    expect(r.sup.status().find((x) => x.hsid === s.hsid)!.traced).toBe(true);
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'hello trace' });
    expect(await waitFor(() => r.kinds('turn.result').length === 1)).toBe(true);
    await r.sup.stop(HUMAN, { hsid: s.hsid });
    expect(await waitFor(() => r.sup.stateOf(s.hsid) === 'exited')).toBe(true);
    const file = path.join(traceDirOf(w.home, fs.realpathSync(w.cwd)), traceFileName(s.hsid));
    expect(await waitFor(() => fs.existsSync(file) && read(file).some((l) => l.dir === 'ctl' && l.line.event === 'exit'))).toBe(true);
    expect(fs.lstatSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(fs.lstatSync(file).mode & 0o777).toBe(0o600);
    const got = read(file);
    // ctl: spawn first (argv, env names only), exit last
    expect(got[0]).toMatchObject({ dir: 'ctl', line: { event: 'spawn' } });
    expect((got[0]!.line.argv as string[])).toContain('--input-format');
    expect(got[0]!.line).not.toHaveProperty('env');
    expect(got.at(-1)).toMatchObject({ dir: 'ctl', line: { event: 'exit' } });
    // in: exactly what the fake claude read on stdin, in order
    const stdinSeen = trace(w).filter((t) => t.t === 'stdin').map((t) => t.m);
    expect(got.filter((l) => l.dir === 'in').map((l) => l.line)).toEqual(stdinSeen);
    expect(got.find((l) => l.dir === 'in')!.line).toMatchObject({ type: 'user', message: { content: [{ type: 'text', text: 'hello trace' }] } });
    // out: every stdout line the kernel logged as a turn.event, in order
    const outs = got.filter((l) => l.dir === 'out').map((l) => l.line);
    expect(outs.map((o) => o.type)).toEqual(r.kinds('turn.event').filter((e) => e.payload.type !== 'dropped').map((e) => String(e.payload.type).split('.')[0]));
    expect(outs.some((o) => o.type === 'system' && o.subtype === 'init')).toBe(true);
    expect(outs.some((o) => o.type === 'result')).toBe(true);
    // FALSIFIER (TD-2026-10-19-057): nothing of the trace is written under the project
    const under = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? under(path.join(d, e.name)) : [e.name]));
    expect(under(w.cwd).filter((n) => n === traceFileName(s.hsid) || n === TRACE_PROJECT_FILE || n.endsWith('.jsonl') && n.startsWith('hsid-'))).toEqual([]);
    expect(fs.existsSync(path.join(w.cwd, '.gnomon', 'trace'))).toBe(false);
  });
  it('an untraced cwd writes no file and no traced field', async () => {
    const r = rig();
    const s = await open(r.sup);
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'x' });
    expect(await waitFor(() => r.kinds('turn.result').length === 1)).toBe(true);
    await r.sup.stop(HUMAN, { hsid: s.hsid });
    expect(fs.existsSync(path.join(w.cwd, '.gnomon', 'trace'))).toBe(false);
    expect(fs.existsSync(traceRootOf(w.home))).toBe(false);
    expect(r.kinds('session.sandbox').find((x) => x.payload.profile)!.payload).not.toHaveProperty('traced');
    expect(r.sup.status().find((x) => x.hsid === s.hsid)).not.toHaveProperty('traced');
  });
  it('runtime falsifier: the session cannot read, write or rename <home>/trace nor the toggle; the project .gnomon stays free (L7)', async () => {
    const r = rig();
    setTraceMode(w.home, w.cwd, true);
    const dir = traceDirOf(w.home, fs.realpathSync(w.cwd));
    // a trace of an earlier session, so the read has something to find
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(traceRootOf(w.home), 0o700);
    fs.writeFileSync(path.join(dir, 'earlier.jsonl'), '{}\n', { mode: 0o600 });
    const proj = path.join(w.cwd, '.gnomon');
    fs.mkdirSync(proj, { recursive: true });
    setMode(w, {
      startReads: [path.join(dir, 'earlier.jsonl'), traceFoldersPath(w.home)],
      startWrites: [path.join(dir, 'earlier.jsonl'), path.join(dir, 'planted.jsonl'), path.join(traceRootOf(w.home), 'planted'), traceFoldersPath(w.home), path.join(proj, 'planted')],
      startRenames: [[path.join(dir, 'earlier.jsonl'), path.join(dir, 'moved.jsonl')], [dir, `${dir}-moved`], [traceRootOf(w.home), `${traceRootOf(w.home)}-moved`], [proj, `${proj}-moved`]],
    });
    await open(r.sup);
    expect(await waitFor(() => trace(w).filter((t) => t.t === 'start-rename').length === 4)).toBe(true);
    const free = new Set([path.join(proj, 'planted'), proj]);
    for (const t of trace(w).filter((x) => x.t === 'start-read' || x.t === 'start-write' || x.t === 'start-rename')) {
      if (free.has(String(t.path))) expect(t.result, `${String(t.t)} ${String(t.path)}`).toBe('allowed'); // Aegis L7: the project's .gnomon is not denied
      else expect(t.result, `${String(t.t)} ${String(t.path)}`).toBe('blocked');
    }
    expect(fs.readFileSync(path.join(dir, 'earlier.jsonl'), 'utf8')).toBe('{}\n');
    expect(fs.existsSync(path.join(dir, 'planted.jsonl'))).toBe(false);
    expect(fs.existsSync(`${dir}-moved`)).toBe(false);
  });
  it('a hung disk never stalls the session: the turn completes while the trace writer is blocked', async () => {
    let hang!: () => void;
    const gate = new Promise<void>((res) => (hang = res));
    const sink = (fd: number): TraceSink => ({ write: async () => gate, close: async () => fs.closeSync(fd) });
    const r = rig({ sink, queueBoundLines: 4 });
    setTraceMode(w.home, w.cwd, true);
    const s = await open(r.sup);
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'x' });
    expect(await waitFor(() => r.kinds('turn.result').length === 1)).toBe(true);
    // the exit path does not wait for the hung writer either
    await r.sup.stop(HUMAN, { hsid: s.hsid });
    expect(await waitFor(() => r.sup.stateOf(s.hsid) === 'exited' && r.kinds('session.exited').length === 1)).toBe(true);
    hang();
  });
});
