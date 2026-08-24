/**
 * daemon.test — PHASE 1 (#warplined): the solo daemon over a FIXTURE fabric
 * (never the live repo fabric — hard rule).
 *
 * Pinned here:
 *   LIFECYCLE  single-instance pidfile lock; clean stop removes socket+pidfile;
 *              stale (dead-pid / orphaned-socket) residue is recovered on start;
 *              stopDaemon SIGTERMs a real child holder and reaps the pidfile.
 *   IDENTITY   token→principal stamping (client-supplied agentId/actor/decidedBy
 *              IGNORED); unknown/missing token → AUTH; agent-class tokens refused
 *              on accept-breach / accept-risk / resolve / stake (the verb ×
 *              principal matrix, aegis-security.md §2.2); every call audited.
 *   E2E        fork → propose → admit → knot.show → resolve driven ENTIRELY
 *              through the socket on a git-less fixture; `fabric verify` green.
 *   G3         responses carry engine shapes verbatim inside the envelope.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { startDaemon, readDaemonAudit, type DaemonHandle } from '../src/daemon/server.js';
import { mintToken, tokensPathOf, listTokenSummaries } from '../src/daemon/tokens.js';
import {
  daemonState,
  stopDaemon,
  pidPathOf,
  socketPathOf,
  DAEMON_PIDFILE_SCHEMA,
} from '../src/daemon/lifecycle.js';
import { DaemonClient, DaemonRpcError, daemonAvailable } from '../src/daemon/client.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { readRef } from '../src/fabric/refs.js';
import { warplineDirOf, readFabric } from '../src/fabric/fabric.js';

const MOD = 'src/mod.ts';
const BASE = 'export function foo() { return 1; }\nexport function bar() { return 2; }\n';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

async function rejectsWith(p: Promise<unknown>, code: string): Promise<DaemonRpcError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(DaemonRpcError);
    const e = err as DaemonRpcError;
    expect(e.code).toBe(code);
    // SP2 (TD-2026-07-21-766): EVERY daemon error frame carries refusal:v1
    // with the SAME code — one vocabulary across the skins; a cold agent
    // branches on code/gate/retriable enums, never on message prose. Asserted
    // here, at the one choke point, so no error case can regress silently.
    expect(e.refusal?.schemaVersion).toBe('refusal:v1');
    expect(e.refusal?.code).toBe(code);
    expect(e.refusal?.gate).toBeDefined();
    expect(e.refusal?.retriable).toBeDefined();
    return e;
  }
  throw new Error(`expected a DaemonRpcError(${code}) rejection, got a resolution`);
}

describe('#warplined — lifecycle (one daemon per fabric)', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wld-life-'));
    write(root, MOD, BASE);
  });
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('start binds a 0600 socket, writes the pidfile, refuses a second instance, and close cleans both', async () => {
    const handle = await startDaemon(root);
    try {
      expect(fs.statSync(handle.socketPath).isSocket()).toBe(true);
      expect(fs.statSync(handle.socketPath).mode & 0o777).toBe(0o600);
      expect(daemonAvailable(root)).toBe(true);
      const st = daemonState(root);
      expect(st.state).toBe('running');
      if (st.state === 'running') expect(st.pidfile.pid).toBe(process.pid);
      // Exactly one daemon per fabric — the pidfile is the lock.
      await expect(startDaemon(root)).rejects.toThrow(/already running/);
    } finally {
      await handle.close();
    }
    expect(fs.existsSync(handle.socketPath)).toBe(false);
    expect(fs.existsSync(pidPathOf(root))).toBe(false);
    expect(daemonState(root).state).toBe('stopped');
  });

  it('socketPathOf falls back to a deterministic tmpdir socket for deep roots (sun_path limit)', () => {
    const deep = path.join(root, 'a'.repeat(60), 'b'.repeat(60));
    const sp = socketPathOf(deep);
    expect(Buffer.byteLength(sp, 'utf8')).toBeLessThanOrEqual(104);
    expect(sp).toBe(socketPathOf(deep)); // every side derives the same path
    expect(sp).not.toBe(socketPathOf(root)); // per-root, content-addressed
  });

  it('recovers from stale residue: dead-pid pidfile + orphaned socket', async () => {
    // A pid that provably exited (spawnSync reaps it before returning).
    const dead = spawnSync(process.execPath, ['-e', '']);
    expect(dead.status).toBe(0);
    fs.mkdirSync(warplineDirOf(root), { recursive: true });
    fs.writeFileSync(
      pidPathOf(root),
      JSON.stringify({
        schemaVersion: DAEMON_PIDFILE_SCHEMA,
        pid: dead.pid,
        startedAt: new Date().toISOString(),
        socketPath: socketPathOf(root),
      }) + '\n',
    );
    fs.writeFileSync(socketPathOf(root), 'stale-not-a-socket', 'utf8'); // crash residue
    expect(daemonState(root).state).toBe('stale');

    const handle = await startDaemon(root); // must clean + acquire
    try {
      expect(daemonState(root).state).toBe('running');
      expect(fs.statSync(socketPathOf(root)).isSocket()).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it('stopDaemon SIGTERMs a real (child) holder and the pidfile disappears', async () => {
    // A minimal external holder: writes the pidfile, unlinks it on SIGTERM.
    const holderScript =
      'const fs=require("fs"),p=process.argv[1];' +
      'fs.writeFileSync(p,JSON.stringify({schemaVersion:"daemonPid:v1",pid:process.pid,startedAt:new Date().toISOString(),socketPath:process.argv[2]})+"\\n");' +
      'process.on("SIGTERM",()=>{try{fs.unlinkSync(p)}catch{}process.exit(0)});' +
      'setInterval(()=>{},1000);';
    const child = spawn(process.execPath, ['-e', holderScript, pidPathOf(root), socketPathOf(root)], {
      stdio: 'ignore',
    });
    // Wait for the child to write the pidfile.
    for (let i = 0; i < 100 && daemonState(root).state !== 'running'; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(daemonState(root).state).toBe('running');
    const r = await stopDaemon(root);
    expect(r.stopped).toBe(true);
    expect(r.pid).toBe(child.pid);
    expect(daemonState(root).state).toBe('stopped');
  });

  it('stopDaemon on a stopped fabric reports not running; stale residue is cleaned', async () => {
    expect((await stopDaemon(root)).stopped).toBe(false);
    fs.writeFileSync(socketPathOf(root), 'residue', 'utf8'); // orphan socket, no pidfile
    const r = await stopDaemon(root);
    expect(r.stopped).toBe(false);
    expect(r.reason).toMatch(/stale/);
    expect(fs.existsSync(socketPathOf(root))).toBe(false);
  });
});

describe('#warplined — stage-1 identity + the verb×principal matrix + the e2e loop', () => {
  let root: string;
  let dirB: string; // agent-b's forked worktree
  let dirR: string; // the human's resolution worktree
  let handle: DaemonHandle;
  let humanToken: string;
  let agentAToken: string;
  let agentBToken: string;
  let human: DaemonClient;
  let agentA: DaemonClient;
  let agentB: DaemonClient;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wld-e2e-'));
    dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wld-e2e-b-'));
    dirR = fs.mkdtempSync(path.join(os.tmpdir(), 'wld-e2e-r-'));
    write(root, MOD, BASE);
    write(root, 'readme.md', 'daemon fixture\n');
    // Token minting is the LOCAL human act (possession of the box) — no daemon verb.
    humanToken = mintToken(root, 'matt', 'human').token;
    agentAToken = mintToken(root, 'agent-a', 'agent').token;
    agentBToken = mintToken(root, 'agent-b', 'agent').token;
    handle = await startDaemon(root);
    human = await DaemonClient.connect(root, humanToken);
    agentA = await DaemonClient.connect(root, agentAToken);
    agentB = await DaemonClient.connect(root, agentBToken);
  });

  afterAll(async () => {
    human?.close();
    agentA?.close();
    agentB?.close();
    await handle?.close();
    for (const d of [root, dirB, dirR]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('token file is 0600 and the listing is redacted', () => {
    expect(fs.statSync(tokensPathOf(root)).mode & 0o777).toBe(0o600);
    const rows = listTokenSummaries(root);
    expect(rows.map((r) => r.principal).sort()).toEqual(['agent-a', 'agent-b', 'matt']);
    for (const r of rows) {
      expect(r.tokenPrefix.endsWith('…')).toBe(true);
      expect(JSON.stringify(r)).not.toContain(humanToken);
    }
  });

  it('unknown and missing tokens are refused (AUTH), and the refusal is audited unauthenticated', async () => {
    const bogus = await DaemonClient.connect(root, 'not-a-token');
    await rejectsWith(bogus.status(), 'AUTH');
    bogus.close();
    const empty = await DaemonClient.connect(root, '');
    await rejectsWith(empty.refsList(), 'AUTH');
    empty.close();
    const audit = readDaemonAudit(root);
    const authRows = audit.filter((r) => r.code === 'AUTH');
    expect(authRows.length).toBeGreaterThanOrEqual(2);
    for (const r of authRows) expect(r.principal).toBe('(unauthenticated)');
  });

  it('unknown verbs are refused (UNKNOWN_VERB)', async () => {
    await rejectsWith(human.call('fabric.rewrite', {}), 'UNKNOWN_VERB');
  });

  it('status stamps the SERVER-resolved principal', async () => {
    const s = await agentA.status();
    expect(s.principal).toBe('agent-a');
    expect(s.kind).toBe('agent');
    expect(s.root).toBe(root);
    const sh = await human.status();
    expect(sh.principal).toBe('matt');
    expect(sh.kind).toBe('human');
  });

  it('E2E: genesis + edit loop through the socket — identity server-stamped despite spoofed params', async () => {
    // GENESIS — agent-a proposes the base tree and admits it.
    const f = await agentA.call<{ agentId: string; base: string | null }>('fork', {
      agentId: 'spoofed-identity', // advisory → IGNORED
    });
    expect(f.agentId).toBe('agent-a'); // server-stamped
    expect(f.base).toBeNull(); // empty fabric

    const p1 = await agentA.call<{ noop: boolean; strand?: { authoredBy?: { agentId?: string }; actor: string; pickId: string } }>(
      'propose',
      { intent: 'genesis: the base module', agentId: 'spoofed', actor: 'spoofed' },
    );
    expect(p1.noop).toBe(false);
    // THE identity test: the strand carries the token's principal, not the params'.
    expect(p1.strand!.authoredBy!.agentId).toBe('agent-a');
    expect(p1.strand!.actor).toBe('agent-a');

    const a1 = await agentA.admit({ noRestore: true });
    expect(a1.sealed).toBe(true);
    expect(a1.decision.status).toBe('FAST_ADMIT'); // genesis fast-forward
    expect(readRef(warplineDirOf(root), 'selvage')).toBe(p1.strand!.pickId);

    // refs.list over the daemon (G3: same shape as `warpline refs list --json`).
    const refs = await agentA.refsList();
    expect(refs.refs['selvage']).toBe(p1.strand!.pickId);
    expect(refs.heads).toContain(p1.strand!.pickId);

    // agent-b forks INTO its own worktree (restore over the socket).
    const fb = await agentB.fork({ into: dirB });
    expect(fb.agentId).toBe('agent-b');
    expect(fb.base).toBe(p1.strand!.pickId);
    expect(fs.readFileSync(path.join(dirB, MOD), 'utf8')).toBe(BASE);

    // agent-a edits foo (in the root worktree) and admits — selvage advances.
    write(root, MOD, BASE.replace('return 1', 'return 10'));
    const p2 = await agentA.propose({ intent: 'a: foo returns 10' });
    expect(p2.noop).toBe(false);
    const a2 = await agentA.admit({ noRestore: true });
    expect(a2.sealed).toBe(true);

    // agent-b contradicts the SAME symbol from the genesis base → KNOT.
    write(dirB, MOD, BASE.replace('return 1', 'return 999'));
    const p3 = await agentB.propose({ worktree: dirB, intent: 'b: foo returns 999' });
    expect(p3.noop).toBe(false);
    const a3 = await agentB.admit({ worktree: dirB, noRestore: true });
    expect(a3.sealed).toBe(false);
    expect(a3.decision.status).toBe('KNOT');
    expect(a3.knotPayloadId).toBeTruthy();

    // knot.show over the daemon returns the knotPayload:v1 shape verbatim (G3).
    const payload = await agentB.knotShow(a3.knotPayloadId!);
    expect(payload.schemaVersion).toBe('knotPayload:v1');
    expect(payload.payloadId).toBe(a3.knotPayloadId);
    await rejectsWith(agentB.knotShow('knotPayload:v1:doesnotexist00'), 'NOT_FOUND');

    // THE MATRIX: agent-b may NOT resolve its own knot (human-class verb)…
    await rejectsWith(
      agentB.resolve({ worktree: dirR, agentId: 'agent-b', reason: 'self-serve' }),
      'FORBIDDEN',
    );
    // …and may NOT self-override breach/risk (an agent never accepts its own breach).
    await rejectsWith(agentB.admit({ worktree: dirB, acceptBreach: true }), 'FORBIDDEN');
    await rejectsWith(agentB.admit({ worktree: dirB, acceptRisk: true }), 'FORBIDDEN');
    // …nor touch the checkpoint valve.
    await rejectsWith(agentB.stake(), 'FORBIDDEN');
    await rejectsWith(agentB.stakeRecover('deadbeef'), 'FORBIDDEN');

    // The HUMAN resolves: keep b's value. decidedBy is stamped from the SESSION
    // (a spoofed decidedBy param is ignored).
    write(dirR, MOD, BASE.replace('return 1', 'return 999'));
    write(dirR, 'readme.md', 'daemon fixture\n');
    const res = await human.call<{ strand: { actor: string }; resolution: { decidedBy: string } }>('resolve', {
      worktree: dirR,
      agentId: 'agent-b',
      reason: 'b is correct — 999 is the audited constant',
      decidedBy: 'spoofed-human', // advisory → IGNORED
    });
    expect(res.resolution.decidedBy).toBe('matt'); // server-stamped
    expect(res.strand.actor).toBe('matt');

    // The fabric authenticates end-to-end after the whole socket-driven loop.
    const report = verifyFabric(root);
    expect(report.failures).toEqual([]);
    // Every strand sealed through the daemon carries a server-stamped author.
    const authors = readFabric(warplineDirOf(root)).map((s) => s.authoredBy?.agentId ?? s.actor);
    for (const a of authors) expect(['agent-a', 'agent-b', 'matt']).toContain(a);
  });

  it('shadow admit over the daemon appends a row; shadow.tail returns it', async () => {
    write(root, MOD, fs.readFileSync(path.join(root, MOD), 'utf8') + 'export function baz() { return 3; }\n');
    const sh = await agentA.admitShadow({});
    expect(sh.shadow).toBe(true);
    expect(sh.row.schemaVersion).toBe('shadowVerdict:v1');
    expect(sh.row.agentId).toBe('agent-a'); // stamped
    const tail = await human.shadowTail(5);
    expect(tail.total).toBeGreaterThanOrEqual(1);
    expect(tail.rows[tail.rows.length - 1].agentId).toBe('agent-a');
    // Observe-only: the selvage did not move.
    const refs = await human.refsList();
    expect(refs.refs['selvage']).toBeTruthy();
  });

  it('grade.report is read-only over the daemon (G3: GradeReport verbatim)', async () => {
    const before = fs.existsSync(path.join(warplineDirOf(root), 'grades.jsonl'))
      ? fs.readFileSync(path.join(warplineDirOf(root), 'grades.jsonl'), 'utf8')
      : null;
    const report = await human.gradeReport({ window: 2 });
    expect(Array.isArray(report.grades)).toBe(true);
    expect(report.moat).toBeDefined();
    const after = fs.existsSync(path.join(warplineDirOf(root), 'grades.jsonl'))
      ? fs.readFileSync(path.join(warplineDirOf(root), 'grades.jsonl'), 'utf8')
      : null;
    expect(after).toBe(before); // report NEVER writes the sidecar over the daemon
  });

  it('the stake valve stays engine-gated for humans (default OFF) and FORBIDDEN for agents', async () => {
    // Human class passes the matrix but the VALVE config gate still refuses
    // (default OFF) — the daemon adds transport, never bypasses engine law.
    const err = await rejectsWith(human.stake(), 'ENGINE');
    expect(err.message).toMatch(/stake|valve|enabled/i);
  });

  it('every call is audited: (principal, verb, target, ok) — including refusals', async () => {
    const audit = readDaemonAudit(root);
    expect(audit.length).toBeGreaterThan(10);
    for (const row of audit) {
      expect(row.schemaVersion).toBe('daemonAudit:v1');
      expect(typeof row.principal).toBe('string');
      expect(typeof row.verb).toBe('string');
      expect(typeof row.ok).toBe('boolean');
      expect(typeof row.ts).toBe('string');
    }
    const forbidden = audit.filter((r) => r.code === 'FORBIDDEN');
    expect(forbidden.length).toBeGreaterThanOrEqual(5); // resolve + 2 overrides + 2 stake verbs
    for (const r of forbidden) expect(r.kind).toBe('agent');
    const resolveRow = audit.find((r) => r.verb === 'resolve' && r.ok);
    expect(resolveRow?.principal).toBe('matt');
    // The audit target is structural — the resolve REASON (free prose) never lands in it.
    for (const r of audit) {
      if (r.target) expect(r.target).not.toContain('audited constant');
    }
  });
});
