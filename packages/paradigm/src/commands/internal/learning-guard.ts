/**
 * paradigm internal learning-guard [--staged] — the scoped learning S2
 * pre-commit check (#learning-commit-guard). Reads the staged `.paradigm/**`
 * data files and refuses the commit (exit 1, violations on stderr) when one
 * carries a home: user/machine row, a machine path, or (public visibility,
 * the default) a human_feedback entry without home: repo.
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

/** Staged `.paradigm/**` data files (added, copied, modified, renamed) with their staged content. */
export function stagedGuardFiles(root: string): GuardFile[] {
  const names = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean);
  return names.filter(isGuardedPath).map(p => ({ path: p, content: git(root, ['show', `:${p}`]) }));
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

export async function learningGuardCommand(_options: { staged?: boolean } = {}): Promise<void> {
  let root: string;
  let files: GuardFile[];
  try {
    root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
    files = stagedGuardFiles(root);
  } catch {
    return; // not a git repo / git unavailable: nothing to guard
  }
  const violations = runLearningGuard(root, files);
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
  process.stderr.write('[paradigm] commit refused: staged learning data must stay repo-home and machine-free\n');
  for (const v of violations) {
    process.stderr.write(`  ${v.path}${v.line ? `:${v.line}` : ''} [${v.rule}] ${v.detail}\n`);
  }
  process.stderr.write(`  Unstage these rows, set home: repo where it belongs, or commit once with PARADIGM_OVERRIDE=${LEARNING_GUARD_OVERRIDE_ID} (logged).\n`);
  process.exitCode = 1;
}
