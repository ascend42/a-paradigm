/**
 * Zero false symbols from document bodies: Obsidian `#tag ^blk $x$ ~~s~~` and
 * injection frontmatter never become symbols; symbols come ONLY from
 * declared.yaml (absent after a scan → the brain symbol set is empty).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findPurposeFiles } from '@a-company/purpose-core';
import { initBrain, brainDir, brainFile, brainsHome } from './config.js';
import { openBrainView, scanBrain } from './view.js';
import { materializeRedteam } from './__fixtures__/materialize.js';
import { makeSandbox, type BrainSandbox } from './__fixtures__/env.js';
import type { ViewFile } from './types.js';

let sb: BrainSandbox;
let root: string;
let rootHash: string;
let files: ViewFile[];

/** The brain's symbol set = component ids in declared.yaml (the ONLY source). */
function brainSymbolSet(): string[] {
  const f = brainFile(rootHash, 'declared', sb.opts);
  if (!fs.existsSync(f)) return [];
  const m = /^components:\n((?:  .*\n?)*)/m.exec(fs.readFileSync(f, 'utf8'));
  return m ? [...m[1].matchAll(/^  ([a-z0-9-]+):/gm)].map((x) => x[1]) : [];
}

beforeAll(() => {
  sb = makeSandbox('brain-sym-');
  root = materializeRedteam(sb.tmp).root;
  rootHash = initBrain(root, sb.opts).rootHash;
  scanBrain(rootHash, sb.opts);
  files = openBrainView(rootHash, 'owner', sb.opts).files();
});
afterAll(() => sb.cleanup());

describe('false symbols', () => {
  it('scan declares nothing: brain symbol set == declared set == empty', () => {
    expect(fs.existsSync(brainFile(rootHash, 'declared', sb.opts))).toBe(false);
    expect(brainSymbolSet()).toEqual([]);
  });

  it('.purpose discovery finds nothing inside the root or brain storage', async () => {
    expect(await findPurposeFiles(root)).toEqual([]);
    expect(await findPurposeFiles(brainsHome(sb.opts))).toEqual([]);
    expect(fs.readdirSync(brainDir(rootHash, sb.opts)).sort()).toEqual(['.config-hash', '.config-lastgood.yaml', 'brain.yaml', 'index.json']);
  });

  it('body #tag / ^block / $x$ / ~~s~~ / !signal yield no tags, headings or symbols', () => {
    const daily = files.find((f) => f.relpath === 'obsidian/Daily.md')!;
    expect(daily).toBeDefined();
    expect(daily.tags).toEqual(['journal', 'daily']); // frontmatter only, '#' stripped
    expect(daily.headings).toEqual(['Daily note']); // fenced '# not a heading' excluded
    const all = JSON.stringify(files);
    for (const s of ['component-fake', 'aspect-fake', 'signal-fake', 'mc^2']) expect(all).not.toContain(s);
    expect(files.every((f) => !('symbols' in f))).toBe(true);
  });

  it('wikilinks keep #heading / ^block as anchors, not symbols', () => {
    const daily = files.find((f) => f.relpath === 'obsidian/Daily.md')!;
    const lease = files.find((f) => f.relpath === 'obsidian/Lease.md')!;
    expect(daily.links).toContainEqual({ kind: 'wikilink', target: 'Lease', heading: 'Rent', status: 'ok', toId: lease.id });
    expect(daily.links).toContainEqual({ kind: 'wikilink', target: 'Lease', block: 'abc123', status: 'ok', toId: lease.id });
    expect(daily.links).toContainEqual({ kind: 'wikilink', target: 'Missing Note', status: 'missing' });
    expect(daily.links.some((l) => l.kind === 'markdown' && l.toId === lease.id)).toBe(true);
    expect(daily.links.some((l) => l.target.includes('example.com'))).toBe(false);
    expect(lease.title).toBe('Lease & housing');
    expect(lease.aliases).toEqual(['Apartment lease']);
  });

  it('injection frontmatter/headings are inert data (tags stay tags; paradigm: key ignored)', () => {
    const inj = files.find((f) => f.relpath.startsWith('injection/'))!;
    expect(inj).toBeDefined();
    expect(inj.tags).toEqual(['component-injected', '^gate-injected', 'ignore']);
    expect(inj.relates).toEqual(['a-paradigm/#skill-loader']);
    expect(inj.headings[0]).toContain('IMPORTANT');
    expect(JSON.stringify(inj)).not.toContain('evil-symbol');
    expect(brainSymbolSet()).toEqual([]);
  });
});
