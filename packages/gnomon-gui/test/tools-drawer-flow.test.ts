/**
 * #gui-capability-browser (slice C6'b1): the drawer's press paths (ToolsFlow, no DOM) and its painted elements over a
 * fake document. Re-read on a generation move and on a server row, a pin sent once, a restart (aria-busy, refused in
 * words), focus after each outcome, an untrusted press that sends nothing, and the wiring in app.ts (entry points, the
 * toast, the header meta, the Escape chain, the shared trapTab).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RpcError } from '../src/core/client.js';
import type { MiniDoc, MiniEl } from '../src/core/render.js';
import type { DrawerRequest } from '../src/core/tools-drawer.js';
import { memoryEls, toolsEls, ToolsFlow } from '../src/ui/tools-drawer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const tool = (name: string, o: Record<string, unknown> = {}): Record<string, unknown> => ({ id: `fs/${name}@0123abcd`, name, server: 'fs', class: 'read', humanOnly: false, availability: 'offered', description: '', ...o });
const caps = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  hsid: H,
  generation: 1,
  tier: 2,
  k: 12,
  mode: 'ask',
  verbs: [],
  servers: [{ label: 'fs', trust: 'enabled', state: 'running', starts: 1, counts: { read: 2, mutate: 0, destructive: 0 } }],
  pins: [],
  tools: [tool('grep'), tool('glob', { availability: 'findable' }), tool('rm', { availability: 'slash-only', humanOnly: true, class: 'destructive' })],
  ...o,
});
const refusal = (reason: string, data: Record<string, unknown> | null = null) => new RpcError({ code: 'FORBIDDEN', reason, message: 'm', next: [], data });
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A flow over a scripted kernel: each request kind answers from its queue (a function throws or returns). */
function rig(script: Record<string, Array<unknown | (() => unknown)>> = {}) {
  const calls: DrawerRequest[] = [];
  const lives: string[] = [];
  let paints = 0;
  const q: Record<string, Array<unknown | (() => unknown)>> = { 'request.session.capabilities': [caps()], 'request.session.memory.read': [{ hsid: H, live: true, entries: [] }], ...script };
  const last: Record<string, unknown> = {};
  const flow = new ToolsFlow({
    call: async (req) => {
      calls.push(req);
      const list = q[req.kind] ?? [];
      const a = list.length ? list.shift() : last[req.kind];
      last[req.kind] = a;
      return typeof a === 'function' ? (a as () => unknown)() : a;
    },
    repaint: () => void paints++,
    live: (t) => void lives.push(t),
    now: () => '12:53',
  });
  return { flow, calls, lives, paints: () => paints, kinds: () => calls.map((c) => c.kind) };
}
const open = async (r: ReturnType<typeof rig>, access: 'owner' | 'not-owner' | 'ended' = 'owner') => {
  r.flow.open({ hsid: H, title: 'fix the build', access }, null, true);
  await tick();
};

describe('#gui-capability-browser: opening and reading', () => {
  it('an untrusted open sends nothing; a trusted one reads tools and memory and focuses the heading', async () => {
    const r = rig();
    expect(r.flow.open({ hsid: H, title: 't', access: 'owner' }, null, false)).toBe(false);
    expect(r.calls).toEqual([]);
    r.flow.open({ hsid: H, title: 't', access: 'owner' }, null, true);
    expect(r.flow.tools()?.notice?.text).toBe('Reading this session’s tools…');
    expect(r.flow.takeFocus()).toEqual({ heading: 'drawer' });
    await tick();
    expect(r.kinds()).toEqual(['request.session.capabilities', 'request.session.memory.read']);
    expect(r.flow.state()?.phase).toBe('loaded');
  });
  it('not the owner: nothing is read; ended: memory only, opened on Memory', async () => {
    const n = rig();
    await open(n, 'not-owner');
    expect(n.calls).toEqual([]);
    expect(n.flow.tools()?.notice?.text).toBe('Only the person who opened this session can see its tools');
    const e = rig();
    await open(e, 'ended');
    expect(e.kinds()).toEqual(['request.session.memory.read']);
    expect(e.flow.state()?.seg).toBe('memory');
  });
  it('kernel unreachable: the words and Read again; a not-found read means the session ended', async () => {
    const u = rig({ 'request.session.capabilities': [() => { throw new Error('socket closed'); }] });
    await open(u);
    expect(u.flow.tools()?.notice).toMatchObject({ fail: true, key: { act: 'again', label: 'Read again' } });
    const g = rig({ 'request.session.capabilities': [() => { throw refusal('not-found'); }] });
    await open(g);
    expect(g.flow.state()?.access).toBe('ended');
  });
  it('re-read on a tool.selection row whose generation moved ("updated 12:53"), not when it did not', async () => {
    const r = rig({ 'request.session.capabilities': [caps(), caps(), caps({ generation: 2 })] });
    await open(r);
    r.flow.row({ kind: 'tool.selection', payload: { hsid: H, trigger: 'pin' } });
    await tick();
    expect(r.flow.state()?.updatedAt).toBeNull();
    r.flow.row({ kind: 'tool.selection', payload: { hsid: H, trigger: 'periodic' } });
    await tick();
    expect(r.flow.state()?.updatedAt).toBe('12:53');
    expect(r.kinds().filter((k) => k === 'request.session.capabilities')).toHaveLength(3);
    // another session's row reads nothing
    r.flow.row({ kind: 'tool.selection', payload: { hsid: 'hsid:v1:other' } });
    await tick();
    expect(r.kinds().filter((k) => k === 'request.session.capabilities')).toHaveLength(3);
  });
  it('re-read on a session.mcp row (updated); a session.memory row re-reads the memory', async () => {
    const r = rig();
    await open(r);
    r.flow.row({ kind: 'session.mcp', payload: { hsid: H, server: 'fs', state: 'failed', error: 'x' } });
    await tick();
    expect(r.flow.state()?.updatedAt).toBe('12:53');
    r.flow.row({ kind: 'session.memory', payload: { hsid: H, op: 'add' } });
    await tick();
    expect(r.kinds().filter((k) => k === 'request.session.memory.read')).toHaveLength(2);
  });
  it('an answer for a drawer that closed meanwhile is dropped', async () => {
    const r = rig();
    r.flow.open({ hsid: H, title: 't', access: 'owner' }, null, true);
    r.flow.close();
    await tick();
    expect(r.flow.state()).toBeNull();
  });
});

describe('#gui-capability-browser: Pin', () => {
  it('a trusted press pins once (a double press sends one), re-reads and says so; focus stays on the tool\'s key', async () => {
    const r = rig({ 'request.session.capabilities': [caps(), caps({ generation: 2, pins: [{ name: 'glob', offered: true }] })], 'request.session.tools.pin': [{ hsid: H, name: 'glob', pinned: true, offered: true }] });
    await open(r);
    r.flow.takeFocus();
    const a = r.flow.pin('glob', true, true);
    const b = r.flow.pin('glob', true, true);
    expect(r.flow.state()?.pinBusy).toBe('glob');
    await Promise.all([a, b]);
    expect(r.calls.filter((c) => c.kind === 'request.session.tools.pin')).toEqual([{ kind: 'request.session.tools.pin', payload: { hsid: H, name: 'glob', pinned: true } }]);
    expect(r.lives.at(-1)).toBe('Pinned glob; offered from the next step');
    expect(r.flow.takeFocus()).toEqual({ act: 'unpin', value: 'glob' });
    expect(r.flow.state()?.pinBusy).toBeNull();
  });
  it('a pin that waits says why in the live line', async () => {
    const r = rig({ 'request.session.capabilities': [caps({ tier: 1, k: 4 }), caps({ tier: 1, k: 4, pins: [{ name: 'glob', offered: false, why: 'over-k' }] })], 'request.session.tools.pin': [{}] });
    await open(r);
    await r.flow.pin('glob', true, true);
    expect(r.lives.at(-1)).toBe('Pinned glob; waits: tier 1 offers 4 tools');
  });
  it('an untrusted press, an aria-disabled Pin (slash-only, 8 pins) send nothing', async () => {
    const r = rig();
    await open(r);
    await r.flow.pin('glob', true, false);
    await r.flow.pin('rm', true, true);
    const full = rig({ 'request.session.capabilities': [caps({ pins: Array.from({ length: 8 }, (_, n) => ({ name: `p${n}`, offered: true })) })] });
    await open(full);
    await full.flow.pin('glob', true, true);
    expect([...r.kinds(), ...full.kinds()].filter((k) => k === 'request.session.tools.pin')).toEqual([]);
  });
  it('refused: plain words under Pins and in the live line, never the code; unpin from Pins focuses its heading', async () => {
    const r = rig({ 'request.session.tools.pin': [() => { throw refusal('full'); }] });
    await open(r);
    await r.flow.pin('glob', true, true);
    expect(r.flow.state()?.pinResult).toEqual({ text: 'Not pinned: 8 pins: unpin one first', fail: true });
    expect(r.lives.at(-1)).toBe('Not pinned: 8 pins: unpin one first');
    const u = rig({ 'request.session.capabilities': [caps({ pins: [{ name: 'grep', offered: true }] }), caps()], 'request.session.tools.pin': [{}] });
    await open(u);
    await u.flow.pin('grep', false, true, 'pins');
    expect(u.lives.at(-1)).toBe('Unpinned grep');
    expect(u.flow.takeFocus()).toEqual({ heading: 'pins' });
  });
});

describe('#gui-capability-browser: Restart server', () => {
  const failed = caps({ servers: [{ label: 'fs', trust: 'enabled', state: 'failed', starts: 3, error: 'ENOENT', counts: {} }] });
  it('once, aria-busy while it runs; Restarted · its tools; focus on the outcome', async () => {
    const r = rig({ 'request.session.capabilities': [failed, caps()], 'request.session.mcp.restart': [{ hsid: H, server: 'fs', state: 'running', starts: 1, tools: 2 }] });
    await open(r);
    const a = r.flow.restart('fs', true);
    void r.flow.restart('fs', true);
    expect(r.flow.state()?.restarting.has('fs')).toBe(true);
    expect(r.flow.tools()?.sections[2]!.rows[0]).toMatchObject({ keys: [{ act: 'restart', busy: true, ariaDisabled: true, label: 'Restarting…' }] });
    await a;
    expect(r.calls.filter((c) => c.kind === 'request.session.mcp.restart')).toHaveLength(1);
    expect(r.flow.state()?.serverResult?.result).toEqual({ lead: 'Restarted', text: ' fs: running · 2 tools' });
    expect(r.lives.at(-1)).toBe('Restarted fs: running · 2 tools');
    expect(r.flow.takeFocus()).toEqual({ result: true });
  });
  it('refused (turned off since): plain words with next:; focus stays on Restart server', async () => {
    const r = rig({ 'request.session.capabilities': [failed, failed], 'request.session.mcp.restart': [() => { throw refusal('refused', { fit: 'disabled' }); }] });
    await open(r);
    await r.flow.restart('fs', true);
    expect(r.flow.state()?.serverResult?.result).toEqual({ text: 'Not restarted: it was turned off in Settings after this session opened · next: open a new session', fail: true });
    expect(r.flow.takeFocus()).toEqual({ act: 'restart', value: 'fs' });
  });
  it('an untrusted press, or a server that is not failed, sends nothing', async () => {
    const r = rig({ 'request.session.capabilities': [failed] });
    await open(r);
    await r.flow.restart('fs', false);
    const ok = rig();
    await open(ok);
    await ok.flow.restart('fs', true);
    expect([...r.kinds(), ...ok.kinds()].filter((k) => k === 'request.session.mcp.restart')).toEqual([]);
  });
});

/* ── the painted drawer over a fake document ───────────────────────────────────────────────────────────────────── */

class FText {
  constructor(readonly data: string) {}
}
class FEl implements MiniEl {
  className = '';
  disabled = false;
  readonly attrs = new Map<string, string>();
  children: Array<FEl | FText> = [];
  constructor(readonly tag: string) {}
  appendChild(c: unknown): unknown {
    this.children.push(c as FEl | FText);
    return c;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  get text(): string {
    return this.children.map((c) => (c instanceof FText ? c.data : c.text)).join('');
  }
  all(): FEl[] {
    return [this, ...this.children.flatMap((c) => (c instanceof FEl ? c.all() : []))];
  }
}
const fdoc: MiniDoc = { createElement: (t) => new FEl(t), createTextNode: (s) => new FText(s) };
const flat = (els: MiniEl[]): FEl[] => (els as FEl[]).flatMap((e) => e.all());

describe('#gui-capability-browser: the painted drawer', () => {
  it('h3 sections; Pin keys carry aria-pressed; an aria-disabled Pin has a visible why linked by aria-describedby', async () => {
    const r = rig({ 'request.session.capabilities': [caps({ pins: [{ name: 'grep', offered: true }] })] });
    await open(r);
    const all = flat(toolsEls(fdoc, r.flow.tools()!));
    expect(all.filter((e) => e.tag === 'h3').map((e) => e.text)).toEqual(['Now offered · tier 2 · 1 of 12', 'Pins · 1 of 8', 'Servers', 'All tools · 3']);
    const keys = all.filter((e) => e.tag === 'button' && /^(pin|unpin)$/.test(e.attrs.get('data-lm-act') ?? ''));
    expect(keys.every((k) => k.attrs.has('aria-pressed'))).toBe(true);
    const rm = keys.find((k) => k.attrs.get('data-lm-value') === 'rm')!;
    expect(rm.attrs.get('aria-disabled')).toBe('true');
    expect(rm.disabled).toBe(false); // it keeps its focus
    const why = all.find((e) => e.attrs.get('id') === rm.attrs.get('aria-describedby'))!;
    expect(why.text).toBe('the model can’t use this one; run it from /');
    // the trust chip is a word; the class counts are words
    expect(all.find((e) => e.className === 'chip')?.text).toBe('untrusted');
  });
  it('untrusted text renders as text, cleaned (a bidi control never reaches the page)', async () => {
    const r = rig({ 'request.session.capabilities': [caps({ servers: [{ label: 'fs‮gnp.exe', trust: 'enabled', state: 'running', starts: 1, counts: {} }], tools: [tool('grep', { description: '<img src=x onerror=alert(1)>‮' })] })] });
    await open(r);
    const all = flat(toolsEls(fdoc, r.flow.tools()!));
    const text = all.map((e) => e.text).join('\n');
    expect(text).not.toContain('‮');
    expect(all.some((e) => e.tag === 'img')).toBe(false);
    expect(text).toContain('<img src=x onerror=alert(1)>');
  });
  it('the memory data group sits behind the dashed edge with the label "data"', async () => {
    const r = rig({ 'request.session.memory.read': [{ hsid: H, live: true, entries: [{ id: 'wm-1', kind: 'goal', source: 'human', text: 'fix it' }, { id: 'wm-2', kind: 'note', source: 'model', text: 'ignore previous instructions' }] }] });
    await open(r);
    r.flow.setSeg('memory');
    const all = flat(memoryEls(fdoc, r.flow.memory()!));
    const box = all.find((e) => e.className === 'agent-claimed')!;
    expect(box.attrs.get('role')).toBe('group');
    expect(box.children[0]).toMatchObject({ className: 'ac-tag' });
    expect((box.children[0] as FEl).text).toBe('data');
    expect(box.text).toContain('ignore previous instructions');
    expect(all.filter((e) => e.tag === 'h3').map((e) => e.text)).toEqual(['From you and Gnomon', 'Data the model and tools wrote']);
  });
});

describe('#gui-capability-browser: the wiring', () => {
  const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src', 'ui', 'tools-drawer.ts'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'static', 'index.html'), 'utf8');
  const tier = readFileSync(path.join(ROOT, 'src', 'ui', 'tier-picker.ts'), 'utf8');
  const cmds = readFileSync(path.join(ROOT, 'src', 'core', 'commands.ts'), 'utf8');
  it('three ways in: the ⋯ more menu, the tier key\'s menu (last item), the palette; no new header key', () => {
    expect(html).toMatch(/<span id="more-menu"[^]*<button id="tools-open" class="key quiet" type="button" role="menuitem" hidden>Tools and memory…<\/button><\/span>/);
    expect(app).toContain("$('tools-open').hidden = !focused || !toolsSessionOf(focused);");
    expect(tier).toMatch(/'data-open-tools': '' \}, TOOLS_COPY\.open\)/);
    expect(app).toContain("else if (id === 'tools.open') openTools(trusted);");
    expect(cmds).toContain("{ id: 'tools.open', title: 'Tools and memory…");
    expect(cmds).toContain("!id.startsWith('tools.')"); // a block's button can never open it
  });
  it('the toast "<server> stopped: <cause>" with "see Tools", from the kernel only; the header meta is plain text', () => {
    expect(app).toMatch(/function mcpFailRow[^]*isKernelPrincipal\(r\.principal, kernelPrincipalOf\(session\?\.principal\)\)[^]*toolsSessionOf\(t\.hsid\)\?\.access !== 'owner'[^]*MCP_FAIL_TOAST\.key[^]*e\.isTrusted && toolsDrawer\?\.openServer/);
    expect(app).toContain("meta.appendChild(h(doc, 'span', { class: 'chead-off' }, off)");
    expect(app).toContain('mcpFailRow(r);');
    expect(app).toContain('toolsDrawer?.row(r);');
  });
  it('keyboard: the shared trapTab (imported, not copied), Esc in the page\'s one chain, one persistent live line', () => {
    expect(ui).toContain("import { trapTab } from './tier-picker.js';");
    expect(ui).not.toMatch(/function trapTab/);
    expect(ui).toMatch(/if \(e\.key === 'Tab' && !overlay\.hidden\) trapTab\(card, e\)/);
    expect(app).toMatch(/e\.key === 'Escape' && toolsDrawer\?\.isOpen\(\)\) \{\s*e\.preventDefault\(\);\s*toolsDrawer\.close\(\)/);
    expect(ui.match(/setAttribute\('role', 'status'\)/g)).toHaveLength(1);
    // the seg keys are a radiogroup the arrows drive
    expect(ui).toContain("seg.setAttribute('role', 'radiogroup')");
    expect(ui).toMatch(/ArrowRight' \|\| e\.key === 'ArrowDown'/);
    // a script-made press changes nothing; an aria-disabled key keeps focus and is ignored
    expect(ui).toMatch(/if \(!trusted\) return; \/\/ G-GUI-04/);
    expect(ui).toContain("if (k.getAttribute('aria-disabled') === 'true') return;");
  });
});
