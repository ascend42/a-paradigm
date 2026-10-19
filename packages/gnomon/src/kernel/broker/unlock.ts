/**
 * @symbol #approval-broker
 *
 * #approval-broker per-connection cached unlock (spec §3.1 approvals key,
 * §3.4, S25-H1, D38). An unlock is created ONLY by a fresh presence proved on
 * a connection and belongs to that `connId` alone. It is dropped when the
 * connection closes, after `UNLOCK_IDLE_MS` (15 min) without a decision,
 * `UNLOCK_ABSOLUTE_MS` (60 min) after it opened, or once it has made
 * `UNLOCK_MAX_SIGNATURES` (64) signatures (T-2026-10-18-028 M2). It is never
 * usable from another connection. A CLI connection never holds one
 * (`gnomon approve` prompts every time, §3.1).
 *
 * The clock is the broker's own (the daemon passes a monotonic reading); no
 * caller supplies a time.
 */
export const UNLOCK_IDLE_MS = 15 * 60_000;
/**
 * T-2026-10-18-028 M2: the idle timer slides on every use, so an unlock in steady use never ended.
 * Two hard bounds, mirrored in the helper (Protocol.swift Bounds.unlockAbsoluteSeconds /
 * maxSignaturesPerUnlock) and enforced on EACH side independently: an absolute lifetime counted
 * from the presence that opened the unlock, and a cap on the signatures made under it. Either ends
 * the unlock; the next decision on that connection takes fresh presence again.
 */
export const UNLOCK_ABSOLUTE_MS = 60 * 60_000;
export const UNLOCK_MAX_SIGNATURES = 64;

/** `idle` = no use for the idle limit; `expired` = past the absolute TTL; `exhausted` = the signature cap is spent. Each is dropped. */
export type UnlockEnd = 'idle' | 'expired' | 'exhausted';
export type UnlockUse = 'ok' | 'none' | UnlockEnd;

export interface UnlockLimits {
  absoluteMs?: number;
  maxSignatures?: number;
}

interface Unlock {
  connId: string;
  openedAt: number;
  lastUsedAt: number;
  signatures: number;
}

export class UnlockStore {
  readonly #by = new Map<string, Unlock>();
  readonly #clock: () => number;
  readonly #idleMs: number;
  readonly #absoluteMs: number;
  readonly #maxSignatures: number;

  constructor(clock: () => number, idleMs: number = UNLOCK_IDLE_MS, limits: UnlockLimits = {}) {
    this.#clock = clock;
    this.#idleMs = idleMs;
    this.#absoluteMs = limits.absoluteMs ?? UNLOCK_ABSOLUTE_MS;
    this.#maxSignatures = limits.maxSignatures ?? UNLOCK_MAX_SIGNATURES;
  }

  /** Why `u` has ended (absolute first, then idle, then the cap), or null while it may still sign. */
  #end(u: Unlock, now: number): UnlockEnd | null {
    if (now - u.openedAt > this.#absoluteMs) return 'expired';
    if (now - u.lastUsedAt > this.#idleMs) return 'idle';
    if (u.signatures >= this.#maxSignatures) return 'exhausted';
    return null;
  }

  open(connId: string): void {
    const now = this.#clock();
    this.#by.set(connId, { connId, openedAt: now, lastUsedAt: now, signatures: 0 });
  }

  /**
   * Spend one signature of THIS connection's unlock. This refreshes the idle timer, never the
   * absolute one. An ended unlock is dropped and the reason it ended is returned.
   */
  use(connId: string): UnlockUse {
    const u = this.#by.get(connId);
    if (!u) return 'none';
    const now = this.#clock();
    const end = this.#end(u, now);
    if (end) {
      this.#by.delete(connId);
      return end;
    }
    u.lastUsedAt = now;
    u.signatures++;
    return 'ok';
  }

  has(connId: string): boolean {
    const u = this.#by.get(connId);
    return u !== undefined && this.#end(u, this.#clock()) === null;
  }

  drop(connId: string): boolean {
    return this.#by.delete(connId);
  }

  /** Unlocks that have ended (idle, absolute TTL or cap), with the reason. The caller drops and logs each. */
  ended(): Array<{ connId: string; reason: UnlockEnd }> {
    const now = this.#clock();
    const out: Array<{ connId: string; reason: UnlockEnd }> = [];
    for (const u of this.#by.values()) {
      const reason = this.#end(u, now);
      if (reason) out.push({ connId: u.connId, reason });
    }
    return out;
  }

  /** `status.guiSessions[].unlock` (§5): null = no unlock on that connection. `idleLeftMs` never exceeds the absolute time left. */
  state(connId: string): { state: 'cached'; idleLeftMs: number } | null {
    const u = this.#by.get(connId);
    if (!u) return null;
    const now = this.#clock();
    if (this.#end(u, now)) return null;
    const left = Math.min(this.#idleMs - (now - u.lastUsedAt), this.#absoluteMs - (now - u.openedAt));
    return left > 0 ? { state: 'cached', idleLeftMs: left } : null;
  }

  /** Every connection holding an unlock (a helper exit drops them all). */
  connIds(): string[] {
    return [...this.#by.keys()];
  }

  size(): number {
    return this.#by.size;
  }
}
