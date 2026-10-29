/**
 * C5'b (8.0:local-lane, Mika): per-server trust in Settings › MCP servers. The chip, the keys, the refusal words (never
 * a code), the inline preview in every phase (checking, ready, expired, stale, refused, committing, pending), one commit
 * per preview, the outcomes under the row, focus after each, and server names as display text.
 */
import { describe, expect, it } from 'vitest';
import { emptyMcpUi, mcpSection, readsShown, trustKeys, trustRefusalWords, TRUST_COPY, type McpUi } from '../src/core/mcp-servers.js';
import { McpServersController } from '../src/ui/mcp-servers.js';
import { RpcError } from '../src/core/client.js';
import type { SettingRow } from '../src/core/settings.js';

const row = (o: Record<string, unknown>) => ({ id: 'user::neurons', name: 'neurons', sessionName: 'neurons', source: 'user', repo: null, plugin: null, transport: 'stdio', command: '/opt/homebrew/bin/node', args: ['/x/main.js'], url: null, host: null, envNames: [], headerNames: [], needs: [], shell: null, fetches: null, problems: [], on: { all: true, repos: [] }, changed: false, trust: { level: 'untrusted', why: null }, ...o });
const status = (servers: unknown[] = [row({})]) => ({ mcp: { offered: true, platform: 'darwin', unsupported: null, envFile: '~/.gnomon/loop-env', firstParty: { id: 'first-party:paradigm', name: 'paradigm', on: true, available: true, version: '8.0.0', trust: { level: 'first-party', why: 'first-party' } }, servers, repos: [], pending: [] } });
const rows = (s: unknown, ui: McpUi = emptyMcpUi()): SettingRow[] => mcpSection({ status: s, ui, hsid: null }).rows;
const byLabel = (rs: SettingRow[], l: string) => rs.find((r) => 'label' in r && r.label === l) as (SettingRow & { keys?: Array<Record<string, unknown>>; how?: string; chip?: { text: string; ink?: boolean } }) | undefined;
const keyActs = (r: { keys?: Array<Record<string, unknown>> } | undefined): string[] => (r?.keys ?? []).map((k) => String(k.act));
const CODES = ['platform', 'not-found', 'first-party', 'not-local', 'remote', 'fetches', 'remote-proxy', 'problem', 'bad-id', 'not-enabled', 'not-listed', 'changed', 'unavailable', 'stale', 'something-new'];

describe("C5'b trust on the server's row", () => {
  it('the chip tells untrusted, trusted and first-party by its word (ink for trusted and first-party, never a hue)', () => {
    const rs = rows(status([row({}), row({ id: 'user::git', name: 'git', trust: { level: 'trusted', why: null } })]));
    expect(byLabel(rs, 'neurons')!.chip).toEqual({ text: 'untrusted' });
    expect(byLabel(rs, 'git')!.chip).toEqual({ text: 'trusted', ink: true });
    expect(byLabel(rs, 'Paradigm MCP · first-party')!.chip).toEqual({ text: 'first-party', ink: true });
  });

  it('untrusted and allowed: Trust…; trusted: Clear trust (quiet); no trust data: no chip and no key', () => {
    const rs = rows(status([row({}), row({ id: 'user::git', name: 'git', trust: { level: 'trusted', why: null } }), row({ id: 'user::old', name: 'old', trust: undefined })]));
    expect(keyActs(byLabel(rs, 'neurons'))).toContain('mcp:trust');
    const clear = byLabel(rs, 'git')!.keys!.find((k) => k.act === 'mcp:untrust')!;
    expect(clear).toMatchObject({ label: 'Clear trust', quiet: true });
    expect(byLabel(rs, 'old')!.chip).toBeUndefined();
    expect(keyActs(byLabel(rs, 'old')).some((a) => a.includes('trust'))).toBe(false);
  });

  it('every refusal maps to words: lasting ones show no key, passing ones keep Trust… aria-disabled; no code is ever shown', () => {
    for (const why of CODES) {
      const w = trustRefusalWords(why);
      expect(['none', 'disabled']).toContain(w.key);
      if (why !== 'changed') expect(w.how).not.toContain(why);
    }
    expect(trustRefusalWords('not-enabled').key).toBe('disabled');
    expect(trustRefusalWords('not-listed').key).toBe('disabled');
    expect(trustRefusalWords('changed').key).toBe('disabled');
    for (const why of ['platform', 'problem', 'not-local', 'remote', 'fetches', 'remote-proxy', 'bad-id']) expect(trustRefusalWords(why).key).toBe('none');
    expect(trustRefusalWords('bad-id', { source: 'plugin', plugin: { id: 'p@m' } }).how).toBe('can’t be trusted: its name can’t be recorded · next: rename it in the plugin p@m');
    const rs = rows(status([row({ trust: { level: 'untrusted', why: 'not-listed' } }), row({ id: 'user::f', name: 'f', trust: { level: 'untrusted', why: 'fetches' } })]));
    const n = byLabel(rs, 'neurons')!;
    expect(n.keys!.find((k) => k.act === 'mcp:trust')).toMatchObject({ ariaDisabled: true });
    expect(n.how).toContain('Trust… opens once a local session lists its tools · next: open a local session in a folder where it’s on');
    const f = byLabel(rs, 'f')!;
    expect(keyActs(f)).not.toContain('mcp:trust');
    expect(f.how).toContain('can’t be trusted: it downloads what it runs at each launch');
    expect(f.how).not.toContain('fetches');
  });

  it('reads cap at 12 with "+N more"', () => {
    const r = Array.from({ length: 15 }, (_, i) => `t${i}`);
    expect(readsShown(r)).toEqual([...r.slice(0, 12), '+3 more']);
    expect(readsShown(['a'])).toEqual(['a']);
  });

  it('server names are display text everywhere (bidi controls shown as marks, never raw)', () => {
    const evil = 'ev‮il';
    const rs = rows(status([row({ name: evil })]));
    expect(rs.some((r) => 'label' in r && r.label === 'ev⟨RLO⟩il')).toBe(true);
    expect(JSON.stringify(rs)).not.toContain('‮');
    expect(byLabel(rs, 'ev⟨RLO⟩il')!.keys!.find((k) => k.act === 'mcp:trust')!.title).toBe('Trust · ev⟨RLO⟩il');
    expect(trustKeys).toBeTypeOf('function');
  });
});

describe("C5'b trust preview (TrustFlow, inline under the row)", () => {
  function ctl(answer: (req: { kind: string; payload: Record<string, unknown> }) => Promise<unknown>, s: unknown = status()) {
    const calls: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const focus: string[] = [];
    const timers: Array<() => void> = [];
    let active: string | null = null;
    const c = new McpServersController({
      call: (r) => (calls.push(r), answer(r)),
      status: () => s,
      hsid: () => null,
      now: () => Date.parse('2026-10-28T14:00:00Z'),
      time: () => '14:02',
      refreshStatus: async () => undefined,
      repaint: () => undefined,
      decide: () => undefined,
      focus: (x) => {
        focus.push(x);
        const m = /data-lm-act="([^"]+)"/.exec(x);
        active = m ? m[1]! : null;
      },
      focused: () => active,
      timer: (fn) => (timers.push(fn), () => undefined),
    });
    return { c, calls, focus, timers, setActive: (a: string | null) => (active = a) };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const preview = { id: 'user::neurons', name: 'neurons', preview: true, token: 'tok-1', expiresAt: '2026-10-28T14:05:00Z', notice: "Trust neurons's tool labels? …", reads: ['search', 'read'] };
  const panel = (c: McpServersController) => rows(status(), c.ui()).find((r) => r.id === 'mcp-trust' || r.id === 'mcp-trust-request') as (SettingRow & { confirm?: { text: string; lines?: string[]; list?: string[]; after?: string[]; result?: { lead?: string; text: string }; keys: Array<Record<string, unknown>> }; result?: { lead?: string; text: string } }) | undefined;

  it('an untrusted press sends nothing; checking → ready: the notice verbatim, the reads, Trust · root card and Cancel', async () => {
    const { c, calls, focus, setActive } = ctl(async () => preview);
    c.press('mcp:trust', 'user::neurons', false);
    expect(calls).toEqual([]);
    setActive('mcp:trust');
    c.press('mcp:trust', 'user::neurons', true);
    expect(calls).toEqual([{ kind: 'request.mcp.trust', payload: { id: 'user::neurons', op: 'preview' } }]);
    // checking: the primary is busy (aria-busy, aria-disabled) and takes focus
    const p0 = panel(c)!;
    expect(p0.confirm!.text).toBe(TRUST_COPY.checking);
    expect(p0.confirm!.keys[0]).toMatchObject({ act: 'mcp:trust-commit', label: 'Trust · root card', busy: true, ariaDisabled: true });
    expect(focus.at(-1)).toContain('mcp:trust-commit');
    expect(mcpSection({ status: status(), ui: c.ui(), hsid: null }).live).toBe(TRUST_COPY.checking);
    await flush();
    const p = panel(c)!;
    expect(p.confirm!.text).toBe('Gnomon will believe what neurons says about its tools.');
    expect(p.confirm!.lines).toEqual(['These run with no card:']);
    expect(p.confirm!.after).toEqual([TRUST_COPY.after]);
    expect(JSON.stringify(p)).not.toContain(preview.notice); // the kernel's notice stays on the card
    expect(p.confirm!.list).toEqual(['search', 'read']);
    expect(p.confirm!.keys.map((k) => [k.act, k.label, !!k.pri, !!k.quiet])).toEqual([['mcp:trust-commit', 'Trust · root card', true, false], ['mcp:trust-cancel', 'Cancel', false, true]]);
    expect(JSON.stringify(c.ui())).not.toContain('tok-1'); // the token never sits in view state
    // the panel sits right under its server's row
    const rs = rows(status(), c.ui());
    expect(rs[rs.findIndex((r) => 'label' in r && r.label === 'neurons') + 1]!.id).toBe('mcp-trust');
  });

  it('no reads: one line, no lead and no list', async () => {
    const { c } = ctl(async () => ({ ...preview, reads: [] }));
    c.press('mcp:trust', 'user::neurons', true);
    await flush();
    expect(panel(c)!.confirm!.lines).toEqual(['No tool runs without a card. Trust lets you make Always rules for its tools.']);
    expect(panel(c)!.confirm!.list).toBeUndefined();
    expect(panel(c)!.confirm!.after).toBeUndefined();
  });

  it('at expiresAt the primary becomes Preview again (no countdown); it sends a new preview, never a commit', async () => {
    const { c, calls, timers, focus, setActive } = ctl(async () => preview);
    c.press('mcp:trust', 'user::neurons', true);
    await flush();
    setActive('mcp:trust-commit');
    timers[0]!();
    const p = panel(c)!;
    expect(p.confirm!.keys[0]).toMatchObject({ act: 'mcp:trust-again', label: 'Preview again', pri: true });
    expect(focus.at(-1)).toContain('mcp:trust-again');
    c.press('mcp:trust-commit', 'user::neurons', true);
    expect(calls).toHaveLength(1); // no token: no commit
    c.press('mcp:trust-again', 'user::neurons', true);
    expect(calls.at(-1)).toEqual({ kind: 'request.mcp.trust', payload: { id: 'user::neurons', op: 'preview' } });
  });

  it('a double press sends ONE commit; pending shows the request row; Decide in the stack takes focus', async () => {
    const { c, calls, focus, setActive } = ctl(async (r) => (r.payload.op === 'commit' ? { id: 'user::neurons', pending: true, cardId: 'card:T' } : preview));
    c.press('mcp:trust', 'user::neurons', true);
    await flush();
    setActive('mcp:trust-commit');
    c.press('mcp:trust-commit', 'user::neurons', true);
    c.press('mcp:trust-commit', 'user::neurons', true);
    expect(panel(c)!.confirm!.text).toBe(TRUST_COPY.committing);
    await flush();
    expect(calls.filter((x) => x.payload.op === 'commit')).toEqual([{ kind: 'request.mcp.trust', payload: { id: 'user::neurons', op: 'commit', token: 'tok-1' } }]);
    const req = panel(c)!;
    expect(req).toMatchObject({ kind: 'request', chip: 'card waiting', line: 'trust neurons’s tool labels' });
    expect(keyActs(req as never)).toEqual(['mcp:decide']);
    expect(focus.at(-1)).toBe('[data-lm-act="mcp:decide"][data-lm-value="card:T"]');
    // Esc does not drop a waiting card
    expect(c.escape()).toBe(false);
  });

  it('a stale commit refusal offers Preview again; another refusal says Not changed in words (never the code)', async () => {
    const stale = new RpcError({ code: 'BAD_REQUEST', reason: 'bad-params', message: 'stale', next: [], data: { why: 'stale', id: 'user::neurons' } } as never);
    const { c } = ctl(async (r) => {
      if (r.payload.op === 'commit') throw stale;
      return preview;
    });
    c.press('mcp:trust', 'user::neurons', true);
    await flush();
    c.press('mcp:trust-commit', 'user::neurons', true);
    await flush();
    expect(panel(c)!.confirm!.keys[0]).toMatchObject({ act: 'mcp:trust-again' });
    const changed = new RpcError({ code: 'UNSUPPORTED', reason: 'bad-params', message: '#mcp-servers: cannot trust', next: [], data: { why: 'not-listed', id: 'user::neurons' } } as never);
    const { c: c2, focus, setActive } = ctl(async () => {
      throw changed;
    });
    setActive('mcp:trust');
    c2.press('mcp:trust', 'user::neurons', true);
    await flush();
    const p = { result: panel(c2)!.confirm!.result };
    expect(panel(c2)!.confirm!.keys.map((k) => [k.act, k.label])).toEqual([['mcp:trust-cancel', 'Close']]);
    expect(panel(c2)!.result).toBeUndefined();
    expect(p.result!.lead).toBe('Not changed:');
    expect(p.result!.text).toContain('next: open a local session');
    expect(p.result!.text).not.toContain('not-listed');
    expect(p.result!.text).not.toContain('#mcp-servers');
    expect(focus.at(-1)).toContain('mcp:trust-cancel');
  });

  it('Esc (or Cancel) closes the panel and returns focus to Trust…', async () => {
    const { c, focus } = ctl(async () => preview);
    c.press('mcp:trust', 'user::neurons', true);
    await flush();
    expect(c.escape()).toBe(true);
    expect(c.ui().trust).toBeNull();
    expect(focus.at(-1)).toBe('[data-lm-act="mcp:trust"][data-lm-value="user::neurons"]');
    c.press('mcp:trust', 'user::neurons', true);
    c.press('mcp:trust-cancel', 'user::neurons', true);
    expect(c.ui().trust).toBeNull();
    expect(focus.at(-1)).toBe('[data-lm-act="mcp:trust"][data-lm-value="user::neurons"]');
  });

  it('a passing refusal: the aria-disabled Trust… press sends nothing', () => {
    const { c, calls } = ctl(async () => preview, status([row({ trust: { level: 'untrusted', why: 'changed' } })]));
    c.press('mcp:trust', 'user::neurons', true);
    expect(calls).toEqual([]);
    expect(c.ui().trust).toBeNull();
  });

  for (const [kind, decision, lead, text] of [
    ['approval.decide', 'allow', 'Trusted', ' neurons’s tool labels at 14:02. 2 tools run with no card.'],
    ['approval.decide', 'deny', 'Not changed:', ' neurons stays untrusted; the card was denied at 14:02.'],
    ['approval.expire', undefined, 'Not changed:', ' neurons stays untrusted; the card expired at 14:02.'],
  ] as const) {
    it(`the outcome under the row (${kind} ${decision ?? ''}); focus on the server's first key`, async () => {
      const { c, focus } = ctl(async (r) => (r.payload.op === 'commit' ? { pending: true, cardId: 'card:T' } : preview));
      c.press('mcp:trust', 'user::neurons', true);
      await flush();
      c.press('mcp:trust-commit', 'user::neurons', true);
      await flush();
      c.row({ kind: 'approval.decide', payload: { cardId: 'card:other', decision: 'allow' } });
      expect(c.ui().trust?.phase).toBe('pending');
      c.row({ kind, payload: { cardId: 'card:T', ...(decision ? { decision } : {}) } });
      expect(c.ui().trust).toBeNull();
      expect(c.ui().result).toMatchObject({ lead, text });
      const rs = rows(status(), c.ui());
      expect(rs[rs.findIndex((r) => 'label' in r && r.label === 'neurons') + 1]!.id).toBe('mcp-result');
      await flush();
      expect(focus.at(-1)).toBe('[data-lm-value="user::neurons"]:not([disabled])');
    });
  }

  it('Clear trust: request.mcp.trust{op:clear}, no card, the result under the row, focus on its first key', async () => {
    const { c, calls, focus } = ctl(async () => ({ id: 'user::neurons', trusted: false, cleared: true }), status([row({ trust: { level: 'trusted', why: null } })]));
    c.press('mcp:untrust', 'user::neurons', true);
    await flush();
    await flush();
    expect(calls).toEqual([{ kind: 'request.mcp.trust', payload: { id: 'user::neurons', op: 'clear' } }]);
    expect(c.ui().result).toMatchObject({ lead: 'Cleared:', text: " Gnomon no longer trusts neurons’s tool labels (14:02). Its tools ask again; its Always rules are paused." });
    expect(focus.at(-1)).toBe('[data-lm-value="user::neurons"]:not([disabled])');
  });

  it("Mika rework: another server's Trust… takes over a ready, expired or refused panel; committing and pending block, saying why", async () => {
    const two = status([row({}), row({ id: 'user::linear', name: 'linear' })]);
    let pend: (v: unknown) => void = () => undefined;
    const { c, calls } = ctl((r) => (r.payload.op === 'commit' ? new Promise((res) => (pend = res)) : Promise.resolve({ ...preview, token: `tok-${String(r.payload.id)}` })), two);
    c.press('mcp:trust', 'user::neurons', true);
    await flush();
    expect(c.ui().trust).toMatchObject({ id: 'user::neurons', phase: 'ready' });
    // the same server's Trust… leaves its open panel as it is (no second preview)
    c.press('mcp:trust', 'user::neurons', true);
    expect(calls).toHaveLength(1);
    // another server's Trust…: the ready panel gives way (its token dropped), the new one opens
    c.press('mcp:trust', 'user::linear', true);
    await flush();
    expect(c.ui().trust).toMatchObject({ id: 'user::linear', phase: 'ready' });
    c.press('mcp:trust-commit', 'user::linear', true);
    expect(c.ui().trust!.phase).toBe('committing');
    // committing: Esc is consumed (the sheet stays), the open Trust… is aria-disabled, the other waits and says why
    expect(c.escape()).toBe(true);
    const rs = rows(two, c.ui());
    expect(byLabel(rs, 'linear')!.keys!.find((k) => k.act === 'mcp:trust')).toMatchObject({ ariaDisabled: true, expanded: true });
    const n = byLabel(rs, 'neurons')!;
    expect(n.keys!.find((k) => k.act === 'mcp:trust')).toMatchObject({ ariaDisabled: true, title: 'one trust preview at a time: finish or cancel linear’s first' });
    expect(n.how).toContain('one trust preview at a time: finish or cancel linear’s first');
    c.press('mcp:trust', 'user::neurons', true);
    expect(c.ui().trust!.id).toBe('user::linear');
    pend({ pending: true, cardId: 'card:L' });
    await flush();
    expect(c.ui().trust!.phase).toBe('pending');
    expect(byLabel(rows(two, c.ui()), 'linear')!.keys!.find((k) => k.act === 'mcp:trust')).toMatchObject({ ariaDisabled: true });
    c.press('mcp:trust', 'user::neurons', true);
    expect(c.ui().trust!.id).toBe('user::linear');
    // pending: Esc closes the sheet (not consumed); the card stays in the stack
    expect(c.escape()).toBe(false);
    expect(c.ui().trust!.phase).toBe('pending');
  });
});

describe("C5'b chip only where trust is a question (Mika)", () => {
  it('no chip for not-local, remote, problem, platform or a row with a problem; untrusted stays for fetches, remote-proxy, bad-id', () => {
    const rs = rows(status([row({ id: 'a', name: 'a', trust: { level: 'untrusted', why: 'not-local' } }), row({ id: 'b', name: 'b', trust: { level: 'untrusted', why: 'remote' } }), row({ id: 'c', name: 'c', trust: { level: 'untrusted', why: 'problem' } }), row({ id: 'd', name: 'd', trust: { level: 'untrusted', why: 'platform' } }), row({ id: 'e', name: 'e', problems: [{ code: 'command', text: 'e is not on the PATH' }] }), row({ id: 'f', name: 'f', trust: { level: 'untrusted', why: 'fetches' } }), row({ id: 'g', name: 'g', trust: { level: 'untrusted', why: 'remote-proxy' } }), row({ id: 'h', name: 'h', trust: { level: 'untrusted', why: 'bad-id' } })]));
    for (const l of ['a', 'b', 'c', 'd', 'e']) expect(byLabel(rs, l)!.chip, l).toBeUndefined();
    for (const l of ['f', 'g', 'h']) expect(byLabel(rs, l)!.chip, l).toEqual({ text: 'untrusted' });
  });

  it("the enable flow's outcome grammar: the card expired at / the card was denied at", async () => {
    const { notChangedResult } = await import('../src/core/mcp-servers.js');
    expect(notChangedResult('neurons', '14:12', 'expired').text).toBe(' neurons stays off; the card expired at 14:12.');
    expect(notChangedResult('neurons', '14:02', 'denied').text).toBe(' neurons stays off; the card was denied at 14:02.');
  });

  it('a refused panel paints its reason INSIDE the block as a role=alert result line, above Close', async () => {
    const { sectionEl } = await import('../src/ui/settings-sheet.js');
    type El = { tag: string; className: string; attrs: Map<string, string>; kids: unknown[]; appendChild(c: unknown): unknown; setAttribute(n: string, v: string): void };
    const doc = { createElement: (tag: string) => ({ tag, className: '', attrs: new Map(), kids: [], appendChild(this: El, c: unknown) { this.kids.push(c); return c; }, setAttribute(this: El, n: string, v: string) { this.attrs.set(n, v); } }), createTextNode: (t: string) => t };
    const ui = { ...emptyMcpUi(), trust: { id: 'user::neurons', name: 'neurons', phase: 'refused' as const, notice: null, reads: [], expiresAt: null, result: { lead: 'Not changed:', text: ' it changed since a session listed its tools · next: open a new local session', fail: true }, cardId: null } };
    const sec = sectionEl(doc as never, mcpSection({ status: status(), ui, hsid: null })) as unknown as El;
    const all = (e: El): El[] => [e, ...e.kids.filter((k): k is El => typeof k === 'object').flatMap(all)];
    const block = all(sec).find((e) => e.className === 'set-form')!;
    const alert = all(block).find((e) => e.attrs.get('role') === 'alert')!;
    expect(alert.className).toContain('sf-result fail');
    expect(all(block).find((e) => e.tag === 'button')!.kids).toEqual(['Close']);
  });

  it('a disabled or aria-disabled plain key draws the quiet look (no key edge, no offset), and the system records it', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../static/styles.css', import.meta.url), 'utf8');
    const plain = '.key[disabled], .key[aria-disabled="true"] { border-color: var(--rule); box-shadow: none; }';
    expect(css).toContain(plain);
    // the primary key's own disabled rule still wins: more specific (.key.pri[disabled]), later in the file, and it
    // keeps its own fill and text (--sheet, --sec)
    const pri = '.key.pri[disabled] { background: var(--sheet); color: var(--sec); border-color: var(--rule); box-shadow: none; }';
    expect(css).toContain(pri);
    expect(css.indexOf(pri)).toBeGreaterThan(css.indexOf(plain));
    const ds = readFileSync(new URL('../../../.atelier/systems/gnomon/design-system.yaml', import.meta.url), 'utf8');
    expect(ds).toContain('any disabled or aria-disabled key draws the quiet look, border --rule and no offset shadow (.key[disabled], .key[aria-disabled=true])');
  });

  it('the Settings dialog keeps Tab inside it with the shared trapTab (never a copy)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/ui/settings-sheet.ts', import.meta.url), 'utf8');
    expect(src).toContain("import { trapTab } from './tier-picker.js';");
    expect(src).toMatch(/key === 'Tab' && !overlay\.hidden\) trapTab\(dialog, e as KeyboardEvent\)/);
    expect(src).not.toMatch(/function trapTab/);
  });
});
