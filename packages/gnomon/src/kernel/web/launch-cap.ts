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
 */
import { LifecycleRefusal } from '../lifecycle/refusal.js';

/** At most this many launch grants per window, across every asker. */
export const LAUNCH_GRANT_CAP = 8;
export const LAUNCH_GRANT_WINDOW_MS = 60_000;
/** The messages the wrapper channel has always shown (its tests read them). */
export const LAUNCH_BUSY_MESSAGE = 'a launch is already being minted';
export const LAUNCH_RATE_MESSAGE = `more than ${LAUNCH_GRANT_CAP} launch requests in a minute`;

export class LaunchGrantCap {
  readonly #recent: number[] = [];
  #minting = false;
  constructor(
    private readonly now: () => number = Date.now,
    private readonly cap: number = LAUNCH_GRANT_CAP,
    private readonly windowMs: number = LAUNCH_GRANT_WINDOW_MS,
  ) {}

  /** Run one mint under the cap, or throw `web-launch-capped` (busy | rate) before `mint` is called. */
  async run<T>(mint: () => Promise<T>): Promise<T> {
    const t = this.now();
    while (this.#recent.length && t - this.#recent[0]! > this.windowMs) this.#recent.shift();
    if (this.#minting) throw new LifecycleRefusal('web-launch-capped', LAUNCH_BUSY_MESSAGE, { cap: 'busy' });
    if (this.#recent.length >= this.cap) throw new LifecycleRefusal('web-launch-capped', LAUNCH_RATE_MESSAGE, { cap: 'rate', perMinute: this.cap });
    this.#recent.push(t);
    this.#minting = true;
    try {
      return await mint();
    } finally {
      this.#minting = false;
    }
  }

  /** Grants counted in the current window (status / tests). */
  count(): number {
    const t = this.now();
    return this.#recent.filter((x) => t - x <= this.windowMs).length;
  }
}
