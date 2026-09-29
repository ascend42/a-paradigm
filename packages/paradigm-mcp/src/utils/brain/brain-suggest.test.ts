/**
 * #brain-suggest — deterministic heuristics, batching, verdicts, staleness,
 * acceptance arithmetic and the suggestions feature flag.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { initBrain } from './config.js';
import { scanBrain, openBrainView } from './view.js';
import {
  generateCandidates, nextSuggestions, recordVerdict, readSuggestionLog, acceptanceStats, computeAcceptance,
  decideSuggestions, suggestionsState, setSuggestionsMode, staleSuggestions, folderLabel, SuggestionError,
  type VerdictRow,
} from './suggest.js';
import { loadDeclared } from './declared.js';
import { makeSandbox, type BrainSandbox } from './__fixtures__/env.js';

let sb: BrainSandbox;
let root: string;
let rootHash: string;

function w(rel: string, text: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function corpus() {
  w('2024 Recipes/Pasta.md', '---\ntags: [cooking]\n---\n# Pasta sauce basics\n');
  w('2024 Recipes/Soup.md', '---\ntags: [cooking]\n---\n# Tomato soup\n## Sauce basics\n');
  w('2024 Recipes/Bread.md', '---\ntags: [cooking, baking]\n---\n# Bread\n## Sauce basics for dipping\n');
  w('Travel/Japan.md', '---\ntags: [trip]\n---\n# Japan\n[[Packing List]]\n');
  w('Travel/Italy.md', '---\ntags: [trip]\n---\n# Italy\n[[Packing List]]\n');
  w('Travel/Packing List.md', '# Packing List\n');
  w('Journal/Day1.md', '# Day one\n[[Packing List]]\n');
  w('Journal/Day2.md', '# Day two\n');
  w('Health/Blood.md', '---\ntags: [cooking]\n---\n# Blood sauce basics\n');
  w('Health/Other.md', '# Other\n');
  w('Health/Third.md', '# Third\n');
}

beforeEach(() => {
  sb = makeSandbox('brain-suggest-');
  root = path.join(sb.tmp, 'vault');
  fs.mkdirSync(root);
  corpus();
  rootHash = initBrain(root, sb.opts).rootHash;
  scanBrain(rootHash, sb.opts);
});
afterEach(() => sb.cleanup());

describe('heuristics', () => {
  it('folderLabel strips dates, numbering and stopwords', () => {
    expect(folderLabel('2024 Recipes')).toBe('Recipes');
    expect(folderLabel('10-19 Finance_admin')).toBe('Finance Admin');
    expect(folderLabel('01 Inbox')).toBe('');
    expect(folderLabel('misc-notes')).toBe('');
    expect(folderLabel('2023-04-01')).toBe('');
  });

  it('produces folder / tag / n-gram / hub candidates deterministically, folder scope first', () => {
    const view = openBrainView(rootHash, 'owner', sb.opts);
    const a = generateCandidates(view, undefined, 'T');
    const b = generateCandidates(view, undefined, 'T');
    expect(a).toEqual(b);
    const labels = a.map((s) => s.label);
    expect(labels).toEqual(expect.arrayContaining(['Recipes', 'Travel', 'Journal', 'Cooking', 'Trip', 'Sauce Basics', 'Packing List']));
    const types = new Set(a.flatMap((s) => s.evidence.map((e) => e.type)));
    for (const t of ['folder-name', 'tag', 'ngram', 'hub']) expect(types.has(t as never)).toBe(true);
    const firstFile = a.findIndex((s) => s.scope === 'file');
    expect(a.slice(firstFile).every((s) => s.scope === 'file')).toBe(true);
    for (const s of a) {
      expect(s.model).toBe('heuristic@1');
      expect(s.id).toMatch(/^s_[0-9a-f]{10}$/);
      expect(s.score).toBeGreaterThan(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(s.evidence.length).toBeGreaterThan(0);
    }
  });

  it('never suggests from sensitive zones', () => {
    const all = generateCandidates(openBrainView(rootHash, 'owner', sb.opts));
    const json = JSON.stringify(all);
    expect(json).not.toContain('Health');
    expect(json).not.toContain('Blood');
    expect(all.find((s) => s.label === 'Health')).toBeUndefined();
  });

  it('n-gram needs ≥3 files in one folder; hub needs in-degree ≥3', () => {
    const all = generateCandidates(openBrainView(rootHash, 'owner', sb.opts));
    const sauce = all.find((s) => s.label === 'Sauce Basics')!;
    expect(sauce.scope).toBe('folder');
    expect(sauce.target).toBe('2024 Recipes');
    expect(sauce.anchors).toHaveLength(3);
    const hub = all.find((s) => s.label === 'Packing List')!;
    expect(hub.evidence.some((e) => e.type === 'hub')).toBe(true);
    // Travel "Tomato"/"Day" never reach 3 files
    expect(all.find((s) => s.label === 'Day')).toBeUndefined();
  });
});

describe('suggest → confirm loop', () => {
  it('batches ≤10, logs rows, and does not re-log unchanged suggestions', () => {
    for (let i = 0; i < 14; i++) w(`Topic ${String.fromCharCode(65 + i)}${String.fromCharCode(65 + i)}x/a.md`, '# a\n'), w(`Topic ${String.fromCharCode(65 + i)}${String.fromCharCode(65 + i)}x/b.md`, '# b\n');
    scanBrain(rootHash, sb.opts);
    const b1 = nextSuggestions(rootHash, sb.opts);
    expect(b1.suggestions.length).toBe(10);
    expect(b1.remaining).toBeGreaterThan(0);
    expect(b1.suggestions.every((s) => s.scope === 'folder')).toBe(true);
    const rows1 = readSuggestionLog(rootHash, sb.opts).suggestions.size;
    nextSuggestions(rootHash, sb.opts);
    expect(readSuggestionLog(rootHash, sb.opts).suggestions.size).toBe(rows1);
    expect(nextSuggestions(rootHash, { ...sb.opts, limit: 3 }).suggestions).toHaveLength(3);
  });

  it('accept writes declared.yaml; reject suppresses; skip only defers; symbols come only from declared', () => {
    const batch = nextSuggestions(rootHash, sb.opts).suggestions;
    const recipes = batch.find((s) => s.label === 'Recipes')!;
    const travel = batch.find((s) => s.label === 'Travel')!;
    const journal = batch.find((s) => s.label === 'Journal')!;
    const r = recordVerdict(rootHash, recipes.id, 'accept', sb.opts);
    expect(r.declared?.componentId).toBe('recipes');
    recordVerdict(rootHash, travel.id, 'reject', sb.opts);
    recordVerdict(rootHash, journal.id, 'skip', sb.opts);
    expect(Object.keys(loadDeclared(rootHash, sb.opts).components)).toEqual(['recipes']);
    const next = nextSuggestions(rootHash, sb.opts).suggestions.map((s) => s.id);
    expect(next).not.toContain(recipes.id);
    expect(next).not.toContain(travel.id);
    // Skip is "not now", not "never": it comes back, behind everything not skipped.
    expect(next).toContain(journal.id);
    expect(next[next.length - 1]).toBe(journal.id);
    expect(acceptanceStats(rootHash, sb.opts)).toMatchObject({ accept: 1, reject: 1, skip: 1, decided: 2, acceptance: 0.5 });
  });

  it('skip defers to the back of the queue, never removes', () => {
    for (let i = 0; i < 14; i++) w(`Topic ${String.fromCharCode(65 + i)}${String.fromCharCode(65 + i)}x/a.md`, '# a\n'), w(`Topic ${String.fromCharCode(65 + i)}${String.fromCharCode(65 + i)}x/b.md`, '# b\n');
    scanBrain(rootHash, sb.opts);
    const b1 = nextSuggestions(rootHash, sb.opts).suggestions;
    for (const s of b1) recordVerdict(rootHash, s.id, 'skip', sb.opts);
    const b2 = nextSuggestions(rootHash, sb.opts);
    // The next batch leads with suggestions that were not skipped …
    expect(b2.suggestions.some((s) => b1.some((x) => x.id === s.id))).toBe(false);
    // … and the skipped ones are still waiting.
    expect(b2.remaining).toBeGreaterThanOrEqual(b1.length);
    expect(staleSuggestions(rootHash, sb.opts)).toEqual([]);
  });

  it('non-numeric limit falls back to the default batch size', () => {
    expect(nextSuggestions(rootHash, { ...sb.opts, limit: Number.NaN }).suggestions.length).toBeGreaterThan(0);
    expect(nextSuggestions(rootHash, { ...sb.opts, limit: Number.POSITIVE_INFINITY }).suggestions.length).toBeGreaterThan(0);
  });

  it('near-duplicate labels (Recipe / Recipes) for the same folder collapse to the higher score', () => {
    // Only this folder may produce the label (labels merge across folders first).
    fs.rmSync(path.join(root, '2024 Recipes'), { recursive: true, force: true });
    w('Recipes/Pasta.md', '# Recipe: pasta\n');
    w('Recipes/Soup.md', '# Recipe: soup\n');
    w('Recipes/Bread.md', '# Recipe: bread\n');
    scanBrain(rootHash, sb.opts);
    const all = generateCandidates(openBrainView(rootHash, 'owner', sb.opts));
    const forFolder = all.filter((s) => s.scope === 'folder' && s.target === 'Recipes' && /^recipes?$/i.test(s.label));
    expect(forFolder).toHaveLength(1);
    // Both heuristics' evidence survives on the kept suggestion.
    const types = forFolder[0].evidence.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['folder-name', 'ngram']));
  });

  it('unknown id → not-found', () => {
    expect(() => recordVerdict(rootHash, 's_ffffffffff', 'accept', sb.opts)).toThrow(SuggestionError);
  });

  it('sourceHash staleness: changed sources block accept and re-surface rejected suggestions', () => {
    const batch = nextSuggestions(rootHash, sb.opts).suggestions;
    const travel = batch.find((s) => s.label === 'Travel')!;
    const recipes = batch.find((s) => s.label === 'Recipes')!;
    recordVerdict(rootHash, travel.id, 'reject', sb.opts);
    expect(staleSuggestions(rootHash, sb.opts)).toEqual([]);
    const journal = batch.find((s) => s.label === 'Journal')!;
    w('Travel/Japan.md', '---\ntags: [trip]\n---\n# Japan (edited)\n[[Packing List]]\n');
    w('2024 Recipes/Pasta.md', '---\ntags: [cooking]\n---\n# Pasta sauce basics v2\n');
    scanBrain(rootHash, sb.opts);
    w('Journal/Day2.md', '# Day two (edited)\n');
    scanBrain(rootHash, sb.opts);
    const stale = staleSuggestions(rootHash, sb.opts).map((s) => s.id);
    expect(stale).toEqual(expect.arrayContaining([recipes.id, journal.id]));
    // A rejected suggestion is decided, so it can never be "stale".
    expect(stale).not.toContain(travel.id);
    expect(() => recordVerdict(rootHash, recipes.id, 'accept', sb.opts)).toThrow(/out of date/);
    const again = nextSuggestions(rootHash, sb.opts).suggestions;
    const t2 = again.find((s) => s.id === travel.id);
    expect(t2).toBeTruthy();
    expect(t2!.sourceHash).not.toBe(travel.sourceHash);
    // After re-suggesting, the fresh row can be accepted.
    expect(recordVerdict(rootHash, recipes.id, 'accept', sb.opts).declared?.componentId).toBe('recipes');
  });
});

describe('acceptance + feature flag', () => {
  const v = (id: string, verdict: VerdictRow['verdict']): VerdictRow => ({ kind: 'verdict', suggestionId: id, verdict, at: 'x' });

  it('arithmetic: accept/(accept+reject), latest verdict per id, null when undecided', () => {
    expect(computeAcceptance([]).acceptance).toBeNull();
    expect(computeAcceptance([v('a', 'skip')]).acceptance).toBeNull();
    expect(computeAcceptance([v('a', 'accept'), v('b', 'accept'), v('c', 'reject')]).acceptance).toBeCloseTo(2 / 3);
    expect(computeAcceptance([v('a', 'reject'), v('a', 'accept')])).toMatchObject({ accept: 1, reject: 0, acceptance: 1 });
    const s = computeAcceptance([v('a', 'accept'), v('b', 'reject'), v('c', 'reject'), v('d', 'skip')]);
    expect(s).toEqual({ accept: 1, reject: 2, skip: 1, decided: 3, acceptance: 1 / 3 });
  });

  it('auto mode turns suggestions off below 60% after ≥10 decided verdicts', () => {
    const low = computeAcceptance(Array.from({ length: 10 }, (_, i) => v(`s${i}`, i < 5 ? 'accept' : 'reject')));
    expect(decideSuggestions('auto', low)).toMatchObject({ enabled: false, paused: true });
    const ok = computeAcceptance(Array.from({ length: 10 }, (_, i) => v(`s${i}`, i < 6 ? 'accept' : 'reject')));
    expect(decideSuggestions('auto', ok).enabled).toBe(true);
    const early = computeAcceptance([v('a', 'reject'), v('b', 'reject')]);
    expect(decideSuggestions('auto', early)).toMatchObject({ enabled: true, reason: 'still measuring' });
    expect(decideSuggestions('on', low).enabled).toBe(true);
    expect(decideSuggestions('off', ok)).toMatchObject({ enabled: false, paused: false });
  });

  it('flag persists per brain; off → empty batch', () => {
    expect(suggestionsState(rootHash, sb.opts).mode).toBe('auto');
    setSuggestionsMode(rootHash, 'off', sb.opts);
    expect(suggestionsState(rootHash, sb.opts)).toMatchObject({ mode: 'off', enabled: false });
    expect(nextSuggestions(rootHash, sb.opts).suggestions).toEqual([]);
    setSuggestionsMode(rootHash, 'on', sb.opts);
    expect(nextSuggestions(rootHash, sb.opts).suggestions.length).toBeGreaterThan(0);
  });
});
