/**
 * #branch — the BRANCH verbs (M2.5 increment 2, TD-2026-08-12-813, Arky's design).
 * Increment 1 built the foundation — #head (the current-branch symref), #fabric-refs
 * (named history positions + per-ref CAS), #mergebase (the LCA), and a bare branch
 * name as a #restore selector. This module is the human/agent-facing layer OVER that
 * foundation: create, list, delete a named line, and SWITCH the worktree between them.
 *
 * A BRANCH is nothing new under the hood — it is a `refs/heads/<name>` holding a
 * pickId (an event identity), exactly like `selvage`. What this module adds is the
 * VERBS that mint, enumerate, retire, and MOVE-TO those refs, and the one composite
 * act that has real teeth: `switch` = restore the branch tip's bytes into the
 * worktree (through the shared guarded writer) THEN move HEAD. Nothing here writes a
 * new worktree-writer or a new ref grammar — it wires the primitives together.
 *
 * DESIGN NOTES (Arky):
 *   - create is CAS-null (must-not-exist) — two agents racing to mint the same name,
 *     one wins, the other refuses; a branch is never silently re-pointed.
 *   - delete UNLINKS the ref only. The strand it named survives in the append-only
 *     ledger as an ABANDONED HEAD (`fabric verify` reports it; `refs set` recovers
 *     it). Deleting a branch discards a NAME, never history.
 *   - selvage is the trunk (the branch an absent HEAD resolves to, #head
 *     DEFAULT_BRANCH); deleting it, or the current HEAD branch, is refused.
 *   - switch is REFUSE-DIRTY by default (git-parity): the shared dirty-dest guard
 *     (#restore assertDirtyFree) refuses any worktree path whose current bytes are in
 *     no object; `--force` overrides. HEAD moves only AFTER the bytes land, so a
 *     refusal leaves both the worktree and HEAD untouched.
 *   - switch OVERLAYS the tip tree (restore semantics) — it writes the target's paths
 *     and leaves unrelated files in place; it does not prune paths absent from the
 *     target. That is #restore's contract, reused verbatim rather than re-derived.
 *
 * branch/switch are AGENT-CLASS verbs (they open and move between lanes — the exact
 * concurrency the fabric adjudicates), so they are deliberately NOT in the
 * HUMAN_ONLY set. Library code: no console output — the CLI prints.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { warplineDirOf } from './fabric.js';
import { readHead, writeHead, resolveHeadTip, DEFAULT_BRANCH } from './head.js';
import { readRef, writeRef, listRefs, isRefName } from './refs.js';
import { resolveSelector } from './select.js';
import { guardedRestoreTree } from './restore.js';
import { ObjectStore } from '../warp/object-store.js';

/** One branch in a listing: its name, the pickId its ref holds, and the current marker. */
export interface BranchInfo {
  name: string;
  /** the pickId (event identity) this branch's ref points at. */
  pickId: string;
  /** true when HEAD points at this branch (the '*' marker). */
  current: boolean;
}

export interface CreateBranchResult {
  name: string;
  /** the pickId the new branch points at. */
  pickId: string;
  /** the source the tip was resolved from (a selector, or 'HEAD'). */
  from: string;
}

export interface DeleteBranchResult {
  name: string;
  /** what the deleted branch pointed at — now an abandoned head unless another ref names it. */
  pickId: string;
}

export interface SwitchResult {
  /** the branch HEAD now points at. */
  branch: string;
  /** where HEAD was before (a branch name, or a detached pickId). */
  previous: string;
  /** the native tree materialized into the worktree. */
  treeId: string;
  /** the branch tip pickId. */
  tip: string;
  /** entries written into the worktree (files + dirs + symlinks, git absent). */
  entriesRestored: number;
}

/** The current HEAD branch name — DEFAULT_BRANCH when HEAD is absent, null when detached. */
function currentBranchOf(root: string): string | null {
  const head = readHead(root);
  if (head === null) return DEFAULT_BRANCH; // absent HEAD ≡ on the trunk (#head)
  return head.kind === 'branch' ? head.branch : null; // detached → no current branch
}

/**
 * The `.warpline/refs/heads/<name>` path, guarded by the SAME isRefName predicate
 * #fabric-refs splices its own path through — a name is validated before it ever
 * reaches an unlink, so traversal/residue names cannot escape the refs dir.
 */
function refPathOf(wdir: string, name: string): string {
  if (!isRefName(name)) {
    throw new Error(`warpline: illegal branch name "${name}" — a branch is a single refs/heads segment (isRefName)`);
  }
  return path.join(wdir, 'refs', 'heads', name);
}

/**
 * Create a branch `name` at the tip of `from` (a selector) — or the current HEAD tip
 * when `from` is omitted or the literal `HEAD`. CAS-null: the write refuses if the
 * ref already exists (a concurrent create loses cleanly). Refuses an empty/unborn
 * source (nothing to point at) and an illegal name.
 */
export function createBranch(root: string, name: string, opts: { from?: string } = {}): CreateBranchResult {
  if (!isRefName(name)) {
    throw new Error(
      `warpline: illegal branch name "${name}" — a branch is a single refs/heads segment ([A-Za-z0-9][A-Za-z0-9._-]*), no traversal or staging residue`,
    );
  }
  const wdir = warplineDirOf(root);

  // Resolve the SOURCE tip pickId. `HEAD` (or omitted) follows the actual HEAD
  // symref (#head resolveHeadTip) so `--from HEAD` means the CURRENT branch's tip —
  // NOT the selvage-tip that select.ts's legacy `HEAD` alias would resolve. Any
  // other selector goes through the shared resolver; a `tree:` selector has no
  // history position to branch from and is refused.
  let tip: string | null;
  let from: string;
  if (opts.from === undefined || opts.from === 'HEAD') {
    from = 'HEAD';
    tip = resolveHeadTip(root, wdir);
  } else {
    from = opts.from;
    const res = resolveSelector(wdir, opts.from);
    if (!res.strand) {
      throw new Error(
        `warpline: cannot branch from "${opts.from}" — a tree: selector names bytes, not a history position. Branch from HEAD | selvage | <branch> | pick:<id> | state:<id> | @N.`,
      );
    }
    tip = res.strand.pickId;
  }
  if (tip === null) {
    throw new Error(
      `warpline: cannot create branch "${name}" — ${
        from === 'HEAD'
          ? 'the current branch is unborn (no pick sealed yet). Seal a pick first.'
          : `"${from}" has no tip.`
      }`,
    );
  }

  const existing = readRef(wdir, name);
  if (existing !== null) {
    throw new Error(
      `warpline: branch "${name}" already exists (points at ${existing}) — delete it (\`warpline branch -d ${name}\`) or pick another name`,
    );
  }
  writeRef(wdir, name, tip, null); // CAS null = must-not-exist (refuse a concurrent create)
  return { name, pickId: tip, from };
}

/**
 * Every branch (refs/heads/*), sorted by name, with the current one marked. An
 * absent HEAD marks `selvage`; a detached HEAD marks nothing.
 */
export function listBranches(root: string): BranchInfo[] {
  const wdir = warplineDirOf(root);
  const current = currentBranchOf(root);
  const out: BranchInfo[] = [];
  for (const [name, pickId] of listRefs(wdir)) {
    out.push({ name, pickId, current: name === current });
  }
  return out;
}

/**
 * Delete a branch — UNLINK its ref. Refuses `selvage` (the trunk) and the current
 * HEAD branch. The strand survives in the ledger as an abandoned head (recoverable
 * with `warpline refs set`); deleting discards a name, never history.
 */
export function deleteBranch(root: string, name: string): DeleteBranchResult {
  if (!isRefName(name)) {
    throw new Error(`warpline: illegal branch name "${name}" — a branch is a single refs/heads segment (isRefName)`);
  }
  if (name === DEFAULT_BRANCH) {
    throw new Error(
      `warpline: refusing to delete "${DEFAULT_BRANCH}" — it is the default trunk (the branch an absent HEAD resolves to). Every other branch hangs off it.`,
    );
  }
  const wdir = warplineDirOf(root);
  if (name === currentBranchOf(root)) {
    throw new Error(
      `warpline: refusing to delete "${name}" — it is the CURRENT branch (HEAD points at it). Switch to another branch first (\`warpline switch <other>\`).`,
    );
  }
  const pickId = readRef(wdir, name);
  if (pickId === null) {
    throw new Error(`warpline: no branch "${name}" to delete (\`warpline branch --list\` shows what exists)`);
  }
  // UNLINK only — the strand stays in the append-only fabric.jsonl (an abandoned
  // head `fabric verify` reports; `warpline refs set ${name} ${pickId}` restores it).
  fs.unlinkSync(refPathOf(wdir, name));
  return { name, pickId };
}

/**
 * Switch the worktree to branch `name`: resolve its tip → treeId (A4-refuses an
 * unbound strand, exactly as #restore does), write those bytes into `worktree`
 * through the SHARED guarded writer (refuse-dirty by default, `--force` overrides),
 * then move HEAD. The restore happens BEFORE HEAD moves, so a dirty-worktree refusal
 * leaves both the bytes and HEAD untouched. Refuses a non-existent branch.
 *
 * `worktree` is the destination directory (the repo root, normally) — `root` locates
 * `.warpline/`; the two are the same path for an in-place switch.
 */
export function switchBranch(
  root: string,
  worktree: string,
  name: string,
  opts: { force?: boolean } = {},
): SwitchResult {
  if (!isRefName(name)) {
    throw new Error(`warpline: illegal branch name "${name}" — a branch is a single refs/heads segment (isRefName)`);
  }
  const wdir = warplineDirOf(root);
  if (readRef(wdir, name) === null) {
    throw new Error(
      `warpline: no branch "${name}" to switch to — create it with \`warpline branch ${name}\` (or \`warpline branch --list\` to see what exists)`,
    );
  }

  // Resolve the branch tip → the native tree (through the shared resolver, so the
  // A4 unbound-strand refusal and the branch-name grammar are the restore verb's).
  const { treeId, strand } = resolveSelector(wdir, name);

  const head = readHead(root);
  const previous = head === null ? DEFAULT_BRANCH : head.kind === 'branch' ? head.branch : head.pickId;

  // Materialize through the SAME guarded byte-writer restore/admit/fork use — never a
  // second worktree-writer. No expectTreeId baseline (like `restore`/`fork --into`):
  // any colliding path whose bytes are in no object refuses unless `--force`.
  const store = new ObjectStore(root);
  const entriesRestored = guardedRestoreTree(store, treeId, worktree, {
    force: opts.force,
    overrideHint:
      'pass --force to overwrite them (switch OVERLAYS the target tree; unrelated files are left in place)',
  });

  // Only now, with the worktree in place, move HEAD onto the branch.
  writeHead(root, { kind: 'branch', branch: name });

  return { branch: name, previous, treeId, tip: strand?.pickId ?? readRef(wdir, name)!, entriesRestored };
}
