#!/usr/bin/env node
// Partition Trial Phase 0 — night-1 scorer (methodology.md §3).
// OVERLAPPING: shared symbol. ADJACENT: no shared symbol, shared changed file
// (night-1 file-contact proxy; ripple adjacency lands night-2). DISJOINT: neither.
// Usage: node score.mjs sample.jsonl
import * as fs from 'node:fs';

const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
const inter = (a, b) => a.filter((x) => new Set(b).has(x));

const rows = [];
for (const line of lines) {
  const r = JSON.parse(line);
  const symI = inter(r.taskA.symbols, r.taskB.symbols);
  const fileI = inter(r.taskA.changedPaths, r.taskB.changedPaths);
  const cls = symI.length ? 'OVERLAPPING' : fileI.length ? 'ADJACENT' : 'DISJOINT';
  rows.push({ pairId: r.pairId, source: r.source, cls, symI, fileI, emptySymbols: !!r.emptySymbols, lensFailed: !!(r.taskA.lensFailed || r.taskB.lensFailed) });
}

const tally = (rs) => {
  const t = { OVERLAPPING: 0, ADJACENT: 0, DISJOINT: 0 };
  rs.forEach((r) => t[r.cls]++);
  const n = rs.length;
  const pct = (k) => n ? (100 * t[k] / n).toFixed(1) + '%' : '-';
  return { n, ...t, pOver: pct('OVERLAPPING'), pAdj: pct('ADJACENT'), pDis: pct('DISJOINT') };
};

const wilson = (k, n, z = 1.96) => {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, m = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - m), Math.min(1, c + m)];
};

const bySource = {};
for (const r of rows) (bySource[r.source] ??= []).push(r);

console.log(`pairs=${rows.length}`);
for (const [src, rs] of [...Object.entries(bySource), ['POOLED', rows]]) {
  const t = tally(rs);
  const [lo, hi] = wilson(t.DISJOINT, t.n);
  console.log(`${src}: n=${t.n} OVERLAPPING=${t.OVERLAPPING} (${t.pOver}) ADJACENT=${t.ADJACENT} (${t.pAdj}) DISJOINT=${t.DISJOINT} (${t.pDis}) [Wilson95 disjoint ${(lo * 100).toFixed(1)}-${(hi * 100).toFixed(1)}%]`);
  const sens = tally(rs.filter((r) => !r.emptySymbols && !r.lensFailed));
  console.log(`  sensitivity (non-empty symbols, lens ok): n=${sens.n} O=${sens.pOver} A=${sens.pAdj} D=${sens.pDis}`);
}
console.log('\nOVERLAPPING pairs:');
for (const r of rows.filter((r) => r.cls === 'OVERLAPPING')) console.log(`  ${r.pairId} [${r.source}] shared symbols: ${r.symI.slice(0, 6).join(', ')}${r.symI.length > 6 ? ` (+${r.symI.length - 6})` : ''}`);
console.log('\nADJACENT pairs:');
for (const r of rows.filter((r) => r.cls === 'ADJACENT')) console.log(`  ${r.pairId} [${r.source}] shared files: ${r.fileI.slice(0, 3).join(', ')}${r.fileI.length > 3 ? ` (+${r.fileI.length - 3})` : ''}`);
