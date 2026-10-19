/**
 * @symbol #mod-host
 * @symbol #workshop-mod
 *
 * The `event{event:v1}` filtered feed (spec §12.3 "grant-bound kinds",
 * §11.6, G-WSP-01; M1.11 slice 3). A running mod whose manifest requires the
 * `log.read` capability (checked granted at load by #manifest-loader) gets a
 * PROJECTION of a fixed set of kernel kinds: only the kernel fields the
 * Workshop's caps derive from, never a text, a path, a tool input or a
 * digest. Anything not listed is not forwarded.
 *
 *   session.open      {hsid, backend: claude|local, project: 0..7}  (project = a hue
 *                     index the HOST derives from sha256(cwd); the path never leaves)
 *   session.exited    {hsid}
 *   turn.partial      {hsid}      (streaming: the bob)
 *   turn.result       {hsid}
 *   approval.request  {cardId, kind, hsid?}
 *   approval.decide   {cardId}
 *   approval.expire   {cardId}
 *   warpline.knot     {hsid?}     (violet)
 */
import { createHash } from 'node:crypto';

export const FEED_KINDS: readonly string[] = Object.freeze(['session.open', 'session.exited', 'turn.partial', 'turn.result', 'approval.request', 'approval.decide', 'approval.expire', 'warpline.knot']);
/** The capability that grants the feed. */
export const FEED_CAPABILITY = 'log.read';
export const FEED_HUES = 8;

const ID = /^[A-Za-z0-9:._-]{1,128}$/;
const KIND = /^[a-z][a-z0-9-]{0,31}$/;
const id = (v: unknown): string | undefined => (typeof v === 'string' && ID.test(v) ? v : undefined);

export interface FeedEvent {
  kind: string;
  seq: number | null;
  at: string | null;
  payload: Record<string, unknown>;
}

/** The projection of one kernel event, or null when it is not a feed kind. */
export function projectFeedEvent(e: { kind?: unknown; seq?: unknown; at?: unknown; payload?: unknown }): FeedEvent | null {
  if (typeof e?.kind !== 'string' || !FEED_KINDS.includes(e.kind)) return null;
  const p = (e.payload && typeof e.payload === 'object' ? e.payload : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const hsid = id(p.hsid);
  switch (e.kind) {
    case 'session.open': {
      if (!hsid) return null;
      out.hsid = hsid;
      out.backend = p.backend === 'local' ? 'local' : 'claude';
      out.project = typeof p.cwd === 'string' ? createHash('sha256').update(p.cwd, 'utf8').digest()[0]! % FEED_HUES : 0;
      break;
    }
    case 'session.exited':
    case 'turn.partial':
    case 'turn.result':
      if (!hsid) return null;
      out.hsid = hsid;
      break;
    case 'warpline.knot':
      if (hsid) out.hsid = hsid;
      break;
    case 'approval.request': {
      const card = (p.card && typeof p.card === 'object' ? p.card : {}) as Record<string, unknown>;
      const cardId = id(card.cardId);
      if (!cardId) return null;
      out.cardId = cardId;
      out.kind = typeof card.kind === 'string' && KIND.test(card.kind) ? card.kind : 'card';
      const h = id(card.hsid);
      if (h) out.hsid = h;
      break;
    }
    case 'approval.decide':
    case 'approval.expire': {
      const cardId = id(p.cardId);
      if (!cardId) return null;
      out.cardId = cardId;
      break;
    }
  }
  return { kind: e.kind, seq: typeof e.seq === 'number' ? e.seq : null, at: typeof e.at === 'string' ? e.at : null, payload: out };
}
