/**
 * #gui-local-model (TD-2026-10-22-769; Atelier session 2026-10-22-gnomon-local-model): the Settings sheet's Local
 * model section in every state, the form's checks, the press paths (keyboard and focus: Esc order, focus on the first
 * invalid field, one request at a time), the card's row table (Aegis L4 parity with the shared decision-batch
 * vectors), the loop detail's can't-start line and the palette entry.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RpcError } from '../src/core/client.js';
import { paletteEntries } from '../src/core/commands.js';
import { addressError, changeForm, emptyLocalUi, formErrors, localSection, localStatusOf, probeVerdict, setupForm, type LocalUi } from '../src/core/local-model.js';
import { cantStart, detailKeys, loopAlerts, loopGroups, loopsOf, runRefusalOf, startLine } from '../src/core/loops.js';
import { cardContentHash, helperLineLength, localRowOf, renderCard, rootRowsOf, type MiniDoc, type MiniEl } from '../src/core/render.js';
import type { SettingRow } from '../src/core/settings.js';
import { LocalModelController, type LocalDeps } from '../src/ui/local-model.js';
import { compositionGate, paintSettings } from '../src/ui/settings-sheet.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const time = (iso: string): string => iso.slice(11, 16);
const EP = { id: 'ollama', base: 'http://127.0.0.1:11434', model: 'qwen2.5-coder:14b', compat: 'ollama', loops: true };
const RUNNER = { dir: '/Applications/Gnomon.app/Contents/Resources/kernel/dist/gnomon-local', entry: 'cli.js', treeSha256: '9c41e0b2'.padEnd(60, '1') + '3a7f', source: 'bundled', version: '8.0.0', node: '/Applications/Gnomon.app/Contents/Resources/node/bin/node', nodeSha256: '5e2a90c1'.padEnd(64, '0') };
const local = (o: Record<string, unknown> = {}) => ({ local: { offered: true, configured: true, version: 1, signedAt: '2026-10-22T23:23:00.000Z', signer: 'rk:1', endpoints: [EP], runner: RUNNER, defaultRunner: { source: 'bundled', dir: RUNNER.dir, version: '8.0.0' }, lastProbe: { endpoint: 'ollama', at: '2026-10-22T23:24:00.000Z', ok: true, why: 'capable', tools: true, contextSize: 32768 }, lastFallback: null, pendingCardId: null, unsupported: null, ...o } });
const NONE = local({ configured: false, endpoints: [], runner: null, version: null, signedAt: null, lastProbe: null });
const sec = (status: unknown, ui: LocalUi = emptyLocalUi(), loopsUsing: string[] = []) => localSection({ status, ui, loopsUsing, time });
const row = (rows: SettingRow[], id: string) => rows.find((r) => r.id === id);
const valueOf = (r: SettingRow | undefined): string => (r && r.kind === 'readonly' ? `${r.mark ? `${r.mark} ` : ''}${r.value}` : '');

describe('#gui-local-model: the section in every state', () => {
  it('heading says kernel-owned once; the intro; the terminal form', () => {
    const s = sec(NONE);
    expect([s.id, s.title, s.owner]).toEqual(['local-model', 'Local model', '· kernel-owned']);
    expect(s.intro).toMatch(/^A model server on this Mac/);
    expect(s.rows.at(-1)).toMatchObject({ kind: 'term', code: 'gnomon local status | set | remove' });
  });
  it('not connected, not offered, Windows (no key at all), none set up', () => {
    expect(valueOf(sec(null).rows[0])).toBe('not connected');
    expect(valueOf(sec({}).rows[0])).toBe('not offered by this kernel');
    const w = sec(local({ unsupported: 'platform', endpoints: [] }));
    expect(valueOf(w.rows[0])).toBe('not on Windows in 8.0');
    expect(w.rows.some((r) => r.kind === 'form')).toBe(false);
    const n = sec(NONE);
    expect(valueOf(n.rows[0])).toBe('none set up');
    expect(row(n.rows, 'local-form')).toMatchObject({ kind: 'form', keys: [{ act: 'setup', label: 'Set up local model…', pri: true }] });
  });
  it('set up: rows grouped by space, the check passed in ink, Change… and Turn off', () => {
    const r = sec(local()).rows;
    expect(valueOf(row(r, 'local-endpoint-0'))).toBe('ollama · http://127.0.0.1:11434');
    expect(valueOf(row(r, 'local-check'))).toBe('✓ answers · tools native · context 32 768 · 23:24');
    expect(row(r, 'local-check')).toMatchObject({ grp: true, live: true });
    expect(valueOf(row(r, 'local-runner'))).toBe('gnomon-local 8.0.0 · bundled · tree 9c41e0b2');
    expect(valueOf(row(r, 'local-signed'))).toBe('config v1 · 23:23 · root key');
    expect(valueOf(row(r, 'local-fallback'))).toBe('none since it was set');
    expect(row(r, 'local-form')).toMatchObject({ keys: [{ act: 'change', label: 'Change…' }, { act: 'turn-off', label: 'Turn off', quiet: true }] });
  });
  it('checking, check failed (Check again), no tools, short context, unknown context, no runner', () => {
    // the kernel says a probe is in flight (status.local.probing), never inferred from an empty lastProbe
    expect(valueOf(row(sec(local({ lastProbe: null, probing: true, probingSince: '2026-10-22T23:23:00.000Z', probingEndpoint: 'ollama' })).rows, 'local-check'))).toBe('checking… started 23:23');
    expect(valueOf(row(sec(local({ probing: true, probingSince: '2026-10-22T23:25:00.000Z' })).rows, 'local-check'))).toBe('checking… started 23:25');
    const never = row(sec(local({ lastProbe: null, probing: false })).rows, 'local-check');
    expect(valueOf(never)).toBe('not checked yet');
    expect(never).toMatchObject({ keys: [{ act: 'check', label: 'Check now' }] });
    const failed = row(sec(local({ lastProbe: { at: '2026-10-22T23:24:00.000Z', ok: false, why: 'probe-failed', error: 'unreachable:ECONNREFUSED', tools: false, contextSize: null } })).rows, 'local-check');
    expect(valueOf(failed)).toBe('✕ no answer: connection refused · 23:24');
    expect(failed).toMatchObject({ keys: [{ act: 'check', label: 'Check again' }] });
    const p = (why: string, contextSize: number | null = null) => valueOf(row(sec(local({ lastProbe: { at: '2026-10-22T23:24:00.000Z', ok: false, why, tools: why !== 'no-tools', contextSize } })).rows, 'local-check'));
    expect(p('no-tools')).toMatch(/^✕ answers, but can’t call tools/);
    expect(p('ctx-below-floor', 4096)).toMatch(/^✕ context 4 096: sessions need 8 192/);
    expect(p('ctx-unknown')).toMatch(/^\? context size unknown/);
    expect(valueOf(row(sec(local({ runner: null })).rows, 'local-check'))).toBe('✕ runner not pinned');
  });
  it('the last fallback names the folder and the reason', () => {
    const r = sec(local({ lastFallback: { at: '2026-10-22T23:31:00.000Z', cwd: '/Users/m/code/billing', title: null, reason: 'probe-failed' } })).rows;
    expect(valueOf(row(r, 'local-fallback'))).toBe('23:31 · “billing” asked for local and got a fallback card: no answer');
  });
  it('form, invalid, checking, card waiting, denied, expired, change with its diff, turn off confirm', () => {
    const open: LocalUi = { ...emptyLocalUi(), form: { ...setupForm(), model: 'qwen2.5-coder:14b' }, open: true };
    const f = row(sec(NONE, open).rows, 'local-form');
    expect(f && f.kind === 'form' && f.form?.keys[0]).toMatchObject({ label: 'Save · root card', submit: true });
    expect(f && f.kind === 'form' && f.form?.fields.map((x) => x.label)).toEqual(['server', 'address', 'model', 'used by']);
    const inv = row(sec(NONE, { ...open, errors: { base: '✕ x' } }).rows, 'local-form');
    expect(inv && inv.kind === 'form' && inv.form?.fields[1]).toMatchObject({ error: '✕ x' });
    const chk = row(sec(NONE, { ...open, busy: 'checking' }).rows, 'local-form');
    expect(chk && chk.kind === 'form' && chk.form?.keys[0]).toMatchObject({ label: 'Checking…', disabled: true, busy: true });
    expect(chk && chk.kind === 'form' && chk.form?.result?.text).toBe('checking 127.0.0.1:11434 before raising the card…');
    const wait = row(sec(NONE, { ...emptyLocalUi(), request: { cardId: 'card:1', at: 0, line: '23:20 · ollama · 127.0.0.1:11434 · qwen2.5-coder:14b · sessions and loops', entries: null } }).rows, 'local-request');
    expect(wait).toMatchObject({ kind: 'request', chip: 'card waiting', keys: [{ act: 'decide', label: 'Decide in the stack' }] });
    const den = row(sec(NONE, { ...open, result: { lead: 'Not changed:', text: ' you denied the card at 23:22. Your entries are below.' } }).rows, 'local-form');
    expect(den && den.kind === 'form' && den.form?.result?.lead).toBe('Not changed:');
    const ch = changeForm(EP);
    const same = row(sec(local(), { ...emptyLocalUi(), form: ch, open: true }).rows, 'local-form');
    expect(same && same.kind === 'form' && same.form).toMatchObject({ whyOff: 'no change' });
    const diff = row(sec(local(), { ...emptyLocalUi(), form: { ...ch, model: 'qwen2.5-coder:32b' }, open: true }).rows, 'local-form');
    expect(diff && diff.kind === 'form' && diff.form?.changes).toBe('model qwen2.5-coder:14b → qwen2.5-coder:32b');
    const off = row(sec(local(), { ...emptyLocalUi(), confirmOff: true }, ['evening-tidy', 'green-typecheck-gnomon']).rows, 'local-form');
    expect(off && off.kind === 'form' && off.confirm?.text).toBe('Turn off qwen2.5-coder:14b? 2 loops use it: evening-tidy, green-typecheck-gnomon. They won’t start until you set one up again, and that takes a card and your password.');
  });
  it('paints through h() into a fake document (form tag, ids linking errors)', () => {
    const els: Array<{ tag: string; attrs: Map<string, string> }> = [];
    const mk = (tag: string): MiniEl & { attrs: Map<string, string> } => {
      const e = { tag, className: '', attrs: new Map<string, string>(), kids: [] as unknown[], appendChild(c: unknown) { this.kids.push(c); return c; }, setAttribute(n: string, v: string) { this.attrs.set(n, v); } };
      els.push(e);
      return e;
    };
    const doc: MiniDoc = { createElement: mk, createTextNode: (t) => t };
    const body = { firstChild: null, removeChild: () => null, appendChild: (c: unknown) => c };
    paintSettings(doc, body, [sec(NONE, { ...emptyLocalUi(), form: setupForm(), open: true, errors: { model: '✕ m' } })], 'local-model');
    expect(els.some((e) => e.tag === 'form')).toBe(true);
    const input = els.find((e) => e.attrs.get('data-lm-field') === 'model')!;
    expect(input.attrs.get('aria-invalid')).toBe('true');
    expect(els.find((e) => e.attrs.get('id') === input.attrs.get('aria-describedby'))).toBeTruthy();
    expect(els.find((e) => e.tag === 'h3')!.attrs.get('tabindex')).toBe('-1');
  });
});

describe('#gui-local-model: review fixes (Mika)', () => {
  it('with two endpoints, Change names the one it edits and Check names the endpoint it checked', () => {
    const two = local({ endpoints: [EP, { id: 'coder', base: 'http://127.0.0.1:8080', model: 'm', compat: 'llama.cpp', loops: false }], lastProbe: { endpoint: 'coder', at: '2026-10-22T23:24:00.000Z', ok: true, why: 'capable', tools: true, contextSize: 32768 } });
    const s = sec(two);
    expect(valueOf(row(s.rows, 'local-check'))).toMatch(/^✓ coder · answers/);
    const f = row(s.rows, 'local-form');
    expect(f && f.kind === 'form' ? f.keys.map((k) => k.label) : []).toEqual(['Change ollama…', 'Turn off']);
    // one endpoint: the plain words
    const one = sec(local());
    expect(valueOf(row(one.rows, 'local-check'))).toMatch(/^✓ answers/);
    const g = row(one.rows, 'local-form');
    expect(g && g.kind === 'form' ? g.keys[0]!.label : '').toBe('Change…');
  });
  it('styles: a disabled pri key reads (F10 migration); the heading never shows the browser ring', () => {
    const css = readFileSync(path.join(ROOT, 'static/styles.css'), 'utf8');
    expect(css).toContain('.key.pri[disabled] { background: var(--sheet); color: var(--sec); border-color: var(--rule); box-shadow: none; }');
    expect(css).toContain('.settings-h:focus-visible { outline: 2px solid var(--key-edge); outline-offset: 2px; }');
  });
});

describe('#gui-local-model: the page checks (before any request)', () => {
  it('malformed, LAN, cloud, port, path, case', () => {
    expect(addressError('127.0.0.1:11434', 'ollama')).toBe('✕ Not an address: start it with http://');
    expect(addressError('http://192.168.1.20:11434', 'ollama')).toBe('✕ 192.168.1.20 is another machine on your network. In 8.0 the server must be on this Mac: use 127.0.0.1 or localhost.');
    expect(addressError('https://api.anthropic.com', 'ollama')).toBe('✕ api.anthropic.com is not a local server');
    expect(addressError('http://127.0.0.1', 'ollama')).toBe('✕ Add the port, e.g. :11434');
    expect(addressError('http://127.0.0.1:65536', 'ollama')).toMatch(/1 to 65535/);
    expect(addressError('http://127.0.0.1:١١٤٣٤', 'ollama')).toMatch(/1 to 65535/);
    expect(addressError('http://127.0.0.1:11434/v1', 'ollama')).toMatch(/Leave out the path/);
    expect(addressError('http://LOCALHOST:11434', 'ollama')).toMatch(/lower case/);
    expect(addressError('http://localhost:1234', 'lm-studio')).toBeNull();
    expect(addressError('http://[::1]:8080/', 'llama.cpp')).toBeNull();
  });
  it('model and the advanced fields', () => {
    const e = formErrors({ ...setupForm(), model: '', id: '-x', runner: 'rel/dir' });
    expect(Object.keys(e)).toEqual(['model', 'id', 'runner']);
    expect(e.model).toBe('✕ Name the model as `ollama list` shows it, e.g. qwen2.5-coder:14b.');
    expect(formErrors({ ...setupForm(), model: 'qwen‮coder' }).model).toBeTruthy();
  });
  it('C1 check-first: only an answer with the model listed raises the card', () => {
    const f = { ...setupForm(), model: 'qwen2.5-coder:14b' };
    expect(probeVerdict({ ok: true, why: 'capable', toolsNative: true, contextSize: 32768, model: f.model }, f)).toEqual({ go: true });
    expect(probeVerdict({ ok: false, why: 'probe-failed', error: 'unreachable', toolsNative: false, contextSize: null, model: f.model }, f)).toMatchObject({ go: false, field: 'base' });
    expect(probeVerdict({ ok: false, why: 'model-missing', toolsNative: true, contextSize: null, model: f.model }, f)).toMatchObject({ go: false, field: 'model' });
    expect(probeVerdict({ ok: false, why: 'no-tools', toolsNative: false, contextSize: 8192, model: f.model }, f)).toEqual({ go: true });
  });
});

/** A controller over a fake kernel. */
function rig(status: unknown = NONE, answers: Record<string, Array<unknown | (() => never)>> = {}) {
  const calls: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const focus: unknown[] = [];
  const decided: string[] = [];
  const toasts: string[] = [];
  const refreshed: number[] = [];
  let open = true;
  const d: LocalDeps = {
    call: async (req) => {
      calls.push(req);
      const q = answers[req.kind]?.shift();
      if (typeof q === 'function') return (q as () => never)();
      return q ?? (req.kind === 'request.local.probe' ? { ok: true, why: 'capable', toolsNative: true, contextSize: 32768, model: 'm', listed: true } : { pending: true, cardId: 'card:L1' });
    },
    status: () => (typeof status === 'function' ? (status as () => unknown)() : status),
    loopsUsing: () => ['evening-tidy'],
    now: () => Date.parse('2026-10-22T23:20:00.000Z'),
    time,
    refreshStatus: async () => void refreshed.push(calls.length),
    repaint: () => undefined,
    focus: (t) => void focus.push(t),
    decide: (id) => {
      open = false;
      decided.push(id);
    },
    sheetOpen: () => open,
    toast: (t) => void toasts.push(t),
    wait: async () => undefined,
  };
  return { c: new LocalModelController(d), calls, focus, decided, toasts, refreshed };
}
const refusal = (data: Record<string, unknown>, reason = 'bad-params') => () => {
  throw new RpcError({ code: 'BAD_REQUEST', reason, message: '#local-config-request: a check is already running', next: [], data });
};

describe('#gui-local-model: IME composition (Mika)', () => {
  it('a repaint asked for while composing is skipped and owed once, then runs when the composition ends', () => {
    const g = compositionGate();
    expect(g.hold()).toBe(false);
    g.start();
    expect(g.hold()).toBe(true);
    expect(g.hold()).toBe(true);
    expect(g.end()).toBe(true);
    expect(g.hold()).toBe(false);
    g.start();
    expect(g.end()).toBe(false); // nothing asked meanwhile: nothing owed
  });
  it('the sheet gates its repaint and listens for compositionstart/end', () => {
    const src = readFileSync(path.join(ROOT, 'src', 'ui', 'settings-sheet.ts'), 'utf8');
    expect(src).toMatch(/if \(ime\.hold\(\)\) return;/);
    expect(src).toMatch(/addEventListener\('compositionstart'/);
    expect(src).toMatch(/addEventListener\('compositionend'/);
  });
});

describe('#gui-local-model: keyboard, focus and one request at a time', () => {
  it('a script-made press changes nothing (G-GUI-04)', async () => {
    const { c, calls } = rig();
    c.press('setup', null, false);
    expect(c.ui().open).toBe(false);
    await c.submit(false);
    expect(calls).toEqual([]);
  });
  it('Save with errors sends nothing and focuses the FIRST invalid field', async () => {
    const { c, calls, focus } = rig();
    c.press('setup', null, true);
    c.input('base', 'http://192.168.1.20:11434');
    await c.submit(true);
    expect(calls).toEqual([]);
    expect(focus.at(-1)).toEqual({ field: 'base' });
    expect(Object.keys(c.ui().errors)).toEqual(['base', 'model']);
  });
  it('an error in Advanced opens it and focuses that field', async () => {
    const { c, focus } = rig();
    c.press('setup', null, true);
    c.input('model', 'qwen2.5-coder:14b');
    c.input('id', '-bad');
    await c.submit(true);
    expect(c.ui().advanced).toBe(true);
    expect(focus.at(-1)).toEqual({ field: 'id' });
  });
  it('check, then the card: focus moves to Decide in the stack; Decide closes the sheet on the card (never Allow)', async () => {
    const { c, calls, focus, decided } = rig();
    c.press('setup', null, true);
    c.input('model', 'qwen2.5-coder:14b');
    await c.submit(true);
    expect(calls.map((x) => x.kind)).toEqual(['request.local.probe', 'request.local.config']);
    expect(calls[1]!.payload).toEqual({ op: 'set', endpoint: { id: 'ollama', base: 'http://127.0.0.1:11434', model: 'qwen2.5-coder:14b', compat: 'ollama', loops: true } });
    expect(c.ui().request).toMatchObject({ cardId: 'card:L1', line: '23:20 · ollama · 127.0.0.1:11434 · qwen2.5-coder:14b · sessions and loops' });
    expect(focus.at(-1)).toEqual({ act: 'decide' });
    // one request at a time: while the card waits, Save and Set up send nothing
    c.press('setup', null, true);
    await c.submit(true);
    expect(calls).toHaveLength(2);
    c.press('decide', null, true);
    expect(decided).toEqual(['card:L1']);
  });
  it('a second Save while the check runs sends nothing', async () => {
    let release: (v: unknown) => void = () => undefined;
    const { c, calls } = rig(NONE, { 'request.local.probe': [() => new Promise((r) => (release = r)) as never] });
    c.press('setup', null, true);
    c.input('model', 'm1');
    const first = c.submit(true);
    await c.submit(true);
    expect(calls).toHaveLength(1);
    release({ ok: true, why: 'capable', toolsNative: true, contextSize: 9000, model: 'm1', listed: true });
    await first;
    expect(calls).toHaveLength(2);
  });
  it('no answer or a missing model is a field error, never a card (no password for a typo)', async () => {
    const { c, calls, focus } = rig(NONE, { 'request.local.probe': [{ ok: false, why: 'model-missing', toolsNative: true, contextSize: null, model: 'm1', listed: false }] });
    c.press('setup', null, true);
    c.input('model', 'm1');
    await c.submit(true);
    expect(calls).toHaveLength(1);
    expect(focus.at(-1)).toEqual({ field: 'model' });
    expect(c.ui().errors.model).toMatch(/has no model m1/);
  });
  it('a rate-limited check is retried once after retryAfterMs', async () => {
    const { c, calls } = rig(NONE, { 'request.local.probe': [refusal({ why: 'rate-limited', retryAfterMs: 900 })] });
    c.press('setup', null, true);
    c.input('model', 'm1');
    await c.submit(true);
    expect(calls.map((x) => x.kind)).toEqual(['request.local.probe', 'request.local.probe', 'request.local.config']);
  });
  it('a kernel refusal at Save is the result line in the refusal voice', async () => {
    const { c } = rig(NONE, { 'request.local.config': [() => { throw new RpcError({ code: 'BILLING_REFUSED', reason: null, message: '192.168.1.20 is not on this Mac', next: [], data: null }); }] });
    c.press('setup', null, true);
    c.input('model', 'm1');
    await c.submit(true);
    expect(c.ui().result).toEqual({ text: 'BILLING_REFUSED  192.168.1.20 is not on this Mac', fail: true });
  });
  it('Esc order: the form closes first (entries kept, focus back on its key), then the sheet', () => {
    const { c, focus } = rig();
    c.press('setup', null, true);
    c.input('model', 'kept');
    expect(c.escape()).toBe(true);
    expect(focus.at(-1)).toEqual({ act: 'setup' });
    expect(c.ui().form?.model).toBe('kept');
    expect(c.escape()).toBe(false);
    c.press('setup', null, true);
    expect(c.ui().form?.model).toBe('kept');
    c.sheetClosed();
    expect(c.ui().form).toBeNull();
  });
  it('deny and expiry bring the entries back with a Not changed line; a restart reads as expired', async () => {
    for (const [r, words] of [[{ kind: 'approval.decide', payload: { cardId: 'card:L1', decision: 'deny' } }, 'you denied the card at 23:20'], [{ kind: 'approval.expire', payload: { cardId: 'card:L1' } }, 'the card expired at 23:20.'], [{ kind: 'daemon.start' }, 'expired at 23:20 (Gnomon restarted)']] as const) {
      const { c } = rig();
      c.press('setup', null, true);
      c.input('model', 'mine');
      await c.submit(true);
      c.sheetClosed(); // the card keeps the entries while it waits
      c.row(r);
      expect(c.ui().open).toBe(true);
      expect(c.ui().form?.model).toBe('mine');
      expect(c.ui().result?.text).toContain(words);
    }
  });
  it('Allow: checking until the probe lands, then one toast when no sheet is open', async () => {
    let st: unknown = NONE;
    const { c, toasts } = rig(() => st);
    c.press('setup', null, true);
    c.input('model', 'qwen2.5-coder:14b');
    await c.submit(true);
    c.press('decide', null, true); // closes the sheet
    c.row({ kind: 'approval.decide', payload: { cardId: 'card:L1', decision: 'allow' } });
    expect(c.ui().request).toBeNull();
    st = local({ lastProbe: null, probing: true, probingSince: '2026-10-22T23:20:30.000Z' });
    c.statusChanged();
    expect(toasts).toEqual([]);
    expect(valueOf(row(sec(st).rows, 'local-check'))).toMatch(/^checking… started/);
    st = local({ lastProbe: { at: '2026-10-22T23:21:00.000Z', ok: true, why: 'capable', tools: true, contextSize: 32768 } });
    c.statusChanged();
    c.statusChanged();
    expect(toasts).toEqual(['set · qwen2.5-coder:14b on 127.0.0.1:11434 · ✓ answers · tools native · context 32 768']);
  });
  it('Check again: the kernel records it in status.local.lastProbe, so the row reads the refreshed status (no newer-of-two)', async () => {
    let st: unknown = local({ lastProbe: { endpoint: 'ollama', at: '2026-10-22T23:10:00.000Z', ok: false, why: 'probe-failed', error: 'unreachable', tools: false, contextSize: null } });
    const { c, calls, refreshed } = rig(() => st);
    const pressed = new Promise<void>((res) => {
      c.press('check', null, true);
      setTimeout(res, 0);
    });
    expect(valueOf(row(sec(st, c.ui()).rows, 'local-check'))).toMatch(/^checking… started 23:20/);
    st = local({ lastProbe: { endpoint: 'ollama', at: '2026-10-22T23:20:01.000Z', ok: true, why: 'capable', tools: true, contextSize: 32768 } });
    await pressed;
    expect(calls.map((x) => x.kind)).toEqual(['request.local.probe']);
    expect(refreshed).toEqual([1]);
    expect(c.ui().check).toBeNull();
    expect(valueOf(row(sec(st, c.ui()).rows, 'local-check'))).toBe('✓ answers · tools native · context 32 768 · 23:20');
  });
  it('Check again whose call fails is held until the kernel checks again', async () => {
    let st: unknown = local();
    const { c } = rig(() => st, { 'request.local.probe': [() => { throw new RpcError({ code: 'FORBIDDEN', reason: 'matrix', message: 'not on this connection', next: [], data: null }); }] });
    c.press('check', null, true);
    await new Promise((r) => setTimeout(r, 0));
    expect(valueOf(row(sec(st, c.ui()).rows, 'local-check'))).toMatch(/^✕ no answer/);
    st = local({ probing: true, probingSince: '2026-10-22T23:21:00.000Z' });
    c.statusChanged();
    expect(c.ui().check).toBeNull();
    expect(valueOf(row(sec(st, c.ui()).rows, 'local-check'))).toBe('checking… started 23:21');
  });
  it('Turn off: confirm only when loops use it; keep it and Esc return to the Turn off key', async () => {
    const { c, calls, focus } = rig(local());
    c.press('turn-off', null, true);
    expect(c.ui().confirmOff).toBe(true);
    expect(focus.at(-1)).toEqual({ act: 'confirm-off' });
    expect(c.escape()).toBe(true);
    expect(focus.at(-1)).toEqual({ act: 'turn-off' });
    c.press('turn-off', null, true);
    c.press('confirm-off', null, true);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([{ kind: 'request.local.config', payload: { op: 'remove' } }]);
    expect(c.ui().result?.lead).toBe('Turned off');
    expect(c.ui().result?.text).toContain('evening-tidy won’t start until a local model is set up');
  });
  it('a removal elsewhere is a toast only when no sheet is open', () => {
    const { c, toasts } = rig(local());
    c.row({ kind: 'config.loaded', payload: { file: 'local.signed.json', why: 'removed' } });
    expect(toasts).toEqual([]);
    c.press('decide', null, true);
  });
});

describe('#gui-local-model: palette, card, loops', () => {
  it('local.setup reads "Set up local model…" until one is set, then "Local model settings…"', () => {
    expect(paletteEntries(NONE as never).find((c) => c.id === 'local.setup')!.title).toBe('Set up local model…');
    expect(paletteEntries(local() as never).find((c) => c.id === 'local.setup')!.title).toBe('Local model settings…');
    expect(localStatusOf(local()).state).toBe('set');
  });
  it('the loop detail maps the kernel why, never infers it; Run now says why; the loop pins to needs you', () => {
    const sr = { code: 'no-local-model' as const, why: 'none' as const, at: '2026-10-22T18:30:00.000Z', since: '2026-10-22T18:30:00.000Z', count: 1, trigger: 'schedule', modelNodes: ['digest'] };
    expect(startLine(sr, null)).toMatchObject({ head: '✕ can’t start · no-local-model', text: 'No local model is set up, and this loop has a model step (digest).', key: 'Set up local model…', runWhy: 'Run now needs a local model' });
    expect(startLine({ ...sr, why: 'sessions-only' }, 'qwen2.5-coder:14b')).toMatchObject({ text: 'qwen2.5-coder:14b is set up for sessions only. Let loops use it in Settings.', key: 'Local model settings…', runWhy: 'Run now needs a local model loops may use' });
    expect(startLine({ ...sr, why: 'no-runner' }, null).text).toBe('The local model has no runner pinned. Change it in Settings and Save to pin the bundled one.');
    expect(startLine({ ...sr, why: 'no-profile' }, null).key).toBe('Local model settings…');
    const status = { loops: { loops: [{ key: 'repo/k/evening-tidy', loopId: 'evening-tidy', scope: 'repo', repo: '/x/a-paradigm', repoKey: 'k', state: 'trusted', trustedHash: 'sha256:1', contentHash: 'sha256:1', shape: { triggers: ['daily 18:30'], autonomy: 'act', start: 'digest', budgets: { run: {}, day: {} }, authoredBy: 'you', nodes: [{ id: 'digest', type: 'model', on: {} }] } }], startRefused: [{ key: 'repo/k/evening-tidy', ...sr }], runs: [], running: [] } };
    const m = loopsOf(status)!;
    const x = m.loops[0]!;
    expect(cantStart(x)).toBe(true);
    const k = detailKeys(x);
    expect(k.chip).toBe('idle · can’t start');
    expect(k.keys.find((y) => y.act === 'run')).toMatchObject({ disabled: 'Run now needs a local model' });
    const g = loopGroups(m, Date.parse(sr.at))[0]!;
    expect(g.head).toBe('needs you');
    expect(g.rows[0]).toMatchObject({ mark: '◆', l1: 'can’t start', l2: 'a-paradigm · needs a local model (digest) · act · from the loop file' });
    expect(loopAlerts(m, new Set())[0]).toMatchObject({ kind: 'refused-start', fix: 'Set up local model…' });
    expect(runRefusalOf({ code: 'ENGINE', reason: 'no-local-model', data: { why: 'sessions-only' } }, x, sr.at)).toMatchObject({ why: 'sessions-only', modelNodes: ['digest'] });
    expect(runRefusalOf({ code: 'ENGINE', reason: 'budget', data: null }, x, sr.at)).toBeNull();
  });
});

/* ── Aegis L4: the GUI's row table is the kernel's and the helper's ─────────────────────────────────────────────── */
const C = 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const goodRow = (o: Record<string, unknown> = {}, ep: Record<string, unknown> = {}, ru: Record<string, unknown> = {}) => ({ schemaVersion: 'gnomon-root-local:v1', version: 3, runnerSource: 'bundled', cardId: C, local: { endpoints: [{ id: 'ollama', base: 'http://127.0.0.1:11434', model: 'qwen3.5:9b', compat: 'ollama', loops: true, ...ep }], runner: { dir: RUNNER.dir, entry: 'cli.js', node: RUNNER.node, nodeSha256: 'a'.repeat(64), treeSha256: 'b'.repeat(64), ...ru } }, ...o });
function localCard(rows: unknown[], cardId = C) {
  const detail = { action: 'local.config', previous: null, rootRows: rows, rootDecisions: ['allow'] };
  const base = { cardId, kind: 'grant', requestedBy: 'p:abcdefgh/matt', flags: [] as string[] };
  return { ...base, state: 'pending', contentHash: cardContentHash(base, detail), block: { type: 'Box', children: [{ type: 'Text', text: 'Set up the local model' }, { type: 'root-rows', rootDecisions: ['allow'], detail }] } } as Record<string, unknown>;
}

describe('Aegis L4: GUI-only row cases', () => {
  const refused: Array<[string, Record<string, unknown>]> = [
    ['Arabic-Indic port digits', goodRow({}, { base: 'http://127.0.0.1:١١٤٣٤' })],
    ['fullwidth port digits', goodRow({}, { base: 'http://127.0.0.1:１１４３４' })],
    ['port 65536', goodRow({}, { base: 'http://127.0.0.1:65536' })],
    ['LOCALHOST', goodRow({}, { base: 'http://LOCALHOST:11434' })],
    ['[::ffff:127.0.0.1]', goodRow({}, { base: 'http://[::ffff:127.0.0.1]:11434' })],
    ['U+202E in dir', goodRow({}, {}, { dir: '/Applications/Gnomon‮.app/x' })],
    ['a control character in the model', goodRow({}, { model: 'qwen\u0007' })],
    ['an over-cap dir (257)', goodRow({}, {}, { dir: `/${'d'.repeat(256)}` })],
    ['an over-cap node (257)', goodRow({}, {}, { node: `/${'n'.repeat(256)}` })],
    ['a NUL in the dir', goodRow({}, {}, { dir: '/a\0b' })],
    ['no runnerSource', goodRow({ runnerSource: undefined })],
  ];
  it('each is refused: no rows, so the card offers only Deny', () => {
    const big = goodRow({}, {}, { dir: `/${'d'.repeat(250)}`, node: `/${'n'.repeat(250)}` });
    (big.local as { endpoints: unknown[] }).endpoints = ['a', 'b', 'c', 'd'].map((id) => ({ id, base: 'http://127.0.0.1:11434', model: 'm'.repeat(128), compat: 'ollama', loops: true }));
    refused.push(['an oversized row: four long endpoints and long paths (never compacted)', big]);
    const l = big.local as { endpoints: unknown[]; runner: unknown };
    expect(helperLineLength({ version: 3, runnerSource: 'bundled', cardId: C, endpoints: l.endpoints, runner: l.runner } as never)).toBeGreaterThan(1200);
    for (const [name, r] of refused) {
      const clean = JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
      expect(localRowOf(clean), name).toBeNull();
      expect(rootRowsOf(localCard([clean])), name).toBeNull();
    }
  });
  it('port 65535, a 256-character dir and an override runner pass; the override is marked', () => {
    expect(localRowOf(goodRow({}, { base: 'http://127.0.0.1:65535' }))).not.toBeNull();
    expect(localRowOf(goodRow({}, {}, { dir: `/${'d'.repeat(255)}` }))).not.toBeNull();
    const rr = rootRowsOf(localCard([goodRow({ runnerSource: 'override' })]))!;
    expect(rr.lines.some((l) => l.includes('OVERRIDE'))).toBe(true);
  });
  it('a change carries the loop-diff marks against status.local', () => {
    const row = goodRow({}, { model: 'qwen2.5-coder:32b' });
    const detail = { action: 'local.config', previous: 2, rootRows: [row], rootDecisions: ['allow'] };
    const base = { cardId: C, kind: 'grant', requestedBy: 'p:abcdefgh/matt', flags: [] as string[] };
    const card = { ...base, contentHash: cardContentHash(base, detail), block: { type: 'Box', children: [{ type: 'root-rows', rootDecisions: ['allow'], detail }] } };
    const cur = { version: 2, endpoints: [{ id: 'ollama', base: 'http://127.0.0.1:11434', model: 'qwen2.5-coder:14b', compat: 'ollama', loops: true }], runner: { dir: RUNNER.dir, entry: 'cli.js', node: RUNNER.node, nodeSha256: 'a'.repeat(64), treeSha256: 'b'.repeat(64) }, bundled: null };
    const rr = rootRowsOf(card, { local: cur })!;
    expect(rr.items).toEqual([
      { text: 'local model config v2 → v3' },
      { text: 'endpoint ollama · an Ollama server at http://127.0.0.1:11434 · unchanged' },
      { text: 'model qwen2.5-coder:14b', mark: 'del' },
      { text: 'model qwen2.5-coder:32b', mark: 'add' },
      { text: 'loops may use it · unchanged' },
      { text: 'runner · bundled · tree bbbbbbbb…bbbb · sha aaaaaaaa… · unchanged' },
      { text: `runner folder ${RUNNER.dir}/cli.js · node ${RUNNER.node}` },
    ]);
  });
});

describe('Mika: the signed lines say their diff mark in visually hidden text, never an aria-label', () => {
  it('an added line reads "new: …", a removed one "was: …"; no aria-label on a list item', () => {
    type El = { tag: string; className: string; attrs: Map<string, string>; kids: unknown[]; appendChild(c: unknown): unknown; setAttribute(n: string, v: string): void };
    const els: El[] = [];
    const doc: MiniDoc = {
      createElement: (tag: string) => {
        const e: El = { tag, className: '', attrs: new Map(), kids: [], appendChild(c) { this.kids.push(c); return c; }, setAttribute(n, v) { this.attrs.set(n, v); } };
        els.push(e);
        return e as unknown as MiniEl;
      },
      createTextNode: (t) => t,
    };
    const textOf = (e: unknown): string => (typeof e === 'string' ? e : (e as El).kids.map(textOf).join(''));
    renderCard({ doc }, { cardId: 'card:L1', kind: 'grant', requestedBy: 'p:abcdefgh/matt', hsid: null, repo: null, state: 'pending', contentHash: 'sha256:' + 'a'.repeat(64), flags: [], decisions: ['allow', 'deny'], decidable: true, rootRows: { lines: [], items: [{ text: 'model a', mark: 'del' }, { text: 'model b', mark: 'add' }, { text: 'loops may use it · unchanged' }] } } as never, { type: 'Box', children: [] });
    const lis = els.filter((e) => e.tag === 'li');
    expect(lis.map(textOf)).toEqual(['was: model a', 'new: model b', 'loops may use it · unchanged']);
    expect(lis.some((e) => e.attrs.has('aria-label'))).toBe(false);
    expect(lis.slice(0, 2).map((e) => (e.kids[0] as El).className)).toEqual(['sr-only', 'sr-only']);
  });
});

describe('Aegis L4: the shared decision-batch vectors against the GUI row table', () => {
  const file = path.resolve(ROOT, '..', 'gnomon-contracts', 'test', 'fixtures', 'decision-batch-vectors.json');
  const vectors = (JSON.parse(readFileSync(file, 'utf8')) as { vectors: Array<{ name: string; root: string[]; error: string | null; shown?: string }> }).vectors;
  const ROW = 'gnomon:row-sig:v1\n';
  const locals = vectors.filter((v) => v.root.some((m) => m.includes('"cardKind":"local.config"')));
  it('there are local.config vectors', () => expect(locals.length).toBeGreaterThan(20));
  for (const v of locals) {
    it(v.name, () => {
      const rows = v.root.map((m) => JSON.parse(m.slice(ROW.length)) as Record<string, unknown>);
      const card = localCard(rows.slice(1), String(rows[0]!.cardId));
      const rr = rootRowsOf(card);
      expect(rr === null, `GUI ${rr ? 'shows' : 'refuses'}; helper error ${v.error}`).toBe(v.error !== null);
      // the helper's line, never compacted: the GUI's length model is exact
      if (v.error === null && v.shown) expect(helperLineLength(localRowOf(rows[1]!)! as never)).toBe(v.shown.length);
    });
  }
});
