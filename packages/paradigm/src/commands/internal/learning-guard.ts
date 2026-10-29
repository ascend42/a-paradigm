/**
 * paradigm internal learning-guard [--staged] — the scoped learning S2
 * pre-commit check (#learning-commit-guard). Reads the staged `.paradigm/**`
 * data files and refuses the commit (exit 1, violations on stderr) when one
 * carries a home: user/machine row, a machine path, or (public visibility,
 * the default) a human-taught entry whose home was only inferred
 * (home_source: inferred; S3).
 *
 * Escape: PARADIGM_OVERRIDE=learning-guard. Its use is logged as an override
 * row (mechanism env) through the learning-stores resolver.
 *
 * Symbol: #learning-guard-command
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';

import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  LEARNING_GUARD_OVERRIDE_ID,
  LEARNING_GUARD_REFUSAL,
  isGuardedPath,
  learningGuardOverridden,
  learningGuardViolations,
  visibilityOf,
  type GuardFile,
  type GuardViolation,
} from '../../../../paradigm-mcp/src/utils/learning-commit-guard.js';
import { appendLearningRows, machineStateDir, safeHomeDir } from '../../../../paradigm-mcp/src/utils/learning-stores.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

/** The lines `git diff --cached -U0` adds to one file. */
export function addedLines(diff: string): string[] {
  return diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1));
}

/**
 * Staged learning-store data files with what the commit ADDS: JSONL added
 * lines; YAML/JSON staged content plus the HEAD content when the file existed.
 */
export function stagedGuardFiles(root: string): GuardFile[] {
  const parts = git(root, ['diff', '--cached', '--name-status', '--no-renames', '--diff-filter=AM', '-z']).split('\0').filter(Boolean);
  const files: GuardFile[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i];
    const p = parts[i + 1];
    if (!isGuardedPath(p)) continue;
    const content = git(root, ['show', `:${p}`]);
    if (p.endsWith('.jsonl')) {
      const added = status === 'A' ? undefined : addedLines(git(root, ['diff', '--cached', '-U0', '--no-ext-diff', '--no-color', '--', p]));
      files.push({ path: p, content, added });
    } else {
      let previous: string | undefined;
      if (status !== 'A') {
        try { previous = git(root, ['show', `HEAD:${p}`]); } catch { previous = undefined; }
      }
      files.push({ path: p, content, previous });
    }
  }
  return files;
}

function localPaths(): string[] {
  const out: string[] = [];
  try { out.push(safeHomeDir()); } catch { /* none */ }
  if (process.env.PARADIGM_LEARNING_HOME) out.push(process.env.PARADIGM_LEARNING_HOME);
  try { out.push(machineStateDir()); } catch { /* none */ }
  return out.filter(p => p && path.isAbsolute(p));
}

export function runLearningGuard(root: string, files: GuardFile[]): GuardViolation[] {
  let config: unknown = null;
  try {
    config = yaml.load(fs.readFileSync(path.join(root, '.paradigm', 'config.yaml'), 'utf8'));
  } catch { /* no config: public */ }
  return learningGuardViolations(files, { visibility: visibilityOf(config), localPaths: localPaths() });
}

/**
 * Exit codes: 1 ONLY for a real violation (with the refusal line on stderr);
 * 0 when clean, overridden, or not a git repo; 2 on an internal error, which
 * the hook treats as fail-open.
 */
export async function learningGuardCommand(_options: { staged?: boolean } = {}): Promise<void> {
  let root: string;
  let files: GuardFile[];
  try {
    root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  } catch {
    return; // not a git repo / git unavailable: nothing to guard
  }
  let violations: GuardViolation[];
  try {
    files = stagedGuardFiles(root);
    violations = runLearningGuard(root, files);
  } catch (err) {
    process.stderr.write(`[paradigm] learning guard skipped (internal error: ${err instanceof Error ? err.message : String(err)})\n`);
    process.exitCode = 2;
    return;
  }
  if (violations.length === 0) return;
  if (learningGuardOverridden(process.env.PARADIGM_OVERRIDE)) {
    try {
      appendLearningRows('overrides', root, [{
        timestamp: new Date().toISOString(),
        remediation_id: LEARNING_GUARD_OVERRIDE_ID,
        claimant: 'learning-guard',
        mechanism: 'env',
        unblock_predicate_matched: false,
        violations: violations.length,
      }]);
    } catch { /* logging is best-effort; the override still applies */ }
    process.stderr.write(`[paradigm] learning guard overridden (PARADIGM_OVERRIDE=${LEARNING_GUARD_OVERRIDE_ID}); ${violations.length} violation(s) logged\n`);
    return;
  }
  process.stderr.write(`${LEARNING_GUARD_REFUSAL} must stay repo-home and free of this machine's paths\n`);
  for (const v of violations) {
    process.stderr.write(`  ${v.path}${v.line ? ` (added line ${v.line})` : ''} [${v.rule}] ${v.detail}\n`);
  }
  process.stderr.write(`  Unstage these rows, set home: repo where it belongs, or commit once with PARADIGM_OVERRIDE=${LEARNING_GUARD_OVERRIDE_ID} (logged).\n`);
  process.exitCode = 1;
}
