/**
 * @symbol #approval-broker
 *
 * The launch-token theft card (spec §3.4, §11.2 D55; M1.6 slice 2). When the
 * web endpoint sees a launch token presented again inside its TTL, it revokes
 * the GUI session that consumed it and #socket logs
 * `socket.auth.theft{connId, revokedConnId}`. That row is the signal; the
 * broker then RAISES a fresh-presence `gate-class` card naming the revoked
 * connection, so the human sees the theft in the inbox and answers it with a
 * touch.
 *
 * Reading (lore, M1.6 slice 2): the card carries NO effect. The revocation
 * has already happened and stands whatever the human decides: `allow`
 * records "that was me" and `deny` records "that was not me". Neither
 * restores the revoked session (a new one is a new launch, behind presence),
 * so no decision on this card can widen access. The card waits (no timeout):
 * silence decides nothing (B6). One card per revoked connection: a second
 * theft row for the same revoked connId returns the card already raised —
 * the PROMISE is stored before the raise awaits, so two concurrent rows for
 * one connId raise one card (Aegis C2). At most MAX_OPEN_THEFT_CARDS theft
 * cards are open at once; past that a theft COALESCES into the newest open
 * one (its socket.auth.theft row stays on the chain), so a theft flood
 * cannot fill the inbox. #socket raises the card only after the
 * socket.auth.theft row was written.
 */
import { ID_PATTERNS, type CardV1 } from '@a-company/gnomon-contracts';
import { fail, type ApprovalBroker } from './broker.js';

export interface AuthTheft {
  /** the connection that presented the already-consumed launch token */
  connId: string;
  /** the GUI session that consumed it first, now revoked */
  revokedConnId: string;
  /** hello client.surface of the presenter (self-declared, display only) */
  surface?: string | null;
}

/** Open (pending) theft cards at most; past this a theft coalesces into the newest open one. */
export const MAX_OPEN_THEFT_CARDS = 8;

/** The theft cards one port raised: revoked connId → the card (a promise, set before the raise awaits). */
export type TheftCards = Map<string, Promise<CardV1>>;

export function raiseTheftCard(broker: ApprovalBroker, requestedBy: string, t: AuthTheft, raised: TheftCards): Promise<CardV1> {
  if (!ID_PATTERNS.conn.test(t.connId) || !ID_PATTERNS.conn.test(t.revokedConnId)) return Promise.reject(fail('BAD_REQUEST', 'bad-params', 'a theft card names two conn:<ULID> connections'));
  const prior = raised.get(t.revokedConnId);
  if (prior) return prior;
  // synchronous count (no await before deciding), so concurrent thefts cannot overshoot the ceiling:
  // a card still being raised or still pending is open
  const open = [...new Set(raised.values())].filter((q) => {
    const id = settledId.get(q);
    return id === undefined || broker.card(id)?.state === 'pending';
  });
  if (open.length >= MAX_OPEN_THEFT_CARDS) {
    const newest = open[open.length - 1]!; // coalesce into the newest open card
    raised.set(t.revokedConnId, newest);
    return newest;
  }
  const p = raiseOne(broker, requestedBy, t);
  raised.set(t.revokedConnId, p);
  p.then(
    (c) => void settledId.set(p, c.cardId),
    () => void raised.delete(t.revokedConnId), // a failed raise (log refused) can be retried by the next theft row
  );
  return p;
}

/** cardId of each settled raise (the open count reads it synchronously). */
const settledId = new WeakMap<Promise<CardV1>, string>();

function raiseOne(broker: ApprovalBroker, requestedBy: string, t: AuthTheft): Promise<CardV1> {
  const surface = typeof t.surface === 'string' ? t.surface.slice(0, 32) : null;
  return broker.raise({
    kind: 'gate-class',
    requestedBy,
    attended: true,
    detail: { event: 'socket.auth.theft', connId: t.connId, revokedConnId: t.revokedConnId, surface },
    lines: [
      'A GUI launch token was used twice inside its lifetime.',
      `Revoked GUI session: ${t.revokedConnId}`,
      `Presented again by: ${t.connId}${surface ? ` (says it is: ${surface})` : ''}`,
      'The revoked session stays revoked whatever you decide.',
      'allow: that was me. deny: that was not me.',
    ],
  });
}
