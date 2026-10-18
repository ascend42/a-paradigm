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
 *     `turn.sent{turn, permitId, contentHash}` — the bytes the kernel let a
 *     model read are identified by their content hash, and a `turn.sent`
 *     whose contentHash is not the hash of the inject row before it for that
 *     session is a DIVERGENCE (the kernel would have sent bytes it never logged,
 *     L2); when an inject row carries the text itself (a string `bytes`), the
 *     fold recomputes sha256 over it and a mismatch is a divergence;
 *   - host: the `*Hash` / `sha256` fields of `session.spawned` and
 *     `session.layers.changed` rows, RECORDED, never reproduced;
 *   - cards: the last state of each card (`approval.request` → open,
 *     `approval.decide` → its decision, `approval.expire` → expired);
 * plus the log id, the head {seq, hash} and a per-kind row count. Nothing
 * from the wall clock, the environment or the filesystem beyond the chain's
 * own envelope bytes enters the fold, so two replays of one log produce the
 * same `projectionHash = sha256(canonicalJson(projection))`, and any change
 * to a folded row changes it (or fails verify first).
 *
 * Read-only: databases are opened `readOnly` exactly as verifyLog opens them.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, isPlainObject, sha256Tagged } from '@a-company/gnomon-contracts';
import { ACTIVE_DB, listSealedSegments, verifyLog, type VerifyLogOptions, type VerifyReport } from './kernel-log.js';

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
  reason: 'input-mismatch' | 'inject-bytes-mismatch' | 'malformed-envelope';
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

interface Row {
  seq: number;
  kind: string;
  envelope: string;
  hash: string;
}

/** Every chain row of `home`, sealed segments first, in seq order (the verify order). */
function* chainRows(home: string): Generator<Row> {
  const files = listSealedSegments(home).map((s) => s.file);
  const active = path.join(home, ACTIVE_DB);
  if (fs.existsSync(active)) files.push(active);
  for (const f of files) {
    const db = new DatabaseSync(f, { readOnly: true });
    try {
      for (const r of db.prepare('SELECT seq, kind, envelope, hash FROM chain ORDER BY seq').iterate() as Iterable<Row>) yield { ...r };
    } finally {
      db.close();
    }
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** The fold, pure over the rows (exported so a test can feed it rows directly). */
export function foldReplay(rows: Iterable<Row>): { projection: ReplayProjection; divergences: ReplayDivergence[] } {
  const p: ReplayProjection = { schema: REPLAY_PROJECTION, log: null, head: null, kinds: {}, sessions: {}, cards: {} };
  const divergences: ReplayDivergence[] = [];
  const lastInject = new Map<string, string>();
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
      else if (typeof pl.bytes === 'string') {
        input.bytes = Buffer.byteLength(pl.bytes, 'utf8');
        if (sha256Tagged(pl.bytes) !== hash) divergences.push({ seq: r.seq, reason: 'inject-bytes-mismatch', detail: `sha256 of the logged bytes is not ${hash}` });
      }
      session(hsid).inputs.push(input);
      lastInject.set(hsid, hash);
    } else if (r.kind === 'turn.sent' && hsid) {
      const hash = str(pl.contentHash) ?? '';
      session(hsid).inputs.push({ seq: r.seq, kind: 'turn.sent', hash, ...(str(pl.turn) ? { turn: str(pl.turn)! } : {}), ...(str(pl.permitId) ? { permitId: str(pl.permitId)! } : {}) });
      if (lastInject.get(hsid) !== hash) divergences.push({ seq: r.seq, reason: 'input-mismatch', detail: `turn.sent ${hash} is not the last logged inject for ${hsid}` });
    } else if ((r.kind === 'session.spawned' || r.kind === 'session.layers.changed') && hsid) {
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

/** verifyLog, then the fold; `expect` compares the projection hash. ok ⇔ verified ∧ no divergence ∧ (no expect ∨ it matches). */
export function replayLog(home: string, opts: VerifyLogOptions & { expect?: string }): ReplayReport {
  const { expect, ...verifyOpts } = opts;
  const verify = verifyLog(home, verifyOpts);
  if (!verify.ok) return { ok: false, verify, divergences: [], ...(expect ? { expected: { hash: expect, matches: false } } : {}) };
  const { projection, divergences } = foldReplay(chainRows(home));
  const projectionHash = replayProjectionHash(projection);
  const expected = expect ? { hash: expect, matches: expect === projectionHash } : undefined;
  return { ok: divergences.length === 0 && (expected?.matches ?? true), verify, projection, projectionHash, divergences, ...(expected ? { expected } : {}) };
}
