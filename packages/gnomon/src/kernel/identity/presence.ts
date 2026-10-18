/**
 * @symbol #identity
 *
 * #identity presence (spec §3.1, §3.2 recovery; §19.1 release gate (c),
 * P8-D84; task T-2026-10-17-009(c), Aegis S34-10) — the PresenceToken, the
 * proof that a human was present for one kernel action.
 *
 * UNFORGEABLE, BY TYPE AND AT RUNTIME. The only way to obtain a PresenceToken
 * is from this module:
 *   - by type: the class has a private constructor, a `#state` private field
 *     (TypeScript treats such a class nominally) and a `unique symbol` brand,
 *     so no string, object literal or structurally similar class type-checks
 *     as one;
 *   - at runtime: the constructor demands a module-private mint key (a
 *     subclass or a `Reflect.construct` without it throws), and
 *     `PresenceToken.is` is a `#state in v` brand check, which no copy,
 *     `Object.create(PresenceToken.prototype)` or Proxy passes.
 * A token is bound to one purpose, single-use, and fresh for
 * PRESENCE_TOKEN_TTL_MS; `consumePresence` checks all three and burns it.
 *
 * PRESENCE HAS NOT LANDED. Real presence is the signed helper's prompt
 * (Touch ID / Windows Hello; probes P04/P02, M1.3). Until then
 * `requestPresence` refuses UNSUPPORTED{presence-unavailable, milestone
 * M1.3}, so no production path can obtain a token. The only mint is the
 * internal test seam (internal-seams.ts, read only by src/kernel/testing.ts),
 * whose tokens say `method: 'test-seam'`.
 */
import { performance } from 'node:perf_hooks';
import { canonicalJson, hex, refuse, RefusedError, sha256 } from '@a-company/gnomon-contracts';
import { registerSeams } from '../internal-seams.js';

/**
 * The actions a presence token can authorize (one purpose per token).
 * `approval.decide` (M1.6, #approval-broker) = one broker decision, bound to
 * the card it decides (see PresenceBinding).
 */
export const PRESENCE_PURPOSES = ['log.gap.acknowledge', 'mod.install', 'mod.rollback', 'approval.decide'] as const;
export type PresencePurpose = (typeof PRESENCE_PURPOSES)[number];

/** How presence was proved. M1.3 adds the helper's methods; `test-seam` is the internal test mint. */
export type PresenceMethod = 'test-seam';

/** A token older than this is stale (presence must be fresh for the action it authorizes). */
export const PRESENCE_TOKEN_TTL_MS = 60_000;

/** Why a value is not usable presence for an action. */
export type PresenceVerdict = 'ok' | 'not-a-token' | 'wrong-purpose' | 'stale' | 'used';

/**
 * What a token is BOUND to (T-2026-10-18-003 (2), T-2026-10-18-008, M1.6):
 * the decision it authorizes. A broker decision binds `{cardId, contentHash}`
 * (and the decision); a rollback binds `{name, toPackageHash}`. The binding is
 * a digest fixed at mint, shown in the helper's prompt (M1.3), and compared
 * by `consumeBoundPresence` — a token proved for one card never decides
 * another, nor the same card after its content changed.
 */
export type PresenceBinding = Readonly<Record<string, string>>;

/** sha256 over the canonical binding: the digest a token carries. */
export function presenceBindingDigest(b: PresenceBinding): string {
  return `sha256:${hex(sha256(canonicalJson(b)))}`;
}

/**
 * The kernel-trusted clock for bound presence (T-2026-10-18-003 (1)): a
 * monotonic reading this module takes itself, never a time a caller passes
 * (a caller clock would defeat the TTL).
 */
function trustedNow(): number {
  return performance.now();
}

declare const PRESENCE_TOKEN_BRAND: unique symbol;

/** Module-private: the constructor refuses any caller that does not hold it. */
const MINT_KEY: unique symbol = Symbol('gnomon.presence.mint');

export class PresenceToken {
  /** Type-only brand: nothing outside this module can name the symbol. */
  declare readonly [PRESENCE_TOKEN_BRAND]: true;
  readonly #state: { used: boolean };
  /** Monotonic mint time on the kernel-trusted clock (bound presence only reads this). */
  readonly #mono: number;
  readonly #binding: string | null;
  readonly purpose: PresencePurpose;
  readonly method: PresenceMethod;
  /** Epoch ms at which presence was proved. */
  readonly mintedAt: number;

  private constructor(key: typeof MINT_KEY, purpose: PresencePurpose, method: PresenceMethod, mintedAt: number, mono: number = trustedNow(), binding: string | null = null) {
    if (key !== MINT_KEY) throw new TypeError('#identity: a PresenceToken is minted only by the presence module');
    if (!(PRESENCE_PURPOSES as readonly string[]).includes(purpose)) throw new TypeError(`#identity: unknown presence purpose ${String(purpose)}`);
    if (!Number.isFinite(mintedAt)) throw new TypeError('#identity: presence mintedAt must be a finite epoch ms');
    this.#state = { used: false };
    this.#mono = mono;
    this.#binding = binding;
    this.purpose = purpose;
    this.method = method;
    this.mintedAt = mintedAt;
    Object.freeze(this);
  }

  /** Runtime brand check: true only for a token this module minted. */
  static is(v: unknown): v is PresenceToken {
    return typeof v === 'object' && v !== null && #state in v;
  }

  /** Check `v` for `purpose` at `now` and, if usable, burn it (single use). */
  static consume(v: unknown, purpose: PresencePurpose, now: number): PresenceVerdict {
    if (!PresenceToken.is(v)) return 'not-a-token';
    if (v.#state.used) return 'used';
    if (v.purpose !== purpose) return 'wrong-purpose';
    if (!(now >= v.mintedAt && now - v.mintedAt <= PRESENCE_TOKEN_TTL_MS)) return 'stale';
    v.#state.used = true;
    return 'ok';
  }

  /** The binding digest this token carries (null = unbound: never accepted by consumeBoundPresence). */
  static bindingOf(v: unknown): string | null {
    return PresenceToken.is(v) ? v.#binding : null;
  }

  /**
   * Check a BOUND token for `purpose` and `binding` on the kernel-trusted
   * clock and, if usable, burn it. The caller supplies no time.
   */
  static consumeBound(v: unknown, purpose: PresencePurpose, binding: PresenceBinding): PresenceVerdict | 'unbound' | 'wrong-binding' {
    if (!PresenceToken.is(v)) return 'not-a-token';
    if (v.#state.used) return 'used';
    if (v.purpose !== purpose) return 'wrong-purpose';
    if (v.#binding === null) return 'unbound';
    if (v.#binding !== presenceBindingDigest(binding)) return 'wrong-binding';
    const now = trustedNow();
    if (!(now >= v.#mono && now - v.#mono <= PRESENCE_TOKEN_TTL_MS)) return 'stale';
    v.#state.used = true;
    return 'ok';
  }

  static {
    registerSeams('presence', {
      mint: (purpose, opts = {}) =>
        new PresenceToken(
          MINT_KEY,
          purpose,
          opts.method ?? 'test-seam',
          opts.mintedAt ?? Date.now(),
          trustedNow() - (opts.ageMs ?? 0),
          opts.bind ? presenceBindingDigest(opts.bind) : null,
        ),
    });
  }
}

/** Bound presence (M1.6 broker decisions, mod.install / mod.rollback): trusted clock, binding compared, single use. */
export type BoundPresenceVerdict = PresenceVerdict | 'unbound' | 'wrong-binding';
export function consumeBoundPresence(token: unknown, purpose: PresencePurpose, binding: PresenceBinding): BoundPresenceVerdict {
  return PresenceToken.consumeBound(token, purpose, binding);
}

/** Check presence for `purpose` and burn the token when it is usable. Never throws. */
export function consumePresence(token: unknown, purpose: PresencePurpose, now: number = Date.now()): PresenceVerdict {
  return PresenceToken.consume(token, purpose, now);
}

/**
 * Ask the human for presence. Not available until the signed helper's
 * presence prompt (M1.3): refuses UNSUPPORTED{presence-unavailable}.
 */
export async function requestPresence(purpose: PresencePurpose): Promise<PresenceToken> {
  throw new RefusedError(
    refuse({ code: 'UNSUPPORTED', data: { reason: 'presence-unavailable', milestone: 'M1.3', purpose } }),
    `#identity: presence for ${purpose} needs the signed helper's presence prompt (M1.3); there is no software fallback`,
  );
}
