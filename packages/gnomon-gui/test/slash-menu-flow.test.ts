/**
 * #gui-slash-menu / #gui-slash-runs (slice C6'b2-1, G-GUI-19, G-GUI-20): SlashFlow's press paths (no DOM) over a
 * scripted kernel, the transcript rows (chatItems: this page's run row, the kernel's row claimed or shown as history,
 * a skill run as the human's turn), and the wiring in app.ts (checked by source).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RpcError } from '../src/core/client.js';
import { SLASH_COMMANDS, type SlashRequest } from '../src/core/slash-menu.js';
import { chatItems, type Row } from '../src/core/store.js';
import type { RunView } from '../src/core/slash-runs.js';
import { SlashFlow } from '../src/ui/slash-menu.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
const UI = readFileSync(path.join(ROOT, 'src', 'ui', 'slash-menu.ts'), 'utf8');
const H = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const RUN = `run-${'b'.repeat(24)}`;
const tool = (name: string, o: Record<string, unknown> = {}): Record<string, unknown> => ({ id: `fs/${name}@0123abcd`, name, server: 'fs', class: 'read', humanOnly: false, availability: 'offered', description: '', params: [], run: { runnable: true }, policy: null, ...o });
const caps = (o: Record<string, unknown> = {}): Record<string, unknown> => ({ hsid: H, generation: 1, tier: 2, k: 12, mode: 'ask', verbs: [], servers: [{ label: 'fs', trust: 'trusted', state: 'running', starts: 1, counts: {} }], pins: [], tools: [tool('grep'), tool('write', { class: 'mutate', params: [{ name: 'path', required: true, type: 'string' }] }), tool('nope', { run: { runnable: false, why: 'untrusted' } })], tainted: false, ...o });
const tick = () => new Promise((r) => setTimeout(r, 0));
const refusal = (reason: string, data: Record<string, unknown> | null = null) => new RpcError({ code: 'BAD_REQUEST', reason, message: 'm', next: [], data });

function rig(script: Record<string, Array<unknown | (() => unknown)>> = {}, access: { tools: boolean; skills: boolean } | null = { tools: true, skills: true }) {
  const calls: SlashRequest[] = [];
  const lives: string[] = [];
  const added: RunView[] = [];
  const changed: RunView[] = [];
  const commands: string[] = [];
  const skillsRan: unknown[] = [];
  const q: Record<string, Array<unknown | (() => unknown)>> = { 'request.session.capabilities': [caps()], 'request.session.skills.list': [{ hsid: H, skills: [{ name: 'review', loaded: true, argumentHint: '<branch>' }] }], ...script };
  const last: Record<string, unknown> = {};
  const flow = new SlashFlow({
    call: async (req) => {
      calls.push(req);
      const list = q[req.kind] ?? [];
      const a = list.length ? list.shift() : last[req.kind];
      last[req.kind] = a;
      return typeof a === 'function' ? (a as () => unknown)() : a;
    },
    repaint: () => undefined,
    live: (t) => void lives.push(t),
    now: () => 1_000_000,
    access: () => access,
    commands: SLASH_COMMANDS,
    runAdded: (v) => void added.push(v),
    runChanged: (v) => void changed.push(v),
    command: (id) => void commands.push(id),
    openTools: () => undefined,
    skillRan: (...a) => void skillsRan.push(a),
    done: () => undefined,
    timer: (fn) => void fn(),
  });
  return { flow, calls, lives, added, changed, commands, skillsRan, kinds: () => calls.map((c) => c.kind) };
}

describe('#gui-slash-menu: the flow', () => {
  it('opens only on a trusted event and for a session it may serve; reads capabilities and skills (read only)', async () => {
    const r = rig();
    expect(r.flow.open(H, '', false)).toBe(false);
    expect(rig({}, null).flow.open(H, '', true)).toBe(false);
    r.flow.open(H, '', true);
    await tick();
    expect(r.kinds().sort()).toEqual(['request.session.capabilities', 'request.session.skills.list']);
    expect(r.flow.items().map((i) => i.key)).toContain('tool:fs/grep@0123abcd');
    expect(r.flow.loadedSkills(H)).toEqual(['review']);
  });

  it('↑/↓ move the active row; the query filters', async () => {
    const r = rig();
    r.flow.open(H, 'gr', true);
    await tick();
    expect(r.flow.state()!.active).toBe('tool:fs/grep@0123abcd');
    r.flow.setQuery('');
    const first = r.flow.state()!.active;
    r.flow.move(1);
    expect(r.flow.state()!.active).not.toBe(first);
    r.flow.move(-1);
    expect(r.flow.state()!.active).toBe(first);
  });

  it('an aria-disabled row sends nothing and says its reason; a command opens its screen', async () => {
    const r = rig();
    r.flow.open(H, '', true);
    await tick();
    const n = r.calls.length;
    r.flow.press('tool:fs/nope@0123abcd', true);
    expect(r.calls.length).toBe(n);
    expect(r.lives.at(-1)).toBe('nope: not trusted · next: trust it in Settings › MCP servers');
    r.flow.press('cmd:rules.open', true);
    expect(r.commands).toEqual(['rules.open']);
    expect(r.flow.isOpen()).toBe(false);
  });

  it('Enter on a tool with arguments opens its panel; Run checks the fields, then sends ONE run', async () => {
    const r = rig({ 'request.session.tools.run': [{ hsid: H, status: 'carded', runId: RUN, cardId: 'card:1', isError: false }] });
    r.flow.open(H, 'write', true);
    await tick();
    r.flow.press(null, true);
    expect(r.flow.state()!.args).toBe('tool:fs/write@0123abcd');
    await r.flow.runArgs(true);
    expect(r.flow.state()!.errors).toEqual({ path: 'needed: fill this in' });
    expect(r.kinds()).not.toContain('request.session.tools.run');
    r.flow.setValue('path', 'a.txt');
    await r.flow.runArgs(false);
    expect(r.kinds()).not.toContain('request.session.tools.run');
    await r.flow.runArgs(true);
    expect(r.calls.filter((c) => c.kind === 'request.session.tools.run')).toEqual([{ kind: 'request.session.tools.run', payload: { hsid: H, id: 'fs/write@0123abcd', args: { path: 'a.txt' }, form: 'narrow' } }]);
    expect(r.added).toHaveLength(1);
    expect(r.flow.run(r.added[0]!.key)!.phase).toBe('carded');
  });

  it('a carded run reads tools.result EXACTLY once when its card settles allowed; other rows do nothing', async () => {
    const r = rig({ 'request.session.tools.run': [{ status: 'carded', runId: RUN, cardId: 'card:1' }], 'request.session.tools.result': [{ status: 'ran', runId: RUN, content: 'ok', isError: false }] });
    r.flow.open(H, 'grep', true);
    await tick();
    r.flow.press(null, true); // a read tool with no args runs on Enter
    await tick();
    const key = r.added[0]!.key;
    r.flow.row({ kind: 'tool.brokered', payload: { hsid: H, author: 'human', cardId: 'card:2', decision: 'approved' } });
    r.flow.row({ kind: 'tool.brokered', payload: { hsid: H, cardId: 'card:1', decision: 'approved' } });
    expect(r.kinds()).not.toContain('request.session.tools.result');
    r.flow.row({ kind: 'tool.brokered', payload: { hsid: H, author: 'human', cardId: 'card:1', decision: 'approved' } });
    await tick();
    r.flow.row({ kind: 'tool.brokered', payload: { hsid: H, author: 'human', cardId: 'card:1', decision: 'approved' } });
    await tick();
    expect(r.kinds().filter((k) => k === 'request.session.tools.result')).toHaveLength(1);
    expect(r.flow.run(key)).toMatchObject({ phase: 'ran', content: 'ok' });
  });

  it('a pending result consumed nothing: asked again, bounded; gone is "held 10 min"', async () => {
    const r = rig({ 'request.session.tools.run': [{ status: 'carded', runId: RUN, cardId: 'card:1' }], 'request.session.tools.result': [{ status: 'carded', pending: true }, () => { throw refusal('not-found'); }] });
    r.flow.open(H, 'grep', true);
    await tick();
    r.flow.press(null, true);
    await tick();
    r.flow.row({ kind: 'tool.brokered', payload: { hsid: H, author: 'human', cardId: 'card:1', decision: 'ran' } });
    for (let i = 0; i < 5; i++) await tick();
    expect(r.kinds().filter((k) => k === 'request.session.tools.result')).toHaveLength(2);
    expect(r.flow.run(r.added[0]!.key)!.phase).toBe('gone');
  });

  it('denied on the card: no read', async () => {
    const r = rig({ 'request.session.tools.run': [{ status: 'carded', runId: RUN, cardId: 'card:1' }] });
    r.flow.open(H, 'grep', true);
    await tick();
    r.flow.press(null, true);
    await tick();
    r.flow.row({ kind: 'tool.brokered', payload: { hsid: H, author: 'human', cardId: 'card:1', decision: 'denied' } });
    await tick();
    expect(r.kinds()).not.toContain('request.session.tools.result');
    expect(r.flow.run(r.added[0]!.key)!.phase).toBe('denied');
  });

  it('tier 0: Start sends tools.start once and re-reads; a failure reads in fit words', async () => {
    const zero = caps({ tier: 0, tools: [], servers: [{ label: 'fs', trust: 'trusted', state: 'not-started', starts: 0, counts: {} }] });
    const r = rig({ 'request.session.capabilities': [zero, caps()], 'request.session.tools.start': [{ started: true }] });
    r.flow.open(H, '', true);
    await tick();
    expect(r.flow.items().find((i) => i.kind === 'start')).toBeTruthy();
    const p = r.flow.start(true);
    void r.flow.start(true); // a second press while starting sends nothing
    await p;
    expect(r.kinds().filter((k) => k === 'request.session.tools.start')).toHaveLength(1);
    expect(r.flow.items().some((i) => i.key === 'tool:fs/grep@0123abcd')).toBe(true);
    const f = rig({ 'request.session.capabilities': [zero], 'request.session.tools.start': [() => { throw refusal('refused', { fit: 'launch-writable' }); }] });
    f.flow.open(H, '', true);
    await tick();
    await f.flow.start(true);
    expect(f.flow.state()!.startError).toBe('Not started: it runs from a folder this session can edit · next: open the session in another folder, or move the server out of this one');
  });

  it('a skill run posts as the human’s turn; a refusal stays in the panel in words', async () => {
    const r = rig({ 'request.session.skill.run': [{ status: 'refused', why: 'over-budget', tokens: 9000, limit: 4000 }, { status: 'ran', turn: 't-1' }] });
    r.flow.open(H, 'review', true);
    await tick();
    r.flow.press(null, true);
    r.flow.setValue('args', 'a\nb');
    await r.flow.runArgs(true);
    expect(r.flow.state()!.result).toBe('arguments must be one line, under 4 KB, with no !`');
    expect(r.kinds()).not.toContain('request.session.skill.run');
    r.flow.setValue('args', 'main');
    await r.flow.runArgs(true);
    expect(r.flow.state()!.result).toBe('this skill is 9,000 tokens; this model takes at most 4,000 from one skill');
    await r.flow.runArgs(true);
    expect(r.skillsRan).toEqual([[H, 'review', 'main', 't-1']]);
    expect(r.flow.isOpen()).toBe(false);
  });
});

describe('#gui-slash-runs: transcript rows (chatItems)', () => {
  const at = '2026-10-28T12:00:00.000Z';
  it('this page’s run row shows once: the kernel row for it is claimed; another is history', () => {
    const rows: Row[] = [
      { seq: 1.5, kind: 'slash-run', connId: 'local', session: H, payload: { key: 'lr-1', server: 'fs', tool: 'grep' }, at },
      { seq: 2, kind: 'tool.brokered', session: H, payload: { hsid: H, server: 'fs', tool: 'grep', decision: 'ran', author: 'human', isError: false }, at },
      { seq: 3, kind: 'tool.brokered', session: H, payload: { hsid: H, server: 'fs', tool: 'rm', decision: 'denied', author: 'human' }, at },
      { seq: 4, kind: 'tool.brokered', session: H, payload: { hsid: H, server: 'fs', tool: 'cat', decision: 'ran' }, at },
    ];
    const its = chatItems(rows).items.filter((i) => i.role === 'run');
    expect(its).toHaveLength(2);
    expect(its[0]).toMatchObject({ runKey: 'lr-1' });
    expect(its[1]!.runRow!.state).toBe('you denied it; nothing ran');
  });

  it('a skill run is "you ran skill /x args"; its replayed template is folded into it and never shown', () => {
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: 'The human ran repo skill review (from .claude/skills/review/SKILL.md, sha abc).\n\nDo the review of main' } });
    const rows: Row[] = [
      { seq: 1.5, kind: 'skill-ran', connId: 'local', session: H, payload: { name: 'review', args: 'main' }, turn: 't-1' },
      { seq: 2, kind: 'turn.sent', session: H, payload: { hsid: H, turn: 't-1' } },
      { seq: 3, kind: 'turn.event', session: H, view: 'full', payload: { hsid: H, type: 'user', line } },
    ];
    const users = chatItems(rows).items.filter((i) => i.role === 'user');
    expect(users.map((u) => u.text)).toEqual(['you ran skill /review main']);
    // after a reload (no page row) the replay reads as the run, never the skill's text
    const again = chatItems(rows.slice(1)).items.filter((i) => i.role === 'user');
    expect(again.map((u) => u.text)).toEqual(['you ran skill /review']);
  });
});

describe('#gui-slash-menu: wiring', () => {
  it('the composer hands ↑/↓/Enter/Esc to the menu first; the input opens it; rows reach the flow; the palette opens it', () => {
    expect(APP).toContain('if (slashMenu?.key(e)) return;');
    expect(APP).toContain("slashMenu?.input($<HTMLTextAreaElement>('composer-text').value, focused, e.isTrusted)");
    expect(APP).toContain('slashMenu?.flow.row(r);');
    expect(APP).toContain("else if (id === 'slash.open') openSlash(trusted);");
    expect(APP).toContain("focusCardGroup(v.cardId, 'card')");
  });
  it('the textarea keeps focus (aria-activedescendant), Esc closes only the menu, the shared trapTab, one persistent live line', () => {
    expect(UI).toContain("ta.setAttribute('aria-activedescendant', act.id)");
    expect(UI).toContain("list.addEventListener('mousedown', (e) => e.preventDefault())");
    expect(UI).toContain('e.stopPropagation(); // Esc closes only the menu');
    expect(UI).toContain("import { trapTab } from './tier-picker.js';");
    expect(UI).toContain("say.setAttribute('aria-live', 'polite')");
  });
});

describe("#gui-slash-menu: Mika's C6'b2-1 review (#2, #3)", () => {
  it('#3: until ↑/↓, the active row is the first enabled row on every refresh (skills arrive after commands)', async () => {
    let release!: (v: unknown) => void;
    const late = new Promise((r) => (release = r));
    const r = rig({ 'request.session.skills.list': [() => late] });
    r.flow.open(H, '', true);
    // before the read lands: the commands are first
    expect(r.flow.state()!.active).toBe('cmd:tools.open');
    release({ hsid: H, skills: [{ name: 'review', loaded: true }] });
    await tick();
    await tick();
    expect(r.flow.state()!.active).toBe('skill:review');
    // a disabled first row is skipped
    const d = rig({ 'request.session.skills.list': [{ hsid: H, skills: [{ name: 'aaa', loaded: false, why: 'x' }, { name: 'bbb', loaded: true }] }] });
    d.flow.open(H, '', true);
    await tick();
    expect(d.flow.state()!.active).toBe('skill:bbb');
    // once the human moved, a refresh keeps their row while it is shown
    d.flow.move(1);
    const chosen = d.flow.state()!.active;
    await d.flow.read();
    expect(d.flow.state()!.active).toBe(chosen);
  });
  it('#2: on any close, focus inside the menu (a field, Run, close) returns to the textarea, read before the panel empties', () => {
    const at = UI.indexOf('const inside = wrap.contains(doc.activeElement);');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(UI.indexOf('panel.replaceChildren();', at));
    expect(UI).toContain("if (inside || (f === 'textarea' && doc.activeElement === doc.body)) ta.focus();");
  });
});
