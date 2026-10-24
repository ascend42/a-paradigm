/**
 * @symbol #gui-composer
 *
 * The growing composer (Atelier 2026-10-21-gnomon-voice, design-system gnomon.voice.composer; spec §11.5). PURE.
 *
 * The textarea wraps and grows with its text up to COMPOSER_LINES (12), then scrolls; the ⤢ key toggles a tall view
 * that raises the cap to COMPOSER_TALL_LINES (24) and back. The choice persists per viewer (localStorage, TALL_KEY).
 * A line count (visual lines, wraps included) sits beside it, from 2 lines up (lineCountShown: at 1 line it says nothing). There is exactly ONE send control in the composer
 * region (the form's submit).
 */

export const COMPOSER_LINES = 12;
export const COMPOSER_TALL_LINES = 24;
export const TALL_KEY = 'gnomon.composer.tall';

export const parseTall = (v: string | null): boolean => v === '1';
export const serializeTall = (on: boolean): string => (on ? '1' : '0');

export interface ComposerFit {
  /** the textarea's height in px (content, capped) */
  heightPx: number;
  /** visual lines of text (at least 1) */
  lines: number;
  /** the text is taller than the cap: the textarea scrolls */
  scrolls: boolean;
  /** the cap in lines (12, or 24 in the tall view) */
  cap: number;
}

/**
 * Fit the textarea to its content. `contentPx` is its scrollHeight with the height reset (padding included),
 * `linePx` its computed line height, `padPx` its vertical padding.
 */
export function composerFit(contentPx: number, linePx: number, padPx: number, tall: boolean): ComposerFit {
  const cap = tall ? COMPOSER_TALL_LINES : COMPOSER_LINES;
  const lh = Number.isFinite(linePx) && linePx > 0 ? linePx : 21.6;
  const pad = Number.isFinite(padPx) && padPx > 0 ? padPx : 0;
  const text = Math.max(0, (Number.isFinite(contentPx) ? contentPx : 0) - pad);
  const lines = Math.max(1, Math.round(text / lh));
  const shown = Math.min(lines, cap);
  return { heightPx: Math.round(shown * lh + pad), lines, scrolls: lines > cap, cap };
}

/** The conversation keeps at least this much height when the tall view would take it (fitTallRoom). */
export const TALL_FEED_MIN_PX = 120;

/**
 * The tall view gives back the room it would take from the window: `shortPx` is how far the conversation falls below
 * TALL_FEED_MIN_PX plus how far the composer runs past its pane at this height. The shown lines drop by that many
 * lines, never below the normal cap (12), and the textarea scrolls (Mika 2026-10-23: at 1024×768, 24 lines pushed
 * send and ⤢ off the window; at 1440×900 the conversation was 9 px tall).
 */
export function fitTallRoom(f: ComposerFit, linePx: number, padPx: number, shortPx: number): ComposerFit {
  const shownNow = Math.min(f.lines, f.cap);
  if (!(shortPx > 0) || shownNow <= COMPOSER_LINES) return f;
  const lh = Number.isFinite(linePx) && linePx > 0 ? linePx : 21.6;
  const pad = Number.isFinite(padPx) && padPx > 0 ? padPx : 0;
  const cap = Math.max(COMPOSER_LINES, shownNow - Math.ceil(shortPx / lh));
  const shown = Math.min(f.lines, cap);
  return { heightPx: Math.round(shown * lh + pad), lines: f.lines, scrolls: f.lines > cap, cap };
}

/** The count shows from 2 lines up; an empty or one-line composer says nothing (founder report 2026-10-23). */
export const lineCountShown = (n: number): boolean => n >= 2;

/** "1 line" · "14 lines". */
export const lineCountLabel = (n: number): string => `${n} line${n === 1 ? '' : 's'}`;
