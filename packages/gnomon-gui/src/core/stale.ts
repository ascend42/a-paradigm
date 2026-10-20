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
 * kernel opens by itself (gnomon cli/relaunch.ts, printLaunch without a TTY)
 * on a NEW, OS-chosen port (Aegis H1: no remembered port, so nothing that
 * squats this tab's old port while Gnomon is down ever receives a launch).
 * This tab:
 *   - says so in plain words, never a terminal as the only way back, and
 *     never suggests a reload (a reload would load whatever now serves here);
 *   - polls its own origin (cheap GET /, no credential) and treats an answer
 *     as NOT proof of Gnomon (Aegis L3: a squatter can answer 200 here);
 *   - says "Gnomon restarted in a new window" ONLY on a same-origin
 *     BroadcastChannel `{t:'attached'}` (another tab of this origin that
 *     authenticated; it asks `{t:'who'}`), and then offers one click: close.
 * The channel carries those two fixed shapes only: no token, key, connId or
 * principal; anything else is ignored.
 */
export const STALE_CHANNEL = 'gnomon.gui.v1';
export type StaleMsg = { t: 'attached' } | { t: 'who' };
export type StaleState = 'down' | 'answering' | 'reopened';

/** Only the two fixed messages, with no other field. */
export function parseStaleMsg(d: unknown): StaleMsg | null {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const o = d as Record<string, unknown>;
  if (Object.keys(o).length !== 1) return null;
  return o.t === 'attached' ? { t: 'attached' } : o.t === 'who' ? { t: 'who' } : null;
}

/** The text and the one action of each stale state (none names a terminal as the only path, none suggests a reload). */
export function staleView(s: StaleState): { text: string; action: 'reconnect' | 'close' } {
  if (s === 'reopened') return { text: 'Gnomon restarted in a new window. Continue there; this tab is no longer connected.', action: 'close' };
  if (s === 'answering')
    return {
      text: 'Something is answering at this address, but this tab cannot tell whether it is Gnomon, so it sends it nothing. Use the window Gnomon opened when it started (or open Gnomon.app; `gnomon` in a terminal also works). Do not reload this tab.',
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

/** Poll the origin until stopped; reports 'down' / 'answering' on each change (an answer is not proof of Gnomon). Never throws. */
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
    const s: StaleState = up ? 'answering' : 'down';
    if (s !== last) d.onState((last = s));
    await between(i < 30 ? STALE_POLL_FAST_MS : STALE_POLL_SLOW_MS);
  }
}
