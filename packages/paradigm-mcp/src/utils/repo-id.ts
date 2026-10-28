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
  return resolveRepoId(root).id;
}

/** repoIdOf plus where the id came from (gnomon project.yaml, or the path hash). */
function resolveRepoId(root: string): { id: string; source: 'gnomon' | 'hash' } {
  try {
    const m = /^repoId:\s*['"]?([A-Za-z0-9._:/-]{1,128})['"]?\s*$/m.exec(
      fs.readFileSync(path.join(root, '.gnomon', 'project.yaml'), 'utf8'),
    );
    if (m) return { id: m[1]!, source: 'gnomon' };
  } catch {
    /* no project.yaml */
  }
  let real = root;
  try {
    real = fs.realpathSync(root);
  } catch {
    /* keep root */
  }
  return { id: `path:${createHash('sha256').update(real).digest('hex').slice(0, 16)}`, source: 'hash' };
}

/**
 * The repo id as one filesystem-safe path segment, prefixed by its source so
 * two sources can never collide (review F7):
 *   `h-<16 hex>`  — the path-hash fallback
 *   `g-<id>`      — a gnomon project.yaml repoId; when sanitising changed it
 *                   (Windows forbids `:`, ids may hold `/`), `-<8 hex>` of the
 *                   raw id is appended so `a/b` and `a-b` stay distinct.
 */
export function repoIdSegment(root: string): string {
  const { id, source } = resolveRepoId(root);
  if (source === 'hash') return `h-${id.slice('path:'.length)}`;
  const safe = id.replace(/[^A-Za-z0-9._-]/g, '-');
  return safe === id ? `g-${id}` : `g-${safe}-${createHash('sha256').update(id).digest('hex').slice(0, 8)}`;
}
