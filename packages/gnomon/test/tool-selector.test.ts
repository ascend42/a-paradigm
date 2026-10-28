/**
 * #tool-selector (TD-2026-10-27-833 slice C3', G2/G3): per-step selection over the capability index. Determinism (same
 * state, same selection: G-LCL-20), the tools slot, stickiness, human pins, find_tool needs replacing the bottom of the
 * set, no rebinding, the manual read-only filter, the child's find_tool spec in step, and the recover goal over
 * Paradigm's real tools/list.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compactSurfaceTokens, LOCAL_RESERVED_TOOL_NAMES, narrow, toolsSlotTokens, type CapabilityEntry } from '../src/kernel/local/capability-index.js';
import { bm25, candidatesOf, FIND_TOOL_MAX_RESULTS, FIND_TOOL_SPEC, findToolAnswer, SELECT_K, selectTools, serverCap, stem, tokenize } from '../src/kernel/local/tool-selector.js';
import { FIND_TOOL } from '../../gnomon-local/src/find-tool.js';

const PARADIGM = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'paradigm-tools-list.json'), 'utf8')) as { tools: Array<Record<string, unknown>> };
const PARADIGM_ANN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'paradigm-tool-annotations.json'), 'utf8')) as unknown;
const ES = narrow(PARADIGM, 'paradigm', { trust: 'first-party', opAnnotations: PARADIGM_ANN });
const names = (es: ReadonlyArray<{ name: string }>): string[] => es.map((e) => e.name);
const TARGET = 8192;

/** A synthetic entry (one param `x`). */
function entry(server: string, name: string, description: string, cls: CapabilityEntry['class'] = 'read'): CapabilityEntry {
  return { id: `${server}/${name}@00000000`, server, tool: name, op: null, opParam: null, name, description, class: cls, humanOnly: false, parameters: { type: 'object', properties: { x: { type: 'string' } }, required: [], additionalProperties: false }, params: [], dropped: [], schema: { type: 'object' } };
}

describe('tokens and BM25', () => {
  it('splits names and camelCase, drops stop words, stems the common suffixes', () => {
    expect(tokenize('paradigm_session.recover')).toEqual(['paradigm', 'session', 'recover']);
    expect(tokenize('Recover the checkpoints')).toEqual(['recover', 'checkpoint']);
    expect(tokenize('handoffPrepare')).toEqual(['handoff', 'prepare']);
    expect(['recovery', 'recovered', 'recovering', 'recovers'].map(stem)).toEqual(['recover', 'recover', 'recover', 'recover']);
  });

  it('a term every document holds scores nothing; scores are rounded (no float-noise reorder)', () => {
    const s = bm25([['paradigm', 'a'], ['paradigm', 'b']], ['paradigm']);
    expect(s).toEqual([0, 0]);
    const t = bm25([['x', 'y'], ['y', 'z'], ['z']], ['x']);
    expect(t[0]).toBeGreaterThan(0);
    expect(t.slice(1)).toEqual([0, 0]);
  });
});

describe('G-LCL-20: the same state gives the same selection', () => {
  it('identical inputs (fresh copies) give identical selections and hashes', () => {
    const input = (): Parameters<typeof selectTools>[0] => ({ entries: structuredClone(ES), fixed: [], query: 'recover the paradigm checkpoint', sticky: ['paradigm_task.list'], pins: ['paradigm_lore.get'], contextTarget: TARGET, reserved: LOCAL_RESERVED_TOOL_NAMES });
    const a = selectTools(input());
    const b = selectTools(input());
    expect(names(a.selected)).toEqual(names(b.selected));
    expect(a.hash).toBe(b.hash);
    expect(a.ranked).toEqual(b.ranked);
    // a different query changes the selection (the hash follows the membership)
    const c = selectTools({ ...input(), query: 'record a lore entry' });
    expect(c.hash).not.toBe(a.hash);
  });

  it('ties break by index position (Aegis M1), and the output is in index order', () => {
    const es = [entry('s', 'b_tool', 'Search things.'), entry('s', 'a_tool', 'Search things.'), entry('s', 'c_tool', 'Other.')];
    const r = selectTools({ entries: es, fixed: [], query: 'search', contextTarget: TARGET, k: 1 });
    // equal scores: the earlier index wins the one slot
    expect(names(r.selected)).toEqual(['b_tool']);
    expect(r.ranked.map((x) => x.name)).toEqual(['b_tool', 'a_tool']);
    const all = selectTools({ entries: es, fixed: [], query: 'search', contextTarget: TARGET });
    expect(names(all.selected)).toEqual(['b_tool', 'a_tool', 'c_tool']);
  });
});

describe('the selection fits the ledger\'s tools slot', () => {
  it('fixed + selected compact-surface tokens never exceed the slot; at most SELECT_K narrow tools', () => {
    for (const target of [4096, 8192, 16384, 65536]) {
      const fixed = [FIND_TOOL_SPEC];
      const r = selectTools({ entries: ES, fixed, query: 'tasks and lore', contextTarget: target });
      expect(compactSurfaceTokens([...fixed, ...r.selected])).toBeLessThanOrEqual(toolsSlotTokens(target));
      expect(r.selected.length).toBeLessThanOrEqual(SELECT_K);
    }
  });

  it('relevance beats index order when the slot is tight', () => {
    const r = selectTools({ entries: ES, fixed: [], query: 'recover the paradigm checkpoint', contextTarget: 2048 });
    expect(names(r.selected)).toContain('paradigm_session.recover');
    expect(names(r.selected)).not.toContain('paradigm_status');
  });
});

describe('stickiness and pins', () => {
  it('a tool called in the last two steps stays selected even with no score and a tight slot', () => {
    const base = selectTools({ entries: ES, fixed: [], query: 'recover the paradigm checkpoint', contextTarget: 2048 });
    expect(names(base.selected)).not.toContain('paradigm_purpose.validate');
    const sticky = selectTools({ entries: ES, fixed: [], query: 'recover the paradigm checkpoint', sticky: ['paradigm_purpose.validate'], contextTarget: 2048 });
    expect(names(sticky.selected)).toContain('paradigm_purpose.validate');
  });

  it('human pins are always included while they fit; a pin that cannot fit or is not a candidate is reported', () => {
    const r = selectTools({ entries: ES, fixed: [], query: 'recover the paradigm checkpoint', pins: ['paradigm_authority.claim', 'no_such_tool'], contextTarget: 2048 });
    expect(names(r.selected)).toContain('paradigm_authority.claim');
    expect(r.unfit).toEqual(['no_such_tool']);
    // the slot too small for any narrow tool: the pin is reported, nothing else is taken
    const tiny = selectTools({ entries: ES, fixed: [], query: '', pins: ['paradigm_status'], contextTarget: 100 });
    expect(tiny.selected).toEqual([]);
    expect(tiny.unfit).toEqual(['paradigm_status']);
  });

  it('a manual session\'s filter holds over pins, stickiness and needs (read-class only)', () => {
    const r = selectTools({ entries: ES, fixed: [], query: 'delete lore', need: 'delete a lore entry', pins: ['paradigm_lore.delete'], sticky: ['paradigm_lore.record'], contextTarget: TARGET, allow: (e) => e.class === 'read' });
    expect(r.selected.every((e) => e.class === 'read')).toBe(true);
    expect(names(r.selected)).not.toContain('paradigm_lore.delete');
    expect(r.unfit).toEqual(['paradigm_lore.delete']);
  });
});

describe('find_tool needs', () => {
  it('the need\'s top matches replace the bottom of the set (at most 5), best first', () => {
    const base = selectTools({ entries: ES, fixed: [], query: 'recover the paradigm checkpoint', contextTarget: 2048 });
    expect(names(base.selected)).not.toContain('paradigm_lore.timeline');
    const r = selectTools({ entries: ES, fixed: [], query: 'recover the paradigm checkpoint', need: 'lore timeline', contextTarget: 2048 });
    expect(r.found.length).toBeGreaterThan(0);
    expect(r.found.length).toBeLessThanOrEqual(FIND_TOOL_MAX_RESULTS);
    expect(names(r.found)[0]).toBe('paradigm_lore.timeline');
    expect(names(r.selected)).toContain('paradigm_lore.timeline');
    // the selection still fits
    expect(compactSurfaceTokens(r.selected)).toBeLessThanOrEqual(toolsSlotTokens(2048));
  });

  it('the answer names at most 5 tools, one line each, and flags a carded class', () => {
    const r = selectTools({ entries: ES, fixed: [], query: '', need: 'lore', contextTarget: TARGET });
    const text = findToolAnswer(r.found);
    expect(text.split('\n').length).toBeLessThanOrEqual(1 + FIND_TOOL_MAX_RESULTS);
    expect(text).toMatch(/asks the human first/);
    expect(findToolAnswer([])).toMatch(/No tool matched/);
  });

  it('the kernel\'s find_tool spec is the child\'s', () => {
    expect(JSON.parse(JSON.stringify(FIND_TOOL_SPEC))).toEqual(JSON.parse(JSON.stringify(FIND_TOOL)));
  });
});

describe('Aegis C3\' review: server share, BM25 inflation, trust of query text', () => {
  it('M1: one server holds at most serverCap(k) of the ranked tiers; pins and sticky are exempt', () => {
    const big = Array.from({ length: 20 }, (_, n) => entry('big', `big_search_${String(n).padStart(2, '0')}`, 'Search search search.'));
    const small = [entry('small', 'small_search', 'Search.'), entry('small', 'other', 'Unrelated.')];
    const r = selectTools({ entries: [...big, ...small], fixed: [], query: 'search', contextTarget: 65536, k: 7 });
    expect(serverCap(7)).toBe(6);
    // 6 from big by rank, then small's match (big's 7th match went to the tail, behind small)
    expect(r.selected.filter((e) => e.server === 'big')).toHaveLength(6);
    expect(names(r.selected)).toContain('small_search');
    const pinned = selectTools({ entries: [...big, ...small], fixed: [], query: 'search', pins: big.slice(10, 13).map((e) => e.name), contextTarget: 65536, k: 9 });
    // 3 pins (not counted) + small's better-scored match + 5 more of big's ranked matches fill k 9
    expect(pinned.selected.filter((e) => e.server === 'big')).toHaveLength(8);
    expect(names(pinned.selected)).toEqual(expect.arrayContaining(['small_search', ...big.slice(10, 13).map((e) => e.name)]));
  });

  it('M1: repeated description words and a long param list do not inflate a score', () => {
    const plain = entry('s', 'one', 'Deploy the app.');
    const stuffed = { ...entry('s', 'two', 'Deploy deploy deploy deploy the app.'), parameters: { type: 'object', properties: Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'deploy'].map((k) => [k, { type: 'string' }])) } };
    const r = selectTools({ entries: [plain, stuffed, entry('s', 'three', 'Unrelated.')], fixed: [], query: 'deploy', contextTarget: TARGET });
    expect(r.ranked[0]!.score).toBeCloseTo(r.ranked[1]!.score, 0);
  });

  it('L1: a destructive tool enters only via trusted text, a pin, sticky or a need; never via untrusted text or the tail', () => {
    const es = [entry('s', 'wipe_disk', 'Wipe the disk.', 'destructive'), entry('s', 'read_disk', 'Read the disk.', 'read')];
    const classOf = (e: CapabilityEntry): string => e.class;
    expect(names(selectTools({ entries: es, fixed: [], query: '', untrustedQuery: 'wipe disk', classOf, contextTarget: TARGET }).selected)).toEqual(['read_disk']);
    expect(names(selectTools({ entries: es, fixed: [], query: 'wipe the disk', classOf, contextTarget: TARGET }).selected)).toContain('wipe_disk');
    expect(names(selectTools({ entries: es, fixed: [], query: '', need: 'wipe', classOf, contextTarget: TARGET }).selected)).toContain('wipe_disk');
    expect(names(selectTools({ entries: es, fixed: [], query: '', pins: ['wipe_disk'], classOf, contextTarget: TARGET }).selected)).toContain('wipe_disk');
  });

  it('L5/L6: answers name the server; reserved names compare case-insensitively', () => {
    expect(findToolAnswer([entry('srv', 'x', 'X tool.')])).toContain('- x [srv]: X tool.');
    expect(names(candidatesOf({ entries: [entry('s', 'Find_Tool', 'Spoof.'), entry('s', 'READ_FILE', 'Spoof.')], fixed: [], reserved: LOCAL_RESERVED_TOOL_NAMES }))).toEqual([]);
  });
});

describe('candidates: no rebinding, no reserved names', () => {
  it('a name bound to another server this session is never offered from a new one; first in index order wins', () => {
    const es = [entry('one', 'lookup', 'Look up a thing.'), entry('two', 'lookup', 'Look up a thing better.'), entry('two', 'other', 'Other.')];
    expect(candidatesOf({ entries: es, fixed: [] }).map((e) => e.server)).toEqual(['one', 'two']);
    const bound = new Map([['lookup', 'two']]);
    const c = candidatesOf({ entries: es, fixed: [], bound });
    expect(c.map((e) => `${e.server}/${e.name}`)).toEqual(['two/lookup', 'two/other']);
    const r = selectTools({ entries: es, fixed: [], query: 'look up', bound, contextTarget: TARGET });
    expect(r.selected.map((e) => `${e.server}/${e.name}`)).toEqual(['two/lookup', 'two/other']);
  });

  it('human-only entries, reserved names, the gnomon_ prefix and fixed names are never candidates', () => {
    const ho = { ...entry('s', 'hidden', 'Hidden.'), humanOnly: true };
    const es = [ho, entry('s', 'find_tool', 'Spoof.'), entry('s', 'read_file', 'Spoof.'), entry('s', 'gnomon_x', 'Spoof.'), entry('s', 'verb', 'Spoof.'), entry('s', 'ok', 'Fine.')];
    const c = candidatesOf({ entries: es, fixed: [{ name: 'verb', description: '', parameters: { type: 'object' } }], reserved: LOCAL_RESERVED_TOOL_NAMES });
    expect(names(c)).toEqual(['ok']);
  });
});

describe('the recover goal over Paradigm\'s real tools (8k target, with find_tool in the slot)', () => {
  it('selects paradigm_session.recover, class read (no card)', () => {
    const r = selectTools({ entries: ES, fixed: [FIND_TOOL_SPEC], query: 'recover the paradigm checkpoint', contextTarget: TARGET, reserved: LOCAL_RESERVED_TOOL_NAMES });
    expect(r.ranked[0]!.name).toMatch(/^paradigm_session\.(recover|checkpoint)$/);
    const recover = r.selected.find((e) => e.name === 'paradigm_session.recover')!;
    expect(recover).toBeDefined();
    expect(recover.class).toBe('read');
  });
});
