/**
 * #stake-guard — the S1 ONE-WAY guards + the CONSTITUTION-GRADE deny-list of the
 * checkpoint valve (`warpline stake`, T-2026-07-17-001; aegis-security.md §3;
 * arky-architecture.md §3).
 *
 * The valve exports SEALED trees to git as checkpoint commits. This module is the
 * mechanical HALF that keeps the valve one-way: pick/absorb/backfill (and the
 * auto-seal hook, which runs through pick) REFUSE any input that is a stake —
 * a worktree carrying the `.warpline-stake` marker, a ref in the stake namespace,
 * or a commit whose tree contains the marker. A guard, not a convention (S1).
 *
 * D5 (founder-ratified): STAKE_DENYLIST is CONSTITUTION-GRADE. It is a frozen
 * constant paired with a schema version — NOT a config flag. Expanding (or
 * shrinking) the list is a SCHEMA CHANGE: bump STAKE_DENYLIST_SCHEMA and the
 * pinned digest in test/stake.test.ts together, as a founder-visible edit. A
 * denylist that can drift by configuration is not a denylist.
 *
 * Deliberately cycle-free: imports only fs/path, config.ts and git-exec.ts —
 * absorb.ts imports this module, so it must never (transitively) import absorb.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { readWarplineConfig } from './config.js';
import { treeEntryMode } from '../git/git-exec.js';

/** The committed root marker of every stake commit (S1) — provenance label AND
 * machine-readable refusal signal. A tree carrying this name is never input. */
export const STAKE_MARKER = '.warpline-stake';

/** The stake record schema tag (rides the commit trailer + audit rows). */
export const STAKE_SCHEMA = 'stake:v1';

/** The default dedicated stake branch — never the human's working branch. */
export const STAKE_DEFAULT_BRANCH = 'warpline-stakes';

/**
 * The DETERMINISTIC byte content of the committed `.warpline-stake` marker.
 * Constant on purpose: the same sealed state always stakes to the same tree
 * (idempotency is checkable), and the marker carries its own refusal contract.
 */
export const STAKE_MARKER_CONTENT =
  'warpline-stake\n' +
  `schema: ${STAKE_SCHEMA}\n` +
  'This commit is a ONE-WAY Warpline checkpoint export (a stake). It is never\n' +
  'input: warpline pick/absorb/backfill and the auto-seal hook refuse any tree\n' +
  'carrying this marker (S1). Recovery after `git reset --hard <stake>`:\n' +
  '  warpline stake recover <stakeCommit>\n';

/**
 * D5 — the schema version of the leakage deny-list. Any change to
 * STAKE_DENYLIST or STAKE_DENY_CONTENT_MARKERS REQUIRES bumping this tag
 * (stake-denylist:v2, …) and re-pinning the freeze-test digest. See the
 * "constitution" test in test/stake.test.ts.
 */
export const STAKE_DENYLIST_SCHEMA = 'stake-denylist:v1';

/**
 * S2 post-build audit — path components that must NEVER exist in a stake tree,
 * matched EXACTLY, at ANY depth. The PRIMARY leakage mechanism is
 * allowlist-by-materialization (the tree is built by restoreTree from the bound
 * object store — you cannot leak what you never copy); this list is the belt on
 * top of that construction guarantee, aimed at crafted/forged trees:
 *   - `.warpline` / `.git`        — the fabric + VCS internals, in any form
 *   - `.warpline-stake`           — a tree spoofing the stake marker itself
 *   - fabric/oracle ledgers       — fabric.jsonl, fabric-legacy.json, oracle.jsonl
 *   - sidecar TRUST data          — grades*.jsonl, evaluations/escalations,
 *                                   shadow verdicts, override events (§2.3:
 *                                   a stake carries ZERO calibration signal)
 *   - claims/ + knots/            — they embed agent prose and both sides' bodies
 *   - session keys / daemon tokens
 * Frozen (Object.freeze) + schema-versioned (D5): expanding = schema change.
 */
export const STAKE_DENYLIST: readonly string[] = Object.freeze([
  '.git',
  '.warpline',
  '.warpline-stake',
  'fabric.jsonl',
  'fabric-legacy.json',
  'oracle.jsonl',
  'grades.jsonl',
  'grades-escalations.jsonl',
  'claims',
  'knots',
  'shadow',
  'evaluations.jsonl',
  'escalations.jsonl',
  'verdicts.jsonl',
  'overrides.jsonl',
  'session-keys.jsonl',
  'daemon-tokens.jsonl',
]);

/**
 * S2 content audit — byte substrings whose presence in ANY blob of the built
 * tree refuses the stake: a serialized UntrustedProse envelope must never land
 * on a GitHub-renderable surface (forge §3d — the valve's answer is "it never
 * crosses at all"). Both compact and pretty-printed JSON forms are pinned.
 * Frozen + covered by the same schema version as the path list (D5).
 */
export const STAKE_DENY_CONTENT_MARKERS: readonly string[] = Object.freeze([
  '"kind":"untrusted-prose"',
  '"kind": "untrusted-prose"',
]);

/**
 * Is `ref` in the stake namespace? Matches the configured stake branch (when
 * known) and the default `warpline-stakes` namespace, with or without a
 * `refs/heads/` prefix. Stake refs are never input (S1).
 */
export function isStakeNamespaceRef(ref: string, configuredBranch?: string): boolean {
  const name = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
  if (configuredBranch && name === configuredBranch) return true;
  return name === STAKE_DEFAULT_BRANCH || name.startsWith(`${STAKE_DEFAULT_BRANCH}-`) || name.startsWith(`${STAKE_DEFAULT_BRANCH}/`);
}

/**
 * S1, mechanically: refuse any pick/absorb SOURCE that is a stake.
 *   - worktree source: the `.warpline-stake` marker exists at the root — this
 *     worktree is a `git reset --hard <stake>` state; the ONLY legal re-entry is
 *     the explicit recovery verb (S5), never an implicit re-ingestion.
 *   - ref source: the ref lives in the stake namespace, OR its tree carries the
 *     marker (checked via read-only `git ls-tree` — a stake commit reached by
 *     sha/any alias is still refused).
 * Throws on a stake input; resolves silently otherwise. Config read is
 * best-effort (a corrupt config must not turn the guard off — defaults apply).
 */
export async function assertNotStakeInput(ref: string, cwd: string, isWorktree: boolean): Promise<void> {
  if (isWorktree) {
    if (fs.existsSync(path.join(cwd, STAKE_MARKER))) {
      throw new Error(
        `warpline: refusing worktree input — a ${STAKE_MARKER} marker is present at ${cwd}. ` +
          `This tree is a one-way git stake checkpoint (S1) and is never input. ` +
          `If you just ran \`git reset --hard <stake>\`, re-enter with \`warpline stake recover <stakeCommit>\`.`,
      );
    }
    return;
  }
  let configuredBranch: string | undefined;
  try {
    configuredBranch = readWarplineConfig(cwd).stake?.branch;
  } catch {
    // corrupt config must not disable the guard — fall through with defaults
  }
  if (isStakeNamespaceRef(ref, configuredBranch)) {
    throw new Error(
      `warpline: refusing ref ${ref} — it lives in the stake namespace (S1: stakes are a one-way export, never input)`,
    );
  }
  const markerMode = await treeEntryMode(ref, STAKE_MARKER, { cwd }).catch(() => null);
  if (markerMode !== null) {
    throw new Error(
      `warpline: refusing ref ${ref} — its tree carries the ${STAKE_MARKER} marker (a stake commit; S1: stakes are a one-way export, never input). ` +
        `Recovery is \`git reset --hard <stake>\` + \`warpline stake recover <stakeCommit>\` — a ref move, never an import.`,
    );
  }
}
