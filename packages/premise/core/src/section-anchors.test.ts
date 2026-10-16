/**
 * Heading / block anchors (D9, 7.12.0) — parsing, resolution, back-compat.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseAnchor,
  parseAnchorString,
  parseSectionAnchor,
  resolveSectionAnchorLines,
} from './symbol-index.js';
import { aggregateFromDirectory } from './aggregator.js';

describe('line anchors stay byte-identical', () => {
  it('parseAnchorString(":15-20") has exactly the pre-7.12 shape', () => {
    const a = parseAnchorString('src/foo.ts:15-20');
    expect(JSON.stringify(a)).toBe('{"path":"src/foo.ts","lines":[15,20],"raw":"src/foo.ts:15-20"}');
    expect(Object.keys(a)).toEqual(['path', 'lines', 'raw']);
  });
  it('parseAnchor(":15-20") has exactly the pre-7.12 shape', () => {
    expect(JSON.stringify(parseAnchor('src/foo.ts:15-20'))).toBe(
      '{"path":"src/foo.ts","lines":[15,20],"raw":"src/foo.ts:15-20"}',
    );
  });
  it('other line forms are unchanged', () => {
    expect(parseAnchorString('a.ts')).toEqual({ path: 'a.ts', lines: 0, raw: 'a.ts' });
    expect(parseAnchorString('a.ts:7')).toEqual({ path: 'a.ts', lines: 7, raw: 'a.ts:7' });
    expect(parseAnchorString('a.ts:1,3')).toEqual({ path: 'a.ts', lines: [1, 3], raw: 'a.ts:1,3' });
    expect(parseAnchorString('a.ts:abc')).toEqual({ path: 'a.ts:abc', lines: 0, raw: 'a.ts:abc' });
    expect(parseAnchor('a.ts')).toEqual({ path: 'a.ts', lines: 1, raw: 'a.ts' });
    expect(parseAnchor('a.ts:x')).toBeNull();
  });
  it('a "#" inside a directory (no extension before it) is still a line anchor', () => {
    expect(parseAnchorString('src/c#/Foo.cs:10')).toEqual({ path: 'src/c#/Foo.cs', lines: 10, raw: 'src/c#/Foo.cs:10' });
  });
  it('a "#" after a dotted directory (dir.name#x/Foo.ts:10) is still a line anchor', () => {
    expect(parseAnchorString('dir.name#x/Foo.ts:10')).toEqual({ path: 'dir.name#x/Foo.ts', lines: 10, raw: 'dir.name#x/Foo.ts:10' });
    expect(parseAnchorString('dir.name#x/Foo.ts:10-12')).toEqual({ path: 'dir.name#x/Foo.ts', lines: [10, 12], raw: 'dir.name#x/Foo.ts:10-12' });
    expect(parseAnchorString('pkg.v2#Foo.ts:7')).toEqual({ path: 'pkg.v2#Foo.ts', lines: 7, raw: 'pkg.v2#Foo.ts:7' });
    expect(parseAnchor('dir.name#x/Foo.ts:10')).toMatchObject({ path: 'dir.name#x/Foo.ts', lines: 10 });
    // a heading may still contain a non-numeric ':'
    expect(parseAnchorString('docs/x.md#Step: setup')).toMatchObject({ kind: 'heading', heading: 'Step: setup' });
  });
});

describe('section anchors parse', () => {
  it('heading', () => {
    expect(parseAnchorString('docs/x.md#Setup: step 1')).toEqual({
      path: 'docs/x.md', lines: 0, raw: 'docs/x.md#Setup: step 1', kind: 'heading', heading: 'Setup: step 1',
    });
    expect(parseAnchor('docs/x.md#Heading Text')?.heading).toBe('Heading Text');
  });
  it('block', () => {
    expect(parseAnchorString('docs/x.md#^rule-1')).toEqual({
      path: 'docs/x.md', lines: 0, raw: 'docs/x.md#^rule-1', kind: 'block', block: 'rule-1',
    });
  });
  it('rejects empty / malformed fragments', () => {
    expect(parseSectionAnchor('docs/x.md#')).toBeNull();
    expect(parseSectionAnchor('docs/x.md#^')).toBeNull();
    expect(parseSectionAnchor('docs/x.md#^bad id')).toBeNull();
    expect(parseSectionAnchor('#heading-only')).toBeNull();
  });
});

const DOC = [
  '# Title',         // 1
  '',                // 2
  '## Setup',        // 3
  'step one',        // 4
  '### Detail',      // 5
  'detail text',     // 6
  '',                // 7
  '## Usage',        // 8
  '```',             // 9
  '## Not a heading',// 10
  '```',             // 11
  'para a',          // 12
  'para b ^blk-1',   // 13
  '',                // 14
  'table row',       // 15
  '',                // 16
  '^blk-2',          // 17
].join('\n');

describe('resolveSectionAnchorLines', () => {
  it('heading resolves to its section range (includes subsections, trims trailing blanks)', () => {
    expect(resolveSectionAnchorLines(DOC, { kind: 'heading', heading: 'Setup' })).toEqual({ startLine: 3, endLine: 6 });
    expect(resolveSectionAnchorLines(DOC, { kind: 'heading', heading: 'Detail' })).toEqual({ startLine: 5, endLine: 6 });
    expect(resolveSectionAnchorLines(DOC, { kind: 'heading', heading: 'Usage' })).toEqual({ startLine: 8, endLine: 17 });
  });
  it('case-insensitive fallback; fenced pseudo-headings ignored', () => {
    expect(resolveSectionAnchorLines(DOC, { kind: 'heading', heading: 'setup' })?.startLine).toBe(3);
    expect(resolveSectionAnchorLines(DOC, { kind: 'heading', heading: 'Not a heading' })).toBeNull();
  });
  it('renamed heading → null (drift signal)', () => {
    expect(resolveSectionAnchorLines(DOC.replace('## Setup', '## Installation'), { kind: 'heading', heading: 'Setup' })).toBeNull();
  });
  it('heading follows the section when lines shift', () => {
    const shifted = 'preamble\nmore\n' + DOC;
    expect(resolveSectionAnchorLines(shifted, { kind: 'heading', heading: 'Setup' })).toEqual({ startLine: 5, endLine: 8 });
  });
  it('block ids: inline suffix and standalone', () => {
    expect(resolveSectionAnchorLines(DOC, { kind: 'block', block: 'blk-1' })).toEqual({ startLine: 12, endLine: 13 });
    expect(resolveSectionAnchorLines(DOC, { kind: 'block', block: 'blk-2' })).toEqual({ startLine: 15, endLine: 17 });
    expect(resolveSectionAnchorLines(DOC, { kind: 'block', block: 'gone' })).toBeNull();
  });
});

describe('aggregator: "#" in anchor strings never becomes a symbol reference', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'section-anchor-agg-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('parses section anchors from `anchors:` and does not link #setup', async () => {
    fs.writeFileSync(path.join(tmp, '.purpose'), [
      'name: t',
      'components:',
      '  setup:',
      '    description: A component whose id collides with a heading slug',
      'aspects:',
      '  docs-rule:',
      '    description: Rule documented in a heading',
      '    anchors:',
      '      - docs/x.md#setup',
      '      - docs/x.md#^rule-1',
      '      - src/a.ts:15-20',
    ].join('\n'));
    const res = await aggregateFromDirectory(tmp);
    const aspect = res.symbols.find((s) => s.symbol === '~docs-rule')!;
    expect(aspect.anchors).toEqual([
      { path: 'docs/x.md', lines: 0, raw: 'docs/x.md#setup', kind: 'heading', heading: 'setup' },
      { path: 'docs/x.md', lines: 0, raw: 'docs/x.md#^rule-1', kind: 'block', block: 'rule-1' },
      { path: 'src/a.ts', lines: [15, 20], raw: 'src/a.ts:15-20' },
    ]);
    expect(aspect.references).not.toContain('#setup');
    const comp = res.symbols.find((s) => s.symbol === '#setup')!;
    expect(comp.referencedBy).not.toContain('~docs-rule');
  });
});
