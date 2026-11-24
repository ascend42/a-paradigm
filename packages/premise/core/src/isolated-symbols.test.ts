/**
 * What "isolated" means (findIsolatedSymbols).
 *
 * A gate that protects a route, an aspect attached to code, and a symbol named
 * by a bare id in a structured field are all connected; none of them is an
 * edge the prefixed-reference pattern can see.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { aggregateFromDirectory, structuredReferences, collectGateRoutes } from './aggregator.js';
import { buildSymbolIndex, getSymbol } from './symbol-index.js';
import { findIsolatedSymbols } from './integrity.js';

let tmpDir: string;

function write(rel: string, lines: string[]): string {
  const abs = path.join(tmpDir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, lines.join('\n') + '\n');
  return abs;
}

async function load() {
  const result = await aggregateFromDirectory(tmpDir);
  return { result, idx: buildSymbolIndex(result), isolated: findIsolatedSymbols(result.symbols).map((s) => s.symbol).sort() };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-symbols-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const GATE = (id: string): string[] => [`  ${id}:`, `    description: ${id}`, '    check: ok', '    prizes: []'];

describe('gates', () => {
  it('a gate named on a portal.yaml route is connected; one on no route is isolated', async () => {
    write('portal.yaml', [
      'version: 2.0.0',
      'gates:',
      ...GATE('on-route'),
      ...GATE('bare-on-route'),
      ...GATE('in-object'),
      ...GATE('unused'),
      'routes:',
      '  GET /api/a:',
      '    - ^on-route',
      '    - bare-on-route',
      '  POST /api/b:',
      '    gates: [^in-object]',
      '  GET /api/c: ^on-route',
    ]);
    const { idx, isolated } = await load();

    expect(isolated).toEqual(['^unused']);
    expect(getSymbol(idx, '^on-route')?.routes).toEqual(['GET /api/a', 'GET /api/c']);
    expect(getSymbol(idx, '^bare-on-route')?.routes).toEqual(['GET /api/a']);
    expect(getSymbol(idx, '^in-object')?.routes).toEqual(['POST /api/b']);
    expect(getSymbol(idx, '^unused')?.routes).toBeUndefined();
  });

  it('a gate declared in .purpose and used only on a route of a package portal.yaml is connected', async () => {
    write('portal.yaml', ['version: 2.0.0', 'gates:', ...GATE('root-gate')]);
    const pkg = write('packages/api/portal.yaml', ['version: 2.0.0', 'gates: {}', 'routes:', '  GET /x: [^purpose-gate]']);
    write('src/.purpose', ['version: "2.0"', 'gates:', '  purpose-gate:', '    description: declared here']);
    const { isolated } = await load();

    expect(isolated).toEqual(['^root-gate']);
    expect(collectGateRoutes([pkg]).get('^purpose-gate')).toEqual(['GET /x']);
  });
});

describe('aspects', () => {
  it('an aspect with an anchor or an applies-to pattern is connected; one with neither is isolated', async () => {
    write('src/.purpose', [
      'version: "2.0"',
      'aspects:',
      '  anchored:',
      '    description: has an anchor',
      '    anchors: ["src/a.ts:1-5"]',
      '  applied:',
      '    description: has a pattern',
      '    anchors: []',
      '    applies-to: ["src/**/*.ts"]',
      '  floating:',
      '    description: attached to nothing',
      '    anchors: []',
    ]);
    const { isolated } = await load();
    expect(isolated).toEqual(['~floating']);
  });
});

describe('bare ids in structured fields', () => {
  it('parent, flow step component/gate/signal, emits and bare list entries are edges', async () => {
    write('src/.purpose', [
      'version: "2.0"',
      'components:',
      '  shell:',
      '    description: Parent of the row',
      '  session-row:',
      '    description: A row',
      '    parent: shell',
      '  emitter:',
      '    description: Emits',
      '    emits: [row-picked]',
      '  lister:',
      '    description: Lists by bare id',
      '    aspects: [audited]',
      '    flows: [pick]',
      '  step-target:',
      '    description: Reached by a bare step',
      '  alone:',
      '    description: Nothing names this',
      'flows:',
      '  pick:',
      '    description: Pick a row',
      '    steps:',
      '      - component: step-target',
      '        action: click',
      '        gate: can-pick',
      '        signal: step-done',
      'gates:',
      '  can-pick:',
      '    description: May pick',
      'signals:',
      '  row-picked:',
      '    description: Picked',
      '  step-done:',
      '    description: Done',
      'aspects:',
      '  audited:',
      '    description: Audited',
      '    anchors: []',
    ]);
    const { idx, isolated } = await load();

    expect(isolated).toEqual(['#alone']);
    expect(getSymbol(idx, '#shell')?.referencedBy).toEqual(['#session-row']);
    expect(getSymbol(idx, '$pick')?.references.sort()).toEqual(['!step-done', '#step-target', '^can-pick']);
    expect(getSymbol(idx, '!row-picked')?.referencedBy).toEqual(['#emitter']);
    expect(getSymbol(idx, '~audited')?.referencedBy).toEqual(['#lister']);
  });

  it('structuredReferences reads known fields only, bare ids only', () => {
    expect(
      structuredReferences({
        parent: 'shell',
        description: 'mentions plain-word and nothing else',
        gates: ['^prefixed', 'bare'],
        steps: [{ component: 'row', action: 'click' }, 'a string step'],
        anchors: ['src/x.ts:1'],
        tags: ['core'],
        emits: 'one-signal',
        component: 'has spaces in it',
      }).sort(),
    ).toEqual(['!one-signal', '#row', '#shell', '^bare']);
  });

  it('free text in a structured field creates no edge and no stub', async () => {
    write('src/.purpose', ['version: "2.0"', 'components:', '  only:', '    description: Only', '    parent: nobody-declared-this']);
    const { result, isolated } = await load();
    expect(result.symbols.map((s) => s.symbol)).toEqual(['#only']);
    expect(isolated).toEqual(['#only']);
  });
});
