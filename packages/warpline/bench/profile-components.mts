/**
 * bench/profile-components.mts — read-only component profile of `admit` on the
 * REAL monorepo (T-2026-07-04-003 baseline). Never touches the repo-root live
 * `.warpline/`: the ObjectStore is rooted in a throwaway temp dir; absorb reads
 * git objects only. Not shipped (bench/ is outside tsup entry + `files`).
 *
 * Run from packages/warpline:
 *   ../../node_modules/.bin/tsx bench/profile-components.mts [absorb|snapshot|snapdir|all]
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadLiveGraph } from '@a-company/premise-core';
import { liftCodeUnits, injectCodeUnits } from '../src/lens/lift-code-units.js';
import { materializeTree, releaseTree, revParseTree } from '../src/git/git-exec.js';
import { buildWarpState } from '../src/warp/warp-state.js';
import { ObjectStore } from '../src/warp/object-store.js';
import { snapshotRef, snapshotDir } from '../src/warp/snapshot.js';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-bench-store-'));

async function t<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const s = performance.now();
  const r = await fn();
  console.log(`${label}: ${((performance.now() - s) / 1000).toFixed(2)}s`);
  return r;
}

const which = process.argv[2] ?? 'all';

if (which === 'absorb' || which === 'all') {
  await t('revParseTree', () => revParseTree('HEAD', { cwd: REPO }));
  const tmp = await t('materializeTree(HEAD)', () => materializeTree('HEAD', { cwd: REPO }));
  try {
    const graph = await t('loadLiveGraph', () => loadLiveGraph(tmp));
    const units = await t('liftCodeUnits', () => liftCodeUnits(tmp));
    console.log(`  units: ${units.length}`);
    injectCodeUnits(graph.index, units);
    const state = await t('buildWarpState(computeEssences)', () =>
      buildWarpState(graph.index, { ref: 'HEAD', treeSha: null, rootDir: tmp }),
    );
    console.log(`  objects: ${state.objects.size}`);
  } finally {
    await releaseTree(tmp);
  }
}

if (which === 'snapshot' || which === 'all') {
  const store = new ObjectStore(SCRATCH);
  await t('snapshotRef(HEAD) [cold store]', () => snapshotRef(store, 'HEAD', { cwd: REPO }));
  await t('snapshotRef(HEAD) [warm store]', () => snapshotRef(store, 'HEAD', { cwd: REPO }));
}

if (which === 'snapdir') {
  const store = new ObjectStore(SCRATCH);
  await t('snapshotDir(repo) [cold]', () => snapshotDir(store, REPO));
  await t('snapshotDir(repo) [warm]', () => snapshotDir(store, REPO));
}

fs.rmSync(SCRATCH, { recursive: true, force: true });
