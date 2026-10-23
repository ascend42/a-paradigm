/**
 * #gui-mcp-servers (T-2026-10-23-003): the Settings › MCP servers section from status.mcp, its keys, the request
 * each press sends, and the press path's outcomes (a card waiting, allow, deny, a refusal).
 */
import { describe, expect, it } from 'vitest';
import { MCP_COPY, MCP_FIRST_PARTY, MCP_SECTION, mcpRefusalText, mcpRequestOf, mcpSection, emptyMcpUi } from '../src/core/mcp-servers.js';
import { McpServersController } from '../src/ui/mcp-servers.js';
import { GUI_COMMANDS } from '../src/core/commands.js';
import { RpcError } from '../src/core/client.js';
import type { SettingRow } from '../src/core/settings.js';

const row = (o: Record<string, unknown>) => ({ id: 'user::neurons', name: 'neurons', sessionName: 'neurons', source: 'user', repo: null, plugin: null, transport: 'stdio', command: '/opt/homebrew/bin/node', args: ['/x/main.js', 'mcp'], url: null, host: null, envNames: ['NEURONS_VAULT'], headerNames: [], needs: [], shell: null, fetches: null, problems: [], on: { all: false, repos: [] }, changed: false, ...o });
const status = (o: Record<string, unknown> = {}) => ({
  mcp: {
    offered: true,
    platform: 'darwin',
    unsupported: null,
    envFile: '~/.gnomon/loop-env',
    firstParty: { id: MCP_FIRST_PARTY, name: 'paradigm', on: true, available: true, version: '8.0.0' },
    servers: [row({}), row({ id: 'user::linear', name: 'linear', sessionName: 'linear', transport: 'http', command: null, args: [], url: 'https://mcp.linear.app/mcp', host: 'mcp.linear.app', envNames: [], headerNames: ['Authorization'] }), row({ id: 'plugin:paradigm@a-paradigm:paradigm', name: 'paradigm', sessionName: 'plugin_paradigm_paradigm', source: 'plugin', plugin: { id: 'paradigm@a-paradigm', version: '7.15.2' }, problems: [{ code: 'first-party', text: 'Gnomon runs the Paradigm MCP itself in every session' }] })],
    repos: [{ repo: '/r/app', folder: 'app', hsids: ['h1'], servers: [row({ id: 'project:/r/app:tool', name: 'tool', sessionName: 'tool', source: 'project', repo: '/r/app', command: '/opt/homebrew/bin/npx', fetches: 'npx' })] }],
    pending: [],
    ...o,
  },
});
const rows = (s: unknown, hsid: string | null = 'h1', ui = emptyMcpUi()): SettingRow[] => mcpSection({ status: s, ui, hsid }).rows;
const keysOf = (r: SettingRow | undefined): string[] => (r && 'keys' in r && r.keys ? r.keys.map((k) => `${k.act}${k.value ? `=${k.value}` : ''}`) : []);
const byLabel = (rs: SettingRow[], l: string) => rs.find((r) => 'label' in r && r.label === l);

describe('#gui-mcp-servers section', () => {
  it('is a kernel-owned section with the first-party Paradigm MCP on, and names, never values', () => {
    const sec = mcpSection({ status: status(), ui: emptyMcpUi(), hsid: 'h1' });
    expect(sec).toMatchObject({ id: MCP_SECTION, title: 'MCP servers', owner: '· kernel-owned' });
    const fp = byLabel(sec.rows, 'Paradigm MCP · first-party')!;
    expect(fp).toMatchObject({ value: 'on in every session · paradigm 8.0.0', mark: '✓' });
    expect(keysOf(fp)).toEqual([`mcp:fp-off=${MCP_FIRST_PARTY}`]);
    const n = byLabel(sec.rows, 'neurons')!;
    expect((n as { how: string }).how).toContain('env NEURONS_VAULT (values not shown)');
    expect((byLabel(sec.rows, 'linear') as { how: string }).how).toContain('headers Authorization (values not shown)');
  });

  it('a user server offers On for all repos and On in <folder>; a repo .mcp.json server offers only On in its folder', () => {
    const rs = rows(status());
    expect(keysOf(byLabel(rs, 'neurons'))).toEqual(['mcp:on-all=user::neurons', 'mcp:on-repo=user::neurons']);
    const t = byLabel(rs, 'tool · app (repo)')!;
    expect(keysOf(t)).toEqual(['mcp:on-repo=project:/r/app:tool']);
    expect((t as { how: string }).how).toContain('downloads what it runs at each launch (npx)');
    // no focused session: no repo rows and no "On in"
    expect(keysOf(byLabel(rows(status(), null), 'neurons'))).toEqual(['mcp:on-all=user::neurons']);
    expect(byLabel(rows(status(), null), 'tool · app (repo)')).toBeUndefined();
  });

  it('a server with a problem shows ✕ and the reason, with no key; changed shows ?; on shows ✓ and Turn off', () => {
    // the Paradigm plugin copy is covered by the first-party server: no ✕ (Mika), no key
    const p = byLabel(rows(status()), 'paradigm · plugin')!;
    expect(p).toMatchObject({ value: MCP_COPY.covered });
    expect('mark' in p && p.mark).toBeFalsy();
    expect(keysOf(p)).toEqual([]);
    // a real problem: ✕, the kernel's reason, and what to do next
    const bad = byLabel(rows(status({ servers: [row({ id: 'user::s', name: 's', problems: [{ code: 'command', text: 's is not on the session PATH' }] })] })), 's')!;
    expect(bad).toMatchObject({ mark: '✕', value: 's is not on the session PATH' });
    expect((bad as { how: string }).how).toContain('next: install it, or give its full path in ~/.claude.json');
    const s2 = status({ servers: [row({ on: { all: true, repos: [] } }), row({ id: 'user::x', name: 'x', changed: true })] });
    expect(byLabel(rows(s2), 'neurons')).toMatchObject({ mark: '✓', value: 'on in every repo' });
    expect(keysOf(byLabel(rows(s2), 'neurons'))).toEqual(['mcp:off=user::neurons']);
    expect(byLabel(rows(s2), 'x')).toMatchObject({ mark: '?' });
  });

  it('a waiting card shows the request row with Decide in the stack; Windows shows rows without keys', () => {
    const rs = rows(status({ pending: [{ cardId: 'card:A', id: 'user::neurons', scope: 'all', repo: null }] }));
    const req = rs.find((r) => r.kind === 'request')!;
    expect(req).toMatchObject({ chip: 'card waiting', line: 'turn on neurons · all repos' });
    expect(keysOf(req)).toEqual(['mcp:decide=card:A']);
    expect(keysOf(byLabel(rs, 'neurons'))).toEqual([]); // no second ask while one waits
    // the waiting row sits under the server it is for, not after the last server
    const ids = rs.map((r) => r.id);
    expect(ids.indexOf('mcp-request')).toBe(ids.indexOf(byLabel(rs, 'neurons')!.id) + 1);
    const win = rows(status({ platform: 'win32', unsupported: 'platform' }));
    expect(keysOf(byLabel(win, 'neurons'))).toEqual([]);
    // Windows: the reason comes before the rows it explains
    expect(win.findIndex((r) => r.id === 'mcp-windows')).toBeLessThan(win.findIndex((r) => 'label' in r && r.label === 'neurons'));
    // the focused folder's servers start their own group
    expect(byLabel(rows(status()), 'tool · app (repo)')).toMatchObject({ grp: true });
  });

  it('not connected and an older kernel say so; the palette has "MCP servers…"', () => {
    expect(rows(null)[0]).toMatchObject({ value: 'not connected' });
    expect(rows({})[0]).toMatchObject({ value: 'not offered by this kernel' });
    expect(GUI_COMMANDS.find((c) => c.id === 'mcp.open')?.title).toBe('MCP servers…');
  });

  it('each press sends exactly its request', () => {
    expect(mcpRequestOf('mcp:on-all', 'i', '/r')).toEqual({ kind: 'request.mcp.enable', payload: { id: 'i', scope: 'all' } });
    expect(mcpRequestOf('mcp:on-repo', 'i', '/r')).toEqual({ kind: 'request.mcp.enable', payload: { id: 'i', scope: 'repo', repo: '/r' } });
    expect(mcpRequestOf('mcp:on-repo', 'i', null)).toBeNull();
    expect(mcpRequestOf('mcp:off', 'i', null)).toEqual({ kind: 'request.mcp.disable', payload: { id: 'i' } });
    expect(mcpRequestOf('mcp:fp-off', MCP_FIRST_PARTY, null)).toEqual({ kind: 'request.mcp.disable', payload: { id: MCP_FIRST_PARTY } });
  });
});

describe('#gui-mcp-servers press path', () => {
  function ctl(answer: (req: unknown) => Promise<unknown>) {
    const calls: unknown[] = [];
    const decided: string[] = [];
    const c = new McpServersController({ call: (r) => (calls.push(r), answer(r)), status: () => status(), hsid: () => 'h1', now: () => 0, time: () => '10:00', refreshStatus: async () => undefined, repaint: () => undefined, decide: (id) => decided.push(id) });
    return { c, calls, decided };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('an untrusted press sends nothing; On for all repos raises the card and shows the request; allow says On', async () => {
    const { c, calls, decided } = ctl(async () => ({ pending: true, cardId: 'card:B' }));
    c.press('mcp:on-all', 'user::neurons', false);
    expect(calls).toEqual([]);
    c.press('mcp:on-all', 'user::neurons', true);
    await flush();
    expect(calls).toEqual([{ kind: 'request.mcp.enable', payload: { id: 'user::neurons', scope: 'all' } }]);
    expect(c.ui().request).toEqual({ cardId: 'card:B', line: '10:00 · turn on neurons · all repos' });
    c.press('mcp:on-repo', 'user::neurons', true); // one at a time
    expect(calls).toHaveLength(1);
    c.press('mcp:decide', 'card:B', true);
    expect(decided).toEqual(['card:B']);
    c.row({ kind: 'approval.decide', payload: { cardId: 'card:B', decision: 'allow' } });
    expect(c.ui().result).toMatchObject({ lead: 'On' });
    expect(c.ui().request).toBeNull();
  });

  it('deny says Not changed; a refusal shows the kernel line', async () => {
    const a = ctl(async () => ({ pending: true, cardId: 'card:C' }));
    a.c.press('mcp:on-repo', 'project:/r/app:tool', true);
    await flush();
    expect(a.calls[0]).toEqual({ kind: 'request.mcp.enable', payload: { id: 'project:/r/app:tool', scope: 'repo', repo: '/r/app' } });
    a.c.row({ kind: 'approval.decide', payload: { cardId: 'card:C', decision: 'deny' } });
    expect(a.c.ui().result).toMatchObject({ lead: 'Not changed:' });
    const b = ctl(async () => {
      throw new RpcError({ code: 'BAD_REQUEST', reason: 'bad-params', message: '#mcp-servers: tool comes from a repo: that repo only', next: [], data: null } as never);
    });
    b.c.press('mcp:on-all', 'project:/r/app:tool', true);
    await flush();
    expect(b.c.ui().result).toMatchObject({ fail: true });
    expect(b.c.ui().result!.text).toContain('that repo only');
    // principle 5: no wire code, no symbol
    expect(b.c.ui().result!.text).not.toContain('BAD_REQUEST');
    expect(b.c.ui().result!.text).not.toContain('#mcp-servers');
    // the result shows under the pressed server's row
    expect(b.c.ui().at).toBe('project:/r/app:tool');
    expect(mcpRefusalText({ code: 'BAD_REQUEST', reason: 'bad-params', message: '#mcp-servers: x', next: [], data: { why: 'repo-only' } })).toContain('next: from a session in that repo, use the On in key for its folder');
  });
});

describe('#gui-mcp-servers enable card face (Mika 2026-10-23)', () => {
  it('shows the kernel lines (what runs, the fetch warning) on the face, not under details, and its title wraps', async () => {
    const { renderCard } = await import('../src/core/render.js');
    type El = { tag: string; className: string; attrs: Map<string, string>; kids: unknown[]; appendChild(c: unknown): unknown; setAttribute(n: string, v: string): void };
    const els: El[] = [];
    const doc = { createElement: (tag: string) => { const e: El = { tag, className: '', attrs: new Map(), kids: [], appendChild(c) { this.kids.push(c); return c; }, setAttribute(n, v) { this.attrs.set(n, v); } }; els.push(e); return e; }, createTextNode: (t: string) => t };
    const textOf = (e: unknown): string => (typeof e === 'string' ? e : (e as El).kids.map(textOf).join('\n'));
    const block = { type: 'Box', children: ['Turn on MCP server pencil for all your repos', 'asked from Settings · 14:07 · applies to new sessions', 'runs /opt/homebrew/bin/npx -y @pencil-dev/mcp-server', 'downloads what it runs at every launch (npx): what runs can change without a new card', 'Allow takes the root key and your presence (Touch ID or your Mac password) · never standing, never by voice; deny changes nothing'].map((text) => ({ type: 'Text', text })) };
    const card = renderCard({ doc } as never, { cardId: 'card:M1', kind: 'grant', requestedBy: 'p:abcdefgh/matt', hsid: null, repo: null, state: 'pending', contentHash: 'sha256:' + 'a'.repeat(64), flags: [], decisions: ['allow', 'deny'], decidable: true, rootRows: { lines: [], action: 'mcp.enable' } } as never, block) as unknown as El;
    const details = els.find((e) => e.tag === 'details')!;
    const face = card.kids.filter((k) => k !== details).map(textOf).join('\n');
    expect(face).toContain('downloads what it runs at every launch');
    expect(face.split('asked from Settings').length).toBe(2); // the k-line once
    expect(textOf(details)).not.toContain('downloads what it runs');
    expect(els.find((e) => e.className.startsWith('card-title'))!.className).toContain('wraps');
  });
});
