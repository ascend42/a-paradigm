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
 * theft row for the same revoked connId returns the card already raised.
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

export async function raiseTheftCard(broker: ApprovalBroker, requestedBy: string, t: AuthTheft, raised: Map<string, string>): Promise<CardV1> {
  if (!ID_PATTERNS.conn.test(t.connId) || !ID_PATTERNS.conn.test(t.revokedConnId)) throw fail('BAD_REQUEST', 'bad-params', 'a theft card names two conn:<ULID> connections');
  const prior = raised.get(t.revokedConnId);
  const priorCard = prior ? broker.card(prior) : undefined;
  if (priorCard) return priorCard;
  const surface = typeof t.surface === 'string' ? t.surface.slice(0, 32) : null;
  const card = await broker.raise({
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
  raised.set(t.revokedConnId, card.cardId);
  return card;
}
