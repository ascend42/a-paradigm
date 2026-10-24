/**
 * @symbol #approval-broker
 *
 * #approval-broker cached unlock (spec §3.1 approvals key, §3.4, D38;
 * TD-2026-10-20-086 F4/F5, superseding S25-H1's per-connection binding and
 * T-2026-10-18-028 M2's 60 min / 64 signatures). An unlock is created ONLY by
 * a fresh presence proved on a GUI connection. It is KEYED BY THE GUI DEVICE
 * (the launch-token deviceId, broker.ts `unlockKeyOf`), so it survives a
 * reconnect of the same device; a GUI context with no deviceId falls back to
 * its connId (dropped when that connection closes). It ends at screen lock,
 * screensaver, display or system sleep and user switch (the helper's
 * SessionWatch push, broker.helperSessionEnded), on a helper exit, and at the
 * hard caps: `UNLOCK_ABSOLUTE_MS` (12 h) after it opened and
 * `UNLOCK_MAX_SIGNATURES` (512) signatures. `UNLOCK_IDLE_MS` equals the
 * absolute cap: there is no separate idle limit any more (the lock is the
 * idle signal).
 *
 * The helper enforces its own Bounds independently (Protocol.swift). Helper
 * 1.7.0 mirrors 12 h / 512 and says so on a kept sign (`bounds`); an older
 * helper (1.6.0: 15 min idle, 60 min, 64) says nothing, and the broker then
 * opens the unlock with `LEGACY_HELPER_BOUNDS`: always the LOWER of the two
 * sides, so the kernel never believes in an unlock the helper already ended.
 * A CLI connection never holds one (`gnomon approve` prompts every time).
 *
 * The clock is the broker's own (the daemon passes a monotonic reading); no
 * caller supplies a time.
 */
export const UNLOCK_ABSOLUTE_MS = 12 * 60 * 60_000;
export const UNLOCK_MAX_SIGNATURES = 512;
/** F4: no idle limit apart from the absolute cap (screen lock / sleep / user switch end the unlock). */
export const UNLOCK_IDLE_MS = UNLOCK_ABSOLUTE_MS;

export interface UnlockBounds {
  idleMs: number;
  absoluteMs: number;
  maxSignatures: number;
}
/** Helper 1.6.0's Bounds (unlockIdleSeconds 15 min, unlockAbsoluteSeconds 60 min, maxSignaturesPerUnlock 64): used until helper 1.7.0 reports its own. */
export const LEGACY_HELPER_BOUNDS: Readonly<UnlockBounds> = Object.freeze({ idleMs: 15 * 60_000, absoluteMs: 60 * 60_000, maxSignatures: 64 });

/** The stricter of two bound sets, field by field (the unlock lives only as long as BOTH sides allow). */
export function lowerBounds(a: UnlockBounds, b: Partial<UnlockBounds> | null | undefined): UnlockBounds {
  if (!b) return { ...a };
  const m = (x: number, y: unknown): number => (typeof y === 'number' && Number.isFinite(y) && y >= 0 ? Math.min(x, y) : x);
  return { idleMs: m(a.idleMs, b.idleMs), absoluteMs: m(a.absoluteMs, b.absoluteMs), maxSignatures: m(a.maxSignatures, b.maxSignatures) };
}

/**
 * The bounds a helper reported on a kept sign (helper 1.7.0: `bounds{idleSeconds, absoluteSeconds,
 * maxSignatures}`); anything else (an older helper, a malformed field) is LEGACY_HELPER_BOUNDS.
 */
export function helperBoundsOf(v: unknown): UnlockBounds {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return { ...LEGACY_HELPER_BOUNDS };
  const o = v as Record<string, unknown>;
  const ok = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
  if (!ok(o.idleSeconds) || !ok(o.absoluteSeconds) || !ok(o.maxSignatures)) return { ...LEGACY_HELPER_BOUNDS };
  return { idleMs: o.idleSeconds * 1000, absoluteMs: o.absoluteSeconds * 1000, maxSignatures: Math.floor(o.maxSignatures) };
}

/** `idle` = no use for the idle limit; `expired` = past the absolute TTL; `exhausted` = the signature cap is spent. Each is dropped. */
export type UnlockEnd = 'idle' | 'expired' | 'exhausted';
export type UnlockUse = 'ok' | 'none' | UnlockEnd;

export interface UnlockLimits {
  absoluteMs?: number;
  maxSignatures?: number;
}

interface Unlock {
  /** the unlock key: `udev:<digest>` for a GUI device (F5), else a connId */
  connId: string;
  openedAt: number;
  lastUsedAt: number;
  signatures: number;
  /** this unlock's bounds: the store's, lowered by the helper's when it opened (F4) */
  b: UnlockBounds;
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
    if (now - u.openedAt > u.b.absoluteMs) return 'expired';
    if (now - u.lastUsedAt > u.b.idleMs) return 'idle';
    if (u.signatures >= u.b.maxSignatures) return 'exhausted';
    return null;
  }

  /** Open (or re-open) the unlock under `connId` (an unlock key); `peer` = the helper's bounds, applied as the lower bound (F4). */
  open(connId: string, peer?: Partial<UnlockBounds> | null): void {
    const now = this.#clock();
    const b = lowerBounds({ idleMs: this.#idleMs, absoluteMs: this.#absoluteMs, maxSignatures: this.#maxSignatures }, peer);
    this.#by.set(connId, { connId, openedAt: now, lastUsedAt: now, signatures: 0, b });
  }

  /** The bounds the unlock under `connId` runs with (status and tests), or null. */
  boundsOf(connId: string): UnlockBounds | null {
    const u = this.#by.get(connId);
    return u ? { ...u.b } : null;
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
    const left = Math.min(u.b.idleMs - (now - u.lastUsedAt), u.b.absoluteMs - (now - u.openedAt));
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
