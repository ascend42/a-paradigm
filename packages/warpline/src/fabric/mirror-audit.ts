/**
 * #mirror-audit — every client audits every canonical commit (C-6 table rows 5-6).
 *
 * The canonical branch only moves fast-forward, but a fast-forward can still carry
 * a TRUNCATED ledger (a commit whose tree simply dropped strands), and a remote can
 * be force-pushed or deleted. So each new commit since the audit cursor
 * (`<common-dir>/warpline/audit.json`) must be an append-only extension of its
 * FIRST parent (same pickIds, same order, then more) and must carry every strand of
 * any other parent (a v3 union). A tip that does not descend from the cursor is a
 * REWOUND canonical. Unchanged segment oids skip the blob read, so an incremental
 * audit reads about one segment per commit.
 *
 * Results surface as verify failure kinds (HARD): `mirror-chain-truncation`
 * (signal !mirror-chain-truncation) and `canonical-rewound` (!canonical-rewound).
 *
 * verifyMirror (the verify-side cross-check of ledger vs record) lives here too.
 *
 * Library code: no console output.
 */

import { gitText, gitRun } from './git-run.js';
import { signingFromPin } from './adopt.js';
import type { AgentKeyRegistryRow } from './keys.js';
import { readWriterId, writerRef } from './writer.js';
import { readCommitShapes, readBlobsCapped, SEGMENT_STRANDS, REGISTRY_ENTRY, type MirrorCommitShape } from './mirror-tree.js';
import {
  MirrorRefusal,
  gitContext,
  guardGit,
  mirrorConfig,
  readMirrorRefs,
  ledgerTracked,
  isAncestor,
  parseLedger,
  readLedgerBytes,
  readSnapshot,
  readCap,
  writerOf,
  branchRefOf,
  remoteRefOf,
  readAuditCursor,
  advanceAuditCursor,
  emitMirrorSignal,
  readMirrorCacheCommit,
  type MirrorCtx,
  type MirrorConfig,
} from './git-mirror.js';

export type AuditKind = 'mirror-chain-truncation' | 'canonical-rewound';

export interface AuditViolation {
  ref: string;
  commit: string;
  kind: AuditKind;
  detail: string;
  pickIds: string[];
}

export interface AuditResult {
  ref: string;
  tip: string | null;
  cursor: string | null;
  audited: number;
  violations: AuditViolation[];
}

export { readAuditCursor, advanceAuditCursor };

/**
 * Audit `ref` at `tip` against the cursor (or the whole chain with `full`). Pure
 * read; the caller advances the cursor after acting on a clean result.
 */
export function auditChain(
  ctx: MirrorCtx,
  cfg: MirrorConfig,
  ref: string,
  tip: string,
  opts: { full?: boolean; localLedgerBytes?: number } = {},
): AuditResult {
  const cursor = opts.full ? null : (readAuditCursor(ctx)[ref] ?? null);
  const violations: AuditViolation[] = [];
  if (cursor !== null && cursor !== tip) {
    let descends = false;
    try {
      descends = isAncestor(ctx, cursor, tip);
    } catch {
      descends = false; // cursor object gone ⇒ cannot prove descent
    }
    if (!descends) {
      violations.push({
        ref,
        commit: tip,
        kind: 'canonical-rewound',
        detail:
          `${ref} is at ${tip.slice(0, 12)}, which does not descend from the last audited commit ` +
          `${cursor.slice(0, 12)}: the canonical fabric was force-pushed, deleted and recreated, or rewound. ` +
          `Its history is no longer the one this clone verified; nothing is adopted from it.`,
        pickIds: [],
      });
      return { ref, tip, cursor, audited: 0, violations };
    }
  }
  if (cursor === tip) return { ref, tip, cursor, audited: 0, violations };

  const revs = gitText(ctx.root, ['rev-list', '--reverse', '--parents', tip, ...(cursor ? [`^${cursor}`] : [])])
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((a) => a.length > 0 && /^[0-9a-f]{40,64}$/.test(a[0]));
  if (revs.length === 0) return { ref, tip, cursor, audited: 0, violations };

  const all = new Set<string>();
  for (const r of revs) for (const c of r) all.add(c);
  const shapes = readCommitShapes(ctx.root, ctx.objectFormat, [...all]);
  // (item 8) blobs are read in WINDOWS of commits, each blob capped on its own
  // (a segment holds 32 strands) and each window capped in total.
  for (let w = 0; w < revs.length; w += AUDIT_WINDOW) {
    auditWindow(ctx, cfg, ref, revs.slice(w, w + AUDIT_WINDOW), shapes, violations, opts.localLedgerBytes ?? 0);
  }
  return { ref, tip, cursor, audited: revs.length, violations };
}

/* ───────────────────────────── verify-side cross-check ───────────────────────────── */

export interface MirrorVerifyReport {
  /** a `.git` exists at the root and it is a toplevel. */
  applicable: boolean;
  mode: 'none' | 'legacy' | 'pre-migration' | 'mirror';
  /** git failed with a `.git` present (HARD mirror-unavailable). */
  unavailable: string | null;
  ownRef: string | null;
  ownCommit: string | null;
  ownStrands: number;
  ledgerStrands: number;
  /** recorded pickIds absent from the ledger. */
  missing: string[];
  /** recorded pickIds present but at another position (I7 — the prefix rule). */
  misordered: string[];
  /** ledger strands past the record (not recorded — written outside publish). */
  unrecorded: number;
  matches: boolean;
  role: 'canonical' | 'fork' | 'none';
  branchTip: string | null;
  remoteTip: string | null;
  audit: AuditViolation[];
  /** the own record was rewound or deleted out of band (HARD mirror-orphan in verify). */
  ownRewound: string | null;
}

function emptyReport(mode: MirrorVerifyReport['mode'], applicable: boolean): MirrorVerifyReport {
  return {
    applicable,
    mode,
    unavailable: null,
    ownRef: null,
    ownCommit: null,
    ownStrands: 0,
    ledgerStrands: 0,
    missing: [],
    misordered: [],
    unrecorded: 0,
    matches: false,
    role: 'none',
    branchTip: null,
    remoteTip: null,
    audit: [],
    ownRewound: null,
  };
}

/** Compare the ledger against its record, and audit canonical + remote-tracking from the cursor. Read-only. */
export function verifyMirror(root: string): MirrorVerifyReport {
  let ctx: MirrorCtx | null;
  try {
    ctx = gitContext(root);
  } catch (err) {
    const r = emptyReport('none', true);
    r.unavailable = (err as Error).message;
    return r;
  }
  if (ctx === null) return emptyReport('none', false);
  const c = ctx;
  try {
    return guardGit(c, () => {
      const cfg = mirrorConfig(root);
      const wid = readWriterId(c.gitDir);
      const refs = readMirrorRefs(c, wid, cfg);
      const tracked = ledgerTracked(c);
      const mode: MirrorVerifyReport['mode'] = !tracked ? 'mirror' : refs.own || refs.branch || refs.remote || cfg.genesis ? 'pre-migration' : 'legacy';
      const report = emptyReport(mode, true);
      report.branchTip = refs.branch;
      report.remoteTip = refs.remote;
      const ledger = readLedgerBytes(root);
      const lines = parseLedger(ledger).lines;
      report.ledgerStrands = lines.length;
      if (wid && refs.own) {
        report.ownRef = writerRef(wid);
        report.ownCommit = refs.own;
        const snap = readSnapshot(c, refs.own, readCap(ledger.length));
        const rec = parseLedger(snap.bytes).lines;
        report.ownStrands = rec.length;
        report.matches = snap.bytes.equals(ledger);
        const pos = new Map(lines.map((l, i) => [l.pickId, i]));
        rec.forEach((l, i) => {
          const at = pos.get(l.pickId);
          if (at === undefined) report.missing.push(l.pickId);
          else if (at !== i) report.misordered.push(l.pickId);
        });
        report.unrecorded = Math.max(0, lines.length - rec.length);
        if (refs.branch && !c.linked) {
          report.role = writerOf(c, refs.branch) === wid && isAncestor(c, refs.branch, refs.own) ? 'canonical' : 'fork';
        } else {
          report.role = 'fork';
        }
      }
      // (item 1) the own record never rewinds/vanishes behind the canonical branch this writer wrote
      if (wid && refs.branch && !c.linked && writerOf(c, refs.branch) === wid && (refs.own === null || !isAncestor(c, refs.branch, refs.own))) {
        const have = new Set(lines.map((l) => l.pickId));
        report.missing.push(
          ...parseLedger(readSnapshot(c, refs.branch, readCap(ledger.length)).bytes)
            .lines.map((l) => l.pickId)
            .filter((id) => !have.has(id) && !report.missing.includes(id)),
        );
        report.ownRewound = `this worktree wrote ${branchRefOf(cfg)} but its own record is ${refs.own ? 'behind it' : 'missing'} (rewound or deleted)`;
      }
      const cache = readMirrorCacheCommit(c);
      if (cache && cache.commit !== refs.own && (refs.own === null || gitRun(c.root, ['merge-base', '--is-ancestor', cache.commit, refs.own]).status !== 0)) {
        report.ownRewound = `the own record moved from ${cache.commit.slice(0, 12)} to ${refs.own?.slice(0, 12) ?? '(deleted)'} (not a fast-forward)`;
      }
      if (cache?.wasCanonical && refs.branch === null && !c.linked) {
        report.audit.push({ ref: branchRefOf(cfg), commit: cache.commit, kind: 'canonical-rewound', detail: `this worktree was the canonical writer but ${branchRefOf(cfg)} is gone (deleted locally)`, pickIds: [] });
      }
      for (const [ref, tip] of [
        [branchRefOf(cfg), refs.branch],
        [remoteRefOf(cfg), refs.remote],
      ] as const) {
        if (tip === null) continue;
        try {
          const r = auditChain(c, cfg, ref, tip, { localLedgerBytes: ledger.length });
          report.audit.push(...r.violations);
          if (r.violations.length === 0) advanceAuditCursor(c, ref, tip);
          for (const v of r.violations) emitMirrorSignal(c, v.kind === 'canonical-rewound' ? '!canonical-rewound' : '!mirror-chain-truncation', { ref: v.ref, commit: v.commit });
        } catch (err) {
          report.audit.push({ ref, commit: tip, kind: 'mirror-chain-truncation', detail: `the record could not be audited: ${(err as Error).message}`, pickIds: [] });
        }
      }
      // a remote-tracking ref that VANISHED after being audited is a deletion (C-6 row: remote force-push/deletion)
      const cursors = readAuditCursor(c);
      const rr = remoteRefOf(cfg);
      if (refs.remote === null && cursors[rr]) {
        report.audit.push({
          ref: rr,
          commit: cursors[rr],
          kind: 'canonical-rewound',
          detail: `${rr} was audited at ${cursors[rr].slice(0, 12)} and is now gone (the remote branch was deleted, or pruned)`,
          pickIds: [],
        });
      }
      return report;
    });
  } catch (err) {
    if (err instanceof MirrorRefusal && err.kind === 'unavailable') {
      const r = emptyReport('none', true);
      r.unavailable = err.message;
      return r;
    }
    throw err;
  }
}

const AUDIT_WINDOW = 64;
/** A segment blob holds 32 strands; no strand line is allowed past 1 MiB. */
const SEGMENT_BLOB_CAP = SEGMENT_STRANDS * 1024 * 1024;

function auditWindow(
  ctx: MirrorCtx,
  cfg: MirrorConfig,
  ref: string,
  revs: string[][],
  shapes: Map<string, MirrorCommitShape>,
  violations: AuditViolation[],
  localLedgerBytes: number,
): void {
  // which segment blobs must be read: any segment oid that differs from the first parent's at the same index
  const need = new Set<string>();
  for (const [c, ...parents] of revs) {
    const s = shapes.get(c);
    if (!s) continue;
    if (parents.length === 0) {
      if (s.segments[0]) need.add(s.segments[0]);
      continue;
    }
    for (const p of parents) {
      const ps = shapes.get(p);
      if (!ps) continue;
      for (let i = 0; i < ps.segments.length; i++) {
        if (s.segments[i] !== ps.segments[i]) {
          need.add(ps.segments[i]);
          if (s.segments[i]) need.add(s.segments[i]);
        }
      }
      if (parents.indexOf(p) > 0) for (const o of [...ps.segments, ...s.segments]) need.add(o);
      const rp = ps.entries.get(REGISTRY_ENTRY);
      const rc = s.entries.get(REGISTRY_ENTRY);
      if (rp && rp !== rc) {
        need.add(rp);
        if (rc) need.add(rc);
      }
    }
  }
  const blobs = readBlobsCapped(ctx.root, [...need], readCap(localLedgerBytes), SEGMENT_BLOB_CAP);
  const idsOf = (oids: string[], from: number): (string[] | null)[] =>
    oids.slice(from).map((o) => {
      const b = blobs.get(o);
      return b ? parseLedger(b).lines.map((l) => l.pickId) : null;
    });

  for (const [c, ...parents] of revs) {
    const s = shapes.get(c);
    if (!s) continue;
    // every segment but the last holds exactly 32 strands (only re-read segments are checked;
    // unchanged ones were checked in the commit that introduced them)
    s.segments.forEach((o, i) => {
      const b = blobs.get(o);
      if (b && i < s.segments.length - 1 && parseLedger(b).lines.length !== SEGMENT_STRANDS) {
        violations.push({ ref, commit: c, kind: 'mirror-chain-truncation', detail: `segment ${i} of ${c.slice(0, 12)} does not hold ${SEGMENT_STRANDS} strands (malformed record)`, pickIds: [] });
      }
    });
    if (parents.length === 0) {
      if (cfg.genesis && s.segments[0]) {
        const first = idsOf([s.segments[0]], 0)[0]?.[0];
        if (first !== cfg.genesis) {
          violations.push({
            ref,
            commit: c,
            kind: 'mirror-chain-truncation',
            detail: `root commit ${c.slice(0, 12)} starts at ${first ?? '(empty)'}, not the pinned genesis ${cfg.genesis}`,
            pickIds: [cfg.genesis],
          });
        }
      }
      continue;
    }
    parents.forEach((p, pi) => {
      const ps = shapes.get(p);
      if (!ps) return;
      // the public key registry is append-only too (a dropped key would un-sign history)
      const rp = ps.entries.get(REGISTRY_ENTRY);
      const rc = s.entries.get(REGISTRY_ENTRY);
      if (rp && rp !== rc) {
        const older = blobs.get(rp);
        const newer = rc ? blobs.get(rc) : Buffer.alloc(0);
        if (!older || !newer || newer.length < older.length || !newer.subarray(0, older.length).equals(older)) {
          violations.push({ ref, commit: c, kind: 'mirror-chain-truncation', detail: `commit ${c.slice(0, 12)} rewrites or drops the recorded key registry (append-only)`, pickIds: [] });
        }
      }
      const lost: string[] = [];
      if (pi === 0) {
        for (let i = 0; i < ps.segments.length; i++) {
          if (s.segments[i] === ps.segments[i]) continue;
          const [older] = idsOf([ps.segments[i]], 0);
          const [newer] = s.segments[i] ? idsOf([s.segments[i]], 0) : [[]];
          (older ?? []).forEach((id, k) => {
            if ((newer ?? [])[k] !== id) lost.push(id);
          });
        }
      } else {
        const have = new Set(idsOf(s.segments, 0).flatMap((x) => x ?? []));
        for (const id of idsOf(ps.segments, 0).flatMap((x) => x ?? [])) if (!have.has(id)) lost.push(id);
      }
      if (lost.length > 0) {
        violations.push({
          ref,
          commit: c,
          kind: 'mirror-chain-truncation',
          detail:
            `commit ${c.slice(0, 12)} is not an append-only extension of its parent ${p.slice(0, 12)}: it drops or ` +
            `reorders ${lost.length} strand(s) (first: ${lost[0]}). A fast-forward that truncates the ledger.`,
          pickIds: lost,
        });
      }
    });
  }
}

/**
 * The signing context from the TRACKED pin (fabricMirror.signedFrom + keyIds) and
 * the own record's key registry — for a worktree with no local .warpline/keys.
 * undefined when nothing is pinned.
 */
export function recordSigning(root: string): { signedFrom: string | null; agentRows: AgentKeyRegistryRow[] } | undefined {
  try {
    const ctx = gitContext(root);
    if (ctx === null) return undefined;
    const cfg = mirrorConfig(root);
    if (cfg.signedFrom === undefined) return undefined;
    const refs = readMirrorRefs(ctx, readWriterId(ctx.gitDir), cfg);
    const tip = refs.own ?? refs.branch ?? refs.remote;
    const registry = tip ? readSnapshot(ctx, tip, readCap(0)).registry : null;
    return signingFromPin(cfg, registry);
  } catch {
    return undefined;
  }
}
