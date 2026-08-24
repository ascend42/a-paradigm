/**
 * #knot-payload — the machine-readable KNOT payload, `knotPayload:v1` (P2.2 / R3,
 * docs/specs/warpline-forge.md §3a — the forge's issue AND the agent's work
 * order, ONE shape).
 *
 * A KNOT verdict alone hands a resolver essence HASHES + slot names — detection
 * without machine resolution relocates the bottleneck (Loid's R3 finding). This
 * payload is the self-sufficient document: **a fresh agent must be able to
 * propose a KNOT resolution from the payload alone, without repo archaeology**
 * (the §3a exit gate), and a forge must be able to render it as an issue page
 * without a second query.
 *
 * Forge-spec §3a compliance map (each bullet → a field):
 *   - Identity:            contested[].{stableKey,symbol,conflictingSlots,direct}
 *                          + rebasedOnto/agentChanged/otherChanged (admit context)
 *   - Both sides' BODIES:  contested[].{ours,theirs,base}.{body,fileText} — the
 *                          actual competing meanings, sourced from the durable
 *                          object store (content-addressed), not a diff hunk
 *   - Both sides' INTENTS: ours.intent / theirs.intent — ENVELOPED prose
 *                          (untrusted-prose, §3d) + actor/agentId attribution
 *   - Blast radius:        blastRadius — a mode:'ripple' graph slice (roots =
 *                          contested symbols; edges = who references them)
 *   - Resolution envelope: KnotResolutionProposal — exactly what resolveKnot
 *                          (ResolveOptions) accepts; a proposal is DATA attached
 *                          to the knot, never an auto-applied change
 *
 * Guardrails honored: G1 (schemaVersion, additive evolution), G2 (no seq/ledger
 * positions — every reference is stateId/treeId/contentId/stableKey), G3 (this
 * IS the engine shape; forge/GUI import it verbatim), G4 (the only write a
 * payload invites is the resolve verb), G5 (payloads are derived sidecar data
 * under .warpline/knots/ — never a signed strand). Deterministic: no wall-clock
 * fields; same inputs ⇒ byte-identical payload ⇒ same payloadId.
 *
 * INJECTION SAFETY (§3d, T-2026-06-24-013): every free-prose field in this
 * payload is an UntrustedProse envelope. Structural fields (essences, deltas,
 * slots, ripple) are computed by the engine and never pass through prose. No
 * verdict/gate function reads any prose field — see the poisoned-prose
 * invariant test (test/injection-envelope.test.ts).
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { diff, type SemDelta } from '../sem-delta.js';
import type { AdmitDecision } from './admit.js';
import type { WarpState } from '../warp/warp-state.js';
import type { WarpObject } from '../warp/warp-object.js';
import { ObjectStore } from '../warp/object-store.js';
import { canonicalSerialize } from '../warp/canonical.js';
import { canonicalSafe } from './strand.js';
import { envelopeProse, verifyProse, type UntrustedProse } from '../envelope.js';
import type { ResolveOptions } from './resolve.js';

export const KNOT_PAYLOAD_SCHEMA = 'knotPayload:v1' as const;
export const KNOT_PROPOSAL_SCHEMA = 'knotResolutionProposal:v1' as const;

/** One side's admission metadata (ours = the admitting agent; theirs = the live selvage side). */
export interface KnotPayloadSide {
  /** which agent authored this side (null when unattributed). */
  agentId: string | null;
  actor: string;
  /** why this side wanted its change — agent prose, ENVELOPED (§3d). */
  intent: UntrustedProse;
  stateId: string;
  /** native byte tree of this side in the object store (null when unbound). */
  treeId: string | null;
  gitCommit: string | null;
  /** the git ref / WORKTREE this side was lifted from (provenance label). */
  ref: string | null;
}

/** One side's view of a contested unit — the actual competing meaning. */
export interface ContestedSideView {
  /** does the unit exist on this side? (false = retired/absent). */
  present: boolean;
  /** the essence contentId on this side (essenceA/essenceB), when present. */
  essence: string | null;
  /**
   * the unit's MEANING body on this side: a code-unit's CCNF body (the `body`
   * slot in the essence data) or the canonical contract JSON for a .purpose
   * symbol. Structural (engine-computed), NOT prose.
   */
  body: string | null;
  /** where the unit lives on this side (provenance label). */
  filePath: string | null;
  /**
   * the FULL source text of filePath on this side, read from the side's durable
   * treeId in the object store — what a resolver edits to produce the merged
   * content. null when the side has no durable tree or the path is unreadable.
   */
  fileText: string | null;
  /** this side's semantic delta for the unit (contract deltas per side). */
  delta: SemDelta | null;
}

/** A contested code-unit/symbol: one KNOT or DANGLE entry, with both sides' content. */
export interface ContestedUnit {
  kind: 'knot' | 'dangle';
  stableKey: string;
  symbol: string;
  /** the slots both sides changed in conflicting directions (knots). */
  conflictingSlots: string[];
  /** direct-contested (own-content edit) vs ripple-only (T-2026-07-03-002). */
  direct: boolean;
  /** dangle-specific shape (present iff kind === 'dangle'). */
  dangle?: {
    fromSymbol: string;
    edgeKind: string;
    danglingTargetSymbol: string;
    retiredBy: 'A' | 'B';
  };
  base: Omit<ContestedSideView, 'delta'>;
  ours: ContestedSideView;
  theirs: ContestedSideView;
}

/** The blast-radius slice: a render-by-projection ripple graph (spec §3a). */
export interface RippleSlice {
  mode: 'ripple';
  /** the contested symbols the slice grows from. */
  roots: string[];
  /** roots ∪ every symbol with an edge into a root (union of both sides). */
  symbols: string[];
  edges: Array<{ from: string; to: string; kind: string }>;
}

/**
 * The RESOLUTION-PROPOSAL envelope (§3a): exactly what a resolver must submit,
 * shaped so `proposalToResolveOptions` maps it 1:1 onto resolveKnot's
 * ResolveOptions. A proposal is data — sealing stays behind the resolve verb
 * and the scrutiny tier; there is NO auto-resolution path here (P5-gated on the
 * blind injection corpus, §3d).
 */
export interface KnotResolutionProposal {
  schemaVersion: typeof KNOT_PROPOSAL_SCHEMA;
  /** the payload being resolved. */
  payloadId: string;
  /** who made the call (KnotResolution.decidedBy). */
  decidedBy: string;
  /** why — agent prose, ENVELOPED; verified before it maps to ResolveOptions. */
  reason: UntrustedProse;
  /**
   * the chosen/merged CONTENT REFERENCE to seal as the new tip: a git ref or
   * the literal WORKTREE (ResolveOptions.resolvedRef).
   */
  resolvedRef: string;
  /** optional: the original conflicting ref, for the precise contended set. */
  oursRef?: string | null;
}

/** The self-sufficient KNOT/DANGLE work order (forge-spec §3a). */
export interface KnotPayload {
  schemaVersion: typeof KNOT_PAYLOAD_SCHEMA;
  /** content address of this payload (excludes itself). */
  payloadId: string;
  verdict: 'KNOT' | 'DANGLE';
  /** the selvage stateId the proposal was re-based against. */
  rebasedOnto: string;
  base: { stateId: string; treeId: string | null };
  ours: KnotPayloadSide;
  theirs: KnotPayloadSide;
  /** symbol names each side changed vs the shared base (admit context). */
  agentChanged: string[];
  otherChanged: string[];
  contested: ContestedUnit[];
  blastRadius: RippleSlice;
  /**
   * the submission contract: what a resolver returns (a KnotResolutionProposal)
   * and the verb that seals it. Descriptive, machine-checkable — never a write.
   */
  resolution: {
    submitVia: 'resolve';
    proposalSchema: typeof KNOT_PROPOSAL_SCHEMA;
    requires: ['decidedBy', 'reason', 'resolvedRef'];
  };
}

/* ── construction ────────────────────────────────────────────────────────────── */

export interface BuildKnotPayloadInput {
  decision: AdmitDecision;
  base: WarpState;
  proposed: WarpState;
  selvage: WarpState;
  ours: { agentId: string | null; actor: string; intent: string; ref: string | null; gitCommit: string | null; treeId: string | null };
  theirs: { agentId: string | null; actor: string; intent: string; ref: string | null; gitCommit: string | null; treeId: string | null };
  baseTreeId: string | null;
  /** read a file's text out of a durable tree (object store) — null when absent. */
  readFile?: (treeId: string, relPath: string) => string | null;
}

/**
 * Read one file's text out of a native tree in the object store (walks path
 * components; verified reads all the way down). Returns null when the path is
 * absent or the object is missing — the payload degrades to meaning-bodies-only
 * rather than failing the verdict.
 */
export function readFileFromTree(store: ObjectStore, treeId: string, relPath: string): string | null {
  try {
    let entries = store.getTree(treeId);
    const parts = relPath.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const entry = entries.find((e) => e.name === parts[i]);
      if (!entry) return null;
      if (i === parts.length - 1) {
        if (entry.mode === '40000' || entry.mode === '160000') return null;
        return store.getBlob(entry.id).toString('utf8');
      }
      if (entry.mode !== '40000') return null;
      entries = store.getTree(entry.id);
    }
    return null;
  } catch {
    return null;
  }
}

const byStableKey = (state: WarpState): Map<string, WarpObject> => {
  const map = new Map<string, WarpObject>();
  for (const obj of state.objects.values()) map.set(obj.stableKey, obj);
  return map;
};

/**
 * A unit's MEANING body: the code-unit CCNF body (`contract.codeEssence` — the
 * `body` slot the essence hashes) when present, else the canonical contract
 * JSON. Structural content, engine-computed — not prose.
 */
function bodyOf(obj: WarpObject | undefined): string | null {
  if (!obj) return null;
  const code = (obj.contract as Record<string, unknown>).codeEssence;
  if (typeof code === 'string') return code;
  try {
    return canonicalSerialize(canonicalSafe(obj.contract));
  } catch {
    return null;
  }
}

function sideView(
  obj: WarpObject | undefined,
  treeId: string | null,
  delta: SemDelta | null,
  readFile: (treeId: string, relPath: string) => string | null,
): ContestedSideView {
  const filePath = obj?.filePath ?? null;
  return {
    present: !!obj,
    essence: obj?.contentId ?? null,
    body: bodyOf(obj),
    filePath,
    fileText: treeId && filePath ? readFile(treeId, filePath) : null,
    delta,
  };
}

/** The blast-radius ripple slice over the UNION of both sides' edge graphs. */
function rippleSlice(roots: string[], states: WarpState[]): RippleSlice {
  const rootSet = new Set(roots);
  const symbols = new Set(roots);
  const edgeKeys = new Set<string>();
  const edges: RippleSlice['edges'] = [];
  for (const state of states) {
    for (const obj of state.objects.values()) {
      for (const e of obj.edges ?? []) {
        if (!rootSet.has(e.to)) continue;
        const key = `${obj.symbol}|${e.to}|${e.kind}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({ from: obj.symbol, to: e.to, kind: e.kind });
        symbols.add(obj.symbol);
      }
    }
  }
  edges.sort((a, b) =>
    a.from !== b.from ? (a.from < b.from ? -1 : 1) : a.to !== b.to ? (a.to < b.to ? -1 : 1) : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0,
  );
  return { mode: 'ripple', roots: [...roots].sort(), symbols: Array.from(symbols).sort(), edges };
}

/**
 * Build the `knotPayload:v1` for a KNOT/DANGLE decision. Pure over its inputs
 * (states + decision + byte-tree reader): no clock, no disk writes — callers
 * persist via persistKnotPayload. Throws if the decision is not KNOT/DANGLE.
 */
export function buildKnotPayload(input: BuildKnotPayloadInput): KnotPayload {
  const { decision } = input;
  if (decision.status !== 'KNOT' && decision.status !== 'DANGLE') {
    throw new Error(`warpline: buildKnotPayload — decision is ${decision.status}, not KNOT/DANGLE`);
  }
  if (!decision.rebasedOnto) {
    throw new Error('warpline: buildKnotPayload — a KNOT/DANGLE decision must carry rebasedOnto');
  }
  const readFile =
    input.readFile ?? ((): null => null);

  const baseByKey = byStableKey(input.base);
  const oursByKey = byStableKey(input.proposed);
  const theirsByKey = byStableKey(input.selvage);

  // Per-side contract deltas: ours = base→proposed (deltaA), theirs = base→selvage (deltaB).
  const oursDelta = diff(input.base, input.proposed).deltas;
  const theirsDelta = diff(input.base, input.selvage).deltas;

  const unitFor = (key: string): Omit<ContestedUnit, 'symbol' | 'conflictingSlots' | 'direct' | 'kind'> => {
    const baseObj = baseByKey.get(key);
    const baseFilePath = baseObj?.filePath ?? null;
    return {
      stableKey: key,
      base: {
        present: !!baseObj,
        essence: baseObj?.contentId ?? null,
        body: bodyOf(baseObj),
        filePath: baseFilePath,
        fileText: input.baseTreeId && baseFilePath ? readFile(input.baseTreeId, baseFilePath) : null,
      },
      ours: sideView(oursByKey.get(key), input.ours.treeId, oursDelta.get(key) ?? null, readFile),
      theirs: sideView(theirsByKey.get(key), input.theirs.treeId, theirsDelta.get(key) ?? null, readFile),
    };
  };

  const contested: ContestedUnit[] = [
    ...decision.knots.map(
      (k): ContestedUnit => ({
        kind: 'knot',
        symbol: k.symbol,
        conflictingSlots: [...k.conflictingSlots],
        direct: k.direct ?? true,
        ...unitFor(k.stableKey),
      }),
    ),
    ...decision.dangling.map(
      (d): ContestedUnit => ({
        kind: 'dangle',
        symbol: d.fromSymbol,
        conflictingSlots: [],
        direct: d.direct ?? true,
        dangle: {
          fromSymbol: d.fromSymbol,
          edgeKind: d.edgeKind,
          danglingTargetSymbol: d.danglingTargetSymbol,
          retiredBy: d.retiredBy,
        },
        ...unitFor(d.fromKey),
      }),
    ),
  ];

  const roots = Array.from(new Set(contested.map((c) => c.symbol)));

  const body: Omit<KnotPayload, 'payloadId'> = {
    schemaVersion: KNOT_PAYLOAD_SCHEMA,
    verdict: decision.status,
    rebasedOnto: decision.rebasedOnto,
    base: { stateId: input.base.stateId, treeId: input.baseTreeId },
    ours: {
      agentId: input.ours.agentId,
      actor: input.ours.actor,
      intent: envelopeProse(input.ours.intent),
      stateId: input.proposed.stateId,
      treeId: input.ours.treeId,
      gitCommit: input.ours.gitCommit,
      ref: input.ours.ref,
    },
    theirs: {
      agentId: input.theirs.agentId,
      actor: input.theirs.actor,
      intent: envelopeProse(input.theirs.intent),
      stateId: input.selvage.stateId,
      treeId: input.theirs.treeId,
      gitCommit: input.theirs.gitCommit,
      ref: input.theirs.ref,
    },
    agentChanged: [...decision.agentChanged],
    otherChanged: [...decision.otherChanged],
    contested,
    blastRadius: rippleSlice(roots, [input.proposed, input.selvage]),
    resolution: {
      submitVia: 'resolve',
      proposalSchema: KNOT_PROPOSAL_SCHEMA,
      requires: ['decidedBy', 'reason', 'resolvedRef'],
    },
  };

  const payloadId =
    'knotPayload:v1:' +
    createHash('sha256').update(canonicalSerialize(canonicalSafe(body)), 'utf8').digest('hex');
  return { payloadId, ...body };
}

/* ── the proposal → resolve mapping (G4: writes go through the gate) ─────────── */

/**
 * Map a resolution proposal onto resolveKnot's ResolveOptions — the ONLY path
 * from a proposal to a seal. Fails CLOSED on a tampered/forged reason envelope
 * (the prose must hash to its contentAddress) or a schema mismatch; the reason
 * lands on the strand as KnotResolution.reason (the accountability record).
 */
export function proposalToResolveOptions(
  proposal: KnotResolutionProposal,
  opts: { agentId: string; cwd?: string },
): ResolveOptions {
  if (proposal.schemaVersion !== KNOT_PROPOSAL_SCHEMA) {
    throw new Error(
      `warpline: proposalToResolveOptions — unknown proposal schema ${JSON.stringify(proposal.schemaVersion)} (fail closed; expected ${KNOT_PROPOSAL_SCHEMA})`,
    );
  }
  if (!verifyProse(proposal.reason)) {
    throw new Error(
      'warpline: proposalToResolveOptions — the reason envelope is tampered/forged (body does not hash to its contentAddress); refusing to seal — fail closed',
    );
  }
  if (!proposal.resolvedRef || typeof proposal.resolvedRef !== 'string') {
    throw new Error('warpline: proposalToResolveOptions — resolvedRef (the chosen/merged content reference) is required');
  }
  if (!proposal.decidedBy || typeof proposal.decidedBy !== 'string') {
    throw new Error('warpline: proposalToResolveOptions — decidedBy is required (the accountability record)');
  }
  return {
    cwd: opts.cwd,
    agentId: opts.agentId,
    resolvedRef: proposal.resolvedRef,
    reason: proposal.reason.body,
    decidedBy: proposal.decidedBy,
    ...(proposal.oursRef ? { oursRef: proposal.oursRef } : {}),
  };
}

/* ── sidecar persistence (.warpline/knots/ — G5: derived data, never a strand) ─ */

const safeName = (id: string): string => id.replace(/[^a-zA-Z0-9._-]/g, '_');

export function knotsDirOf(root: string): string {
  return path.join(root, '.warpline', 'knots');
}

/** Persist a payload to .warpline/knots/<payloadId>.json (atomic, idempotent). */
export function persistKnotPayload(root: string, payload: KnotPayload): string {
  const dir = knotsDirOf(root);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, `${safeName(payload.payloadId)}.json`);
  if (!fs.existsSync(full)) {
    const tmp = `${full}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, full);
  }
  return full;
}

/** All persisted payloads (unsorted — payloads carry no ledger position, G2). */
export function listKnotPayloads(root: string): KnotPayload[] {
  const dir = knotsDirOf(root);
  if (!fs.existsSync(dir)) return [];
  const out: KnotPayload[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as KnotPayload);
    } catch {
      /* unreadable sidecar rows are skipped, never fatal */
    }
  }
  return out;
}

/**
 * The DETERMINISTIC pick among ambiguous matches: sort by the content-address
 * payloadId (a total order, clock-free — payloads carry no wall-clock field, G2)
 * and take the first. A `.find()` over `listKnotPayloads` bound whatever
 * fs.readdir happened to yield first (I-1 defect #2): a proposal re-admitted
 * against a moved selvage persists a SECOND payload with the same ours.stateId,
 * and the coin-flip picked an arbitrary one. Sorting makes the tie-break stable.
 */
function firstByPayloadId(candidates: KnotPayload[]): KnotPayload | null {
  if (candidates.length === 0) return null;
  return candidates
    .slice()
    .sort((a, b) => (a.payloadId < b.payloadId ? -1 : a.payloadId > b.payloadId ? 1 : 0))[0];
}

/**
 * Resolve a selector to a persisted payload: an exact payloadId, a payloadId
 * prefix, or an ADMIT reference — the ours-side git ref/commit/stateId of the
 * admission that produced it. Returns null when nothing matches.
 *
 * A single selector can match MULTIPLE payloads (a re-admitted proposal shares
 * its ours.stateId / ref / commit across contests). Each ambiguous category is
 * resolved DETERMINISTICALLY by `firstByPayloadId` — never fs.readdir order. For
 * the EXACT knot a resolution settles, prefer `findKnotPayloadForResolve`, which
 * pins the (ours, theirs) stateId pair rather than the ours-side alone.
 */
export function readKnotPayload(root: string, selector: string): KnotPayload | null {
  const dir = knotsDirOf(root);
  const exact = path.join(dir, `${safeName(selector)}.json`);
  if (fs.existsSync(exact)) {
    try {
      return JSON.parse(fs.readFileSync(exact, 'utf8')) as KnotPayload;
    } catch {
      return null;
    }
  }
  const all = listKnotPayloads(root);
  // payloadId is the content address — an exact hit is unique, so `.find` is safe.
  const byId = all.find((p) => p.payloadId === selector);
  if (byId) return byId;
  const byPrefix = firstByPayloadId(
    all.filter((p) => selector.length >= 12 && p.payloadId.startsWith(selector)),
  );
  if (byPrefix) return byPrefix;
  return firstByPayloadId(
    all.filter(
      (p) =>
        p.ours.ref === selector ||
        p.ours.gitCommit === selector ||
        p.ours.stateId === selector ||
        (selector.length >= 7 && !!p.ours.gitCommit && p.ours.gitCommit.startsWith(selector)),
    ),
  );
}

/**
 * Find THE payload a resolution settles — the EXACT join behind
 * KnotResolution.knotPayloadId. Where `readKnotPayload` matches on the ours-side
 * alone, this pins the CONTESTED stateId PAIR: the payload whose theirs-side is
 * the selvage now being resolved AND whose ours-side is this agent's proposal.
 *
 * That pair is what disambiguates the SAME proposal contested twice (I-1 defect
 * #2): re-admitted against a moved selvage it yields two payloads with an
 * identical ours.stateId but DIFFERENT theirs.stateId — only the one rebased onto
 * the CURRENT selvage is the knot this resolve seals (`theirs.stateId ===
 * rebasedOnto === selvage`, admit.ts). The ours-side key is `oursStateId` when
 * the caller knows it (resolve --ours) and otherwise the admitting `agentId`,
 * which is derivable without --ours — so the join no longer waits for the flag
 * (defect #1). Residual ties break by payloadId (deterministic, never readdir
 * order). Returns null when no payload was persisted (a shadow-era contest) — the
 * field then stays honestly absent rather than guessed.
 */
export function findKnotPayloadForResolve(
  root: string,
  q: { selvageStateId: string; agentId: string; oursStateId?: string | null },
): KnotPayload | null {
  const onThisSelvage = listKnotPayloads(root).filter((p) => p.theirs.stateId === q.selvageStateId);
  const scoped = q.oursStateId
    ? onThisSelvage.filter((p) => p.ours.stateId === q.oursStateId)
    : onThisSelvage.filter((p) => p.ours.agentId === q.agentId);
  return firstByPayloadId(scoped);
}

/**
 * The PW-7 summary projection: the payload minus per-side FILE BODIES — the
 * structural index a resolver (or a cold agent on a token budget) can hold,
 * with every contentAddress/id kept so the full payload stays one hydration
 * away. A TRANSPORT projection of the persisted object, never persisted itself:
 * `payloadId` still names the FULL payload, and the `summary:true` marker is
 * the honest partiality flag (a truncated shape without a marker is a lie —
 * same rule as contestedTotal).
 */
export function summarizeKnotPayload(payload: KnotPayload): KnotPayload & { summary: true } {
  return {
    ...payload,
    summary: true,
    contested: payload.contested.map((c) => ({
      ...c,
      base: { ...c.base, fileText: null },
      ours: { ...c.ours, fileText: null },
      theirs: { ...c.theirs, fileText: null },
    })),
  };
}
