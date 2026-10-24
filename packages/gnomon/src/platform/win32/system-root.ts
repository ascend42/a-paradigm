/**
 * @symbol #gnomon-helper
 *
 * The Windows directory, for the minimal env a win32 child needs (the loader and CNG resolve DLLs under it). ONE
 * definition (PR #52 review): env names are case-insensitive on Windows (SystemRoot, SYSTEMROOT), and the fallback is
 * built with path.win32 so it can never lose its separator to a string escape ('C:\Windows' in a JS literal is
 * 'C:Windows').
 */
import * as path from 'node:path';

export const WIN32_SYSTEM_ROOT_FALLBACK = path.win32.join('C:\\', 'Windows');

// Aegis (PR #52 follow-up): reg.exe and the helper's PATH are built from this value, so only a drive-rooted absolute
// path is taken (never relative, never a UNC share); anything else falls back.
const DRIVE_ROOTED = /^[A-Za-z]:\\[^\\]/;

export function win32SystemRoot(env: Readonly<Record<string, string | undefined>> = process.env): string {
  // the canonical spelling first, so a plain object holding several spellings resolves the same way every time
  const named = env['SystemRoot'] ?? Object.entries(env).find(([k]) => k.toUpperCase() === 'SYSTEMROOT')?.[1];
  return typeof named === 'string' && DRIVE_ROOTED.test(named) ? named : WIN32_SYSTEM_ROOT_FALLBACK;
}
