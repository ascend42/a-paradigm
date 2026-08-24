/**
 * fsck.test — M3-lite I5: `warpline fsck`, the integrity umbrella
 * (m3-integrity-design-2026-08-23.md §3 + §6).
 *
 * runFsck aggregates the EXISTING checks — verifyFabric (fabric/refs/registry-
 * boundary/stakes) + ObjectStore.verify (objects) + readKeyRegistry/
 * listKeySummaries diagnostics (registry) — into five sections. What this file
 * drives:
 *
 *   - a healthy SIGNED fabric → every section ok, overall ok, CLI exit 0;
 *   - each tamper class fails the RIGHT section:
 *       chain byte-flip        → fabric (pickId-mismatch)
 *       sig strip              → fabric (sig-missing)
 *       loose-object byte-flip → objects (corrupt-object)
 *       garbled registry row   → registry FAIL (tamper evidence in an
 *                                append-only file — fsck's rule)
 *       missing key FILE       → registry WARN only, overall STILL ok (a
 *                                verifier box may hold no private keys)
 *       unknown signed-from    → registry FAIL (registry-invalid routed there;
 *                                the fabric section stays ok)
 *   - an epoch-less legacy repo → ok, with 'signing epoch: none' noted;
 *   - CLI: exit 0/1, --json parses to the same report shape.
 *
 * NEVER against the live fabric — scratch tmp roots only; CLI spawns pass an
 * explicit `--root` (isolation law + D-7).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { recordPick } from '../src/fabric/pick.js';
import { warplineDirOf } from '../src/fabric/fabric.js';
import { runFsck } from '../src/fabric/fsck.js';
import type { FsckReport } from '../src/fabric/fsck.js';
import type { Strand } from '../src/fabric/strand.js';
import {
  mintAgentKey,
  generateAgentKey,
  agentKeyPathOf,
  keyRegistryPathOf,
  KEY_REGISTRY_SCHEMA,
} from '../src/fabric/keys.js';
import { AGENT_ID_ENV } from '../src/agent-shell.js';

const NOW = '2026-08-23T00:00:00.000Z';

const execFileAsync = promisify(execFile);
const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));
const haveDist = existsSync(distCli);

function writePurpose(root: string, components: string): void {
  fs.writeFileSync(
    path.join(root, '.purpose'),
    `version: "2.0"\ndescription: I5 fixture\ncomponents:\n${components}`,
    'utf8',
  );
}

const A = '  alpha:\n    description: A\n    type: module\n';
const B = A + '  beta:\n    description: B\n    type: cli\n';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-fsck-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Mutate the TAIL strand's JSON row in fabric.jsonl (verify-sig.test idiom). */
function mutateTail(r: string, fn: (s: Strand) => void): void {
  const p = path.join(warplineDirOf(r), 'fabric.jsonl');
  const lines = fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim());
  const tail = JSON.parse(lines[lines.length - 1]) as Strand;
  fn(tail);
  lines[lines.length - 1] = JSON.stringify(tail);
  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
}

/** genesis (agent-class, PRE-epoch) → mint alice (pins boundary) → signed seal. */
async function sealSignedFabric(r: string): Promise<Strand> {
  writePurpose(r, A);
  await recordPick(r, { cwd: r, intent: 'genesis', actor: 'alice', agentId: 'alice', now: NOW });
  mintAgentKey(r, 'alice', { now: NOW });
  writePurpose(r, B);
  const res = await recordPick(r, { cwd: r, intent: 'add beta', actor: 'alice', agentId: 'alice', now: NOW });
  return res.strand!;
}

const failKinds = (report: FsckReport, section: keyof FsckReport['sections']): string[] =>
  report.sections[section].findings.filter((f) => f.level === 'fail').map((f) => f.kind);

describe('I5 — runFsck on a healthy signed fabric', () => {
  it('every section ok, overall ok, honest notes', async () => {
    await sealSignedFabric(root);
    const report = runFsck(root);
    expect(report.ok).toBe(true);
    for (const [name, section] of Object.entries(report.sections)) {
      expect(section.ok, `section ${name}`).toBe(true);
      expect(section.findings.filter((f) => f.level === 'fail'), `section ${name} fail findings`).toEqual([]);
    }
    expect(report.sections.fabric.notes.join('\n')).toContain('signing epoch from');
    expect(report.sections.objects.notes.join('\n')).toMatch(/\d+ loose object\(s\) re-hashed/);
    // stakes: reuse-only — the absent grades cross-check is SAID, not silent
    expect(report.sections.stakes.notes.join('\n')).toContain('grades');
  });
});

describe('I5 — each tamper class fails the RIGHT section', () => {
  it('chain byte-flip → fabric section fails (pickId-mismatch)', async () => {
    await sealSignedFabric(root);
    mutateTail(root, (s) => {
      (s as { intent: string }).intent = 'tampered intent';
    });
    const report = runFsck(root);
    expect(report.ok).toBe(false);
    expect(report.sections.fabric.ok).toBe(false);
    expect(failKinds(report, 'fabric')).toContain('pickId-mismatch');
    // the tamper is in the LEDGER, not the store or registry
    expect(report.sections.objects.ok).toBe(true);
    expect(report.sections.registry.ok).toBe(true);
  });

  it('sig strip → fabric section fails (sig-missing)', async () => {
    await sealSignedFabric(root);
    mutateTail(root, (s) => {
      delete s.sig;
    });
    const report = runFsck(root);
    expect(report.ok).toBe(false);
    expect(failKinds(report, 'fabric')).toEqual(['sig-missing']);
    expect(report.sections.registry.ok).toBe(true);
    expect(report.sections.objects.ok).toBe(true);
  });

  it('loose-object byte-flip → objects section fails (corrupt-object)', async () => {
    await sealSignedFabric(root);
    // corrupt the first loose blob on disk (fabric's binding walk will ALSO see
    // it — the store tamper honestly fails both custody surfaces)
    const blobsDir = path.join(warplineDirOf(root), 'objects', 'blobs');
    const aa = fs.readdirSync(blobsDir)[0]!;
    const rest = fs.readdirSync(path.join(blobsDir, aa))[0]!;
    fs.writeFileSync(path.join(blobsDir, aa, rest), Buffer.from('garbage — not zlib'));
    const report = runFsck(root);
    expect(report.ok).toBe(false);
    expect(report.sections.objects.ok).toBe(false);
    expect(failKinds(report, 'objects')).toEqual(['corrupt-object']);
  });

  it('garbled registry row → registry section FAILS (tamper evidence)', async () => {
    await sealSignedFabric(root);
    fs.appendFileSync(keyRegistryPathOf(root), 'garbage line\n', 'utf8');
    const report = runFsck(root);
    expect(report.ok).toBe(false);
    expect(report.sections.registry.ok).toBe(false);
    expect(failKinds(report, 'registry')).toEqual(['registry-malformed-row']);
    // the fabric itself is untouched — only the registry section fails
    expect(report.sections.fabric.ok).toBe(true);
  });

  it('missing key FILE → registry WARN only; overall STILL ok', async () => {
    await sealSignedFabric(root);
    fs.rmSync(agentKeyPathOf(root, 'alice')); // the private half vanishes
    const report = runFsck(root);
    expect(report.ok).toBe(true); // a warning never fails fsck
    expect(report.sections.registry.ok).toBe(true);
    const warns = report.sections.registry.findings.filter((f) => f.level === 'warn');
    expect(warns.map((f) => f.kind)).toEqual(['key-file-missing']);
    expect(warns[0]!.message).toContain('alice');
  });

  it('unknown signed-from pickId → registry section fails (registry-invalid); fabric section stays ok', async () => {
    writePurpose(root, A);
    await recordPick(root, { cwd: root, intent: 'genesis', actor: 'alice', agentId: 'alice', now: NOW });
    const key = generateAgentKey();
    const bogus = 'pick:v2:' + 'de'.repeat(32);
    fs.mkdirSync(path.dirname(keyRegistryPathOf(root)), { recursive: true });
    fs.writeFileSync(
      keyRegistryPathOf(root),
      JSON.stringify({
        schemaVersion: KEY_REGISTRY_SCHEMA,
        kind: 'agent-key',
        keyId: key.keyId,
        principal: 'alice',
        publicKeyPem: key.publicKeyPem,
        createdAt: NOW,
      }) +
        '\n' +
        JSON.stringify({
          schemaVersion: KEY_REGISTRY_SCHEMA,
          kind: 'signed-from',
          signedFromPickId: bogus,
          createdAt: NOW,
        }) +
        '\n',
      'utf8',
    );
    const report = runFsck(root);
    expect(report.ok).toBe(false);
    expect(report.sections.registry.ok).toBe(false);
    expect(failKinds(report, 'registry')).toContain('registry-invalid');
    // the ROUTING is the point: the fabric walk stood down cleanly
    expect(report.sections.fabric.ok).toBe(true);
    expect(failKinds(report, 'fabric')).toEqual([]);
  });

  it('extra signed-from rows → WARN noted, overall still ok', async () => {
    await sealSignedFabric(root);
    fs.appendFileSync(
      keyRegistryPathOf(root),
      JSON.stringify({
        schemaVersion: KEY_REGISTRY_SCHEMA,
        kind: 'signed-from',
        signedFromPickId: null,
        createdAt: NOW,
      }) + '\n',
      'utf8',
    );
    const report = runFsck(root);
    expect(report.ok).toBe(true); // ignored by design — the first pin is authoritative
    const warns = report.sections.registry.findings.filter((f) => f.level === 'warn');
    expect(warns.map((f) => f.kind)).toEqual(['signed-from-duplicate']);
  });
});

describe('I5 — the epoch-less legacy world stays green', () => {
  it("no keys ever minted → fsck ok with 'signing epoch: none' noted", async () => {
    writePurpose(root, A);
    await recordPick(root, { cwd: root, intent: 'genesis', actor: 'alice', agentId: 'alice', now: NOW });
    writePurpose(root, B);
    await recordPick(root, { cwd: root, intent: 'add beta', actor: 'alice', agentId: 'alice', now: NOW });
    const report = runFsck(root);
    expect(report.ok).toBe(true);
    expect(report.sections.fabric.notes.join('\n')).toContain('signing epoch: none');
    expect(report.sections.registry.notes.join('\n')).toContain('no key registry');
  });
});

/* ── the CLI boundary — real spawns against dist/cli.js ─────────────────────── */

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

const cli = async (r: string, args: string[]): Promise<Run> => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env[AGENT_ID_ENV];
  delete env.WARPLINE_F4_RUN_ID;
  try {
    const { stdout, stderr } = await execFileAsync('node', [distCli, ...args, '--root', r], {
      cwd: r,
      encoding: 'utf8',
      env,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
};

describe('I5 — `warpline fsck` at the CLI boundary', () => {
  it.skipIf(!haveDist)(
    'healthy signed fabric → exit 0, per-section PASS lines',
    async () => {
      await sealSignedFabric(root);
      const run = await cli(root, ['fsck']);
      expect(run.code, run.stderr).toBe(0);
      expect(run.stdout).toContain('FSCK     ok');
      for (const name of ['fabric', 'objects', 'refs', 'registry', 'stakes']) {
        expect(run.stdout).toMatch(new RegExp(`${name}\\s+PASS`));
      }
    },
    120_000,
  );

  it.skipIf(!haveDist)(
    'tampered ledger → exit 1, the failing section says FAIL with a finding line',
    async () => {
      await sealSignedFabric(root);
      mutateTail(root, (s) => {
        delete s.sig;
      });
      const run = await cli(root, ['fsck']);
      expect(run.code).toBe(1);
      expect(run.stdout).toContain('FSCK     FAILED');
      expect(run.stdout).toMatch(/fabric\s+FAIL/);
      expect(run.stdout).toContain('sig-missing');
    },
    120_000,
  );

  it.skipIf(!haveDist)(
    '--json parses to the runFsck shape (exit still 1 on failure — fsck contract)',
    async () => {
      await sealSignedFabric(root);
      const green = await cli(root, ['fsck', '--json']);
      expect(green.code, green.stderr).toBe(0);
      const greenReport = JSON.parse(green.stdout) as FsckReport;
      expect(greenReport.ok).toBe(true);
      expect(Object.keys(greenReport.sections).sort()).toEqual(['fabric', 'objects', 'refs', 'registry', 'stakes']);

      fs.appendFileSync(keyRegistryPathOf(root), 'garbage line\n', 'utf8');
      const red = await cli(root, ['fsck', '--json']);
      expect(red.code).toBe(1);
      const redReport = JSON.parse(red.stdout) as FsckReport;
      expect(redReport.ok).toBe(false);
      expect(redReport.sections.registry.ok).toBe(false);
      expect(redReport.sections.registry.findings.map((f) => f.kind)).toContain('registry-malformed-row');
    },
    120_000,
  );
});
