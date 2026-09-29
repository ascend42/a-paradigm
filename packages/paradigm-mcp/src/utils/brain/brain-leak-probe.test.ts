/**
 * Leak probes through the view choke point (agent + owner audiences).
 * Pass criterion: zero gated-content leaks across ≥100 probe queries.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { initBrain, addShare, setAgentAccess, brainFile } from './config.js';
import { openBrainView, scanBrain, BrainLeakError } from './view.js';
import { readEgress } from './egress.js';
import { createLeakProbeCorpus, leakProbeQueries, findLeaks, type LeakProbeCorpus } from './leak-probe.js';
import { makeSandbox, type BrainSandbox } from './__fixtures__/env.js';
import type { Audience, BrainView } from './types.js';

let sb: BrainSandbox;
let corpus: LeakProbeCorpus;
let rootHash: string;
let allIds: string[];

function probeAll(view: BrainView, queries: string[]): unknown[] {
  const outputs: unknown[] = [view.summary(), view.files(), view.folders(), view.lockedZones()];
  for (const q of queries) {
    outputs.push(view.search(q, 100));
    outputs.push(view.get(q) ?? null);
  }
  return outputs;
}

beforeAll(() => {
  sb = makeSandbox('brain-leak-');
  const root = path.join(sb.tmp, 'Notes-root');
  fs.mkdirSync(root);
  corpus = createLeakProbeCorpus(root);
  rootHash = initBrain(root, sb.opts).rootHash;
  addShare(rootHash, corpus.shareGlob, sb.opts);
  scanBrain(rootHash, sb.opts);
  // Enumerate every id (incl. hidden) straight from disk — the probes try them all.
  const idx = JSON.parse(fs.readFileSync(brainFile(rootHash, 'index', sb.opts), 'utf8'));
  allIds = idx.records.map((r: { id: string }) => r.id);
});
afterAll(() => sb.cleanup());

describe('leak probes', () => {
  it('generates ≥100 probe queries', () => {
    expect(leakProbeQueries(corpus, allIds).length).toBeGreaterThanOrEqual(100);
  });

  it('corpus is gated as intended (sanity)', () => {
    const owner = openBrainView(rootHash, 'owner', sb.opts);
    const zones = owner.lockedZones();
    const gates = new Set(zones.map((z) => z.gate));
    expect(gates.has('medical')).toBe(true);
    expect(gates.has('financial')).toBe(true);
    expect(gates.has('quarantined')).toBe(true);
    expect(gates.has('third-party-data')).toBe(true);
    expect(zones.reduce((n, z) => n + z.count, 0)).toBe(corpus.gatedRelpaths.length);
    expect(owner.files().map((f) => f.relpath)).toEqual(expect.arrayContaining(corpus.privateRelpaths));
  });

  it('agent with agent_access: off sees nothing and still logs egress', () => {
    const v = openBrainView(rootHash, 'agent', sb.opts);
    expect(v.enabled).toBe(false);
    expect(v.files()).toEqual([]);
    expect(v.search('Welcome')).toEqual([]);
    v.respond('status', [], { ok: true });
    expect(readEgress(rootHash, sb.opts).length).toBeGreaterThan(0);
  });

  for (const audience of ['agent', 'owner'] as Audience[]) {
    it(`${audience}: zero leaks across all probes`, () => {
      setAgentAccess(rootHash, 'metadata', sb.opts);
      const view = openBrainView(rootHash, audience, sb.opts);
      const queries = leakProbeQueries(corpus, allIds);
      const outputs = probeAll(view, queries);
      const forbidden = corpus.forbiddenFor(audience);
      expect(findLeaks(outputs, forbidden)).toEqual([]);
      // Through respond(): the agent path appends egress rows that must also be clean.
      for (const q of queries) {
        const hits = view.search(q, 100);
        view.respond('search', hits.map((h) => h.file.id), hits.map((h) => ({ id: h.file.id, title: h.file.title, relpath: h.file.relpath, headings: h.file.headings })));
      }
      const egressText = fs.existsSync(brainFile(rootHash, 'egress', sb.opts))
        ? fs.readFileSync(brainFile(rootHash, 'egress', sb.opts), 'utf8') : '';
      expect(findLeaks(egressText, forbidden)).toEqual([]);
    });
  }

  it('agent sees only shared (open) files', () => {
    const v = openBrainView(rootHash, 'agent', sb.opts);
    expect(v.files().every((f) => f.relpath.startsWith('Public/') && f.gate === 'open')).toBe(true);
    expect(v.files().length).toBe(3);
    expect(v.summary().locked).toBe(0);
    expect(v.lockedZones()).toEqual([]);
  });

  it('links to hidden files: agent sees them exactly like broken links; owner sees [private]', () => {
    const agent = openBrainView(rootHash, 'agent', sb.opts);
    const welcome = agent.files().find((f) => f.relpath === 'Public/Welcome.md')!;
    expect(welcome.links.some((l) => l.status === 'hidden')).toBe(false);
    const unresolved = welcome.links.filter((l) => l.status !== 'ok');
    expect(unresolved.length).toBeGreaterThanOrEqual(3);
    // hidden and missing are indistinguishable: same status, same fixed target, no heading/block
    expect(unresolved.every((l) => l.status === 'missing' && l.target === '[missing]' && !l.heading && !l.block)).toBe(true);
    const owner = openBrainView(rootHash, 'owner', sb.opts);
    const ow = owner.files().find((f) => f.relpath === 'Public/Welcome.md')!;
    expect(ow.links.filter((l) => l.status === 'hidden').length).toBe(2); // private journal now visible
  });

  it('hidden files do not contribute inbound counts', () => {
    const owner = openBrainView(rootHash, 'owner', sb.opts);
    const welcome = owner.files().find((f) => f.relpath === 'Public/Welcome.md')!;
    // Lease + private journal link to Welcome; the medical checkup (also linking) is hidden.
    expect(welcome.inbound).toBe(2);
  });

  it('respond() fails closed if a payload references a gated path', () => {
    const v = openBrainView(rootHash, 'agent', sb.opts);
    expect(() => v.respond('search', [], { leaked: corpus.gatedRelpaths[0] })).toThrow(BrainLeakError);
    expect(() => v.respond('search', [], { leaked: corpus.privateRelpaths[0] })).toThrow(BrainLeakError);
  });
});
