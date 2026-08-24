#!/usr/bin/env node
// Aggregate reducedFidelity across the persisted WarpStore states of a scratch
// repo (.warpline/states/*.json). Usage: node fidelity.mjs <repoDir>
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoDir = path.resolve(process.argv[2]);
const statesDir = path.join(repoDir, '.warpline', 'states');
const files = fs.existsSync(statesDir) ? fs.readdirSync(statesDir).filter(f => f.endsWith('.json')) : [];

// Dedupe by contentId (a unique VERSION of a unit); also track unique symbols.
const byContentId = new Map(); // contentId -> { reduced }
const symbols = new Set();
const reducedSymbols = new Set();
let statesRead = 0;
let perStateTotals = [];

for (const f of files) {
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(statesDir, f), 'utf8')); } catch { continue; }
  statesRead++;
  let stTotal = 0, stReduced = 0;
  for (const o of s.objects ?? []) {
    const c = o.contract ?? {};
    if (!c.essenceTag) continue; // code-units only
    stTotal++;
    const reduced = !!c.reducedFidelity;
    if (reduced) stReduced++;
    if (o.contentId && !byContentId.has(o.contentId)) byContentId.set(o.contentId, reduced);
    symbols.add(o.symbol);
    if (reduced) reducedSymbols.add(o.symbol);
  }
  perStateTotals.push({ total: stTotal, reduced: stReduced });
}

const uniqTotal = byContentId.size;
const uniqReduced = [...byContentId.values()].filter(Boolean).length;
const pct = (a, b) => b ? (100 * a / b).toFixed(2) + '%' : 'n/a';
const avgState = perStateTotals.length
  ? perStateTotals.reduce((s, x) => s + (x.total ? x.reduced / x.total : 0), 0) / perStateTotals.length
  : 0;

console.log(JSON.stringify({
  repo: path.basename(repoDir),
  statesRead,
  uniqueUnitVersions: uniqTotal,
  uniqueUnitVersionsReduced: uniqReduced,
  pctUnitVersionsReduced: pct(uniqReduced, uniqTotal),
  uniqueSymbols: symbols.size,
  uniqueSymbolsEverReduced: reducedSymbols.size,
  pctSymbolsEverReduced: pct(reducedSymbols.size, symbols.size),
  meanPerStateReducedShare: (100 * avgState).toFixed(2) + '%',
}, null, 2));
