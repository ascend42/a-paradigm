/**
 * Counts a user sees never include reference stubs (`declared: false`), and
 * prose that only looks like a symbol never becomes a stub.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { aggregateFromDirectory } from './aggregator.js';
import { buildSymbolIndex, getAllSymbols, getSymbol, getSymbolCounts, getUndeclaredCount, isDeclared, splitDeclared } from './symbol-index.js';

let tmpDir: string;

function write(rel: string, content: string): void {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'symbol-counts-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getSymbolCounts', () => {
  it('counts declared symbols only; stubs are reported separately', async () => {
    write(
      'src/app/.purpose',
      [
        'version: "2.0"',
        'components:',
        '  app-shell:',
        '    description: Shell. Runs $boot-flow and emits !shell-ready',
        '    gates: [^ghost, ^admin-only]',
        'gates:',
        '  admin-only:',
        '    description: Admin role required',
        'flows:',
        '  boot-flow:',
        '    description: Boot',
        '',
      ].join('\n'),
    );
    const idx = buildSymbolIndex(await aggregateFromDirectory(tmpDir));

    // ^ghost and !shell-ready are referenced, declared nowhere: indexed as stubs
    expect(getSymbol(idx, '^ghost')?.declared).toBe(false);
    expect(getSymbol(idx, '!shell-ready')?.declared).toBe(false);

    expect(getSymbolCounts(idx)).toEqual({ component: 1, flow: 1, gate: 1, signal: 0, aspect: 0 });
    expect(getUndeclaredCount(idx)).toBe(2);
    expect([...idx.entries.values()].filter(isDeclared)).toHaveLength(3);

    // a list printed beside the total holds the same symbols the total counts
    const { declared, undeclared } = splitDeclared(getAllSymbols(idx));
    const total = Object.values(getSymbolCounts(idx)).reduce((a, b) => a + b, 0);
    expect(declared).toHaveLength(total);
    expect(undeclared.map((s) => s.symbol).sort()).toEqual(['!shell-ready', '^ghost']);
  });

  it('environment variables, colours and dotted paths in prose are not indexed at all', async () => {
    write(
      'src/app/.purpose',
      [
        'version: "2.0"',
        'components:',
        '  app-shell:',
        '    description: "Reads $HOME and $CLAUDE_PROJECT_DIR, paints #rrggbb, toggles #session.active. Guarded by ^admin-only."',
        'gates:',
        '  admin-only:',
        '    description: Admin role required',
        '',
      ].join('\n'),
    );
    const idx = buildSymbolIndex(await aggregateFromDirectory(tmpDir));

    expect([...idx.entries.values()].map((e) => e.symbol).sort()).toEqual(['#app-shell', '^admin-only']);
    expect(getUndeclaredCount(idx)).toBe(0);
    // the trailing full stop did not create a second gate
    expect(getSymbol(idx, '^admin-only.')).toBeUndefined();
    expect(getSymbol(idx, '^admin-only')?.referencedBy).toEqual(['#app-shell']);
  });
});
