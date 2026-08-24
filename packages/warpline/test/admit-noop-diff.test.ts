/**
 * admit-noop-diff.test — REGRESSION for the dogfood-surfaced NOOP bug
 * (T-2026-07-04-004, pilot-results.md finding #1).
 *
 * THE CLASS: stateId hashes the DEDUPED essence SET. When a symbol's
 * before-essence AND after-essence both already exist elsewhere in the tree
 * (duplicate bodies — essence is structural identity modulo names), editing
 * that symbol leaves the SET unchanged: absorb(A) and absorb(B) yield an
 * IDENTICAL stateId while diff(A, B) sees the change (it is keyed by
 * stableKey, per symbol). admit's old `proposed.stateId === base.stateId ⇒
 * NOOP` check silently DROPPED such an admission. pick.ts already used the
 * diff as the source of truth; this locks admit to the same rule.
 *
 *   - PRECONDITION: the fixture really is the trap (identical stateIds,
 *     non-empty diff) — if essence semantics ever change and the trap can't
 *     be built this way, the test says so instead of passing vacuously.
 *   - DECISION: admitDecision does NOT return NOOP for the changed symbol.
 *   - PROTOCOL: a full admit() seals the strand (no invisible dropped
 *     admission), while a genuinely unchanged proposal still NOOPs unsealed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { absorb } from '../src/absorb.js';
import { diff } from '../src/sem-delta.js';
import { admitDecision, admit } from '../src/fabric/admit.js';
import { recordPick } from '../src/fabric/pick.js';
import { warplineDirOf, readFabric } from '../src/fabric/fabric.js';
import type { WarpState } from '../src/warp/warp-state.js';

const execFileAsync = promisify(execFile);

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'noop@warpline.test');
    await r.git('config', 'user.name', 'Warpline NOOP');
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
  destroy = (): Promise<void> => fsp.rm(this.dir, { recursive: true, force: true });
}

const MOD = 'src/mod.ts';
// `target` shares its body with twinAlpha; after the edit it shares with
// twinBeta — so BOTH its before- and after-essence exist elsewhere in the
// tree and the deduped essence SET (hence stateId) never moves.
const BASE_SRC = [
  'export function target() { return "alpha"; }',
  'export function twinAlpha() { return "alpha"; }',
  'export function twinBeta() { return "beta"; }',
  '',
].join('\n');
const EDIT_SRC = [
  'export function target() { return "beta"; }',
  'export function twinAlpha() { return "alpha"; }',
  'export function twinBeta() { return "beta"; }',
  '',
].join('\n');

describe('admit NOOP — the diff, not stateId equality, decides (duplicate-essence trap)', () => {
  let repo: Repo;
  let base: WarpState;
  let edited: WarpState;

  beforeAll(async () => {
    repo = await Repo.create('warpline-noop-diff-');
    await repo.write(MOD, BASE_SRC);
    await repo.commitAll('base');
    await repo.git('checkout', '-q', '-b', 'edit');
    await repo.write(MOD, EDIT_SRC);
    await repo.commitAll('edit target alpha->beta');
    await repo.git('checkout', '-q', 'base');

    base = await absorb('base', { cwd: repo.dir });
    edited = await absorb('edit', { cwd: repo.dir });
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('PRECONDITION — the fixture IS the trap: identical stateIds, non-empty diff', () => {
    // The deduped essence set is unchanged (both essences pre-exist elsewhere)…
    expect(edited.stateId).toBe(base.stateId);
    // …while the per-symbol diff sees the real change.
    const d = diff(base, edited);
    expect(d.deltas.size).toBeGreaterThanOrEqual(1);
  });

  it('DECISION — admitDecision does NOT report NOOP for the genuinely changed symbol', () => {
    const d = admitDecision(base, edited, base);
    expect(d.status).not.toBe('NOOP');
    expect(d.status).toBe('FAST_ADMIT'); // selvage has not advanced ⇒ direct admit
    expect(d.agentChanged.length).toBeGreaterThanOrEqual(1);
  });

  it('DECISION — a genuinely unchanged proposal still NOOPs', async () => {
    const again = await absorb('base', { cwd: repo.dir }); // fresh absorb, same meaning
    const d = admitDecision(base, again, base);
    expect(d.status).toBe('NOOP');
  });

  it('PROTOCOL — admit() seals the changed proposal instead of invisibly dropping it', async () => {
    const root = repo.dir;
    await recordPick(root, { cwd: root, ref: 'base', intent: 'genesis' });
    const before = readFabric(warplineDirOf(root)).length;

    // Genuine no-change admit: still a NOOP, nothing sealed.
    const rNoop = await admit(root, { cwd: root, agentId: 'A', ref: 'base' });
    expect(rNoop.decision.status).toBe('NOOP');
    expect(rNoop.sealed).toBe(false);

    // The trap admit: same stateId as base, but the meaning changed — must seal.
    const rEdit = await admit(root, { cwd: root, agentId: 'A', ref: 'edit' });
    expect(rEdit.decision.status).toBe('FAST_ADMIT');
    expect(rEdit.sealed).toBe(true);
    expect(readFabric(warplineDirOf(root)).length).toBe(before + 1);
  });
});
