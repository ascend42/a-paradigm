#!/usr/bin/env node
// Render the markdown tables for base-rate-results.md from results-*.jsonl.
import * as fs from 'node:fs';

const files = { zod: 'results-zod.jsonl', nest: 'results-nest.jsonl', xstate: 'results-xstate.jsonl', 'nest-ts': 'results-nest-ts.jsonl' };
const data = {};
for (const [k, f] of Object.entries(files)) {
  if (!fs.existsSync(f)) continue;
  data[k] = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

const S = (recs) => {
  const ok = recs.filter(r => r.ok);
  const clean = ok.filter(r => !r.gitConflicted);
  const hitsClean = clean.filter(r => r.divergeMeaningOnly.length > 0);
  return {
    tested: recs.length, ok: ok.length, err: recs.length - ok.length,
    gitConf: ok.length - clean.length, gitClean: clean.length,
    conv: ok.filter(r => r.verdict === 'CONVERGENT').length,
    div: ok.filter(r => r.verdict === 'DIVERGENT').length,
    hitAny: ok.filter(r => r.divergeMeaningOnly.length > 0).length,
    hitClean: hitsClean.length,
    gitOnly: ok.filter(r => r.divergeGitOnly.length > 0).length,
    agreeConf: ok.filter(r => r.agreeConflict.length > 0).length,
    unmapped: ok.filter(r => r.gitConflictUnmapped.length > 0).length,
    meanScore: ok.length ? (ok.reduce((s, r) => s + r.score, 0) / ok.length).toFixed(3) : '-',
    medMs: ok.length ? ok.map(r => r.ms).sort((a, b) => a - b)[Math.floor(ok.length / 2)] : '-',
  };
};

console.log('## HEADLINE table');
console.log('| repo | merges tested | oracle errors | git-clean merges | divergeMeaningOnly on git-clean | rate (of git-clean) | rate (of all tested) |');
console.log('|---|---|---|---|---|---|---|');
let T = { tested: 0, hitClean: 0, gitClean: 0, err: 0 };
for (const [k, recs] of Object.entries(data)) {
  const s = S(recs);
  console.log(`| ${k} | ${s.tested} | ${s.err} | ${s.gitClean} | ${s.hitClean} | ${(100 * s.hitClean / s.gitClean).toFixed(1)}% | ${(100 * s.hitClean / s.tested).toFixed(1)}% |`);
  if (k !== 'nest-ts') { T.tested += s.tested; T.hitClean += s.hitClean; T.gitClean += s.gitClean; T.err += s.err; }
}
console.log(`| **overall (3 primary samples)** | ${T.tested} | ${T.err} | ${T.gitClean} | ${T.hitClean} | ${(100 * T.hitClean / T.gitClean).toFixed(1)}% | ${(100 * T.hitClean / T.tested).toFixed(1)}% |`);

console.log('\n## PER-REPO verdicts');
console.log('| repo | tested | ok | errors | gitConflicted | CONVERGENT | DIVERGENT | merges w/ meaningOnly (any) | merges w/ divergeGitOnly | merges w/ agreeConflict | merges w/ unmapped git conflicts | mean score | median ms |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const [k, recs] of Object.entries(data)) {
  const s = S(recs);
  console.log(`| ${k} | ${s.tested} | ${s.ok} | ${s.err} | ${s.gitConf} | ${s.conv} | ${s.div} | ${s.hitAny} | ${s.gitOnly} | ${s.agreeConf} | ${s.unmapped} | ${s.meanScore} | ${s.medMs} |`);
}
