/**
 * @symbol #gui-toast
 *
 * The one toast (design system .atelier/systems/gnomon/design-system.yaml: component `toast`, zone `toasts`, rule
 * notices-by-kind; board gnomon-notices, choice band-for-alerts). PURE: kinds, timing, roles, the overflow policy and
 * the refusal split. ui/toasts.ts is the DOM.
 *
 *   - Every notice that is not a kernel alert is a toast: GUI outcomes (notice()), the voice idle auto-off and the
 *     voice app's notices, update available, standing-grant offers and confirmations. Kernel alerts (#repin,
 *     #voice-dev) stay in the band under the header.
 *   - Edge by kind: ink for info, amber for warn (and asks-first), vermilion for fail.
 *   - Timing: info leaves after 6 s, warn after 10 s, both paused while hovered or focused; fail and persistent
 *     (and a held asks-first) never leave by themselves.
 *   - Kind is never told by hue alone: a fail carries the word "failed" and a solid edge, a warn "warning" (or
 *     "asks first") and a dashed edge; info has neither.
 *   - Announcements go through two live regions that exist from page load (index.html): fail is assertive
 *     (role=alert), every other kind polite (role=status). The toasts themselves are not live regions.
 *   - Overflow: at most three shown, newest on top, and the newest is always shown (nothing arrives unseen). An
 *     older auto-leaving toast (info first, then warn) leaves to make room; a fail or persistent one never leaves
 *     for room, it waits hidden until a slot frees.
 */

export type ToastKind = 'info' | 'warn' | 'fail';

/** At most this many toasts are shown at once (zone toasts, overflow). */
export const TOAST_MAX = 3;
/** info: 6 s (component toast, variant info). */
export const TOAST_INFO_MS = 6_000;
/** warn: the spec names no time; the conservative choice is longer than info. */
export const TOAST_WARN_MS = 10_000;
/** Text wraps to 4 lines at 44ch (zone toasts, overflow); the rest goes to title=. */
export const TOAST_LINES = 4;
export const TOAST_MEASURE_CH = 44;

/** How long a toast stays on its own, or null when it stays until closed or its cause is resolved. */
export function toastTtl(kind: ToastKind, persistent: boolean): number | null {
  if (persistent || kind === 'fail') return null;
  return kind === 'warn' ? TOAST_WARN_MS : TOAST_INFO_MS;
}

/** Which page live region announces it: fail interrupts (role=alert), every other kind waits its turn. */
export const toastLive = (kind: ToastKind): 'assertive' | 'polite' => (kind === 'fail' ? 'assertive' : 'polite');

/** The non-hue mark of a kind (rule status-in-ink: a word plus weight, never colour alone), or null for info. */
export function toastTag(kind: ToastKind, held: boolean): string | null {
  if (kind === 'fail') return 'failed';
  if (kind === 'warn') return held ? 'asks first' : 'warning';
  return null;
}

/** A fail or persistent toast carries a close key (component toast, anatomy); info and warn leave by themselves. */
export const toastClosable = (kind: ToastKind, persistent: boolean): boolean => persistent || kind === 'fail';

/** The CSS class of a toast (the edge colour goes by kind). */
export const toastClass = (kind: ToastKind): string => (kind === 'info' ? 'toast' : `toast ${kind}`);

export interface ToastEntry {
  id: number;
  kind: ToastKind;
  persistent: boolean;
}

/**
 * The overflow policy over the toasts in arrival order (oldest first). Returns the ids that leave now and the ids
 * shown, newest first. While more than TOAST_MAX are present, the oldest auto-leaving toast other than the newest
 * leaves (info before warn); a fail or persistent toast never leaves for room, it waits hidden until a slot frees.
 * The newest is always shown, so an info never arrives unseen behind fail and persistent ones.
 */
export function toastOverflow(entries: readonly ToastEntry[]): { drop: number[]; shown: number[] } {
  const keep = [...entries];
  const drop: number[] = [];
  const newest = entries[entries.length - 1]?.id;
  const leaves = (k: ToastKind): number => keep.findIndex((e) => !e.persistent && e.kind === k && e.id !== newest);
  while (keep.length > TOAST_MAX) {
    let i = leaves('info');
    if (i < 0) i = leaves('warn');
    if (i < 0) break;
    drop.push(keep[i]!.id);
    keep.splice(i, 1);
  }
  return { drop, shown: keep.slice(-TOAST_MAX).reverse().map((e) => e.id) };
}

/**
 * A refusal's text (app.ts refusalText: "CODE reason  message\n  next: a · b") as its main line and its next: line,
 * so a long refusal keeps next: visible while the main text is cut to 4 lines (zone toasts, overflow).
 */
export function splitToastText(text: string): { main: string; next: string | null } {
  const m = /\n\s*(next: [\s\S]*)$/.exec(text);
  if (!m) return { main: text, next: null };
  return { main: text.slice(0, m.index), next: m[1]!.trim() };
}

/** Whether the main text may not fit 4 lines at 44ch (then the full text goes in title= too). A cheap upper bound. */
export const toastMayClip = (main: string): boolean => main.length > TOAST_LINES * TOAST_MEASURE_CH || main.split('\n').length > TOAST_LINES;
