/**
 * @symbol #gui
 *
 * #gui live turn clock (T-2026-10-21-007, founder dogfood 2026-10-21). While a turn is running (a turn.sent with
 * no turn.result yet, core/store.ts chatItems), the chat shows a `working…` row under that turn's output and its
 * latest activity line counts live ("running 2m 6s · Bash 1m 36s") instead of a summary frozen at the last tool
 * row. PURE text from a `LiveClock` and the time now; the page's one `LiveTicker` (one interval while the
 * focused transcript has a running turn, cleared when it ends) rewrites only the mounted clock spans each second,
 * never the item list (motion-on-events stays: the list repaints only on rows).
 *
 * The clock counts from the turn's (or activity's) start; a tool_progress heartbeat's `elapsed_time_seconds`
 * (plus the time since that heartbeat) is a floor, and the running tool's own time is shown beside it. When the
 * turn.result lands the live fields go away and the summary freezes at the real duration ("Ns of work").
 */
import { durationText, type ChatItem, type LiveClock } from './store.js';

const secsSince = (at: string, now: number): number | null => {
  const t = Date.parse(at);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 1000)) : null;
};

/** The running tool's own seconds: the heartbeat's elapsed plus the time since it; null with no heartbeat. */
export function toolSecs(l: LiveClock, now: number): number | null {
  if (!l.progress) return null;
  const since = secsSince(l.progress.at, now);
  return since === null ? null : Math.floor(l.progress.secs) + since;
}

/** Seconds the turn (or activity) has run: from `since`, never less than the running tool's own time. */
export function liveSecs(l: LiveClock, now: number): number {
  return Math.max(secsSince(l.since, now) ?? 0, toolSecs(l, now) ?? 0);
}

/** The ticking text of a live item: the `working…` row, or the suffix of a live activity line. */
export function liveText(it: Pick<ChatItem, 'role' | 'live'>, now: number): string {
  if (!it.live) return '';
  const total = durationText(liveSecs(it.live, now));
  if (it.role === 'working') return `working… · ${total}`;
  const t = toolSecs(it.live, now);
  return ` · running ${total}${t !== null ? ` · ${it.live.progress?.tool ?? 'tool'} ${durationText(t)}` : ''}`;
}

/** Does this transcript have a running turn to tick? */
export const hasLive = (items: readonly Pick<ChatItem, 'live'>[]): boolean => items.some((i) => i.live !== undefined);

/** One interval while something runs (`sync(true)`), cleared the moment nothing does (`sync(false)`). */
export class LiveTicker {
  #id: ReturnType<typeof setInterval> | null = null;
  constructor(
    readonly tick: () => void,
    readonly ms = 1000,
  ) {}

  get running(): boolean {
    return this.#id !== null;
  }

  sync(live: boolean): void {
    if (live && this.#id === null) this.#id = setInterval(this.tick, this.ms);
    else if (!live) this.stop();
  }

  stop(): void {
    if (this.#id !== null) clearInterval(this.#id);
    this.#id = null;
  }
}
