/**
 * @symbol #folder-picker
 * @symbol #bare-entry
 *
 * The ONE prefill/escape rule for a path shown to the human (Aegis L3), identical in
 * packages/gnomon-gui/src/core/launch.ts and checked by the shared vectors test/fixtures/cwd-hint.v1.json: a code
 * point is shown as itself only when it is a letter, number, punctuation, symbol or a plain space, is not a format
 * character (Cf) or default-ignorable (fillers, variation selectors, tags), is not U+FFFD (invalid UTF-8) and is not
 * a backslash; anything else is escaped as \\u{hex}. Used by bare `gnomon` (cli/bare-cli.ts re-exports it) and by the
 * folder verbs' `display` (folders.ts), so the kernel's escaped display string is the only one the GUI renders.
 */

/** Display cap, in code points (the GUI's CWD_DISPLAY_CAP). */
export const DISPLAY_CAP = 240;

const SAFE_CP = /^[\p{L}\p{N}\p{P}\p{S} ]$/u;
const HIDDEN_CP = /[\p{Cf}\p{Default_Ignorable_Code_Point}�\\]/u;
const ESCAPE = { test: (c: string): boolean => !SAFE_CP.test(c) || HIDDEN_CP.test(c) };

/** Escape what a terminal or a page could interpret or hide, then cap. Pure; the same rule the GUI applies. */
export function displayPath(p: string, cap: number = DISPLAY_CAP): string {
  // Aegis round 3: checked and shown as q = NFC(p) (a decomposed name composes, an orphan or uncomposable mark
  // stays and is escaped); the code-point cap is counted on the ORIGINAL p; the prefill (GUI) is p byte for byte
  const n = [...p].length;
  const shown = [...p.normalize('NFC')].slice(0, Math.min(cap, n)).map((c) => (c === '\\' ? '\\\\' : ESCAPE.test(c) ? `\\u{${c.codePointAt(0)!.toString(16)}}` : c));
  return shown.join('') + (n > cap ? `… (+${n - cap} chars)` : '');
}

/** True when a path needs escaping to be shown (checked on NFC(p)): such a path is shown, never prefilled. */
export function needsEscape(p: string): boolean {
  return [...p.normalize('NFC')].some((c) => ESCAPE.test(c));
}
