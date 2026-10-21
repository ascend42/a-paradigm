/**
 * @symbol #gui-composer
 *
 * The growing composer (Atelier 2026-10-21-gnomon-voice, design-system gnomon.voice.composer; spec §11.5). PURE.
 *
 * The textarea wraps and grows with its text up to COMPOSER_LINES (12), then scrolls; the ⤢ key toggles a tall view
 * that raises the cap to COMPOSER_TALL_LINES (24) and back. The choice persists per viewer (localStorage, TALL_KEY).
 * A line count (visual lines, wraps included) sits beside it. There is exactly ONE send control in the composer
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

/** "1 line" · "14 lines". */
export const lineCountLabel = (n: number): string => `${n} line${n === 1 ? '' : 's'}`;
