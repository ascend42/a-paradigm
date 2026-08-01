/**
 * bench/worktree-index-dg.mts — the BEFORE/AFTER for soundness audit D-G
 * (Arky): the shared `.warpline/index` was an unlocked read-modify-write of
 * every worktree's section that never pruned. The defect is a SCALING WALL, so
 * restructuring it is not evidence — a measurement on a realistic index is.
 *
 * The realistic index is the one Arky's stress run produced: 82 sections,
 * 308,497 entries, ~54 MB. This script rebuilds an index of that shape and
 * measures the ONE operation every `propose` pays for — the save — under the
 * OLD implementation (inlined verbatim below, so the comparison is against real
 * pre-fix code) and the NEW sharded one.
 *
 * It also runs the concurrency demonstration the unit tests deliberately do not
 * (two real OS processes, wall-clock dependent): two agents snapshotting
 * different worktrees at the same time, against both implementations.
 *
 * NEVER touches the live fabric — everything is under os.tmpdir().
 *
 * Run from packages/warpline:
 *   ../../node_modules/.bin/tsx bench/worktree-index-dg.mts
 *   ../../node_modules/.bin/tsx bench/worktree-index-dg.mts --child <impl> <root> <wt> <n>
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  saveWorktreeIndex,
  loadWorktreeIndex,
  worktreeIndexPathOf,
  worktreeIndexDirOf,
  type WorktreeIndexEntry,
} from '../src/warp/worktree-index.js';

/* ── the PRE-FIX implementation, verbatim (worktree-index.ts @ 8cf4cc27) ───── */

const LEGACY_SCHEMA = 'worktreeIndex:v1';
const sectionKey = (worktree: string): string => path.resolve(worktree);

interface LegacyFile {
  schemaVersion: string;
  worktrees: Record<string, { builtAt: string; entries: Record<string, WorktreeIndexEntry> }>;
}

function legacySave(root: string, worktree: string, entries: Map<string, WorktreeIndexEntry>): void {
  try {
    const p = worktreeIndexPathOf(root);
    let file: LegacyFile = { schemaVersion: LEGACY_SCHEMA, worktrees: {} };
    try {
      const existing = JSON.parse(fs.readFileSync(p, 'utf8')) as LegacyFile;
      if (existing?.schemaVersion === LEGACY_SCHEMA && existing.worktrees) file = existing;
    } catch {
      /* fresh file */
    }
    file.worktrees[sectionKey(worktree)] = {
      builtAt: new Date().toISOString(),
      entries: Object.fromEntries(entries),
    };
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(file), 'utf8');
    fs.renameSync(tmp, p);
  } catch {
    /* cache only */
  }
}

function legacyLoad(root: string, worktree: string): Map<string, WorktreeIndexEntry> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(worktreeIndexPathOf(root), 'utf8')) as LegacyFile;
    const section = parsed.worktrees?.[sectionKey(worktree)];
    if (!section) return null;
    return new Map(Object.entries(section.entries));
  } catch {
    return null;
  }
}

/* ── the realistic fixture: 82 sections / 308,497 entries / ~54 MB ─────────── */

const SECTIONS = 82;
const TOTAL_ENTRIES = 308_497;

const hex = (n: number, len: number) => n.toString(16).padStart(len, '0').slice(-len);

function sectionEntries(s: number, count: number): Map<string, WorktreeIndexEntry> {
  const m = new Map<string, WorktreeIndexEntry>();
  for (let i = 0; i < count; i++) {
    const rel = `packages/pkg-${s}/src/area-${i % 40}/module-${i % 17}/component-${i}.ts`;
    m.set(rel, [1_700_000_000_000 + i, 1024 + i, 900_000 + i, '100644', `blob:v1:${hex(s * 1e6 + i, 64)}`, hex(i, 40)]);
  }
  return m;
}

/** counts per section, summing to exactly TOTAL_ENTRIES. */
const counts = Array.from({ length: SECTIONS }, (_, s) =>
  Math.floor(TOTAL_ENTRIES / SECTIONS) + (s < TOTAL_ENTRIES % SECTIONS ? 1 : 0),
);

function worktreeOf(base: string, s: number): string {
  return path.join(base, `wt-${s}`);
}

function buildLegacyFixture(root: string, base: string): void {
  const file: LegacyFile = { schemaVersion: LEGACY_SCHEMA, worktrees: {} };
  const builtAt = new Date(Date.now() - 3_600_000).toISOString();
  for (let s = 0; s < SECTIONS; s++) {
    file.worktrees[sectionKey(worktreeOf(base, s))] = {
      builtAt,
      entries: Object.fromEntries(sectionEntries(s, counts[s])),
    };
  }
  fs.mkdirSync(path.dirname(worktreeIndexPathOf(root)), { recursive: true });
  fs.writeFileSync(worktreeIndexPathOf(root), JSON.stringify(file), 'utf8');
}

function buildShardFixture(root: string, base: string): void {
  for (let s = 0; s < SECTIONS; s++) {
    fs.mkdirSync(worktreeOf(base, s), { recursive: true });
    saveWorktreeIndex(root, worktreeOf(base, s), sectionEntries(s, counts[s]));
  }
}

function dirBytes(p: string): number {
  let total = 0;
  for (const n of fs.readdirSync(p)) total += fs.statSync(path.join(p, n)).size;
  return total;
}

function timeIt(label: string, iters: number, fn: () => void): number {
  fn(); // warm
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / iters;
  console.log(`  ${label.padEnd(46)} ${ms.toFixed(1).padStart(8)} ms/save`);
  return ms;
}

/* ── the two-real-processes concurrency demonstration ──────────────────────── */

const SELF = fileURLToPath(import.meta.url);
const TSX = path.resolve(path.dirname(SELF), '../../../node_modules/.bin/tsx');

function child(impl: 'old' | 'new', root: string, wt: string, n: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(TSX, [SELF, '--child', impl, root, wt, String(n)], { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`child ${impl} exit ${c}`))));
  });
}

async function concurrency(impl: 'old' | 'new', base: string): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `warpline-dg-conc-${impl}-`));
  const wtA = worktreeOf(base, 0);
  const wtB = worktreeOf(base, 1);
  try {
    // Seed 6 unrelated sections so the RMW has something real to re-serialize.
    for (let s = 2; s < 8; s++) {
      const wt = worktreeOf(base, s);
      fs.mkdirSync(wt, { recursive: true });
      if (impl === 'old') legacySave(root, wt, sectionEntries(s, 4000));
      else saveWorktreeIndex(root, wt, sectionEntries(s, 4000));
    }
    fs.mkdirSync(wtA, { recursive: true });
    fs.mkdirSync(wtB, { recursive: true });
    await Promise.all([child(impl, root, wtA, 20_000), child(impl, root, wtB, 20_000)]);
    const a = impl === 'old' ? legacyLoad(root, wtA) : loadWorktreeIndex(root, wtA)?.entries ?? null;
    const b = impl === 'old' ? legacyLoad(root, wtB) : loadWorktreeIndex(root, wtB)?.entries ?? null;
    const survivors = [a, b].filter((x) => x?.size === 20_000).length;
    return `${survivors}/2 concurrent writers survived  (A=${a?.size ?? 'DROPPED'}, B=${b?.size ?? 'DROPPED'})`;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/* ── main ──────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === '--child') {
    const [, impl, root, wt, n] = argv;
    const m = sectionEntries(999, Number(n));
    if (impl === 'old') legacySave(root, wt, m);
    else saveWorktreeIndex(root, wt, m);
    return;
  }

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-wts-'));
  const oldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-old-'));
  const newRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-new-'));
  try {
    for (let s = 0; s < SECTIONS; s++) fs.mkdirSync(worktreeOf(base, s), { recursive: true });

    console.log(`D-G before/after — ${SECTIONS} sections, ${TOTAL_ENTRIES.toLocaleString()} entries\n`);

    buildLegacyFixture(oldRoot, base);
    const sharedBytes = fs.statSync(worktreeIndexPathOf(oldRoot)).size;
    buildShardFixture(newRoot, base);
    const shardBytes = dirBytes(worktreeIndexDirOf(newRoot));
    const mine = fs.statSync(path.join(worktreeIndexDirOf(newRoot), fs.readdirSync(worktreeIndexDirOf(newRoot))[0])).size;

    console.log('ON-DISK SHAPE');
    console.log(`  BEFORE  1 shared file            ${(sharedBytes / 2 ** 20).toFixed(1)} MB   (read + re-serialized on EVERY save)`);
    console.log(`  AFTER   ${fs.readdirSync(worktreeIndexDirOf(newRoot)).length} shard files          ${(shardBytes / 2 ** 20).toFixed(1)} MB total, ${(mine / 2 ** 20).toFixed(2)} MB touched per save\n`);

    const wt = worktreeOf(base, 7);
    const payload = sectionEntries(7, counts[7]);
    console.log('BYTES TOUCHED BY ONE SAVE');
    console.log(`  BEFORE  read ${(sharedBytes / 2 ** 20).toFixed(1)} MB + re-serialize ${(sharedBytes / 2 ** 20).toFixed(1)} MB  (81 other worktrees' entries, every time)`);
    console.log(`  AFTER   read ${((SECTIONS * 4096) / 2 ** 20).toFixed(2)} MB (${SECTIONS} bounded 4 KB prune headers) + re-serialize ${(mine / 2 ** 20).toFixed(2)} MB\n`);

    console.log('COST OF ONE SAVE (the per-propose price)');
    const before = timeIt('BEFORE  shared read-modify-write', 5, () => legacySave(oldRoot, wt, payload));
    const after = timeIt('AFTER   one shard + bounded prune', 5, () => saveWorktreeIndex(newRoot, wt, payload));
    console.log(`  speedup ${(before / after).toFixed(1)}x — and AFTER is O(my worktree), BEFORE was O(all worktrees ever seen)\n`);

    console.log('WHAT THE NEW PRUNE STEP COSTS (it is NOT free — confirming, not asserting)');
    const { pruneWorktreeIndex } = await import('../src/warp/worktree-index.js');
    timeIt(`prune alone, ${SECTIONS} shards, bounded header read`, 20, () => pruneWorktreeIndex(newRoot, wt));
    timeIt(`readdir + stat-per-shard only (${SECTIONS} stats)`, 20, () => {
      const d = worktreeIndexDirOf(newRoot);
      for (const n of fs.readdirSync(d)) fs.statSync(path.join(d, n));
    });
    timeIt('FULL-parse prune (the version that would have re-read all)', 3, () => {
      const d = worktreeIndexDirOf(newRoot);
      for (const n of fs.readdirSync(d)) {
        try {
          JSON.parse(fs.readFileSync(path.join(d, n), 'utf8'));
        } catch {
          /* ignore */
        }
      }
    });
    console.log('');

    console.log('RECLAIM (dead sections)');
    console.log('  BEFORE  no pruning at all — 82 sections, 0 reclaimable');
    const gone = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-gone-'));
    fs.rmSync(gone, { recursive: true, force: true });
    saveWorktreeIndex(newRoot, gone, sectionEntries(1, 10)); // shard for a worktree that is gone
    const beforePrune = fs.readdirSync(worktreeIndexDirOf(newRoot)).length;
    const removed = pruneWorktreeIndex(newRoot);
    console.log(`  AFTER   prune removed ${removed} dead shard(s): ${beforePrune} → ${fs.readdirSync(worktreeIndexDirOf(newRoot)).length}\n`);

    console.log('CONCURRENCY (two real OS processes, different worktrees, 20k entries each)');
    console.log(`  BEFORE  ${await concurrency('old', base)}`);
    console.log(`  AFTER   ${await concurrency('new', base)}`);
  } finally {
    for (const d of [base, oldRoot, newRoot]) fs.rmSync(d, { recursive: true, force: true });
  }
}

await main();
