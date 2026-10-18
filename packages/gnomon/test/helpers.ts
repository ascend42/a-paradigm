import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Recursively list files under `dir` whose name passes `keep`. */
export function walk(dir: string, keep: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}

export function rel(file: string): string {
  return path.relative(PKG_ROOT, file).split(path.sep).join('/');
}

/** Static, re-export, side-effect, dynamic and require specifiers (G-KRN-02 fence, seams fence). */
const SPECIFIER_PATTERNS = [
  /\bimport\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function extractSpecifiers(source: string): string[] {
  const out = new Set<string>();
  for (const re of SPECIFIER_PATTERNS) {
    for (const m of source.matchAll(re)) out.add(m[1]!);
  }
  return [...out];
}
