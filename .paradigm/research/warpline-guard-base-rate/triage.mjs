#!/usr/bin/env node
// Triage divergeMeaningOnly hits: direct overlap vs closure ripple.
// For each git-clean hit merge: for each flagged symbol, check whether BOTH
// parents' text diffs (vs merge base) touch the symbol's file, and whether the
// symbol's short name appears in both sides' changed hunks (crude direct-overlap
// proxy). Usage: node triage.mjs <repoDir> <resultsJsonl>
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoDir = path.resolve(process.argv[2]);
const results = process.argv[3];
const git = (args) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', maxBuffer: 1e9 });

const recs = fs.readFileSync(results, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  .filter(r => r.ok && r.divergeMeaningOnly.length > 0 && !r.gitConflicted);

const out = [];
for (const r of recs) {
  const base = git(['merge-base', r.p1, r.p2]).trim();
  const filesA = new Set(git(['diff', '--name-only', base, r.p1]).split('\n').filter(Boolean));
  const filesB = new Set(git(['diff', '--name-only', base, r.p2]).split('\n').filter(Boolean));
  let direct = 0, fileBoth = 0, ripple = 0;
  const directSyms = [];
  const diffCache = new Map();
  const hunkNames = (p, file) => {
    const k = p + ':' + file;
    if (!diffCache.has(k)) {
      let d = '';
      try { d = git(['diff', '-U0', base, p, '--', file]); } catch {}
      diffCache.set(k, d.split('\n').filter(l => /^[+-][^+-]/.test(l)).join('\n'));
    }
    return diffCache.get(k);
  };
  for (const sym of r.divergeMeaningOnly) {
    const m = sym.match(/^#code:(.*?)::(.*)$/);
    if (!m) { ripple++; continue; }
    const [, file, qname] = m;
    const short = qname.split('.').pop();
    const inA = filesA.has(file), inB = filesB.has(file);
    if (inA && inB) {
      fileBoth++;
      const nameInA = hunkNames(r.p1, file).includes(short);
      const nameInB = hunkNames(r.p2, file).includes(short);
      if (nameInA && nameInB) { direct++; directSyms.push(sym); } else ripple++;
    } else ripple++;
  }
  out.push({
    repo: path.basename(repoDir), merge: r.merge.slice(0, 10),
    nFlagged: r.divergeMeaningOnly.length,
    fileTouchedByBothSides: fileBoth,
    directNameOverlap: direct,
    closureRippleOnly: r.divergeMeaningOnly.length - direct,
    directSyms: directSyms.slice(0, 8),
  });
}
console.log(JSON.stringify(out, null, 2));
const merges = out.length;
const mergesWithDirect = out.filter(o => o.directNameOverlap > 0).length;
console.log(`\nSUMMARY ${path.basename(repoDir)}: gitCleanHits=${merges} withDirectOverlap=${mergesWithDirect} rippleOnly=${merges - mergesWithDirect}`);
