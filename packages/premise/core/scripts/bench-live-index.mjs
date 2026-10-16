#!/usr/bin/env node
/**
 * #live-index bench — REPORT ONLY (not CI-asserted).
 *
 *   node packages/premise/core/scripts/bench-live-index.mjs [rootDir] [--symbol '#x'] [--iters N]
 *
 * Requires a built premise-core (npm run build). Measures against rootDir
 * (default: the repo root):
 *   - uncached baseline: aggregateFromDirectory + buildSymbolIndex + buildLiveGraph
 *     (the pre-7.13 per-call cost of loadLiveGraph)
 *   - cold getLiveIndex (after invalidateLiveIndex)          target: baseline ±10%
 *   - warm graph slice p50 (graphSliceFromRoot)              target: < 50ms
 *   - touched-one .purpose (edit + graph slice)              target: < 150ms
 *   - warm search p50 (searchSymbols, 1- and 2-token)         target: < 10ms
 *
 * The touched-one step appends a YAML comment to this package's own .purpose and
 * restores the original bytes + mtime in a finally block.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const core = await import(path.join(pkgDir, 'dist/index.js'));
const {
  aggregateFromDirectory, buildSymbolIndex, buildLiveGraph,
  getLiveIndex, invalidateLiveIndex, graphSliceFromRoot, searchSymbols,
} = core;

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const root = path.resolve(positional[0] ?? path.resolve(pkgDir, '../../..'));
const iters = Number(flag('--iters', '30'));
let symbol = flag('--symbol', '#graph-slice-projector');

const now = () => performance.now();
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (ms) => `${ms.toFixed(2)}ms`;
async function timeN(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = now();
    await fn(i);
    out.push(now() - t);
  }
  return out;
}

const report = {};

// Uncached baseline (what every loadLiveGraph call cost before 7.13).
const base = await timeN(5, async () => {
  const r = await aggregateFromDirectory(root);
  buildLiveGraph(buildSymbolIndex(r));
});
report.uncachedBaselineP50 = pct(base, 50);

// Cold live index.
const cold = await timeN(5, async () => {
  invalidateLiveIndex(root);
  const live = await getLiveIndex(root);
  buildLiveGraph(live.index);
});
report.coldLiveIndexP50 = pct(cold, 50);

// Cold equivalence sanity (order included).
{
  invalidateLiveIndex(root);
  const live = await getLiveIndex(root);
  const coldAgg = await aggregateFromDirectory(root);
  const strip = (r) => JSON.stringify({ s: r.symbols, p: r.purposeFiles, q: r.portalFiles, d: r.duplicateSymbols });
  report.coldEquivalent = strip(live.result) === strip(coldAgg);
  report.symbols = live.index.entries.size;
  report.purposeFiles = live.stats.purposeFiles;
  if (![...live.index.entries.values()].some((e) => e.symbol === symbol)) {
    symbol = [...live.index.entries.values()][0]?.symbol;
  }
}

// Warm graph slice.
await graphSliceFromRoot(root, { symbol });
const warm = await timeN(iters, () => graphSliceFromRoot(root, { symbol }));
report.warmGraphSliceP50 = pct(warm, 50);
report.warmGraphSliceP95 = pct(warm, 95);

// Touched-one .purpose.
const target = path.join(pkgDir, '.purpose');
const original = fs.readFileSync(target);
const origStat = fs.statSync(target);
const touched = [];
try {
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(target, Buffer.concat([original, Buffer.from(`\n# bench-live-index ${i} ${Date.now()}\n`)]));
    const t = now();
    const live = await getLiveIndex(root);
    await graphSliceFromRoot(root, { symbol });
    touched.push(now() - t);
    if (live.stats.parsedFiles !== 1) report.touchedParsedFilesUnexpected = live.stats.parsedFiles;
  }
} finally {
  fs.writeFileSync(target, original);
  fs.utimesSync(target, origStat.atime, origStat.mtime);
}
report.touchedOneP50 = pct(touched, 50);

// Warm search.
const { index } = await getLiveIndex(root);
searchSymbols(index, 'graph');
const s1 = await timeN(iters, () => searchSymbols(index, 'graph'));
const s2 = await timeN(iters, () => searchSymbols(index, 'graph slice'));
report.warmSearch1TokenP50 = pct(s1, 50);
report.warmSearch2TokenP50 = pct(s2, 50);

const counts = new Set(['symbols', 'purposeFiles', 'touchedParsedFilesUnexpected']);
const line = (k, v) => console.log(`${k.padEnd(28)} ${typeof v === 'number' && !counts.has(k) ? fmt(v) : v}`);
console.log(`#live-index bench — root=${root} symbol=${symbol} iters=${iters}`);
for (const [k, v] of Object.entries(report)) line(k, v);
