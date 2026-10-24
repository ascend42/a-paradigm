// @gnomon-platform: darwin, linux
/**
 * #gnomon-trace — `gnomon trace` joins the kernel-log rows of a session, its
 * Claude Code transcript and the raw capture into one time-ordered timeline,
 * checks every turn.sent contentHash against the transcript prompt, writes
 * nothing; `gnomon trace on|off|status` keeps per-project trace mode.
 * Throwaway homes and a throwaway Claude dir only (never the real ~/.claude).
 */
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { KeyRing, SoftwareEd25519Signer, type KernelLog } from '../src/kernel/log/index.js';
import { recordKernelPub } from '../src/kernel/identity/index.js';
import { kernelPrincipalOf } from '../src/kernel/lifecycle/index.js';
import { openKernelLog } from '../src/kernel/testing.js';
import { turnContentHash } from '../src/kernel/supervisor/supervisor.js';
import { TABLE_TALK_GUIDANCE, TABLE_TALK_GUIDANCE_HASH } from '../src/kernel/voice/table-talk.js';
import { setTraceMode, traceDirOf, traceFileName, traceModeOf, tracedFolders } from '../src/kernel/trace/index.js';
import { encodeClaudeProjectDir, runTraceCommand, type TraceSession } from '../src/cli/trace-cli.js';

const KERNEL = kernelPrincipalOf();
const HSID = 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0';
const UUID = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
const PROMPT = 'write out.txt\nthen list the folder';
const T0 = Date.parse('2026-10-19T10:00:00.000Z');
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();

const dirs: string[] = [];
const logs: KernelLog[] = [];
afterEach(async () => {
  for (const l of logs.splice(0)) await l.close().catch(() => undefined);
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

async function fixture(opts: { tamper?: boolean; escape?: boolean; capture?: boolean; modes?: boolean; guidanceHash?: string; extra?: string[] } = {}) {
  const home = tmp('gnomon-trace-home-');
  const claudeDir = tmp('gnomon-trace-claude-');
  const work = tmp('gnomon-trace-work-');
  const key = SoftwareEd25519Signer.generate('kernel');
  recordKernelPub(home, key.publicKeyPem);
  const ring = new KeyRing();
  ring.addEd25519(key.publicKeyPem);
  let now = T0;
  const log = openKernelLog({ home, kernelPrincipal: KERNEL, signer: key, keyRing: ring, clock: () => now });
  logs.push(log);
  const at = async (s: number, kind: string, payload: Record<string, unknown>, session: string | undefined = HSID) => {
    now = T0 + s * 1000;
    await log.append({ kind, principal: KERNEL, ...(session ? { session } : {}), payload });
  };
  await at(0, 'daemon.start', { pid: 1 }, undefined);
  await at(1, 'session.open', { hsid: HSID, principalId: 'p', by: 'human:founder', cwd: work, worktree: null, backend: 'claude-code', model: 'claude', attended: true, uuid: UUID, principalClass: 'human' });
  await at(1.5, 'session.sandbox', { hsid: HSID, phase: 'running', ...(opts.capture ? { traced: true } : {}) });
  await at(2, 'session.inject', { hsid: HSID, origin: 'client', hash: turnContentHash(PROMPT), bytes: Buffer.byteLength(PROMPT) });
  await at(2, 'turn.sent', { hsid: HSID, turn: `turn:${HSID}/1`, permitId: 'pmt:1', contentHash: turnContentHash(PROMPT), ...(opts.guidanceHash ? { guidanceHash: opts.guidanceHash } : {}) });
  await at(5, 'approval.request', { card: { cardId: 'card:1', kind: 'permission', hsid: HSID }, tool: 'Bash' });
  await at(6, 'approval.decide', { cardId: 'card:1', decision: 'allow', approver: 'human:founder' }, undefined);
  if (opts.modes) {
    // P8-D87: a session-scoped loosening, then an edit auto-approved by it (no card)
    await at(6.2, 'request.mode.set', { repo: 'sha256:' + 'a'.repeat(64), hsid: HSID, to: 'auto-edits' });
    await at(6.4, 'approval.mode.set', { scope: { repo: 'sha256:' + 'a'.repeat(64), hsid: HSID }, from: 'ask', to: 'auto-edits', by: { principal: 'human:founder', connId: 'conn:gui' }, presence: 'fresh' });
    await at(6.6, 'approval.auto', { hsid: HSID, tool: 'Write', path: path.join(work, 'src', 'a.ts'), inputHash: 'sha256:' + 'b'.repeat(64), modeRef: 'mode:auto-edits' });
  }
  await at(8, 'turn.result', { hsid: HSID, usage: { tokens: 1234 }, cost: 0.0123, subtype: 'success', isError: false });
  await at(9, 'session.exited', { hsid: HSID, pid: 2, code: 0, signal: null }, undefined);
  await at(10, 'daemon.exit', { reason: 'idle' }, undefined);
  await log.close();

  const project = path.join(claudeDir, 'projects', encodeClaudeProjectDir(work));
  fs.mkdirSync(project, { recursive: true });
  const reply = opts.escape ? 'done \u001b]0;pwned\u0007\u001b[31mred' : 'done';
  const lines = [
    { type: 'user', timestamp: iso(3), message: { role: 'user', content: [{ type: 'text', text: opts.tamper ? 'write evil.txt' : PROMPT }, ...(opts.extra ?? []).map((text) => ({ type: 'text', text }))] } },
    { type: 'assistant', timestamp: iso(4), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'touch out.txt' } }] } },
    { type: 'user', timestamp: iso(7), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] } },
    { type: 'assistant', timestamp: iso(7.5), message: { role: 'assistant', content: [{ type: 'text', text: reply }] } },
  ];
  fs.writeFileSync(path.join(project, `${UUID}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  if (opts.capture) {
    const cdir = traceDirOf(home, fs.realpathSync.native(work)); // TD-2026-10-19-057: in the Gnomon home
    fs.mkdirSync(cdir, { recursive: true, mode: 0o700 });
    const spanRedacted = { t: iso(4.6), dir: 'out', line: { type: 'assistant', text: 'key [redacted:anthropic-key] end' } };
    const redacted = { t: iso(4.5), dir: 'out', line: { redacted: 'secret-shaped', hash: 'sha256:00', bytes: 40 } };
    fs.writeFileSync(path.join(cdir, traceFileName(HSID)), `${JSON.stringify({ t: iso(2.5), dir: 'in', line: { type: 'user' } })}\nnot json\n${JSON.stringify(redacted)}\n${JSON.stringify(spanRedacted)}\n${JSON.stringify({ t: iso(7.8), dir: 'out', line: { type: 'result', subtype: 'success' } })}\n`);
  }
  return { home, claudeDir, work };
}

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: { write: (s: string) => (out.push(s), true) }, stderr: { write: (s: string) => (err.push(s), true) } } };
};

async function traceJson(f: { home: string; claudeDir: string }, extra: string[] = []): Promise<TraceSession> {
  const o = io();
  expect(await runTraceCommand(['--home', f.home, '--json', ...extra], o.io, { claudeDir: f.claudeDir })).toBe(0);
  const lines = o.out.join('').trim().split('\n');
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!) as TraceSession;
}

function snapshot(roots: string[]): Map<string, string> {
  const m = new Map<string, string>();
  const walk = (p: string) => {
    const st = fs.statSync(p);
    m.set(p, `${st.mtimeMs}:${st.size}`);
    if (st.isDirectory()) for (const c of fs.readdirSync(p)) walk(path.join(p, c));
  };
  for (const r of roots) walk(r);
  return m;
}

describe('gnomon trace (#gnomon-trace): a read-only audit timeline', () => {
  it('joins the log rows and the transcript in time order, with the --json shape', async () => {
    const f = await fixture();
    const s = await traceJson(f);
    expect(s.session).toEqual({ hsid: HSID, uuid: UUID, cwd: f.work, principal: 'human:founder' });
    expect(Object.keys(s).sort()).toEqual(['capture', 'events', 'log', 'session', 'traced', 'transcript', 'turns', 'usage']);
    for (const e of s.events) {
      expect(typeof e.t).toBe('string');
      expect(['log', 'transcript', 'capture']).toContain(e.source);
      expect(typeof e.kind).toBe('string');
    }
    expect(s.events.map((e) => `${e.source}:${e.kind}`)).toEqual([
      'log:daemon.start',
      'log:session.open',
      'log:session.sandbox',
      'log:session.inject',
      'log:turn.sent',
      'transcript:prompt',
      'transcript:tool_use',
      'log:approval.request',
      'log:approval.decide',
      'transcript:tool_result',
      'transcript:reply',
      'log:turn.result',
      'log:session.exited',
      'log:daemon.exit',
    ]);
    expect(s.log).toMatchObject({ hashChain: 'ok', breaks: 0, signatures: 'not-checked', chainRows: 10, rows: 10 });
    expect(s.usage).toEqual({ tokens: 1234, costUsd: 0.0123 });
    expect(s.capture).toEqual({ path: null, lines: 0, skipped: 0 }); // an absent capture is fine
    expect(s.traced).toBeNull();
    expect(s.transcript.lines).toBe(4);
  });

  it('table talk (Aegis M2): one extra block only when turn.sent names its guidanceHash, and the hash must match', async () => {
    const G = TABLE_TALK_GUIDANCE;
    const verdict = async (o: { guidanceHash?: string; extra?: string[] }) => (await traceJson(await fixture(o))).turns;
    const ok = { sent: 1, matched: 1, mismatched: 0, unchecked: 0 };
    const bad = { sent: 1, matched: 0, mismatched: 1, unchecked: 0 };
    expect(await verdict({ guidanceHash: TABLE_TALK_GUIDANCE_HASH, extra: [G] })).toEqual(ok);
    expect(await verdict({ extra: [G] })).toEqual(bad); // an extra block the log never named
    expect(await verdict({ guidanceHash: TABLE_TALK_GUIDANCE_HASH, extra: [`${G} plus an injected line`] })).toEqual(bad); // altered guidance
    expect(await verdict({ guidanceHash: TABLE_TALK_GUIDANCE_HASH, extra: [G, 'smuggled'] })).toEqual(bad); // a second extra block
    expect(await verdict({ guidanceHash: TABLE_TALK_GUIDANCE_HASH })).toEqual(bad); // named but missing
  });

  it('reports the turn.sent hash as matching the transcript prompt, and a tampered transcript as a mismatch', async () => {
    const ok = await traceJson(await fixture());
    expect(ok.turns).toEqual({ sent: 1, matched: 1, mismatched: 0, unchecked: 0 });
    expect(ok.events.find((e) => e.kind === 'turn.sent')?.verify).toBe('matches-log');
    expect(ok.events.find((e) => e.kind === 'prompt')?.verify).toBe('matches-log');

    const bad = await fixture({ tamper: true });
    const t = await traceJson(bad);
    expect(t.turns).toEqual({ sent: 1, matched: 0, mismatched: 1, unchecked: 0 });
    expect(t.events.find((e) => e.kind === 'turn.sent')?.verify).toBe('hash-mismatch');
    const o = io();
    expect(await runTraceCommand(['--home', bad.home], o.io, { claudeDir: bad.claudeDir })).toBe(0);
    expect(o.out.join('')).toContain('✗ hash mismatch');
    const g = io();
    const good = await fixture();
    await runTraceCommand(['--home', good.home], g.io, { claudeDir: good.claudeDir });
    expect(g.out.join('')).toContain('✓ matches log');
  });

  it('P8-D87: shows auto-approved edits (approval.auto) and run-mode changes plainly', async () => {
    const f = await fixture({ modes: true });
    const s = await traceJson(f);
    expect(s.events.filter((e) => e.source === 'log').map((e) => e.kind)).toEqual(expect.arrayContaining(['request.mode.set', 'approval.mode.set', 'approval.auto']));
    const o = io();
    expect(await runTraceCommand(['--home', f.home], o.io, { claudeDir: f.claudeDir })).toBe(0);
    const text = o.out.join('');
    expect(text).toContain(`AUTO-APPROVED Write  ${path.join(f.work, 'src', 'a.ts')}  (run mode auto-edits, no card)`);
    expect(text).toContain('run mode ask → auto-edits  this session  presence fresh');
    expect(text).toContain('asked for run mode auto-edits  (this session)');
  });

  it('reports a rewritten log row as a broken hash chain', async () => {
    const f = await fixture();
    const db = new DatabaseSync(path.join(f.home, 'kernel.db'));
    db.exec('DROP TRIGGER chain_no_update'); // what a same-user attacker can do (as kernel-log.test.ts)
    db.prepare("UPDATE chain SET envelope = replace(envelope, 'pmt:1', 'pmt:2') WHERE kind = 'turn.sent'").run();
    db.close();
    const s = await traceJson(f);
    expect(s.log.hashChain).toBe('broken');
    expect(s.log.firstBreak).toMatch(/hash does not match/);
    const o = io();
    await runTraceCommand(['--home', f.home], o.io, { claudeDir: f.claudeDir });
    expect(o.out.join('')).toContain('hash chain BROKEN');
  });

  it('sanitizes terminal escape sequences in the human output and truncates unless --full', async () => {
    const f = await fixture({ escape: true });
    const o = io();
    expect(await runTraceCommand(['--home', f.home], o.io, { claudeDir: f.claudeDir })).toBe(0);
    const text = o.out.join('');
    expect(text).not.toMatch(/\u001b|\u0007/);
    expect(text).toContain('contains prompt text');
    expect(text).toContain('write out.txt ⏎ then list the folder'); // compact: newlines folded
    const full = io();
    await runTraceCommand(['--home', f.home, '--full'], full.io, { claudeDir: f.claudeDir });
    expect(full.out.join('')).not.toMatch(/\u001b|\u0007/);
  });

  it('FALSIFIER: joins the raw capture from <home>/trace/<project key>/ (never the project) and skips unparsable lines', async () => {
    const f = await fixture({ capture: true });
    const s = await traceJson(f);
    expect(s.capture.path).toBe(path.join(traceDirOf(f.home, fs.realpathSync.native(f.work)), traceFileName(HSID)));
    expect(fs.existsSync(path.join(f.work, '.gnomon'))).toBe(false);
    expect(s.events.find((e) => e.kind === 'capture.out' && e.type === 'assistant')).toMatchObject({ line: { text: 'key [redacted:anthropic-key] end' } });
    expect(traceFileName(HSID)).toBe('hsid-v1-01JABCDEFGHJKMNPQRSTVWXYZ0.jsonl');
    expect(s.capture.lines).toBe(5);
    expect(s.events.find((e) => e.redacted)).toMatchObject({ source: 'capture', kind: 'capture.out', redacted: 'secret-shaped', bytes: 40 });
    expect(s.events.find((e) => e.redacted)).not.toHaveProperty('line');
    expect(s.traced).toEqual({ traced: true, refused: null });
    const o = io();
    await runTraceCommand(['--home', f.home], o.io, { claudeDir: f.claudeDir });
    expect(o.out.join('')).toContain('[redacted] secret-shaped');
    expect(o.out.join('')).toMatch(/traced +yes/);
    expect(s.capture.skipped).toBe(1);
    const kinds = s.events.map((e) => `${e.source}:${e.kind}`);
    expect(kinds.indexOf('capture:capture.in')).toBeGreaterThan(kinds.indexOf('log:turn.sent'));
    expect(kinds.indexOf('capture:capture.in')).toBeLessThan(kinds.indexOf('transcript:prompt'));
  });

  it('writes nothing: the home, the Claude dir and the project keep their mtimes', async () => {
    const f = await fixture({ capture: true });
    const before = snapshot([f.home, f.claudeDir, f.work]);
    for (const args of [[], ['--json'], ['--full'], ['--since', iso(0)], ['--session', 'ABCDEFG']]) {
      const o = io();
      expect(await runTraceCommand(['--home', f.home, ...args], o.io, { claudeDir: f.claudeDir })).toBe(0);
    }
    expect(snapshot([f.home, f.claudeDir, f.work])).toEqual(before);
  });

  it('refuses a session that is not in the log, and bad arguments, without echoing them', async () => {
    const f = await fixture();
    const o = io();
    expect(await runTraceCommand(['--home', f.home, '--session', 'nope'], o.io, { claudeDir: f.claudeDir })).toBe(1);
    expect(o.err.join('')).toContain('NOT_FOUND');
    const u = io();
    expect(await runTraceCommand(['--bogus\u001b[31m'], u.io)).toBe(64);
    expect(u.err.join('')).not.toContain('\u001b');
    expect(await runTraceCommand(['--last', '--since', iso(0)], io().io)).toBe(64);
  });
});

describe('gnomon trace on | off | status (per-project trace mode)', () => {
  it('switches a folder on and off by realpath and lists it, in a 0600 state file', async () => {
    const home = tmp('gnomon-trace-mode-');
    const folder = tmp('gnomon-trace-folder-');
    const real = fs.realpathSync.native(folder);
    expect(traceModeOf(home, folder)).toBe(false);
    const on = io();
    expect(await runTraceCommand(['on', '--home', home, '--folder', folder], on.io)).toBe(0);
    expect(on.out.join('')).toContain(traceDirOf(home, real));
    expect(on.out.join('')).toContain('IN THE CLEAR');
    expect(on.out.join('')).toContain('outside Gnomon');
    expect(fs.existsSync(path.join(real, '.gnomon'))).toBe(false); // nothing is written under the folder
    expect(on.out.join('')).toContain('new and resumed sessions');
    expect(traceModeOf(home, real)).toBe(true);
    expect(tracedFolders(home)).toEqual([real]);
    expect(fs.statSync(path.join(home, 'trace-folders.json')).mode & 0o777).toBe(0o600);
    const st = io();
    expect(await runTraceCommand(['status', '--home', home, '--folder', folder], st.io)).toBe(0);
    expect(st.out.join('')).toContain(`${real}  (this folder)`);
    expect(await runTraceCommand(['off', '--home', home, '--folder', folder], io().io)).toBe(0);
    expect(traceModeOf(home, folder)).toBe(false);
    setTraceMode(home, folder, true);
    expect(tracedFolders(home)).toEqual([real]);
    expect(await runTraceCommand(['on', '--folder', 'relative'], io().io)).toBe(64);
  });
  it('gnomon trace path prints where the folder\'s captures live (the home) and writes nothing', async () => {
    const home = tmp('gnomon-trace-path-');
    const folder = tmp('gnomon-trace-pfolder-');
    const real = fs.realpathSync.native(folder);
    const before = fs.readdirSync(home);
    const o = io();
    expect(await runTraceCommand(['path', '--home', home, '--folder', folder], o.io)).toBe(0);
    const printed = o.out.join('').trim();
    expect(printed).toBe(traceDirOf(home, real));
    expect(printed.startsWith(path.join(home, 'trace') + path.sep)).toBe(true);
    expect(path.basename(printed)).toMatch(/^[a-z0-9-]+-[0-9a-f]{12}$/);
    expect(fs.readdirSync(home)).toEqual(before);
    expect(fs.readdirSync(folder)).toEqual([]);
    expect(await runTraceCommand(['path', '--home', home, '--folder', path.join(folder, 'nope')], io().io)).toBe(1);
  });
});
