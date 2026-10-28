/**
 * #gui-slash-menu (slice C6'b2-1, G-GUI-19): the "/" menu's rows, words, args panel and requests (core/slash-menu.ts,
 * PURE). No kernel code shown raw; a row that cannot run stays aria-disabled with its reason; tier 0 offers one Start
 * row; the Run key names its cost; every server- and repo-written string is cleaned and capped.
 */
import { describe, expect, it } from 'vitest';
import {
  argFieldsOf,
  argsOf,
  filterSlash,
  runKeyLabel,
  runsOnEnter,
  SKILL_COPY,
  skillArgsProblem,
  skillRefusalWords,
  skillRunRequest,
  skillsOf,
  slashItemsOf,
  slashOptionId,
  slashQueryOf,
  SLASH_COMMANDS,
  SLASH_COPY,
  startFailWords,
  toolsResultRequest,
  toolsRunRequest,
  toolsStartRequest,
  whyWords,
} from '../src/core/slash-menu.js';
import { capabilitiesOf, type Capabilities } from '../src/core/tools-drawer.js';

const H = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const tool = (name: string, o: Record<string, unknown> = {}): Record<string, unknown> => ({ id: `fs/${name}@0123abcd`, name, server: 'fs', class: 'read', humanOnly: false, availability: 'offered', description: `${name} things`, params: [], run: { runnable: true }, policy: null, ...o });
const capsRaw = (o: Record<string, unknown> = {}): Record<string, unknown> => ({ hsid: H, generation: 1, tier: 2, k: 12, mode: 'ask', verbs: [], servers: [{ label: 'fs', trust: 'trusted', state: 'running', starts: 1, counts: { read: 2, mutate: 0, destructive: 0 } }], pins: [], tools: [tool('grep'), tool('write', { class: 'mutate' }), tool('rm', { class: 'destructive', humanOnly: true })], tainted: false, ...o });
const caps = (o: Record<string, unknown> = {}): Capabilities => capabilitiesOf(capsRaw(o), H)!;
const skills = [
  { name: 'review', loaded: true, why: '', description: 'review the diff', argumentHint: '<branch>' },
  { name: 'shell', loaded: false, why: 'it runs shell preprocessing', description: '', argumentHint: '' },
];

describe('#gui-slash-menu: capabilities carry run, params, fullSchema, policy and tainted', () => {
  it('parses them, cleaned; absent run reads not runnable with no reason', () => {
    const c = caps({
      tainted: true,
      tools: [
        tool('grep', { params: [{ name: 'pattern', required: true, type: 'string', description: 'what‮ to find' }, { name: 'mode', required: false, type: 'string', enum: ['a', 'b', { x: 1 }] }], fullSchema: { type: 'object' }, policy: 'send' }),
        tool('cat', { run: { runnable: false, why: 'unchecked-schema', detail: 'a $ref' }, policy: 'nope' }),
        tool('ls', { run: undefined }),
      ],
    });
    expect(c.tainted).toBe(true);
    const [g, cat, ls] = c.tools;
    expect(g!.run).toEqual({ runnable: true, why: null, detail: null });
    expect(g!.params[0]).toMatchObject({ name: 'pattern', required: true, type: 'string', enum: null });
    expect(g!.params[0]!.description).not.toContain('‮');
    expect(g!.params[1]!.enum).toEqual(['a', 'b']);
    expect(g!.fullSchema).toEqual({ type: 'object' });
    expect(g!.policy).toBe('send');
    expect(cat!.run).toEqual({ runnable: false, why: 'unchecked-schema', detail: 'a $ref' });
    expect(cat!.policy).toBeNull();
    expect(ls!.run.runnable).toBe(false);
    expect(caps().tainted).toBe(false);
  });
});

describe('#gui-slash-menu: rows', () => {
  it('groups in order: Skills · Gnomon commands · Tools by server, each note its cost tag', () => {
    const items = slashItemsOf({ caps: caps(), skills: skillsOf({ hsid: H, skills }, H), commands: SLASH_COMMANDS });
    expect([...new Set(items.map((i) => i.group))]).toEqual(['skills', 'commands', 'tools']);
    const by = (k: string) => items.find((i) => i.key === k)!;
    expect(by('skill:review')).toMatchObject({ name: '/review', note: 'posts as your turn', disabled: false });
    expect(by('cmd:tools.open')).toMatchObject({ name: '/tools', note: 'opens a screen' });
    expect(by('tool:fs/grep@0123abcd')).toMatchObject({ groupLabel: 'fs', note: 'runs now', disabled: false });
    expect(by('tool:fs/write@0123abcd').note).toBe('asks first');
    expect(by('tool:fs/rm@0123abcd').note).toBe('card with Touch ID');
  });

  it('a skill that is not loaded stays, quiet, with its reason; a name outside the rule never runs', () => {
    const s = skillsOf({ hsid: H, skills: [...skills, { name: 'Bad Name', loaded: true }] }, H)!;
    expect(s.find((x) => x.name === 'shell')).toMatchObject({ loaded: false, why: 'it runs shell preprocessing' });
    expect(s.find((x) => x.name === 'Bad Name')!.loaded).toBe(false);
    const it = slashItemsOf({ caps: null, skills: s, commands: [] }).find((i) => i.key === 'skill:shell')!;
    expect(it).toMatchObject({ disabled: true, note: 'it runs shell preprocessing' });
    expect(skillsOf({ hsid: 'other', skills }, H)).toBeNull();
  });

  it('a tool that cannot run is aria-disabled with the reason as its note, never the code', () => {
    const c = caps({ tools: [tool('a', { run: { runnable: false, why: 'untrusted' } }), tool('b', { run: { runnable: false, why: 'unchecked-schema', detail: 'a oneOf at arguments.x' } }), tool('c', { run: { runnable: false, why: 'weird' } })] });
    const rows = slashItemsOf({ caps: c, skills: null, commands: [] });
    expect(rows.map((r) => r.disabled)).toEqual([true, true, true]);
    expect(rows[0]!.note).toBe('not trusted · next: trust it in Settings › MCP servers');
    expect(rows[1]!.note).toBe('Gnomon can’t check its inputs: a oneOf at arguments.x');
    expect(rows[2]!.note).toBe('Gnomon can’t run this one from /');
    for (const r of rows) expect(r.note).not.toMatch(/untrusted|unchecked-schema|weird/);
    expect(whyWords({ why: null, detail: null })).toBe('Gnomon can’t run this one from /');
  });

  it('tier 0 with servers not started: ONE Start row naming N; starting is aria-disabled', () => {
    const c = caps({ tier: 0, tools: [], servers: [{ label: 'fs', trust: 'trusted', state: 'not-started', starts: 0, counts: {} }, { label: 'gh', trust: 'enabled', state: 'not-started', starts: 0, counts: {} }, { label: 'r', trust: 'enabled', state: 'refused', fit: 'remote-refused', starts: 0, counts: {} }] });
    const rows = slashItemsOf({ caps: c, skills: null, commands: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'start', name: SLASH_COPY.start, note: 'starts 2 servers; the model still gets no tools', disabled: false });
    expect(slashItemsOf({ caps: c, skills: null, commands: [], starting: true })[0]).toMatchObject({ note: 'starting…', disabled: true });
    expect(slashItemsOf({ caps: c, skills: null, commands: [], startError: 'Not started: x' })[0]!.why).toBe('Not started: x');
  });

  it('servers off at tier > 0: one row that opens Tools', () => {
    const c = caps({ tools: [], servers: [{ label: 'fs', trust: 'trusted', state: 'failed', starts: 3, counts: {} }] });
    const rows = slashItemsOf({ caps: c, skills: null, commands: [] });
    expect(rows).toEqual([expect.objectContaining({ kind: 'see-tools', name: 'servers are off in this session', note: 'see Tools', disabled: false })]);
  });

  it('option ids are stable across repaints and valid ids', () => {
    const a = slashItemsOf({ caps: caps(), skills: null, commands: SLASH_COMMANDS });
    const b = slashItemsOf({ caps: caps({ generation: 9 }), skills: null, commands: SLASH_COMMANDS });
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    for (const i of a) expect(i.id).toMatch(/^slash-o-[a-z-]+-[0-9a-z]+$/);
    expect(new Set(a.map((i) => i.id)).size).toBe(a.length);
    expect(slashOptionId('tool:x')).toBe(slashOptionId('tool:x'));
  });

  it('typeahead: name prefixes first within a group; groups keep their order; no match is empty', () => {
    const items = slashItemsOf({ caps: caps({ tools: [tool('xgrep'), tool('grep'), tool('other', { description: 'grep helper' })] }), skills: null, commands: SLASH_COMMANDS });
    expect(filterSlash(items, 'grep').map((i) => i.name)).toEqual(['grep', 'xgrep', 'other']);
    expect(filterSlash(items, '/set').map((i) => i.name)).toEqual(['/settings']);
    expect(filterSlash(items, 'zzz')).toEqual([]);
    expect(filterSlash(items, '')).toHaveLength(items.length);
  });

  it('the query is "/" then one word', () => {
    expect(slashQueryOf('/')).toBe('');
    expect(slashQueryOf('/rev')).toBe('rev');
    expect(slashQueryOf('/rev x')).toBeNull();
    expect(slashQueryOf('hi /rev')).toBeNull();
    expect(slashQueryOf('/a\nb')).toBeNull();
    expect(slashQueryOf('/usr/bin')).toBeNull();
  });
});

describe('#gui-slash-menu: the args panel and the Run key', () => {
  const items = slashItemsOf({ caps: caps(), skills: skillsOf({ hsid: H, skills }, H), commands: [] });
  const t = (n: string) => items.find((i) => i.name === n)!;

  it('the Run key names its cost', () => {
    expect(runKeyLabel(t('grep'))).toBe('Run · runs now');
    expect(runKeyLabel(t('write'))).toBe('Run · asks first');
    expect(runKeyLabel(t('rm'))).toBe('Run · card with Touch ID');
    expect(runKeyLabel(t('/review'))).toBe('Run · posts as your turn');
  });

  it('Enter runs at once only a read tool with no arguments', () => {
    expect(runsOnEnter(t('grep'))).toBe(true);
    expect(runsOnEnter(t('write'))).toBe(false);
    expect(runsOnEnter(t('/review'))).toBe(false);
    const withArgs = slashItemsOf({ caps: caps({ tools: [tool('g', { params: [{ name: 'p', required: false, type: 'string' }] })] }), skills: null, commands: [] })[0]!;
    expect(runsOnEnter(withArgs)).toBe(false);
  });

  it('fields: text, number, seg for an enum and a boolean, mono JSON for anything complex', () => {
    const it = slashItemsOf({
      caps: caps({ tools: [tool('q', { params: [
        { name: 's', required: true, type: 'string' },
        { name: 'n', required: false, type: 'integer' },
        { name: 'b', required: false, type: 'boolean' },
        { name: 'e', required: false, type: 'string', enum: ['x', 'y'] },
        { name: 'o', required: false, type: 'object' },
        { name: 'u', required: false, type: 'string|number' },
      ] })] }),
      skills: null,
      commands: [],
    })[0]!;
    const f = argFieldsOf(it);
    expect(f.map((x) => x.kind)).toEqual(['text', 'number', 'bool', 'enum', 'json', 'json']);
    expect(f[3]!.options.map((o) => o.label)).toEqual(['x', 'y']);
    expect(argsOf(f, {})).toEqual({ errors: { s: 'needed' } });
    expect(argsOf(f, { s: 'hi', n: '2.5' })).toEqual({ errors: { n: 'a whole number' } });
    expect(argsOf(f, { s: 'hi', o: '{bad' })).toEqual({ errors: { o: 'not valid JSON' } });
    expect(argsOf(f, { s: 'hi', n: '3', b: '1', e: '0', o: '{"a":1}', u: '' })).toEqual({ args: { s: 'hi', n: 3, b: false, e: 'x', o: { a: 1 } } });
  });

  it('a skill has one field, its argument hint the placeholder', () => {
    expect(argFieldsOf(t('/review'))).toEqual([expect.objectContaining({ name: 'args', kind: 'text', placeholder: '<branch>' })]);
  });

  it('skill arguments: one line, under 4 KB, no !`; refusals in words', () => {
    expect(skillArgsProblem('main')).toBeNull();
    expect(skillArgsProblem('a\nb')).toBe(SKILL_COPY.badArgs);
    expect(skillArgsProblem('run !`ls`')).toBe(SKILL_COPY.badArgs);
    expect(skillArgsProblem('é'.repeat(2049))).toBe(SKILL_COPY.badArgs);
    expect(skillRefusalWords({ why: 'over-budget', tokens: 120000, limit: 100000 })).toBe('this skill is 120000 tokens; this model takes at most 100000 from one skill');
    expect(skillRefusalWords({ why: 'bad-args' })).toBe('arguments must be one line, under 4 KB, with no !`');
    expect(skillRefusalWords({ why: 'not-listed' })).toBe('this skill isn’t in this session any more');
    expect(skillRefusalWords({ why: 'weird' })).not.toContain('weird');
  });

  it('a failed start reads in the drawer’s fit words', () => {
    expect(startFailWords({ reason: 'refused', data: { fit: 'remote-refused' } })).toBe('Not started: local sessions only reach servers on this Mac · next: run it on this Mac and turn that copy on in Settings');
    expect(startFailWords({ reason: 'not-found', data: null })).toBe('Not started: Gnomon won’t start it in this session · next: open a new session');
    expect(startFailWords(null)).toMatch(/connection dropped/);
  });

  it('requests', () => {
    expect(toolsStartRequest(H)).toEqual({ kind: 'request.session.tools.start', payload: { hsid: H } });
    expect(toolsRunRequest(H, { id: 'fs/rm@0123abcd', humanOnly: true }, { p: 1 })).toEqual({ kind: 'request.session.tools.run', payload: { hsid: H, id: 'fs/rm@0123abcd', args: { p: 1 }, form: 'full' } });
    expect(toolsRunRequest(H, { id: 'fs/g@0123abcd', humanOnly: false }, {}).payload.form).toBe('narrow');
    expect(toolsResultRequest(H, 'run-x')).toEqual({ kind: 'request.session.tools.result', payload: { hsid: H, runId: 'run-x' } });
    expect(skillRunRequest(H, 'review', 'main')).toEqual({ kind: 'request.session.skill.run', payload: { hsid: H, name: 'review', args: 'main' } });
  });
});
