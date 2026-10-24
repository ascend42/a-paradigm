/**
 * @symbol #web-endpoint
 *
 * The ONE launch-grant rate cap (spec §2.4 rule 8, T-2026-10-19-001 A3). Every
 * launch token this kernel mints passes here, whoever asked: the in-process
 * `gnomon up` terminal (Enter), the Gnomon.app wrapper channel (`launch`) and
 * the socket verb `gui.open`. So the cap is SHARED, never added on top: at
 * most LAUNCH_GRANT_CAP grants per LAUNCH_GRANT_WINDOW_MS for the whole web
 * endpoint, and one mint in flight at a time. A refused attempt mints nothing.
 * The check and the count are synchronous (a refusal never waits on a mint).
 *
 * Fairness (Aegis M2): the askers are two classes.
 *   - `in-process` — the human at the terminal and the wrapper channel. They may
 *     use every free slot of the shared window.
 *   - `socket` — `gui.open` from any same-user device-key holder. It may hold at
 *     most LAUNCH_GRANT_SOCKET_SHARE of the window's slots, so a flood of
 *     `gui.open` drains only its own share and LAUNCH_GRANT_CAP −
 *     LAUNCH_GRANT_SOCKET_SHARE slots a minute stay reserved for the human.
 *   - busy: a socket mint in flight (a cold start can hold it for the whole
 *     WEB_READY_TIMEOUT) never refuses the in-process asker: ONE in-process asker
 *     waits for it to settle and then mints next, ahead of any socket caller
 *     (socket callers are refused `busy` while it waits). An in-process mint in
 *     flight still refuses everyone else (`busy`), as before.
 *   - a mint that throws minted no token (the endpoint's mint makes the token its
 *     LAST throwing step), so its slot is refunded.
 */
import { LifecycleRefusal } from '../lifecycle/refusal.js';

/** At most this many launch grants per window, across every asker. */
export const LAUNCH_GRANT_CAP = 8;
/** Of those, at most this many may be socket `gui.open` grants; the rest are reserved for the in-process asker. */
export const LAUNCH_GRANT_SOCKET_SHARE = 4;
export const LAUNCH_GRANT_WINDOW_MS = 60_000;
/** The messages the wrapper channel has always shown (its tests read them). */
export const LAUNCH_BUSY_MESSAGE = 'a launch is already being minted';
export const LAUNCH_RATE_MESSAGE = `more than ${LAUNCH_GRANT_CAP} launch requests in a minute`;
export const LAUNCH_SOCKET_RATE_MESSAGE = `more than ${LAUNCH_GRANT_SOCKET_SHARE} gui.open launch requests in a minute`;

/** Who asked: the in-process terminal / wrapper channel, or a socket `gui.open` caller. */
export type LaunchAsker = 'in-process' | 'socket';

interface Slot {
  t: number;
  asker: LaunchAsker;
}

export class LaunchGrantCap {
  readonly #recent: Slot[] = [];
  /** The asker class of the mint in flight, or null. */
  #minting: LaunchAsker | null = null;
  /** The settle of the mint in flight (an in-process asker waits on a socket one). */
  #inFlight: Promise<unknown> | null = null;
  /** An in-process asker is waiting for a socket mint to settle. */
  #humanWaiting = false;
  constructor(
    private readonly now: () => number = Date.now,
    private readonly cap: number = LAUNCH_GRANT_CAP,
    private readonly windowMs: number = LAUNCH_GRANT_WINDOW_MS,
    private readonly socketShare: number = LAUNCH_GRANT_SOCKET_SHARE,
  ) {}

  /** Run one mint under the cap, or throw `web-launch-capped` (busy | rate) before `mint` is called. */
  async run<T>(mint: () => Promise<T>, asker: LaunchAsker = 'in-process'): Promise<T> {
    if (asker === 'in-process' && this.#minting === 'socket' && !this.#humanWaiting) {
      // a socket mint (maybe a 10 s cold start) never starves the human: wait for it, then go first
      this.#humanWaiting = true;
      try {
        while (this.#minting !== null) await this.#inFlight?.catch(() => undefined);
      } finally {
        this.#humanWaiting = false;
      }
      return this.#start(mint, asker);
    }
    if (asker === 'socket' && this.#humanWaiting) throw new LifecycleRefusal('web-launch-capped', LAUNCH_BUSY_MESSAGE, { cap: 'busy' });
    return this.#start(mint, asker);
  }

  #start<T>(mint: () => Promise<T>, asker: LaunchAsker): Promise<T> {
    const t = this.now();
    this.#prune(t);
    if (this.#minting !== null) throw new LifecycleRefusal('web-launch-capped', LAUNCH_BUSY_MESSAGE, { cap: 'busy' });
    if (this.#recent.length >= this.cap) throw new LifecycleRefusal('web-launch-capped', LAUNCH_RATE_MESSAGE, { cap: 'rate', perMinute: this.cap });
    if (asker === 'socket' && this.#recent.filter((s) => s.asker === 'socket').length >= this.socketShare) {
      throw new LifecycleRefusal('web-launch-capped', LAUNCH_SOCKET_RATE_MESSAGE, { cap: 'rate', perMinute: this.socketShare, asker });
    }
    const slot: Slot = { t, asker };
    this.#recent.push(slot);
    this.#minting = asker;
    const p = (async () => {
      try {
        return await mint();
      } catch (e) {
        // no token exists when the mint throws: give the slot back
        const i = this.#recent.indexOf(slot);
        if (i >= 0) this.#recent.splice(i, 1);
        throw e;
      } finally {
        this.#minting = null;
        this.#inFlight = null;
      }
    })();
    this.#inFlight = p;
    return p;
  }

  #prune(t: number): void {
    while (this.#recent.length && t - this.#recent[0]!.t > this.windowMs) this.#recent.shift();
  }

  /** Grants counted in the current window (status / tests); `asker` narrows to one class. */
  count(asker?: LaunchAsker): number {
    const t = this.now();
    return this.#recent.filter((x) => t - x.t <= this.windowMs && (asker === undefined || x.asker === asker)).length;
  }
}
