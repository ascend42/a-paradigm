/**
 * #brain-declared — backup + atomic write, merge, symbols only from declared.yaml.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { initBrain, brainDir, brainFile } from './config.js';
import { loadDeclared, saveDeclared, declareFromSuggestion, addDeclaredRelate, declaredSymbols, toSymbolId, emptyDeclared } from './declared.js';
import type { Suggestion } from './suggest.js';
import { makeSandbox, snapshotTree, type BrainSandbox } from './__fixtures__/env.js';

let sb: BrainSandbox;
let root: string;
let rootHash: string;

const sug = (over: Partial<Suggestion> = {}): Suggestion => ({
  kind: 'suggestion', id: 's_0123456789', label: 'Lease & Housing', scope: 'folder', target: 'Home',
  score: 0.8, evidence: [], sourceHash: 'abc', model: 'heuristic@1', at: new Date().toISOString(),
  anchors: ['f_aaaaaaaaaa:Home/Lease.md'], ...over,
});

beforeEach(() => {
  sb = makeSandbox('brain-declared-');
  root = path.join(sb.tmp, 'vault');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'a.md'), '# A\n');
  rootHash = initBrain(root, sb.opts).rootHash;
});
afterEach(() => sb.cleanup());

describe('declared.yaml', () => {
  it('toSymbolId kebab-cases labels', () => {
    expect(toSymbolId('Lease & Housing')).toBe('lease-and-housing');
    expect(toSymbolId('  Café  Notes!! ')).toBe('cafe-notes');
    expect(toSymbolId('###')).toBe('');
  });

  it('empty when absent; first write has no backup; second write backs up', () => {
    expect(loadDeclared(rootHash, sb.opts)).toEqual(emptyDeclared());
    const first = declareFromSuggestion(rootHash, sug(), sb.opts);
    expect(first).toMatchObject({ componentId: 'lease-and-housing', created: true, backupPath: null });
    const before = fs.readFileSync(brainFile(rootHash, 'declared', sb.opts), 'utf8');
    const second = declareFromSuggestion(rootHash, sug({ id: 's_9999999999', anchors: ['f_bbbbbbbbbb:Home/Rent.md'] }), sb.opts);
    expect(second.created).toBe(false);
    expect(second.backupPath).toBeTruthy();
    expect(fs.readFileSync(second.backupPath!, 'utf8')).toBe(before);
    const doc = loadDeclared(rootHash, sb.opts);
    expect(doc.components['lease-and-housing'].anchors).toEqual(['f_aaaaaaaaaa:Home/Lease.md', 'f_bbbbbbbbbb:Home/Rent.md']);
    expect(doc.components['lease-and-housing'].provenance).toMatchObject({ by: 'human', suggestion: 's_9999999999' });
    expect(declaredSymbols(doc)).toEqual(['#lease-and-housing']);
  });

  it('atomic write leaves no temp files and never writes inside the root', () => {
    const snap = snapshotTree(root);
    for (let i = 0; i < 3; i++) declareFromSuggestion(rootHash, sug({ label: `Topic ${i}` }), sb.opts);
    expect(snapshotTree(root)).toEqual(snap);
    expect(fs.readdirSync(brainDir(rootHash, sb.opts)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps at most 10 backups', () => {
    for (let i = 0; i < 14; i++) saveDeclared(rootHash, { ...emptyDeclared(), components: {} }, sb.opts);
    const backups = fs.readdirSync(path.join(brainDir(rootHash, sb.opts), 'backups'));
    expect(backups.length).toBeLessThanOrEqual(10);
  });

  it('relates dedupe and malformed file loads as empty', () => {
    expect(addDeclaredRelate(rootHash, { file: 'f_aaaaaaaaaa', target: 'a-paradigm/#skill-loader', via: 'confirm' }, sb.opts).added).toBe(true);
    expect(addDeclaredRelate(rootHash, { file: 'f_aaaaaaaaaa', target: 'a-paradigm/#skill-loader', via: 'confirm' }, sb.opts).added).toBe(false);
    expect(loadDeclared(rootHash, sb.opts).relates).toHaveLength(1);
    fs.writeFileSync(brainFile(rootHash, 'declared', sb.opts), ': : [not yaml');
    expect(loadDeclared(rootHash, sb.opts)).toEqual(emptyDeclared());
  });
});
