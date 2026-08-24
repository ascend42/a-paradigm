#!/usr/bin/env node
// Warpline Move-3 dogfood — the SWARM orchestrator (harness-spec.md §1.3-1.4, §5).
//
// Builds a fresh throwaway fabric on a DEDICATED MINIMAL real-TS repo (see
// run-manifest.json.harness_tree for why not the monorepo clone), then runs the
// batched serial-admit protocol: per batch, all agents `scratch` at the SAME
// selvage S0, apply their seed patch in their own branch/commit, then admit
// SERIALLY (first = FAST_ADMIT and advances S0->S1; the rest are GENUINE
// concurrent admissions — CLEAN/KNOT/DANGLE against the advanced selvage; a 3rd
// admits onto a MERGE strand, exercising the H1 relaxation). One row per admission
// -> results-swarm.jsonl. Column A (git counterfactual) is joined inline.
//
// SAFETY: writes ONLY under <runDir>. NEVER touches the live repo-root .warpline/.
// The CLI runs with cwd = <runDir>/repo, so repoRoot() resolves to the throwaway.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitCounterfactual } from './counterfactual.mjs';
import { churnTombstone } from './seeds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootManifest = JSON.parse(fs.readFileSync(path.join(here, 'run-manifest.json'), 'utf8'));

// ── Mode selection: pilot (default, unchanged) vs FULL (--full) ───────────────
// FULL: node swarm.mjs --full [--session F-S3] [--finalize] [runDir]
//   --session   run ONLY that session (one driver invocation per session, §4.1);
//               the first session builds the repo + genesis; results APPEND.
//   --finalize  grade + fabric-verify only (after the last session).
const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const FINALIZE = argv.includes('--finalize');
const sessionFilter = argv.includes('--session') ? argv[argv.indexOf('--session') + 1] : null;
// Crash-resume (the 2026-07-15 run's first driver invocation was killed by a
// 10-min exec cap mid-batch F-B07):
//   --from-batch F-B07     skip the selected session's earlier batches
//   --resume-partial N     resume the FIRST executed batch at admit index N —
//                          agent branches + uncleared scratch refs from the
//                          crashed process are REUSED (same bases, same commit
//                          shas, scratch still at the original batch selvage),
//                          so the protocol is identical to an uninterrupted run
//   --max-batches M        stop after M batches (keeps invocations under the cap)
const fromBatch = argv.includes('--from-batch') ? argv[argv.indexOf('--from-batch') + 1] : null;
const resumePartial = argv.includes('--resume-partial') ? Number(argv[argv.indexOf('--resume-partial') + 1]) : 0;
const maxBatches = argv.includes('--max-batches') ? Number(argv[argv.indexOf('--max-batches') + 1]) : Infinity;
const optValues = new Set(['--session', '--from-batch', '--resume-partial', '--max-batches']);
const posArgs = argv.filter((a, i) => !a.startsWith('--') && !optValues.has(argv[i - 1]));

const manifest = FULL ? rootManifest.full : rootManifest;
const CLI = rootManifest.cli;
const RUN_DIR = posArgs[0] || (FULL
  ? '/private/tmp/claude-501/-Users-ascend-Documents-GitHub-a-paradigm/ed1612dd-e20a-4757-bb7a-13610ab71b45/scratchpad/warpline-move3-full/run'
  : path.join('/private/tmp/claude-501/-Users-ascend-Documents-GitHub-a-paradigm/4809f9c5-1b81-447f-b8e8-98878157545f/scratchpad/warpline-dogfood-run', 'pilot'));
const REPO = path.join(RUN_DIR, 'repo');
const SUFFIX = FULL ? '-full' : '';
const RESULTS = path.join(here, `results-swarm${SUFFIX}.jsonl`);
const LIVE_REPO = path.resolve(here, '../../..'); // a-paradigm root (archive source; NEVER written)

// Load seeds by id.
const seeds = new Map();
for (const line of fs.readFileSync(path.join(here, FULL ? 'seed-catalog-full.jsonl' : 'seed-catalog.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const s = JSON.parse(line);
  seeds.set(s.id, s);
}

const git = (args, opts = {}) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', ...opts }).trim();
const cli = (args, env = {}) => {
  const out = execFileSync('node', [CLI, ...args], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  return out;
};
const cliJson = (args, env = {}) => JSON.parse(cli(args, env));
const writeFiles = (fileMap) => {
  for (const [rel, content] of Object.entries(fileMap)) {
    const full = path.join(REPO, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
};

// ── Build the fresh throwaway repo from the union of all seed base files ─────────
function buildRepo() {
  fs.rmSync(RUN_DIR, { recursive: true, force: true });
  fs.mkdirSync(REPO, { recursive: true });
  if (FULL) {
    // FULL: the throwaway tree is a git-archive of the LIVE repo's HEAD (real
    // monorepo scale — the delta-native snapshot layer, T-2026-07-04-003, is
    // exercised at the tree size the wedge claims to serve). READ-ONLY on the
    // live repo. The tracked .warpline trio (fabric.jsonl, fabric-legacy.json,
    // refs/selvage) rides along in the archive → STRIP it and fully gitignore
    // .warpline so no agent commit ever folds fabric state into a merge tree
    // (pilot finding #4).
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: LIVE_REPO, encoding: 'utf8' }).trim();
    execFileSync('bash', ['-c', `git -C ${LIVE_REPO} archive ${head} | tar -x -C ${REPO}`]);
    fs.rmSync(path.join(REPO, '.warpline'), { recursive: true, force: true });
    fs.writeFileSync(path.join(REPO, '.gitignore'), '.warpline/\nnode_modules/\ndist/\n');
    fs.writeFileSync(path.join(RUN_DIR, 'base-archive-head.txt'), head + '\n');
  } else {
    fs.writeFileSync(path.join(REPO, '.gitignore'), '.warpline/\nnode_modules/\n');
    fs.writeFileSync(path.join(REPO, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, module: 'esnext', target: 'esnext', moduleResolution: 'bundler' },
    }, null, 2) + '\n');
  }
  git(['init', '-q']);
  git(['config', 'user.name', 'dogfood-harness']);
  git(['config', 'user.email', 'dogfood@local']);
  const base = {};
  for (const s of seeds.values()) Object.assign(base, s.base);
  writeFiles(base);
  git(['add', '-A']);
  git(['commit', '-qam', 'dogfood base (union of seed base trees)']);
  return git(['rev-parse', 'HEAD']);
}

// Advance the fabric-head git branch to match the current fabric selvage tree, so
// the NEXT batch's agents fork from a commit whose tree == the sealed fabric (their
// diffs are then ONLY their own patch, never a spurious revert of prior batches).
function syncFabricHead() {
  cli(['restore', 'selvage', '--to', REPO, '--force']);
  git(['add', '-A']);
  // May be a no-op if nothing changed on disk; tolerate.
  try { git(['commit', '-qam', 'fabric-head sync']); } catch { /* nothing to commit */ }
  return git(['rev-parse', 'HEAD']);
}

/** grade + fabric-verify (the FULL run does this once, after the last session). */
function finalize() {
  let grade = null;
  try { grade = cliJson(['grade', '--json']); } catch (e) { grade = { __error: String(e.message).slice(0, 200) }; }
  fs.writeFileSync(path.join(here, `grade${SUFFIX}.json`), JSON.stringify(grade, null, 2));
  let verify = null;
  try { verify = cliJson(['fabric', 'verify', '--json']); } catch (e) { verify = { __error: String(e.message).slice(0, 200) }; }
  fs.writeFileSync(path.join(here, `fabric-verify${SUFFIX}.json`), JSON.stringify(verify, null, 2));
  console.log(`grade moat: ${JSON.stringify(grade && grade.moat)}`);
  console.log(`fabric verify failures: ${verify && verify.failures ? verify.failures.length : verify && verify.ok !== undefined ? (verify.ok ? 0 : '?') : '?'}`);
  return { grade, verify };
}

async function run() {
  if (FINALIZE) { finalize(); return; }

  const allSessions = manifest.sessions;
  const selected = sessionFilter ? allSessions.filter((s) => s.sessionId === sessionFilter) : allSessions;
  if (sessionFilter && selected.length === 0) throw new Error(`unknown session ${sessionFilter}`);
  const isFirst = !sessionFilter || selected[0].sessionId === allSessions[0].sessionId;

  let fabricHead;
  if (isFirst) {
    const baseCommit = buildRepo();
    // Genesis pick creates the fabric at the base commit (no `warpline init` verb).
    cli(['pick', '--ref', baseCommit, '-m', 'genesis: dogfood base', '--agent', 'seed'], { WARPLINE_AGENT_ID: 'seed' });
    fabricHead = baseCommit;
    fs.writeFileSync(RESULTS, '');
  } else {
    // Resuming a later session: the previous session's last syncFabricHead left
    // the repo HEAD == the sealed selvage tree. Results APPEND.
    fabricHead = git(['rev-parse', 'HEAD']);
  }

  const rows = [];
  let executedBatches = 0;
  let skipping = !!fromBatch;
  let firstExecuted = true;

  outer:
  for (const session of selected) {
    for (const batch of session.batches) {
      if (skipping) {
        if (batch.batchId === fromBatch) skipping = false;
        else continue;
      }
      if (executedBatches >= maxBatches) break outer;
      executedBatches++;
      const isPartialResume = firstExecuted && resumePartial > 0;
      firstExecuted = false;

      let batchBase = fabricHead; // tree == current selvage
      const commits = {};

      if (isPartialResume) {
        // The crashed process already built ALL agent branches for this batch and
        // scratched ALL agents; admits [0, resumePartial) sealed (their scratch refs
        // were cleared on seal). Reuse the surviving state verbatim: same commits,
        // same scratch bases — the protocol continues exactly where it stopped.
        for (const a of batch.admits) commits[a.agent] = git(['rev-parse', `${batch.batchId}-${a.agent}`]);
        batchBase = git(['rev-parse', `${batch.batchId}-${batch.admits[0].agent}^`]);
      } else {
        // 1. Build each agent's commit off the batch base (apply its seed patch;
        //    a churn slot applies the retirement tombstone of its target module).
        for (const a of batch.admits) {
          const branch = `${batch.batchId}-${a.agent}`;
          git(['checkout', '-q', '-B', branch, batchBase]);
          if (a.churnTarget) {
            const target = seeds.get(a.churnTarget);
            writeFiles(churnTombstone(target, a.churnIndex));
            git(['add', '-A']);
            git(['commit', '-qam', `${a.agent}:churn-retire:${a.churnTarget}`]);
          } else {
            const seed = seeds.get(a.seed);
            writeFiles(a.side === 'A' ? seed.patchA : seed.patchB);
            git(['add', '-A']);
            git(['commit', '-qam', `${a.agent}:${a.seed}:${a.side}`]);
          }
          commits[a.agent] = git(['rev-parse', 'HEAD']);
        }

        // 2. All agents scratch at the SAME selvage S0 (BEFORE any admit).
        for (const a of batch.admits) cli(['scratch', a.agent]);
      }
      if (process.env.DOGFOOD_DEBUG) {
        for (const a of batch.admits) {
          const sc = fs.readFileSync(path.join(REPO, '.warpline/refs/scratch', a.agent), 'utf8').trim();
          console.log(`  [scratch ${batch.batchId}/${a.agent}] base=${sc.slice(-12)}`);
        }
        console.log(`  [selvage ${batch.batchId}] ${fs.readFileSync(path.join(REPO, '.warpline/refs/selvage'), 'utf8').trim().slice(-12)}`);
      }

      // 3. Serial admit. Track the git commit "behind the current selvage" for the
      //    Column-A counterfactual (theirs = the immediately-preceding sibling).
      // On partial resume, theirs = the last already-sealed sibling's commit.
      let prevSiblingCommit = isPartialResume ? commits[batch.admits[resumePartial - 1].agent] : null;
      for (let i = isPartialResume ? resumePartial : 0; i < batch.admits.length; i++) {
        const a = batch.admits[i];
        const oursCommit = commits[a.agent];
        const started = Date.now();
        let res;
        try {
          res = cliJson(['admit', a.agent, '--ref', oursCommit, '--json'], { WARPLINE_AGENT_ID: a.agent });
        } catch (e) {
          res = { __error: String(e.message).slice(0, 400), decision: { status: 'ERROR' } };
        }
        const ms = Date.now() - started;
        const d = res.decision || {};
        const status = d.status;
        const concurrent = status !== 'FAST_ADMIT' && status !== 'NOOP' && status !== 'ERROR';

        // Column A — git counterfactual (only meaningful for concurrent admits).
        // theirs = the previous sibling's commit (the immediately-preceding landed
        // sibling, §2.1); base = the batch base. For the FIRST concurrent admit,
        // theirs = the FAST agent's commit.
        let counterfactual = null;
        const theirs = prevSiblingCommit;
        if (concurrent && theirs) {
          counterfactual = await gitCounterfactual(REPO, theirs, oursCommit);
        }

        const symbolBearing =
          (d.agentChanged || []).some((s) => s.startsWith('#')) ||
          (d.otherChanged || []).some((s) => s.startsWith('#'));

        // Row-level stratum/truth: a single-sided application of a pair seed is an
        // INDEPENDENT row (its interaction is with OTHER seeds' symbols), so the
        // manifest may override the seed-level stratum/truth per admission.
        const seedRef = a.churnTarget ? seeds.get(a.churnTarget) : seeds.get(a.seed);
        const row = {
          sessionId: session.sessionId,
          batchId: batch.batchId,
          seedId: a.churnTarget ? `churn:${a.churnTarget}` : a.seed,
          stratum: a.churnTarget ? 'CHURN-RETIRE' : (a.stratumRow ?? seedRef.stratum),
          truth: a.churnTarget ? 'churn' : (a.rowTruth ?? seedRef.truth),
          agentId: a.agent,
          side: a.side ?? 'churn',
          role: a.role,
          expect: a.expect ?? null,
          status,
          confidence: d.confidence ?? null,
          sealed: res.sealed ?? false,
          isMerge: !!(res.strand && res.strand.merged),
          concurrent,
          symbolBearing,
          agentChanged: d.agentChanged || [],
          otherChanged: d.otherChanged || [],
          knots: (d.knots || []).map((k) => k.symbol),
          dangling: (d.dangling || []).map((x) => `${x.fromSymbol}->${x.danglingTargetSymbol}`),
          rebasedOnto: d.rebasedOnto ? d.rebasedOnto.slice(-12) : null,
          strandSeq: res.strand ? res.strand.seq : null,
          bindingTreeId: res.strand && res.strand.binding ? res.strand.binding.treeId : null,
          oursCommit,
          theirsCommit: theirs,
          batchBaseCommit: batchBase,
          gitConflicted: counterfactual ? counterfactual.gitConflicted : null,
          gitConflictPaths: counterfactual ? counterfactual.conflictPaths : null,
          gitMergeClean: counterfactual ? counterfactual.mergeClean : null,
          ms,
          error: res.__error ?? null,
        };
        rows.push(row);
        fs.appendFileSync(RESULTS, JSON.stringify(row) + '\n');
        console.log(
          `[${batch.batchId} ${a.agent} ${a.seed}/${a.side}] ${status}` +
          (d.confidence ? `/${d.confidence}` : '') +
          ` sealed=${row.sealed} merge=${row.isMerge} concurrent=${concurrent}` +
          (counterfactual ? ` gitConflicted=${counterfactual.gitConflicted}` : '') +
          ` ${ms}ms`,
        );

        // Update the "previous sibling" pointer to the commit git would 3-way this
        // admit against next. Every admit that PROPOSED a change is a landed sibling
        // for the counterfactual, sealed or not (a KNOT is still a real proposal).
        prevSiblingCommit = oursCommit;
      }

      // 4. Sync fabric-head to the sealed selvage tree for the next batch.
      fabricHead = syncFabricHead();
    }
  }

  const concurrentCount = rows.filter((r) => r.concurrent).length;
  console.log(`\nDONE — ${rows.length} admissions, ${concurrentCount} concurrent -> ${RESULTS}`);

  // Grade + verify at the end of a whole-run invocation (pilot behavior). Session-
  // filtered FULL invocations finalize separately (node swarm.mjs --full --finalize).
  if (!sessionFilter) finalize();
}

run().catch((e) => { console.error('SWARM ERROR', e); process.exit(1); });
