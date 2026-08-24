/**
 * #fabric-repair — THE REPAIR PATH (soundness audit C-13 + the P1 entry
 * "detection without repair is a dead end a real crash will find").
 *
 * Warpline detects nearly everything and, until this module, repaired nothing.
 * Two surfaces close that gap, and they are the two the audit could point at a
 * user standing in front of:
 *
 *   `warpline fabric repair`   — a torn tail line bricks EVERY verb, including the
 *                                diagnostic. Trace proved it reachable with no
 *                                crash at all: a real `pick` on a full disk
 *                                committed a 142-byte partial line, and after
 *                                freeing space `log`, `selvage`, `restore`, `pick`
 *                                AND `fabric verify` all failed. The documented
 *                                recovery was hand-editing JSONL in a text editor
 *                                — precisely what source control must never
 *                                require. The live fabric's largest line is
 *                                307,905 bytes, so the tear window is wide.
 *
 *   `warpline refs set`        — `verify` already surfaces "⚠ abandoned head(s) —
 *                                no ref names", and recovering one required
 *                                hand-editing .warpline/refs/heads/selvage. A
 *                                finding you cannot act on is a finding you learn
 *                                to scroll past.
 *
 * WHAT REPAIR DOES NOT DO. It does not prevent the torn line. fsync makes a write
 * DURABLE, not ATOMIC — `appendDurableSync` guarantees the bytes that landed are on
 * the medium, never that all of them landed. Repair only makes the tear
 * RECOVERABLE. A genuinely atomic append needs a different on-disk shape (length-
 * prefixed records, a write-ahead intent, or a rename-per-strand segment store) and
 * is deliberately out of scope here.
 *
 * ═══ THE DESIGN CALLS, MADE EXPLICITLY ═══
 *
 * 1. TAIL TEARS ONLY; MID-FILE CORRUPTION REFUSES. The audit's instruction was
 *    "truncate to the last well-formed strand". Taken literally on a ledger whose
 *    corruption sits in the MIDDLE, that discards every well-formed strand after
 *    it — repair would become the data-loss event. So a malformed line is
 *    repairable only when nothing well-formed follows it, which is exactly the
 *    crash/full-disk shape the finding describes. Anything else refuses and names
 *    how many good strands truncation would have cost. Conservative by
 *    construction: the refused case is the one where an automated fix destroys
 *    evidence a human could still read.
 *
 * 2. NOTHING IS WRITTEN WITHOUT `--confirm`. Default is a DRY RUN that reports the
 *    plan and exits 0. "Silent repair of a source-control ledger would be worse
 *    than the corruption" — a verb that quietly shortens history the first time it
 *    is run in a panic is a worse tool than one that refuses.
 *
 * 3. THE ORIGINAL IS QUARANTINED FIRST, DURABLY. The pre-repair bytes are copied to
 *    `.warpline/repair/fabric.jsonl.<iso>.bak` through #warp-durable (fsync +
 *    rename + parent-dir fsync) BEFORE the ledger is shortened, so a crash during
 *    the repair cannot leave the operator with neither copy. The torn bytes are
 *    themselves evidence — a truncated record must never be destroyed to fix it.
 *
 * 4. THE RETAINED PREFIX IS REPUBLISHED VERBATIM. Repair slices the raw Buffer; it
 *    never re-serializes the strands it keeps. Every strand's pickId and the epoch
 *    anchor's prefix digest are functions of the STORED BYTES, so a re-serialized
 *    "identical" ledger would invalidate the v1 prefix wholesale.
 *
 * 5. REPAIR DOES NOT TOUCH THE TIP POINTERS. In the crash shape the append tore, so
 *    the selvage/ref publish that FOLLOWS it never ran and both pointers still name
 *    the last good strand — repair is complete. Where they do disagree, that is
 *    C-4/C-12 territory with its own detectors, and a repair verb that silently
 *    re-pointed heads would be doing meaning-level surgery under a byte-level name.
 *    Repair reports and defers to `fabric verify`.
 *
 * Both verbs run under #fabric-lock and re-read inside it: the scan that produced
 * the plan happened outside, and a concurrent seal may have landed since.
 *
 * Library code: no console output — the CLI prints.
 */

import * as path from 'node:path';
import { atomicWriteSync } from '../warp/durable.js';
import { warplineDirOf, scanFabric, type MalformedLedgerLine } from './fabric.js';
import { readRef, writeRef } from './refs.js';
import { withFabricLock } from './lock.js';

/** A refusal by repair's own safeguards (vs an environmental error). */
export class RepairRefusal extends Error {}

/* ── fabric repair ───────────────────────────────────────────────────────────── */

/** One malformed line plus the bounded, terminal-safe excerpt repair prints. */
export interface DroppedLine extends MalformedLedgerLine {
  /**
   * The first bytes of the dropped line, control characters and non-ASCII
   * escaped. A torn line is attacker-influenceable content on its way to a
   * terminal (audit MEDIUM: raw ANSI injection from strand prose can overwrite
   * Warpline's own labels), and half a JSON strand is not prose anyone should
   * read raw anyway.
   */
  excerpt: string;
}

export interface FabricRepairResult {
  /** the ledger's absolute path. */
  ledger: string;
  /** every line parsed — nothing to repair. */
  intact: boolean;
  /** whether the ledger was actually rewritten (false on a dry run or when intact). */
  applied: boolean;
  /** total non-empty physical lines before the repair. */
  lines: number;
  /** well-formed strands retained. */
  kept: number;
  /** the malformed tail line(s) the repair drops, with excerpts. */
  dropped: DroppedLine[];
  /** bytes retained / discarded. */
  keptBytes: number;
  droppedBytes: number;
  /** the pickId the repaired ledger tips at (null when the repair empties it). */
  newTip: string | null;
  /** where the pre-repair ledger was quarantined (null on a dry run). */
  backup: string | null;
}

export interface RepairOptions {
  /** actually rewrite the ledger. Default false — the dry run reports the plan. */
  confirm?: boolean;
  /** injectable clock (ISO) — determinism in tests; names the quarantine file. */
  now?: string;
}

/** Bounded, terminal-safe rendering of a torn line's opening bytes. */
function excerptOf(raw: Buffer, offset: number, bytes: number, max = 96): string {
  const slice = raw.subarray(offset, offset + Math.min(bytes, max));
  let out = '';
  for (const b of slice) {
    if (b === 0x5c) out += '\\\\';
    else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
    else out += `\\x${b.toString(16).padStart(2, '0')}`;
  }
  return bytes > max ? `${out}…` : out;
}

function planFrom(wdir: string): {
  scan: ReturnType<typeof scanFabric>;
  dropped: DroppedLine[];
} {
  const scan = scanFabric(wdir);
  const dropped: DroppedLine[] = scan.malformed.map((m) => ({
    ...m,
    excerpt: excerptOf(scan.raw, m.offset, m.bytes),
  }));
  return { scan, dropped };
}

/**
 * Salvage a torn ledger tail. Dry run by default (call 2); with `confirm` it
 * quarantines the original (call 3) and republishes the well-formed prefix
 * VERBATIM (call 4), under #fabric-lock.
 *
 * Refuses (RepairRefusal) when the corruption is not confined to the tail (call 1)
 * — truncating would then discard well-formed history, which is the thing repair
 * exists to prevent.
 */
export async function repairFabric(root: string, opts: RepairOptions = {}): Promise<FabricRepairResult> {
  const wdir = warplineDirOf(root);
  const now = opts.now ?? new Date().toISOString();

  // Outside the lock: the read-only plan. A dry run stops here — it must never
  // contend for the lock with a live seal just to print a diagnostic.
  const pre = planFrom(wdir);
  assertRepairable(pre.scan, pre.dropped);
  if (!opts.confirm || pre.dropped.length === 0) {
    return shape(pre.scan, pre.dropped, { applied: false, backup: null });
  }

  return withFabricLock(root, () => {
    // Re-scan INSIDE the lock: the plan above was computed against a ledger a
    // concurrent seal may have appended to (or repaired) since.
    const { scan, dropped } = planFrom(wdir);
    assertRepairable(scan, dropped);
    if (dropped.length === 0) return shape(scan, dropped, { applied: false, backup: null });

    // (3) quarantine FIRST, durably — the torn bytes are evidence.
    const backup = path.join(wdir, 'repair', `fabric.jsonl.${now.replace(/[:.]/g, '-')}.bak`);
    atomicWriteSync(backup, scan.raw);

    // (4) republish the well-formed prefix VERBATIM (raw slice, never re-serialized).
    atomicWriteSync(scan.path, scan.raw.subarray(0, scan.lastGoodEnd));

    return shape(scan, dropped, { applied: true, backup });
  });
}

/** Call 1 — the corruption must be confined to the tail, or repair refuses. */
function assertRepairable(scan: ReturnType<typeof scanFabric>, dropped: DroppedLine[]): void {
  if (dropped.length === 0) return;
  const firstBad = dropped[0].offset;
  if (firstBad >= scan.lastGoodEnd) return; // every good line precedes every bad one
  // Count what truncating to the last well-formed line BEFORE the corruption costs.
  const lost = scan.strandOffsets.filter((o) => o > firstBad).length;
  throw new RepairRefusal(
    `warpline: fabric repair refused — the corruption at ${scan.path}:${dropped[0].line} is NOT at the tail: ` +
      `${lost} well-formed strand(s) follow it. Truncating to the last well-formed strand before it would DISCARD them, ` +
      `which is the data loss this verb exists to prevent. Repair handles a torn TAIL line (the crash/full-disk shape); ` +
      `mid-ledger damage needs a human, a backup (\`warpline backup verify <dest>\`), or the stake branch.`,
  );
}

function shape(
  scan: ReturnType<typeof scanFabric>,
  dropped: DroppedLine[],
  extra: { applied: boolean; backup: string | null },
): FabricRepairResult {
  const tip = scan.strands[scan.strands.length - 1];
  return {
    ledger: scan.path,
    intact: dropped.length === 0,
    applied: extra.applied,
    lines: scan.lines,
    kept: scan.strands.length,
    dropped,
    keptBytes: scan.lastGoodEnd,
    droppedBytes: scan.raw.length - scan.lastGoodEnd,
    newTip: tip?.pickId ?? null,
    backup: extra.backup,
  };
}

/* ── refs set ────────────────────────────────────────────────────────────────── */

export interface RefSetResult {
  name: string;
  pickId: string;
  /** what the ref held before the move (null = the ref did not exist). */
  previous: string | null;
  /** false when the ref already held this pickId (idempotent no-op). */
  moved: boolean;
  /** an existing ref was overwritten under --force. */
  forced: boolean;
}

/**
 * Point `refs/heads/<name>` at `pickId` — the actionable half of `verify`'s
 * abandoned-head report.
 *
 * Two guards, both required by the audit:
 *   - the pickId MUST name a strand present in the fabric. A ref into nothing is
 *     the `ref-unresolved` HARD failure verify already reports; a repair verb that
 *     can mint one is a repair verb that manufactures corruption.
 *   - an EXISTING ref is never clobbered without `force`. Overwriting a head is how
 *     sealed work becomes an abandoned head, and the whole reason sealed work
 *     survives here is that nothing quietly forgets it.
 *
 * The write is the same per-ref CAS every seal uses (expectedOld = what we read
 * under the lock), so a concurrent advance refuses rather than lost-updating.
 */
export async function setFabricRef(
  root: string,
  name: string,
  pickId: string,
  opts: { force?: boolean } = {},
): Promise<RefSetResult> {
  const wdir = warplineDirOf(root);
  return withFabricLock(root, () => {
    // scanFabric, not readFabric: a torn tail must not make ref repair impossible
    // — the two repair verbs have to be usable in either order.
    const scan = scanFabric(wdir);
    if (!scan.strands.some((s) => s.pickId === pickId)) {
      throw new RepairRefusal(
        `warpline: refs set refused — no strand in the fabric carries pickId ${pickId}. ` +
          `A ref names an EVENT that happened; pointing one at an absent strand manufactures the ` +
          `ref-unresolved corruption \`fabric verify\` exists to catch.` +
          (scan.malformed.length
            ? ` (Note: the ledger has ${scan.malformed.length} malformed line(s) — run \`warpline fabric repair\`.)`
            : ''),
      );
    }
    const previous = readRef(wdir, name);
    if (previous === pickId) {
      return { name, pickId, previous, moved: false, forced: false };
    }
    if (previous !== null && !opts.force) {
      throw new RepairRefusal(
        `warpline: refs set refused — refs/heads/${name} already points at ${previous}. ` +
          `Overwriting a head is how sealed work becomes an ABANDONED head (recoverable, but only if someone ` +
          `notices). Re-run with --force if that is what you mean, or pick another ref name.`,
      );
    }
    writeRef(wdir, name, pickId, previous); // per-ref CAS on what we just read
    return { name, pickId, previous, moved: true, forced: previous !== null };
  });
}
