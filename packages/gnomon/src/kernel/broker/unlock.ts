/**
 * @symbol #approval-broker
 *
 * #approval-broker per-connection cached unlock (spec §3.1 approvals key,
 * §3.4, S25-H1, D38). An unlock is created ONLY by a fresh presence proved on
 * a connection, belongs to that `connId` alone, is dropped when the
 * connection closes or after `UNLOCK_IDLE_MS` (15 min) without a decision,
 * and is never usable from another connection. A CLI connection never holds
 * one (`gnomon approve` prompts every time, §3.1). Until the helper's
 * presence lands (M1.3) no production path creates one.
 *
 * The clock is the broker's own (the daemon passes a monotonic reading); no
 * caller supplies a time.
 */
export const UNLOCK_IDLE_MS = 15 * 60_000;

export type UnlockUse = 'ok' | 'none' | 'idle';

interface Unlock {
  connId: string;
  openedAt: number;
  lastUsedAt: number;
}

export class UnlockStore {
  readonly #by = new Map<string, Unlock>();
  readonly #clock: () => number;
  readonly #idleMs: number;

  constructor(clock: () => number, idleMs: number = UNLOCK_IDLE_MS) {
    this.#clock = clock;
    this.#idleMs = idleMs;
  }

  open(connId: string): void {
    const now = this.#clock();
    this.#by.set(connId, { connId, openedAt: now, lastUsedAt: now });
  }

  /** Use the unlock of THIS connection (refreshes its idle timer). `idle` = it expired and is now dropped. */
  use(connId: string): UnlockUse {
    const u = this.#by.get(connId);
    if (!u) return 'none';
    const now = this.#clock();
    if (now - u.lastUsedAt > this.#idleMs) {
      this.#by.delete(connId);
      return 'idle';
    }
    u.lastUsedAt = now;
    return 'ok';
  }

  has(connId: string): boolean {
    const u = this.#by.get(connId);
    return u !== undefined && this.#clock() - u.lastUsedAt <= this.#idleMs;
  }

  drop(connId: string): boolean {
    return this.#by.delete(connId);
  }

  /** Unlocks past their idle limit (dropped by the caller, which logs each). */
  idle(): string[] {
    const now = this.#clock();
    return [...this.#by.values()].filter((u) => now - u.lastUsedAt > this.#idleMs).map((u) => u.connId);
  }

  /** `status.guiSessions[].unlock` (§5): null = no unlock on that connection. */
  state(connId: string): { state: 'cached'; idleLeftMs: number } | null {
    const u = this.#by.get(connId);
    if (!u) return null;
    const left = this.#idleMs - (this.#clock() - u.lastUsedAt);
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
