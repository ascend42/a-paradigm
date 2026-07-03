#!/usr/bin/env node
// Compare v1 vs v1.1 base-rate results per merge.
// Usage: node compare.mjs <oldJsonl> <newJsonl> <repoLabel>
import * as fs from 'node:fs';

const load = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const [oldF, newF, label] = process.argv.slice(2);
const oldR = load(oldF), newR = load(newF);
const byMerge = new Map(newR.map(r => [r.merge, r]));

const isHit = (r) => r.ok && !r.gitConflicted && r.divergeMeaningOnly?.length > 0;

const out = {
  repo: label,
  n: oldR.length,
  errorsOld: oldR.filter(r => !r.ok).length,
  errorsNew: newR.filter(r => !r.ok).length,
  errorRecsNew: newR.filter(r => !r.ok).map(r => ({ merge: r.merge, errorClass: r.errorClass, error: r.error })),
  gitCleanOld: oldR.filter(r => r.ok && !r.gitConflicted).length,
  gitCleanNew: newR.filter(r => r.ok && !r.gitConflicted).length,
  hitsOld: 0, hitsNew: 0,
  gained: [], lost: [], unchanged: [], changedSet: [],
};

for (const o of oldR) {
  const n = byMerge.get(o.merge);
  if (!n) { console.error(`MISSING in new: ${o.merge}`); continue; }
  const oh = isHit(o), nh = isHit(n);
  if (oh) out.hitsOld++;
  if (nh) out.hitsNew++;
  const rec = {
    merge: o.merge.slice(0, 10),
    oldFlags: o.divergeMeaningOnly?.length ?? null,
    newFlags: n.divergeMeaningOnly?.length ?? null,
    newSymbols: nh ? n.divergeMeaningOnly : undefined,
  };
  if (!oh && nh) out.gained.push(rec);
  else if (oh && !nh) out.lost.push({ ...rec, oldSymbols: o.divergeMeaningOnly, newGitConflicted: n.gitConflicted, newOk: n.ok });
  else if (oh && nh) {
    const os = new Set(o.divergeMeaningOnly), ns = new Set(n.divergeMeaningOnly);
    const added = [...ns].filter(s => !os.has(s));
    const removed = [...os].filter(s => !ns.has(s));
    if (added.length || removed.length) out.changedSet.push({ ...rec, symbolsAdded: added, symbolsRemoved: removed });
    else out.unchanged.push({ merge: rec.merge, flags: rec.newFlags });
  }
}
out.rateOldPctOfClean = out.gitCleanOld ? +(100 * out.hitsOld / out.gitCleanOld).toFixed(1) : 0;
out.rateNewPctOfClean = out.gitCleanNew ? +(100 * out.hitsNew / out.gitCleanNew).toFixed(1) : 0;
console.log(JSON.stringify(out, null, 2));
