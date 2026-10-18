/**
 * @symbol #approval-broker
 * @symbol #budget-fuse
 *
 * The socket port of #approval-broker + #budget-fuse (spec §5 verbs 7 and 8):
 * what #socket's dispatcher calls for `approve` and `permit.reserve`, and what
 * it tells the broker when a connection closes (its cached unlock drops).
 */
import { RootUnavailableError } from '../identity/root-authority.js';
import { RefusedError } from '@a-company/gnomon-contracts';
import type { ApprovalBroker, DecideContext } from './broker.js';
import { raiseTheftCard, type AuthTheft, type TheftCards } from './theft-card.js';
import { parseReserveParams, type BudgetFuse, type UserOf } from '../budget/fuse.js';

export interface ApprovalPort {
  approve(ctx: DecideContext, params: unknown): Promise<unknown>;
  reserve(ctx: DecideContext, params: unknown): Promise<unknown>;
  connectionClosed(connId: string): void;
  /** socket.auth.theft was logged: raise the fresh-presence gate-class card naming the revoked connection (M1.6 slice 2). */
  authTheft(t: AuthTheft): Promise<void>;
  /** status.cards for a caller class */
  cards(principalClass: string): Record<string, unknown>;
  /** status.guiSessions[].unlock */
  unlockOf(connId: string): Record<string, unknown> | null;
  status(): Record<string, unknown>;
}

function asRefused(err: unknown): unknown {
  if (err instanceof RootUnavailableError) return new RefusedError(err.refusal, err.message);
  return err;
}

export function createApprovalPort(p: { broker: ApprovalBroker; fuse: BudgetFuse; kernelPrincipal: string; extraStatus?: () => Record<string, unknown>; userOf?: UserOf }): ApprovalPort {
  const theftCards: TheftCards = new Map();
  return {
    approve: (ctx, params) => p.broker.approve(ctx, params).catch((e: unknown) => Promise.reject(asRefused(e))),
    reserve: async (ctx, params) => {
      const parsed = parseReserveParams(ctx.principal, ctx.principalClass, params, p.userOf);
      if (parsed.op === 'release') {
        await p.fuse.release(parsed.permitId, ctx.principal);
        return { released: parsed.permitId };
      }
      return p.fuse.reserve(parsed.req);
    },
    connectionClosed: (connId) => void p.broker.connectionClosed(connId),
    authTheft: async (t) => void (await raiseTheftCard(p.broker, p.kernelPrincipal, t, theftCards)),
    cards: (cls) => p.broker.status(cls === 'human'),
    unlockOf: (connId) => p.broker.unlocks.state(connId),
    status: () => ({ budget: p.fuse.status(), ...(p.extraStatus?.() ?? {}) }),
  };
}
