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
import { HOOK_DWELL_MS } from './turn-steps.js';

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

/**
 * #gui-turn-steps (Mika, flicker): what the working key names at `now`. A running hook takes it only once it has
 * run HOOK_DWELL_MS; before that the key keeps naming what it named before the hook (`under`). null: plain working….
 */
export function workNow(l: LiveClock, now: number): { label: string; since: string; aria: string } | null {
  const n = l.now;
  if (!n) return null;
  const t = Date.parse(n.since);
  if (n.under && Number.isFinite(t) && now - t < HOOK_DWELL_MS) return n.under;
  return { label: n.label, since: n.since, aria: n.aria };
}

/** The working key in two parts: its words (they ellipsize) and its clock (` · 12s`, never cut). */
export function workParts(l: LiveClock, now: number): { label: string; clock: string; aria: string } {
  const w = workNow(l, now);
  if (!w) return { label: 'working…', clock: ` · ${durationText(liveSecs(l, now))}`, aria: 'working' };
  return { label: w.label, clock: ` · ${durationText(secsSince(w.since, now) ?? 0)}`, aria: w.aria };
}

/** The ticking text of a live item: the `working…` row, or the suffix of a live activity line. */
export function liveText(it: Pick<ChatItem, 'role' | 'live'>, now: number): string {
  if (!it.live) return '';
  const total = durationText(liveSecs(it.live, now));
  // #gui-turn-steps: the working key names what the turn does now, its clock from when that began
  if (it.role === 'working') {
    const w = workParts(it.live, now);
    return `${w.label}${w.clock}`;
  }
  const t = toolSecs(it.live, now);
  return ` · running ${total}${t !== null ? ` · ${it.live.progress?.tool ?? 'tool'} ${durationText(t)}` : ''}`;
}

/**
 * The rendered signature of a transcript item: everything itemEl paints from it (role, text, liveness, "took", the
 * said-aloud line and the voice marks). A card's decided state is its text ("needs you" / "decided · …").
 */
export function itemSig(it: Pick<ChatItem, 'role' | 'text' | 'live' | 'said' | 'voice' | 'speaker'> & Partial<Pick<ChatItem, 'tone' | 'steps' | 'open'>> & { took?: number }): string {
  // #gui-turn-steps: the working key repaints when what it names, its fold or a step changes (never per tick)
  const steps = it.steps?.map((s) => [s.key, s.label, s.until ?? null, s.outcome ?? null, s.note ?? null, s.hook?.name ?? null, s.detail !== undefined]) ?? null;
  return JSON.stringify([it.role, it.text, it.live !== undefined, it.took ?? null, it.said ?? null, it.voice ?? null, it.speaker ?? null, it.tone ?? null, it.live?.now?.label ?? null, it.live?.now?.since ?? null, it.open ?? null, steps]);
}

/** #gui-turn-steps: the live step's own clock in the unfolded list (from its start). */
export function stepClockText(since: string, now: number): string {
  return durationText(secsSince(since, now) ?? 0);
}

/**
 * Review H1: the indices before `upto` (the common key prefix the page keeps mounted) whose rendered signature
 * changed. A kept item can still change in place: the activity line freezes when the reply lands (same key, live
 * removed), a 🔊 marker folds its later sentences. The page remounts exactly these, in both repaint branches.
 */
export function changedBefore(prev: readonly Parameters<typeof itemSig>[0][], next: readonly Parameters<typeof itemSig>[0][], upto: number): number[] {
  const out: number[] = [];
  const n = Math.min(upto, prev.length, next.length);
  for (let i = 0; i < n; i++) if (itemSig(prev[i]!) !== itemSig(next[i]!)) out.push(i);
  return out;
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
