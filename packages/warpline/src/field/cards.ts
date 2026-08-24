/**
 * #field-cards — habit (ii) capture, SCAN-based (expo-field-test-protocol.md §6
 * habit (ii); field-test-readiness-2026-08-23.md §B7 increment 1).
 *
 * Habit (ii) demands a §5 rating card for every KNOT. There is no admit-path
 * hook in increment 1: this module SCANS the persisted KNOT payloads
 * (.warpline/knots/) and builds each one's blinded rating card via the existing
 * #judge stripper (buildKnotRatingCard — the card carries NO Warpline verdict,
 * confidence, or founder label; the stripper already guarantees it and the
 * blindness test re-asserts it on the serialized bytes).
 *
 * THE B-3 GAP, RECORDED NOT FAKED: a byte-downgrade KNOT on the git admit path
 * returns its refusal WITHOUT persisting a payload (admit.ts byte-overlap
 * downgrade sites; the native path was fixed by B-3/T-2026-08-11-014). A card
 * needs both sides' bodies — building one from MergeRecipe trees alone is
 * increment-2 work — so those KNOTs are emitted as CARD-LESS entries in
 * `byteDowngrades`, naming the strand-side identity the refusal recorded and
 * why no card exists. The evidence trail is the f4 trace
 * (.warpline/f4/trace.jsonl): a GATE_REFUSED refusal with verdict:'KNOT' and no
 * pointers.knotPayloadId. The trace file is read DIRECTLY here (a narrow local
 * row type) because field modules are standalone from src/daemon by rule.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { listKnotPayloads } from '../fabric/knot-payload.js';
import { buildKnotRatingCard, type RatingCard } from '../judge/rating-card.js';
import { ObjectStore } from '../warp/object-store.js';

/** A KNOT that produced no payload — recorded card-less, never fabricated. */
export interface ByteDowngradeEntry {
  /**
   * The identity the refusal recorded (proposedStateId / rebasedOnto); never
   * invented. Named `stateRef`, not `strandId` (reviewer follow-on, 2026-08-23):
   * a byte-downgrade KNOT never sealed a strand — the value is a STATE reference
   * off the refusal pointers, and calling it a strandId claimed an identity that
   * does not exist on the fabric.
   */
  stateRef: string;
  reason: string;
}

export interface FieldCards {
  knotCards: RatingCard[];
  byteDowngrades: ByteDowngradeEntry[];
}

/** The MINIMAL f4-trace row slice this scan needs (read directly — no daemon import). */
interface TraceRowSlice {
  ok?: boolean;
  refusal?: {
    code?: string;
    verdict?: string | null;
    pointers?: { knotPayloadId?: string; proposedStateId?: string; rebasedOnto?: string };
  };
}

function readTraceSlices(root: string): TraceRowSlice[] {
  const p = path.join(root, '.warpline', 'f4', 'trace.jsonl');
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`warpline: f4 trace unreadable at ${p}: ${(err as Error).message}`);
  }
  const out: TraceRowSlice[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line) as TraceRowSlice);
    } catch {
      /* an unreadable trace line is advisory telemetry — skipped, never fatal */
    }
  }
  return out;
}

/**
 * Collect every buildable KNOT rating card (scan of .warpline/knots/, one card
 * per payload, deduped by cardId) + every byte-downgrade KNOT that has NO
 * payload to build from (deduped by recorded identity).
 */
export function collectFieldCards(root: string, ctx: { store: ObjectStore }): FieldCards {
  const knotCards: RatingCard[] = [];
  const seenCards = new Set<string>();
  for (const payload of listKnotPayloads(root)) {
    const card = buildKnotRatingCard(payload, { store: ctx.store });
    if (seenCards.has(card.cardId)) continue;
    seenCards.add(card.cardId);
    knotCards.push(card);
  }

  const byteDowngrades: ByteDowngradeEntry[] = [];
  const seenDowngrades = new Set<string>();
  for (const row of readTraceSlices(root)) {
    const r = row.refusal;
    if (!r || r.verdict !== 'KNOT') continue;
    if (r.pointers?.knotPayloadId) continue; // a payload exists → the card scan above covers it
    const stateRef = r.pointers?.proposedStateId ?? r.pointers?.rebasedOnto ?? '(unrecorded)';
    if (seenDowngrades.has(stateRef)) continue;
    seenDowngrades.add(stateRef);
    byteDowngrades.push({
      stateRef,
      reason:
        'byte-downgrade KNOT without a persisted payload (B-3 gap: the refusal advertised no knotPayloadId; ' +
        'a rating card needs both sides’ bodies — building one from MergeRecipe trees alone is increment-2 work)',
    });
  }

  return { knotCards, byteDowngrades };
}

/* ── persistence (.warpline/field/cards/) ────────────────────────────────────── */

export function fieldCardsDirOf(root: string): string {
  return path.join(root, '.warpline', 'field', 'cards');
}

export function byteDowngradesPathOf(root: string): string {
  return path.join(fieldCardsDirOf(root), 'byte-downgrades.jsonl');
}

const safeName = (id: string): string => id.replace(/[^a-zA-Z0-9._-]/g, '_');

export interface WriteCardsResult {
  /** cards newly written this pass. */
  written: number;
  /** cards already on disk (idempotent skip by cardId). */
  skippedExisting: number;
  /** byte-downgrade entries newly appended (idempotent by stateRef). */
  downgradesRecorded: number;
}

/**
 * Persist the collected cards: one `<cardId>.json` per card (idempotent by
 * cardId — a card is content-addressed, so an existing file IS the card) and the
 * card-less byte-downgrade entries appended to byte-downgrades.jsonl (idempotent
 * by stateRef). The card JSON is the RatingCard verbatim — the stripper already
 * removed every evaluative field, and the blindness test guards the bytes.
 */
export function writeCards(root: string, cards: FieldCards): WriteCardsResult {
  const dir = fieldCardsDirOf(root);
  fs.mkdirSync(dir, { recursive: true });

  let written = 0;
  let skippedExisting = 0;
  for (const card of cards.knotCards) {
    const full = path.join(dir, `${safeName(card.cardId)}.json`);
    if (fs.existsSync(full)) {
      skippedExisting++;
      continue;
    }
    const tmp = `${full}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(card, null, 2), 'utf8');
    fs.renameSync(tmp, full);
    written++;
  }

  const dlPath = byteDowngradesPathOf(root);
  const already = new Set<string>();
  if (fs.existsSync(dlPath)) {
    for (const line of fs.readFileSync(dlPath, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        // Accept the pre-rename key too: an increment-1 log wrote `strandId`
        // for the same value (renamed to stateRef, reviewer follow-on 2026-08-23).
        const parsed = JSON.parse(line) as { stateRef?: string; strandId?: string };
        const ref = parsed.stateRef ?? parsed.strandId;
        if (ref !== undefined) already.add(ref);
      } catch {
        /* skip unreadable line */
      }
    }
  }
  let downgradesRecorded = 0;
  for (const entry of cards.byteDowngrades) {
    if (already.has(entry.stateRef)) continue;
    fs.appendFileSync(dlPath, JSON.stringify(entry) + '\n', 'utf8');
    already.add(entry.stateRef);
    downgradesRecorded++;
  }

  return { written, skippedExisting, downgradesRecorded };
}
