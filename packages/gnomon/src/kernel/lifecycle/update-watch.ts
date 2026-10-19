/**
 * @symbol #update-watch
 *
 * #update-watch (TD-2026-10-19-063, flow 2 "detect"): polls the on-disk build
 * stamp on a configured cadence (UPDATE_POLL_MS). When it names a build other
 * than the one this kernel LOADED, `onKernelUpdate(next)` runs ONCE per
 * distinct new stamp (the daemon raises its own daemon-stop{reason:'upgrade'}
 * card; a rejected or expired card is not re-raised for the same stamp).
 *
 * The identity helper is watched on the same tick (`helper.check`): a changed
 * helper binary is re-pinned through the EXISTING verify path (designated
 * requirement, the 1.6.0 floor, pid) and its `serve` child respawned when
 * nothing is in flight — no card. An unsigned or unverifiable helper fails
 * closed (provision.ts helperRepin). A tick never throws.
 */
import { readBuildStamp, sameBuild, type BuildStamp } from './build-stamp.js';

/** The configured poll cadence of the stamp and the helper binary. */
export const UPDATE_POLL_MS = 30_000;

export interface UpdateWatchOptions {
  stampPath: string;
  loaded: BuildStamp | null;
  pollMs?: number;
  onKernelUpdate: (next: BuildStamp) => void | Promise<void>;
  helper?: { check(): Promise<unknown> | unknown };
}

export class UpdateWatch {
  readonly #o: UpdateWatchOptions;
  readonly #announced = new Set<string>();
  #timer: NodeJS.Timeout | null = null;
  #ticking: Promise<void> | null = null;

  constructor(o: UpdateWatchOptions) {
    this.#o = o;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.tick(), this.#o.pollMs ?? UPDATE_POLL_MS);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** One poll (also the test seam). Concurrent calls share the running tick. */
  tick(): Promise<void> {
    this.#ticking ??= this.#run().finally(() => (this.#ticking = null));
    return this.#ticking;
  }

  async #run(): Promise<void> {
    try {
      await this.#o.helper?.check();
    } catch {
      /* the helper re-pin fails closed on its own; the stamp is still read */
    }
    const next = readBuildStamp(this.#o.stampPath);
    if (!next || this.#o.loaded === null || sameBuild(next, this.#o.loaded) || this.#announced.has(next.distHash)) return;
    this.#announced.add(next.distHash);
    try {
      await this.#o.onKernelUpdate(next);
    } catch {
      this.#announced.delete(next.distHash); // a raise that failed is tried again on the next tick
    }
  }
}
