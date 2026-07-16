/**
 * #guard-main — the GitHub Action entrypoint (composite step: `node dist/main.js`).
 *
 * Flow: resolve base/head refs (inputs, else the pull_request event payload) →
 * run the warpline oracle read-only (it computes the merge-base itself) →
 * buildReport (threshold + paths filter) → job summary + JSON artifact +
 * step outputs → exit code.
 *
 * Exit policy (advisory-first):
 *   - verdicts NEVER fail the step unless `fail-on-flag: true`;
 *   - with fail-on-flag true, an in-stratum flag fails AND an engine error
 *     fails (fail closed — an enforcing check must not pass on silence);
 *   - a configuration error (no refs resolvable) always fails: that is a
 *     broken workflow, not a verdict.
 *
 * This is action-runner code, not Paradigm library/CLI code: stdout via
 * process.stdout is the GitHub Actions convention, confined to this file.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { oracle } from '@a-company/warpline';
import { buildReport, DEFAULT_THRESHOLD, SCOPE_LINE } from './report.js';
import { renderLog, renderSummary } from './render.js';

interface Inputs {
  baseRef: string;
  headRef: string;
  threshold: number;
  paths: string[];
  failOnFlag: boolean;
  workingDirectory: string;
  reportPath: string;
}

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

function log(line: string): void {
  process.stdout.write(line + '\n');
}

/** Resolve base/head: explicit inputs win; else the pull_request event payload. */
function resolveRefs(baseInput: string, headInput: string): { baseRef: string; headRef: string } {
  let baseRef = baseInput;
  let headRef = headInput;
  if (!baseRef || !headRef) {
    const eventPath = env('GITHUB_EVENT_PATH');
    if (eventPath && fs.existsSync(eventPath)) {
      try {
        const event = JSON.parse(fs.readFileSync(eventPath, 'utf8')) as {
          pull_request?: { base?: { sha?: string; ref?: string }; head?: { sha?: string } };
        };
        const pr = event.pull_request;
        if (pr) {
          baseRef = baseRef || pr.base?.sha || pr.base?.ref || '';
          headRef = headRef || pr.head?.sha || '';
        }
      } catch {
        // fall through to the explicit error below
      }
    }
  }
  if (!baseRef || !headRef) {
    throw new ConfigError(
      'cannot resolve base/head: set the `base-ref` and `head-ref` inputs, or run on a ' +
        '`pull_request` event (the action reads base.sha / head.sha from the event payload). ' +
        'Checkout must use `fetch-depth: 0` so both refs and their merge-base exist locally.',
    );
  }
  return { baseRef, headRef };
}

class ConfigError extends Error {}

function readInputs(): Inputs {
  const { baseRef, headRef } = resolveRefs(env('WARPLINE_INPUT_BASE_REF'), env('WARPLINE_INPUT_HEAD_REF'));
  const thresholdRaw = env('WARPLINE_INPUT_THRESHOLD');
  const threshold = thresholdRaw === '' ? DEFAULT_THRESHOLD : Number(thresholdRaw);
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new ConfigError(`invalid \`threshold\` input: ${JSON.stringify(thresholdRaw)} (need an integer ≥ 0)`);
  }
  const failRaw = env('WARPLINE_INPUT_FAIL_ON_FLAG').toLowerCase();
  if (failRaw && failRaw !== 'true' && failRaw !== 'false') {
    throw new ConfigError(`invalid \`fail-on-flag\` input: ${JSON.stringify(failRaw)} (need "true" or "false")`);
  }
  return {
    baseRef,
    headRef,
    threshold,
    paths: env('WARPLINE_INPUT_PATHS')
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean),
    failOnFlag: failRaw === 'true',
    workingDirectory: env('WARPLINE_INPUT_WORKING_DIRECTORY') || '.',
    reportPath: env('WARPLINE_INPUT_REPORT_PATH') || 'warpline-guard-report.json',
  };
}

function appendFileIfSet(envName: string, content: string): void {
  const target = env(envName);
  if (target) fs.appendFileSync(target, content);
}

function writeOutputs(outputs: Record<string, string>): void {
  const lines = Object.entries(outputs)
    .map(([k, v]) => `${k}=${v}\n`)
    .join('');
  appendFileIfSet('GITHUB_OUTPUT', lines);
}

async function run(): Promise<number> {
  const inputs = readInputs();
  const cwd = path.resolve(inputs.workingDirectory);

  log('Warpline Guard: running the oracle (read-only) …');
  log(`  base ${inputs.baseRef} × head ${inputs.headRef}  (cwd ${cwd})`);

  const started = Date.now();
  const record = await oracle(inputs.baseRef, inputs.headRef, { cwd, noWrite: true });
  const elapsedMs = Date.now() - started;

  const report = buildReport(record, {
    threshold: inputs.threshold,
    paths: inputs.paths,
    failOnFlag: inputs.failOnFlag,
  });

  // JSON artifact for machine consumption.
  const reportPath = path.resolve(cwd, inputs.reportPath);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ ...report, elapsedMs }, null, 2) + '\n');

  // Job summary + step outputs + log.
  appendFileIfSet('GITHUB_STEP_SUMMARY', renderSummary(report));
  writeOutputs({
    verdict: report.verdict,
    'knot-size': String(report.knotSize),
    'flag-count': String(report.flagCount),
    'report-path': reportPath,
  });
  for (const line of renderLog(report)) log(line);
  log(`  oracle run: ${(elapsedMs / 1000).toFixed(1)}s  report: ${reportPath}`);

  if (report.shouldFail) {
    log('fail-on-flag is true and the merge is in-stratum FLAGGED — failing the check.');
    return 1;
  }
  return 0;
}

async function main(): Promise<void> {
  try {
    process.exitCode = await run();
  } catch (err) {
    const isConfig = err instanceof ConfigError;
    const failOnFlag = env('WARPLINE_INPUT_FAIL_ON_FLAG').toLowerCase() === 'true';
    const message = err instanceof Error ? err.message : String(err);
    log(`Warpline Guard ${isConfig ? 'configuration' : 'engine'} error: ${message}`);
    appendFileIfSet(
      'GITHUB_STEP_SUMMARY',
      `## Warpline Guard — merge adjudication\n\n**${
        isConfig ? 'CONFIGURATION ERROR' : 'ENGINE ERROR'
      }** — no verdict.\n\n\`\`\`\n${message}\n\`\`\`\n\n_${SCOPE_LINE}_\n`,
    );
    writeOutputs({ verdict: 'error', 'knot-size': '', 'flag-count': '', 'report-path': '' });
    // config errors always fail; engine errors fail only when the check is
    // enforcing (fail closed) — advisory runs stay green on engine error.
    process.exitCode = isConfig || failOnFlag ? 1 : 0;
  }
}

void main();
