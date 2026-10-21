/**
 * #gui-mods-panel: the Mods panel renders from a status fixture (installed, available, pending cards, empty and
 * error states), every key is exactly one request.mod.* request, a failure surfaces as words, and the Install
 * Workshop key (founder dogfood 2026-10-21: "does nothing") always ends in a request or the panel.
 */
import { describe, expect, it } from 'vitest';
import { RpcError, type GnomonClient } from '../src/core/client.js';
import { workshopInstallKey } from '../src/core/mod-panels.js';
import { configRequest, configurable, folderPathError, installRequest, linkRequest, modsViewOf, pauseRequest, startRequest, uninstallRequest, workshopSource, type InstalledMod } from '../src/core/mods.js';
import type { MiniDoc, MiniEl } from '../src/core/render.js';
import type { StackCard } from '../src/core/store.js';
import { emptyUi, paintMods, requestMod, splitArgs } from '../src/ui/mods-panel.js';
import { installWorkshop } from '../src/ui/mod-panels-mount.js';
import { GUI_COMMANDS, BLOCK_SAFE_COMMANDS } from '../src/core/commands.js';

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

const H = (c: string): string => `sha256:${c.repeat(64)}`;
const STATUS = {
  mods: {
    modAbiId: 'mod-abi:v1',
    running: [{ name: 'gnomon.neurons' }],
    paused: [{ name: 'gnomon.constellation', why: 'user', cardId: null }],
    views: [],
    installed: [
      {
        name: 'gnomon.neurons', publisher: 'gnomon', version: '1.1.0', description: 'Your knowledge brain, offered when a session learns something.', tier: 'first-party', source: 'package', packageHash: H('9'), dev: false, state: 'running', pausedWhy: null, uninstallRequested: false,
        mcp: { server: 'gm_gnomon_neurons', overridden: false, configRequested: false, configurable: { command: true, args: true, env: ['NEURONS_VAULT', 'NEURONS_TOKEN'], secret: ['NEURONS_TOKEN'] }, command: '/usr/local/bin/neurons-mcp', args: ['--stdio'] },
        offers: [{ kind: 'capture', title: 'Save to Neurons' }],
        desk: { shown: 7, suppressed: 3, kept: 2, open: 2, notNow: 1, stopHere: 0 },
        update: null,
      },
      {
        name: 'gnomon.constellation', publisher: 'gnomon', version: '1.1.0', description: null, tier: 'first-party', source: 'package', packageHash: H('a'), dev: false, state: 'paused', pausedWhy: 'user', uninstallRequested: false,
        mcp: null, offers: [], desk: { shown: 0, suppressed: 0, kept: 0 }, update: null,
      },
      {
        name: 'gnomon.ledger', publisher: 'gnomon', version: '1.0.0', description: null, tier: 'first-party', source: 'package', packageHash: H('b'), dev: false, state: 'running', pausedWhy: null, uninstallRequested: false,
        mcp: null, offers: [], desk: { shown: 0, suppressed: 0, kept: 0 }, update: { version: '1.1.0', path: '/repo/packages/gnomon-mods/ledger', packageHash: H('c') },
      },
    ],
    available: [
      { name: 'gnomon.workshop', version: '1.1.0', description: 'The Workshop: needs-you caps per pending card.', path: '/repo/packages/gnomon-mods/workshop', packageHash: H('d'), tier: 'first-party' },
      { name: 'gnomon.paradigm-context', version: '1.1.0', description: null, path: '/repo/packages/gnomon-mods/paradigm-context', packageHash: H('e'), tier: 'first-party' },
    ],
    catalog: { root: '/repo/packages/gnomon-mods' },
  },
};
const card = (cardId: string, kind: string, detail: Record<string, unknown>): StackCard => ({ cardId, kind, repo: null, hsid: null, card: { cardId, kind, detail }, flags: [], arrivedSeq: 1 });
const CARDS = [card('card:P1', 'install', { name: 'gnomon.paradigm-context' }), card('card:L1', 'install', { name: 'local.my-lens' }), card('card:U1', 'grant', { action: 'mod.uninstall', name: 'gnomon.constellation' })];

function painted(status: unknown, cards: StackCard[] = [], ui = emptyUi()): FEl {
  const body = new FEl('div');
  paintMods(fdoc, body, modsViewOf(status, cards), ui);
  return body;
}
const section = (b: FEl, id: string): FEl | undefined => b.all().find((e) => e.attrs.get('data-section') === id);
const row = (b: FEl, name: string): FEl => b.all().find((e) => e.attrs.get('data-mod') === name)!;
const keys = (el: FEl): string[] => el.all().filter((e) => e.tag === 'button').map((e) => e.attrs.get('data-mod-act')!);

describe('#gui-mods-panel renders from status', () => {
  it('installed mods: name, version, tier, state, pin prefix, MCP server, offers and Desk counts', () => {
    const b = painted(STATUS, CARDS);
    expect(section(b, 'installed')!.text).toContain('Installed (3)');
    const n = row(b, 'gnomon.neurons');
    expect(n.text).toContain('gnomon.neurons 1.1.0 first-party');
    expect(n.text).toContain('running');
    expect(n.text).toContain(`pin ${H('9').slice(0, 19)}`);
    expect(n.text).toContain('MCP: gm_gnomon_neurons · passed to new sessions');
    expect(n.text).toContain('offers: Save to Neurons (capture)');
    expect(n.text).toContain('Desk: shown 7 · suppressed 3 · kept 2');
    expect(keys(n)).toEqual(['pause', 'configure', 'uninstall']);
    const c = row(b, 'gnomon.constellation');
    expect(c.text).toContain('paused');
    expect(c.text).toContain('MCP: no MCP server');
    // a pending uninstall card: shown in context with its decide link, and no second Uninstall key
    expect(c.text).toContain('uninstall card waiting');
    expect(keys(c)).toEqual(['decide', 'start']);
    expect(c.all().find((e) => e.attrs.get('data-mod-act') === 'decide')!.attrs.get('data-card-id')).toBe('card:U1');
    // a shipped tree that is not the pin: Update
    const l = row(b, 'gnomon.ledger');
    expect(keys(l)).toEqual(['pause', 'update', 'uninstall']);
    expect(l.all().find((e) => e.attrs.get('data-mod-act') === 'update')!.attrs.get('data-path')).toBe('/repo/packages/gnomon-mods/ledger');
  });

  it('available mods: description and Install; a pending install card replaces the key with its decide link', () => {
    const b = painted(STATUS, CARDS);
    const w = row(b, 'gnomon.workshop');
    expect(w.text).toContain('The Workshop: needs-you caps');
    expect(keys(w)).toEqual(['install']);
    expect(w.all().find((e) => e.attrs.get('data-mod-act') === 'install')!.attrs.get('data-path')).toBe('/repo/packages/gnomon-mods/workshop');
    const p = row(b, 'gnomon.paradigm-context');
    expect(p.text).toContain('install card waiting');
    expect(keys(p)).toEqual(['decide']);
    // a pending card for a mod in no list (a linked folder) is shown under "Waiting on you"
    expect(section(b, 'pending')!.text).toContain('local.my-lens');
    // an install card for an installed mod is its Update card
    const v = modsViewOf(STATUS, [card('card:R1', 'install', { name: 'gnomon.ledger' })]);
    expect(v.installed.find((m) => m.name === 'gnomon.ledger')!.pending).toEqual([{ cardId: 'card:R1', what: 'update' }]);
  });

  it('Add from folder: a path field and Add key; git is not offered', () => {
    const b = painted(STATUS);
    const add = section(b, 'add')!;
    expect(add.all().some((e) => e.tag === 'input' && e.attrs.get('name') === 'folder')).toBe(true);
    expect(keys(add)).toEqual(['link']);
    expect(add.text).toContain('Installing from a git URL lands later');
  });

  it('empty and error states are words, never a blank sheet', () => {
    const none = painted({ mods: { installed: [], available: [], catalog: { root: '/r' } } });
    expect(section(none, 'installed')!.text).toContain('No mod is installed yet');
    expect(section(none, 'available')!.text).toContain('Every first-party mod shipped with this Gnomon is installed');
    expect(section(painted({ mods: { installed: [], available: [], catalog: { root: null } } }), 'available')!.text).toContain('found no first-party mods');
    const old = painted({ mods: { running: [], paused: [], views: [] } });
    expect(section(old, 'unsupported')!.text).toContain('gnomon mod list');
    expect(modsViewOf(null).unsupported).toBe(true);
    const err = painted({ mods: { adminError: 'EACCES grants.jsonl' } });
    expect(section(err, 'error')!.text).toContain('could not read its mods: EACCES grants.jsonl');
    expect(section(err, 'error')!.attrs.get('role')).toBe('alert');
  });

  it('busy keys and results are shown in the row (a failure as an alert)', () => {
    const ui = emptyUi() as ReturnType<typeof emptyUi> & { busy: Set<string>; results: Map<string, { text: string; fail: boolean }> };
    ui.busy.add('pause:gnomon.neurons');
    ui.results.set('gnomon.workshop', { text: 'FORBIDDEN manifest-collision: …', fail: true });
    const b = painted(STATUS, [], ui);
    const pause = row(b, 'gnomon.neurons').all().find((e) => e.attrs.get('data-mod-act') === 'pause')!;
    expect(pause.text).toBe('Pause…');
    expect(pause.attrs.get('aria-busy')).toBe('true');
    expect(pause.disabled).toBe(true);
    const r = row(b, 'gnomon.workshop').all().find((e) => e.className.includes('mod-result'))!;
    expect(r.className).toContain('fail');
    expect(r.attrs.get('role')).toBe('alert');
  });

  it('a malformed status entry is dropped, never painted', () => {
    const v = modsViewOf({ mods: { installed: [{ name: 'Bad Name' }, { name: 'acme.ok', packageHash: 'nope', state: 'weird' }], available: [{ name: 'gnomon.x' }] } });
    expect(v.installed.map((m) => [m.name, m.pin, m.state])).toEqual([['acme.ok', '?', 'error']]);
    expect(v.available).toEqual([]); // no path: nothing to install from
  });
});

describe('#gui-mods-panel actions: one request each', () => {
  it('Install / Update, Add from folder, Pause, Start, Uninstall', () => {
    expect(installRequest('/repo/packages/gnomon-mods/workshop')).toEqual({ kind: 'request.mod.install', payload: { source: 'folder', path: '/repo/packages/gnomon-mods/workshop' } });
    expect(linkRequest('  /Users/me/my-lens ')).toEqual({ kind: 'request.mod.link', payload: { path: '/Users/me/my-lens' } });
    expect(pauseRequest('gnomon.neurons')).toEqual({ kind: 'request.mod.pause', payload: { name: 'gnomon.neurons' } });
    expect(startRequest('gnomon.neurons')).toEqual({ kind: 'request.mod.start', payload: { name: 'gnomon.neurons' } });
    expect(uninstallRequest('gnomon.neurons')).toEqual({ kind: 'request.mod.uninstall', payload: { name: 'gnomon.neurons' } });
  });

  it('Configure: only the fields the manifest permits; secrets refused; at least one field', () => {
    const m = modsViewOf(STATUS).installed.find((x) => x.name === 'gnomon.neurons') as InstalledMod;
    expect(configurable(m)).toBe(true);
    expect(configRequest(m.name, m.mcp!, { command: '/opt/homebrew/bin/neurons-mcp', args: '--stdio\n--vault x', env: 'NEURONS_VAULT=/v' })).toEqual({ request: { kind: 'request.mod.config', payload: { name: 'gnomon.neurons', command: '/opt/homebrew/bin/neurons-mcp', args: ['--stdio', '--vault x'], env: { NEURONS_VAULT: '/v' } } } });
    expect(configRequest(m.name, m.mcp!, { command: 'neurons-mcp', args: '', env: '' })).toEqual({ error: 'the command must be an absolute path' });
    expect(configRequest(m.name, m.mcp!, { command: '', args: '', env: 'NEURONS_TOKEN=s' })).toMatchObject({ error: expect.stringContaining('holds a secret') });
    expect(configRequest(m.name, m.mcp!, { command: '', args: '', env: 'PATH=/x' })).toMatchObject({ error: expect.stringContaining('not an env name') });
    expect(configRequest(m.name, m.mcp!, { command: '', args: '', env: '' })).toEqual({ error: 'change at least one field' });
    expect(configRequest(m.name, { ...m.mcp!, configurable: { command: false, args: false, env: [], secret: [] } }, { command: '/x', args: '', env: '' })).toMatchObject({ error: expect.stringContaining('does not let you change its command') });
    expect(splitArgs(`--stdio --vault "/my vault" 'a b'`)).toEqual(['--stdio', '--vault', '/my vault', 'a b']);
  });

  it('the folder path is checked before it is sent', () => {
    expect(folderPathError('/Users/me/my-lens')).toBeNull();
    expect(folderPathError('C:\\mods\\lens')).toBeNull();
    expect(folderPathError('')).toContain('gnomon-manifest.json');
    expect(folderPathError('~/my-lens')).toContain('full path');
    expect(folderPathError('https://github.com/a/b')).toContain('git lands later');
    expect(folderPathError('\\\\server\\share')).toContain('UNC');
    expect(folderPathError('/a\nb')).toContain('control');
    expect(folderPathError(`/${'a'.repeat(1100)}`)).toContain('longer');
  });

  it('requestMod sends log.append{kind, payload} and returns the kernel note; a refusal or a lost connection is an error in words', async () => {
    const calls: Array<[string, unknown]> = [];
    const ok = { call: async (m: string, p: unknown) => (calls.push([m, p]), { state: 'staged', cardId: 'card:X', note: 'the install card is in the stack: decide it there (Touch ID, root key)' }) } as unknown as GnomonClient;
    expect(await requestMod(ok, installRequest('/w'))).toEqual({ text: 'the install card is in the stack: decide it there (Touch ID, root key)', fail: false });
    expect(calls).toEqual([['log.append', { kind: 'request.mod.install', payload: { source: 'folder', path: '/w' } }]]);
    const refused = { call: async () => Promise.reject(new RpcError({ code: 'FORBIDDEN', reason: 'manifest-publisher', message: 'publisher gnomon is first-party only', next: ['gnomon mod install <path>'], data: null })) } as unknown as GnomonClient;
    expect(await requestMod(refused, linkRequest('/w'))).toEqual({ text: 'FORBIDDEN manifest-publisher: publisher gnomon is first-party only · next: gnomon mod install <path>', fail: true });
    const broken = { call: async () => Promise.reject(new Error('socket closed')) } as unknown as GnomonClient;
    expect(await requestMod(broken, pauseRequest('gnomon.neurons'))).toMatchObject({ fail: true, text: expect.stringContaining('socket closed') });
    expect(await requestMod(null, pauseRequest('gnomon.neurons'))).toEqual({ text: 'not connected: nothing was sent', fail: true });
  });

  it('the palette has "Mods…", and a mod block may not open it', () => {
    expect(GUI_COMMANDS.find((c) => c.id === 'mods.open')?.title).toContain('Mods');
    expect(BLOCK_SAFE_COMMANDS.has('mods.open')).toBe(false);
  });
});

describe('Install Workshop regression (founder dogfood 2026-10-21: the key did nothing)', () => {
  const fakeKey = () => {
    const a = new Map<string, string>();
    return { disabled: false, textContent: 'Install Workshop', setAttribute: (k: string, v: string) => void a.set(k, v), removeAttribute: (k: string) => void a.delete(k), getAttribute: (k: string) => a.get(k) ?? null, attrs: a };
  };
  const fakeSaid = () => {
    const a = new Map<string, string>();
    return { hidden: true, className: '', textContent: '', setAttribute: (k: string, v: string) => void a.set(k, v), attrs: a };
  };

  it('with a shipped Workshop the key installs: one request.mod.install, the key busy, then the result in words', async () => {
    const src = workshopSource(STATUS);
    expect(src).toBe('/repo/packages/gnomon-mods/workshop');
    expect(workshopInstallKey(src).action).toBe('install');
    const calls: unknown[] = [];
    let seenBusy = false;
    const b = fakeKey();
    const client = { call: async (_m: string, p: unknown) => ((seenBusy = b.disabled && b.attrs.get('aria-busy') === 'true'), calls.push(p), { state: 'staged', note: 'the install card is in the stack: decide it there (Touch ID, root key)' }) } as unknown as GnomonClient;
    const said = fakeSaid();
    let refreshed = 0;
    await installWorkshop(b as unknown as HTMLButtonElement, said as unknown as HTMLElement, client, src!, { openMods: () => undefined, refreshStatus: async () => void refreshed++ });
    expect(calls).toEqual([{ kind: 'request.mod.install', payload: { source: 'folder', path: '/repo/packages/gnomon-mods/workshop' } }]);
    expect(seenBusy).toBe(true);
    expect(b.disabled).toBe(false);
    expect(said.hidden).toBe(false);
    expect(said.textContent).toContain('install card is in the stack');
    expect(refreshed).toBe(1);
  });

  it('a refused install surfaces the refusal (never a silent key)', async () => {
    const client = { call: async () => Promise.reject(new RpcError({ code: 'NOT_FOUND', reason: 'no-folder', message: 'no folder at /repo/packages/gnomon-mods/workshop', next: [], data: null })) } as unknown as GnomonClient;
    const said = fakeSaid();
    await installWorkshop(fakeKey() as unknown as HTMLButtonElement, said as unknown as HTMLElement, client, '/repo/packages/gnomon-mods/workshop', undefined);
    expect(said.hidden).toBe(false);
    expect(said.className).toContain('fail');
    expect(said.attrs.get('role')).toBe('alert');
    expect(said.textContent).toBe('NOT_FOUND no-folder: no folder at /repo/packages/gnomon-mods/workshop');
  });

  it('with no shipped Workshop (an older kernel, no catalog) the key opens the Mods panel instead of doing nothing', () => {
    expect(workshopSource({ mods: { running: [], paused: [], views: [] } })).toBeNull();
    expect(workshopInstallKey(null)).toMatchObject({ action: 'open-mods', title: expect.stringContaining('open Mods') });
  });
});
