#!/usr/bin/env node
// Aggregate results-*.jsonl into per-repo + overall stats.
import * as fs from 'node:fs';
import * as path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const files = fs.readdirSync(dir).filter(f => /^results-.*\.jsonl$/.test(f));
const all = [];
for (const f of files) {
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)) {
    all.push(JSON.parse(line));
  }
}

function stats(recs) {
  const ok = recs.filter(r => r.ok);
  const err = recs.filter(r => !r.ok);
  const errClasses = {};
  for (const e of err) errClasses[e.errorClass] = (errClasses[e.errorClass] ?? 0) + 1;
  const meaningOnlyMerges = ok.filter(r => r.divergeMeaningOnly.length > 0);
  const meaningOnlyGitClean = ok.filter(r => r.divergeMeaningOnly.length > 0 && !r.gitConflicted);
  const s = {
    tested: recs.length,
    ok: ok.length,
    errors: err.length,
    errClasses,
    gitConflicted: ok.filter(r => r.gitConflicted).length,
    convergent: ok.filter(r => r.verdict === 'CONVERGENT').length,
    divergent: ok.filter(r => r.verdict === 'DIVERGENT').length,
    // merge-level classes
    mergesWithDivergeMeaningOnly: meaningOnlyMerges.length,
    mergesWithDivergeMeaningOnly_gitClean: meaningOnlyGitClean.length,
    mergesWithDivergeGitOnly: ok.filter(r => r.divergeGitOnly.length > 0).length,
    mergesWithAgreeConflict: ok.filter(r => r.agreeConflict.length > 0).length,
    mergesWithUnmappedGitConflict: ok.filter(r => r.gitConflictUnmapped.length > 0).length,
    // symbol-level sums
    sumDivergeMeaningOnlySymbols: ok.reduce((s, r) => s + r.divergeMeaningOnly.length, 0),
    sumDivergeGitOnlySymbols: ok.reduce((s, r) => s + r.divergeGitOnly.length, 0),
    sumAgreeConflictSymbols: ok.reduce((s, r) => s + r.agreeConflict.length, 0),
    meanScore: ok.length ? (ok.reduce((s, r) => s + r.score, 0) / ok.length).toFixed(4) : null,
    medianMs: ok.length ? ok.map(r => r.ms).sort((a, b) => a - b)[Math.floor(ok.length / 2)] : null,
    hits: meaningOnlyMerges.map(r => ({
      merge: r.merge.slice(0, 10), gitConflicted: r.gitConflicted,
      nMeaningOnly: r.divergeMeaningOnly.length,
      sample: r.divergeMeaningOnly.slice(0, 5),
      knots: (r.knots ?? []).slice(0, 5),
    })),
  };
  return s;
}

const byRepo = {};
for (const r of all) (byRepo[r.repo] ??= []).push(r);
const out = { perRepo: {}, overall: stats(all) };
for (const [repo, recs] of Object.entries(byRepo)) out.perRepo[repo] = stats(recs);
console.log(JSON.stringify(out, null, 2));
