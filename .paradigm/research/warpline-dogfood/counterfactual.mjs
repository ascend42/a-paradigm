// Column A — the GIT counterfactual (harness-spec.md §2.1). Thin reuse of
// scratchpad/base-rate/driver.mjs's `execFile('node',[CLI,'oracle',...])` wrapper,
// VERBATIM (the same per-pair oracle call the base-rate study used), exposed as a
// function the swarm calls per concurrent admission.
//
//   gitCounterfactual(repoDir, theirsSha, oursSha) -> { gitConflicted, conflictPaths, mergeClean, ms, ok }
//
// oracle predicts the merge from meaning AND runs git for real, returning
// gitReality.conflicted — exactly what §2.1 needs for "would git have conflicted?".

import { execFile } from 'node:child_process';

const CLI = '/Users/ascend/Documents/GitHub/a-paradigm/packages/warpline/dist/cli.js';
const TIMEOUT_MS = 180_000;

/** Reuse of driver.mjs's oracle execFile block, verbatim, as a promise. */
export async function gitCounterfactual(repoDir, theirs, ours) {
  const started = Date.now();
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile('node', [CLI, 'oracle', theirs, ours, '--json'], {
        cwd: repoDir, timeout: TIMEOUT_MS, maxBuffer: 512 * 1024 * 1024, encoding: 'utf8',
      }, (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr, stdout })) : resolve(stdout));
    });
    const r = JSON.parse(stdout);
    return {
      ok: true,
      ms: Date.now() - started,
      mergeClean: r.mergeClean,
      gitConflicted: r.gitReality.conflicted,
      conflictPaths: r.gitReality.conflictPaths,
    };
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: String(e.message).slice(0, 300),
      stderr: String(e.stderr ?? '').slice(0, 300),
    };
  }
}
