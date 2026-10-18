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
 * Read-only: databases are opened `readOnly` exactly as verifyLog opens them.
 */
import { canonicalJson, isPlainObject, sha256Tagged } from '@a-company/gnomon-contracts';
import { verifyLog, type VerifiedRow, type VerifyLogOptions, type VerifyReport } from './kernel-log.js';

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
}

export interface ReplayDivergence {
  seq: number;
  reason: 'input-mismatch' | 'inject-plaintext' | 'malformed-envelope';
  detail: string;
}

export interface ReplayReport {
  ok: boolean;
  verify: VerifyReport;
  /** Absent when verify failed (an unverified log is never folded). */
  projection?: ReplayProjection;
  projectionHash?: string;
  divergences: ReplayDivergence[];
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
  return { projection: p, divergences };
}

export function replayProjectionHash(p: ReplayProjection): string {
  return sha256Tagged(canonicalJson(p));
}

/** verifyLog with the fold inside its single pass; `expect` compares the projection hash. ok ⇔ verified ∧ no divergence ∧ (no expect ∨ it matches). */
export function replayLog(home: string, opts: Omit<VerifyLogOptions, 'onRow'> & { expect?: string }): ReplayReport {
  const { expect, ...verifyOpts } = opts;
  const seen: Row[] = [];
  const verify = verifyLog(home, { ...verifyOpts, onRow: (r) => void seen.push(r) });
  if (!verify.ok) return { ok: false, verify, divergences: [], ...(expect ? { expected: { hash: expect, matches: false } } : {}) };
  const { projection, divergences } = foldReplay(seen);
  const projectionHash = replayProjectionHash(projection);
  const expected = expect ? { hash: expect, matches: expect === projectionHash } : undefined;
  return { ok: divergences.length === 0 && (expected?.matches ?? true), verify, projection, projectionHash, divergences, ...(expected ? { expected } : {}) };
}
