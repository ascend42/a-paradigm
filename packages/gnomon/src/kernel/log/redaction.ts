/**
 * @symbol #kernel-log
 * @symbol ~ample-internal-logs
 *
 * #kernel-log read projection — the §9.3 redaction matrix applied to rows by
 * audience/sensitivity (L6: labels set at append restrict reads; never
 * relaxed). Pure: no I/O.
 *
 * Columns of §9.3 are realised from the contracts kind registry, not from a
 * second hand-kept list: a kind whose REGISTERED default is `sensitive` or
 * `secret` (session.inject, turn.event, voice.turn.*, voice.enrol) is a
 * "sensitive column" kind; a registered `fieldLabels` entry
 * (approval.request.tool_input, oracle.result.evidence,
 * voice.turn.user.audioRef) is a sensitive FIELD. Anything an appender
 * tightened beyond the default falls in the "everything else" column.
 *
 * Reader classes implemented in PR-4: human (full), read token, community
 * client, session (own hsid), mod (own modns + granted kinds), peer (no read
 * path), voice (voice slice V1: rows of its attached session, voice.*
 * included, redacted like a read token). `agent` (own subtree) needs the
 * session tree (Move 2); asking for it throws UNSUPPORTED rather than
 * guessing a projection. `team`/`org` audiences are
 * 8.1 projections (Q6): in 8.0 every row is `private` and every reader here
 * is the local user's own surface or a narrower class.
 *
 * LABELS NEVER WIDEN (M1.4 slice 2, L6): the projection reads the EFFECTIVE
 * sensitivity = the strictest of (the kind's registered default, the
 * envelope's label, the chain table's `sensitivity` column when the caller
 * has it). A row whose envelope label was lowered (on disk or by a buggy
 * appender) is still projected at its registered/column label; field labels
 * come only from the contracts registry — nothing inside a payload (a
 * `sensitivity` or `fieldLabels` key) is ever consulted.
 *
 * NO CONFIRMATION ORACLE (round 2, Aegis): a LIMITED view (read-token,
 * community-client, mod) carries no `hash`, `sig`, `prev`, `idem` or
 * `refHash` on any row (round 3: both can digest caller content), a
 * redacted field is `{redacted: true}` with no digest, and a sensitive-column
 * stub is `{kind, hsid?, at}` — the §9.3 stub's envelope `hash` is dropped
 * too, because it is a digest over the hidden payload and a dictionary guess
 * of that payload (plus the visible envelope fields) would confirm against
 * it. Full views (human with first-party proof, own-hsid session) keep them.
 */
import { isKernelSpeakable } from '../voice/speakable.js';
import {
  EVENT_KINDS,
  type EventV1,
  type Sensitivity,
} from '@a-company/gnomon-contracts';
import { logRefusal } from './chain.js';
import { ownsModKind } from '../manifest/mod-kind.js';

export type ReaderClass =
  | { class: 'human' }
  | { class: 'read-token' }
  | { class: 'community-client' }
  | { class: 'session'; hsid: string }
  | { class: 'mod'; name: string; grantedKinds?: readonly string[] }
  | { class: 'peer' }
  | { class: 'agent' }
  | { class: 'voice'; hsid?: string | null };

/** `{kind, hsid, at, hash}` — what a redacting reader gets for a sensitive-column row (§9.3). */
export interface LogStub {
  kind: string;
  hsid?: string;
  at: string;
  /** Present only in a full-class reader's stub (never for limited views). */
  hash?: string;
}

/** A projected event: limited views omit hash, sig, prev, idem and refHash. */
export type ProjectedEvent = Omit<EventV1, 'hash' | 'sig' | 'prev' | 'idem' | 'refHash'> & Partial<Pick<EventV1, 'hash' | 'sig' | 'prev' | 'idem' | 'refHash'>>;

export type LogView = { seq: number; view: 'full'; event: ProjectedEvent } | { seq: number; view: 'stub'; stub: LogStub };

export interface RedactedField {
  redacted: true;
}

/** Projection counter (tests: per-commit fan-out must not project). */
export const projectionStats = { calls: 0 };

const RANK: Record<Sensitivity, number> = { normal: 0, sensitive: 1, secret: 2 };

function registeredSensitivity(kind: string): Sensitivity {
  return EVENT_KINDS[kind]?.sensitivity ?? 'normal';
}

function rankOf(s: unknown): number {
  // An unknown label (tampered/garbage) ranks as secret: fail closed.
  return typeof s === 'string' && Object.hasOwn(RANK, s) ? RANK[s as Sensitivity] : RANK.secret;
}

/** The strictest of the registered default, the envelope label and the stored column label (never widens). */
export function effectiveSensitivity(e: Pick<EventV1, 'kind' | 'sensitivity'>, storedLabel?: string): Sensitivity {
  let r = Math.max(RANK[registeredSensitivity(e.kind)], rankOf(e.sensitivity));
  if (storedLabel !== undefined) r = Math.max(r, rankOf(storedLabel));
  return r >= RANK.secret ? 'secret' : r >= RANK.sensitive ? 'sensitive' : 'normal';
}

function stubOf(e: EventV1): LogStub {
  return { kind: e.kind, ...(e.session ? { hsid: e.session } : {}), at: e.at };
}

/** Limited view of an event: registered sensitive fields → `{redacted: true}`; hash, sig, prev, idem, refHash dropped. */
function limitedView(e: EventV1): ProjectedEvent {
  const { hash: _h, sig: _s, prev: _p, idem: _i, refHash: _r, ...rest } = e;
  void [_h, _s, _p, _i, _r];
  const labels = EVENT_KINDS[e.kind]?.fieldLabels;
  if (!labels || !e.payload || typeof e.payload !== 'object') return rest;
  const payload = { ...(e.payload as Record<string, unknown>) };
  for (const field of Object.keys(labels)) {
    if (Object.hasOwn(payload, field) && payload[field] !== undefined) payload[field] = { redacted: true } satisfies RedactedField;
  }
  return { ...rest, payload };
}

/**
 * §9.3 cells a SESSION reader never sees in its own rows (T-2026-10-18-010):
 * `voice.turn.*.audioRef`. Such a row is projected as a limited view (the
 * field `{redacted: true}`, no hash/sig/prev/idem/refHash — no confirmation
 * oracle). Every other own-hsid row is full.
 */
export const SESSION_NEVER_FIELDS: ReadonlyArray<{ kind: (k: string) => boolean; field: string }> = Object.freeze([{ kind: (k: string) => k.startsWith('voice.turn.'), field: 'audioRef' }]);

function hasField(p: unknown, f: string): boolean {
  return !!p && typeof p === 'object' && Object.hasOwn(p, f) && (p as Record<string, unknown>)[f] !== undefined;
}

/**
 * Could `reader` see this row at all? Metadata only (kind, labels, session) —
 * no projection, no copy, no hash: the subscription fan-out on the commit path
 * uses it to decide whether to wake a pump. Over-approximates nothing that
 * projectForReader would show; it may say yes for rows a scope filter drops.
 */
export function mayBeVisible(e: Pick<EventV1, 'kind' | 'sensitivity' | 'session'>, reader: ReaderClass): boolean {
  const sens = effectiveSensitivity(e);
  const columnKind = RANK[registeredSensitivity(e.kind)] >= RANK.sensitive;
  switch (reader.class) {
    case 'human':
      return true;
    case 'read-token':
      return sens !== 'secret';
    case 'community-client':
      return sens !== 'secret' && (columnKind || sens !== 'sensitive');
    case 'session':
      return e.session === reader.hsid;
    case 'mod':
      return !columnKind && sens === 'normal' && (ownsModKind(reader.name, e.kind) || (reader.grantedKinds ?? []).includes(e.kind));
    case 'voice':
      // V2e: voice.* rows of the attached session only (never turn.*, never secret)
      return sens !== 'secret' && reader.hsid != null && e.session === reader.hsid && e.kind.startsWith('voice.');
    default:
      return false;
  }
}

/**
 * Project one row for one reader. `undefined` = the reader does not see the
 * row at all. A projected (field-redacted) event no longer hashes to its
 * `hash`; it is a view, the chain row is untouched.
 */
export function projectForReader(e: EventV1, reader: ReaderClass, storedLabel?: string): LogView | undefined {
  projectionStats.calls++;
  const seq = e.seq;
  const columnKind = RANK[registeredSensitivity(e.kind)] >= RANK.sensitive;
  const sens = effectiveSensitivity(e, storedLabel);
  switch (reader.class) {
    case 'human':
      return { seq, view: 'full', event: e };
    case 'read-token':
    case 'community-client': {
      if (sens === 'secret') return undefined;
      if (columnKind) return { seq, view: 'stub', stub: stubOf(e) };
      if (reader.class === 'community-client' && sens === 'sensitive') return undefined;
      return { seq, view: 'full', event: limitedView(e) };
    }
    case 'session': {
      if (e.session !== reader.hsid) return undefined;
      // §9.3 session row: voice.turn.*.audioRef is `never`, even in its own hsid (T-2026-10-18-010) — a limited view of that row
      const never = SESSION_NEVER_FIELDS.filter((f) => f.kind(e.kind) && hasField(e.payload, f.field));
      if (never.length) {
        const v = limitedView(e);
        const payload = { ...(v.payload as Record<string, unknown>) };
        for (const f of never) payload[f.field] = { redacted: true } satisfies RedactedField;
        return { seq, view: 'full', event: { ...v, payload } };
      }
      return { seq, view: 'full', event: e };
    }
    case 'mod': {
      if (columnKind || sens !== 'normal') return undefined;
      const own = ownsModKind(reader.name, e.kind);
      if (!own && !(reader.grantedKinds ?? []).includes(e.kind)) return undefined;
      return { seq, view: 'full', event: limitedView(e) };
    }
    case 'peer':
      return undefined;
    case 'voice': {
      // voice slice V1 (#gnomon-voice): own attached session + voice.*, REDACTED — the read-token row restricted to that
      // scope (secret hidden, a sensitive-column kind a stub, a sensitive-labelled row hidden, never-fields limited)
      // Aegis L3: only rows of the CURRENT attachment's session (its voice.* rows carry that hsid); never another session's
      // V2e (TD-2026-10-19-298): NARROWED to voice.* rows only — never turn.event / turn.result / approval rows (the
      // kernel's speakable row is what voice says); the kernel's own voice.turn.agent{source:'kernel-speakable'} is shown
      // in FULL (it carries only the projected summary: never a diff, tool input or tool output)
      if (reader.hsid == null || e.session !== reader.hsid || sens === 'secret' || !e.kind.startsWith('voice.')) return undefined;
      if (isKernelSpeakable(e)) return { seq, view: 'full', event: e };
      if (columnKind) return { seq, view: 'stub', stub: stubOf(e) };
      if (sens === 'sensitive') return undefined;
      return { seq, view: 'full', event: limitedView(e) };
    }
    case 'agent':
      throw logRefusal('UNSUPPORTED', 'reader-unsupported', `the ${reader.class} read projection needs the session tree / voice arms (M1.7, M4.x)`);
  }
}
