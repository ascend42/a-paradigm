/**
 * Fallback grep takes a symbol from a tool call (model input). It is matched
 * as a fixed string and never reaches a shell.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { grepForReferences } from './fallback-grep.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fallback-grep-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'const x = 1;\n// uses #checkout-form here\n');
  fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'literal $(weird) symbol\n');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('grepForReferences', () => {
  it('finds a plain symbol', () => {
    const refs = grepForReferences(root, '#checkout-form');
    expect(refs.map((r) => [r.filePath, r.line])).toEqual([[path.join('src', 'a.ts'), 2]]);
  });

  it('runs nothing for a symbol built to break out of a shell string', () => {
    const marker = path.join(root, 'PWNED');
    for (const sym of [`#x"; touch ${marker}; echo "`, `#x$(touch ${marker})`, `#x\`touch ${marker}\``, '--help']) {
      expect(grepForReferences(root, sym)).toEqual([]);
    }
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('matches shell metacharacters literally', () => {
    const refs = grepForReferences(root, '$(weird)');
    expect(refs.map((r) => r.filePath)).toEqual([path.join('src', 'b.ts')]);
  });
});
