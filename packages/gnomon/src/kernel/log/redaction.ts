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
 * path). `agent` (own subtree) and `voice` (attached session) need the
 * session tree and voice arms (M1.7, M4.x); asking for them throws
 * UNSUPPORTED rather than guessing a projection. `team`/`org` audiences are
 * 8.1 projections (Q6): in 8.0 every row is `private` and every reader here
 * is the local user's own surface or a narrower class.
 */
import {
  canonicalJson,
  EVENT_KINDS,
  type EventV1,
  type Sensitivity,
} from '@a-company/gnomon-contracts';
import { logRefusal, sha256TaggedFast } from './chain.js';

export type ReaderClass =
  | { class: 'human' }
  | { class: 'read-token' }
  | { class: 'community-client' }
  | { class: 'session'; hsid: string }
  | { class: 'mod'; name: string; grantedKinds?: readonly string[] }
  | { class: 'peer' }
  | { class: 'agent' }
  | { class: 'voice' };

/** `{kind, hsid, at, hash}` — what a redacting reader gets for a sensitive-column row (§9.3). */
export interface LogStub {
  kind: string;
  hsid?: string;
  at: string;
  hash: string;
}

export type LogView = { seq: number; view: 'full'; event: EventV1 } | { seq: number; view: 'stub'; stub: LogStub };

export interface RedactedField {
  redacted: Sensitivity;
  hash: string;
}

const RANK: Record<Sensitivity, number> = { normal: 0, sensitive: 1, secret: 2 };

function registeredSensitivity(kind: string): Sensitivity {
  return EVENT_KINDS[kind]?.sensitivity ?? 'normal';
}

function stubOf(e: EventV1): LogStub {
  return { kind: e.kind, ...(e.session ? { hsid: e.session } : {}), at: e.at, hash: e.hash };
}

/** Replace every registered sensitive field of the payload by `{redacted, hash}`. */
function redactFields(e: EventV1): EventV1 {
  const labels = EVENT_KINDS[e.kind]?.fieldLabels;
  if (!labels || !e.payload || typeof e.payload !== 'object') return e;
  const payload = { ...(e.payload as Record<string, unknown>) };
  let changed = false;
  for (const [field, s] of Object.entries(labels)) {
    if (field in payload && payload[field] !== undefined) {
      const r: RedactedField = { redacted: s, hash: sha256TaggedFast(canonicalJson(payload[field])) };
      payload[field] = r;
      changed = true;
    }
  }
  return changed ? { ...e, payload } : e;
}

/**
 * Project one row for one reader. `undefined` = the reader does not see the
 * row at all. A projected (field-redacted) event no longer hashes to its
 * `hash`; it is a view, the chain row is untouched.
 */
export function projectForReader(e: EventV1, reader: ReaderClass): LogView | undefined {
  const seq = e.seq;
  const columnKind = RANK[registeredSensitivity(e.kind)] >= RANK.sensitive;
  switch (reader.class) {
    case 'human':
      return { seq, view: 'full', event: e };
    case 'read-token':
    case 'community-client': {
      if (e.sensitivity === 'secret') return undefined;
      if (columnKind) return { seq, view: 'stub', stub: stubOf(e) };
      if (reader.class === 'community-client' && e.sensitivity === 'sensitive') return undefined;
      return { seq, view: 'full', event: redactFields(e) };
    }
    case 'session': {
      if (e.session !== reader.hsid) return undefined;
      return { seq, view: 'full', event: e };
    }
    case 'mod': {
      if (columnKind || e.sensitivity !== 'normal') return undefined;
      const own = e.kind.startsWith(`modns.${reader.name}.`);
      if (!own && !(reader.grantedKinds ?? []).includes(e.kind)) return undefined;
      return { seq, view: 'full', event: redactFields(e) };
    }
    case 'peer':
      return undefined;
    case 'agent':
    case 'voice':
      throw logRefusal('UNSUPPORTED', 'reader-unsupported', `the ${reader.class} read projection needs the session tree / voice arms (M1.7, M4.x)`);
  }
}
