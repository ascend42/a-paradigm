/**
 * #stake-journal — the checkpoint valve's audit sidecar, and THE ANTI-TRUNCATION
 * WITNESS (soundness audit C-6).
 *
 * WHAT C-6 FOUND. Warpline's tamper-evidence against MUTATION is real — six
 * mutation classes, six detections. Against TAIL DELETION it did not exist. On a
 * faithful copy of the live 64-strand fabric an auditor cut it to 26 strands,
 * rolled the selvage back, and got `VERIFY 26 strand(s) — all intact`, exit 0:
 * 59% of the record erased with zero evidence, and the remainder a fully operable
 * base that new strands chain onto cleanly. The hash chain authenticates that what
 * is PRESENT is consistent; nothing attested to HOW MUCH SHOULD BE THERE.
 *
 * THE EVIDENCE WAS ALREADY ON DISK. With `stake.auto` on, every seal cuts a
 * checkpoint and appends a row here naming the pickId it staked — an append-only
 * journal of tips this fabric has held. It is git's reflog, and `verify.ts` never
 * read it. This module is the reader; verify.ts step 7c is the cross-check.
 *
 * ═══ THE DESIGN CALLS, MADE EXPLICITLY ═══
 *
 * 1. ADVISORY EVIDENCE, NEVER AUTHORITY. A missing journal, an unreadable journal,
 *    a disabled stake valve and a fresh fabric ALL yield an empty attestation set,
 *    and an empty set can never fail a verification. Absence of evidence is not
 *    evidence of truncation — otherwise `verify` would be useless on every repo
 *    that does not run the valve, which is most of them. The corollary is stated
 *    rather than hidden: a truncator who ALSO deletes this file leaves no local
 *    trace. The tamper-resistant corroborator is the git side — the stake branch
 *    (`refs/heads/warpline-stakes` by default) carries the same pickIds inside
 *    signed-able, push-able commit objects, so hiding a truncation there means
 *    rewriting and force-pushing a branch. Consulting it is an ASYNC git read and
 *    `verifyFabric` is deliberately synchronous and pure; that is future work,
 *    noted, not silently skipped.
 *
 * 2. ONLY COMPLETED ACTIONS ATTEST. A row counts as evidence only when its action
 *    is one the valve carried to completion — `stake`, `skip`, `recover` — because
 *    completion is what PROVES the strand was in this fabric at that instant:
 *      - `stake`  the valve resolved the ref THROUGH a strand's byte binding
 *                 (stake.ts resolveStakeRef), materialized its bytes from the
 *                 object store, recompute-verified them, and cut a git commit;
 *      - `skip`   same resolution, then the idempotent no-op (the stake branch tip
 *                 already carried that pickId);
 *      - `recover` the S5 verb, whose fabric-membership check must pass before the
 *                 row is written.
 *    `recover-refuse` is EXCLUDED as unsound: one of its refusal reasons is
 *    literally "stake names pickId X, which is absent from the fabric", so treating
 *    it as an attestation would turn a correct refusal into a permanent false
 *    truncation alarm. `refuse` is excluded as merely UNNEEDED: its pickId is also
 *    populated only after resolveStakeRef succeeds, so it would be sound today, but
 *    it is the diagnostic stream — best-effort context fields captured at varying
 *    points of an incomplete flow — and pinning a HARD verify failure to a
 *    non-completing path is a premise that a future refactor can silently break.
 *
 * 3. A TORN JOURNAL LINE IS SKIPPED, NOT FATAL. appendStakeAudit itself swallows
 *    write errors by design (telemetry must not convert a refusal into a crash), so
 *    a half-written last row is expected. A malformed row is counted and ignored.
 *
 * Library code: no console output — the CLI prints.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const STAKE_AUDIT_SCHEMA = 'stakeAudit:v1';

export interface StakeAuditRow {
  schema: typeof STAKE_AUDIT_SCHEMA;
  at: string; // ISO
  actor: string;
  /** stake = a commit was cut; skip = idempotent no-op; refuse = any refusal;
   * recover / recover-refuse = the S5 re-entry verb. */
  action: 'stake' | 'skip' | 'refuse' | 'recover' | 'recover-refuse';
  selector: string;
  ref?: string | null;
  pickId?: string | null;
  stateId?: string | null;
  treeId?: string | null;
  branch?: string | null;
  gitCommit?: string | null;
  gitTreeOid?: string | null;
  reason?: string | null;
  /**
   * ADDITIVE (T-2026-07-18-005): the WORKTREE-SEMANTICS expectation of the staked
   * tree — what a pristine `git reset --hard <stake>` worktree re-hashes to under
   * recover's ignore-honoring walk. Equals treeId for a worktree:v1 binding;
   * derived by projection for a legacy-git binding. Recorded at cut AND at
   * recover so the S5 rail's honest expectation is on the audit record for any
   * strand. Absent on rows written before the tree-semantics decision.
   */
  worktreeTreeId?: string | null;
}

export function stakesDirOf(root: string): string {
  return path.join(root, '.warpline', 'stakes');
}

export function stakeAuditPathOf(root: string): string {
  return path.join(stakesDirOf(root), 'audit.jsonl');
}

/** The actions whose rows the valve only writes after the operation COMPLETED (call 2). */
const ATTESTING_ACTIONS: ReadonlySet<StakeAuditRow['action']> = new Set(['stake', 'skip', 'recover']);

/** One completed checkpoint naming a pickId this fabric provably contained. */
export interface StakeAttestation {
  pickId: string;
  /** ISO timestamp of the EARLIEST completed row naming this pickId. */
  at: string;
  action: 'stake' | 'skip' | 'recover';
  /** the stake commit, when the row carried one (a git-side corroborator to chase). */
  gitCommit: string | null;
}

export interface StakeJournal {
  /** the journal file was found and read (its CONTENT may still attest nothing). */
  present: boolean;
  /** total rows parsed (every action). */
  rows: number;
  /** rows that did not parse as JSON — counted, ignored (call 3). */
  malformed: number;
  /** distinct pickIds attested by a COMPLETED valve action, earliest-first. */
  attestations: StakeAttestation[];
  /** why the journal yielded nothing, when a read failed (advisory — never fatal). */
  unreadable: string | null;
}

const EMPTY: StakeJournal = { present: false, rows: 0, malformed: 0, attestations: [], unreadable: null };

/**
 * Read the stake journal as an ADVISORY attestation set. Never throws: every
 * failure mode collapses to "no evidence" (call 1), because a verification that
 * an unwritable telemetry sidecar can break is a worse tool than one that can be
 * silenced by deleting it.
 */
export function readStakeJournal(root: string): StakeJournal {
  let raw: string;
  try {
    raw = fs.readFileSync(stakeAuditPathOf(root), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return EMPTY;
    return { ...EMPTY, unreadable: (err as Error).message };
  }

  let rows = 0;
  let malformed = 0;
  const byPickId = new Map<string, StakeAttestation>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let row: StakeAuditRow;
    try {
      row = JSON.parse(line) as StakeAuditRow;
    } catch {
      malformed++; // a torn tail row is EXPECTED here — telemetry, not the ledger
      continue;
    }
    rows++;
    if (!ATTESTING_ACTIONS.has(row.action)) continue;
    const pickId = row.pickId;
    if (typeof pickId !== 'string' || pickId.length === 0) continue;
    if (byPickId.has(pickId)) continue; // keep the EARLIEST attestation
    byPickId.set(pickId, {
      pickId,
      at: typeof row.at === 'string' ? row.at : '(unknown)',
      action: row.action as StakeAttestation['action'],
      gitCommit: typeof row.gitCommit === 'string' ? row.gitCommit : null,
    });
  }
  return { present: true, rows, malformed, attestations: [...byPickId.values()], unreadable: null };
}
