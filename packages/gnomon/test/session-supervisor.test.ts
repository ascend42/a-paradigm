/**
 * #supervisor + #session-runner + #claude-adapter end to end with a FAKE
 * claude (test/fixtures/fake-claude.mjs) under the REAL generated `session`
 * profile (darwin sandbox-exec) and real process groups (spec §3.3, §6.1;
 * M1.7 slice 1). Never the real claude binary, never Anthropic.
 *
 *   law 1 + Aegis: claude never starts without a law-7-scanned claude-code
 *     session.spawn permit for the hsid (a fuse refusal ⇒ no intent row, no
 *     process); session.spawned{intent} precedes the running row (M1.9);
 *   law 7 per spawn (T-009 / Aegis C5): a project-layer hit refuses BEFORE
 *     permit.reserve; G-SUB-05: a settings layer written mid-session stops
 *     the session within 2 s with billing.api.refused;
 *   S2: every stdout line is a turn.event before turn.usage / budget.usage;
 *   usage from stream events only, no double count; ask-user card;
 *   G-RUN-03: interrupt = the control_request line; stop kills the group,
 *     also when the child ignores SIGTERM;
 *   T-008: generated plugin bytes are verified against the kernel-held record.
 */
// @gnomon-platform: darwin
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RefusedError } from '@a-company/gnomon-contracts';
import { BudgetFuse } from '../src/kernel/budget/fuse.js';
import type { BillingScanSource } from '../src/kernel/budget/billing.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { SessionSupervisor } from '../src/kernel/supervisor/supervisor.js';
import type { ApprovalBroker } from '../src/kernel/broker/broker.js';
import { recordPath } from '../src/kernel/manifest/generate.js';
import { readClaudePin, repinClaudeBinary } from '../src/kernel/runner/binary.js';
import { runSessionCommand } from '../src/cli/session-cli.js';
import { PassThrough } from 'node:stream';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { KernelLog } from '../src/kernel/log/index.js';

/** capability, not platform: below the macOS floor or with SIP off every open is refused (asserted below) */
const SANDBOX_OK = darwinFloor().ok;
import { sessionWorld, setMode, trace, waitFor, type SessionWorld } from './session-helpers.js';

const HUMAN = 'p:abcdefgh/founder';
let w: SessionWorld;
let sup: SessionSupervisor | null = null;
const live: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const f of live.splice(0)) await f().catch(() => undefined);
  w?.cleanup();
});

function rig(o: { realLog?: KernelLog; billing?: BillingScanSource; watchMs?: number; failSandboxRow?: boolean; allowScripts?: boolean; macosMajor?: () => number | null; sipEnabled?: () => boolean | null } = {}) {
  w = sessionWorld();
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const log = async (kind: string, payload: Record<string, unknown>, ids: { session?: string } = {}): Promise<void> => {
    if (o.failSandboxRow && kind === 'session.sandbox' && payload.profile) throw new Error('log append failed (test)');
    // T-2026-10-18-019: optionally through a REAL KernelLog (its checkPayload), so a refused row fails the call
    if (o.realLog) await o.realLog.append({ kind, principal: 'p:abcdefgh/kernel', payload, ...(ids.session ? { session: ids.session } : {}) });
    rows.push({ kind, payload });
  };
  const fuse = new BudgetFuse({ kernel: SoftwareEd25519Signer.generate('kernel'), logId: 'log:01HZZZZZZZZZZZZZZZZZZZZZZZ', log, billing: o.billing ?? { env: () => ({}), layers: () => [] } });
  const children = new DaemonChildren({ append: log, control: processControlFor('darwin'), boot: 'boot-test', graceMs: 500 });
  const cards: Array<Record<string, unknown>> = [];
  const broker = { raise: async (i: Record<string, unknown>) => (cards.push(i), { cardId: `card:${cards.length}` }) } as unknown as Pick<ApprovalBroker, 'raise'>;
  sup = new SessionSupervisor({ log, children, fuse, broker, home: w.home, userHome: w.userHome, kernelPrincipal: 'p:abcdefgh/kernel', sock: path.join(w.home, 'gnomon.sock'), claudePath: w.claude, env: () => ({ HOME: '/not-the-scanned-home', PATH: '/usr/bin:/bin', ANTHROPIC_API_KEY: 'scrubbed-from-the-child' }), platform: 'darwin', watchMs: o.watchMs ?? 200, allowScripts: o.allowScripts ?? true, ...(o.macosMajor ? { macosMajor: o.macosMajor } : {}), ...(o.sipEnabled ? { sipEnabled: o.sipEnabled } : {}) });
  live.push(() => children.stopAll('test-end'));
  const kinds = (k: string) => rows.filter((r) => r.kind === k);
  const idx = (k: string) => rows.findIndex((r) => r.kind === k);
  return { rows, fuse, children, cards, sup, kinds, idx };
}

const open = (s: SessionSupervisor, over: Record<string, unknown> = {}) => s.open({ principal: HUMAN, principalClass: 'human', attended: true, cwd: w.cwd, ...over });
async function refusal(p: Promise<unknown>): Promise<RefusedError> {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(RefusedError);
  return e as RefusedError;
}

describe.skipIf(!SANDBOX_OK)('M1.7 slice 1: who may open', () => {
  it.each([
    ['agent', true],
    ['session', true],
    ['human', false],
  ])('%s attended=%s is FORBIDDEN (attended human-started only)', async (cls, attended) => {
    const r = rig();
    const e = await refusal(r.sup.open({ principal: HUMAN, principalClass: cls, attended, cwd: w.cwd }));
    expect(e.refusal.code).toBe('FORBIDDEN');
    expect(r.kinds('session.spawned')).toEqual([]);
  });
  it('a local backend is #local-runner (M1.8): unconfigured lane ⇒ fallback card + MODEL_UNAVAILABLE, claude never runs', async () => {
    const r = rig();
    expect((await refusal(open(r.sup, { backend: 'local' }))).refusal.code).toBe('MODEL_UNAVAILABLE');
    expect(trace(w)).toEqual([]);
  });
});

describe.skipIf(!SANDBOX_OK)('law 1 + law 7 + Aegis: no claude without a law-7-scanned claude-code permit', () => {
  it('a fuse law-7 refusal ⇒ BILLING_REFUSED, no intent row, the fake claude never ran', async () => {
    const r = rig({ billing: { env: () => ({ ANTHROPIC_API_KEY: 'k' }), layers: () => [] } });
    const e = await refusal(open(r.sup));
    expect(e.refusal.code).toBe('BILLING_REFUSED');
    expect(r.kinds('session.spawned')).toEqual([]);
    expect(trace(w).filter((t) => t.t === 'argv')).toEqual([]);
  });
  it('T-009 per-cwd scan: a project settings.local.json key refuses BEFORE permit.reserve', async () => {
    const r = rig();
    fs.writeFileSync(path.join(w.cwd, '.claude', 'settings.local.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' } }));
    const e = await refusal(open(r.sup));
    expect(e.refusal.code).toBe('BILLING_REFUSED');
    expect(r.kinds('permit.reserve')).toEqual([]);
    expect(r.kinds('billing.api.refused')[0]!.payload.where).toEqual(['project:.claude/settings.local.json']);
    expect(r.kinds('session.refused')[0]!.payload.code).toBe('api_billing_refused');
  });
  it('a ~/.claude.json projects.<cwd>.mcpServers env block refuses', async () => {
    const r = rig();
    fs.writeFileSync(path.join(w.userHome, '.claude.json'), JSON.stringify({ projects: { [w.cwd]: { mcpServers: { s: { command: 'x', env: { ANTHROPIC_API_KEY: 'k' } } } } } }));
    expect((await refusal(open(r.sup))).refusal.code).toBe('BILLING_REFUSED');
  });
  it('assertClaudePermit refuses a turn, a local or a foreign-hsid permit', async () => {
    const r = rig();
    const turn = await r.fuse.reserve({ principal: HUMAN, principalClass: 'human', attended: true, kind: 'turn', backend: 'claude-code', scope: { user: HUMAN, session: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ' } });
    expect(() => r.sup.assertClaudePermit(turn, 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ')).toThrow(RefusedError);
    const local = await r.fuse.reserve({ principal: HUMAN, principalClass: 'human', attended: true, kind: 'session.spawn', backend: 'local', scope: { user: HUMAN, session: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ' } });
    expect(() => r.sup.assertClaudePermit(local, 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ')).toThrow(RefusedError);
    const ok = await r.fuse.reserve({ principal: HUMAN, principalClass: 'human', attended: true, kind: 'session.spawn', backend: 'claude-code', scope: { user: HUMAN, session: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ' } });
    expect(() => r.sup.assertClaudePermit(ok, 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZY')).toThrow(RefusedError);
    expect(() => r.sup.assertClaudePermit({ ...ok, sig: 'forged' }, 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ')).toThrow(RefusedError);
  });
  it('preflight: an old claude ⇒ claude_version; non-subscription auth ⇒ not_subscription_auth', async () => {
    let r = rig();
    setMode(w, { version: '2.1.100' });
    expect((await refusal(open(r.sup))).refusal.data).toMatchObject({ session: 'claude_version' });
    r = rig();
    setMode(w, { auth: { loggedIn: true, authMethod: 'api-key', apiProvider: 'firstParty' } });
    expect((await refusal(open(r.sup))).refusal.data).toMatchObject({ session: 'not_subscription_auth' });
  });
});

describe.skipIf(!SANDBOX_OK)('a session end to end (fake claude, real profile, real process group)', () => {
  it('spawns under the profile with the adapter argv and the allowlisted env; rows in order', async () => {
    const r = rig();
    const s = await open(r.sup);
    expect(s.state).toBe('running');
    expect(await waitFor(() => trace(w).some((t) => t.t === 'argv'))).toBe(true);
    const argv = trace(w).find((t) => t.t === 'argv')!;
    expect(argv.args).toContain('--strict-mcp-config');
    expect((argv.envKeys as string[]).includes('ANTHROPIC_API_KEY')).toBe(false);
    const spawned = r.kinds('session.spawned').map((x) => x.payload.phase);
    expect(spawned).toEqual(['intent', 'running']);
    expect(r.idx('session.open')).toBeLessThan(r.idx('permit.grant'));
    expect(r.idx('permit.grant')).toBeLessThan(r.idx('session.spawned'));
    const sb = r.kinds('session.sandbox').find((x) => x.payload.profile)!.payload;
    expect(sb).toMatchObject({ sandbox: 'full', profile: 'session' });
    expect(String(sb.profileHash)).toMatch(/^sha256:/);
    // the session's policy.json mirrors the denies (Claude's own rules, defence in depth)
    const pol = JSON.parse(fs.readFileSync(path.join(w.home, 'sessions', s.hsid.slice(18).toLowerCase(), 'policy.json'), 'utf8'));
    expect(pol.permissions.deny.length).toBeGreaterThan(5);
  });
  it('T-2026-10-18-019: session.send through a REAL KernelLog — session.inject carries the byte count, never the text', async () => {
    const lh = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gnomon-klog-'));
    const klog = KernelLog.open({ home: lh, kernelPrincipal: 'p:abcdefgh/kernel', signer: SoftwareEd25519Signer.generate() });
    live.push(async () => {
      await klog.close();
      fs.rmSync(lh, { recursive: true, force: true });
    });
    const r = rig({ realLog: klog });
    const s = await open(r.sup);
    const text = 'héllo SECRET-PLAINTEXT';
    await r.sup.send(HUMAN, { hsid: s.hsid, text });
    expect(r.kinds('session.inject')[0]!.payload.bytes).toBe(Buffer.byteLength(text, 'utf8'));
    expect(fs.readdirSync(lh, { recursive: true }).map(String).some((f) => fs.statSync(path.join(lh, f)).isFile() && fs.readFileSync(path.join(lh, f), 'utf8').includes('SECRET-PLAINTEXT'))).toBe(false);
  });
  it('S2 + usage: turn.event before usage; tokens charged once against the spawn permit; ask-user card raised', async () => {
    const r = rig();
    setMode(w, { tool: 'AskUserQuestion' });
    const s = await open(r.sup);
    const { turn } = await r.sup.send(HUMAN, { hsid: s.hsid, text: 'hello' });
    expect(turn).toBe(`turn:${s.hsid}/1`);
    expect(await waitFor(() => r.kinds('turn.result').length === 1)).toBe(true);
    expect(r.idx('session.inject')).toBeLessThan(r.idx('turn.sent'));
    expect(r.idx('turn.event')).toBeLessThan(r.idx('turn.usage'));
    const charged = r.kinds('budget.usage').filter((x) => !x.payload.malformed && !x.payload.overPermit).reduce((a, x) => a + (x.payload.tokens as number), 0);
    expect(charged).toBe(10 + 25 + 100); // result total, never double counted
    const spawnPermit = r.kinds('session.sandbox').find((x) => x.payload.profile)!.payload.permitId;
    expect(new Set(r.kinds('budget.usage').map((x) => x.payload.permitId))).toEqual(new Set([spawnPermit]));
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0]).toMatchObject({ kind: 'ask-user', hsid: s.hsid, attended: true });
    expect(r.kinds('turn.ask-user')[0]!.payload.cardId).toBe('card:1');
    expect(r.kinds('permit.grant').map((x) => (x.payload.permit as { kind: string }).kind)).toEqual(['session.spawn', 'turn']);
  });
  it('G-RUN-03 interrupt is the control_request line; stop kills the group and releases the permits', async () => {
    const r = rig();
    const s = await open(r.sup);
    const i = await r.sup.stop(HUMAN, { hsid: s.hsid, interrupt: true });
    expect(i.signals).toEqual(['control_request:interrupt']);
    expect(await waitFor(() => trace(w).some((t) => t.t === 'stdin' && (t.m as { type: string }).type === 'control_request'))).toBe(true);
    const st = await r.sup.stop(HUMAN, { hsid: s.hsid });
    expect(st.exited).toBe(true);
    expect(await waitFor(() => r.kinds('session.exited').length === 1 && r.kinds('permit.release').length >= 1)).toBe(true);
  });
  it('G-RUN-03 a child that ignores SIGTERM and stdin end is SIGKILLed with its group', async () => {
    const r = rig();
    setMode(w, { ignoreTerm: true, ignoreStdinEnd: true });
    const s = await open(r.sup);
    expect(await waitFor(() => trace(w).some((t) => t.t === 'argv'))).toBe(true);
    const st = await r.sup.stop(HUMAN, { hsid: s.hsid });
    expect(st.exited).toBe(true);
    expect(await waitFor(() => r.kinds('session.exited').length === 1)).toBe(true);
    expect(r.kinds('session.exited')[0]!.payload.signal).toBe('SIGKILL');
  });
  it('init.apiKeySource ≠ none kills the group and logs billing.api.refused', async () => {
    const r = rig();
    setMode(w, { apiKeySource: 'ANTHROPIC_API_KEY' });
    await open(r.sup);
    expect(await waitFor(() => r.kinds('session.exited').length === 1)).toBe(true);
    expect(r.kinds('billing.api.refused')[0]!.payload.where).toEqual(['init.apiKeySource']);
  });
  it('tolerant: unknown types/fields and malformed lines are logged turn.events, never acted on', async () => {
    const r = rig();
    setMode(w, { extraLines: ['{"type":"from_the_future","x":1}', 'not json at all', '{"type":"assistant","message":{"content":[]},"novel":{"a":[1]}}'] });
    await open(r.sup);
    expect(await waitFor(() => r.kinds('turn.event').some((x) => x.payload.type === 'malformed'))).toBe(true);
    expect(r.kinds('turn.event').map((x) => x.payload.type)).toEqual(expect.arrayContaining(['from_the_future', 'malformed', 'assistant']));
    expect(r.kinds('session.exited')).toEqual([]);
  });
  it('G-SUB-05 a settings layer written mid-session with an API key ⇒ stopped within 2 s, billing.api.refused', async () => {
    const r = rig({ watchMs: 200 });
    await open(r.sup);
    expect(await waitFor(() => trace(w).some((t) => t.t === 'argv'))).toBe(true);
    const t0 = Date.now();
    fs.writeFileSync(path.join(w.cwd, '.claude', 'settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: 'k' } }));
    expect(await waitFor(() => r.kinds('session.exited').length === 1, 2_000)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(r.kinds('session.layers.changed')[0]!.payload.which).toEqual(['settings']);
    expect(r.kinds('billing.api.refused').some((x) => x.payload.midSession === true)).toBe(true);
  });
  it('a non-owner cannot send or stop (NOT_FOUND)', async () => {
    const r = rig();
    const s = await open(r.sup);
    expect((await refusal(r.sup.send('p:abcdefgh/other', { hsid: s.hsid, text: 'x' }))).refusal.code).toBe('NOT_FOUND');
    expect((await refusal(r.sup.stop('p:abcdefgh/other', { hsid: s.hsid }))).refusal.code).toBe('NOT_FOUND');
  });
});

describe.skipIf(!SANDBOX_OK)('T-008 generated plugin bytes are verified at spawn against the kernel-held record', () => {
  it('a repo file that differs from the record refuses the spawn; no process starts', async () => {
    const r = rig();
    const rel = '.gnomon/generated/.mcp.json';
    const body = `${JSON.stringify({ _gnomon: { generatedBy: 'gnomon', manifestHash: 'sha256:x', doNotEdit: true }, mcpServers: {} })}\n`;
    fs.mkdirSync(path.join(w.cwd, '.gnomon', 'generated'), { recursive: true });
    fs.writeFileSync(path.join(w.cwd, rel), body.replace('{}', '{"evil":{"command":"/bin/sh"}}'));
    const { createHash } = await import('node:crypto');
    const rp = recordPath(w.home, w.cwd);
    fs.mkdirSync(path.dirname(rp), { recursive: true });
    fs.writeFileSync(rp, JSON.stringify({ schemaVersion: 'gnomon-generated-record:v1', repo: w.cwd, manifestHash: 'sha256:x', files: [{ path: rel, sha256: createHash('sha256').update(body).digest('hex') }], createdDirs: [] }));
    const e = await refusal(open(r.sup));
    expect(e.refusal.data).toMatchObject({ session: 'spawn_failed' });
    expect(r.kinds('session.spawned')).toEqual([]);
  });
});

describe.skipIf(!SANDBOX_OK)('round 2: reviewer + Aegis conditions', () => {
  it('BLOCKING: a claude that exits at startup is cleaned up (permit released, watch cleared, state exited)', async () => {
    const r = rig();
    setMode(w, { exitAtStart: 2 });
    const s = await open(r.sup);
    expect(await waitFor(() => r.sup.stateOf(s.hsid) === 'exited')).toBe(true);
    const spawnPermit = r.kinds('session.sandbox').find((x) => x.payload.permitId)!.payload.permitId;
    expect(r.kinds('permit.release').map((x) => x.payload.permitId)).toContain(spawnPermit);
    fs.writeFileSync(path.join(w.cwd, '.claude', 'settings.json'), '{}');
    await new Promise((res) => setTimeout(res, 500));
    expect(r.kinds('session.layers.changed')).toEqual([]); // the watch is gone
    expect((await refusal(r.sup.send(HUMAN, { hsid: s.hsid, text: 'x' }))).refusal.code).toBe('NOT_FOUND');
  });
  it('H1(b): the binary is pinned on first use (logged); a different hash is claude_binary_changed until an explicit re-pin', async () => {
    const r = rig();
    const s = await open(r.sup);
    expect(r.kinds('session.sandbox')[0]!.payload).toMatchObject({ phase: 'binary-pin', pin: 'first-use' });
    await r.sup.stop(HUMAN, { hsid: s.hsid });
    fs.appendFileSync(w.claude, '# swapped by a session\n');
    const e = await refusal(open(r.sup));
    expect(e.refusal.data).toMatchObject({ session: 'claude_binary_changed', next: 'gnomon session repin-claude' });
    expect(r.kinds('session.spawned').filter((x) => x.payload.phase === 'intent')).toHaveLength(1);
    const { createHash } = await import('node:crypto');
    repinClaudeBinary(w.home, createHash('sha256').update(fs.readFileSync(w.claude)).digest('hex'), w.claude);
    expect(readClaudePin(w.home)!.by).toBe('repin');
    expect((await open(r.sup)).state).toBe('running');
    const pinRows = r.kinds('session.sandbox').filter((x) => x.payload.phase === 'binary-pin');
    expect(pinRows.at(-1)!.payload).toMatchObject({ by: 'repin' });
    expect(pinRows.at(-1)!.payload.to).toBe(readClaudePin(w.home)!.sha256);
    expect(readClaudePin(w.home)!.logged).toBe(true);
  });
  it('H1(c)(d): preflight runs the PRIVATE copy under the session profile; the session runs the copy too', async () => {
    const r = rig();
    setMode(w, { probeWrite: path.join(w.home, 'preflight-wrote-here') });
    await open(r.sup);
    expect(await waitFor(() => trace(w).some((t) => t.t === 'argv'))).toBe(true);
    const v = trace(w).find((t) => t.t === 'version')!;
    expect(v.probe).toBe('blocked'); // under the profile: <home>/** is unwritable
    expect(String(v.self).startsWith(path.join(w.home, 'bin', 'claude-'))).toBe(true);
    expect(String(trace(w).find((t) => t.t === 'argv')!.self).startsWith(path.join(w.home, 'bin', 'claude-'))).toBe(true);
    expect(fs.existsSync(path.join(w.home, 'preflight-wrote-here'))).toBe(false);
  });
  it('reviewer 9: the child HOME is the scanned user home, whatever the daemon env says', async () => {
    const r = rig();
    await open(r.sup);
    expect(await waitFor(() => trace(w).some((t) => t.t === 'argv'))).toBe(true);
    expect(trace(w).find((t) => t.t === 'argv')!.home).toBe(w.userHome);
  });
  it('Aegis M3: a line over 64 KiB is logged by hash + size, never in full', async () => {
    const r = rig();
    setMode(w, { bigLine: 70_000 });
    await open(r.sup);
    expect(await waitFor(() => r.kinds('turn.event').some((x) => typeof x.payload.lineHash === 'string'))).toBe(true);
    const big = r.kinds('turn.event').find((x) => typeof x.payload.lineHash === 'string')!.payload;
    expect(big.line).toBeUndefined();
    expect(big.bytes as number).toBeGreaterThan(70_000);
  });
  it('reviewer 7: turn permits are FIFO — each result releases the head only', async () => {
    const r = rig();
    const s = await open(r.sup);
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'one' });
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'two' });
    expect(await waitFor(() => r.kinds('turn.result').length === 2)).toBe(true);
    const sent = r.kinds('turn.sent').map((x) => x.payload.permitId);
    const released = r.kinds('permit.release').map((x) => x.payload.permitId).filter((id) => sent.includes(id));
    expect(released).toEqual(sent);
  });
  it('reviewer 9: a caller turn permit is single-use', async () => {
    const r = rig();
    const s = await open(r.sup);
    const t = await r.fuse.reserve({ principal: HUMAN, principalClass: 'human', attended: true, kind: 'turn', backend: 'claude-code', scope: { user: HUMAN, session: s.hsid } });
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'one', permitId: t.permitId });
    expect((await refusal(r.sup.send(HUMAN, { hsid: s.hsid, text: 'two', permitId: t.permitId }))).refusal.code).toBe('PERMIT_REQUIRED');
  });
  it('reviewer 8: Claude\'s routine ~/.claude.json rewrites do not fire session.layers.changed; its mcpServers do', async () => {
    const r = rig({ watchMs: 100 });
    await open(r.sup);
    fs.writeFileSync(path.join(w.userHome, '.claude.json'), JSON.stringify({ numStartups: 7, tipsHistory: { a: 1 } }));
    await new Promise((res) => setTimeout(res, 500));
    expect(r.kinds('session.layers.changed')).toEqual([]);
    fs.writeFileSync(path.join(w.userHome, '.claude.json'), JSON.stringify({ numStartups: 8, mcpServers: { s: { command: 'x' } } }));
    expect(await waitFor(() => r.kinds('session.layers.changed').length === 1, 2_000)).toBe(true);
  });
  it('reviewer 6 + note: a refused open leaks nothing — permit released, session dir removed', async () => {
    const r = rig();
    await r.children.stopAll('shutdown'); // intend() now throws: the daemon is stopping
    const e = await refusal(open(r.sup));
    expect(e.refusal.data).toMatchObject({ session: 'spawn_failed' });
    const granted = r.kinds('permit.grant').map((x) => (x.payload.permit as { permitId: string }).permitId);
    expect(granted).toHaveLength(1);
    expect(r.kinds('permit.release').map((x) => x.payload.permitId)).toEqual(granted);
    expect(fs.readdirSync(path.join(w.home, 'sessions'))).toEqual([]);
  });
  it('note: init without apiKeySource is logged `absent`', async () => {
    const r = rig();
    setMode(w, { apiKeySource: null });
    await open(r.sup);
    expect(await waitFor(() => r.kinds('turn.event').some((x) => x.payload.type === 'system.init'))).toBe(true);
    expect(r.kinds('turn.event').find((x) => x.payload.type === 'system.init')!.payload.apiKeySource).toBe('absent');
  });
});

describe.skipIf(!SANDBOX_OK)('round 3', () => {
  it('1: a result written right before exit is recorded; its turn permit is released once', async () => {
    const r = rig();
    setMode(w, { resultThenExit: true });
    const s = await open(r.sup);
    await r.sup.send(HUMAN, { hsid: s.hsid, text: 'bye' });
    expect(await waitFor(() => r.sup.stateOf(s.hsid) === 'exited')).toBe(true);
    expect(r.kinds('turn.result')).toHaveLength(1);
    const turnPermit = r.kinds('turn.sent')[0]!.payload.permitId;
    expect(r.kinds('permit.release').filter((x) => x.payload.permitId === turnPermit)).toHaveLength(1);
  });
  it('2: a failure after track (the session.sandbox row fails) stops the group and releases the spawn permit', async () => {
    const r = rig({ failSandboxRow: true });
    await expect(open(r.sup)).rejects.toThrow();
    expect(await waitFor(() => r.kinds('session.exited').length === 1)).toBe(true);
    const granted = r.kinds('permit.grant').map((x) => (x.payload.permit as { permitId: string }).permitId);
    expect(await waitFor(() => r.kinds('permit.release').length === granted.length)).toBe(true);
  });
  it('3 (N1): no pin is written when the sandboxed preflight fails; a first-use pin is shown in the open reply and status', async () => {
    let r = rig();
    setMode(w, { version: '2.1.100' });
    await refusal(open(r.sup));
    expect(readClaudePin(w.home)).toBeNull();
    r = rig();
    const s = await open(r.sup);
    expect(s.binaryPin).toMatch(/^first-use pin [0-9a-f]{64} from /);
    expect(r.sup.pinStatus()).toMatchObject({ by: 'first-use' });
  });
  it('3: `gnomon session repin-claude` needs a terminal and the typed last 8 of the new sha', async () => {
    rig();
    const io = (typed: string, tty = true) => {
      const stdin = Object.assign(new PassThrough(), { isTTY: tty });
      let out = '';
      let err = '';
      stdin.end(`${typed}\n`);
      return { io: { stdin, stdout: { isTTY: tty, write: (x: string) => (out += x) }, stderr: { write: (x: string) => (err += x) } }, out: () => out, err: () => err };
    };
    const notty = io('x', false);
    expect(await runSessionCommand(['repin-claude', '--home', w.home, '--claude', w.claude], notty.io)).toBe(1);
    expect(notty.err()).toContain('interactive terminal');
    const wrong = io('nope');
    expect(await runSessionCommand(['repin-claude', '--home', w.home, '--claude', w.claude], wrong.io)).toBe(1);
    expect(readClaudePin(w.home)).toBeNull();
    const { createHash } = await import('node:crypto');
    const sha = createHash('sha256').update(fs.readFileSync(w.claude)).digest('hex');
    const ok = io(sha.slice(-8));
    expect(await runSessionCommand(['repin-claude', '--home', w.home, '--claude', w.claude], ok.io)).toBe(0);
    expect(readClaudePin(w.home)).toMatchObject({ sha256: sha, by: 'repin', logged: false });
  });
  it('4: a script binary is refused claude_binary_unsupported (the daemon never allows scripts)', async () => {
    const r = rig({ allowScripts: false });
    expect((await refusal(open(r.sup))).refusal.data).toMatchObject({ session: 'claude_binary_unsupported', kind: 'script' });
    expect(r.kinds('permit.grant')).toEqual([]);
  });
});

describe('the host floor: macOS 15+ and SIP (every darwin host)', () => {
  it('below macOS 15 an open is refused sandbox-unavailable (floor macos): no spawn, no pin, permit released, status unavailable', async () => {
    const r = rig({ macosMajor: () => 14 });
    const e = await refusal(open(r.sup));
    expect(e.refusal.code).toBe('UNSUPPORTED');
    expect(e.refusal.data).toMatchObject({ session: 'spawn_failed', sandbox: 'unavailable', floor: 'macos', have: 14, need: 15 });
    expect(r.kinds('session.refused')[0]!.payload).toMatchObject({ code: 'spawn_failed', floor: 'macos' });
    expect(r.kinds('session.spawned')).toEqual([]);
    expect(trace(w).filter((t) => t.t === 'argv' || t.t === 'version')).toEqual([]);
    expect(r.sup.sandboxStatus()).toMatchObject({ fidelity: 'unavailable', reason: 'macos-floor' });
  });
  it('macOS 15 with SIP disabled: an open is refused sandbox-unavailable (floor sip): no spawn, status unavailable sip-disabled', async () => {
    const r = rig({ macosMajor: () => 15, sipEnabled: () => false });
    const e = await refusal(open(r.sup));
    expect(e.refusal.code).toBe('UNSUPPORTED');
    expect(e.refusal.data).toMatchObject({ session: 'spawn_failed', sandbox: 'unavailable', floor: 'sip', have: 'disabled' });
    expect(r.kinds('session.refused')[0]!.payload).toMatchObject({ code: 'spawn_failed', floor: 'sip' });
    expect(r.kinds('session.spawned')).toEqual([]);
    expect(trace(w).filter((t) => t.t === 'argv' || t.t === 'version')).toEqual([]);
    expect(r.sup.sandboxStatus()).toMatchObject({ fidelity: 'unavailable', reason: 'sip-disabled', have: 'disabled' });
  });
});

describe('M1.7 slice 2 (deferred)', () => {
  it.todo('Aegis M3 optional per-session byte cap on stdout (slice 2)');
  it.todo('G-SUB-05 non-law-7 layer change ⇒ gate-class card (slice 2); fs.watch/ReadDirectoryChangesW instead of the 500 ms hash poll');
  it.todo('G-RUN-05 idle respawn with --resume charged as a launch (a session.spawn permit), crash cap 3/10 min, claude_binary_changed on respawn wired');
  it.todo('ask-user / plan card decisions written back to the child (answer / approve-plan) — needs the broker decision path to the session (slice 2)');
  it.todo('api-token billing (billing.api.active per turn, G-SUB-03) injected into exactly one session child (slice 2; refused today)');
  it.todo('session principals (p:<ns>/s-<short>) authenticated on the socket: session.send/stop for agent/session classes, permit.reserve "own scope"');
  it.todo('the gnomon-mods MCP bridge spawned beside the session under the same profile (M1.11)');
  it.todo('§15.5 gate-class card to accept a partial session profile (Windows parity phase, G-WIN-06 refusal half)');
  it.todo('G-ADP-01 nightly replay of RECORDED (not synthetic) transcripts per claude version; G-ADP-02 for gnomon-local (M1.8)');
  it.todo('the helper XPC service mach-lookup deny (ipc:helper-service) once the helper exists (M1.3)');
  it.todo('git hardening for kernel git calls (S16-2) — the `git` sandbox class (M2)');
});
