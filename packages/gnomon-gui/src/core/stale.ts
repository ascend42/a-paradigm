/**
 * @symbol #gui-relaunch
 *
 * #gui-relaunch (T-2026-10-20-001), page side. PURE except the injected
 * fetch / timer / channel.
 *
 * A tab whose connection ended outside the self-update path (stop, then
 * start) cannot rejoin the restarted kernel IN PLACE: every kernel start has
 * a new ephemeral key, and a page learns a new key only from a launch
 * fragment (core/launch.ts decidePin) or from the verified predecessor
 * (#gui-resume). So the reopen is a FRESH launch window, which the restarted
 * kernel opens by itself (gnomon cli/relaunch.ts, printLaunch without a TTY),
 * at the same origin (kernel/web/last-port.ts). This tab:
 *   - says so in plain words, never a terminal as the only way back;
 *   - polls its own origin (cheap GET /, no credential) to tell "down" from "back";
 *   - listens on a same-origin BroadcastChannel for a window that ATTACHED
 *     (it posts `{t:'attached'}`; a stale tab asks `{t:'who'}`) and then
 *     offers one click: close this tab and continue there.
 * The channel carries those two fixed shapes only: no token, key, connId or
 * principal; anything else is ignored.
 */
export const STALE_CHANNEL = 'gnomon.gui.v1';
export type StaleMsg = { t: 'attached' } | { t: 'who' };
export type StaleState = 'down' | 'back' | 'reopened';

/** Only the two fixed messages, with no other field. */
export function parseStaleMsg(d: unknown): StaleMsg | null {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const o = d as Record<string, unknown>;
  if (Object.keys(o).length !== 1) return null;
  return o.t === 'attached' ? { t: 'attached' } : o.t === 'who' ? { t: 'who' } : null;
}

/** The text and the one action of each stale state (no state names a terminal as the only path). */
export function staleView(s: StaleState): { text: string; action: 'reconnect' | 'close' } {
  if (s === 'reopened') return { text: 'Gnomon reopened in a new window. Continue there; this tab is no longer connected.', action: 'close' };
  if (s === 'back')
    return {
      text: 'Gnomon is running again, but this tab cannot rejoin it: a restarted Gnomon has a new key, which only a fresh window receives. Open Gnomon.app (or run `gnomon` in a terminal) to get one.',
      action: 'reconnect',
    };
  return { text: 'Gnomon stopped. When it starts again (Gnomon.app, `gnomon daemon start`, or `gnomon` in a terminal) it opens a new window by itself.', action: 'reconnect' };
}

/** The poll cadence: fast for the first minute, then slow; gives up after STALE_POLL_MAX tries. */
export const STALE_POLL_FAST_MS = 2_000;
export const STALE_POLL_SLOW_MS = 10_000;
export const STALE_POLL_MAX = 30 + 360; // ~1 min fast, then ~1 h slow

export interface StaleWatchDeps {
  fetchFn: (u: string) => Promise<{ ok: boolean }>;
  origin: string;
  onState: (s: StaleState) => void;
  between?: (ms: number) => Promise<void>;
  /** set true by the caller once a window attached (or the page reattached): the loop stops */
  stopped: () => boolean;
}

/** Poll the origin until stopped; reports 'down' / 'back' on each change. Never throws. */
export async function watchStale(d: StaleWatchDeps): Promise<void> {
  const between = d.between ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: StaleState | null = null;
  for (let i = 0; i < STALE_POLL_MAX && !d.stopped(); i++) {
    let up = false;
    try {
      up = (await d.fetchFn(`${d.origin}/`)).ok;
    } catch {
      up = false;
    }
    if (d.stopped()) return;
    const s: StaleState = up ? 'back' : 'down';
    if (s !== last) d.onState((last = s));
    await between(i < 30 ? STALE_POLL_FAST_MS : STALE_POLL_SLOW_MS);
  }
}
