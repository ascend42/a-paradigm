/**
 * #fabric — the durable Warpline history of this project. The append-only
 * PICK-DAG ledger (`.warpline/fabric.jsonl`) + the live tip pointer: the LEGACY
 * stateId selvage (`.warpline/refs/selvage`) and — once a repo runs the one-time
 * V3.2 migration (refs.ts) — the authoritative pickId ref
 * (`.warpline/refs/heads/selvage`). During coexistence seal maintains BOTH.
 *
 * COEXISTENCE INVARIANT: the fabric writes ONLY under `.warpline/` — never the
 * user's git HEAD/index/worktree/tracked files. Git keeps running normally;
 * Warpline accumulates its OWN meaning-history alongside it. This is the same
 * disk boundary the read-only Phase-1 oracle already honored (~read-only),
 * extended from a debug cache into the authoritative store.
 *
 * The selvage publish is atomic (write-tmp + rename) so a crash never leaves a
 * half-written tip. The fabric append is line-atomic JSONL.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { computePickId, computeLegacyBodyHash, reproducesUnderKnownRule, type Strand } from './strand.js';
import { findAnchor, strandDigest } from './anchor.js';

/** One grandfathered legacy strand: its stored pickId + its PINNED body hash (§7.2). */
export interface FabricLegacyEntry {
  pickId: string;
  /** computeLegacyBodyHash over the strand body — pins everything but confidence/binding/merge. */
  bodyHash: string;
}

/** The grandfathered-legacy manifest (§7.2) — strands whose hashed byte #grade destroyed. */
export interface FabricLegacy {
  reason: string;
  grandfathered: FabricLegacyEntry[];
}

/**
 * The grandfathered legacy manifest (§7.2 containment) as pickId → pinned bodyHash,
 * read from `.warpline/fabric-legacy.json`. ENOENT ⇒ empty map (no legacy residue).
 * Any other read/parse failure THROWS — a corrupt allow-list must not silently widen
 * or narrow. The RETIRED bare-pickId format (pre body-pinning) FAILS CLOSED with a
 * regenerate instruction rather than auto-upgrading: an unpinned grandfather clause
 * is exactly the hole HIGH-2 closed, so we refuse to run with one.
 */
export function readLegacyGrandfathered(wdir: string): Map<string, string> {
  const p = path.join(wdir, 'fabric-legacy.json');
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw new Error(`warpline: fabric-legacy.json unreadable at ${p}: ${(err as Error).message}`);
  }
  const parsed = JSON.parse(raw) as FabricLegacy;
  const out = new Map<string, string>();
  for (const entry of parsed.grandfathered ?? []) {
    if (typeof entry === 'string') {
      throw new Error(
        `warpline: fabric-legacy.json at ${p} uses the retired bare-pickId format — ` +
          `regenerate the legacy manifest with {pickId, bodyHash} entries ` +
          `(bodyHash = computeLegacyBodyHash over the strand body; spec §7.2 amendment 2026-07-01)`,
      );
    }
    if (!entry.pickId || !entry.bodyHash) {
      throw new Error(`warpline: fabric-legacy.json at ${p} — entry missing pickId/bodyHash (corrupt allow-list)`);
    }
    out.set(entry.pickId, entry.bodyHash);
  }
  return out;
}

/**
 * The parsed grandfather manifest as its full `FabricLegacy` object (reason +
 * entries), or null when absent (ENOENT). Distinct from readLegacyGrandfathered
 * (which returns the pickId→bodyHash Map for membership checks): the epoch anchor
 * digests the WHOLE manifest object (anchor.ts §3.1 computeManifestDigest), so it
 * needs the parsed value verbatim. A parse failure THROWS (fail-closed — a corrupt
 * manifest must never hash as "empty").
 */
export function readLegacyManifest(wdir: string): FabricLegacy | null {
  const p = path.join(wdir, 'fabric-legacy.json');
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`warpline: fabric-legacy.json unreadable at ${p}: ${(err as Error).message}`);
  }
  return JSON.parse(raw) as FabricLegacy;
}

/** The `.warpline/` dir for a repo root (same dir #warp-store writes under). */
export function warplineDirOf(root: string): string {
  return path.join(root, '.warpline');
}

function selvagePath(wdir: string): string {
  return path.join(wdir, 'refs', 'selvage');
}

function fabricPath(wdir: string): string {
  return path.join(wdir, 'fabric.jsonl');
}

/** The current tip stateId, or null if no pick has ever been sealed. */
export function readSelvage(wdir: string): string | null {
  try {
    return fs.readFileSync(selvagePath(wdir), 'utf8').trim() || null;
  } catch (err) {
    // ENOENT = never sealed (genuinely no tip). ANY other error (permission, I/O,
    // a selvage that exists but can't be read) must NOT masquerade as "no history"
    // — that would let a caller fast-admit a fresh genesis over a real tip. Fail closed.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(
      `warpline: selvage pointer unreadable at ${selvagePath(wdir)} — refusing to treat a corrupt tip as empty history: ${(err as Error).message}`,
    );
  }
}

/**
 * Advance the tip to `stateId` atomically (write-tmp + rename). When `expectedOld`
 * is supplied, this is a COMPARE-AND-SWAP: it throws if the on-disk selvage no
 * longer equals what the caller's decision was based on (a concurrent writer moved
 * it). Callers seal inside #fabric-lock; the CAS is defense-in-depth against a
 * stolen/stale lock so a lost-update can never silently publish a wrong tip.
 */
export function writeSelvage(wdir: string, stateId: string, expectedOld?: string | null): void {
  const p = selvagePath(wdir);
  if (expectedOld !== undefined) {
    const cur = readSelvage(wdir);
    if (cur !== expectedOld) {
      throw new Error(
        `warpline: selvage CAS failed — expected ${expectedOld ?? '(none)'}, found ${cur ?? '(none)'} (a concurrent writer advanced the tip)`,
      );
    }
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, stateId + '\n', 'utf8');
  fs.renameSync(tmp, p); // atomic publish — no half-written selvage
}

/** Append one strand to the fabric ledger (newest last). */
export function appendStrand(wdir: string, strand: Strand): void {
  const p = fabricPath(wdir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(strand) + '\n', 'utf8');
}

/** The full fabric history in seal order (oldest first). [] if none yet. */
export function readFabric(wdir: string): Strand[] {
  let raw: string;
  try {
    raw = fs.readFileSync(fabricPath(wdir), 'utf8');
  } catch (err) {
    // ENOENT = the ledger has never been written (genuinely empty). Any other read
    // failure must fail closed — reading real history as [] is silent data loss.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(
      `warpline: fabric ledger unreadable at ${fabricPath(wdir)} — refusing to read history as empty: ${(err as Error).message}`,
    );
  }
  // A malformed line must THROW (with its position) — never silently drop the rest
  // of the history. The ledger is authoritative; a truncated/corrupt strand is a
  // signal to stop, not to forget everything after it.
  const lines = raw.split('\n');
  const strands: Strand[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    try {
      strands.push(JSON.parse(line) as Strand);
    } catch (err) {
      throw new Error(
        `warpline: fabric ledger corrupt at ${fabricPath(wdir)}:${i + 1} — a malformed strand must not silently drop history: ${(err as Error).message}`,
      );
    }
  }
  return strands;
}

/**
 * Rewrite the whole ledger atomically (write-tmp + rename). Used ONLY to update
 * graded annotations (calibratedConfidence) — which are excluded from the pickId,
 * so a strand's content-address is unchanged. The meaning-history (stateId/delta/
 * pickId) is never rewritten. Callers hold #fabric-lock.
 */
export function rewriteFabric(wdir: string, strands: Strand[]): void {
  // IDENTITY GUARD (Aegis H2, §7.4 + HIGH-2 containment): a strand passes if its
  // stored pickId reproduces under ANY known hashing rule (§7.1), OR it is a
  // GRANDFATHERED v1 strand whose PINNED body hash still matches (§7.2). Because
  // calibratedConfidence is excluded from the rules AND from the body hash, grade's
  // confidence rewrite passes cleanly for every strand — but the grandfathered path
  // no longer skips the guard wholesale: any mutation of an identity field
  // (intent/stateId/delta/binding.treeId/parentPickId/…) THROWS, grandfathered or
  // not — no silent drift, no whole-body rewrite hole.
  const grandfathered = readLegacyGrandfathered(wdir);
  for (const s of strands) {
    if (reproducesUnderKnownRule(s)) continue;
    const { pickId, ...body } = s;
    const pinned = grandfathered.get(s.pickId);
    if (pinned !== undefined && s.schemaVersion < 2) {
      if (computeLegacyBodyHash(body) === pinned) continue; // confidence-only change — legal
      throw new Error(
        `warpline: rewriteFabric refused — grandfathered strand seq ${s.seq} body hash ` +
          `${computeLegacyBodyHash(body)} != pinned ${pinned}; grandfathering exempts the retired ` +
          `pickId rule, NOT the body (only calibratedConfidence is rewritable).`,
      );
    }
    throw new Error(
      `warpline: rewriteFabric refused — strand seq ${s.seq} recomputed pickId ${computePickId(body)} ` +
        `!= stored ${pickId}; an identity field was mutated (only calibratedConfidence is rewritable).`,
    );
  }
  const onDisk = readFabric(wdir);

  // V3 IMMUTABILITY (v3-identity spec §1.1): a v3 strand has ZERO post-seal-mutable
  // fields — it does not even carry calibratedConfidence (grades live in the
  // grades.jsonl sidecar, §7). The identity guard above cannot catch a mutation of
  // a hash-EXCLUDED field (there are none IN the identity, but a writer could
  // GRAFT one on, e.g. stamp calibratedConfidence onto a v3 strand), so refuse any
  // byte difference outright. rewriteFabric itself retires at V3.4; until then no
  // rewrite may touch a v3 strand.
  for (let i = 0; i < strands.length && i < onDisk.length; i++) {
    if (strands[i].schemaVersion >= 3 || onDisk[i].schemaVersion >= 3) {
      if (strandDigest(strands[i]) !== strandDigest(onDisk[i])) {
        throw new Error(
          `warpline: rewriteFabric refused — v3 strand ${onDisk[i].pickId} has ZERO post-seal-mutable ` +
            `fields (sealed bytes are final; grades belong in grades.jsonl — v3-identity spec §1.1/§7).`,
        );
      }
    }
  }

  // V1 FREEZE (spec §7): once the ON-DISK fabric carries an epoch anchor, the v1
  // prefix is IMMUTABLE — no grading, no binding stamps, no repair. Byte-level
  // (full-strand canonical digest, calibratedConfidence + binding included), not
  // rule-based: any change to a covered strand refuses at the WRITER, closing the
  // HIGH-A binding-injection write path (and freezing v1 confidence — grade.ts
  // skips frozen v1 strands, so this only fires on a genuine v1 mutation).
  const anchor = findAnchor(onDisk);
  if (anchor?.attests) {
    const covered = anchor.attests.prefixCount;
    for (let i = 0; i < covered && i < strands.length && i < onDisk.length; i++) {
      if (strandDigest(strands[i]) !== strandDigest(onDisk[i])) {
        throw new Error(
          `warpline: rewriteFabric refused — v1 strand seq ${onDisk[i].seq} is FROZEN by the epoch ` +
            `anchor (${anchor.pickId}); the v1 prefix is immutable: no grading, no binding stamps, no ` +
            `repair. (v1-anchor freeze, docs/specs/warpline-v1-anchor.md §7)`,
        );
      }
    }
  }

  // LOST-UPDATE CAS (M2 trust floor, item 4 — Judge): the caller composed `strands`
  // from a ledger READ some time ago; if a concurrent writer APPENDED since (a
  // stolen/stale lock, or a caller outside #fabric-lock), blindly renaming over the
  // file would silently DROP that strand. Assert the on-disk ledger is still
  // pick-for-pick the one this rewrite was derived from — annotations may differ
  // (that is what rewrite is for), identities may not. Callers hold #fabric-lock;
  // this is defense-in-depth, symmetric with the writeSelvage CAS.
  if (onDisk.length !== strands.length || onDisk.some((s, i) => s.pickId !== strands[i].pickId)) {
    throw new Error(
      `warpline: rewriteFabric CAS failed — the on-disk ledger (${onDisk.length} strand(s)) no longer matches ` +
        `the ${strands.length} strand(s) this rewrite was derived from (a concurrent writer appended/changed ` +
        `history); re-read and retry rather than silently dropping a strand.`,
    );
  }
  const p = fabricPath(wdir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, strands.map((s) => JSON.stringify(s)).join('\n') + (strands.length ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, p);
}

/** Append a calibration-grade event to .warpline/grades.jsonl (the confidence trajectory). */
export function appendGradeEvent(wdir: string, ev: unknown): void {
  const p = path.join(wdir, 'grades.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(ev) + '\n', 'utf8');
}
