/**
 * §5.5 "no copy reappears" structural guard.
 *
 * After the extract-university-core refactor the canonical content-loading
 * symbols live in EXACTLY ONE place (`@a-company/university-core`). This test
 * fails CI if a second local definition of any guarded symbol reappears inside
 * the CLI `src/` tree — the structural lock that prevents the 4-copy situation
 * from regrowing (spec §5.5). It greps for `function <name>` definitions only
 * (re-exports / imports / comment mentions are fine).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const GUARDED = [
  'scanPackEntries',
  'resolveContentBaseLabel',
  'countPackEntries',
  'safeLoadPackId',
] as const;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_SRC = path.resolve(__dirname, '..', '..'); // packages/paradigm/src

function walk(dir: string, acc: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'dist') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

describe('§5.5 no-copy-reappears guard', () => {
  const files = walk(CLI_SRC);

  for (const sym of GUARDED) {
    it(`has NO local "function ${sym}" definition anywhere in CLI src`, () => {
      // Matches a function declaration `function <sym>` — re-exports
      // (`export { countPackEntries }`) and imports are NOT matched.
      const re = new RegExp(`function\\s+${sym}\\b`);
      const offenders = files.filter(f => re.test(fs.readFileSync(f, 'utf8')));
      expect(offenders).toEqual([]);
    });
  }
});
