/**
 * fabric-schema-migration.test — the v1→v2 boundary over the REAL dogfood fabric
 * (§6.5 + §7). The on-disk ledger was sealed under two retired rules and #grade
 * overwrote a hashed field for the oldest strands, so:
 *   - seq 0 (whole-body rule) + seq 8–14 (exclusion rule) re-verify via known rules;
 *   - seq 1–7 (graded-over) classify legacy-unverifiable (soft, grandfathered);
 *   - overall exit 0.
 * And sealing the FIRST v2 strand on top anchors the v1 tip (parentPickId == tip
 * pickId; boundaryAnchored:true) — full-chain authentication begins there.
 *
 * HERMETICITY: these assertions are about the ORIGINAL v1 prefix (seq 0–14). The
 * live repo keeps growing — every commit auto-seals a v2 strand — so the fixture is
 * frozen to the v1-only strands copied out of the real ledger. Real-repo v2 growth
 * (the migration already happened on this repo) must not perturb the counts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { recordPick } from '../src/fabric/pick.js';
import { warplineDirOf, readFabric, readLegacyGrandfathered } from '../src/fabric/fabric.js';
import { verifyFabric } from '../src/fabric/verify.js';

const execFileAsync = promisify(execFile);
const REAL_WDIR = path.join(fileURLToPath(new URL('../../../', import.meta.url)), '.warpline');
const safe = (id: string): string => id.replace(/[^a-zA-Z0-9._-]/g, '_');

/** The original v1 prefix of the real ledger (schemaVersion !== 2), as raw JSONL lines. */
function realV1Lines(): string[] {
  return fs
    .readFileSync(path.join(REAL_WDIR, 'fabric.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter((l) => JSON.parse(l).schemaVersion !== 2);
}

/**
 * Seed a temp .warpline with a FROZEN copy of the real v1 prefix + the legacy
 * grandfather manifest + the object store (so seq 13/14 bindings re-derive). The
 * live ledger's v2 strands are filtered out so the fixture is deterministic. For the
 * seal test, also seed the v1 tip's state + selvage so a pick anchors the real tip.
 * Read-only against the real repo — never mutates it.
 */
function seedRealFabric(root: string, opts: { forSeal?: boolean } = {}): void {
  const wdir = warplineDirOf(root);
  fs.mkdirSync(path.join(wdir, 'refs'), { recursive: true });
  fs.writeFileSync(path.join(wdir, 'fabric.jsonl'), realV1Lines().join('\n') + '\n', 'utf8');
  fs.copyFileSync(path.join(REAL_WDIR, 'fabric-legacy.json'), path.join(wdir, 'fabric-legacy.json'));
  // Bindings (seq 13/14) re-derive against the object store during verify step 4.
  fs.cpSync(path.join(REAL_WDIR, 'objects'), path.join(wdir, 'objects'), { recursive: true });
  if (opts.forSeal) {
    const fabric = readFabric(wdir); // v1-only after the filtered copy above
    const tip = fabric[fabric.length - 1];
    fs.mkdirSync(path.join(wdir, 'states'), { recursive: true });
    fs.copyFileSync(
      path.join(REAL_WDIR, 'states', `${safe(tip.stateId)}.json`),
      path.join(wdir, 'states', `${safe(tip.stateId)}.json`),
    );
    fs.writeFileSync(path.join(wdir, 'refs', 'selvage'), tip.stateId + '\n', 'utf8');
  }
}

describe('migration — the frozen v1 prefix verifies with the grandfathered residue', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-migration-verify-'));
    seedRealFabric(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('verifyFabric over the v1 prefix: seq 0 + 8–14 rule-verify, seq 1–7 grandfathered, exit 0', () => {
    const grandfathered = readLegacyGrandfathered(REAL_WDIR);
    const r = verifyFabric(root);

    expect(r.failures).toEqual([]); // exit-equivalent 0 — no hard tamper
    expect(r.v1Prefix.selfHashOk).toBe(true); // every v1 strand rule-verified OR grandfathered
    // the graded-over residue (seq 1–7) is exactly the grandfathered set
    expect(r.legacyUnverifiable.count).toBe(grandfathered.size);
    expect(r.legacyUnverifiable.count).toBe(7);
    expect(new Set(r.legacyUnverifiable.pickIds)).toEqual(new Set(grandfathered.keys()));
    // the fixture is v1-only by construction, so every checked strand is v1 and no v2 chain exists
    expect(r.checked).toBe(r.v1Prefix.count);
    expect(r.checked).toBe(realV1Lines().length);
    expect(r.v2Chain.count).toBe(0);
  });
});

describe('migration — the first v2 strand anchors the v1 tip', () => {
  let root: string;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-migration-seal-'));
    // A real git repo so a ref pick can absorb + snapshot.
    const git = async (...a: string[]): Promise<void> => {
      await execFileAsync('git', a, { cwd: root, encoding: 'utf8' });
    };
    await git('init', '-q', '-b', 'base');
    await git('config', 'user.email', 'm@warpline.test');
    await git('config', 'user.name', 'Warpline M');
    await git('config', 'commit.gpgsign', 'false');
    await fsp.writeFile(
      path.join(root, '.purpose'),
      'version: "2.0"\ndescription: migration seal fixture\ncomponents:\n  alpha:\n    description: A\n    type: module\n',
      'utf8',
    );
    await git('add', '-A');
    await git('commit', '-q', '-m', 'seed');
    // Seed the frozen v1 prefix + its tip state + object store so the pick anchors the
    // real v1 tip (seq 14) and every pre-existing binding re-derives.
    seedRealFabric(root, { forSeal: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('recordPick seals a v2 strand whose parentPickId == the stored v1 tip pickId', async () => {
    const before = readFabric(warplineDirOf(root));
    const tip = before[before.length - 1];
    expect(tip.schemaVersion).not.toBe(2); // the seeded tip is the v1 tip (seq 14)

    const res = await recordPick(root, { cwd: root, ref: 'HEAD', intent: 'first v2 over the real v1 tip' });
    expect(res.noop).toBe(false);
    expect(res.strand!.schemaVersion).toBe(2);
    expect(res.strand!.parentPickId).toBe(tip.pickId); // anchors the v1 tip for free

    const r = verifyFabric(root);
    expect(r.v2Chain).toEqual({ count: 1, ok: true }); // exactly one v2 strand — the one we just sealed
    expect(r.boundaryAnchored).toBe(true);
    expect(r.failures).toEqual([]); // still exit 0 (v1 residue grandfathered)
  }, 120_000);
});
