/**
 * TD-2026-10-27-833: grepForReferences runs rg/grep with an argv, never a shell string. A local model reaches it through
 * paradigm_ripple, so a quote, backtick or `$(...)` in the symbol must be matched literally and never run.
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { grepForReferences } from './fallback-grep.js';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'fallback-grep-')));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('grepForReferences', () => {
  it('never runs shell syntax in the symbol; matches it as a fixed string', () => {
    const marker = path.join(root, 'ran');
    const evil = `#x"; touch ${marker}; echo "$(touch ${marker})\`touch ${marker}\``;
    fs.writeFileSync(path.join(root, 'a.ts'), `// ${evil}\nconst y = 1;\n`);
    const hits = grepForReferences(root, evil);
    expect(fs.existsSync(marker)).toBe(false);
    expect(hits.map((h) => h.filePath)).toEqual(['a.ts']);
  });

  it('a regex metacharacter is literal', () => {
    fs.writeFileSync(path.join(root, 'b.ts'), '// #a.b\n// #axb\n');
    expect(grepForReferences(root, '#a.b').map((h) => [h.filePath, h.line])).toEqual([['b.ts', 1]]);
  });
});
