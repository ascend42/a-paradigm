/**
 * paradigm internal learn-path <artifact> [--root <dir>] — print the file a
 * learning-store row of <artifact> is appended to (scoped learning S2,
 * TD-2026-10-28-820).
 *
 * The hook writers (overrides, team-funnel, compliance-history, hook-timings)
 * call it through `_pm_learn_path` in paradigm-resolve.sh, which caches the
 * answer in `.paradigm/.sessions/learn-paths` keyed by the physical root and
 * $PARADIGM_LEARNING_HOME, so a hook pays the node start only on a miss (and
 * again after the repo moves).
 *
 * Output: one absolute path on stdout, nothing else. On any failure (unknown
 * artifact, no home directory, the guard refusing the path) nothing is
 * printed and the exit code is 1, so the hook skips its write instead of
 * landing a row in the wrong home. Never prints a relative path.
 *
 * Symbol: #learn-path-command
 */

import * as path from 'path';
import {
  ARTIFACTS,
  effectiveHome,
  homeOf,
  isLearningHome,
  pathFor,
  readLearningHomeConfig,
  type LearningArtifact,
  type LearningHome,
} from '../../../../paradigm-mcp/src/utils/learning-stores.js';

export interface LearnPathOptions {
  root?: string;
  /** Explicit home (beats config and the registry default). */
  home?: string;
}

export function isLearningArtifact(v: string): v is LearningArtifact {
  return Object.prototype.hasOwnProperty.call(ARTIFACTS, v);
}

/** The resolved, guarded path. Throws on an unknown artifact or a misplaced home. */
export function resolveLearnPath(artifact: string, options: LearnPathOptions = {}): string {
  if (!isLearningArtifact(artifact)) throw new Error(`unknown learning artifact: ${artifact}`);
  const root = path.resolve(options.root ?? process.cwd());
  if (options.home !== undefined && !isLearningHome(options.home)) throw new Error(`unknown home: ${options.home}`);
  const explicit = options.home as LearningHome | undefined;
  const home = effectiveHome(homeOf(artifact, explicit ? { home: explicit } : null, readLearningHomeConfig(root)), root);
  const p = pathFor(artifact, home, root);
  if (!path.isAbsolute(p)) throw new Error(`resolved a relative path: ${p}`);
  return p;
}

export async function learnPathCommand(artifact: string, options: LearnPathOptions = {}): Promise<void> {
  try {
    process.stdout.write(resolveLearnPath(artifact, options) + '\n');
  } catch {
    process.exitCode = 1;
  }
}
