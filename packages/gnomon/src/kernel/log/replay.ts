/**
 * @symbol #kernel-log
 *
 * #kernel-log replay (spec §2.1 boundary falsifier G-KRN-01, §3.3, §19.1
 * M1.12) — `gnomon replay <home> [--expect <hash>]`: verifyLog first, then a
 * DETERMINISTIC fold of the verified chain into the replay projection, whose
 * hash is the replay's answer. A log that does not verify is never folded.
 *
 * THE PROJECTION (what "replay" means here, M1.12 slice 3 reading). G-KRN-01
 * claims replay of KERNEL-CONTROLLED inputs plus the recorded hashes of host
 * layers the kernel does not control, not of host context (§3.3). So the
 * fold reproduces, per session (hsid), in seq order:
 *   - inputs: every `session.inject{origin, hash, bytes}` and every
 *     `turn.sent{turn, permitId, contentHash}`. A `turn.sent` binds to the
 *     session's last UNCONSUMED `origin: client` inject (a kernel, peer or mod
 *     inject in between is folded but never matched) and consumes it; one
 *     whose contentHash is not that inject's hash, or with no client inject
 *     pending, is a DIVERGENCE (the kernel would have sent bytes it never
 *     logged, L2). An inject whose `bytes` is a string (the plaintext, where
 *     §3.2 wants a byte count) is a divergence `inject-plaintext` — the
 *     append path refuses it (checkPayload), so a row carrying it did not come
 *     through the log's own append (round 2, Aegis C1);
 *   - host: the `*Hash` / `sha256` fields of `session.spawned`,
 *     `session.layers.changed` and `session.compacted` (its summaryHash: a
 *     backend output, T-2026-10-18-016) rows, RECORDED, never reproduced;
 *   - cards: the last state of each card (`approval.request` → open,
 *     `approval.decide` → its decision, `approval.expire` → expired);
 * plus the log id, the head {seq, hash} and a per-kind row count. Nothing
 * from the wall clock, the environment or the filesystem beyond the chain's
 * own envelope bytes enters the fold, so two replays of one log produce the
 * same `projectionHash = sha256(canonicalJson(projection))`, and any change
 * to a folded row changes it (or fails verify first).
 *
 * ONE PASS (round 2, B1 / Aegis C2): the fold consumes the rows verifyLog's
 * own pass read (VerifyLogOptions.onRow), never a second read of the files,
 * so a row appended or rewritten between verify and fold is never folded;
 * the projection is discarded unless the whole report is ok.
 *
 * DECISION SIGNATURES (P8-D98, slice A2). Given the approvals key ids per
 * approver (`decisionKeys`), every `approval.decide` row's decisionSig is
 * verified against the key ring in the `gnomon:approve:v1` domain, over the
 * layout the decision takes:
 *   - `answer` (DECISION_SIG_V2_DECISIONS): the v2 message (signer
 *     decisionMessage) whose answerDigest is the row's noteHash (or the
 *     sha256 of a non-private note). A v1 message is accepted for an answer
 *     ONLY before the cutover (historical rows);
 *   - every other decision: the v1 message only (a v2 one is refused).
 * THE CUTOVER is a marker row, per log: the first row only a P8-D98 kernel
 * writes — an answer whose decisionSig verifies v2, or any kind reserved
 * `8.0:P8-D98` (approval.effect.failed, approval.rule.revoked). From that
 * row on, a v1 answer is a divergence `decision-sig-v1-after-cutover`. Why a
 * marker row and not the clientApiId or a date: the log records neither the
 * kernel's clientApiId nor its version, and a wall-clock cutover rests on the
 * writer's clock; a marker row is in the verified chain itself, so it is
 * monotonic and tamper-evident. Its limit (stated, not hidden): a v1 answer
 * written by an upgraded kernel BEFORE the log's first marker row is
 * indistinguishable from a historical one.
 * Fail closed: a row with no decisionSig, approver or contentHash, an
 * approver with no key, or an answer row with no digest that does not verify
 * v1 before the cutover is a divergence. Without `decisionKeys` the check
 * does not run and the report says so (`decisionSigs: 'unchecked'`).
 *
 * LOOP RUNS (#loop-runner, G-LOOP-17): the loop.run.started / loop.node / loop.run.ended rows are folded by
 * replayLoopRuns (kernel/loops/ledger.ts) into `projection.loops` (each run's edges: node, verdict, edge key, next),
 * present only when the log has loop runs, so earlier projection hashes are unchanged. A node row whose `next` is not
 * the node that ran after it, or an end naming a terminal the last edge did not reach, is `loop-edge-mismatch`.
 * #loop-events (step 7): `loop.trigger.fired` rows are folded too, so each event-started run carries `why` (the
 * trigger's kernel fields); a run citing a fireId no row of its loop names (joined over the history: the row follows the hand-off) is a
 * `loop-edge-mismatch` too.
 *
 * Read-only: databases are opened `readOnly` exactly as verifyLog opens them.
 */
import { canonicalJson, EVENT_KINDS, isPlainObject, parseApproveScope, scopeDigest, sha256Tagged } from '@a-company/gnomon-contracts';
import { verifyLog, type VerifiedRow, type VerifyLogOptions, type VerifyReport } from './kernel-log.js';
import { contentHashOf } from '../broker/card.js';
import { decisionRowV2, rowsDigestOf } from '../identity/decision-batch.js';
import { LOOP_REPLAY_KINDS, replayLoopRuns, type LoopReplayRun } from '../loops/ledger.js';
import { answerDigest, approveMessage, decisionMessage, usesDecisionV2, type KeyRing } from './signer.js';

export const REPLAY_PROJECTION = 'gnomon-replay:v1' as const;

export interface ReplayInput {
  seq: number;
  kind: 'session.inject' | 'turn.sent';
  hash: string;
  origin?: string;
  bytes?: number;
  turn?: string;
  permitId?: string;
}

export interface ReplayProjection {
  schema: typeof REPLAY_PROJECTION;
  log: string | null;
  head: { seq: number; hash: string } | null;
  kinds: Record<string, number>;
  sessions: Record<string, { inputs: ReplayInput[]; host: Array<{ seq: number; kind: string; hashes: Record<string, string> }> }>;
  cards: Record<string, { state: string; seq: number }>;
  /** #loop-runner (G-LOOP-17): every loop run's walk, each edge taken; present only when the log has loop runs */
  loops?: Record<string, LoopReplayRun>;
}

export interface ReplayDivergence {
  seq: number;
  reason: 'input-mismatch' | 'inject-plaintext' | 'malformed-envelope' | 'loop-edge-mismatch' | DecisionSigDivergence | RootDecisionDivergence;
  detail: string;
}

export interface ReplayReport {
  ok: boolean;
  verify: VerifyReport;
  /** Absent when verify failed (an unverified log is never folded). */
  projection?: ReplayProjection;
  projectionHash?: string;
  divergences: ReplayDivergence[];
  /** `verified` when decisionKeys was given (every approval.decide checked), else `unchecked`. */
  decisionSigs: 'verified' | 'unchecked';
  /** The seq of the decisionSig v2 cutover marker row, when one was seen (verified mode only). */
  decisionCutoverSeq?: number;
  /** Set when `expect` was given. */
  expected?: { hash: string; matches: boolean };
}

type Row = VerifiedRow;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** The fold, pure over the rows (exported so a test can feed it rows directly). */
export function foldReplay(rows: Iterable<Row>): { projection: ReplayProjection; divergences: ReplayDivergence[] } {
  const p: ReplayProjection = { schema: REPLAY_PROJECTION, log: null, head: null, kinds: {}, sessions: {}, cards: {} };
  const divergences: ReplayDivergence[] = [];
  /** The last unconsumed origin:client inject hash per session. */
  const pending = new Map<string, string>();
  const session = (hsid: string) => (p.sessions[hsid] ??= { inputs: [], host: [] });
  const loopRows: Array<{ kind: string; payload: unknown }> = [];
  const loopSeq = new Map<string, number>();
  for (const r of rows) {
    p.head = { seq: r.seq, hash: r.hash };
    p.kinds[r.kind] = (p.kinds[r.kind] ?? 0) + 1;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(r.envelope) as Record<string, unknown>;
    } catch {
      divergences.push({ seq: r.seq, reason: 'malformed-envelope', detail: 'envelope is not JSON' });
      continue;
    }
    p.log ??= str(e.log) ?? null;
    const pl = isPlainObject(e.payload) ? (e.payload as Record<string, unknown>) : {};
    const hsid = str(pl.hsid) ?? str(e.session);
    if (LOOP_REPLAY_KINDS.includes(r.kind)) {
      loopRows.push({ kind: r.kind, payload: pl });
      if (str(pl.runId)) loopSeq.set(str(pl.runId)!, r.seq);
    }
    if (r.kind === 'session.inject' && hsid) {
      const hash = str(pl.hash) ?? '';
      const input: ReplayInput = { seq: r.seq, kind: 'session.inject', hash, ...(str(pl.origin) ? { origin: str(pl.origin)! } : {}) };
      if (typeof pl.bytes === 'number') input.bytes = pl.bytes;
      else if (typeof pl.bytes === 'string') divergences.push({ seq: r.seq, reason: 'inject-plaintext', detail: 'session.inject carries plaintext bytes where the log records a byte count (the append path refuses it)' });
      session(hsid).inputs.push(input);
      if (pl.origin === 'client') pending.set(hsid, hash);
    } else if (r.kind === 'turn.sent' && hsid) {
      const hash = str(pl.contentHash) ?? '';
      session(hsid).inputs.push({ seq: r.seq, kind: 'turn.sent', hash, ...(str(pl.turn) ? { turn: str(pl.turn)! } : {}), ...(str(pl.permitId) ? { permitId: str(pl.permitId)! } : {}) });
      const want = pending.get(hsid);
      pending.delete(hsid); // consumed: one client inject binds at most one turn
      if (want !== hash) divergences.push({ seq: r.seq, reason: 'input-mismatch', detail: want === undefined ? `turn.sent ${hash} has no pending client inject for ${hsid}` : `turn.sent ${hash} is not the last client inject ${want} for ${hsid}` });
    } else if ((r.kind === 'session.spawned' || r.kind === 'session.layers.changed' || r.kind === 'session.compacted') && hsid) {
      const hashes: Record<string, string> = {};
      for (const k of Object.keys(pl).sort()) if ((k.endsWith('Hash') || k === 'sha256') && typeof pl[k] === 'string') hashes[k] = pl[k] as string;
      if (Object.keys(hashes).length) session(hsid).host.push({ seq: r.seq, kind: r.kind, hashes });
    } else if (r.kind === 'approval.request' || r.kind === 'approval.decide' || r.kind === 'approval.expire') {
      const card = isPlainObject(pl.card) ? (pl.card as Record<string, unknown>) : undefined;
      const cardId = str(pl.cardId) ?? str(card?.cardId);
      if (cardId) p.cards[cardId] = { state: r.kind === 'approval.request' ? 'open' : r.kind === 'approval.expire' ? 'expired' : (str(pl.decision) ?? 'decided'), seq: r.seq };
    }
  }
  if (loopRows.length) {
    const lr = replayLoopRuns(loopRows);
    if (Object.keys(lr.runs).length) p.loops = lr.runs;
    for (const d of lr.divergences) divergences.push({ seq: loopSeq.get(d.runId) ?? p.head?.seq ?? 0, reason: 'loop-edge-mismatch', detail: `${d.runId}: ${d.detail}` });
  }
  return { projection: p, divergences };
}

/** Divergences of the decisionSig check (P8-D98). */
export type DecisionSigDivergence = 'decision-sig-bad' | 'decision-sig-v1-after-cutover' | 'decision-sig-unverifiable';

/** The P8-D98 reservation tag: a kind carrying it is written only by a P8-D98 kernel (a cutover marker). */
const D98_TAG = '8.0:P8-D98';
const isD98Kind = (kind: string): boolean => Object.hasOwn(EVENT_KINDS, kind) && EVENT_KINDS[kind]!.reserved === D98_TAG;

export interface DecisionKeys {
  /** The approvals key ids (in the key ring) of an approver principal; none ⇒ the row cannot verify (fail closed). */
  keyIdsFor(principal: string): readonly string[];
}

/**
 * Verify every approval.decide decisionSig over its layout, with the per-log cutover (see the header).
 * Pure over the rows, in seq order; exported so a test can feed rows directly.
 */
export function checkDecisionSigs(rows: Iterable<Row>, keyRing: KeyRing, keys: DecisionKeys): { divergences: ReplayDivergence[]; cutoverSeq?: number } {
  const divergences: ReplayDivergence[] = [];
  let cutoverSeq: number | undefined;
  for (const r of rows) {
    if (cutoverSeq === undefined && isD98Kind(r.kind)) cutoverSeq = r.seq;
    if (r.kind !== 'approval.decide') continue;
    const div = (reason: DecisionSigDivergence, detail: string): void => void divergences.push({ seq: r.seq, reason, detail });
    let pl: Record<string, unknown>;
    try {
      const e = JSON.parse(r.envelope) as Record<string, unknown>;
      pl = isPlainObject(e.payload) ? (e.payload as Record<string, unknown>) : {};
    } catch {
      div('decision-sig-unverifiable', 'envelope is not JSON');
      continue;
    }
    const cardId = str(pl.cardId);
    const decision = str(pl.decision);
    const by = str(pl.by);
    const contentHash = str(pl.contentHash);
    const sigB64 = str(pl.decisionSig);
    if (!cardId || !decision || !by || !contentHash || !sigB64) {
      div('decision-sig-unverifiable', 'approval.decide lacks cardId, decision, by, contentHash or decisionSig');
      continue;
    }
    const keyIds = keys.keyIdsFor(by).filter((k) => keyRing.has(k));
    if (keyIds.length === 0) {
      div('decision-sig-unverifiable', `no approvals key for ${by}`);
      continue;
    }
    const sig = Buffer.from(sigB64, 'base64');
    const verifies = (message: string): boolean => keyIds.some((k) => keyRing.verify(k, 'approve', message, sig) === 'ok');
    const v1 = verifies(approveMessage({ cardId, decision, cardContentHash: contentHash, approverPrincipalId: by }));
    // TD-2026-10-20-294: a prefix-scoped always verifies ONLY over the v2 layout whose last line is its scope digest
    const sc = decision === 'always' && pl.scope !== undefined ? parseApproveScope(pl.scope) : null;
    if (decision === 'always' && pl.scope !== undefined) {
      let ok = false;
      if (sc && sc.kind === 'prefix') {
        try {
          ok = verifies(decisionMessage({ cardId, decision, cardContentHash: contentHash, approverPrincipalId: by, scopeDigest: scopeDigest(sc) }));
        } catch {
          ok = false;
        }
      }
      if (!ok) div('decision-sig-bad', 'a scoped always decisionSig does not verify over the v2 scope layout');
      continue;
    }
    if (!usesDecisionV2(decision)) {
      if (!v1) div('decision-sig-bad', `${decision} decisionSig does not verify over the v1 message`);
      continue;
    }
    const digest = str(pl.noteHash) ?? (typeof pl.note === 'string' ? answerDigest(pl.note) : undefined);
    let v2 = false;
    if (digest !== undefined) {
      try {
        v2 = verifies(decisionMessage({ cardId, decision, cardContentHash: contentHash, approverPrincipalId: by, answerDigest: digest }));
      } catch {
        v2 = false; // a malformed digest never verifies
      }
    }
    if (v2) {
      cutoverSeq ??= r.seq; // the first v2 answer is the cutover marker
    } else if (!v1) {
      div('decision-sig-bad', `${decision} decisionSig verifies over neither layout${digest === undefined ? ' (the row carries no answer digest)' : ''}`);
    } else if (cutoverSeq !== undefined) {
      div('decision-sig-v1-after-cutover', `a v1 ${decision} decisionSig after the decisionSig v2 cutover at seq ${cutoverSeq} (the answer text is unbound)`);
    }
  }
  return { divergences, ...(cutoverSeq !== undefined ? { cutoverSeq } : {}) };
}

/** Aegis C1f (TD-2026-10-20-514): divergences of the v2 root-decision check. */
export type RootDecisionDivergence = 'root-rows-missing' | 'root-rows-digest' | 'root-sig-bad';

/**
 * Aegis C1f: every approval.decide carrying a rowsDigest (a v2 root decision) is checked against the card the log
 * showed. Its approval.request card's root-rows node detail must hash to the card's contentHash, and
 * sha256(canonicalJson(detail.rootRows)) must be the logged rowsDigest. With `root` (the pinned root key), the
 * logged rootSig must verify over the gnomon-root-decision:v2 row rebuilt from the logged fields. Pure over the rows.
 */
export function checkRootDecisions(rows: Iterable<Row>, root?: { readonly rootKeyId: string | null; verifyRow(signer: string, row: unknown, sigB64: string): boolean }): ReplayDivergence[] {
  const out: ReplayDivergence[] = [];
  const cards = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    if (r.kind !== 'approval.request' && r.kind !== 'approval.decide') continue;
    let pl: Record<string, unknown>;
    try {
      const e = JSON.parse(r.envelope) as Record<string, unknown>;
      pl = isPlainObject(e.payload) ? (e.payload as Record<string, unknown>) : {};
    } catch {
      continue; // foldReplay reports a malformed envelope
    }
    if (r.kind === 'approval.request') {
      const c = pl.card;
      if (isPlainObject(c) && typeof (c as Record<string, unknown>).cardId === 'string') cards.set((c as Record<string, unknown>).cardId as string, c as Record<string, unknown>);
      continue;
    }
    if (typeof pl.rowsDigest !== 'string') continue; // not a v2 root decision
    const div = (reason: RootDecisionDivergence, detail: string): void => void out.push({ seq: r.seq, reason, detail });
    const cardId = str(pl.cardId);
    const card = cardId ? cards.get(cardId) : undefined;
    const kids = card && isPlainObject(card.block) && Array.isArray((card.block as Record<string, unknown>).children) ? ((card.block as Record<string, unknown>).children as unknown[]) : [];
    const nodes = kids.filter((k) => isPlainObject(k) && (k as Record<string, unknown>).type === 'root-rows') as Array<Record<string, unknown>>;
    const detail = nodes.length === 1 && isPlainObject(nodes[0]!.detail) ? (nodes[0]!.detail as Record<string, unknown>) : null;
    if (!card || !detail || !Array.isArray(detail.rootRows)) {
      div('root-rows-missing', `the v2 root decision of ${cardId ?? '?'} has no logged card showing its rootRows`);
      continue;
    }
    const flags = Array.isArray(card.flags) ? (card.flags as string[]) : [];
    const shownHash = contentHashOf({ kind: String(card.kind), requestedBy: String(card.requestedBy), ...(typeof card.hsid === 'string' ? { hsid: card.hsid } : {}), detail, flags });
    if (shownHash !== card.contentHash || shownHash !== pl.contentHash) {
      div('root-rows-digest', `the root-rows detail of ${cardId} does not hash to the card's contentHash`);
      continue;
    }
    const rootRows = detail.rootRows as unknown[];
    if (rowsDigestOf(rootRows) !== pl.rowsDigest) {
      div('root-rows-digest', `the logged rowsDigest of ${cardId} is not the digest of the rows its card showed`);
      continue;
    }
    if (root && root.rootKeyId !== null) {
      const sig = isPlainObject(pl.rootSig) ? (pl.rootSig as Record<string, unknown>) : null;
      const row = decisionRowV2({ cardId: cardId!, cardKind: String(pl.rootKind), decision: String(pl.decision), contentHash: String(pl.contentHash), approver: String(pl.by), rootRows });
      if (!sig || typeof sig.signer !== 'string' || typeof sig.sig !== 'string' || !root.verifyRow(sig.signer, row, sig.sig)) div('root-sig-bad', `the rootSig of ${cardId} does not verify over its v2 decision row`);
    }
  }
  return out;
}

export function replayProjectionHash(p: ReplayProjection): string {
  return sha256Tagged(canonicalJson(p));
}

/**
 * verifyLog with the fold (and, given decisionKeys, the decisionSig check) inside its single pass; `expect`
 * compares the projection hash. ok ⇔ verified ∧ no divergence ∧ (no expect ∨ it matches).
 */
export function replayLog(home: string, opts: Omit<VerifyLogOptions, 'onRow'> & { expect?: string; decisionKeys?: DecisionKeys; root?: Parameters<typeof checkRootDecisions>[1] }): ReplayReport {
  const { expect, decisionKeys, root, ...verifyOpts } = opts;
  const decisionSigs = decisionKeys ? 'verified' : 'unchecked';
  const seen: Row[] = [];
  const verify = verifyLog(home, { ...verifyOpts, onRow: (r) => void seen.push(r) });
  if (!verify.ok) return { ok: false, verify, divergences: [], decisionSigs, ...(expect ? { expected: { hash: expect, matches: false } } : {}) };
  const { projection, divergences } = foldReplay(seen);
  divergences.push(...checkRootDecisions(seen, root)); // Aegis C1f
  divergences.sort((a, b) => a.seq - b.seq);
  let cutover: number | undefined;
  if (decisionKeys) {
    const d = checkDecisionSigs(seen, opts.keyRing, decisionKeys);
    divergences.push(...d.divergences);
    cutover = d.cutoverSeq;
    divergences.sort((a, b) => a.seq - b.seq);
  }
  const projectionHash = replayProjectionHash(projection);
  const expected = expect ? { hash: expect, matches: expect === projectionHash } : undefined;
  return { ok: divergences.length === 0 && (expected?.matches ?? true), verify, projection, projectionHash, divergences, decisionSigs, ...(cutover !== undefined ? { decisionCutoverSeq: cutover } : {}), ...(expected ? { expected } : {}) };
}
