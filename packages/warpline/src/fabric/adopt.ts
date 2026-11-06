/**
 * #fabric-adopt — rebuild an empty or behind ledger from VERIFIED git history;
 * never mint a new genesis (W2 findings H1, H2, B1, I3). Shared by the
 * auto-adopt in #fabric-lock, `warpline mirror adopt` and the follow path of
 * `warpline mirror migrate`.
 *
 *   1. source: the local canonical branch, else its remote-tracking ref (nothing
 *      is fetched in the background), else — for a clone that pulled the untrack
 *      commit before any branch existed — the last commit that tracked the ledger.
 *   2. size cap before any blob read (L3) — mirror-tree readBlobsCapped.
 *   3. #mirror-audit of every new commit since the cursor (truncating
 *      fast-forward ⇒ mirror-chain-truncation; non-descendant ⇒ canonical-rewound).
 *   4. planMerge: fast-forward, union of v3-only tails, refuse diverged v1/v2 tails.
 *   5. the candidate is built IN MEMORY and authenticated (verify core): any
 *      (kind, pickId) failure not already present in the current ledger refuses.
 *      Absent binding objects of INCOMING strands are tolerated (binding objects
 *      do not travel — `warpline objects rehydrate` is a follow-up); a corrupt
 *      object stays HARD.
 *   6. policy: incoming v2/v3 strands must carry a binding; no incoming v1 strand
 *      beyond the anchored prefix.
 *   7. the record first (own ref → adopted commit, or a merge commit for a union),
 *      then one atomic ledger write + tips, then the audit cursor.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteSync } from '../warp/durable.js';
import { WarpStore } from '../warp/store.js';
import { absorb } from '../absorb.js';
import { readSelvage, readFabric } from './fabric.js';
import type { Strand } from './strand.js';
import { findAnchor } from './anchor.js';
import { verifyCandidate } from './verify.js';
import { gitRun, gitText } from './git-run.js';
import { auditChain, advanceAuditCursor } from './mirror-audit.js';
import {
  MirrorRefusal,
  LEDGER_REL,
  guardGit,
  parseLedger,
  joinLedger,
  readSnapshot,
  readCap,
  planTips,
  publish,
  isAncestor,
  emitMirrorSignal,
  branchRefOf,
  remoteRefOf,
  type FabricSection,
  type LedgerLine,
  type MirrorConfig,
} from './git-mirror.js';
import { computeKeyId, type AgentKeyRegistryRow } from './keys.js';

/* ───────────────────────────── merge planning (kept from W1) ───────────────────────────── */

export type MergeKind = 'up-to-date' | 'fast-forward' | 'union';

export interface MergePlan {
  kind: MergeKind;
  /** the incoming lines appended to the ledger, in incoming order. */
  append: LedgerLine[];
  /** length of the shared pickId prefix. */
  common: number;
}

/**
 * Plan the merge of `remote` into `local` (both in ledger order). Pure. Throws a
 * MirrorRefusal for a diverged linear (v1/v2) tail and for a causality break.
 * v2 strands bind their POSITION (seq in the pickId preimage, parentPickId = the
 * physical predecessor), so only v3 (position-free) tails union.
 */
export function planMerge(local: LedgerLine[], remote: LedgerLine[], source: string): MergePlan {
  let i = 0;
  while (i < local.length && i < remote.length && local[i].pickId === remote[i].pickId) i++;
  if (i === remote.length) return { kind: 'up-to-date', append: [], common: i };
  if (i === local.length) return { kind: 'fast-forward', append: remote.slice(i), common: i };

  const tailL = local.slice(i);
  const tailR = remote.slice(i);
  const linearL = tailL.filter((s) => s.schemaVersion < 3).length;
  const linearR = tailR.filter((s) => s.schemaVersion < 3).length;
  if (linearL > 0 || linearR > 0) {
    throw new MirrorRefusal(
      `warpline: adopt refused — this ledger and ${source} diverged after ${i === 0 ? 'their first strand' : `strand ${local[i - 1].pickId}`} ` +
        `and the divergent tails carry LINEAR-chain strands (v1/v2: ${linearL} local, ${linearR} incoming). A v2 strand's ` +
        `identity binds its ledger position, so a set-union would forge chain-breaks; only v3 PICK-DAG strands union. ` +
        `Nothing was written. This worktree stays a fork (its seals are recorded in its own ref).`,
      'adopt-refused',
    );
  }
  const have = new Set(local.map((s) => s.pickId));
  const append: LedgerLine[] = [];
  for (const s of tailR) {
    if (have.has(s.pickId)) continue;
    for (const p of s.parents) {
      if (!have.has(p)) {
        throw new MirrorRefusal(
          `warpline: adopt refused — incoming strand ${s.pickId} names parent ${p}, which neither ledger carries ` +
            `before it (causality / truncation evidence). Nothing was written.`,
          'adopt-refused',
        );
      }
    }
    append.push(s);
    have.add(s.pickId);
  }
  return { kind: append.length > 0 ? 'union' : 'up-to-date', append, common: i };
}

/* ───────────────────────────── the pre-0.3.0 tracked ledger (kept from W1) ───────────────────────────── */

/** The newest HEAD commit whose tree still carries the ledger, or null. */
export function lastTrackedCommit(root: string): string | null {
  if (gitRun(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).status !== 0) return null;
  const c = gitText(root, ['log', '-1', '--format=%H', '--', LEDGER_REL]);
  if (!c) return null;
  if (gitRun(root, ['cat-file', '-e', `${c}:${LEDGER_REL}`]).status === 0) return c;
  const parent = `${c}^`;
  return gitRun(root, ['cat-file', '-e', `${parent}:${LEDGER_REL}`]).status === 0 ? gitText(root, ['rev-parse', parent]) : null;
}

function blobAt(root: string, commit: string, rel: string, cap: number): Buffer | null {
  const size = gitRun(root, ['cat-file', '-s', `${commit}:${rel}`]);
  if (size.status !== 0) return null;
  if (Number(size.stdout.toString('utf8').trim()) > cap) {
    throw new MirrorRefusal(`warpline: adopt refused — ${commit.slice(0, 12)}:${rel} is over the ${cap}-byte read cap (L3).`, 'adopt-refused');
  }
  const r = gitRun(root, ['cat-file', 'blob', `${commit}:${rel}`]);
  return r.status === 0 ? r.stdout : null;
}

/* ───────────────────────────── adoption ───────────────────────────── */

export interface AdoptResult {
  action: MergeKind | 'no-source';
  source: string | null;
  sourceCommit: string | null;
  appended: number;
  ownCommit: string | null;
}

const failureKey = (f: { kind: string; pickId: string }): string => `${f.kind}\u0000${f.pickId}`;

function strandsOf(lines: LedgerLine[]): Strand[] {
  return lines.map((l) => JSON.parse(l.raw.toString('utf8')) as Strand);
}

/**
 * Verify the candidate and apply the adoption policy (steps 5-6). Throws a
 * MirrorRefusal naming the first new failure. Pure over the disk (reads only).
 */
export interface CandidateContext {
  /** the fabric-legacy.json the candidate is verified against (undefined = the local file). */
  legacy?: Buffer | null;
  /** the tracked signing pin + the record's key registry (fresh clones have no local keys). */
  signing?: { signedFrom: string | null; agentRows: AgentKeyRegistryRow[] };
}

/** The signing context for adoption: the TRACKED pin + the INCOMING record registry, filtered to pinned fingerprints. */
export function signingFromPin(cfg: MirrorConfig, registry: Buffer | null): CandidateContext['signing'] {
  if (cfg.signedFrom === undefined) return undefined;
  const pinned = new Set(cfg.keyIds ?? []);
  const agentRows: AgentKeyRegistryRow[] = [];
  for (const line of (registry?.toString('utf8') ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as AgentKeyRegistryRow;
      if (r.kind === 'agent-key' && typeof r.publicKeyPem === 'string' && pinned.has(r.keyId) && computeKeyId(r.publicKeyPem) === r.keyId) agentRows.push(r);
    } catch {
      /* a malformed row is never a usable key */
    }
  }
  return { signedFrom: cfg.signedFrom, agentRows };
}

export function assertCandidate(
  root: string,
  local: LedgerLine[],
  candidate: LedgerLine[],
  incoming: LedgerLine[],
  source: string,
  cc: CandidateContext = {},
): void {
  const incomingIds = new Set(incoming.map((l) => l.pickId));
  const candStrands = strandsOf(candidate);
  // 6. policy
  const anchor = findAnchor(candStrands);
  const anchored = anchor?.attests?.prefixCount ?? 0;
  candStrands.forEach((s, i) => {
    if (!incomingIds.has(s.pickId)) return;
    if (s.schemaVersion >= 2 && !s.binding?.treeId) {
      throw new MirrorRefusal(
        `warpline: adopt refused — incoming strand ${s.pickId} (v${s.schemaVersion}) carries no byte binding; ` +
          `adoption requires every incoming v2/v3 strand to be bound (an unbound strand is unauthenticatable). ` +
          `Nothing was written.`,
        'adopt-refused',
      );
    }
    if (s.schemaVersion < 2 && i >= anchored) {
      throw new MirrorRefusal(
        `warpline: adopt refused — incoming v1 strand ${s.pickId} sits outside the anchored v1 prefix ` +
          `(${anchored} strand(s)); no new v1 strand is ever adopted. Nothing was written.`,
        'adopt-refused',
      );
    }
  });
  // 5. structural verify: new (kind, pickId) failures refuse
  const before = new Set((local.length > 0 ? verifyCandidate(root, strandsOf(local), cc) : []).map(failureKey));
  for (const f of verifyCandidate(root, candStrands, cc)) {
    if (before.has(failureKey(f))) continue;
    const s = candStrands.find((x) => x.pickId === f.pickId);
    if (incomingIds.has(f.pickId) && f.objectAbsent === true && s?.binding?.treeId && (f.kind === 'missing-binding' || f.kind === 'merge-recipe-invalid')) {
      continue; // binding objects do not travel; a CORRUPT object is never tolerated
    }
    throw new MirrorRefusal(
      `warpline: adopt refused — the candidate ledger from ${source} fails verification: ${f.kind} at ` +
        `${f.pickId || '(fabric)'} — ${f.detail}. Nothing was written (ledger, refs and audit cursor unchanged).`,
      'adopt-refused',
    );
  }
}

/**
 * Adopt verified history into an open section (steps 1-7). `sourceRef` forces a
 * source; default: the local canonical branch, else its remote-tracking ref,
 * else the last commit that tracked the ledger (only when the ledger is empty).
 */
export function adoptIntoSection(section: FabricSection, opts: { sourceRef?: string } = {}): AdoptResult {
  const { ctx, cfg, root, wdir } = section;
  return guardGit(ctx, () => {
    const local = parseLedger(section.bytes).lines;
    let sourceRef: string | null = opts.sourceRef ?? null;
    let sourceCommit: string | null = null;
    if (sourceRef === null) {
      if (section.branchTip) {
        sourceRef = branchRefOf(cfg);
        sourceCommit = section.branchTip;
      } else if (section.remoteTip) {
        sourceRef = remoteRefOf(cfg);
        sourceCommit = section.remoteTip;
      }
    } else {
      sourceCommit = gitRun(root, ['rev-parse', '--verify', '--quiet', `${sourceRef}^{commit}`]).stdout.toString('utf8').trim() || null;
    }

    if (sourceCommit === null || sourceRef === null) {
      if (local.length > 0) return { action: 'no-source', source: null, sourceCommit: null, appended: 0, ownCommit: section.ownCommit };
      const c = lastTrackedCommit(root);
      if (c === null) return { action: 'no-source', source: null, sourceCommit: null, appended: 0, ownCommit: section.ownCommit };
      return adoptFromTrackedCommit(section, c);
    }
    if (sourceCommit === section.ownCommit) {
      return { action: 'up-to-date', source: sourceRef, sourceCommit, appended: 0, ownCommit: section.ownCommit };
    }

    // 3. audit every new commit of the source chain
    const audit = auditChain(ctx, cfg, sourceRef, sourceCommit, { localLedgerBytes: section.bytes.length });
    const bad = audit.violations[0];
    if (bad) {
      throw new MirrorRefusal(`warpline: adopt refused — ${bad.kind}: ${bad.detail} Nothing was written.`, bad.kind);
    }
    // 2 + 4. read (capped) and plan
    const snap = readSnapshot(ctx, sourceCommit, readCap(section.bytes.length));
    const incoming = parseLedger(snap.bytes);
    if (incoming.malformed.length > 0) {
      throw new MirrorRefusal(`warpline: adopt refused — ${sourceRef} carries malformed ledger lines; nothing was written.`, 'adopt-refused');
    }
    const plan = planMerge(local, incoming.lines, sourceRef);
    if (plan.kind === 'up-to-date') {
      // (review 4) the ledger already carries the source — the OWN ref must still record it
      if (section.ownCommit !== sourceCommit && (section.ownCommit === null || !isAncestor(ctx, sourceCommit, section.ownCommit))) {
        publish(
          section,
          section.bytes,
          section.bytes.equals(snap.bytes)
            ? { adoptCommit: sourceCommit }
            : { extraParents: [sourceCommit], message: `warpline: record ${sourceRef} (already carried)` },
        );
      }
      advanceAuditCursor(ctx, sourceRef, sourceCommit);
      return { action: 'up-to-date', source: sourceRef, sourceCommit, appended: 0, ownCommit: section.ownCommit };
    }
    const candidate = [...local, ...plan.append];
    // 5 + 6. verify the candidate before anything moves
    // (review 13) verify against the manifest that will be recorded: the local one, else the incoming one
    const legacyPath = path.join(wdir, 'fabric-legacy.json');
    const localLegacy = fs.existsSync(legacyPath) ? fs.readFileSync(legacyPath) : null;
    if (localLegacy !== null && snap.legacy !== null && !localLegacy.equals(snap.legacy)) {
      throw new MirrorRefusal(`warpline: adopt refused — ${sourceRef} records a different fabric-legacy.json than this clone. Nothing was written.`, 'adopt-refused');
    }
    const legacy = localLegacy ?? snap.legacy;
    assertCandidate(root, local, candidate, plan.append, sourceRef, { legacy, signing: signingFromPin(cfg, snap.registry) });
    const merged = joinLedger(candidate);
    const applyTips = planTips(wdir, candidate);

    // 7. the record first, then the files + tips, then the cursor
    publish(
      section,
      merged,
      merged.equals(snap.bytes)
        ? { adoptCommit: sourceCommit }
        : { extraParents: [sourceCommit], legacy, message: `warpline: adopt ${plan.kind} from ${sourceRef} (+${plan.append.length})` },
    );
    fs.mkdirSync(wdir, { recursive: true });
    if (localLegacy === null && legacy !== null) atomicWriteSync(legacyPath, legacy);
    atomicWriteSync(path.join(wdir, 'fabric.jsonl'), merged);
    applyTips();
    advanceAuditCursor(ctx, sourceRef, sourceCommit);
    emitMirrorSignal(ctx, '!fabric-adopted', { source: sourceRef, commit: sourceCommit, kind: plan.kind, appended: plan.append.length });
    return { action: plan.kind, source: sourceRef, sourceCommit, appended: plan.append.length, ownCommit: section.ownCommit };
  });
}

/** H2 path: no branch anywhere, but a commit still tracked the ledger — restore it, verified. */
function adoptFromTrackedCommit(section: FabricSection, commit: string): AdoptResult {
  const { root, wdir } = section;
  const cap = readCap(0);
  const bytes = blobAt(root, commit, LEDGER_REL, cap);
  if (bytes === null) return { action: 'no-source', source: null, sourceCommit: null, appended: 0, ownCommit: section.ownCommit };
  const parsed = parseLedger(bytes);
  if (parsed.malformed.length > 0) {
    throw new MirrorRefusal(`warpline: adopt refused — ${commit.slice(0, 12)}:${LEDGER_REL} has malformed lines.`, 'adopt-refused');
  }
  const legacy = blobAt(root, commit, '.warpline/fabric-legacy.json', cap);
  const legacyPath = path.join(wdir, 'fabric-legacy.json');
  assertCandidate(root, [], parsed.lines, parsed.lines, `commit ${commit.slice(0, 12)}`, { legacy, signing: signingFromPin(section.cfg, null) });
  const applyTips = planTips(wdir, parsed.lines);
  fs.mkdirSync(wdir, { recursive: true });
  const merged = joinLedger(parsed.lines);
  publish(section, merged, { extraParents: [], legacy, message: `warpline: adopt the ledger tracked at ${commit.slice(0, 12)}` });
  if (legacy !== null && !fs.existsSync(legacyPath)) atomicWriteSync(legacyPath, legacy);
  emitMirrorSignal(section.ctx, '!fabric-adopted', { source: `commit ${commit}`, appended: parsed.lines.length });
  atomicWriteSync(path.join(wdir, 'fabric.jsonl'), merged);
  applyTips();
  return { action: 'fast-forward', source: `commit ${commit}`, sourceCommit: null, appended: parsed.lines.length, ownCommit: section.ownCommit };
}

/**
 * After a restore or an adoption the tip pointer names a state this clone may
 * never have absorbed (the states/ cache is per clone and does not travel).
 * Re-absorb it from the tip strand's provenance.gitCommit and keep it ONLY when
 * it reproduces the recorded stateId — otherwise leave the fail-closed seal
 * refusal in place.
 */
export async function rehydrateTipState(root: string): Promise<boolean> {
  const wdir = path.join(root, '.warpline');
  const selvage = readSelvage(wdir);
  if (selvage === null) return false;
  const store = new WarpStore(root, { diskCache: true });
  if (store.loadState(selvage)) return false;
  const tip = [...readFabric(wdir)].reverse().find((s) => s.stateId === selvage);
  const commit = (tip?.provenance as { gitCommit?: string | null } | undefined)?.gitCommit;
  if (!commit) return false;
  try {
    const st = await absorb(commit, { cwd: root });
    if (st.stateId !== selvage) return false;
    store.putState(st);
    return true;
  } catch {
    return false;
  }
}
