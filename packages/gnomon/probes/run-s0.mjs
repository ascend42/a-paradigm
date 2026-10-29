#!/usr/bin/env node
// S0 probe runner (TD-2026-10-29-746): P1 p15-sea-peertoken, P2 p16-se-ephemeral, P3 p17-se-afterfirstunlock, in
// order, each through run.mjs (results in probes/results/<id>.darwin.json). Prints one PASS / PARTIAL / FAIL line per
// probe with its claims. Founder: `node packages/gnomon/probes/run-s0.mjs` (Developer ID signed where a probe needs
// it). GNOMON_PROBE_ADHOC=1: the agent-run, ad-hoc half (P1 partial, P3 blocked on prerequisites).
// Exit 0 when every probe passed, 1 on any fail, 2 otherwise.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv.includes('--out-dir') ? path.resolve(process.argv[process.argv.indexOf('--out-dir') + 1]) : path.join(DIR, 'results');
const PROBES = [['P1', 'p15-sea-peertoken'], ['P2', 'p16-se-ephemeral'], ['P3', 'p17-se-afterfirstunlock']];
const verdicts = [];
for (const [p, id] of PROBES) {
  spawnSync(process.execPath, [path.join(DIR, 'run.mjs'), id, '--timeout', '900000', '--out-dir', outDir], { stdio: ['inherit', 'ignore', 'ignore'] });
  let r;
  try {
    r = JSON.parse(readFileSync(path.join(outDir, `${id}.${process.platform}.json`), 'utf8'));
  } catch {
    r = { verdict: 'fail', evidence: { summary: 'no result file' } };
  }
  verdicts.push(r.verdict);
  const detail = r.evidence?.summary ?? r.evidence?.message ?? r.evidence?.skipped ?? JSON.stringify(r.evidence?.harnessError ?? r.evidence).slice(0, 400);
  process.stdout.write(`${p} ${id}: ${r.verdict === 'pass' ? 'PASS' : r.verdict === 'partial' ? 'PARTIAL' : 'FAIL'} — ${detail}\n`);
}
process.exitCode = verdicts.includes('fail') ? 1 : verdicts.every((v) => v === 'pass') ? 0 : 2;
