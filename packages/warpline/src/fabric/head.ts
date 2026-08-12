/**
 * #head — the CURRENT-BRANCH pointer (the git HEAD analog), M2.5 branching
 * foundation (TD-2026-08-12-813, Arky's design). Refs (#fabric-refs) already name
 * history positions; what did NOT exist is a pointer that says WHICH ref the next
 * seal advances — git's `.git/HEAD`. This module adds it, and nothing else.
 *
 * `.warpline/HEAD` is a SYMREF, exactly two shapes (git's, honestly borrowed):
 *   - `ref: refs/heads/<name>`  — attached to a branch; the branch's tip moves
 *                                 as work is admitted.
 *   - `pick:<id>`               — DETACHED at a bare event identity (a read-only
 *                                 vantage on an old position; a seal here would
 *                                 have no branch to advance — that policy is the
 *                                 caller's, not this module's).
 *
 * DEFAULT: an ABSENT HEAD is treated as `refs/heads/selvage` (DEFAULT_BRANCH) so
 * a fabric that has never branched behaves exactly as it did before HEAD existed
 * — the pre-branching world is "always on selvage". readHead reports the absence
 * faithfully (null); resolveHeadTip is the one that applies the default.
 *
 * The branch name is validated through #fabric-refs isRefName — the SAME
 * fail-closed predicate that guards a ref filename — because a symref target is
 * spliced into `refs/heads/<name>` and read back as a filesystem path. No second
 * grammar can drift from the first.
 *
 * Structurally a sibling of refs.ts: atomic + durable publish via
 * atomicWriteSync (#warp-durable), fail-closed reads (a corrupt HEAD is never
 * silently treated as absent).
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteSync } from '../warp/durable.js';
import { warplineDirOf } from './fabric.js';
import { readRef, isRefName } from './refs.js';

/** The branch a fabric is on when no HEAD file has ever been written (git-parity). */
export const DEFAULT_BRANCH = 'selvage';

const SYMREF_PREFIX = 'refs/heads/';

/** What HEAD points at: a branch (symref) or a bare pickId (detached). */
export type HeadTarget =
  | { kind: 'branch'; branch: string }
  | { kind: 'detached'; pickId: string };

function headPath(root: string): string {
  return path.join(warplineDirOf(root), 'HEAD');
}

/**
 * The current HEAD — a branch symref or a detached pickId — or null when the HEAD
 * file does not exist (the caller treats absence as DEFAULT_BRANCH; resolveHeadTip
 * does exactly that). Fails CLOSED: a HEAD that exists but is unreadable or
 * malformed throws rather than masquerading as "no HEAD".
 */
export function readHead(root: string): HeadTarget | null {
  let raw: string;
  try {
    raw = fs.readFileSync(headPath(root), 'utf8').trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(
      `warpline: HEAD unreadable at ${headPath(root)} — refusing to treat a corrupt HEAD as absent: ${(err as Error).message}`,
    );
  }
  if (raw === '') return null; // an empty HEAD is absence, not corruption
  if (raw.startsWith('ref:')) {
    const target = raw.slice('ref:'.length).trim();
    if (!target.startsWith(SYMREF_PREFIX)) {
      throw new Error(`warpline: HEAD symref "${raw}" does not name a ${SYMREF_PREFIX}<name> branch — fail closed`);
    }
    const branch = target.slice(SYMREF_PREFIX.length);
    if (!isRefName(branch)) {
      throw new Error(`warpline: HEAD names an illegal branch "${branch}" (isRefName) — fail closed`);
    }
    return { kind: 'branch', branch };
  }
  if (raw.startsWith('pick:')) return { kind: 'detached', pickId: raw };
  throw new Error(
    `warpline: HEAD holds "${raw}" — expected \`ref: ${SYMREF_PREFIX}<name>\` or a bare pickId — fail closed`,
  );
}

/**
 * Point HEAD at a branch (symref) or a bare pickId (detached), atomically and
 * durably. A branch name is validated through the shared #fabric-refs predicate;
 * a detached target must be a pickId. Both refuse fail-closed, so HEAD can never
 * publish a value readHead would then reject.
 */
export function writeHead(root: string, target: HeadTarget): void {
  if (target.kind === 'branch') {
    if (!isRefName(target.branch)) {
      throw new Error(
        `warpline: illegal branch name "${target.branch}" for HEAD — a branch is a single ${SYMREF_PREFIX} segment (isRefName), spliced into a filesystem path, so traversal/residue names are refused`,
      );
    }
    atomicWriteSync(headPath(root), `ref: ${SYMREF_PREFIX}${target.branch}\n`);
    return;
  }
  if (!target.pickId.startsWith('pick:')) {
    throw new Error(`warpline: detached HEAD must be a pickId, not "${target.pickId}"`);
  }
  atomicWriteSync(headPath(root), target.pickId + '\n');
}

/**
 * Resolve HEAD to the tip pickId it names: follow the branch symref to its ref
 * tip (readRef), or return the detached pickId verbatim. An ABSENT HEAD defaults
 * to refs/heads/selvage so no-branch behavior is unchanged (the pre-branching
 * world). null when the named branch has no tip yet (an unborn branch — the ref
 * does not exist), which is a legitimate genesis position, not corruption.
 *
 * `wdir` is the `.warpline/` dir (warplineDirOf(root)) — passed for symmetry with
 * #native-write-path's nativeSelvageTip, which reads refs the same way.
 */
export function resolveHeadTip(root: string, wdir: string): string | null {
  const head = readHead(root);
  if (head === null) return readRef(wdir, DEFAULT_BRANCH);
  if (head.kind === 'detached') return head.pickId;
  return readRef(wdir, head.branch);
}
