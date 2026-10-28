/**
 * #gui-tool-tier (slice C4'b): the session label per source, the chip for a non-owner or an ended session, the menu
 * marks, the preview sheet's words in every state (window cap, above measured, nothing changes, tier-0 pins, cannot
 * remember), a malformed preview, the commit outcome and the Settings value. The press paths (expiry, stale, one
 * commit per press, untrusted presses) are the controller's, below.
 */
import { describe, expect, it } from 'vitest';
import { RpcError } from '../src/core/client.js';
import { TierFlow, trapTab } from '../src/ui/tier-picker.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { commitOutcome, previewOf, previewView, probeTierOf, refusalPhase, sessionTierOf, sheetView, tierChipOf, tierLabel, tierMenu, tierRequest, tierSettingsValue, TIER_COPY, WINDOW_TIER_MIN, type TierPreview } from '../src/core/tool-tier.js';

const H = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const ME = 'p:abcdefgh/founder';
const TOKEN = 'a'.repeat(32);
/** a kernel preview answer (local-session.ts #previewTier) */
const answer = (o: Record<string, unknown> = {}): Record<string, unknown> => ({ hsid: H, from: 2, to: 3, requested: 3, measured: 2, window: 3, k: 12, slotTokens: 4000, slotShare: 0.25, surface: 'compact→full', cacheLost: true, leaving: ['grep', 'glob'], unfitPins: [], notice: 'Tier 2 → 3: …', token: TOKEN, expiresInMs: 60_000, rememberable: true, ...o });
const pv = (o: Record<string, unknown> = {}): TierPreview => previewOf(answer(o))!;

describe('#gui-tool-tier: the session label', () => {
  it('the source is a word: measured, yours, provisional', () => {
    expect(tierLabel({ tier: 2, source: 'measured' })).toBe('tier 2');
    expect(tierLabel({ tier: 3, source: 'human' })).toBe('tier 3 · yours');
    expect(tierLabel({ tier: 1, source: 'provisional' })).toBe('tier 1 · provisional');
  });
  it('the last model.capabilities of THIS session; a session.open starts afresh; another session or a probe row is not it', () => {
    const rows = [
      { kind: 'session.open', payload: { hsid: H } },
      { kind: 'model.capabilities', payload: { hsid: H, tier: 1, tierSource: 'provisional', measured: null } },
      { kind: 'model.capabilities', payload: { backend: 'local', endpoint: 'fake', tier: 2, tierSource: 'measured' } },
      { kind: 'model.capabilities', payload: { hsid: 'hsid:v1:other', tier: 0, tierSource: 'human' } },
      { kind: 'model.capabilities', payload: { hsid: H, tier: 3, previous: 1, measured: 2, tierSource: 'human' } },
    ];
    expect(sessionTierOf(rows, H)).toEqual({ tier: 3, source: 'human', measured: 2, previous: 1 });
    expect(sessionTierOf([...rows, { kind: 'session.open', payload: { hsid: H } }], H)).toBeNull();
    expect(sessionTierOf([{ kind: 'model.capabilities', payload: { hsid: H, tier: 7, tierSource: 'human' } }], H)).toBeNull();
  });
  it('the owner of a live session gets the key (▾); another principal or an ended session gets a plain chip that says why', () => {
    const tier = { tier: 1 as const, source: 'provisional' as const, measured: null };
    const base = { backend: 'local', loop: false, live: true, owner: ME, me: ME, tier };
    expect(tierChipOf(base)).toEqual({ kind: 'key', text: 'tier 1 · provisional ▾', title: TIER_COPY.provisional });
    expect(tierChipOf({ ...base, me: 'p:abcdefgh/other' })).toMatchObject({ kind: 'chip', text: 'tier 1 · provisional', title: `${TIER_COPY.notOwner} ${TIER_COPY.provisional}` });
    // Mika F7: an ended session says so, to its owner too; notOwner is for a live session that is not theirs
    expect(tierChipOf({ ...base, live: false })).toMatchObject({ kind: 'chip', title: `This session has ended; its tier no longer changes. ${TIER_COPY.provisional}` });
    expect(tierChipOf({ ...base, live: false, tier: { tier: 2, source: 'measured', measured: 2 } })?.title).toBe('This session has ended; its tier no longer changes.');
    expect(tierChipOf({ ...base, owner: null })?.kind).toBe('chip');
    // loop sessions and Claude sessions: no label
    expect(tierChipOf({ ...base, loop: true })).toBeNull();
    expect(tierChipOf({ ...base, backend: 'claude-code' })).toBeNull();
    expect(tierChipOf({ ...base, tier: null })).toBeNull();
  });
  it('the menu: every tier, the current marked, the measured note ends " · measured"', () => {
    const m = tierMenu(3, 2);
    expect(m.map((x) => x.name)).toEqual(['Tier 0', 'Tier 1', 'Tier 2', 'Tier 3']);
    expect(m.filter((x) => x.current).map((x) => x.tier)).toEqual([3]);
    expect(m[2]!.note).toBe('up to 12 tools, short forms · measured');
    expect(m[0]!.note).toBe('its own file tools only: no Gnomon or MCP tools');
    expect(m[3]!.note.endsWith(' · measured')).toBe(false);
    expect(tierMenu(1, null).some((x) => x.note.endsWith(' · measured'))).toBe(false);
  });
});

describe('#gui-tool-tier: the preview sheet', () => {
  it('the meta lines and the foot', () => {
    const v = previewView(pv(), 'qwen2.5-coder:14b');
    expect(v.lines).toEqual(['tools: up to 12, full forms (now short)', 'tool space: 4 000 tokens, 25% of its context', 'leaving: grep, glob', 'prompt cache: starts over, so the next reply is slower']);
    expect(v.foot).toBe(TIER_COPY.foot);
    expect(v.apply).toBe(true);
    expect(v.checkbox).toEqual({ label: 'Use tier 3 for qwen2.5-coder:14b in new sessions too', disabled: false });
    expect(previewView(pv({ leaving: [] }), 'm').lines).toContain('none leave');
  });
  it('above what the model measured (or not measured yet, above 1) warns with ◆', () => {
    expect(previewView(pv(), 'm').warnings).toEqual(['◆ Above what this model measured (2). It may call tools badly; every call is still checked and carded.']);
    expect(previewView(pv({ measured: null, to: 2, requested: 2 }), 'm').warnings[0]).toBe('◆ Above what this model measured (not yet). It may call tools badly; every call is still checked and carded.');
    expect(previewView(pv({ measured: null, from: 2, to: 1, requested: 1 }), 'm').warnings).toEqual([]);
    expect(previewView(pv({ measured: 3 }), 'm').warnings).toEqual([]);
  });
  it('the window cap: the requested tier needs a bigger context target, so the lower one applies', () => {
    const v = previewView(pv({ requested: 3, to: 2, window: 2, from: 1, measured: 3, surface: 'compact→compact', k: 12, slotTokens: 1228, slotShare: 0.15 }), 'm');
    expect(v.warnings).toEqual([`◆ Tier 3 needs a context target of 16 384 tokens or more, so this applies tier 2.`]);
    expect(WINDOW_TIER_MIN).toEqual({ 1: 4096, 2: 8192, 3: 16384 });
  });
  it('to === from: no Apply key and no checkbox, only close', () => {
    const p = pv({ from: 2, to: 2, requested: 3, window: 2, measured: 3 });
    const v = previewView(p, 'm');
    expect(v.apply).toBe(false);
    expect(v.checkbox).toBeNull();
    const s = sheetView({ phase: 'ready', from: 2, requested: 3, preview: p, model: 'm' });
    // Mika F4: no question it can't act on
    expect(s.title).toBe('This session already uses tier 2');
    expect(s.keys).toEqual([{ act: 'close', label: 'close', quiet: true }]);
    expect(s.focus).toBe('close');
  });
  it('tier 0: no forms, the pins wait for a raise; from tier 0 the foot says MCP servers start first', () => {
    const down = previewView(pv({ to: 0, requested: 0, k: 0, slotTokens: 0, slotShare: 0, surface: 'full→compact', unfitPins: [{ name: 'echo', why: 'tier-0' }, { name: 'big', why: 'over-budget' }] }), 'm');
    expect(down.lines[0]).toBe('tools: its own file tools only (now full forms)'); // Mika F10
    expect(down.lines).toContain('pins that won’t fit: echo (waits until you raise the tier), big (over budget)');
    const up = previewView(pv({ from: 0, to: 2, requested: 2, measured: 2 }), 'm');
    expect(up.lines[0]).toBe('tools: up to 12, full forms (now no)');
    expect(up.foot).toBe(`${TIER_COPY.foot} MCP servers start first.`);
  });
  it('Mika F12: a long leaving list or pin list shows 8 names and "and N more", the whole list in its title', () => {
    const names = Array.from({ length: 11 }, (_, n) => `t${n}`);
    const v = previewView(pv({ leaving: names, unfitPins: names.map((name) => ({ name, why: 'tier-0' })) }), 'm');
    const at = v.lines.findIndex((l) => l.startsWith('leaving: '));
    expect(v.lines[at]).toBe('leaving: t0, t1, t2, t3, t4, t5, t6, t7 and 3 more');
    expect(v.titles[at]).toBe(`leaving: ${names.join(', ')}`);
    expect(v.lines[at + 1]).toMatch(/^pins that won’t fit: t0 \(waits until you raise the tier\), .* and 3 more$/);
    expect(v.titles[at + 1]).toContain('t10 (waits until you raise the tier)');
    expect(previewView(pv(), 'm').titles.every((t) => t === null)).toBe(true);
  });
  it('rememberable false disables the checkbox with the kernel’s reason inline', () => {
    expect(previewView(pv({ rememberable: false, rememberWhy: 'no-fingerprint' }), 'm').checkbox).toEqual({ label: 'Use tier 3 for m in new sessions too', disabled: true, why: 'can’t remember: the server didn’t name this model’s file' });
    expect(previewView(pv({ rememberable: false, rememberWhy: 'store-unwritable' }), 'm').checkbox).toMatchObject({ disabled: true, why: 'can’t remember: Gnomon couldn’t write its tier file' });
  });
  it.each([
    ['not an object', null],
    ['a tier out of range', answer({ to: 4 })],
    ['a short token', answer({ token: 'abc' })],
    ['a surface that is not a→b', answer({ surface: 'full' })],
    ['an unknown surface', answer({ surface: 'compact→wide' })],
    ['leaving not names', answer({ leaving: [1] })],
    ['a pin with no why', answer({ unfitPins: [{ name: 'x' }] })],
    ['no rememberable', answer({ rememberable: undefined })],
    ['not rememberable with no reason', answer({ rememberable: false })],
    ['an unknown reason', answer({ rememberable: false, rememberWhy: 'nope' })],
    ['a share over 1', answer({ slotShare: 25 })],
    ['no expiry', answer({ expiresInMs: 0 })],
  ])('a malformed preview (%s) is null', (_why, v) => {
    expect(previewOf(v)).toBeNull();
  });
  it('the phases: loading, applying, expired, stale, gone, error', () => {
    const p = pv();
    const loading = sheetView({ phase: 'loading', from: 2, requested: 3, preview: null, model: 'm' });
    expect(loading).toMatchObject({ title: 'Change this session’s tool tier from 2 to 3?', status: 'Checking what tier 3 changes…', body: null });
    expect(loading.keys[0]).toMatchObject({ act: 'apply', disabled: true, busy: true });
    expect(sheetView({ phase: 'ready', from: 2, requested: 3, preview: p, model: 'm' }).keys).toEqual([{ act: 'apply', label: 'Apply now · cache resets', pri: true }, { act: 'cancel', label: 'cancel', quiet: true }]);
    expect(sheetView({ phase: 'applying', from: 2, requested: 3, preview: p, model: 'm' }).keys[0]).toMatchObject({ label: 'Applying…', disabled: true });
    const exp = sheetView({ phase: 'expired', from: 2, requested: 3, preview: p, model: 'm' });
    expect(exp.status).toBe('Not changed: this preview expired (a preview holds for a minute).');
    expect(exp.keys[0]).toEqual({ act: 'again', label: 'Preview again', pri: true });
    expect(exp.keys.some((k) => k.act === 'apply')).toBe(false);
    expect(sheetView({ phase: 'stale', from: 2, requested: 3, preview: p, model: 'm' }).status).toBe('Not changed: this session’s tools changed since the preview.');
    const gone = sheetView({ phase: 'error', from: 2, requested: 3, preview: null, model: 'm' });
    expect(gone).toMatchObject({ status: 'Not changed: this session isn’t running any more.', fail: true, focus: 'close' });
    expect(sheetView({ phase: 'error', from: 2, requested: 3, preview: null, model: 'm', error: 'BAD_REQUEST  x' }).status).toBe('BAD_REQUEST  x');
    expect([refusalPhase('stale'), refusalPhase('not-found'), refusalPhase('bad-params')]).toEqual(['stale', 'gone', 'error']);
  });
});

describe('#gui-tool-tier: outcome, Settings value, requests', () => {
  it('the info toast; remembered:false with remember asked is a warn with its reason', () => {
    expect(commitOutcome({ tier: 3, previous: 2, remembered: false }, false)).toEqual({ info: 'tier 2 → 3 · applies from the next step · prompt cache starts over', warn: null });
    expect(commitOutcome({ tier: 3, previous: 2, remembered: false, rememberWhy: 'no-fingerprint' }, true)?.warn).toBe('tier 3 applies to this session only: can’t remember: the server didn’t name this model’s file');
    expect(commitOutcome({ tier: 3, previous: 2, remembered: true }, true)?.warn).toBeNull();
    expect(commitOutcome({ tier: 9 }, false)).toBeNull();
  });
  it('the Settings value in each case', () => {
    const t = (o: Record<string, unknown>) => probeTierOf({ skill: 2, passed: 3, measuring: false, window: 3, human: null, ...o });
    expect(tierSettingsValue(t({}))).toBe('2 · measured');
    expect(tierSettingsValue(t({ skill: 2, human: 3 }))).toBe('3 · yours (measured 2)');
    expect(tierSettingsValue(t({ skill: null, measuring: true }))).toBe('1 · provisional · measuring…');
    expect(tierSettingsValue(t({ skill: 3, window: 1 }))).toBe('1 · measured 3, capped by context');
    expect(tierSettingsValue(t({ skill: null }))).toBe('not measured yet');
    expect(tierSettingsValue(null)).toBe('not measured yet');
    expect(tierSettingsValue(t({}), true)).toBe('2 · measured · measuring…');
    expect(probeTierOf({ skill: 5 })).toBeNull();
  });
  it('the requests: preview, commit (never a retry), re-measure and clear', () => {
    expect(tierRequest(H, 'preview', 3)).toEqual({ kind: 'request.session.tier', payload: { hsid: H, op: 'preview', tier: 3 } });
    expect(tierRequest(H, 'commit', TOKEN, false, 3)).toEqual({ kind: 'request.session.tier', payload: { hsid: H, op: 'commit', token: TOKEN, remember: false, tier: 3 } });
  });
});

/* ── the press paths (ui/tier-picker.ts TierFlow: no DOM) ───────────────────────────────────────────────────────── */

/** A flow over a fake kernel: answers per request op, a manual timer; a commit waits for commitDone(). */
function flowRig(answers: Partial<Record<'preview' | 'commit', Array<unknown | (() => never)>>> = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const toasts: Array<[string, string]> = [];
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  let release: (() => void) | null = null;
  const flow = new TierFlow({
    call: async (req) => {
      calls.push(req.payload);
      const op = req.payload.op as 'preview' | 'commit';
      if (op === 'commit') await new Promise<void>((r) => (release = r));
      const q = answers[op]?.shift();
      if (typeof q === 'function') return (q as () => never)();
      return q ?? (op === 'preview' ? answer() : { tier: 3, previous: 2, remembered: false, tierSource: 'human' });
    },
    toast: (t, k) => void toasts.push([t, k]),
    repaint: () => undefined,
    timer: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => void (t.cancelled = true);
    },
  });
  const settle = () => new Promise<void>((r) => setTimeout(r, 0));
  const commitDone = async () => {
    await settle();
    release?.();
    await settle();
  };
  const open = async (requested: 0 | 1 | 2 | 3 = 3) => {
    flow.open({ hsid: H, from: 2, requested, model: 'qwen' }, true);
    expect(flow.state()?.phase).toBe('loading');
    await settle();
  };
  return { flow, calls, toasts, timers, open, settle, commitDone };
}
const stale = () => {
  throw new RpcError({ code: 'BAD_REQUEST', reason: 'stale', message: 'request.session.tier: the preview is stale, expired or already used: preview again', next: [], data: null });
};

describe('#gui-tool-tier: the press paths', () => {
  it('an untrusted press sends nothing (menu pick, Apply, Preview again, the checkbox)', async () => {
    const r = flowRig();
    r.flow.open({ hsid: H, from: 2, requested: 3, model: 'qwen' }, false);
    expect(r.flow.state()).toBeNull();
    await r.open();
    r.flow.setRemember(true, false);
    expect(r.flow.state()?.remember).toBe(false);
    await r.flow.apply(false);
    r.flow.again(false);
    expect(r.calls.map((c) => c.op)).toEqual(['preview']);
  });
  it('the checkbox starts unticked; a double press of Apply sends ONE commit with the token and the tick', async () => {
    const r = flowRig();
    await r.open();
    expect(r.flow.state()).toMatchObject({ phase: 'ready', remember: false });
    r.flow.setRemember(true, true);
    const a = r.flow.apply(true);
    const b = r.flow.apply(true);
    expect(r.flow.state()?.phase).toBe('applying');
    await r.commitDone();
    await Promise.all([a, b]);
    expect(r.calls.filter((c) => c.op === 'commit')).toEqual([{ hsid: H, op: 'commit', token: TOKEN, remember: true, tier: 3 }]);
    expect(r.flow.state()).toBeNull();
    // remembered:false after a commit that asked to remember (a race fallback): the info toast, then a warn
    expect(r.toasts).toEqual([['tier 2 → 3 · applies from the next step · prompt cache starts over', 'info'], ['tier 3 applies to this session only: can’t remember: Gnomon couldn’t write its tier file', 'warn']]);
  });
  it('expiry: at expiresInMs Apply becomes Preview again, the token is dropped, and Apply sends nothing', async () => {
    const r = flowRig();
    await r.open();
    expect(r.timers.map((t) => t.ms)).toEqual([60_000]);
    r.timers[0]!.fn();
    expect(r.flow.state()?.phase).toBe('expired');
    expect(r.flow.view()?.keys.map((k) => k.act)).toEqual(['again', 'cancel']);
    await r.flow.apply(true);
    expect(r.calls.map((c) => c.op)).toEqual(['preview']);
    r.flow.again(true);
    await r.settle();
    expect(r.calls.map((c) => c.op)).toEqual(['preview', 'preview']);
    expect(r.flow.state()?.phase).toBe('ready');
  });
  it('stale: Not changed + Preview again; the commit is never retried', async () => {
    const r = flowRig({ commit: [stale] });
    await r.open();
    const a = r.flow.apply(true);
    await r.commitDone();
    await a;
    expect(r.flow.state()?.phase).toBe('stale');
    expect(r.flow.view()?.status).toBe('Not changed: this session’s tools changed since the preview.');
    await r.flow.apply(true);
    await r.settle();
    expect(r.calls.map((c) => c.op)).toEqual(['preview', 'commit']);
    expect(r.toasts).toEqual([]);
  });
  it('not-found: the session is not running; focus goes to close', async () => {
    const r = flowRig({ preview: [() => { throw new RpcError({ code: 'NOT_FOUND', reason: 'not-found', message: 'no such running local session for this principal', next: [], data: null }); }] });
    await r.open();
    expect(r.flow.view()).toMatchObject({ status: 'Not changed: this session isn’t running any more.', fail: true, focus: 'close' });
  });
  it('a malformed preview is an error, never a held token; closing drops the token and the timer', async () => {
    const r = flowRig({ preview: [{ hsid: H, to: 3 }] });
    await r.open();
    expect(r.flow.state()?.phase).toBe('error');
    await r.flow.apply(true);
    const ok = flowRig();
    await ok.open();
    ok.flow.close();
    expect(ok.timers[0]!.cancelled).toBe(true);
    expect(ok.flow.state()).toBeNull();
    await ok.flow.apply(true);
    expect([...r.calls, ...ok.calls].every((c) => c.op === 'preview')).toBe(true);
  });
  it('Mika F1: toggling remember repaints nothing (the box keeps its focus)', async () => {
    let paints = 0;
    const flow = new TierFlow({ call: async () => answer(), toast: () => undefined, repaint: () => void paints++, timer: () => () => undefined });
    flow.open({ hsid: H, from: 2, requested: 3, model: 'qwen' }, true);
    await new Promise((r) => setTimeout(r, 0));
    const before = paints;
    flow.setRemember(true, true);
    expect(flow.state()?.remember).toBe(true);
    expect(paints).toBe(before);
  });
  it('Mika F3: a commit lost in transit claims nothing; a preview lost in transit says nothing was sent', async () => {
    const drop = () => {
      throw new Error('socket closed');
    };
    const c = flowRig({ commit: [drop] });
    await c.open();
    const a = c.flow.apply(true);
    await c.commitDone();
    await a;
    expect(c.flow.view()).toMatchObject({ status: 'Not known whether it changed: the connection dropped. The header shows this session’s tier.', fail: true });
    const p = flowRig({ preview: [drop] });
    await p.open();
    expect(p.flow.view()?.status).toBe('Not changed: nothing was sent (socket closed)');
  });
  it('the sheet DOM: busy keys are aria-disabled (F2), the current tier asks nothing (F4), one live region (F8), Tab stays inside (F11)', () => {
    const src = readFileSync(path.join(ROOT, 'src', 'ui', 'tier-picker.ts'), 'utf8');
    expect(src).toMatch(/if \(k\.busy\) \{\s*b\.setAttribute\('aria-disabled', 'true'\)/);
    expect(src).toMatch(/'aria-current': 'true'/);
    expect(src).toMatch(/if \(m\.current\) return btn\.focus\(\);/);
    expect(src.match(/role: 'status'/g)).toHaveLength(1);
    expect(src).toMatch(/status\.textContent = v\.status \?\? ''/);
    expect(src).toMatch(/e\.key === 'Tab' && !sheet\.hidden\) return trapTab\(sheet, e\)/);
    expect(src).toContain(".filter((x) => !x.closest('[hidden]') && x.getClientRects().length > 0)");
    expect(src).toMatch(/card\.querySelector\(`\[data-act="\$\{had\.act\}"\]`\)/);
    const mp = readFileSync(path.join(ROOT, 'src', 'ui', 'model-picker.ts'), 'utf8');
    expect(mp).toMatch(/e\.key === 'Tab' && !sheet\.hidden\) return trapTab\(sheet, e\)/);
    const css = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');
    expect(css).toContain('.key.quiet[disabled], .key.quiet[aria-disabled="true"] { color: var(--sec); border-color: var(--rule); }');
    expect(css).toContain('.tier-remember + .meta { margin-top: 2px; padding-left: 22px; }');
    expect(css).toContain('#tier-dialog p[role="status"]:empty { margin: 0; }');
    expect(css.indexOf('.key.quiet[disabled]')).toBeGreaterThan(css.indexOf('.key.quiet { box-shadow: none;'));
  });
  it('Mika F11: trapTab wraps Tab and Shift+Tab inside the dialog', () => {
    const keys = ['a', 'b', 'c'].map((id) => ({ id, closest: () => null, getClientRects: () => [{}], focus() { doc.activeElement = this; } }));
    // R1: a control inside a hidden row (#model-switch-id when the model is not custom) is not a stop
    const hiddenField = { id: 'x', closest: (s: string) => (s === '[hidden]' ? {} : null), getClientRects: () => [], focus() { doc.activeElement = this; } };
    const doc: { activeElement: unknown } = { activeElement: keys[2] };
    const dialog = { ownerDocument: doc, querySelectorAll: () => [...keys, hiddenField], contains: (x: unknown) => keys.includes(x as never) } as unknown as HTMLElement;
    let prevented = 0;
    trapTab(dialog, { shiftKey: false, preventDefault: () => void prevented++ } as KeyboardEvent);
    expect(doc.activeElement).toBe(keys[0]);
    trapTab(dialog, { shiftKey: true, preventDefault: () => void prevented++ } as KeyboardEvent);
    expect(doc.activeElement).toBe(keys[2]);
    doc.activeElement = keys[1];
    trapTab(dialog, { shiftKey: false, preventDefault: () => void prevented++ } as KeyboardEvent);
    expect(doc.activeElement).toBe(keys[1]);
    expect(prevented).toBe(2);
  });
  it('to === from: no Apply; a preview closed before it lands is dropped', async () => {
    const r = flowRig({ preview: [answer({ from: 2, to: 2, requested: 3, window: 2 })] });
    await r.open();
    expect(r.flow.view()?.keys.map((k) => k.act)).toEqual(['close']);
    await r.flow.apply(true);
    expect(r.timers).toEqual([]);
    const late = flowRig();
    late.flow.open({ hsid: H, from: 2, requested: 3, model: 'qwen' }, true);
    late.flow.close();
    await late.settle();
    expect(late.flow.state()).toBeNull();
    expect(late.timers).toEqual([]);
  });
});
