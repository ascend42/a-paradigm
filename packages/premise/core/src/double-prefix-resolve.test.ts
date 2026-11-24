/**
 * A double-prefixed id ("$$fleet-switch") is what the index used to file for a
 * key that repeated its section's prefix. Saved graphs, lore entries and
 * decisions still hold such ids; resolveSymbol reads them as the symbol they name.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { aggregateFromDirectory } from './aggregator.js';
import { buildSymbolIndex, getSymbol, resolveSymbol, collapseRepeatedPrefix } from './symbol-index.js';

let tmpDir: string;

function write(rel: string, lines: string[]): void {
  const abs = path.join(tmpDir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, lines.join('\n') + '\n');
}

async function load() {
  return { idx: buildSymbolIndex(await aggregateFromDirectory(tmpDir)) };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'double-prefix-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('a double-prefixed id still resolves', () => {
  it('collapseRepeatedPrefix handles all five prefixes and nothing else', () => {
    expect(collapseRepeatedPrefix('$$fleet-switch')).toBe('$fleet-switch');
    expect(collapseRepeatedPrefix('^^symphony-enabled')).toBe('^symphony-enabled');
    expect(collapseRepeatedPrefix('!!note-relayed')).toBe('!note-relayed');
    expect(collapseRepeatedPrefix('~~determinism')).toBe('~determinism');
    expect(collapseRepeatedPrefix('###docs-scaffold')).toBe('#docs-scaffold');
    expect(collapseRepeatedPrefix('$fleet-switch')).toBe('$fleet-switch');
    expect(collapseRepeatedPrefix('#$mixed')).toBe('#$mixed');
    expect(collapseRepeatedPrefix('plain')).toBe('plain');
  });

  it('resolveSymbol reads "$$name" (as saved graphs, lore and decisions wrote it) as "$name"', async () => {
    write('src/.purpose', [
      'version: "2.0"',
      'components:',
      '  docs-scaffold:',
      '    description: c',
      'flows:',
      '  fleet-switch:',
      '    description: f',
      'gates:',
      '  symphony-enabled:',
      '    description: g',
      'signals:',
      '  note-relayed:',
      '    description: s',
      'aspects:',
      '  determinism:',
      '    description: a',
      '    anchors: []',
    ]);
    const { idx } = await load();
    for (const [typed, symbol] of [
      ['$$fleet-switch', '$fleet-switch'],
      ['^^symphony-enabled', '^symphony-enabled'],
      ['!!note-relayed', '!note-relayed'],
      ['~~determinism', '~determinism'],
      ['##docs-scaffold', '#docs-scaffold'],
      ['$$Fleet-Switch', '$fleet-switch'],
    ]) {
      expect(resolveSymbol(idx, typed).entry?.symbol, typed).toBe(symbol);
    }
    // exact lookups stay exact: edges and hashing never go through the tolerant path
    expect(getSymbol(idx, '$$fleet-switch')).toBeUndefined();
    expect(resolveSymbol(idx, '$$no-such-flow').entry).toBeUndefined();
  });
});
