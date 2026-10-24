/**
 * @symbol #scheduler
 *
 * #scheduler — wall-clock triggers in a stated IANA time zone (docs/specs/gnomon-loops.md §4 "Scheduler
 * integration"; loops build step 6). `daily {at, tz}` and `weekly {day, at, tz}` resolve one local date at a time to
 * one UTC instant, so the due instants stay a pure function of the trigger and the due rows (G-SCH-01):
 *
 *   - a normal date: the one instant whose wall clock in `tz` reads `at`;
 *   - a time REPEATED by fall-back (01:30 twice): the EARLIER instant, once (the later one is never a fire);
 *   - a time SKIPPED by spring-forward (02:30 never exists): the first instant after the gap (the transition
 *     itself, 03:00 local), once.
 *
 * Each local date gives exactly one fire, and a later date always a later fire, so counting the fires between two
 * instants is a calendar-day difference. Zone data is the runtime's ICU (`Intl`), which Node ships in full on every
 * platform; an unknown zone refuses at registration.
 */

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formats = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    formats.set(tz, f);
  }
  return f;
}

/** True when the runtime knows `tz` (an IANA name like America/Los_Angeles, or UTC). */
export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

/** "HH:MM" (24-hour) to minutes after midnight, or null. */
export function parseHhmm(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = HHMM.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Days since 1970-01-01 of a calendar date. */
const dayNumber = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d) / DAY_MS;

/** The wall clock of `ms` in `tz`, as minutes since 1970-01-01T00:00 local. */
function wallMinutes(ms: number, tz: string): number {
  let y = 0, mo = 0, d = 0, h = 0, mi = 0;
  for (const p of fmt(tz).formatToParts(ms)) {
    if (p.type === 'year') y = Number(p.value);
    else if (p.type === 'month') mo = Number(p.value);
    else if (p.type === 'day') d = Number(p.value);
    else if (p.type === 'hour') h = Number(p.value) % 24;
    else if (p.type === 'minute') mi = Number(p.value);
  }
  return dayNumber(y, mo, d) * 1440 + h * 60 + mi;
}

/** The local calendar day (days since 1970-01-01) of `ms` in `tz`. */
export function localDay(ms: number, tz: string): number {
  return Math.floor(wallMinutes(ms, tz) / 1440);
}

/** Monday = 0 … Sunday = 6 of a day number (1970-01-01 was a Thursday). */
export const weekdayOf = (day: number): number => (((day + 3) % 7) + 7) % 7;

/**
 * The fire instant of local `day` at `minute` (minutes after midnight) in `tz`: the earlier of two matches
 * (fall-back), the end of the gap when none exists (spring-forward).
 */
export function zonedInstant(day: number, minute: number, tz: string): number {
  const target = day * 1440 + minute;
  const guess = target * MIN_MS; // the wall time read as if it were UTC
  const offset = (ms: number): number => wallMinutes(ms, tz) * MIN_MS - Math.floor(ms / MIN_MS) * MIN_MS;
  let best: number | null = null;
  for (const o of new Set([offset(guess - DAY_MS), offset(guess), offset(guess + DAY_MS)])) {
    const t = guess - o;
    if (wallMinutes(t, tz) === target && (best === null || t < best)) best = t;
  }
  if (best !== null) return best;
  // a gap: the first minute whose wall clock reads `target` or later (the transition). Offsets are within ±26 h.
  let lo = Math.floor((guess - 26 * 3_600_000) / MIN_MS);
  let hi = Math.ceil((guess + 26 * 3_600_000) / MIN_MS);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (wallMinutes(mid * MIN_MS, tz) >= target) hi = mid;
    else lo = mid + 1;
  }
  return lo * MIN_MS;
}

export interface CalendarRule {
  /** minutes after local midnight */
  minute: number;
  tz: string;
  /** Monday = 0 … Sunday = 6; absent = every day */
  weekday?: number;
}

const isFireDay = (r: CalendarRule, day: number): boolean => r.weekday === undefined || weekdayOf(day) === r.weekday;

/** The first fire strictly after `afterMs`: its local day and instant. */
export function firstFireAfter(r: CalendarRule, afterMs: number): { day: number; ms: number } {
  const start = localDay(afterMs, r.tz) - 1;
  for (let i = 0; i < 16; i++) {
    const day = start + i;
    if (!isFireDay(r, day)) continue;
    const ms = zonedInstant(day, r.minute, r.tz);
    if (ms > afterMs) return { day, ms };
  }
  /* unreachable: a fire day comes within 8 days */
  throw new RangeError('no fire within 16 days');
}

/** The last fire at or before `uptoMs`: its local day and instant. */
export function lastFireUpTo(r: CalendarRule, uptoMs: number): { day: number; ms: number } {
  const start = localDay(uptoMs, r.tz) + 1;
  for (let i = 0; i < 16; i++) {
    const day = start - i;
    if (!isFireDay(r, day)) continue;
    const ms = zonedInstant(day, r.minute, r.tz);
    if (ms <= uptoMs) return { day, ms };
  }
  throw new RangeError('no fire within 16 days');
}

/** dueWindow for a calendar rule: fires in (afterMs, uptoMs]. With no history (afterMs not finite) only the last counts. */
export function calendarWindow(r: CalendarRule, afterMs: number, uptoMs: number): { count: number; last: number | null; next: number | null } {
  const next = firstFireAfter(r, uptoMs).ms;
  if (!Number.isFinite(afterMs)) {
    const last = lastFireUpTo(r, uptoMs);
    return { count: 1, last: last.ms, next };
  }
  const first = firstFireAfter(r, afterMs);
  if (first.ms > uptoMs) return { count: 0, last: null, next: first.ms };
  const last = lastFireUpTo(r, uptoMs);
  const step = r.weekday === undefined ? 1 : 7;
  return { count: Math.round((last.day - first.day) / step) + 1, last: last.ms, next };
}
