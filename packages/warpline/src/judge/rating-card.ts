/**
 * #judge/rating-card — the STRIPPER (expo-field-test-protocol.md §5 / §4).
 *
 * The blinded second rater must never see the answer. A rating card is the KNOT
 * payload (or a false-CLEAN audit row) reduced to ONLY what §5 permits: the base,
 * both sides' full-body file texts, the file paths, and the two task intents.
 * EVERYTHING evaluative is stripped — the Warpline verdict, the confidence label,
 * the contested unit's kind ('knot'/'dangle'), the conflicting slots, the ripple
 * blast radius, the direct/ripple flag, the payloadId, the rebasedOnto tip — none
 * of it reaches the card. This module is the inverse-plus of `summarizeKnotPayload`
 * (which NULLS fileText for a token budget); the card KEEPS the bodies and DROPS
 * the judgment.
 *
 * FULL CHANGED-FILE SET (§5, the load-bearing walk): the card carries the file
 * bodies for `agentChanged ∪ otherChanged`, not only the contested files. A code
 * unit that changed on one side without knotting still belongs in the reviewer's
 * view — its file path is recovered from the symbol name (`#code:<path>::<name>` /
 * `#cfg:<path>::<key>`) and unioned with the contested units' own file paths.
 *
 * CONTENT-ADDRESSED, CLOCK-FREE (§3 custody): `cardId` = 'ratingCard:v1:' +
 * sha256(canonical(cardBody)) — no wall clock, no ordering drift, same inputs ⇒
 * byte-identical id. This module is pure over (payload/audit-row, object store):
 * no API call, no daemon token, no disk write, no import of the agent runtime.
 *
 * INJECTION SAFETY (§5 CARD HARDENING, §3d): every prose OR source field the judge
 * will see — both sides' file bodies AND their intents — is UNTRUSTED. Intents
 * arrive already enveloped on the payload and are carried through verbatim; a raw
 * source body is named untrusted at RENDER time (#judge/card-render frames every
 * body, never emitting a bare source string). A diff body is an attack surface,
 * not a trusted channel.
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import { canonicalSerialize } from '../warp/canonical.js';
import { canonicalSafe } from '../fabric/strand.js';
import { envelopeProse, type UntrustedProse } from '../envelope.js';
import { readFileFromTree, type KnotPayload } from '../fabric/knot-payload.js';
import { ObjectStore } from '../warp/object-store.js';
import { rubricRefForCardKind, type RubricRef } from './rubric.js';

export const RATING_CARD_SCHEMA = 'ratingCard:v1' as const;

/** One file's raw source text on one side; `body` is null when absent on that side. */
export interface RatingCardFile {
  filePath: string;
  /** the FULL source text (the untrusted attack surface — framed at render). */
  body: string | null;
}

/** One rated side: its task intent (enveloped) + the full changed-file set. */
export interface RatingCardSide {
  /** NON-evaluative role label — which of the two changes this is. */
  role: 'ours' | 'theirs' | 'parentA' | 'parentB';
  /** why this side wanted its change — agent prose, ALWAYS enveloped (§3d). */
  intent: UntrustedProse;
  /** this side's body for EVERY path in the changed set (null where absent). */
  files: RatingCardFile[];
}

/** The frozen, answer-stripped rating card (§5). */
export interface RatingCard {
  schemaVersion: typeof RATING_CARD_SCHEMA;
  /** content address of this card (excludes itself): clock-free, deterministic. */
  cardId: string;
  kind: 'knot' | 'clean';
  /** the FULL changed-file set (agentChanged ∪ otherChanged ∪ contested), sorted. */
  filePaths: string[];
  /** KNOT card: the shared-ancestor bodies both sides diverged from. */
  base?: { files: RatingCardFile[] };
  /** CLEAN card: the two parents' provenance (state ids only — no verdict). */
  parents?: Array<{ stateId: string }>;
  /** KNOT: [ours, theirs]. CLEAN: [parentA, parentB]. Each carries its intent. */
  sides: RatingCardSide[];
  /** CLEAN card: the sealed merged tree's bodies for the changed set. */
  mergedBody?: RatingCardFile[];
  /** CLEAN card: the NAME of the check that failed on the merge (NOT the verdict). */
  failingCheck?: string;
  /** which frozen rubric template this card is rated under. */
  rubricRef: RubricRef;
}

/** The §4 false-CLEAN audit row a clean card is built from (the stripper's source). */
export interface CleanAuditRow {
  /** the two parent stateIds of the merge (§4 attribution — provenance, not verdict). */
  parentStateIds: [string, string];
  /** the two parents' durable native trees, to read parent bodies (null = unbound). */
  parentTreeIds: [string | null, string | null];
  /** the sealed merged tree Warpline claims is clean (§4 step 1). */
  mergedTreeId: string | null;
  /** the NAME of the oracle check that failed on the merged tree (§4). Never a verdict. */
  failingCheck: string;
  /** the merge's changed file paths (the set to present per side + merged). */
  filePaths: string[];
  /** raw agent prose per parent (the two task intents) — enveloped here. */
  intents: [string, string];
}

/**
 * Recover a file path from a WARP symbol name. Code + cfg units embed their path
 * in the symbol (`#code:<relPath>::<qualified>`, `#cfg:<relPath>::<keyPath>`); a
 * bare `.purpose` component symbol carries no path and yields null (its file is
 * still reached via a contested unit's own filePath). Pure, deterministic.
 */
export function filePathOfSymbol(symbol: string): string | null {
  const m = /^#(?:code|cfg):(.+?)::/.exec(symbol);
  return m ? m[1] : null;
}

/** Read every path's body out of ONE durable tree (null tree or absent path ⇒ null). */
function bodiesFor(store: ObjectStore, treeId: string | null, paths: string[]): RatingCardFile[] {
  return paths.map((filePath) => ({
    filePath,
    body: treeId ? readFileFromTree(store, treeId, filePath) : null,
  }));
}

/** Finish a card body into a content-addressed `RatingCard` (clock-free). */
function seal(body: Omit<RatingCard, 'cardId'>): RatingCard {
  const cardId =
    RATING_CARD_SCHEMA +
    ':' +
    createHash('sha256').update(canonicalSerialize(canonicalSafe(body)), 'utf8').digest('hex');
  return { cardId, ...body };
}

/**
 * Build the blinded KNOT rating card from a `KnotPayload`. Walks
 * `agentChanged ∪ otherChanged` (plus the contested units' own file paths) to the
 * FULL changed-file set, reads base/ours/theirs bodies from the durable trees, and
 * keeps ONLY the base, both sides' bodies + file paths, and the two enveloped
 * intents. Strips the verdict, confidence, contested[].kind, conflictingSlots,
 * blastRadius, direct flag, payloadId, rebasedOnto — everything evaluative.
 */
export function buildKnotRatingCard(payload: KnotPayload, ctx: { store: ObjectStore }): RatingCard {
  const { store } = ctx;

  const paths = new Set<string>();
  for (const symbol of [...payload.agentChanged, ...payload.otherChanged]) {
    const p = filePathOfSymbol(symbol);
    if (p) paths.add(p);
  }
  for (const unit of payload.contested) {
    for (const side of [unit.base, unit.ours, unit.theirs]) {
      if (side.filePath) paths.add(side.filePath);
    }
  }
  const filePaths = [...paths].sort();

  return seal({
    schemaVersion: RATING_CARD_SCHEMA,
    kind: 'knot',
    filePaths,
    base: { files: bodiesFor(store, payload.base.treeId, filePaths) },
    sides: [
      { role: 'ours', intent: payload.ours.intent, files: bodiesFor(store, payload.ours.treeId, filePaths) },
      { role: 'theirs', intent: payload.theirs.intent, files: bodiesFor(store, payload.theirs.treeId, filePaths) },
    ],
    rubricRef: rubricRefForCardKind('knot'),
  });
}

/**
 * Build the blinded false-CLEAN rating card from a §4 audit row. Reads both parent
 * bodies and the merged body from their durable trees, presents the two intents
 * (enveloped) and the failing check NAME — but NEVER Warpline's CLEAN verdict.
 */
export function buildCleanRatingCard(row: CleanAuditRow, ctx: { store: ObjectStore }): RatingCard {
  const { store } = ctx;
  const filePaths = [...new Set(row.filePaths)].sort();

  return seal({
    schemaVersion: RATING_CARD_SCHEMA,
    kind: 'clean',
    filePaths,
    parents: [{ stateId: row.parentStateIds[0] }, { stateId: row.parentStateIds[1] }],
    sides: [
      { role: 'parentA', intent: envelopeProse(row.intents[0]), files: bodiesFor(store, row.parentTreeIds[0], filePaths) },
      { role: 'parentB', intent: envelopeProse(row.intents[1]), files: bodiesFor(store, row.parentTreeIds[1], filePaths) },
    ],
    mergedBody: bodiesFor(store, row.mergedTreeId, filePaths),
    failingCheck: row.failingCheck,
    rubricRef: rubricRefForCardKind('clean'),
  });
}
