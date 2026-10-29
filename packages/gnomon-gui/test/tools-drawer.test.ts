/**
 * #gui-capability-browser (slice C6'b1): the "Tools and memory" drawer's pure core. Every state and its words, the
 * refusal and pin-why mapping (no raw kernel code anywhere), the Now offered words, the server rows, the All tools
 * filter and folds, the memory groups and the delete confirm, the Settings kept-memory rows, the toast and header meta.
 */
import { describe, expect, it } from 'vitest';
import {
  availabilityWord,
  capabilitiesOf,
  CLASS_WORD,
  countsWords,
  drawerAccess,
  drawerMeta,
  emptyKeptUi,
  emptyMemoryUi,
  entryLabel,
  fitWords,
  isYours,
  keptOf,
  keptRows,
  mcpFailToastOf,
  memoryDeleteRequest,
  memoryOf,
  memoryView,
  notesLine,
  offeredWord,
  pinKeyOf,
  pinLive,
  pinRequest,
  pinWhyWords,
  refusalWords,
  restartRequest,
  selectionHintsOf,
  serverRow,
  serversOffOf,
  serversOffText,
  shortCause,
  toolsView,
  TOOLS_COPY,
  type CapTool,
  type DrawerUi,
  type MemEntry,
} from '../src/core/tools-drawer.js';

const H = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const tool = (o: Partial<CapTool> & { name: string }): Record<string, unknown> => ({ id: `fs/${o.name}@0123abcd`, server: 'fs', class: 'read', humanOnly: false, availability: 'offered', description: `${o.name} things`, params: [], ...o });
/** a kernel capabilities answer (local-session.ts #capabilities) */
const answer = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  hsid: H,
  generation: 4,
  tier: 2,
  k: 12,
  surface: 'compact',
  mode: 'ask',
  verbs: [{ name: 'gnomon_edit', class: 'mutate' }],
  servers: [{ label: 'fs', trust: 'enabled', state: 'running', starts: 1, counts: { read: 3, mutate: 1, destructive: 0 } }],
  pins: [{ name: 'grep', offered: true }],
  tools: [tool({ name: 'grep' }), tool({ name: 'glob' }), tool({ name: 'write', class: 'mutate', availability: 'findable' }), tool({ name: 'rm', class: 'destructive', availability: 'slash-only', humanOnly: true })],
  ...o,
});
const ui = (o: Partial<DrawerUi> = {}): DrawerUi => ({ hsid: H, title: 'fix the build', access: 'owner', seg: 'tools', phase: 'loaded', caps: capabilitiesOf(answer(), H), updatedAt: null, filter: '', folds: new Map(), pinBusy: null, restarting: new Set(), serverResult: null, pinResult: null, memory: emptyMemoryUi(), ...o });
/** every string a view holds (to prove no raw code leaks) */
const texts = (v: unknown): string => JSON.stringify(v);
const RAW = /over-k|over k|no-room|no-full-form|over-slot|not-offerable|tier-0|remote-refused|launch-writable|label-reserved|pin-mismatch|trust-changed|manual-reads-only|slash-only|not-at-tier/;

describe('#gui-capability-browser: words', () => {
  it('class is a word, never a hue; availability is a word', () => {
    expect(CLASS_WORD).toEqual({ read: 'reads', mutate: 'changes', destructive: 'can’t be undone' });
    expect(availabilityWord('offered', 2)).toBe('offered now');
    expect(availabilityWord('findable', 2)).toBe('findable');
    expect(availabilityWord('slash-only', 2)).toBe('/ only');
    expect(availabilityWord('not-at-tier', 1)).toBe('not at tier 1');
    expect(availabilityWord('manual-reads-only', 2)).toBe('manual mode: reads only');
  });
  it('pin whys: every code (the capabilities\' and the selector\'s the tier preview carries) is words, never the code', () => {
    const at = { tier: 1, k: 4 };
    expect(pinWhyWords('over-k', at)).toBe('waits: tier 1 offers 4 tools');
    expect(pinWhyWords('no-room', at)).toBe('no room in its tool space');
    expect(pinWhyWords('over-slot', at)).toBe('no room in its tool space');
    expect(pinWhyWords('no-full-form', at)).toBe('this tier can’t show its arguments');
    expect(pinWhyWords('not-offerable', at)).toBe('this tier can’t show its arguments');
    expect(pinWhyWords('tier-0', at)).toBe('tier 0 has no tools');
    expect(pinWhyWords('something-new', at)).toBe('not offered at this tier');
    expect(pinWhyWords(null, at)).not.toMatch(RAW);
  });
  it('refusals in plain words, each with a next: step; pin-mismatch has the Stage key', () => {
    expect(fitWords('remote-refused')).toEqual({ text: 'local sessions only reach servers on this Mac', next: 'run it on this Mac and turn that copy on in Settings' });
    expect(fitWords('launch-writable').text).toBe('it runs from a folder this session can edit');
    expect(fitWords('label-reserved').text).toBe('another server has this name');
    expect(fitWords('pin-mismatch')).toEqual({ text: 'Paradigm isn’t staged', next: 'Stage in Settings', key: 'stage' });
    expect(fitWords('disabled')).toEqual({ text: 'it was turned off in Settings after this session opened', next: 'open a new session' });
    expect(fitWords('trust-changed')).toEqual({ text: 'its trust changed', next: 'open a new session' });
    for (const f of ['remote-refused', 'launch-writable', 'label-reserved', 'pin-mismatch', 'disabled', 'trust-changed', 'zzz', null]) {
      const w = fitWords(f);
      expect(w.next.length).toBeGreaterThan(0);
      expect(texts(w.text)).not.toMatch(RAW);
    }
  });
  it('refusalWords: restart refused by fit, busy, not-found, a dropped connection; never the code', () => {
    expect(refusalWords('restart', { reason: 'refused', data: { fit: 'disabled' } })).toBe('Not restarted: it was turned off in Settings after this session opened · next: open a new session');
    expect(refusalWords('restart', { reason: 'busy', data: null })).toMatch(/^Not restarted: it is already starting · next:/);
    expect(refusalWords('pin', { reason: 'full', data: null })).toBe('Not pinned: 8 pins: unpin one first');
    expect(refusalWords('delete', { reason: 'not-found', data: null })).toMatch(/^Not deleted: Gnomon holds no memory for this session any more · next:/);
    expect(refusalWords('delete', null)).toMatch(/^Not deleted: nothing was sent, the connection dropped · next:/);
    expect(refusalWords('pin', { reason: 'bad-params', data: null })).toBe('Not pinned: the kernel refused it · next: close this and try again');
    for (const r of ['refused', 'busy', 'full', 'not-found', 'bad-params', 'FORBIDDEN']) expect(refusalWords('restart', { reason: r, data: { fit: 'pin-mismatch' } })).not.toMatch(/bad-params|FORBIDDEN|pin-mismatch/);
  });
  it('the pin live line', () => {
    expect(pinLive('grep', true, { name: 'grep', offered: true, why: null }, { tier: 2, k: 12 })).toBe('Pinned grep; offered from the next step');
    expect(pinLive('grep', true, { name: 'grep', offered: false, why: 'over-k' }, { tier: 1, k: 4 })).toBe('Pinned grep; waits: tier 1 offers 4 tools');
    expect(pinLive('grep', false, null, { tier: 2, k: 12 })).toBe('Unpinned grep');
  });
});

describe('#gui-capability-browser: the kernel answer', () => {
  it('shape-checks; another session or a malformed answer is null; untrusted text goes through displayText', () => {
    expect(capabilitiesOf(answer(), H)?.generation).toBe(4);
    expect(capabilitiesOf(answer({ hsid: 'hsid:v1:other' }), H)).toBeNull();
    expect(capabilitiesOf(answer({ generation: -1 }), H)).toBeNull();
    expect(capabilitiesOf(answer({ tools: 'x' }), H)).toBeNull();
    const bidi = capabilitiesOf(answer({ servers: [{ label: 'fs‮evil', trust: 'enabled', state: 'running', starts: 1, counts: {} }], tools: [tool({ name: 'grep', description: 'a‮b', server: 'fs‮evil' })] }), H)!;
    expect(bidi.servers[0]!.label).not.toContain('‮');
    expect(bidi.tools[0]!.description).not.toContain('‮');
    expect(bidi.tools[0]!.server).not.toContain('‮');
    // an unknown class, availability or state drops that entry (never shown raw)
    const odd = capabilitiesOf(answer({ tools: [tool({ name: 'a', class: 'weird' as never }), tool({ name: 'b', availability: 'soon' as never })], servers: [{ label: 'x', state: 'dreaming' }] }), H)!;
    expect(odd.tools).toEqual([]);
    expect(odd.servers).toEqual([]);
  });
  it('memory entries, cleaned; another session is null', () => {
    const m = memoryOf({ hsid: H, live: true, entries: [{ id: 'wm-1', kind: 'goal', source: 'human', text: 'fix it', at: 'x', pinned: true }, { id: 'wm-2', kind: 'bogus', source: 'model', text: 'x' }] }, H)!;
    expect(m.entries.map((e) => e.id)).toEqual(['wm-1']);
    expect(memoryOf({ hsid: 'other', entries: [] }, H)).toBeNull();
  });
});

describe('#gui-capability-browser: the Tools segment in every state', () => {
  it('reading, unreachable, unreadable, not the owner, ended', () => {
    expect(toolsView(ui({ phase: 'reading', caps: null })).notice).toEqual({ text: 'Reading this session’s tools…' });
    expect(toolsView(ui({ phase: 'unreachable', caps: null })).notice).toMatchObject({ text: TOOLS_COPY.unreachable, fail: true, key: { act: 'again', label: 'Read again' } });
    expect(toolsView(ui({ phase: 'unreadable', caps: null })).notice?.key?.act).toBe('again');
    expect(toolsView(ui({ access: 'not-owner' })).notice?.text).toBe('Only the person who opened this session can see its tools.');
    expect(toolsView(ui({ access: 'not-owner' })).sections).toEqual([]);
    expect(toolsView(ui({ access: 'ended' }))).toMatchObject({ notice: { text: TOOLS_COPY.ended, key: { act: 'seg-memory' } }, sections: [], all: null });
  });
  it('loaded: Now offered · tier 2 · n of k with pinned/found/recent/ranked; Pins · n of 8; Servers; All tools', () => {
    const v = toolsView(ui(), { found: new Set(['fs/glob@0123abcd']), recent: new Set() });
    expect(v.notice).toBeNull();
    expect(v.sections.map((s) => s.title)).toEqual(['Now offered · tier 2 · 2 of 12', 'Pins · 1 of 8', 'Servers']);
    expect(v.sections[0]!.rows.map((r) => (r.kind === 'readonly' ? `${r.label}: ${r.value}` : ''))).toEqual(['grep: fs · pinned', 'glob: fs · found']);
    expect(v.all?.title).toBe('All tools · 5');
    expect(v.all?.groups.map((g) => g.label)).toEqual(['Gnomon', 'fs']); // Gnomon's own verbs first
    // Mika #6: a Gnomon verb repeats no description (its group heading says Gnomon)
    expect(v.all?.groups[0]!.rows[0]).toMatchObject({ name: 'gnomon_edit', description: '' });
    expect(v.all?.groups[1]!.rows.map((r) => r.meta)).toEqual(['reads · offered now · results: not chosen', 'reads · offered now · results: not chosen', 'changes · findable · results: not chosen', 'can’t be undone · / only · results: not chosen']);
    expect(texts(v)).not.toMatch(RAW);
  });
  it('the Now offered word: pinned beats found beats recent beats ranked', () => {
    const t = capabilitiesOf(answer(), H)!.tools[1]!; // glob
    const pins = [{ name: 'glob', offered: true, why: null }];
    expect(offeredWord(t, pins, { found: new Set([t.id]), recent: new Set(['fs/glob']) })).toBe('pinned');
    expect(offeredWord(t, [], { found: new Set([t.id]), recent: new Set(['fs/glob']) })).toBe('found');
    expect(offeredWord(t, [], { found: new Set(), recent: new Set(['fs/glob']) })).toBe('recent');
    expect(offeredWord(t, [], { found: new Set(), recent: new Set() })).toBe('ranked');
  });
  it('found and recent come from the session\'s rows (the last find, the last runs); a session.open starts afresh', () => {
    const rows = [
      { kind: 'tool.selection', payload: { hsid: H, trigger: 'find', found: ['fs/glob@0123abcd'] } },
      { kind: 'tool.selection', payload: { hsid: H, trigger: 'periodic', found: [] } },
      { kind: 'tool.brokered', payload: { hsid: H, server: 'fs', tool: 'grep', decision: 'ran' } },
      { kind: 'tool.brokered', payload: { hsid: H, server: 'fs', tool: 'write', decision: 'denied' } },
      { kind: 'tool.brokered', payload: { hsid: 'other', server: 'fs', tool: 'rm', decision: 'ran' } },
    ];
    const h = selectionHintsOf(rows, H);
    expect([...h.found]).toEqual(['fs/glob@0123abcd']);
    expect([...h.recent]).toEqual(['fs/grep']);
    expect([...selectionHintsOf([...rows, { kind: 'session.open', payload: { hsid: H } }], H).recent]).toEqual([]);
  });
  it('tier 0: "This model gets no tools at tier 0." with Change tier…; pins say why; servers not started (tier 0)', () => {
    const v = toolsView(ui({ caps: capabilitiesOf(answer({ tier: 0, k: 0, pins: [{ name: 'grep', offered: false, why: 'tier-0' }], servers: [{ label: 'fs', trust: 'trusted', state: 'not-started', starts: 0, counts: { read: 0, mutate: 0, destructive: 0 } }], tools: [] }), H) }));
    expect(v.notice).toEqual({ text: 'This model gets no tools at tier 0.', key: { act: 'tier', label: 'Change tier…' } });
    expect(v.all).toBeNull();
    expect(v.sections.map((s) => s.title)).toEqual(['Pins · 1 of 8', 'Servers']);
    expect(v.sections[0]!.rows[0]).toMatchObject({ value: 'tier 0 has no tools' });
    expect(v.sections[1]!.rows[0]).toMatchObject({ value: 'not started (tier 0)', chip: { text: 'trusted', ink: true } });
  });
  it('no servers, nothing offered, no pins: each says so in words', () => {
    const v = toolsView(ui({ caps: capabilitiesOf(answer({ servers: [], pins: [], tools: [], verbs: [] }), H) }));
    expect(v.sections[0]!.rows[0]).toMatchObject({ value: TOOLS_COPY.noOffered });
    expect(v.sections[1]!.rows[0]).toMatchObject({ value: TOOLS_COPY.noPins });
    expect(v.sections[2]!.rows[0]).toMatchObject({ value: 'No MCP servers in this session.', how: TOOLS_COPY.noServersHow });
  });
  it('unfit pins say why (over-k with the tier and k; no room; no full form)', () => {
    const v = toolsView(ui({ caps: capabilitiesOf(answer({ tier: 1, k: 4, pins: [{ name: 'a', offered: false, why: 'over-k' }, { name: 'b', offered: false, why: 'no-room' }, { name: 'c', offered: false, why: 'no-full-form' }] }), H) }));
    expect(v.sections[1]!.rows.map((r) => (r.kind === 'readonly' ? r.value : ''))).toEqual(['waits: tier 1 offers 4 tools', 'no room in its tool space', 'this tier can’t show its arguments']);
    expect(v.sections[1]!.rows[0]).toMatchObject({ keys: [{ act: 'unpin', label: 'Unpin', pressed: true }] });
  });
  it('the filter shows at 12 tools; it matches name, server or words; no match says so', () => {
    const many = Array.from({ length: 12 }, (_, n) => tool({ name: `t${n}` }));
    const base = ui({ caps: capabilitiesOf(answer({ tools: many }), H) });
    expect(toolsView(base).all?.filter.shown).toBe(true);
    expect(toolsView(ui()).all?.filter.shown).toBe(false);
    expect(toolsView({ ...base, filter: 't1' }).all?.groups.flatMap((g) => g.rows.map((r) => r.name))).toEqual(['t1', 't10', 't11']);
    expect(toolsView({ ...base, filter: 'zzz' }).all).toMatchObject({ groups: [], noMatch: 'No tool matches the filter.' });
  });
  it('a group folds at 50 tools (folded by default; a filter unfolds; the human\'s fold holds)', () => {
    const fifty = Array.from({ length: 50 }, (_, n) => tool({ name: `t${n}`, server: 'big' }));
    const base = ui({ caps: capabilitiesOf(answer({ tools: [...fifty, tool({ name: 'one', server: 'small' })] }), H) });
    const g = toolsView(base).all!.groups;
    expect(g.find((x) => x.label === 'big')).toMatchObject({ foldable: true, folded: true, count: 50 });
    expect(g.find((x) => x.label === 'small')).toMatchObject({ foldable: false, folded: false });
    expect(toolsView({ ...base, filter: 't4' }).all!.groups.find((x) => x.label === 'big')?.folded).toBe(false);
    expect(toolsView({ ...base, folds: new Map([['big', true]]) }).all!.groups.find((x) => x.label === 'big')?.folded).toBe(false);
  });
});

describe('#gui-capability-browser: Pin keys', () => {
  const caps = capabilitiesOf(answer(), H)!;
  it('Pin / Unpin carry aria-pressed; Gnomon\'s verbs have no Pin', () => {
    expect(pinKeyOf(caps.tools[1]!, { pinBusy: null }, caps.pins)).toEqual({ key: { act: 'pin', value: 'glob', label: 'Pin', quiet: true, pressed: false }, why: null });
    expect(pinKeyOf(caps.tools[0]!, { pinBusy: null }, caps.pins).key).toMatchObject({ act: 'unpin', label: 'Unpin', pressed: true });
    expect(toolsView(ui()).all!.groups[0]!.rows[0]!.key).toBeNull();
  });
  it('aria-disabled with the reason shown: a slash-only tool; at 8 pins', () => {
    expect(pinKeyOf(caps.tools[3]!, { pinBusy: null }, caps.pins)).toMatchObject({ key: { ariaDisabled: true }, why: 'the model can’t use this one; run it from /' });
    const eight = Array.from({ length: 8 }, (_, n) => ({ name: `p${n}`, offered: true, why: null }));
    // Mika #4: at 8 pins the reason is said once, in the Pins heading; every disabled Pin points at it, no row repeats it
    expect(pinKeyOf(caps.tools[1]!, { pinBusy: null }, eight)).toEqual({ key: { act: 'pin', value: 'glob', label: 'Pin', quiet: true, pressed: false, ariaDisabled: true, describedBy: 'td-h-pins' }, why: null });
    const full = toolsView(ui({ caps: capabilitiesOf(answer({ pins: eight }), H) }));
    expect(full.sections.find((x) => x.id === 'pins')?.title).toBe('Pins · 8 of 8 · unpin one to pin another');
    expect(full.all!.groups.flatMap((g) => g.rows).filter((r) => r.why === '8 pins: unpin one first')).toEqual([]);
    // a row's own reason keeps its line
    expect(full.all!.groups[1]!.rows.find((r) => r.name === 'rm')?.why).toBe('the model can’t use this one; run it from /');
    // a pinned tool can always be unpinned, even at 8
    expect(pinKeyOf(caps.tools[0]!, { pinBusy: null }, [...eight, { name: 'grep', offered: true, why: null }]).key).not.toHaveProperty('ariaDisabled');
  });
  it('busy while its pin is in flight (aria-busy, aria-disabled)', () => {
    expect(pinKeyOf(caps.tools[1]!, { pinBusy: 'glob' }, caps.pins).key).toMatchObject({ busy: true, ariaDisabled: true });
  });
});

describe('#gui-capability-browser: server rows', () => {
  const srv = (o: Record<string, unknown>) => capabilitiesOf(answer({ servers: [{ label: 'fs', trust: 'enabled', state: 'running', starts: 1, counts: { read: 3, mutate: 1, destructive: 2 }, ...o }] }), H)!.servers[0]!;
  const base = { restarting: new Set<string>(), serverResult: null };
  it('running · starting · not started (tier 0); the trust chip by its word; the class counts', () => {
    expect(serverRow(srv({}), base, 0)).toMatchObject({ label: 'fs', value: 'running', mark: '✓', how: 'reads 3 · changes 1 · can’t be undone 2', chip: { text: 'untrusted' } });
    // Mika #5: the readout form, zero classes left out; nothing in any class says so
    expect(countsWords({ read: 0, mutate: 1, destructive: 0 })).toBe('changes 1');
    expect(countsWords({ read: 4, mutate: 1, destructive: 1 })).toBe('reads 4 · changes 1 · can’t be undone 1');
    expect(countsWords({ read: 0, mutate: 0, destructive: 0 })).toBe('no tools listed');
    expect(serverRow(srv({ state: 'starting' }), base, 0)).toMatchObject({ value: 'starting…' });
    expect(serverRow(srv({ state: 'not-started', trust: 'first-party' }), base, 0)).toMatchObject({ value: 'not started (tier 0)', chip: { text: 'first-party', ink: true } });
  });
  it('refused: plain words and next:; pin-mismatch gets Stage in Settings', () => {
    expect(serverRow(srv({ state: 'refused', fit: 'disabled' }), base, 0)).toMatchObject({ value: 'refused: it was turned off in Settings after this session opened', how: 'next: open a new session', mark: '✕' });
    // Mika #2: a refused server carries no trust chip; the other states do
    expect(serverRow(srv({ state: 'refused', fit: 'disabled', trust: 'trusted' }), base, 0)).not.toHaveProperty('chip');
    for (const state of ['running', 'starting', 'failed', 'not-started']) expect(serverRow(srv({ state, error: 'x' }), base, 0)).toHaveProperty('chip');
    expect(serverRow(srv({ state: 'refused', fit: 'pin-mismatch' }), base, 0)).toMatchObject({ value: 'refused: Paradigm isn’t staged', how: 'next: Stage in Settings', keys: [{ act: 'stage', label: 'Stage in Settings' }] });
    for (const fit of ['remote-refused', 'launch-writable', 'label-reserved', 'trust-changed']) expect(texts(serverRow(srv({ state: 'refused', fit }), base, 0))).not.toMatch(RAW);
  });
  it('failed: "stopped after 3 starts: <cause>" and Restart server; aria-busy while restarting', () => {
    const f = srv({ state: 'failed', starts: 3, error: 'ENOENT: no such file' });
    expect(serverRow(f, base, 0)).toMatchObject({ value: 'stopped after 3 starts: ENOENT: no such file', keys: [{ act: 'restart', value: 'fs', label: 'Restart server' }] });
    expect(serverRow(f, { ...base, restarting: new Set(['fs']) }, 0)).toMatchObject({ keys: [{ act: 'restart', label: 'Restarting…', busy: true, ariaDisabled: true }] });
    expect(serverRow(srv({ state: 'failed', starts: 1, error: 'x' }), base, 0)).toMatchObject({ value: 'stopped after 1 start: x' });
  });
});

describe('#gui-capability-browser: the Memory segment', () => {
  const E = (kind: MemEntry['kind'], source: string, text: string, id = 'wm-1'): MemEntry => ({ id, kind, source, text });
  const entries: MemEntry[] = [E('goal', 'human', 'fix the build'), E('fact', 'kernel', 'branch main'), E('tool-pin', 'human', 'pinned tool: grep'), E('note', 'model', 'the test is flaky'), E('note', 'model', 'see ci.yml'), E('file-ref', 'kernel', 'src/a.ts'), E('tool-pin', 'tool:fs', 'last failing tool: write — EACCES')];
  const mem = (o: Partial<DrawerUi['memory']> = {}, a: Partial<DrawerUi> = {}) => memoryView(ui({ seg: 'memory', ...a, memory: { ...emptyMemoryUi(), phase: 'loaded', entries, ...o } }));
  it('two groups: from you and Gnomon (goal, facts, your pins) and data (notes, file-refs, last failing tool)', () => {
    const v = mem();
    expect(v.yours.map((r) => (r.kind === 'readonly' ? `${r.label}: ${r.value}` : ''))).toEqual(['goal: fix the build', 'fact: branch main', 'your pin: grep']);
    expect(v.data.map((r) => (r.kind === 'readonly' ? `${r.label}: ${r.value}` : ''))).toEqual(['note: the test is flaky', 'note: see ci.yml', 'file: src/a.ts', 'last failing tool: write — EACCES']);
    expect(v.line).toBe('2 of 16 model notes');
    expect(notesLine(entries)).toBe('2 of 16 model notes');
    // an unverified voice goal is data, as the kernel renders it
    expect(isYours(E('goal', 'tool:voice', 'x'))).toBe(false);
    expect(entryLabel(E('goal', 'tool:voice', 'x'))).toBe('goal (heard)');
  });
  it('reading, empty, not the owner, unreachable', () => {
    expect(memoryView(ui({ memory: emptyMemoryUi() })).notice?.text).toBe('Reading this session’s memory…');
    expect(mem({ entries: [] }).notice?.text).toBe('No working memory yet. It fills when you send a prompt.');
    expect(mem({ entries: [] }).foot.keys).toEqual([]);
    expect(mem({}, { access: 'not-owner' }).notice?.text).toBe('Only the person who opened this session can see its memory.');
    expect(mem({ phase: 'unreachable' }).notice).toMatchObject({ fail: true, key: { act: 'again' } });
  });
  it('Delete: a quiet key at the foot, then the inline confirm: Delete memory · Delete and end session · Keep', () => {
    expect(mem().foot).toEqual({ confirm: null, keys: [{ act: 'mem-confirm', label: 'Delete memory…', quiet: true }] });
    const c = mem({ confirm: true });
    expect(c.foot.confirm).toBe('Delete this session’s working memory? The model loses its goal and notes. The conversation stays.');
    expect(c.foot.keys.map((k) => [k.act, k.label, !!k.pri])).toEqual([['mem-delete', 'Delete memory', true], ['mem-delete-stop', 'Delete and end session', false], ['mem-keep', 'Keep', false]]);
    // an ended session has nothing to end
    expect(mem({ confirm: true }, { access: 'ended' }).foot.keys.map((k) => k.act)).toEqual(['mem-delete', 'mem-keep']);
  });
  it('deleting: the pressed key is aria-busy, the others aria-disabled; done and refused', () => {
    const d = mem({ confirm: true, deleting: 'memory' });
    expect(d.foot.keys[0]).toMatchObject({ label: 'Deleting…', busy: true, ariaDisabled: true });
    expect(d.foot.keys.slice(1).every((k) => k.ariaDisabled)).toBe(true);
    const done = mem({ phase: 'gone', entries: [], result: { text: TOOLS_COPY.memory.done } });
    expect(done.result?.text).toBe('Memory deleted. The conversation still shows what was said.');
    expect(done.notice).toBeNull();
  });
});

describe('#gui-capability-browser: who may open it, the meta, requests', () => {
  it('local attended sessions only; not the owner; ended', () => {
    const b = { backend: 'local', loop: false, live: true, owner: 'p:a/me', me: 'p:a/me' };
    expect(drawerAccess(b)).toBe('owner');
    expect(drawerAccess({ ...b, live: false })).toBe('ended');
    expect(drawerAccess({ ...b, me: 'p:a/other' })).toBe('not-owner');
    expect(drawerAccess({ ...b, backend: 'claude-code' })).toBeNull();
    expect(drawerAccess({ ...b, loop: true })).toBeNull();
  });
  it('the head meta: "updated 12:53" once a re-read moved the generation', () => {
    expect(drawerMeta({ title: 'fix', updatedAt: null })).toBe('fix');
    expect(drawerMeta({ title: 'fix', updatedAt: '12:53' })).toBe('fix · updated 12:53');
  });
  it('requests', () => {
    expect(pinRequest(H, 'grep', true)).toEqual({ kind: 'request.session.tools.pin', payload: { hsid: H, name: 'grep', pinned: true } });
    expect(restartRequest(H, 'fs')).toEqual({ kind: 'request.session.mcp.restart', payload: { hsid: H, server: 'fs' } });
    expect(memoryDeleteRequest(H, false)).toEqual({ kind: 'request.session.memory.delete', payload: { hsid: H } });
    expect(memoryDeleteRequest(H, true).payload).toEqual({ hsid: H, stop: true });
  });
});

describe('#gui-capability-browser: the toast and the header meta', () => {
  it('a failed session.mcp row is "<server> stopped: <short cause>"; other states are not toasts', () => {
    expect(mcpFailToastOf({ kind: 'session.mcp', payload: { hsid: H, server: 'fs', state: 'failed', error: 'exited with code 1 after reading its config from a very long path that goes on and on and on' } })).toEqual({ hsid: H, server: 'fs', text: 'fs stopped: exited with code 1 after reading its config from a very long path that goes on …' });
    expect(mcpFailToastOf({ kind: 'session.mcp', payload: { hsid: H, server: 'fs', state: 'started' } })).toBeNull();
    expect(mcpFailToastOf({ kind: 'session.mcp', payload: { hsid: H, server: 'f‮s', state: 'failed', error: 'x' } })!.text).not.toContain('‮');
    expect(shortCause('')).toBe('it failed');
  });
  it('"· 1 server off": failed, or refused after it ran; a refusal at open and a later start do not count', () => {
    const r = (server: string, state: string) => ({ kind: 'session.mcp', payload: { hsid: H, server, state } });
    expect(serversOffOf([r('a', 'refused')], H)).toBe(0);
    expect(serversOffOf([r('a', 'started'), r('a', 'failed')], H)).toBe(1);
    expect(serversOffOf([r('a', 'started'), r('a', 'failed'), r('a', 'started')], H)).toBe(0);
    expect(serversOffOf([r('a', 'failed'), r('a', 'refused'), r('b', 'started'), r('b', 'failed')], H)).toBe(2);
    expect(serversOffOf([r('a', 'failed'), { kind: 'session.open', payload: { hsid: H } }], H)).toBe(0);
    expect(serversOffText(0)).toBe('');
    expect(serversOffText(1)).toBe(' · 1 server off');
    expect(serversOffText(2)).toBe(' · 2 servers off');
  });
});

describe('#gui-capability-browser: Settings › Local model › Kept memory', () => {
  it('reads the ended sessions; nothing until read', () => {
    expect(keptOf({ sessions: [{ hsid: 'a', live: true }, { hsid: 'b', live: false }] })).toEqual(['b']);
    expect(keptOf({})).toBeNull();
    expect(keptRows(emptyKeptUi())).toEqual([]);
  });
  it('"Kept memory · N sessions", each with Open and Delete; Delete confirms inline; busy; the result', () => {
    const k = { ...emptyKeptUi(), sessions: [{ hsid: 'h1', title: 'old one' }, { hsid: 'h2', title: 'older' }] };
    const rows = keptRows(k);
    expect(rows[0]).toMatchObject({ label: 'Kept memory', value: '2 sessions' });
    expect(rows[1]).toMatchObject({ label: 'old one', keys: [{ act: 'kept:open', value: 'h1', label: 'Open' }, { act: 'kept:delete', value: 'h1', label: 'Delete' }] });
    const c = keptRows({ ...k, confirm: 'h1' });
    expect(c[1]).toMatchObject({ kind: 'form', confirm: { text: 'Delete this ended session’s working memory? The conversation stays.', keys: [{ act: 'kept:delete-yes', label: 'Delete memory', pri: true }, { act: 'kept:keep', label: 'Keep' }] } });
    // Mika #3: while another delete runs, the other rows' Delete says why in a visible line linked by aria-describedby
    const waiting = keptRows({ ...k, confirm: 'h1', busy: 'h1' })[2]!;
    expect(waiting).toMatchObject({ how: 'waits: another delete is running', howId: 'kept-why-1', keys: [{ act: 'kept:open' }, { act: 'kept:delete', ariaDisabled: true, describedBy: 'kept-why-1' }] });
    expect(keptRows(k)[1]).not.toHaveProperty('howId');
    expect(keptRows({ ...k, confirm: 'h1', busy: 'h1' })[1]).toMatchObject({ confirm: { keys: [{ busy: true, ariaDisabled: true, label: 'Deleting…' }, { ariaDisabled: true }] } });
    // none kept: no row at all; after the last one was deleted, the count says none and the result shows
    expect(keptRows({ ...k, sessions: [] })).toEqual([]);
    expect(keptRows({ ...k, sessions: [], result: { text: 'x' } })[0]).toMatchObject({ value: 'none' });
    expect(keptRows({ ...k, result: { text: 'Memory deleted.' } }).at(-1)).toMatchObject({ kind: 'form', result: { text: 'Memory deleted.' } });
  });
});

describe("#gui-capability-browser: C6'b2-1 fields (run, params, fullSchema, policy, tainted)", () => {
  it('every tool reads its "/" run, params, schema and policy; the session its taint; junk reads safe', () => {
    const c = capabilitiesOf(answer({ tainted: true, tools: [{ ...tool({ name: 'grep' }), run: { runnable: true }, params: [{ name: 'p', required: true, type: 'string' }, 'junk'], fullSchema: { type: 'object' }, policy: 'ask' }, { ...tool({ name: 'rm' }), run: { runnable: false, why: 'untrusted' }, params: 'x', fullSchema: [1], policy: 'always' }] }), H)!;
    expect(c.tainted).toBe(true);
    expect(c.tools[0]).toMatchObject({ run: { runnable: true, why: null, detail: null }, params: [{ name: 'p', required: true, type: 'string', enum: null, description: '' }], fullSchema: { type: 'object' }, policy: 'ask' });
    expect(c.tools[1]).toMatchObject({ run: { runnable: false, why: 'untrusted', detail: null }, params: [], fullSchema: null, policy: null });
    expect(capabilitiesOf(answer(), H)!.tainted).toBe(false);
    expect(capabilitiesOf(answer(), H)!.tools[0]!.run.runnable).toBe(false);
  });
});

describe("#gui-capability-browser: C6'b2-2 the policy word, Stop sending, the taint line", () => {
  it('each server tool says "results: send · ask · not chosen"; a tool that sends has a quiet Stop sending', () => {
    const c = capabilitiesOf(answer({ tools: [{ ...tool({ name: 'grep' }), policy: 'send' }, { ...tool({ name: 'glob' }), policy: 'ask' }, tool({ name: 'cat' })] }), H)!;
    const rows = toolsView(ui({ caps: c })).all!.groups[1]!.rows;
    expect(rows.map((r) => r.meta.split(' · ').at(-1))).toEqual(['results: send', 'results: ask', 'results: not chosen']);
    expect(rows[0]!.stop).toMatchObject({ act: 'stop-sending', value: 'fs/grep@0123abcd', label: 'Stop sending', quiet: true });
    expect(rows[1]!.stop).toBeNull();
    const busy = toolsView(ui({ caps: c, policyBusy: 'fs/grep@0123abcd' })).all!.groups[1]!.rows[0]!.stop;
    expect(busy).toMatchObject({ label: 'Stopping…', busy: true, ariaDisabled: true });
    // Gnomon's own verbs have no "/" policy
    expect(toolsView(ui({ caps: c })).all!.groups[0]!.rows[0]!.meta).not.toContain('results:');
  });
  it('a tainted session shows the injection-pause line, also at tier 0; else none', () => {
    expect(toolsView(ui({ caps: capabilitiesOf(answer({ tainted: true }), H) })).taint).toBe('Always rules for tools that can’t be undone are paused for the model in this session: it has read tool results or skill text. Your / runs are not affected.');
    expect(toolsView(ui({ caps: capabilitiesOf(answer({ tainted: true, tier: 0 }), H) })).taint).toMatch(/^Always rules/);
    expect(toolsView(ui()).taint).toBeNull();
  });
  it('a refused Stop sending in words', () => {
    expect(refusalWords('stop', { reason: 'not-found', data: null })).toBe('Still sending: this tool isn’t in this session any more');
    expect(refusalWords('stop', { reason: 'untrusted', data: null })).toBe('Its results aren’t sent: its server isn’t trusted now');
    expect(refusalWords('stop', null)).toBe('Still sending: nothing was sent, the connection dropped · next: try again once Gnomon is connected');
  });
});
