/**
 * A .purpose key that repeats its section's prefix is indexed once, under the
 * real symbol, so references to it resolve (it used to be filed as `$$name`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { aggregateFromDirectory } from './aggregator.js';
import { buildSymbolIndex, getSymbol, getUndeclaredCount } from './symbol-index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redundant-prefix-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('prefixed keys inside a section block', () => {
  it('index each of the five kinds single-prefixed, and references resolve', async () => {
    const dir = path.join(tmpDir, 'src', 'app');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.purpose'),
      [
        'version: "2.0"',
        'components:',
        "  '#fleet-store':",
        '    description: Store',
        '  caller:',
        '    description: Calls things',
        '    components: ["#fleet-store"]',
        '    flows: [$fleet-spawn]',
        '    gates: [^fleet-owner]',
        '    signals: ["!fleet-ready"]',
        '    aspects: [~fleet-audited]',
        'flows:',
        '  $fleet-spawn:',
        '    description: Spawn',
        'gates:',
        '  ^fleet-owner:',
        '    description: Owner only',
        'signals:',
        "  '!fleet-ready':",
        '    description: Ready',
        'aspects:',
        '  ~fleet-audited:',
        '    description: Audited',
        '    anchors: []',
        '',
      ].join('\n'),
    );

    const idx = buildSymbolIndex(await aggregateFromDirectory(tmpDir));
    const symbols = [...idx.entries.values()].map((e) => e.symbol).sort();

    expect(symbols).toEqual(['!fleet-ready', '#caller', '#fleet-store', '$fleet-spawn', '^fleet-owner', '~fleet-audited']);
    expect(symbols.some((s) => /^([#$^!~])\1/.test(s))).toBe(false);
    // every reference found its declaration: no stubs
    expect(getUndeclaredCount(idx)).toBe(0);
    for (const s of ['#fleet-store', '$fleet-spawn', '^fleet-owner', '!fleet-ready', '~fleet-audited']) {
      expect(getSymbol(idx, s)?.declared).not.toBe(false);
      expect(getSymbol(idx, s)?.referencedBy).toContain('#caller');
    }
  });
});
