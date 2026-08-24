/**
 * m3-falsifier.test — M3-lite I7: the FIELD-TEST PRECONDITION falsifier for
 * auto-resolve grants (I6, m3-integrity-design-2026-08-23.md §6 Q3 /
 * TD-2026-08-23-136 item 4).
 *
 * Six arms, each pinning the refusal/failure KIND precisely:
 *   1. agent-context resolve, NO grant  → refused (daemon gate + CLI gate);
 *   2. agent resolve WITH active grant  → succeeds; the strand carries
 *      underGrant + a valid sig (signed under the authoredBy principal per
 *      Build B's rule); verify + fsck green;
 *   3. grant revoked → next agent resolve refused; a resolve strand recorded
 *      under a revoked/expired grant (hand-forged) → verify 'grant-violation'
 *      at the RIGHT seq;
 *   4. forged / wrong-principal sig on the agent-resolve strand → Build B's
 *      failure kinds fire (sig-invalid / sig-principal-mismatch);
 *   5. expired grant → refused;
 *   6. a ZERO-GRANT repo behaves byte-identically to pre-M3 on the resolve
 *      refusal (refusal object + message compared against the pre-grant
 *      fixture: the daemon's exact FORBIDDEN line, and the CLI's
 *      #agent-shell refusal — same constructor, same wording, empty ladder).
 *
 * The DISCRIMINATOR CORRECTION is load-bearing throughout: authoredBy.agentId
 * on a resolve strand names the CONTESTED agent whether a human or an agent
 * acted, so every arm keys off the GATE (token kind / shell marker) — never
 * off the strand's authorship.
 *
 * NEVER against the live fabric — scratch fixture roots only; CLI spawns pass
 * an explicit --root.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startDaemon, type DaemonHandle } from '../src/daemon/server.js';
import { mintToken } from '../src/daemon/tokens.js';
import { DaemonClient, DaemonRpcError } from '../src/daemon/client.js';
import { issueGrant, revokeGrant, grantsPathOf, GRANT_SCHEMA } from '../src/fabric/grants.js';
import { mintAgentKey } from '../src/fabric/keys.js';
import { forkNative, proposeNative, admitNative, resolveNative } from '../src/fabric/native.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { runFsck } from '../src/fabric/fsck.js';
import { warplineDirOf, readFabric } from '../src/fabric/fabric.js';
import { AGENT_ID_ENV, checkHumanClass, agentShellRefusal } from '../src/agent-shell.js';
import { exitCodeFor, type Refusal } from '../src/fabric/refusal.js';
import type { Strand } from '../src/fabric/strand.js';

const execFileAsync = promisify(execFile);
const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));
const haveDist = existsSync(distCli);

const MOD = 'src/mod.ts';
const BASE = 'export function foo() { return 1; }\nexport function bar() { return 2; }\n';

/** the daemon's EXACT pre-M3 refusal line for an agent-class resolve (arm 6). */
const DAEMON_REFUSAL_LINE = 'verb resolve is human-class only (Aegis §2.2) — principal "agent-b" is kind:agent';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

async function rejectsForbidden(p: Promise<unknown>): Promise<DaemonRpcError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(DaemonRpcError);
    const e = err as DaemonRpcError;
    expect(e.code).toBe('FORBIDDEN');
    expect(e.refusal?.schemaVersion).toBe('refusal:v1');
    expect(e.refusal?.code).toBe('FORBIDDEN');
    return e;
  }
  throw new Error('expected a FORBIDDEN rejection, got a resolution');
}

/** fabric.jsonl line index of a pickId (= a v3 failure's reported seq). */
function lineIndexOf(root: string, pickId: string): number {
  return readFabric(warplineDirOf(root)).findIndex((s) => s.pickId === pickId);
}

/** Mutate one strand's row in fabric.jsonl by pickId (returns the original file bytes). */
function mutateStrand(root: string, pickId: string, fn: (s: Strand) => void): string {
  const p = path.join(warplineDirOf(root), 'fabric.jsonl');
  const original = fs.readFileSync(p, 'utf8');
  const lines = original.split('\n').filter((l) => l.trim());
  const i = lines.findIndex((l) => (JSON.parse(l) as Strand).pickId === pickId);
  expect(i).toBeGreaterThanOrEqual(0);
  const strand = JSON.parse(lines[i]) as Strand;
  fn(strand);
  lines[i] = JSON.stringify(strand);
  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
  return original;
}

/* ══ the DAEMON gate (server.ts verb×principal matrix + the grant exception) ══ */

describe('I7 falsifier — the daemon path', () => {
  let root: string;
  let dirB: string; // agent-b's forked worktree
  let dirR: string; // the resolution worktree
  let handle: DaemonHandle;
  let human: DaemonClient;
  let agentB: DaemonClient;
  let grantedStrand: Strand; // arm 2's under-grant resolve strand
  let grantId: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-falsifier-d-'));
    dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-falsifier-db-'));
    dirR = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-falsifier-dr-'));
    write(root, MOD, BASE);
    const humanToken = mintToken(root, 'matt', 'human').token;
    const agentBToken = mintToken(root, 'agent-b', 'agent').token;
    handle = await startDaemon(root);
    human = await DaemonClient.connect(root, humanToken);
    agentB = await DaemonClient.connect(root, agentBToken);
    // the KNOT: genesis by the human, contradiction by agent-b.
    await human.call('fork', {});
    await human.call('propose', { intent: 'genesis' });
    await human.admit({ noRestore: true });
    await agentB.fork({ into: dirB });
    write(root, MOD, BASE.replace('return 1', 'return 10'));
    await human.call('propose', { intent: 'h: foo=10' });
    await human.admit({ noRestore: true });
    // Build B: pin the signing epoch NOW (at the selvage tip — everything
    // already sealed is grandfathered) so every later agent-b seal, including
    // the KNOT proposal below and the granted resolve, is signed.
    mintAgentKey(root, 'agent-b');
    write(dirB, MOD, BASE.replace('return 1', 'return 999'));
    await agentB.propose({ worktree: dirB, intent: 'b: foo=999' });
    const a = await agentB.admit({ worktree: dirB, noRestore: true });
    expect(a.sealed).toBe(false);
    expect(a.decision.status).toBe('KNOT');
    // the resolved bytes agent-b will seal under grant
    write(dirR, MOD, BASE.replace('return 1', 'return 999'));
  }, 120_000);

  afterAll(async () => {
    human?.close();
    agentB?.close();
    await handle?.close();
    for (const d of [root, dirB, dirR]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('ARM 1 + ARM 6 — agent resolve with NO grant: refused FORBIDDEN, byte-identical to the pre-grant fixture', async () => {
    expect(fs.existsSync(grantsPathOf(root))).toBe(false); // truly zero-grant
    const e = await rejectsForbidden(agentB.resolve({ worktree: dirR, agentId: 'agent-b', reason: 'self-serve' }));
    // ARM 6 (byte-identity): the pre-M3 gate threw this EXACT message with this
    // EXACT refusal — pinned verbatim so any wording/shape drift on the
    // zero-grant path fails here.
    expect(e.message).toBe(DAEMON_REFUSAL_LINE);
    expect(e.refusal?.next).toEqual([]);
    expect(e.refusal?.retriable).toBe('never');
    // and the refused attempt sealed NOTHING and created NO grant store
    expect(readFabric(warplineDirOf(root)).some((s) => s.resolves)).toBe(false);
    expect(fs.existsSync(grantsPathOf(root))).toBe(false);
  });

  it('ARM 2 — agent resolve WITH an active grant: sealed; underGrant recorded; signed under authoredBy; verify+fsck green', async () => {
    // the signing epoch was pinned in beforeAll (Build B): the resolution
    // ahead MUST be signed under the authoredBy principal.
    grantId = issueGrant(root, { note: 'falsifier arm 2', ttlMs: 3_600_000 }).grant.grantId;
    const res = await agentB.resolve({ worktree: dirR, agentId: 'agent-b', reason: 'granted window — b is correct' });
    grantedStrand = res.strand;
    // the seal records the grant the GATE admitted the act under…
    expect(grantedStrand.underGrant).toBe(grantId);
    expect(grantedStrand.resolves?.decidedBy).toBe('agent-b'); // server-stamped acting principal
    // …and is signed under the authoredBy principal (the CONTESTED agent —
    // which here is ALSO the actor; the discriminator stays the gate, not authorship).
    expect(grantedStrand.authoredBy?.agentId).toBe('agent-b');
    expect(grantedStrand.sig?.principal).toBe('agent-b');
    expect(grantedStrand.sig?.schemaVersion).toBe('strandSig:v1');
    const report = verifyFabric(root);
    expect(report.failures).toEqual([]);
    expect(report.signing.signed).toBeGreaterThanOrEqual(1);
    expect(runFsck(root).ok).toBe(true);
  });

  it('ARM 2 residue — the grant opens RESOLVE ONLY: stake/recover/backup stay FORBIDDEN under an active grant', async () => {
    await rejectsForbidden(agentB.stake());
    await rejectsForbidden(agentB.stakeRecover('deadbeef'));
    await rejectsForbidden(agentB.backup(path.join(root, 'never-created')));
    expect(fs.existsSync(path.join(root, 'never-created'))).toBe(false);
  });

  it('ARM 3 — revoked: the next agent resolve is refused; the ALREADY-sealed strand stays valid (no retroaction)', async () => {
    revokeGrant(root, grantId);
    const e = await rejectsForbidden(agentB.resolve({ worktree: dirR, agentId: 'agent-b', reason: 'after revoke' }));
    expect(e.message).toBe(DAEMON_REFUSAL_LINE); // the revoked world = the zero-grant refusal
    // the strand sealed BEFORE the revocation instant remains green
    expect(verifyFabric(root).failures).toEqual([]);
  });

  it("ARM 3 (forged) — a resolve strand recorded under a grant revoked BEFORE its recordedAt → 'grant-violation' at the right seq", () => {
    // hand-forge the row: backdate a revocation to before the seal instant.
    const before = new Date(Date.parse(grantedStrand.recordedAt) - 1).toISOString();
    const original = fs.readFileSync(grantsPathOf(root), 'utf8');
    fs.appendFileSync(
      grantsPathOf(root),
      JSON.stringify({ schemaVersion: GRANT_SCHEMA, kind: 'revoke', grantId, revokedAt: before }) + '\n',
      'utf8',
    );
    try {
      const report = verifyFabric(root);
      const violations = report.failures.filter((f) => f.kind === 'grant-violation');
      expect(violations).toHaveLength(1);
      expect(violations[0].pickId).toBe(grantedStrand.pickId);
      expect(violations[0].seq).toBe(lineIndexOf(root, grantedStrand.pickId));
      expect(violations[0].detail).toMatch(/revoked/);
      expect(runFsck(root).ok).toBe(false); // the umbrella carries verify verbatim
    } finally {
      fs.writeFileSync(grantsPathOf(root), original, 'utf8');
    }
    expect(verifyFabric(root).failures).toEqual([]); // rig removed → green again
  });

  it("ARM 4 — forged sig on the agent-resolve strand → 'sig-invalid'; wrong-principal sig → 'sig-principal-mismatch'", () => {
    // forged: flip signature bytes (sig is OUTSIDE the pickId preimage, so the
    // ONLY failure allowed to fire is Build B's sig kind — never pickId-mismatch).
    let original = mutateStrand(root, grantedStrand.pickId, (s) => {
      s.sig = { ...s.sig!, sigBase64: Buffer.from('forged-by-the-falsifier').toString('base64') };
    });
    let failures = verifyFabric(root).failures;
    expect(failures.map((f) => f.kind)).toEqual(['sig-invalid']);
    expect(failures[0].pickId).toBe(grantedStrand.pickId);
    fs.writeFileSync(path.join(warplineDirOf(root), 'fabric.jsonl'), original, 'utf8');
    // wrong principal: a signature borrowed from another identity
    original = mutateStrand(root, grantedStrand.pickId, (s) => {
      s.sig = { ...s.sig!, principal: 'someone-else' };
    });
    failures = verifyFabric(root).failures;
    expect(failures.map((f) => f.kind)).toEqual(['sig-principal-mismatch']);
    expect(failures[0].pickId).toBe(grantedStrand.pickId);
    fs.writeFileSync(path.join(warplineDirOf(root), 'fabric.jsonl'), original, 'utf8');
    expect(verifyFabric(root).failures).toEqual([]);
  });

  it('ARM 5 — an EXPIRED grant grants nothing: refused exactly like no-grant', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    issueGrant(root, { now: twoDaysAgo, ttlMs: 86_400_000, note: 'already expired' }); // expired a day ago
    const e = await rejectsForbidden(agentB.resolve({ worktree: dirR, agentId: 'agent-b', reason: 'expired window' }));
    expect(e.message).toBe(DAEMON_REFUSAL_LINE);
  });

  it("ARM 3/5 (verify side) — a strand SEALED under an expired grant (gate bypassed) → 'grant-violation'", async () => {
    // a second live contest: agent-b forks and seals a fresh proposal (resolve
    // needs the sealed scratch strand as its second parent — no admit needed)…
    await agentB.fork({ into: dirB });
    write(dirB, MOD, fs.readFileSync(path.join(dirB, MOD), 'utf8').replace('return 999', 'return 2000'));
    await agentB.propose({ worktree: dirB, intent: 'b: foo=2000' });
    // …then bypass the gate: call the LIBRARY directly, naming an expired
    // grant. Enforcement lives at the gate by design, so the seal succeeds —
    // and verify must catch the violation.
    const expired = issueGrant(root, { now: new Date(Date.now() - 3 * 86_400_000).toISOString(), ttlMs: 3_600_000 }).grant;
    write(dirR, MOD, fs.readFileSync(path.join(dirB, MOD), 'utf8'));
    const res = await resolveNative(root, {
      worktree: dirR,
      agentId: 'agent-b',
      reason: 'forged: sealed under an expired grant',
      underGrant: expired.grantId,
    });
    const failures = verifyFabric(root).failures;
    expect(failures.map((f) => f.kind)).toEqual(['grant-violation']);
    expect(failures[0].pickId).toBe(res.strand.pickId);
    expect(failures[0].seq).toBe(lineIndexOf(root, res.strand.pickId));
    expect(failures[0].detail).toMatch(/expiry is strict/);
  });
});

/* ══ the CLI gate (#agent-shell + gateHumanClass's grant exception) ═══════════ */

describe('I7 falsifier — the CLI path (real binary, scratch fabric)', () => {
  let root: string;
  let dirB: string;

  interface Run {
    code: number;
    stdout: string;
    stderr: string;
  }

  /** Run the real CLI against the fixture. `agent` marks the shell (#agent-shell). */
  const cli = async (args: string[], opts: { agent?: string } = {}): Promise<Run> => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env[AGENT_ID_ENV]; // the founder's shell exports nothing
    delete env.WARPLINE_F4_RUN_ID;
    if (opts.agent) env[AGENT_ID_ENV] = opts.agent;
    try {
      const { stdout, stderr } = await execFileAsync('node', [distCli, ...args, '--root', root], {
        cwd: root,
        encoding: 'utf8',
        env,
      });
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  };

  const refusalOfRun = (run: Run): Refusal | null => {
    for (const line of run.stderr.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(t) as { refusal?: Refusal };
        if (parsed.refusal) return parsed.refusal;
      } catch {
        /* not the refusal line */
      }
    }
    return null;
  };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-falsifier-c-'));
    dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-falsifier-cb-'));
    write(root, MOD, BASE);
    // the KNOT, library-built (no daemon on this path): genesis → B contradicts.
    await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'genesis' });
    forkNative(root, 'B', { into: dirB });
    write(root, MOD, BASE.replace('return 1', 'return 10'));
    await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'g: foo=10' });
    await admitNative(root, { worktree: root, agentId: 'genesis' });
    // Build B: pin the signing epoch at the current selvage tip so every
    // later B seal (the KNOT proposal + the granted resolve) is signed.
    mintAgentKey(root, 'B');
    write(dirB, MOD, BASE.replace('return 1', 'return 999'));
    await proposeNative(root, { worktree: dirB, agentId: 'B', intent: 'B: foo=999' });
    const a = await admitNative(root, { worktree: dirB, agentId: 'B', noRestore: true });
    expect(a.decision.status).toBe('KNOT');
    // the root worktree holds the "resolved" bytes B will seal
    write(root, MOD, BASE.replace('return 1', 'return 999'));
  }, 120_000);

  afterAll(() => {
    for (const d of [root, dirB]) fs.rmSync(d, { recursive: true, force: true });
  });

  it.skipIf(!haveDist)(
    'ARM 1 + ARM 6 — agent shell, NO grant: the #agent-shell refusal, byte-identical to the pre-grant fixture',
    async () => {
      expect(fs.existsSync(grantsPathOf(root))).toBe(false);
      const run = await cli(['resolve', 'B', '-m', 'self-serve', '--native'], { agent: 'B' });
      // ARM 6: the PRE-GRANT fixture is computed in-process from the SAME
      // constructor the pre-M3 gate used — refusal:v1 deep-equal (refuse() is
      // deterministic) + the exact stderr sentence. Any zero-grant divergence
      // (a changed code, a grown ladder, reworded prose) fails here.
      const expected = checkHumanClass({ cliPath: 'resolve', env: { [AGENT_ID_ENV]: 'B' } as NodeJS.ProcessEnv })!;
      expect(refusalOfRun(run)).toEqual(JSON.parse(JSON.stringify(agentShellRefusal())));
      expect(run.stderr).toContain(expected.message);
      expect(run.code).toBe(exitCodeFor('FORBIDDEN'));
      // nothing sealed, and the refused attempt created NO grant store
      expect(readFabric(warplineDirOf(root)).some((s) => s.resolves)).toBe(false);
      expect(fs.existsSync(grantsPathOf(root))).toBe(false);
    },
    120_000,
  );

  it.skipIf(!haveDist)(
    'the grant LIFECYCLE is human-class on the CLI: an agent shell may not issue or revoke (list is a plain read)',
    async () => {
      const issue = await cli(['grant', 'auto-resolve', '-m', 'self-grant'], { agent: 'B' });
      expect(refusalOfRun(issue)?.code).toBe('FORBIDDEN');
      expect(issue.code).toBe(2);
      expect(fs.existsSync(grantsPathOf(root))).toBe(false); // the refusal wrote nothing
      const revoke = await cli(['grant', 'revoke', 'grant:' + 'a'.repeat(64)], { agent: 'B' });
      expect(refusalOfRun(revoke)?.code).toBe('FORBIDDEN');
      const list = await cli(['grant', 'list', '--json'], { agent: 'B' });
      expect(list.code).toBe(0); // agent-readable
      expect(JSON.parse(list.stdout)).toEqual({ grants: [], malformed: [] });
    },
    120_000,
  );

  it.skipIf(!haveDist)(
    'ARM 2 — human issues (loud line); agent shell resolves under the grant; underGrant + sig recorded; verify green',
    async () => {
      const issued = await cli(['grant', 'auto-resolve', '--ttl', '1h', '-m', 'falsifier CLI arm 2']);
      expect(issued.code).toBe(0);
      expect(issued.stdout).toContain('AGENTS MAY NOW RESOLVE KNOTS'); // the loud line
      const grantId = /grant:[0-9a-f]{64}/.exec(issued.stdout)?.[0];
      expect(grantId).toBeTruthy();
      const run = await cli(['resolve', 'B', '-m', 'granted window — B is correct', '--native', '--json'], { agent: 'B' });
      expect(run.code).toBe(0);
      const result = JSON.parse(run.stdout) as { strand: Strand };
      expect(result.strand.underGrant).toBe(grantId);
      expect(result.strand.authoredBy?.agentId).toBe('B');
      expect(result.strand.sig?.principal).toBe('B');
      const report = verifyFabric(root);
      expect(report.failures).toEqual([]);
      expect(runFsck(root).ok).toBe(true);
    },
    120_000,
  );

  it.skipIf(!haveDist)(
    'ARM 3 + ARM 5 — revoked and expired grants refuse on the CLI gate exactly like no-grant',
    async () => {
      // revoke the arm-2 grant (human shell, by prefix)…
      const listed = await cli(['grant', 'list', '--json']);
      const active = (JSON.parse(listed.stdout) as { grants: Array<{ grantId: string; status: string }> }).grants.find(
        (g) => g.status === 'active',
      );
      expect(active).toBeTruthy();
      const revoked = await cli(['grant', 'revoke', active!.grantId.slice(0, 'grant:'.length + 12)]);
      expect(revoked.code).toBe(0);
      // …then an expired grant on top (issued 2 days back, ttl 24h)
      issueGrant(root, { now: new Date(Date.now() - 2 * 86_400_000).toISOString(), ttlMs: 86_400_000 });
      const run = await cli(['resolve', 'B', '-m', 'after revoke+expiry', '--native'], { agent: 'B' });
      const expected = checkHumanClass({ cliPath: 'resolve', env: { [AGENT_ID_ENV]: 'B' } as NodeJS.ProcessEnv })!;
      expect(refusalOfRun(run)).toEqual(JSON.parse(JSON.stringify(agentShellRefusal())));
      expect(run.stderr).toContain(expected.message);
      expect(run.code).toBe(2);
      // an UNMARKED (human) shell is untouched by all of it: same command, no
      // marker → the engine runs. B needs a live sealed proposal again (arm 2's
      // resolve cleared the scratch) — fork + propose, no admit needed.
      forkNative(root, 'B', { into: dirB });
      write(dirB, MOD, fs.readFileSync(path.join(dirB, MOD), 'utf8').replace('return 999', 'return 2000'));
      await proposeNative(root, { worktree: dirB, agentId: 'B', intent: 'B: foo=2000' });
      const humanRun = await cli(['resolve', 'B', '-m', 'human resolves after revocation', '--native', '--json']);
      expect(humanRun.code).toBe(0);
      const sealed = JSON.parse(humanRun.stdout) as { strand: Strand };
      expect(sealed.strand.underGrant).toBeUndefined(); // human-acted — presumed-human residue, no grant named
      expect(verifyFabric(root).failures).toEqual([]);
    },
    120_000,
  );
});
