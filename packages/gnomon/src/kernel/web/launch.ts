/**
 * @symbol #web-endpoint
 *
 * #web-endpoint launch tokens and GUI sessions (spec §11.2 rules 2 and 2a,
 * D54/D55, S29-K7; `G-WEB-05`, `G-WEB-08`).
 *
 * LAUNCH TOKEN. Minted for an AUTHENTICATED human device connection on the
 * unix socket (`gnomon open`): 32 random bytes, single use, 60 s TTL, bound to
 * that connection's deviceId and principal. The kernel keeps only its sha256
 * digest. The token is handed back to the asking connection in-process — it
 * is never on any argv, environment or file, and the transport child never
 * receives it except inside the WebSocket `auth` frame it relays opaquely.
 *
 * EXCHANGE (`auth {launchToken}` on the WebSocket) classifies the token:
 *   unknown           ⇒ AUTH unknown-token
 *   unconsumed, live  ⇒ consumed; a GUI session token is issued (32 bytes)
 *   unconsumed, dead  ⇒ AUTH token-expired
 *   consumed, inside the TTL (now − mintedAt ≤ 60 s) ⇒ THEFT: AUTH, the GUI
 *       session that consumed it is revoked (gui.session.ended{reason:'theft'})
 *       and socket.auth.theft{connId, revokedConnId} is logged; the
 *       fresh-presence gate-class card is #approval-broker's (M1.6)
 *   consumed, after the TTL ⇒ REPLAY (history / session restore): AUTH and
 *       socket.auth.replay{connId, consumedBy} only — no revoke, no card.
 * Both theft and replay answer the same wire reason (`replayed-transcript`),
 * so the presenter learns nothing about which one fired.
 *
 * GUI SESSION. Lives exactly as long as its WebSocket (no reconnect grace,
 * D54), at most 12 h, and ends on revoke-all and daemon exit; acts as the
 * launching device's human principal. Its token is held by the kernel as a
 * digest only and is the `X-Gnomon-Token` credential of `/diag` and `/blob`.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const LAUNCH_TOKEN_TTL_MS = 60_000;
export const GUI_SESSION_MAX_MS = 12 * 60 * 60_000;
/** Consumed tokens are remembered (for the replay classification) this long, at most CONSUMED_MAX of them. */
export const CONSUMED_RETENTION_MS = GUI_SESSION_MAX_MS;
export const CONSUMED_MAX = 4096;
export const PENDING_LAUNCH_MAX = 64;

const digest = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');
const mintToken = (): string => randomBytes(32).toString('base64url');
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export interface LaunchBinding {
  deviceId: string;
  principal: string;
  /** The unix-socket connection that asked (`gnomon open`). */
  askedBy: string;
}

interface LaunchRecord extends LaunchBinding {
  mintedAt: number;
  consumedBy?: string;
  consumedAt?: number;
}

export type LaunchClass =
  | { kind: 'unknown' }
  | { kind: 'expired' }
  | { kind: 'fresh'; binding: LaunchBinding }
  | { kind: 'theft'; consumedBy: string }
  | { kind: 'replay'; consumedBy: string };

export type GuiVia = 'launch' | 'reconnect';

export interface GuiSession {
  connId: string;
  deviceId: string;
  principal: string;
  surface: string | null;
  via: GuiVia;
  issuedAt: number;
  expiresAt: number;
}

export class GuiAccess {
  readonly #launch = new Map<string, LaunchRecord>(); // digest → record (insertion = mint order)
  readonly #sessions = new Map<string, GuiSession & { tokenDigest: Buffer }>(); // connId → session
  constructor(readonly now: () => number = Date.now) {}

  /** Mint a launch token for an authenticated human device connection. */
  mint(binding: LaunchBinding): { launchToken: string; expiresAt: number } {
    this.#prune();
    const pending = [...this.#launch.values()].filter((r) => r.consumedBy === undefined);
    if (pending.length >= PENDING_LAUNCH_MAX) {
      // oldest pending first: they die at their TTL anyway
      for (const [k, r] of this.#launch) if (r.consumedBy === undefined) {
        this.#launch.delete(k);
        break;
      }
    }
    const launchToken = mintToken();
    const mintedAt = this.now();
    this.#launch.set(digest(launchToken), { ...binding, mintedAt });
    return { launchToken, expiresAt: mintedAt + LAUNCH_TOKEN_TTL_MS };
  }

  /**
   * Withdraw an UNCONSUMED launch token (Aegis L2: gui.open minted it but its caller's connection is gone, so
   * nobody holds it). A presented withdrawn token is `unknown`. False if it was consumed or never existed.
   */
  withdraw(launchToken: string): boolean {
    if (!TOKEN_SHAPE.test(launchToken)) return false;
    const k = digest(launchToken);
    const r = this.#launch.get(k);
    if (!r || r.consumedBy !== undefined) return false;
    return this.#launch.delete(k);
  }

  /** Classify a presented launch token and, if fresh, consume it for `connId`. */
  exchange(token: unknown, connId: string): LaunchClass {
    this.#prune();
    if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return { kind: 'unknown' };
    const r = this.#launch.get(digest(token));
    if (!r) return { kind: 'unknown' };
    const now = this.now();
    const inTtl = now - r.mintedAt <= LAUNCH_TOKEN_TTL_MS;
    if (r.consumedBy !== undefined) return inTtl ? { kind: 'theft', consumedBy: r.consumedBy } : { kind: 'replay', consumedBy: r.consumedBy };
    if (!inTtl) return { kind: 'expired' };
    r.consumedBy = connId;
    r.consumedAt = now;
    return { kind: 'fresh', binding: { deviceId: r.deviceId, principal: r.principal, askedBy: r.askedBy } };
  }

  /** Issue a GUI session token for a WebSocket connection. */
  issue(s: Omit<GuiSession, 'issuedAt' | 'expiresAt'>): { guiToken: string; session: GuiSession } {
    const guiToken = mintToken();
    const issuedAt = this.now();
    const session: GuiSession = { ...s, issuedAt, expiresAt: issuedAt + GUI_SESSION_MAX_MS };
    this.#sessions.set(s.connId, { ...session, tokenDigest: Buffer.from(digest(guiToken), 'hex') });
    return { guiToken, session };
  }

  /** The live session an `X-Gnomon-Token` belongs to (constant-time compare), or undefined. */
  sessionForToken(token: string | undefined): GuiSession | undefined {
    if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return undefined;
    const d = Buffer.from(digest(token), 'hex');
    const now = this.now();
    let found: GuiSession | undefined;
    for (const s of this.#sessions.values()) if (timingSafeEqual(s.tokenDigest, d) && now < s.expiresAt) found = strip(s);
    return found;
  }

  session(connId: string): GuiSession | undefined {
    const s = this.#sessions.get(connId);
    return s ? strip(s) : undefined;
  }

  /** End a session; true if one existed. */
  end(connId: string): boolean {
    return this.#sessions.delete(connId);
  }

  sessions(): GuiSession[] {
    return [...this.#sessions.values()].map(strip);
  }

  /** Sessions past their 12 h cap (the endpoint closes them). */
  expired(): string[] {
    const now = this.now();
    return [...this.#sessions.values()].filter((s) => now >= s.expiresAt).map((s) => s.connId);
  }

  /** Unconsumed launch tokens still inside their TTL. */
  pendingLaunches(): number {
    const now = this.now();
    return [...this.#launch.values()].filter((r) => r.consumedBy === undefined && now - r.mintedAt <= LAUNCH_TOKEN_TTL_MS).length;
  }

  #prune(): void {
    const now = this.now();
    for (const [k, r] of this.#launch) {
      const dead = r.consumedBy === undefined ? now - r.mintedAt > LAUNCH_TOKEN_TTL_MS * 2 : now - (r.consumedAt ?? r.mintedAt) > CONSUMED_RETENTION_MS;
      if (dead) this.#launch.delete(k);
    }
    while (this.#launch.size > CONSUMED_MAX) this.#launch.delete(this.#launch.keys().next().value!);
  }
}

function strip(s: GuiSession & { tokenDigest?: Buffer }): GuiSession {
  const { tokenDigest: _d, ...rest } = s;
  return rest;
}
