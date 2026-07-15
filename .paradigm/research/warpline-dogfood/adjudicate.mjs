#!/usr/bin/env node
// Warpline Move-3 dogfood — Column C, the INDEPENDENT adjudicator (harness-spec.md
// §2.3) + the §2.3 scoring table. For each concurrent symbol-bearing admission:
//   1. materialize the GIT result tree (git merge-tree of theirs vs ours) and tsc it.
//   2. materialize the WARPLINE result tree (restore the sealed merge's binding.treeId)
//      and tsc it; a KNOT/DANGLE has no auto-result → "blocked for human DECIDE".
//   3. join the authored ground-truth and apply the scoring table -> a label.
// Warpline NEVER scores itself — tsc (external) + authored truth are the oracles.
//
// -> adjudication.jsonl (one row per adjudicated admission) + a human-review queue.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'run-manifest.json'), 'utf8'));
const CLI = manifest.cli;
const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const posArgs = argv.filter((a) => !a.startsWith('--'));
const SUFFIX = FULL ? '-full' : '';
const RUN_DIR = posArgs[0] || (FULL
  ? '/private/tmp/claude-501/-Users-ascend-Documents-GitHub-a-paradigm/ed1612dd-e20a-4757-bb7a-13610ab71b45/scratchpad/warpline-move3-full/run'
  : path.join('/private/tmp/claude-501/-Users-ascend-Documents-GitHub-a-paradigm/4809f9c5-1b81-447f-b8e8-98878157545f/scratchpad/warpline-dogfood-run', 'pilot'));
const REPO = path.join(RUN_DIR, 'repo');
const TSC = '/Users/ascend/Documents/GitHub/a-paradigm/node_modules/typescript/bin/tsc';

const seeds = new Map();
for (const line of fs.readFileSync(path.join(here, FULL ? 'seed-catalog-full.jsonl' : 'seed-catalog.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const s = JSON.parse(line);
  seeds.set(s.id, s);
}
const rows = fs.readFileSync(path.join(here, `results-swarm${SUFFIX}.jsonl`), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

const gitOut = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const mktemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wl-adj-'));

/** Run tsc over specific files; returns { pass, out }. */
function tsc(files) {
  try {
    execFileSync('node', [TSC, '--noEmit', '--strict', '--module', 'esnext',
      '--target', 'esnext', '--moduleResolution', 'bundler', ...files],
      { encoding: 'utf8', stdio: 'pipe' });
    return { pass: true, out: '' };
  } catch (e) {
    return { pass: false, out: String(e.stdout ?? e.message).slice(0, 400) };
  }
}

/** Materialize git's 3-way merge of theirs/ours -> { conflicted, dir } (dir null on
 *  conflict). Extraction is PATH-SCOPED to the seed's files (`git show tree:path`) —
 *  full-archive extraction of a monorepo-scale tree per row is needless I/O. */
function gitResultTree(theirs, ours, seedFiles) {
  let tree;
  try {
    tree = gitOut(['merge-tree', '--write-tree', theirs, ours]).trim().split('\n')[0];
  } catch {
    return { conflicted: true, dir: null }; // git textual conflict
  }
  const dir = mktemp();
  for (const f of seedFiles) {
    try {
      const content = gitOut(['show', `${tree}:${f}`]);
      const full = path.join(dir, f);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    } catch { /* file absent in merged tree — tolerated (checked by caller) */ }
  }
  return { conflicted: false, dir };
}

/** Restore a warpline binding tree (the sealed merge bytes) -> dir (full restore;
 *  the CLI has no path filter — caller must clean the dir up). */
function warpResultTree(bindingTreeId) {
  const dir = mktemp();
  execFileSync('node', [CLI, 'restore', `tree:${bindingTreeId.replace(/^tree:/, '')}`, '--to', dir, '--force'],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return dir;
}

/** §2.3 scoring table -> label. */
function scoreRow(row, adj) {
  const { status, sealed, truth } = row;
  const gitClean = !adj.gitConflicted;         // git produced a merged tree
  if (status === 'CLEAN' && sealed) {
    if (adj.tscWarp && adj.tscWarp.pass === false) return 'FALSE-CLEAN';          // worst case, hard stop
    if (adj.gitConflicted) return 'MEANING-DECISIVE:auto-resolve';               // warpline resolved what git conflicts
    return 'agree-clean';                                                         // both clean, correct
  }
  if (status === 'KNOT' || status === 'DANGLE') {
    const silentMismerge = gitClean && ((adj.tscGit && adj.tscGit.pass === false) || truth === 'conflict');
    if (silentMismerge) return 'MEANING-DECISIVE:silent-mismerge';               // git merges clean-but-broken; warpline blocks
    if (adj.gitConflicted) return 'agree-conflict';
    return 'FALSE-KNOT';                                                          // git clean + passes + not conflict => cried wolf
  }
  return 'n/a';
}

const out = [];
const humanQueue = [];
for (const row of rows) {
  if (!row.concurrent || !row.symbolBearing) continue;
  if (row.stratum === 'CHURN-RETIRE') continue; // churn slots are fast/unscored anyway
  const seed = seeds.get(row.seedId);
  const seedFiles = seed.files;

  // GIT result tree + tsc (path-scoped extraction).
  const gitRes = gitResultTree(row.theirsCommit, row.oursCommit, seedFiles);
  let tscGit = null;
  if (!gitRes.conflicted) {
    const files = seedFiles.map((f) => path.join(gitRes.dir, f)).filter((p) => fs.existsSync(p));
    tscGit = files.length ? tsc(files) : { pass: true, out: '(no seed files in merge tree)' };
  }

  // WARPLINE result tree + tsc (only a sealed CLEAN merge has auto-result bytes).
  let tscWarp = null;
  let warpOutcome;
  let warpDir = null;
  if (row.status === 'CLEAN' && row.sealed && row.bindingTreeId) {
    warpDir = warpResultTree(row.bindingTreeId);
    const files = seedFiles.map((f) => path.join(warpDir, f)).filter((p) => fs.existsSync(p));
    tscWarp = files.length ? tsc(files) : { pass: true, out: '(no seed files)' };
    warpOutcome = 'auto-resolved';
  } else if (row.status === 'KNOT' || row.status === 'DANGLE') {
    warpOutcome = 'blocked-for-human';
  } else {
    warpOutcome = row.status;
  }

  const adj = {
    gitConflicted: gitRes.conflicted,
    tscGit: tscGit ? { pass: tscGit.pass } : null,
    tscGitDetail: tscGit ? tscGit.out : null,
    tscWarp: tscWarp ? { pass: tscWarp.pass } : null,
    tscWarpDetail: tscWarp ? tscWarp.out : null,
    warpOutcome,
  };
  const label = scoreRow(row, adj);

  const rec = {
    batchId: row.batchId, agentId: row.agentId, seedId: row.seedId, stratum: row.stratum,
    truth: row.truth, warplineStatus: row.status, confidence: row.confidence, sealed: row.sealed,
    gitConflictedOracle: row.gitConflicted, gitTreeConflicted: adj.gitConflicted,
    tscGit: adj.tscGit ? adj.tscGit.pass : null, tscWarp: adj.tscWarp ? adj.tscWarp.pass : null,
    warpOutcome, label,
    // human sign-off queue triggers (§2.3.5): A-vs-B disagreement, tsc-vs-truth disagreement.
  };
  out.push(rec);

  const aVsBDisagree = row.status !== 'FAST_ADMIT' &&
    ((row.status === 'CLEAN') !== (!adj.gitConflicted && (!adj.tscGit || adj.tscGit.pass)));
  const tscVsTruthDisagree =
    (adj.tscGit && adj.tscGit.pass === false && row.truth !== 'conflict') ||
    (adj.tscGit && adj.tscGit.pass === true && row.truth === 'conflict' && adj.gitConflicted === false && label.startsWith('MEANING-DECISIVE'));
  if (label === 'FALSE-CLEAN' || label === 'FALSE-KNOT' || aVsBDisagree || tscVsTruthDisagree) {
    humanQueue.push({ ...rec, reason: label === 'FALSE-CLEAN' ? 'FALSE-CLEAN hard-stop'
      : label === 'FALSE-KNOT' ? 'false-knot review' : aVsBDisagree ? 'A-vs-B disagreement' : 'tsc-vs-truth' });
  }

  console.log(`[${row.batchId} ${row.agentId} ${row.seedId}] warp=${row.status}${row.confidence ? '/' + row.confidence : ''} ` +
    `gitTreeConflict=${adj.gitConflicted} tscGit=${adj.tscGit ? adj.tscGit.pass : '-'} tscWarp=${adj.tscWarp ? adj.tscWarp.pass : '-'} => ${label}`);

  // Bound temp usage: a monorepo-scale restore per CLEAN row adds up fast.
  if (warpDir) fs.rmSync(warpDir, { recursive: true, force: true });
  if (gitRes.dir) fs.rmSync(gitRes.dir, { recursive: true, force: true });
}

fs.writeFileSync(path.join(here, `adjudication${SUFFIX}.jsonl`), out.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(here, `human-review-queue${SUFFIX}.json`), JSON.stringify(humanQueue, null, 2));
console.log(`\nadjudicated ${out.length} concurrent admissions -> adjudication.jsonl`);
console.log(`human-review queue: ${humanQueue.length} item(s)`);
const falseClean = out.filter((r) => r.label === 'FALSE-CLEAN');
if (falseClean.length) { console.error(`\n*** FALSE-CLEAN HARD STOP: ${falseClean.length} wrong-merge(s) — halt & root-cause. ***`); process.exitCode = 2; }
