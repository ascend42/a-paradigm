/**
 * @symbol #approval-broker
 * @symbol #budget-fuse
 *
 * The `billing api-token` card (spec §3.4 law 7, §10 law 7; G-SUB-02,
 * G-SUB-03): the ONLY lawful API-billing path for a kernel-spawned session.
 * Human-only to request (an agent, session, mod or voice principal is
 * refused, G-SUB-02), never a default, never a fallback target; decided
 * `use-api-token` with fresh presence AND the root key, per use (one session
 * hsid); the card never expires, it waits. On decision the token is fetched
 * from the keystore and injected into exactly ONE child's env (`takeEnvFor`,
 * single use); while active `status()` shows the persistent
 * `API CREDITS ACTIVE` indicator and `billing.api.active{hsid, until}` is
 * logged on activation and every turn; expiry logs `billing.api.ended`.
 *
 * The keystore is the M1.3 helper; until then KEYSTORE_UNAVAILABLE refuses
 * the injection, so production never activates one.
 */
import { refuse, RefusedError, type CardV1 } from '@a-company/gnomon-contracts';
import { fail, type ApprovalBroker, type BrokerLog } from './broker.js';

export interface ApiTokenKeystore {
  /** Fetch the API token for one approved card (the helper's keystore, M1.3). */
  fetch(cardId: string): Promise<string>;
}

export const KEYSTORE_UNAVAILABLE: ApiTokenKeystore = Object.freeze({
  fetch: async (): Promise<string> => {
    throw new RefusedError(refuse({ code: 'UNSUPPORTED', data: { reason: 'not-implemented', milestone: 'M1.3', what: 'keystore' } }), '#approval-broker: the keystore is the signed helper (M1.3)');
  },
});

/** The env key the token is injected as (the one child). */
export const API_TOKEN_ENV = 'ANTHROPIC_API_KEY';
export const API_TOKEN_MAX_MS = 12 * 60 * 60_000;

interface Active {
  cardId: string;
  hsid: string;
  until: number;
  token: string | null;
  injected: boolean;
}

export class ApiTokenBilling {
  readonly #active = new Map<string, Active>();
  readonly #broker: ApprovalBroker;
  readonly #log: BrokerLog;
  readonly #keystore: ApiTokenKeystore;
  readonly #clock: () => number;

  constructor(broker: ApprovalBroker, log: BrokerLog, keystore: ApiTokenKeystore = KEYSTORE_UNAVAILABLE, clock: () => number = Date.now) {
    this.#broker = broker;
    this.#log = log;
    this.#keystore = keystore;
    this.#clock = clock;
  }

  /** Raise the per-use card. Human only (G-SUB-02). */
  async request(r: { principal: string; principalClass: string; reason: string; hsid: string; ttlMs?: number }): Promise<CardV1> {
    if (r.principalClass !== 'human') {
      await this.#log('billing.api.refused', { where: 'request', principalClass: r.principalClass, principal: r.principal }).catch(() => undefined);
      throw fail('FORBIDDEN', 'matrix', `an api-token card is requested only by the human (law 7); a ${r.principalClass} principal never asks`);
    }
    if (typeof r.reason !== 'string' || r.reason.trim() === '') throw fail('BAD_REQUEST', 'bad-params', 'an api-token card carries the reason');
    const ttl = Math.min(Math.max(1, r.ttlMs ?? 60 * 60_000), API_TOKEN_MAX_MS);
    const card = await this.#broker.raise({
      kind: 'api-token',
      requestedBy: r.principal,
      hsid: r.hsid,
      attended: true,
      detail: { hsid: r.hsid, reason: r.reason, ttlMs: ttl, use: 'one session' },
      lines: [`Bill API credits (not the subscription) for ONE session ${r.hsid}`, `reason: ${r.reason}`, `valid ${Math.round(ttl / 60_000)} min after approval`],
      effect: async (decision) => {
        if (decision !== 'use-api-token') return;
        const token = await this.#keystore.fetch(card.cardId);
        const until = this.#clock() + ttl;
        this.#active.set(r.hsid, { cardId: card.cardId, hsid: r.hsid, until, token, injected: false });
        await this.#log('billing.api.active', { hsid: r.hsid, until: new Date(until).toISOString(), cardId: card.cardId }, { session: r.hsid });
      },
    });
    await this.#log('billing.api.card.requested', { cardId: card.cardId, hsid: r.hsid }, { session: r.hsid });
    return card;
  }

  /** The billing an hsid may use: `api-token:<cardId>` while active, else null (subscription). */
  billingFor(hsid: string | undefined): string | null {
    if (!hsid) return null;
    const a = this.#active.get(hsid);
    return a && a.until > this.#clock() ? `api-token:${a.cardId}` : null;
  }

  /** Inject the token into exactly one child's env (single use); null if none active or already injected. */
  takeEnvFor(hsid: string, env: Readonly<Record<string, string>>): Record<string, string> | null {
    const a = this.#active.get(hsid);
    if (!a || a.injected || a.token === null || a.until <= this.#clock()) return null;
    a.injected = true;
    const out = { ...env, [API_TOKEN_ENV]: a.token };
    a.token = null; // the kernel keeps no copy once injected
    return out;
  }

  /** Every turn of an api-token session logs billing.api.active (G-SUB-03). */
  async onTurn(hsid: string): Promise<void> {
    const a = this.#active.get(hsid);
    if (a && a.until > this.#clock()) await this.#log('billing.api.active', { hsid, until: new Date(a.until).toISOString(), cardId: a.cardId }, { session: hsid });
  }

  async sweep(): Promise<void> {
    for (const a of [...this.#active.values()]) {
      if (a.until > this.#clock()) continue;
      this.#active.delete(a.hsid);
      await this.#log('billing.api.ended', { hsid: a.hsid, cardId: a.cardId, reason: 'expired' }, { session: a.hsid });
    }
  }

  /** status.billing: the persistent indicator while any api-token is active. */
  status(): { mode: 'subscription' | 'api-token'; indicator: string | null; active: Array<{ hsid: string; cardId: string; until: string }> } {
    const live = [...this.#active.values()].filter((a) => a.until > this.#clock());
    return {
      mode: live.length ? 'api-token' : 'subscription',
      indicator: live.length ? 'API CREDITS ACTIVE' : null,
      active: live.map((a) => ({ hsid: a.hsid, cardId: a.cardId, until: new Date(a.until).toISOString() })),
    };
  }
}
