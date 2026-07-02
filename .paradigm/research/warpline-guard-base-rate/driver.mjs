#!/usr/bin/env node
// Guard base-rate driver: run warpline oracle on the parents of the N most
// recent 2-parent merge commits of a repo. Usage: node driver.mjs <repoDir> <N>
import { execFileSync, execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CLI = '/Users/ascend/Documents/GitHub/a-paradigm/packages/warpline/dist/cli.js';
const repoDir = path.resolve(process.argv[2]);
const N = Number(process.argv[3] ?? 30);
const TIMEOUT_MS = 180_000;
const name = path.basename(repoDir);
const outFile = path.join(path.dirname(repoDir), `results-${name}.jsonl`);

const git = (args) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();

// N most recent strictly-2-parent merges
const lines = git(['log', '--merges', '--min-parents=2', '--max-parents=2',
  `--format=%H %P`, `-${N}`]).split('\n').filter(Boolean);

fs.writeFileSync(outFile, '');
let i = 0;
for (const line of lines) {
  i++;
  const [merge, p1, p2] = line.split(' ');
  const started = Date.now();
  const rec = { repo: name, merge, p1, p2, idx: i };
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile('node', [CLI, 'oracle', p1, p2, '--json'], {
        cwd: repoDir, timeout: TIMEOUT_MS, maxBuffer: 512 * 1024 * 1024, encoding: 'utf8',
      }, (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr, stdout })) : resolve(stdout));
    });
    const r = JSON.parse(stdout);
    rec.ok = true;
    rec.ms = Date.now() - started;
    rec.mergeClean = r.mergeClean;
    rec.gitConflicted = r.gitReality.conflicted;
    rec.conflictPaths = r.gitReality.conflictPaths;
    rec.verdict = r.convergence.verdict;
    rec.score = r.convergence.score;
    rec.agreeClean = r.convergence.agreeClean.length;
    rec.agreeConflict = r.convergence.agreeConflict;
    rec.divergeGitOnly = r.convergence.divergeGitOnly;
    rec.divergeMeaningOnly = r.convergence.divergeMeaningOnly;
    rec.gitConflictUnmapped = r.convergence.gitConflictUnmapped;
    rec.knots = r.prediction.knots.map(k => ({ symbol: k.symbol, kind: k.kind ?? k.reason ?? null }));
    rec.dangling = r.prediction.dangling.length;
    rec.autoClean = r.prediction.autoClean.length;
  } catch (e) {
    rec.ok = false;
    rec.ms = Date.now() - started;
    rec.errorClass = e.killed || /ETIMEDOUT/.test(String(e.code)) ? 'timeout'
      : e.stdout && e.stdout.length === 0 && e.stderr ? 'cli-error' : 'other';
    rec.error = String(e.message).slice(0, 400);
    rec.stderr = String(e.stderr ?? '').slice(0, 600);
  }
  fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
  console.log(`[${name} ${i}/${lines.length}] ${merge.slice(0, 8)} ok=${rec.ok} ` +
    (rec.ok ? `verdict=${rec.verdict} meaningOnly=${rec.divergeMeaningOnly.length} gitConf=${rec.gitConflicted} ${rec.ms}ms`
            : `err=${rec.errorClass} ${rec.ms}ms`));
}
console.log(`DONE ${name} -> ${outFile}`);
