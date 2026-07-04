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

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'run-manifest.json'), 'utf8'));
const CLI = manifest.cli;
const RUN_DIR = process.argv[2] || path.join(
  '/private/tmp/claude-501/-Users-ascend-Documents-GitHub-a-paradigm/4809f9c5-1b81-447f-b8e8-98878157545f/scratchpad/warpline-dogfood-run',
  'pilot',
);
const REPO = path.join(RUN_DIR, 'repo');
const RESULTS = path.join(here, 'results-swarm.jsonl');

// Load seeds by id.
const seeds = new Map();
for (const line of fs.readFileSync(path.join(here, 'seed-catalog.jsonl'), 'utf8').split('\n')) {
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
  git(['init', '-q']);
  git(['config', 'user.name', 'dogfood-harness']);
  git(['config', 'user.email', 'dogfood@local']);
  // CRITICAL: keep .warpline out of the agent commit trees (else the merged tree
  // carries a .warpline entry and restore/native-merge fail closed on it).
  fs.writeFileSync(path.join(REPO, '.gitignore'), '.warpline/\nnode_modules/\n');
  fs.writeFileSync(path.join(REPO, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, module: 'esnext', target: 'esnext', moduleResolution: 'bundler' },
  }, null, 2) + '\n');
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

async function run() {
  const baseCommit = buildRepo();
  // Genesis pick creates the fabric at the base commit (no `warpline init` verb).
  cli(['pick', '--ref', baseCommit, '-m', 'genesis: dogfood base', '--agent', 'seed'], { WARPLINE_AGENT_ID: 'seed' });
  let fabricHead = baseCommit;

  const rows = [];
  fs.writeFileSync(RESULTS, '');

  for (const session of manifest.sessions) {
    for (const batch of session.batches) {
      const batchBase = fabricHead; // tree == current selvage
      const batchBaseSelvage = git(['rev-parse', 'HEAD']); // == fabricHead

      // 1. Build each agent's commit off the batch base (apply its seed patch).
      const commits = {};
      for (const a of batch.admits) {
        const seed = seeds.get(a.seed);
        const branch = `${batch.batchId}-${a.agent}`;
        git(['checkout', '-q', '-B', branch, batchBase]);
        writeFiles(a.side === 'A' ? seed.patchA : seed.patchB);
        git(['add', '-A']);
        git(['commit', '-qam', `${a.agent}:${a.seed}:${a.side}`]);
        commits[a.agent] = git(['rev-parse', 'HEAD']);
      }

      // 2. All agents scratch at the SAME selvage S0 (BEFORE any admit).
      for (const a of batch.admits) cli(['scratch', a.agent]);
      if (process.env.DOGFOOD_DEBUG) {
        for (const a of batch.admits) {
          const sc = fs.readFileSync(path.join(REPO, '.warpline/refs/scratch', a.agent), 'utf8').trim();
          console.log(`  [scratch ${batch.batchId}/${a.agent}] base=${sc.slice(-12)}`);
        }
        console.log(`  [selvage ${batch.batchId}] ${fs.readFileSync(path.join(REPO, '.warpline/refs/selvage'), 'utf8').trim().slice(-12)}`);
      }

      // 3. Serial admit. Track the git commit "behind the current selvage" for the
      //    Column-A counterfactual (theirs = the immediately-preceding sibling).
      let prevSiblingCommit = null; // the sibling that established the last advance
      for (let i = 0; i < batch.admits.length; i++) {
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

        const row = {
          sessionId: session.sessionId,
          batchId: batch.batchId,
          seedId: a.seed,
          stratum: seeds.get(a.seed).stratum,
          truth: seeds.get(a.seed).truth,
          agentId: a.agent,
          side: a.side,
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

  // Grade the whole fabric (moat signal) once, at the end.
  let grade = null;
  try { grade = cliJson(['grade', '--json']); } catch (e) { grade = { __error: String(e.message).slice(0, 200) }; }
  fs.writeFileSync(path.join(here, 'grade.json'), JSON.stringify(grade, null, 2));

  // Fabric verify (must stay intact — throwaway fabric integrity).
  let verify = null;
  try { verify = cliJson(['fabric', 'verify', '--json']); } catch (e) { verify = { __error: String(e.message).slice(0, 200) }; }
  fs.writeFileSync(path.join(here, 'fabric-verify.json'), JSON.stringify(verify, null, 2));

  const concurrentCount = rows.filter((r) => r.concurrent).length;
  console.log(`\nDONE — ${rows.length} admissions, ${concurrentCount} concurrent -> ${RESULTS}`);
  console.log(`grade moat: ${JSON.stringify(grade && grade.moat)}`);
  console.log(`fabric verify failures: ${verify && verify.failures ? verify.failures.length : '?'}`);
}

run().catch((e) => { console.error('SWARM ERROR', e); process.exit(1); });
