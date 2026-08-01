/**
 * backup.test — PHASE 1 close-out (#warpline-backup): the custodianship valve.
 *
 * Pinned here:
 *   E2E        back up a fixture fabric → verify (digests + full fabric
 *              authentication) green → OPEN THE BACKUP AS A FABRIC (the restore
 *              path is the engine itself: propose/admit run against the backup
 *              root and verifyFabric stays green).
 *   TAMPER     flip one byte inside the backup → `backup verify` fails
 *              (digest-mismatch), an added file → `extra`, a removed file →
 *              `missing`.
 *   SECRETS    daemon-tokens.jsonl / daemon.pid / daemon.sock / refs/.lock
 *              never enter a backup (D5 never-leaves-the-box discipline).
 *   DAEMON     `backup` rides the daemon as a HUMAN-CLASS verb: agent tokens
 *              and read-scoped (console) tokens are FORBIDDEN.
 *   SCOPE      the read-only verb ceiling for scope:'read' tokens — every
 *              write verb refused, every read verb allowed (adversarial
 *              matrix); consoleReadToken() only ever surfaces read-scoped rows.
 *
 * FIXTURES ONLY — never the live repo fabric (hard rule).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { forkNative, proposeNative, admitNative } from '../src/fabric/native.js';
import { backupFabric, verifyBackup, BACKUP_MANIFEST_BASENAME, type BackupManifest } from '../src/fabric/backup.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { listRefs } from '../src/fabric/refs.js';
import { warplineDirOf } from '../src/fabric/fabric.js';
import { startDaemon, readDaemonAudit, type DaemonHandle } from '../src/daemon/server.js';
import { mintToken, readTokens, consoleReadToken, tokensPathOf } from '../src/daemon/tokens.js';
import { DaemonClient, DaemonRpcError } from '../src/daemon/client.js';
import { READ_ONLY_VERBS, DAEMON_VERBS } from '../src/daemon/protocol.js';
import { pidPathOf } from '../src/daemon/lifecycle.js';

const MOD = 'src/mod.ts';
const BASE = 'export function foo() { return 1; }\nexport function bar() { return 2; }\n';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

function walkFiles(dir: string, sub = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkFiles(dir, rel));
    else out.push(rel);
  }
  return out;
}

/** Seed a two-strand fabric (genesis FF + edit FF) at a fresh fixture root. */
async function seedFabric(root: string): Promise<void> {
  write(root, MOD, BASE);
  forkNative(root, 'agent-x');
  await proposeNative(root, { worktree: root, agentId: 'agent-x', actor: 'agent-x', intent: 'genesis' });
  await admitNative(root, { worktree: root, agentId: 'agent-x', actor: 'agent-x', noRestore: true });
  write(root, MOD, BASE.replace('return 1', 'return 10'));
  await proposeNative(root, { worktree: root, agentId: 'agent-x', actor: 'agent-x', intent: 'foo → 10' });
  await admitNative(root, { worktree: root, agentId: 'agent-x', actor: 'agent-x', noRestore: true });
}

async function rejectsWith(p: Promise<unknown>, code: string): Promise<DaemonRpcError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(DaemonRpcError);
    expect((err as DaemonRpcError).code).toBe(code);
    return err as DaemonRpcError;
  }
  throw new Error(`expected a DaemonRpcError(${code}) rejection, got a resolution`);
}

describe('#warpline-backup — snapshot, verify, tamper, restore-by-opening', () => {
  let root: string;
  let out: string; // parent dir for backup destinations

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wlb-src-'));
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'wlb-out-'));
    await seedFabric(root);
    // Plant daemon-runtime residue so the exclusion rules have something to exclude.
    mintToken(root, 'operator', 'human');
    fs.writeFileSync(pidPathOf(root), '{"fake":"pid"}', 'utf8');
    fs.writeFileSync(path.join(warplineDirOf(root), 'daemon.sock'), 'not-a-socket', 'utf8');
  });
  afterAll(() => {
    for (const d of [root, out]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('backs up the fabric, the manifest accounts for every byte, and verify is green', async () => {
    const dest = path.join(out, 'b1');
    const result = await backupFabric(root, dest);

    expect(fs.existsSync(result.manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')) as BackupManifest;
    expect(manifest.schemaVersion).toBe('warplineBackup:v1');
    expect(manifest.files.length).toBe(result.counts.files);
    expect(result.counts.ledgerRows).toBe(2); // genesis + edit
    expect(result.counts.refs).toBeGreaterThanOrEqual(1); // selvage
    expect(result.counts.objects).toBeGreaterThan(0);
    expect(result.selvage).toBe(listRefs(warplineDirOf(root)).get('selvage'));

    const report = verifyBackup(dest);
    expect(report.problems).toEqual([]);
    expect(report.fabric?.failures).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('EXCLUDES the never-leaves-the-box set: tokens, pidfile, socket, lockfile', () => {
    const destW = path.join(out, 'b1', '.warpline');
    const files = walkFiles(destW);
    expect(fs.existsSync(tokensPathOf(root))).toBe(true); // present at the SOURCE…
    expect(files).not.toContain('daemon-tokens.jsonl'); // …absent from the backup
    expect(files).not.toContain('daemon.pid');
    expect(files).not.toContain('daemon.sock');
    expect(files.filter((f) => f.startsWith('refs/.lock'))).toEqual([]);
    // and the ledger + refs + objects ARE there
    expect(files).toContain('fabric.jsonl');
    expect(files.some((f) => f.startsWith('refs/'))).toBe(true);
    expect(files.some((f) => f.startsWith('objects/'))).toBe(true);
  });

  it('refuses an existing dest and a dest inside the source fabric', async () => {
    await expect(backupFabric(root, path.join(out, 'b1'))).rejects.toThrow(/already exists/);
    await expect(backupFabric(root, path.join(warplineDirOf(root), 'self-backup'))).rejects.toThrow(/inside the source fabric/);
  });

  it('TAMPER: a flipped byte fails verify; an added file is `extra`; a removed file is `missing`', async () => {
    const dest = path.join(out, 'b2');
    await backupFabric(root, dest);
    expect(verifyBackup(dest).ok).toBe(true);

    // flip one byte inside an object (same size ⇒ the DIGEST catches it)
    const objects = walkFiles(path.join(dest, '.warpline'))
      .filter((f) => f.startsWith('objects/'))
      .map((f) => path.join(dest, '.warpline', f));
    const victim = objects.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
    const bytes = fs.readFileSync(victim);
    bytes[bytes.length - 1] ^= 0xff;
    fs.writeFileSync(victim, bytes);

    const tampered = verifyBackup(dest);
    expect(tampered.ok).toBe(false);
    expect(tampered.problems.some((p) => p.kind === 'digest-mismatch')).toBe(true);

    // restore the byte — green again — then add + remove files
    bytes[bytes.length - 1] ^= 0xff;
    fs.writeFileSync(victim, bytes);
    expect(verifyBackup(dest).ok).toBe(true);

    fs.writeFileSync(path.join(dest, '.warpline', 'planted.jsonl'), '{"not":"mine"}\n', 'utf8');
    const extra = verifyBackup(dest);
    expect(extra.ok).toBe(false);
    expect(extra.problems.some((p) => p.kind === 'extra' && p.path === '.warpline/planted.jsonl')).toBe(true);
    fs.unlinkSync(path.join(dest, '.warpline', 'planted.jsonl'));

    fs.unlinkSync(victim);
    const missing = verifyBackup(dest);
    expect(missing.ok).toBe(false);
    expect(missing.problems.some((p) => p.kind === 'missing')).toBe(true);
  });

  it('THE RESTORE PATH: a backup IS a home-fabric root — opening it with the engine just works', async () => {
    const dest = path.join(out, 'b3');
    await backupFabric(root, dest);

    // identical refs, authenticated history, straight off the backup
    expect(Object.fromEntries(listRefs(path.join(dest, '.warpline')))).toEqual(
      Object.fromEntries(listRefs(warplineDirOf(root))),
    );
    expect(verifyFabric(dest).failures).toEqual([]);

    // and it is ALIVE: a new strand seals against the backup fabric
    write(dest, MOD, BASE.replace('return 1', 'return 10').replace('return 2', 'return 22'));
    forkNative(dest, 'agent-r');
    await proposeNative(dest, { worktree: dest, agentId: 'agent-r', actor: 'agent-r', intent: 'post-restore edit' });
    const admitted = await admitNative(dest, { worktree: dest, agentId: 'agent-r', actor: 'agent-r', noRestore: true });
    expect(admitted.sealed).toBe(true);
    expect(verifyFabric(dest).failures).toEqual([]);
    // the SOURCE fabric is untouched by all of it (snapshot isolation — clones, not hardlinks)
    expect(verifyFabric(root).failures).toEqual([]);
    expect(listRefs(warplineDirOf(root)).get('selvage')).toBe(
      (await backupFabric(root, path.join(out, 'b4'))).selvage,
    );
  });
});

describe('#warplined — backup over the daemon + the read-scope ceiling', () => {
  let root: string;
  let out: string;
  let handle: DaemonHandle;
  let human: DaemonClient;
  let agent: DaemonClient;
  let consoleC: DaemonClient; // scope:'read' console token

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wlb-d-'));
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'wlb-do-'));
    await seedFabric(root);
    const tH = mintToken(root, 'operator', 'human').token;
    const tA = mintToken(root, 'agent-x', 'agent').token;
    const tC = mintToken(root, 'console', 'human', { scope: 'read' }).token;
    handle = await startDaemon(root);
    human = await DaemonClient.connect(root, tH);
    agent = await DaemonClient.connect(root, tA);
    consoleC = await DaemonClient.connect(root, tC);
  });
  afterAll(async () => {
    human?.close();
    agent?.close();
    consoleC?.close();
    await handle?.close();
    for (const d of [root, out]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('backup is a daemon verb — HUMAN-CLASS: human ok, agent FORBIDDEN, console FORBIDDEN', async () => {
    const dest = path.join(out, 'via-daemon');
    const result = await human.backup(dest);
    expect(result.counts.ledgerRows).toBe(2);
    expect(verifyBackup(dest).ok).toBe(true);

    await rejectsWith(agent.backup(path.join(out, 'agent-try')), 'FORBIDDEN');
    await rejectsWith(consoleC.backup(path.join(out, 'console-try')), 'FORBIDDEN');
    expect(fs.existsSync(path.join(out, 'agent-try'))).toBe(false);
    expect(fs.existsSync(path.join(out, 'console-try'))).toBe(false);
  });

  it('ADVERSARIAL: a read-scoped token is refused on EVERY non-read verb, allowed on every read verb', async () => {
    // the ceiling is the allowlist — derive the write set from the protocol
    const writeVerbs = DAEMON_VERBS.filter((v) => !READ_ONLY_VERBS.includes(v));
    // The literal is the REVIEWER's tripwire: the loop below is derived, so a
    // new write verb is refused automatically — but silently. C-10's `abandon`
    // clears a ref, so it belongs here and must be visibly accounted for.
    expect(writeVerbs).toEqual(['fork', 'propose', 'admit', 'abandon', 'resolve', 'stake', 'stake.recover', 'backup']);
    expect(writeVerbs).toContain('abandon');
    for (const verb of writeVerbs) {
      const err = await rejectsWith(consoleC.call(verb, { intent: 'x', agentId: 'y', reason: 'z', commit: 'c', dest: path.join(out, 'nope') }), 'FORBIDDEN');
      expect(err.message).toContain('read scope');
    }
    // every refusal is audited with the resolved principal
    const audit = readDaemonAudit(root);
    for (const verb of writeVerbs) {
      expect(audit.some((r) => r.verb === verb && r.principal === 'console' && !r.ok && r.code === 'FORBIDDEN')).toBe(true);
    }

    // reads all pass (knot.show legitimately 404s on a knot-less fabric)
    const status = await consoleC.status();
    expect(status.principal).toBe('console');
    expect(status.scope).toBe('read');
    const refs = await consoleC.refsList();
    expect(refs.heads.length).toBeGreaterThan(0);
    const tail = await consoleC.shadowTail(5);
    expect(tail.total).toBe(0);
    const grade = await consoleC.gradeReport();
    expect(grade).toBeTruthy();
    await rejectsWith(consoleC.knotShow('does-not-exist'), 'NOT_FOUND');
  });

  it('consoleReadToken() surfaces ONLY the read-scoped console row — never a full-power token', () => {
    const tok = consoleReadToken(root);
    expect(tok).toBeTruthy();
    const rows = readTokens(root);
    const match = rows.find((r) => r.token === tok);
    expect(match?.principal).toBe('console');
    expect(match?.scope).toBe('read');
    // full-power rows exist at the source but are never returned
    expect(rows.some((r) => r.principal === 'operator' && r.scope === undefined)).toBe(true);
    expect(rows.find((r) => r.principal === 'operator')?.token).not.toBe(tok);
  });

  it('fails closed on unknown token scopes: minting refuses, an alien row never resolves', () => {
    expect(() => mintToken(root, 'weird', 'human', { scope: 'write' as never })).toThrow(/scope must be 'read'/);
    // plant a forged row with an unrecognized scope — readTokens must skip it
    const forged = { schemaVersion: 'daemonToken:v1', token: 'f'.repeat(64), principal: 'forged', kind: 'human', createdAt: new Date().toISOString(), scope: 'admin' };
    fs.appendFileSync(tokensPathOf(root), JSON.stringify(forged) + '\n', 'utf8');
    expect(readTokens(root).some((r) => r.principal === 'forged')).toBe(false);
  });
});
