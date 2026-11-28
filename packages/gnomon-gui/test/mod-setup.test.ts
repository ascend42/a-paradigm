/**
 * #gui-mod-setup (8.2 fixes item 1, T-2026-11-28-001): the Mods row's one press, "Review first", the banner, the
 * Settings › MCP servers pointer and the session's kernel-voiced line. The GUI holds names only; a canary value placed
 * in a failed row's detail never reaches a painted line.
 */
import { describe, expect, it } from 'vitest';
import type { GnomonClient } from '../src/core/client.js';
import { bannerKey, bannerText, mcpText, noticeLines, quoteArgs, shortName, modCards, modServerNotices, modsViewOf, oneTapOffer, reviewOffers, setupBanner, SETUP_COPY, setupRequest } from '../src/core/mods.js';
import { emptyMcpUi, mcpSection } from '../src/core/mcp-servers.js';
import type { MiniDoc, MiniEl } from '../src/core/render.js';
import type { StackCard } from '../src/core/store.js';
import { emptyUi, paintMods, requestMod, splitArgs } from '../src/ui/mods-panel.js';

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
  removeChild(c: unknown): unknown {
    this.children = this.children.filter((x) => x !== c);
    return c;
  }
  get firstChild(): unknown {
    return this.children[0] ?? null;
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


const CANARY = 'CANARY-vault-0c4e19d7';
const H = (c: string): string => `sha256:${c.repeat(64)}`;
const offer = (o: Record<string, unknown>) => ({ declId: 'user::neurons', name: 'neurons', source: 'user', plugin: null, match: 'name', command: '/opt/homebrew/bin/node', realCommand: '/opt/homebrew/Cellar/node/25.1.0/bin/node', args: ['/Users/me/neurons/dist/cli/main.js', 'mcp'], envNames: ['NEURONS_VAULT'], envDropped: ['OTHER'], envSecret: ['NEURONS_TOKEN'], problem: null, scopeNote: null, oneTap: true, preselected: true, ...o });
const mod = (name: string, setup: unknown[], over: Record<string, unknown> = {}) => ({
  name, publisher: name.split('.')[0], version: '1.1.0', description: null, tier: 'first-party', source: 'package', packageHash: H('9'), dev: false, state: 'running', pausedWhy: null, uninstallRequested: false,
  mcp: { server: `gm_${name.replace('.', '_')}`, overridden: false, configRequested: false, configurable: { command: true, args: true, env: ['NEURONS_VAULT', 'NEURONS_TOKEN'], secret: ['NEURONS_TOKEN'] }, command: 'neurons', args: ['mcp'], launch: 'needs-config', setup, setupPending: null },
  offers: [], desk: { shown: 0, suppressed: 0, kept: 0 }, update: null, ...over,
});
const statusOf = (...installed: unknown[]) => ({ mods: { installed, available: [], catalog: { root: null } } });
const card = (cardId: string, kind: string, detail: Record<string, unknown>): StackCard => ({ cardId, kind, repo: null, hsid: null, card: { cardId, kind, detail }, flags: [], arrivedSeq: 1 });
function painted(status: unknown, cards: StackCard[] = [], ui: ReturnType<typeof emptyUi> & { reviewOpen?: string | null } = emptyUi()): FEl {
  const body = new FEl('div');
  paintMods(fdoc, body, modsViewOf(status, cards), ui);
  return body;
}
const row = (b: FEl, name: string): FEl => b.all().find((e) => e.attrs.get('data-mod') === name)!;
const keys = (el: FEl): string[] => el.all().filter((e) => e.tag === 'button').map((e) => e.attrs.get('data-mod-act')!);
const btn = (el: FEl, act: string): FEl | undefined => el.all().find((e) => e.tag === 'button' && e.attrs.get('data-mod-act') === act);

describe('#gui-mod-setup the Mods row', () => {
  it('one press: the main key is "Set up from your Claude Code config" with "Review first" beside it, quiet', () => {
    const b = painted(statusOf(mod('gnomon.neurons', [offer({})])));
    const r = row(b, 'gnomon.neurons');
    // Mika A9: the setup key first; Configure steps aside while a review is on offer
    expect(keys(r)).toEqual(['setup', 'review', 'pause', 'uninstall']);
    expect(btn(r, 'setup')!.text).toBe(SETUP_COPY.key);
    expect(btn(r, 'setup')!.attrs.get('data-decl')).toBe('user::neurons');
    expect(btn(r, 'review')!.text).toBe(SETUP_COPY.review);
    expect(btn(r, 'review')!.className).toBe('key quiet');
    expect(r.text).toContain("isn't set up, so sessions don't get it");
  });

  it('one press is ONE request naming the server, never a value', async () => {
    const calls: unknown[] = [];
    const client = { call: async (m: string, p: unknown) => void calls.push([m, p]) } as unknown as GnomonClient;
    const v = modsViewOf(statusOf(mod('gnomon.neurons', [offer({})])));
    const tap = oneTapOffer(v.installed[0]!)!;
    await requestMod(client, setupRequest([{ name: 'gnomon.neurons', from: tap.declId }]));
    expect(calls).toEqual([['log.append', { kind: 'request.mod.setup', payload: { items: [{ name: 'gnomon.neurons', from: 'user::neurons' }] } }]]);
  });

  it('not one press (a plugin matched by name only, a third-party mod): only the review key, never the one-press key', () => {
    const b = painted(statusOf(mod('gnomon.neurons', [offer({ source: 'plugin', plugin: { id: 'n@m', version: '1' }, oneTap: false })]), mod('acme.neurons', [offer({ oneTap: false })], { tier: 'local' })));
    for (const n of ['gnomon.neurons', 'acme.neurons']) {
      expect(keys(row(b, n))).not.toContain('setup');
      expect(btn(row(b, n), 'review')!.text).toBe(SETUP_COPY.review);
      expect(btn(row(b, n), 'review')!.className).toBe('key');
    }
  });

  it('a local or project candidate is never one press, whatever a status claims; a project one is a disabled line, not in Review first', () => {
    const v = modsViewOf(statusOf(mod('gnomon.neurons', [offer({ source: 'project', declId: 'project:/r:neurons', problem: "it comes from a repo's .mcp.json" }), offer({ source: 'local', declId: 'local:/r:neurons', scopeNote: 'was for folder r only' })])));
    expect(oneTapOffer(v.installed[0]!)).toBeNull();
    // each field is guarded on its own (a status claiming one press for these is never believed)
    expect(v.installed[0]!.mcp!.setup.map((o) => [o.source, o.oneTap])).toEqual([['project', false], ['local', false]]);
    expect(v.installed[0]!.mcp!.setup.map((o) => [o.source, o.preselected])).toEqual([['project', false], ['local', false]]);
    expect(reviewOffers(v.installed[0]!).map((o) => o.source)).toEqual(['local']);
    const b = painted(statusOf(mod('gnomon.neurons', [offer({ source: 'project', declId: 'project:/r:neurons', problem: "it comes from a repo's .mcp.json" })])));
    const off = row(b, 'gnomon.neurons').all().find((e) => e.className === 'meta mod-offer-off')!;
    expect(off.attrs.get('aria-disabled')).toBe('true');
    expect(off.text).toBe("Not offered: neurons in a repo's .mcp.json (a repo can't set a launch for every repo)");
    expect(keys(row(b, 'gnomon.neurons'))).not.toContain('review');
  });

  it('Review first shows the resolved command with its realpath, env names "value not shown", dropped and secret names, and the scope line', () => {
    const b = painted(statusOf(mod('gnomon.neurons', [offer({}), offer({ source: 'local', declId: 'local:/r:neurons', scopeNote: 'was for folder r only (/r); a mod launch applies to every repo', oneTap: false, preselected: false })])), [], { ...emptyUi(), reviewOpen: 'gnomon.neurons' });
    const form = b.all().find((e) => e.attrs.get('data-review-for') === 'gnomon.neurons')!;
    const t = form.text;
    const facts = form.all().filter((e) => e.className === 'mod-fact').map((e) => e.children.map((c) => (c as FEl).text));
    expect(facts).toEqual([
      ['from', 'your ~/.claude.json (every project), as neurons'],
      ['command', '/opt/homebrew/bin/node → /opt/homebrew/Cellar/node/25.1.0/bin/node'],
      ['env', `NEURONS_VAULT · ${SETUP_COPY.copied}`],
    ]);
    // the args line is dropped while the field is shown, and the field holds the args quoted (Aegis N6)
    expect(facts.some((f) => f[0] === 'args')).toBe(false);
    // the copied env field is empty with its placeholder; keys are sentence case
    const vault = form.all().find((e) => e.attrs.get('data-env') === 'NEURONS_VAULT')!;
    expect([vault.attrs.has('value'), vault.attrs.get('placeholder')]).toEqual([false, SETUP_COPY.copiedPlaceholder]);
    expect(btn(form, 'review-cancel')!.text).toBe('Cancel');
    expect(btn(form, 'review-send')!.text).toBe('Set up');
    expect(t).toContain('not copied, this mod does not take them: OTHER');
    expect(t).toContain('not copied, marked secret');
    // a chooser when there are several, the first (user) picked
    const picks = form.all().filter((e) => e.attrs.get('data-mod-act') === 'review-pick');
    expect(picks.map((r) => r.attrs.get('data-decl'))).toEqual(['user::neurons', 'local:/r:neurons']);
    expect(picks.map((r) => r.attrs.get('aria-pressed'))).toEqual(['true', 'false']);
    // the env inputs start empty: the GUI never holds the copied value
    expect(form.all().filter((e) => e.attrs.has('data-env')).every((e) => !e.attrs.has('value'))).toBe(true);
    const local = painted(statusOf(mod('gnomon.neurons', [offer({ source: 'local', declId: 'local:/r:neurons', scopeNote: 'was for folder r only (/r); a mod launch applies to every repo', oneTap: false, preselected: false })])), [], { ...emptyUi(), reviewOpen: 'gnomon.neurons' });
    // Mika A6: the scope note comes first in the form, in its warn class
    const lf = local.all().find((e) => e.attrs.get('data-review-for') === 'gnomon.neurons')!;
    const firstNote = lf.all().find((e) => e.className === 'meta mod-scope-note')!;
    expect(firstNote.text).toContain('a mod launch applies to every repo');
    expect(lf.all().indexOf(firstNote)).toBeLessThan(lf.all().findIndex((e) => e.className === 'mod-review-facts'));
  });

  it('no match: no setup keys; Configure opens as before', () => {
    const b = painted(statusOf(mod('gnomon.neurons', [])));
    expect(keys(row(b, 'gnomon.neurons'))).toEqual(['pause', 'configure', 'uninstall']);
    expect(row(b, 'gnomon.neurons').attrs.get('tabindex')).toBe('-1');
  });

  it('a setup card waiting: modCards maps mod.mcp.setup to configure for every mod on it, and the keys step aside', () => {
    const cs = [card('card:S1', 'grant', { action: 'mod.mcp.setup', mods: [{ name: 'gnomon.neurons' }, { name: 'gnomon.constellation' }] })];
    expect([...modCards(cs)]).toEqual([['gnomon.neurons', [{ cardId: 'card:S1', kind: 'configure' }]], ['gnomon.constellation', [{ cardId: 'card:S1', kind: 'configure' }]]]);
    const b = painted(statusOf(mod('gnomon.neurons', [offer({})])), cs);
    expect(keys(row(b, 'gnomon.neurons'))).not.toContain('setup');
    expect(row(b, 'gnomon.neurons').text).toContain('launch-change card waiting');
  });
});

describe('#gui-mod-setup the banner', () => {
  it('names how many wait and sends every one-press mod on ONE request', () => {
    const s = statusOf(mod('gnomon.neurons', [offer({})]), mod('gnomon.constellation', [offer({ declId: 'user::constellation', name: 'constellation' })]));
    const bn = setupBanner(modsViewOf(s))!;
    expect(bannerText(bn)).toBe("2 mod servers aren't set up. Both are ready in one press.");
    const b = painted(s);
    const k = btn(b, 'setup-all')!;
    expect(k.text).toBe('Set up both');
    expect(JSON.parse(k.attrs.get('data-items')!)).toEqual([{ name: 'gnomon.neurons', from: 'user::neurons' }, { name: 'gnomon.constellation', from: 'user::constellation' }]);
    // one not one-press: counted, not sent
    const s2 = statusOf(mod('gnomon.neurons', [offer({})]), mod('acme.x', [offer({ oneTap: false })], { tier: 'local' }));
    expect(bannerText(setupBanner(modsViewOf(s2))!)).toBe("2 mod servers aren't set up. neurons is ready in one press; x needs a look first.");
    expect(bannerKey([{ name: 'gnomon.neurons' }])).toBe('Set up neurons');
    expect(bannerKey([{ name: 'a.b' }, { name: 'a.c' }, { name: 'a.d' }])).toBe('Set up all 3');
    expect(bannerText({ waiting: ['gnomon.neurons', 'gnomon.ledger', 'gnomon.paradigm-context'], oneTap: [{ name: 'gnomon.neurons' }] })).toBe("3 mod servers aren't set up. neurons is ready in one press; ledger and paradigm-context need a look first.");
    expect(JSON.parse(btn(painted(s2), 'setup-all')!.attrs.get('data-items')!)).toEqual([{ name: 'gnomon.neurons', from: 'user::neurons' }]);
  });

  it('nothing waits: no banner', () => {
    expect(setupBanner(modsViewOf(statusOf(mod('gnomon.neurons', [], { mcp: { ...mod('x.y', []).mcp, launch: 'ok' } }))))).toBeNull();
  });
});

describe('#gui-mod-setup Settings › MCP servers points at Mods', () => {
  it('a row names the mod servers that need setup and its key opens Mods', () => {
    const s = { ...statusOf(mod('gnomon.neurons', [offer({})])), mcp: { offered: true, firstParty: null, servers: [], repos: [], pending: [], max: 16, skips: [] } };
    const sec = mcpSection({ status: s, ui: emptyMcpUi(), hsid: null });
    const r = sec.rows.find((x) => x.id === 'mcp-mods') as { value: string; how: string; keys: Array<{ act: string }> };
    expect(r.value).toBe("1 isn't set up");
    expect(r.how).toContain('gm_gnomon_neurons');
    expect(r.keys[0]!.act).toBe('mcp:mods');
  });
});

describe('#gui-mod-setup the session line', () => {
  const v = modsViewOf(statusOf(mod('gnomon.neurons', [offer({})])));
  const init = (failed: string[]) => ({ kind: 'turn.event', payload: { line: JSON.stringify({ type: 'system', subtype: 'init', mcp_servers: [{ name: 'paradigm', status: 'connected' }, ...failed.map((name) => ({ name, status: 'failed', error: CANARY }))] }) } });
  const vOk = modsViewOf(statusOf(mod('gnomon.neurons', [], { mcp: { ...mod('gnomon.neurons', []).mcp, launch: 'ok' } })));

  it('an unconfigured mod is unset', () => {
    expect(modServerNotices(v, [])).toEqual([{ server: 'gm_gnomon_neurons', mod: 'gnomon.neurons', state: 'unset' }]);
  });

  it('failed comes from the NEWEST init only (Aegis N2) and a local-lane session.mcp row; never a detail', () => {
    const local = { kind: 'session.mcp', payload: { hsid: 'h', server: 'gm_gnomon_constellation', state: 'failed', error: `EPERM ${CANARY}` } };
    expect(modServerNotices(vOk, [init(['gm_gnomon_neurons']), local]).map((n) => [n.server, n.state])).toEqual([['gm_gnomon_constellation', 'failed'], ['gm_gnomon_neurons', 'failed']]);
    // a later init where it connected clears it
    expect(modServerNotices(vOk, [init(['gm_gnomon_neurons']), init([])])).toEqual([]);
    expect(JSON.stringify(noticeLines(modServerNotices(vOk, [init(['gm_gnomon_neurons']), local]), vOk))).not.toContain(CANARY);
    expect(modServerNotices(vOk, [{ kind: 'session.mcp', payload: { server: 'github', state: 'failed' } }])).toEqual([]);
  });

  it('Aegis I2: a failed server is named neutrally, short name, with Open Mods at its row; never a cause', () => {
    const ls = noticeLines(modServerNotices(vOk, [init(['gm_gnomon_neurons'])]), vOk);
    expect(ls).toEqual([{ state: 'failed', text: "neurons failed to start in this session · Gnomon can't see why from here ·", keys: [{ label: 'Open Mods', act: 'mods', mod: 'gnomon.neurons' }] }]);
  });

  it('Mika A2: a mod whose setup card waits gets its own line with Show the card, never the unset line', () => {
    const vp = modsViewOf(statusOf(mod('gnomon.neurons', [offer({})], { mcp: { ...mod('gnomon.neurons', [offer({})]).mcp, setupPending: 'card:S9' } })));
    expect(noticeLines(modServerNotices(vp, []), vp)).toEqual([{ state: 'pending', text: 'neurons waits on its card in the stack ·', keys: [{ label: 'Show the card', act: 'card', cardId: 'card:S9' }] }]);
  });

  it('mcpText says the server is not set up; short names never show a gm_ id', () => {
    expect(mcpText(v.installed[0]!)).toBe("gm_gnomon_neurons · isn't set up, so sessions don't get it");
    expect([shortName('gnomon.neurons'), shortName('gm_gnomon_paradigm-context')]).toEqual(['neurons', 'paradigm-context']);
  });
});

describe('Aegis N6: Review first args round-trip', () => {
  it('quoteArgs then splitArgs gives the same list', () => {
    for (const a of [['/x/main.js', 'mcp'], ['--dir', '/Users/me/My Vault', "it's"], ['say "hi"', 'plain'], []]) expect(splitArgs(quoteArgs(a))).toEqual(a);
  });
});

describe('#gui-mod-setup the session line is grouped (Mika A1)', () => {
  const init = { kind: 'turn.event', payload: { line: JSON.stringify({ type: 'system', subtype: 'init', mcp_servers: [] }) } };
  const ledger = mod('gnomon.ledger', [offer({ declId: 'local:/r:ledger', source: 'local', oneTap: false, preselected: false })]);
  it('all one press: one key that sets them all up', () => {
    const v = modsViewOf(statusOf(mod('gnomon.neurons', [offer({})])));
    expect(noticeLines(modServerNotices(v, [init]), v)[0]!.keys).toEqual([{ label: SETUP_COPY.key, act: 'setup', items: [{ name: 'gnomon.neurons', from: 'user::neurons' }] }]);
  });
  it('some one press: "Set up neurons" and a quiet "Review the rest in Mods" at the first other row', () => {
    const v = modsViewOf(statusOf(mod('gnomon.neurons', [offer({})]), ledger));
    const l = noticeLines(modServerNotices(v, [init]), v)[0]!;
    expect(l.text).toBe("neurons and ledger aren't set up, so this session doesn't have them ·");
    expect(l.keys).toEqual([{ label: 'Set up neurons', act: 'setup', items: [{ name: 'gnomon.neurons', from: 'user::neurons' }] }, { label: 'Review the rest in Mods', act: 'mods', mod: 'gnomon.ledger', quiet: true }]);
  });
  it('none one press: Open Mods', () => {
    const v = modsViewOf(statusOf(ledger));
    expect(noticeLines(modServerNotices(v, [init]), v)[0]!.keys).toEqual([{ label: 'Open Mods', act: 'mods', mod: 'gnomon.ledger' }]);
  });
});
