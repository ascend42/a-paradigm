/**
 * #gui-capability-browser (slice C6'b1): the Memory segment's press paths (the inline delete confirm, a double press,
 * deleting, done, refused, a delete lost in transit, focus after each outcome) and Settings › Local model › Kept memory
 * (KeptFlow, the section's rows, the sheet's `kept:` routing).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RpcError } from '../src/core/client.js';
import { emptyLocalUi } from '../src/core/local-model.js';
import { applyPreset } from '../src/core/commands.js';
import { settingsModel } from '../src/core/settings.js';
import type { DrawerRequest } from '../src/core/tools-drawer.js';
import { KeptFlow, ToolsFlow } from '../src/ui/tools-drawer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const tick = () => new Promise((r) => setTimeout(r, 0));
const ENTRIES = [
  { id: 'wm-1', kind: 'goal', source: 'human', text: 'fix the build' },
  { id: 'wm-2', kind: 'note', source: 'model', text: 'the test is flaky' },
];
const refusal = (reason: string) => new RpcError({ code: 'NOT_FOUND', reason, message: 'no such session memory for this principal', next: [], data: null });

function rig(del: Array<unknown | (() => unknown)> = [{ hsid: H, deleted: true, live: true }]) {
  const calls: DrawerRequest[] = [];
  const lives: string[] = [];
  let release: (() => void) | null = null;
  const flow = new ToolsFlow({
    call: async (req) => {
      calls.push(req);
      if (req.kind === 'request.session.capabilities') return { hsid: H, generation: 1, tier: 2, k: 12, verbs: [], servers: [], pins: [], tools: [] };
      if (req.kind === 'request.session.memory.read') return { hsid: H, live: true, entries: ENTRIES };
      // a delete waits until the test lets it go (to press twice while it is in flight)
      await new Promise<void>((r) => (release = r));
      const a = del.shift();
      return typeof a === 'function' ? (a as () => unknown)() : a;
    },
    repaint: () => undefined,
    live: (t) => void lives.push(t),
    now: () => '12:53',
  });
  return {
    flow,
    calls,
    lives,
    release: async () => {
      await tick();
      release?.();
      await tick();
    },
    deletes: () => calls.filter((c) => c.kind === 'request.session.memory.delete'),
  };
}
const open = async (r: ReturnType<typeof rig>, access: 'owner' | 'ended' = 'owner') => {
  r.flow.open({ hsid: H, title: 'fix', access }, 'memory', true);
  await tick();
  r.flow.takeFocus();
};

describe('#gui-capability-browser: Delete memory', () => {
  it('Delete memory… opens the inline confirm (no request) and focuses Keep; Keep closes it, focus back on Delete memory…', async () => {
    const r = rig();
    await open(r);
    expect(r.flow.memory()?.line).toBe('1 of 16 model notes');
    r.flow.memConfirm();
    expect(r.deletes()).toEqual([]);
    expect(r.flow.memory()?.foot.confirm).toBe('Delete this session’s working memory? The model loses its goal and notes. The conversation stays.');
    expect(r.flow.takeFocus()).toEqual({ act: 'mem-keep' });
    r.flow.memKeep();
    expect(r.flow.memory()?.foot.confirm).toBeNull();
    expect(r.flow.takeFocus()).toEqual({ act: 'mem-confirm' });
  });
  it('a double press sends ONE delete; deleting is aria-busy; done says what stays and the live line says "Memory deleted"', async () => {
    const r = rig();
    await open(r);
    r.flow.memConfirm();
    const a = r.flow.memDelete(false, true);
    const b = r.flow.memDelete(false, true);
    expect(r.flow.memory()?.foot.keys[0]).toMatchObject({ label: 'Deleting…', busy: true, ariaDisabled: true });
    await r.release();
    await Promise.all([a, b]);
    expect(r.deletes()).toEqual([{ kind: 'request.session.memory.delete', payload: { hsid: H } }]);
    expect(r.flow.memory()?.result?.text).toBe('Memory deleted. The conversation still shows what was said.');
    expect(r.flow.memory()?.yours).toEqual([]);
    expect(r.lives.at(-1)).toBe('Memory deleted');
    expect(r.flow.takeFocus()).toEqual({ result: true });
  });
  it('Delete and end session sends stop:true; the session reads as ended after', async () => {
    const r = rig([{ hsid: H, deleted: true, live: true, stopped: true }]);
    await open(r);
    r.flow.memConfirm();
    const a = r.flow.memDelete(true, true);
    await r.release();
    await a;
    expect(r.deletes()[0]!.payload).toEqual({ hsid: H, stop: true });
    expect(r.flow.memory()?.result?.text).toBe('Memory deleted and the session ended. The conversation still shows what was said.');
    expect(r.flow.state()?.access).toBe('ended');
  });
  it('refused: plain words and next:, never the code; focus back on Delete memory…', async () => {
    const r = rig([
      () => {
        throw refusal('not-found');
      },
    ]);
    await open(r);
    r.flow.memConfirm();
    const a = r.flow.memDelete(false, true);
    await r.release();
    await a;
    const res = r.flow.memory()!.result!;
    expect(res).toMatchObject({ fail: true });
    expect(res.text).toMatch(/^Not deleted: Gnomon holds no memory for this session any more · next: /);
    expect(res.text).not.toMatch(/NOT_FOUND|not-found/);
    expect(r.flow.takeFocus()).toEqual({ act: 'mem-confirm' });
  });
  it('a delete lost in transit claims nothing', async () => {
    const r = rig([
      () => {
        throw new Error('socket closed');
      },
    ]);
    await open(r);
    r.flow.memConfirm();
    const a = r.flow.memDelete(false, true);
    await r.release();
    await a;
    expect(r.flow.memory()?.result?.text).toBe('Not known whether it was deleted: the connection dropped · next: Read again once Gnomon is connected');
  });
  it('an untrusted press, or a press with no confirm open, sends nothing; an ended session cannot be "ended"', async () => {
    const r = rig();
    await open(r);
    await r.flow.memDelete(false, true); // no confirm open
    r.flow.memConfirm();
    await r.flow.memDelete(false, false);
    const e = rig();
    await open(e, 'ended');
    e.flow.memConfirm();
    await e.flow.memDelete(true, true);
    expect([...r.deletes(), ...e.deletes()]).toEqual([]);
  });
});

describe('#gui-capability-browser: Settings › Local model › Kept memory', () => {
  function keptRig(del: Array<unknown | (() => unknown)> = [{ hsid: 'h1', deleted: true, live: false }]) {
    const calls: DrawerRequest[] = [];
    const opened: string[] = [];
    const focus: unknown[] = [];
    const flow = new KeptFlow({
      call: async (req) => {
        calls.push(req);
        if (req.kind === 'request.session.memory.list') return { sessions: [{ hsid: 'h0', live: true }, { hsid: 'h1', live: false }, { hsid: 'h2', live: false }] };
        const a = del.shift();
        return typeof a === 'function' ? (a as () => unknown)() : a;
      },
      repaint: () => undefined,
      title: (h) => `title of ${h}`,
      open: (h) => void opened.push(h),
      focus: (f) => void focus.push(f),
    });
    return { flow, calls, opened, focus };
  }
  it('reads the ended sessions (the live one is not kept memory)', async () => {
    const k = keptRig();
    await k.flow.read();
    expect(k.flow.ui().sessions).toEqual([{ hsid: 'h1', title: 'title of h1' }, { hsid: 'h2', title: 'title of h2' }]);
  });
  it('Open opens the drawer on that session; Delete confirms inline (focus Keep), then deletes once', async () => {
    const k = keptRig();
    await k.flow.read();
    k.flow.press('kept:open', 'h1', true);
    expect(k.opened).toEqual(['h1']);
    k.flow.press('kept:delete', 'h1', true);
    expect(k.flow.ui().confirm).toBe('h1');
    expect(k.focus.at(-1)).toEqual({ act: 'kept:keep', value: 'h1' });
    k.flow.press('kept:delete-yes', 'h1', true);
    k.flow.press('kept:delete-yes', 'h1', true);
    await tick();
    expect(k.calls.filter((c) => c.kind === 'request.session.memory.delete')).toEqual([{ kind: 'request.session.memory.delete', payload: { hsid: 'h1' } }]);
    expect(k.flow.ui().sessions?.map((s) => s.hsid)).toEqual(['h2']);
    expect(k.flow.ui().result).toEqual({ lead: 'Deleted:', text: ' the memory of title of h1. The conversation stays.' });
    expect(k.focus.at(-1)).toEqual({ heading: true });
  });
  it('Keep and Esc close the confirm (focus back on Delete); refused says why in words', async () => {
    const k = keptRig([
      () => {
        throw refusal('bad-params');
      },
    ]);
    await k.flow.read();
    k.flow.press('kept:delete', 'h2', true);
    k.flow.press('kept:keep', 'h2', true);
    expect(k.flow.ui().confirm).toBeNull();
    expect(k.focus.at(-1)).toEqual({ act: 'kept:delete', value: 'h2' });
    k.flow.press('kept:delete', 'h2', true);
    expect(k.flow.escape()).toBe(true);
    expect(k.flow.escape()).toBe(false);
    k.flow.press('kept:delete', 'h2', true);
    k.flow.press('kept:delete-yes', 'h2', true);
    await tick();
    expect(k.flow.ui().result).toEqual({ text: 'Not deleted: the kernel refused it · next: close this and try again', fail: true });
    expect(k.flow.ui().sessions?.map((s) => s.hsid)).toEqual(['h1', 'h2']);
  });
  it('an untrusted press does nothing (not even Open)', async () => {
    const k = keptRig();
    await k.flow.read();
    k.flow.press('kept:open', 'h1', false);
    k.flow.press('kept:delete', 'h1', false);
    expect(k.opened).toEqual([]);
    expect(k.flow.ui().confirm).toBeNull();
  });
  it('the Local model section shows "Kept memory · N sessions" before its terminal line', async () => {
    const k = keptRig();
    await k.flow.read();
    const status = { local: { offered: true, config: { version: 1, endpoints: [{ id: 'fake', base: 'http://127.0.0.1:8080', model: 'qwen', loops: false }] } } };
    const secs = settingsModel({ theme: 'auto', motion: 'system', prefersDark: false, prefersReduced: false, layout: applyPreset('desk'), status, mode: null, connection: null, gui: { name: 'g', version: '1' }, unlock: { state: 'none', at: null, reason: null }, local: { ui: emptyLocalUi(), loopsUsing: [] }, kept: k.flow.ui() });
    const local = secs.find((s) => s.id === 'local-model')!;
    const ids = local.rows.map((r) => r.id);
    expect(ids.indexOf('kept-memory')).toBeGreaterThan(0);
    expect(ids.indexOf('kept-memory')).toBeLessThan(ids.indexOf('local-term'));
    expect(local.rows.find((r) => r.id === 'kept-memory')).toMatchObject({ label: 'Kept memory', value: '2 sessions' });
  });
  it('the sheet routes kept: keys (trusted, never aria-disabled ones), reads the list on open, Esc closes the confirm first', () => {
    const sheet = readFileSync(path.join(ROOT, 'src', 'ui', 'settings-sheet.ts'), 'utf8');
    expect(sheet).toMatch(/startsWith\('kept:'\)\) \{\s*if \(lm\.getAttribute\('aria-disabled'\) === 'true'\) return;[^]*d\.kept\?\.press\(lm\.dataset\.lmAct!, lm\.dataset\.lmValue \?\? null, e\.isTrusted\)/);
    expect(sheet).toContain('d.onOpen?.();');
    expect(sheet).toContain('if (d.kept?.escape()) return;');
    const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    expect(app).toContain('onOpen: () => void kept.read(),');
    expect(app).toContain('kept: kept.ui(),');
  });
});
