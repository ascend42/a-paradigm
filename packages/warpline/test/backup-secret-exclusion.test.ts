/**
 * backup-secret-exclusion.test — C-14 (soundness audit 2026-07-31, Jinx J-11):
 * "the MCP bearer token is copied into every backup".
 *
 * The defect was a rule that could only see DEPTH 1: backup.ts excluded secrets
 * by ROOT BASENAME (`parts.length === 1`), so `.warpline/daemon-tokens.jsonl`
 * was withheld while `.warpline/daemon/mcp.token` — the MCP skin's bearer token,
 * two levels down — was clone-copied into every backup AND hashed into the
 * PUBLISHED manifest. Daemon tokens have no expiry and no revocation
 * (tokens.ts, a recorded stage-1 deferral) and the backup destination is
 * caller-chosen, so a leaked backup was a permanent credential leak against a
 * module header and a CLI help string that both promise "secrets never travel".
 *
 * Pinned here:
 *   LEAK       the token file is absent from the backup at ANY path depth, is
 *              absent from the manifest, and its BYTES appear nowhere under
 *              dest — including in the manifest's own digests/paths.
 *   DEPTH      the same holds for secrets planted deeper than the real ones
 *              (the rule is matched on the full relative path, not a basename
 *              at one fixed depth), and for the `*.token` suffix class.
 *   DENY-LIST  the posture SURVIVES the tightening: an unknown new sidecar —
 *              at the root AND nested in a directory that did not exist before
 *              — is still backed up BY DEFAULT. A test that only proved
 *              exclusion would not notice an accidental flip to an allow-list.
 *   CONTROL    a non-secret marker planted in a backed-up sidecar IS found by
 *              the same byte scan that must not find the token — so the scan
 *              cannot pass vacuously.
 *
 * SECRET DISCIPLINE: no real token is ever minted, printed, or asserted on.
 * The fixture writes an obviously-fake sentinel through the real writer and the
 * assertions are all about its ABSENCE.
 *
 * FIXTURES ONLY — never the live repo fabric (hard rule).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { forkNative, proposeNative, admitNative } from '../src/fabric/native.js';
import { backupFabric, verifyBackup, type BackupManifest } from '../src/fabric/backup.js';
import { warplineDirOf } from '../src/fabric/fabric.js';
import { mcpTokenPathOf, writeMcpTokenFile, tokensPathOf } from '../src/daemon/tokens.js';
import { daemonAuditPathOf } from '../src/daemon/server.js';

const MOD = 'src/mod.ts';
const BASE = 'export function foo() { return 1; }\nexport function bar() { return 2; }\n';

/** NOT a credential — an obviously-fake sentinel whose ABSENCE is the assertion.
 * Nothing in this file ever writes, prints or asserts a real minted token. */
const FAKE_TOKEN = 'FAKE-SENTINEL-NOT-A-REAL-TOKEN-0000000000000000';
/** The positive control: a marker in a file that MUST be backed up, so the
 * byte scan below is proven live rather than trivially satisfied. */
const CONTROL_MARKER = 'CONTROL-MARKER-THIS-SIDECAR-MUST-TRAVEL';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

/** Every file under `dir`, as posix paths relative to it (no exclusions — this
 * is the ADVERSARY's walk, not the backup's, so nothing can hide behind the
 * very rule under test). */
function walkAll(dir: string, sub = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkAll(dir, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** Relative paths of every file under `dir` whose raw bytes contain `needle`. */
function filesContaining(dir: string, needle: string): string[] {
  return walkAll(dir).filter((rel) => fs.readFileSync(path.join(dir, rel)).includes(needle));
}

describe('#warpline-backup — C-14: secrets never travel, at ANY depth', () => {
  let root: string;
  let out: string;
  let dest: string;
  let manifest: BackupManifest;
  let backedUp: string[]; // every file under dest, relative to dest

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wlc14-src-'));
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'wlc14-out-'));

    // a real two-strand fabric so the backup has genuine content to carry
    write(root, MOD, BASE);
    forkNative(root, 'agent-x');
    await proposeNative(root, { worktree: root, agentId: 'agent-x', actor: 'agent-x', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'agent-x', actor: 'agent-x', noRestore: true });

    const wdir = warplineDirOf(root);

    // ── THE C-14 CASE: the MCP bearer token, written by the REAL writer, at the
    // REAL path (.warpline/daemon/mcp.token — depth 2, what the old rule missed).
    writeMcpTokenFile(root, FAKE_TOKEN);
    // …the depth-1 case the old rule DID catch (regression guard)…
    fs.writeFileSync(tokensPathOf(root), JSON.stringify({ token: FAKE_TOKEN, principal: 'x' }) + '\n', 'utf8');
    // …and secrets planted DEEPER still, plus the `*.token` suffix class and the
    // D5-named file that has no writer yet. The rule is full-path, so depth must
    // not matter anywhere.
    write(root, '.warpline/daemon/nested/deep/mcp.token', FAKE_TOKEN + '\n');
    write(root, '.warpline/daemon/daemon-tokens.jsonl', FAKE_TOKEN + '\n');
    write(root, '.warpline/session-keys.jsonl', FAKE_TOKEN + '\n');
    write(root, '.warpline/future/credentials/service.token', FAKE_TOKEN + '\n');

    // ── THE DENY-LIST POSTURE: sidecars nobody registered must still travel.
    write(root, '.warpline/brand-new-sidecar.jsonl', `{"marker":"${CONTROL_MARKER}"}\n`);
    write(root, '.warpline/newthing/rows.jsonl', '{"unregistered":"nested sidecar"}\n');
    // accountability data is explicitly IN scope (module header)
    fs.mkdirSync(path.dirname(daemonAuditPathOf(root)), { recursive: true });
    fs.writeFileSync(daemonAuditPathOf(root), '{"schemaVersion":"daemonAudit:v1"}\n', 'utf8');

    expect(fs.existsSync(mcpTokenPathOf(root))).toBe(true); // present at the SOURCE…
    expect(fs.readFileSync(path.join(wdir, 'daemon', 'mcp.token'), 'utf8')).toContain(FAKE_TOKEN);

    dest = path.join(out, 'snapshot');
    await backupFabric(root, dest);
    manifest = JSON.parse(fs.readFileSync(path.join(dest, 'backup.manifest.json'), 'utf8')) as BackupManifest;
    backedUp = walkAll(dest);
  }, 120_000);

  afterAll(() => {
    for (const d of [root, out]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('the MCP bearer token is absent from the backup TREE at every depth', () => {
    // the exact real path first — the one C-14 named
    expect(backedUp).not.toContain('.warpline/daemon/mcp.token');
    // then the CLASS: nothing anywhere under dest may be a token file
    const tokenish = backedUp.filter((rel) => {
      const base = rel.split('/').pop()!;
      return base.endsWith('.token') || base === 'daemon-tokens.jsonl' || base === 'session-keys.jsonl';
    });
    expect(tokenish).toEqual([]);
  });

  it('the MCP bearer token is absent from the MANIFEST (it was hashed into the published digest)', () => {
    const listed = manifest.files.map((f) => f.path);
    expect(listed).not.toContain('.warpline/daemon/mcp.token');
    expect(listed.filter((p) => p.includes('mcp.token'))).toEqual([]);
    expect(listed.filter((p) => p.includes('token') || p.includes('session-keys'))).toEqual([]);
    // manifest and tree agree — no entry withheld from one and not the other
    expect(manifest.files.length).toBe(backedUp.filter((r) => r !== 'backup.manifest.json').length);
  });

  it('the token BYTES appear nowhere under dest — and the scan proves itself with a control', () => {
    // the control marker rides an UNREGISTERED sidecar: if the scan were broken,
    // this expectation would fail too, so the absence below cannot be vacuous.
    expect(filesContaining(dest, CONTROL_MARKER)).toContain('.warpline/brand-new-sidecar.jsonl');
    // and the secret is nowhere at all — tree, manifest, or anything else
    expect(filesContaining(dest, FAKE_TOKEN)).toEqual([]);
  });

  it('DENY-LIST SURVIVES: unknown sidecars — root AND nested — are still backed up by default', () => {
    // the safe direction: a sidecar added next month travels without anyone
    // registering it. This is what an accidental flip to an ALLOW-list breaks.
    expect(backedUp).toContain('.warpline/brand-new-sidecar.jsonl');
    expect(backedUp).toContain('.warpline/newthing/rows.jsonl');
    expect(manifest.files.map((f) => f.path)).toContain('.warpline/newthing/rows.jsonl');
    // the named inclusions hold too: ledger, refs, objects, daemon audit
    expect(backedUp).toContain('.warpline/fabric.jsonl');
    expect(backedUp).toContain('.warpline/daemon/audit.jsonl');
    expect(backedUp.some((f) => f.startsWith('.warpline/objects/'))).toBe(true);
    expect(backedUp.some((f) => f.startsWith('.warpline/refs/'))).toBe(true);
  });

  it('the tightened backup still verifies green (exclusions are not "missing" files)', () => {
    const report = verifyBackup(dest);
    expect(report.problems).toEqual([]);
    expect(report.fabric?.failures).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
