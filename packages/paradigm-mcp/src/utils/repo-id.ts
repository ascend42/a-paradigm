/**
 * repoIdOf — the stable id a repository's user-home and machine-home learning
 * stores are keyed by (scoped learning S0, TD-2026-10-28-820).
 *
 * PARITY: this is a deliberate duplicate of gnomon's `repoIdOf`
 * (packages/gnomon/src/kernel/supervisor/local-session.ts). paradigm and
 * paradigm-mcp pin a published @a-company/gnomon that does not export it, so
 * the algorithm is copied and `repo-id.test.ts` fails if the two drift:
 *   1. `.gnomon/project.yaml` `repoId:` when present (same regex);
 *   2. else `path:` + the first 16 hex chars of sha256(realpath(root)).
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** The project a repository's learning is recorded under. Never throws. */
export function repoIdOf(root: string): string {
  try {
    const m = /^repoId:\s*['"]?([A-Za-z0-9._:/-]{1,128})['"]?\s*$/m.exec(
      fs.readFileSync(path.join(root, '.gnomon', 'project.yaml'), 'utf8'),
    );
    if (m) return m[1]!;
  } catch {
    /* no project.yaml */
  }
  let real = root;
  try {
    real = fs.realpathSync(root);
  } catch {
    /* keep root */
  }
  return `path:${createHash('sha256').update(real).digest('hex').slice(0, 16)}`;
}

/**
 * The repo id as one filesystem-safe path segment (Windows forbids `:`, and a
 * project.yaml id may hold `/`). Every character outside [A-Za-z0-9._-] → `-`.
 */
export function repoIdSegment(root: string): string {
  return repoIdOf(root).replace(/[^A-Za-z0-9._-]/g, '-');
}
