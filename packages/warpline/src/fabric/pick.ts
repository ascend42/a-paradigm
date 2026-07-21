/**
 * #pick — the single-writer WRITE PATH. `recordPick(root, opts)` seals the
 * current working MEANING into the fabric as a new Strand and advances the
 * selvage. The Phase-2 verb behind `warpline pick`.
 *
 * Flow ($pick-flow):
 *   1. absorb(ref) — lift the working tree (or a git ref) to a WarpState.
 *   2. store.putState — durably persist the snapshot under .warpline/states/.
 *   3. NO-OP ⟺ meaning unchanged (empty diff) AND bytes unchanged (the tree
 *      equals the tip strand's binding under worktree semantics). A meaning-NOOP
 *      whose TREE advanced seals a BYTE-CUSTODY strand instead (byteOnly:true,
 *      stateId unchanged, binding advanced — T-2026-07-18-002: doc/config-only
 *      commits keep durable native custody; auto-stake counts them).
 *   4. Else diff(parent, current) → summarize → build the Strand (attribution +
 *      reserved confidence + git-commit coexistence anchor) → appendStrand →
 *      writeSelvage (atomic). Genesis (no selvage yet) records seq 0 with an
 *      empty delta; the objectCount is the headline.
 *
 * Single-writer only: no SCRATCH fork, no per-domain CAS, no WEFT group yet —
 * those are the multi-writer protocol (Phase C), gated on the false-AUTOFOLD
 * safety experiment. This path never auto-merges, so it doesn't depend on it.
 *
 * COEXISTENCE: writes ONLY under .warpline/. Git is read for provenance
 * (HEAD sha, user.name) and never mutated.
 *
 * Library code: no console output — the CLI prints.
 */

import { absorb, WORKTREE_REF } from '../absorb.js';
import { diff } from '../sem-delta.js';
import { WarpStore } from '../warp/store.js';
import { ObjectStore } from '../warp/object-store.js';
import { snapshotState, strandSnapshotAnchor, WORKTREE_SEMANTICS } from '../warp/snapshot.js';
import { gitUserName, revParse, commitSubject, commitAuthor } from '../git/git-exec.js';
import { warplineDirOf, readSelvage, readFabric } from './fabric.js';
import { sealState } from './seal.js';
import { withFabricLock } from './lock.js';
import { readWarplineConfig, type WarplineConfig } from './config.js';
import { shadowAdmit, type ShadowVerdictRow } from './shadow.js';
import { maybeAutoStakeOnSeal } from './stake.js';
import { refuse, type Refusal, type RefusalNextStep } from './refusal.js';
import type { Strand } from './strand.js';

export interface RecordPickOptions {
  /** cwd for git/absorb (defaults to root). */
  cwd?: string;
  /** snapshot a git ref instead of the live working tree. */
  ref?: string;
  /** actor identity recording this pick (defaults: commit author for a ref, else git user.name). */
  actor?: string;
  /** the human-readable intent. Optional for a real ref (derived from the commit subject). */
  intent?: string;
  /** graded belief 0..1 (reserved moat signal). */
  confidence?: number | null;
  /** injectable clock (ISO) — determinism in tests. */
  now?: string;
  /** the AGENT recording this pick (schema v2 attribution) — IN the pickId. Absent → null (human/git-commit default). */
  agentId?: string;
  /** ephemeral session breadcrumb (schema v2) — EXCLUDED from the pickId. */
  sessionKey?: string;
  /**
   * R2 (gate.agentWrites 'real'): explicit override — seal an agent-attributed
   * pick DESPITE a would-not-seal gate verdict. Never silent: the verdict row
   * records overridden:true. No effect on human/unattributed picks or when the
   * gate is 'shadow' (mirrors admit's --accept-risk contract).
   */
  acceptRisk?: boolean;
}

/**
 * R2 — the REAL gate refused an agent-attributed pick (gate.agentWrites 'real'
 * + a would-not-seal verdict). The enforced verdict row is attached: the seal
 * did NOT happen; the telemetry row did (the hold is always on the record).
 */
export class PickGateRefusal extends Error {
  constructor(
    message: string,
    public readonly row?: ShadowVerdictRow,
    /**
     * `refusal:v1` (SP1, TD-2026-07-21-766 / falsifier F4): the MACHINE-READABLE
     * account of this refusal — code, gate, retriability, the ranked contested
     * index, and the recoverable `next[]` calls. `message` stays the HUMAN
     * sentence; this is the half an agent of any provider can act on without
     * parsing it. Optional on the constructor so external callers still compile;
     * every throw site inside this module populates it.
     */
    public readonly refusal?: Refusal,
  ) {
    super(message);
  }
}

/* ── the pick-gate refusal shapes (#refusal, falsifier F4) ───────────────────── */

/**
 * The recovery ladder for an R2 pick-gate refusal. Note what is ABSENT: no
 * `knot.show` step. The gate's verdict comes from shadowAdmit, which builds a
 * #knot-payload as pipeline proof and never persists it — so there is no
 * selector to hand out. The recorded VERDICT ROW is the durable artifact, and
 * `shadow.tail` is how a cold agent reads it back.
 */
function pickNextSteps(row: ShadowVerdictRow): RefusalNextStep[] {
  const steps: RefusalNextStep[] = [
    { verb: 'shadow.tail', params: { n: '1' }, requires: [], principal: 'agent' },
  ];
  if (row.status === 'KNOT' || row.status === 'DANGLE') {
    steps.push({ verb: 'resolve', params: {}, requires: ['resolvedRef', 'reason', 'decidedBy'], principal: 'human' });
  }
  // the override door — human-class: an agent must never wave through its own hold.
  steps.push({ verb: 'pick', params: { ref: row.ref, acceptRisk: 'true' }, requires: [], principal: 'human' });
  return steps;
}

/**
 * The R2 gate refusing a would-not-seal verdict. The UNDERLYING #admit refusal
 * (the shadow pipeline produces one for KNOT/DANGLE/HELD/CLAIM-BREACH) supplies
 * the code, the ranked contested index, the pointers and the override door; the
 * pick gate only re-homes it to gate:'pick' and rewrites the ladder, because the
 * verb that retries HERE is `pick`, not `admit`. A CLEAN-that-would-not-
 * materialize has no underlying refusal — that verdict refuses nothing at the
 * admit layer; the pick gate is what holds it — so it falls back to GATE_REFUSED.
 */
function pickGateRefusal(row: ShadowVerdictRow, under: Refusal | undefined): Refusal {
  const meaning = row.status === 'KNOT' || row.status === 'DANGLE';
  return refuse({
    code: under?.code ?? 'GATE_REFUSED',
    verdict: row.status,
    gate: 'pick',
    retriable: meaning ? 'retry-after-resolve' : 'retry-with-override',
    contested: under?.contested ?? [],
    // Prefer the underlying UNIT count; the row's knotsTotal counts SYMBOLS
    // (deduped across knots+dangles), so it is a fallback, not the truth.
    contestedTotal: under?.contestedTotal ?? row.knotsTotal ?? row.knots.length,
    pointers: { ...(under?.pointers ?? {}), proposedStateId: row.proposedStateId },
    next: pickNextSteps(row),
    override: under?.override ?? { flag: 'acceptRisk', principal: 'human' },
  });
}

export interface PickResult {
  /** true when NEITHER meaning NOR bytes changed since selvage — nothing recorded
   * (T-2026-07-18-002: NOOP ⟺ empty deltas AND empty renames AND tree unchanged
   * under the canonical worktree semantics). */
  noop: boolean;
  /** true when this was the first pick (genesis, seq 0). */
  isGenesis: boolean;
  /** the sealed strand (absent on a no-op). */
  strand?: Strand;
  /** the absorbed stateId (the new selvage, or the unchanged one on a no-op). */
  stateId: string;
  /** true when a BYTE-CUSTODY strand was sealed (meaning-NOOP, tree advanced —
   * doc/config/lore-only change; stateId unchanged, binding advanced). */
  byteOnly?: boolean;
}

export async function recordPick(root: string, opts: RecordPickOptions): Promise<PickResult> {
  const cwd = opts.cwd ?? root;
  const ref = opts.ref ?? WORKTREE_REF;
  const wdir = warplineDirOf(root);
  const store = new WarpStore(root, { diskCache: true });
  const objStore = new ObjectStore(root); // native byte store (M1b bind-on-seal)

  // 1. Lift the current meaning (no lock — this is the expensive step).
  const current = await absorb(ref, { cwd });

  // R1 SHADOW GATE + R2 REAL GATE (#shadow-gate / loid-loops.md §1 R1, R2):
  //   - shadowGate:true → every pick (incl. the auto-seal #hook path) records
  //     the OBSERVE-ONLY admit verdict of this state vs the PRE-seal selvage,
  //     reusing the state just lifted (pure compute, no second absorb). FAIL-SAFE:
  //     telemetry never blocks a seal.
  //   - gate.agentWrites 'real' + an AGENT-ATTRIBUTED pick (agentId present) →
  //     the SAME verdict is ENFORCED: a would-not-seal verdict (KNOT / DANGLE /
  //     HELD / non-materializable CLEAN) REFUSES the seal (PickGateRefusal)
  //     unless opts.acceptRisk explicitly overrides (recorded on the row —
  //     never silent). FAIL-CLOSED for agents: a real gate that crashes (or a
  //     toggle file too corrupt to read) refuses rather than silently waving
  //     an agent write through. Humans/unattributed picks: byte-identical to R1.
  {
    let cfg: WarplineConfig | null = null;
    try {
      cfg = readWarplineConfig(root);
    } catch {
      cfg = null; // corrupt config: humans fail-safe (below); agents fail closed
    }
    const agentAttributed = typeof opts.agentId === 'string' && opts.agentId.length > 0;
    if (cfg === null && agentAttributed) {
      throw new PickGateRefusal(
        'warpline: pick refused — .warpline/config.json exists but cannot be read, so the R2 agent gate mode is undeterminable. ' +
          'An agent-attributed seal fails CLOSED here (a corrupt toggle file must not silently disable the real gate); fix the config and re-run.',
        undefined,
        // No verdict was ever computed (the gate could not be EVALUATED), and no
        // call recovers a corrupt file on disk: `next` is empty by DESIGN — the
        // machine-readable way to say "escalate to a human".
        refuse({ code: 'ENGINE', gate: 'pick', retriable: 'never', next: [] }),
      );
    }
    const gateReal = agentAttributed && cfg?.gate?.agentWrites === 'real';
    if (gateReal || cfg?.shadowGate === true) {
      try {
        const { row, result } = await shadowAdmit(
          root,
          { cwd, agentId: opts.agentId ?? 'auto-seal', ref, proposedState: current },
          gateReal ? { gate: 'real', acceptRisk: opts.acceptRisk === true } : undefined,
        );
        // A NOOP verdict never refuses: either nothing seals (true no-op), or the
        // seal is a BYTE-CUSTODY strand (meaning-NOOP, tree advanced — always
        // FAST/no-gate: there is no meaning for the gate to contest; T-2026-07-18-002).
        if (gateReal && !row.wouldSeal && row.status !== 'NOOP' && opts.acceptRisk !== true) {
          const contested = row.knots.slice(0, 8).join(', ') || '(none listed)';
          throw new PickGateRefusal(
            `warpline: pick refused — the R2 agent gate is REAL for attributed writes (gate.agentWrites:"real") and this verdict would not seal: ` +
              `${row.status}${row.knotsTotal ? ` (${row.knotsTotal} contested: ${contested})` : ''}. ` +
              `The verdict row is recorded in .warpline/shadow/verdicts.jsonl. ` +
              `Resolve against the current selvage, or seal explicitly with --accept-risk (recorded, never silent).`,
            row,
            // The message above is for the human; this is the same hold stated
            // so an agent of any provider can act on it without parsing prose.
            pickGateRefusal(row, result.refusal),
          );
        }
      } catch (err) {
        if (err instanceof PickGateRefusal) throw err;
        if (gateReal) {
          // fail CLOSED: an enforced gate that cannot produce a verdict refuses.
          throw new PickGateRefusal(
            `warpline: pick refused — the R2 agent gate is enforced but the verdict pipeline failed (${(err as Error).message}). ` +
              'Fail-closed for agent-attributed writes; the human/git door is unaffected.',
            undefined,
            // The REQUEST was well-formed — only the pipeline failed — so the
            // identical call is a legitimate recovery (lock contention is the
            // common cause). No verdict exists to report, hence verdict:null.
            refuse({
              code: 'ENGINE',
              gate: 'pick',
              retriable: 'retry-identical',
              next: [{ verb: 'pick', params: { ref }, requires: [], principal: 'agent' }],
            }),
          );
        }
        /* observe-only — never break a seal over telemetry */
      }
    }
  }

  // Attribution + intent are independent of the selvage — resolve BEFORE locking
  // to keep the critical section short. For a real ref, derive from its git log
  // when not supplied (this is what lets the post-commit hook seal with no -m).
  const isWorktree = ref === WORKTREE_REF;
  const intent =
    opts.intent ??
    (isWorktree ? 'uncommitted worktree state' : (await commitSubject(ref, { cwd }).catch(() => '')) || '(no intent)');
  const actor =
    opts.actor ??
    (isWorktree ? null : await commitAuthor(ref, { cwd }).catch(() => null)) ??
    (await gitUserName({ cwd })) ??
    'unknown';
  const gitCommit = await revParse(isWorktree ? 'HEAD' : ref, { cwd }).catch(() => null);
  const now = opts.now ?? new Date().toISOString();

  // 2-3. Decide + seal under the fabric lock (the read-decide-write critical
  //      section). The DIFF — not stateId equality — is the source of truth for
  //      "did meaning change?": stateId hashes the DEDUPED essence set, so an
  //      identical-essence born symbol leaves stateId unchanged while diff (keyed
  //      by stableKey) sees it. #seal is the single writer of fabric history.
  const result = await withFabricLock(root, async (): Promise<PickResult> => {
    const selvage = readSelvage(wdir);
    const isGenesis = selvage === null;
    let meaningNoop = false;
    if (!isGenesis) {
      const parent = store.loadState(selvage);
      // A SET selvage we cannot LOAD is corruption or a regen-gap in the states
      // cache — NOT an empty fabric. Falling through to seal here would ORPHAN the
      // real history (silent data loss), the exact class admit.ts fails closed on.
      // Fail CLOSED: the caller must re-absorb the tip or repair .warpline/.
      if (!parent) {
        throw new Error(
          `warpline: selvage points at ${selvage} but that state cannot be loaded (states/ cache missing or corrupt) — refusing to seal over existing history. Re-absorb the tip or repair .warpline/.`,
        );
      }
      const d = diff(parent, current);
      meaningNoop = d.deltas.size === 0 && d.renames.length === 0;
    }
    // Bind the durable bytes UNDER THE CANONICAL WORKTREE SEMANTICS (snapshot.ts
    // decision header). A ref pick snapshots INCREMENTALLY off the tip strand's
    // verified same-semantics binding (T-2026-07-04-003) — the usual post-commit
    // hook seal costs one commit's diff, not the whole tree. Unverifiable /
    // legacy-semantics tip / worktree ⇒ full path. Computed even on a meaning-
    // NOOP: "did the TREE change?" is now part of the no-op decision
    // (T-2026-07-18-002 — byte custody; a doc-only commit must leave a strand).
    const parentStrand = isGenesis
      ? undefined
      : [...readFabric(wdir)].reverse().find((s) => s.stateId === selvage);
    const anchor = isWorktree ? undefined : await strandSnapshotAnchor(parentStrand, objStore, { cwd });
    const treeId = await snapshotState(objStore, ref, cwd, { cwd }, anchor, root); // I5: worktree walk is stat-indexed
    if (meaningNoop && parentStrand?.binding?.treeId === treeId) {
      // TRUE no-op: meaning unchanged AND bytes unchanged — don't spam history.
      return { noop: true, isGenesis: false, stateId: current.stateId };
    }
    // meaning-NOOP + tree advanced ⇒ BYTE-CUSTODY strand (T-2026-07-18-002):
    // stateId naturally equals the parent's; the binding advances so the bytes
    // have durable native custody (git-absent restorable, auto-stake coverage).
    const byteOnly = meaningNoop;
    const strand = sealState(root, store, current, {
      parentStateId: selvage,
      actor,
      intent,
      gitCommit,
      now,
      confidence: opts.confidence ?? null,
      byteOnly,
      authoredBy: { agentId: opts.agentId ?? null, sessionKey: opts.sessionKey ?? null },
      binding: { treeId, gitOid: current.treeSha ?? null, treeSemantics: WORKTREE_SEMANTICS },
    });
    return { noop: false, isGenesis, strand, stateId: current.stateId, ...(byteOnly ? { byteOnly: true } : {}) };
  });

  // R2 auto-stake cadence: a successful (non-noop) seal MAY trigger the valve —
  // config-gated (stake.enabled + stake.auto + ref allowlist, all checked inside),
  // best-effort (never throws; every actual valve invocation audits itself),
  // and OUTSIDE the fabric lock (the valve reads the fabric, never writes it).
  if (!result.noop) await maybeAutoStakeOnSeal(root, { now: opts.now, actor });

  return result;
}
