/**
 * shadow-admit.test — R1 SHADOW GATE (#shadow-gate; native-first loid-loops §1).
 *
 * The shadow invariant: `admit --shadow` runs the FULL decision pipeline (claim
 * gate, verdict, escalation check, coverage, knot-payload build) and mutates
 * NOTHING — fabric, selvage, objects, states, claims, grades are byte-identical
 * before and after; the ONLY write is one row in .warpline/shadow/verdicts.jsonl.
 * Pinned here:
 *   - FAST_ADMIT shadow: row recorded, nothing sealed, .warpline byte-identical
 *   - KNOT shadow: status recorded WITHOUT blocking; no knot payload persisted
 *   - claim shadow: claimReport rides the row; evaluations.jsonl NOT appended
 *   - row shape: the shadowVerdict:v1 key set is stable (G1)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { recordPick } from '../src/fabric/pick.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { shadowAdmit, readShadowVerdicts, shadowVerdictsPathOf, SHADOW_ROW_CAP } from '../src/fabric/shadow.js';
import { createClaim, persistClaim, evaluationsPathOf } from '../src/fabric/claim.js';
import { warplineDirOf, readSelvage, readFabric } from '../src/fabric/fabric.js';

const execFileAsync = promisify(execFile);
const MOD = 'src/mod.ts';

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'shadow@warpline.test');
    await r.git('config', 'user.name', 'Warpline Shadow');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...a: string[]): Promise<string> =>
    (await execFileAsync('git', a, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async write(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, body, 'utf8');
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  async branch(name: string, rel: string, body: string): Promise<void> {
    await this.git('checkout', '-q', 'base');
    await this.git('checkout', '-q', '-b', name);
    await this.write(rel, body);
    await this.commitAll(name);
  }
  destroy = (): Promise<void> => fsp.rm(this.dir, { recursive: true, force: true });
}

/** sha256 of every file under .warpline, path→hash — EXCLUDING the shadow dir. */
function warplineDigest(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const wdir = warplineDirOf(root);
  const walk = (dir: string, rel: string): void => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (r === 'shadow') continue; // the one permitted write
      const full = path.join(dir, name);
      const st = fs.lstatSync(full);
      if (st.isDirectory()) walk(full, r);
      else if (st.isFile()) out.set(r, createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  };
  walk(wdir, '');
  return out;
}

describe('R1 shadow gate — full pipeline, zero mutation', () => {
  let repo: Repo;

  beforeAll(async () => {
    repo = await Repo.create('warpline-shadow-');
    await repo.write('.gitignore', '.warpline/\n');
    await repo.write(MOD, 'export function foo() { return 1; }\nexport function bar() { return 2; }\n');
    await repo.commitAll('base');
    await repo.branch('branchA', MOD, 'export function foo() { return 10; }\nexport function bar() { return 2; }\n');
    await repo.branch('branchB', MOD, 'export function foo() { return 20; }\nexport function bar() { return 2; }\n');
    await repo.git('checkout', '-q', 'base');
    // genesis on base — the selvage every shadow verdict is judged against.
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('FAST_ADMIT shadow: row recorded, fabric/selvage/objects byte-identical', async () => {
    const root = repo.dir;
    const before = warplineDigest(root);
    const fabricBefore = readFabric(warplineDirOf(root)).length;

    const { result, row } = await shadowAdmit(root, { cwd: root, agentId: 'shadow-A', ref: 'branchA' });

    expect(result.sealed).toBe(false);
    expect(row.status).toBe('FAST_ADMIT');
    expect(row.wouldSeal).toBe(true);
    expect(row.agentId).toBe('shadow-A');
    expect(row.ref).toBe('branchA');
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
    expect(row.agentChanged.length).toBeGreaterThan(0);

    // ZERO MUTATION: every non-shadow byte under .warpline is identical.
    const after = warplineDigest(root);
    expect(Object.fromEntries(after)).toEqual(Object.fromEntries(before));
    expect(readFabric(warplineDirOf(root)).length).toBe(fabricBefore);

    // The one write: exactly one row, parseable, schema-tagged.
    const rows = readShadowVerdicts(root);
    expect(rows).toHaveLength(1);
    expect(rows[0].schemaVersion).toBe('shadowVerdict:v1');
  }, 120_000);

  it('KNOT shadow: records the verdict without blocking; persists NO payload', async () => {
    const root = repo.dir;
    // Concurrency: agent K forked at genesis; the selvage then advances to branchA.
    forkScratch(root, 'K');
    await recordPick(root, { cwd: root, ref: 'branchA', intent: 'advance to A' });
    const before = warplineDigest(root);
    const selvageBefore = readSelvage(warplineDirOf(root));

    const { result, row } = await shadowAdmit(root, { cwd: root, agentId: 'K', ref: 'branchB' });

    expect(row.status).toBe('KNOT');
    expect(result.sealed).toBe(false);
    expect(row.knots.length).toBeGreaterThan(0);
    expect(row.knots.join(',')).toContain('foo');
    expect(row.wouldSeal).toBe(false);
    // The payload was BUILT (pipeline exercised) but never persisted.
    expect(row.knotPayloadId).toBeDefined();
    expect(fs.existsSync(path.join(warplineDirOf(root), 'knots'))).toBe(false);

    // Nothing moved; the scratch survives for the real admit.
    expect(readSelvage(warplineDirOf(root))).toBe(selvageBefore);
    const after = warplineDigest(root);
    expect(Object.fromEntries(after)).toEqual(Object.fromEntries(before));
  }, 120_000);

  it('claim shadow: claimReport rides the row; the REAL calibration stream is untouched', async () => {
    const root = repo.dir;
    // A deliberately-too-narrow claim (nothing claimed, foo changed) ⇒ breach.
    const claim = createClaim({ agentId: 'K', claimedSymbols: ['#not-a-real-symbol'], intent: 'narrow claim' });
    persistClaim(root, claim);
    const before = warplineDigest(root);

    const { result, row } = await shadowAdmit(root, { cwd: root, agentId: 'K', ref: 'branchB', claim: claim.claimId });

    expect(row.status).toBe('CLAIM-BREACH');
    expect(row.claimReport).toBeDefined();
    expect(row.claimReport!.claimId).toBe(claim.claimId);
    expect(row.claimReport!.breach).toBe(true);
    expect(row.claimReport!.excess.length).toBeGreaterThan(0);
    expect(result.sealed).toBe(false);
    // The shadow judgment never lands in claims/evaluations.jsonl.
    expect(fs.existsSync(evaluationsPathOf(root))).toBe(false);
    const after = warplineDigest(root);
    expect(Object.fromEntries(after)).toEqual(Object.fromEntries(before));
  }, 120_000);

  it('row shape is stable (shadowVerdict:v1 key set — G1; totals additive per T-2026-07-17-007)', () => {
    const rows = readShadowVerdicts(repo.dir);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const CORE = [
      'schemaVersion', 'ts', 'ref', 'agentId', 'status', 'confidence', 'knots',
      'agentChanged', 'otherChanged', 'knotsTotal', 'agentChangedTotal', 'otherChangedTotal',
      'coverage', 'wouldSeal', 'proposedStateId', 'durationMs',
      // C-9 (2026-08-01): CORE, not OPTIONAL. shadowAdmit runs the GIT-ERA
      // admit, which resolves a base on every path, so every row minted from
      // here on names the pointer that base came from. Rows written before the
      // field existed simply lack it (G1 additive) — this pin governs new rows.
      'baseFrom',
      // #git-counterfactual: CORE for the same reason. Every verdict records
      // WHAT GIT WOULD HAVE DECIDED, and a row that simply omits the field is
      // the exact ambiguity baseFrom exists to kill — "git said clean" and "we
      // never asked git" are opposite facts. Rows written before the field
      // existed lack it (G1 additive); this pin governs new rows.
      'gitCounterfactual',
    ];
    const OPTIONAL = ['escalation', 'claimReport', 'knotPayloadId'];
    for (const row of rows) {
      const keys = Object.keys(row);
      for (const k of CORE) expect(keys).toContain(k);
      for (const k of keys) expect([...CORE, ...OPTIONAL]).toContain(k);
      // …and `unavailable` is REQUIRED inside it, present even when git decided.
      expect(Object.keys(row.gitCounterfactual!)).toContain('unavailable');
    }
    expect(fs.existsSync(shadowVerdictsPathOf(repo.dir))).toBe(true);
  });

  it('row bounds (T-2026-07-17-007): symbol arrays cap at SHADOW_ROW_CAP; totals stay exact; under-cap keeps full fidelity', async () => {
    const root = repo.dir;
    // 60 fresh exported functions — an over-cap agentChanged set.
    const many = Array.from(
      { length: 60 },
      (_, i) => `export function gen${String(i).padStart(2, '0')}() { return ${i}; }`,
    ).join('\n');
    await repo.branch('branchMany', 'src/many.ts', many + '\n');
    await repo.git('checkout', '-q', 'base');

    const { row } = await shadowAdmit(root, { cwd: root, agentId: 'K', ref: 'branchMany' });

    expect(row.agentChangedTotal!).toBeGreaterThanOrEqual(60);
    expect(row.agentChanged).toHaveLength(SHADOW_ROW_CAP); // bounded
    expect(row.agentChanged).toEqual([...row.agentChanged].sort()); // deterministic top-N
    // Under-cap arrays keep full symbol fidelity; totals equal lengths exactly.
    expect(row.knots.length).toBeLessThanOrEqual(SHADOW_ROW_CAP);
    expect(row.knotsTotal).toBe(row.knots.length);
    expect(row.otherChanged.length).toBeLessThanOrEqual(SHADOW_ROW_CAP);
    expect(row.otherChangedTotal).toBe(row.otherChanged.length);
    // The row is small even though the verdict touched 60+ symbols.
    expect(JSON.stringify(row).length).toBeLessThan(8_000);
  }, 120_000);
});
