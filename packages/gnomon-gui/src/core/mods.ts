/**
 * @symbol #gui-mods-panel
 *
 * #gui-mods-panel, the model (PURE). The Mods panel answers the founder's "which mods are on, how do I add others"
 * (dogfood 2026-10-21) with the same verbs as `gnomon mod`, as kernel requests the GUI only ASKS for:
 *
 *   - Installed: from status.mods.installed (#mods-admin): name, publisher, version, tier, run state, pinned
 *     packageHash prefix, its MCP server, its offers, the Desk counts (`gnomon desk stats`' fold) and the pending
 *     cards that name it (the stack's install / uninstall / mod.mcp.config cards; an install card for an installed
 *     mod is its Update). Keys: Pause / Start, Configure (only the fields its manifest's provides.mcp[].config
 *     lets a user set), Uninstall, Update (a shipped first-party tree that is not the pin).
 *   - Available: status.mods.available, the first-party mods shipped beside the kernel and not installed: Install.
 *   - Add from folder: an absolute folder path (`gnomon mod link`), checked here before it is sent and again by the
 *     kernel. A git URL is slice S4 and is not offered.
 *   Every key is ONE request (log.append{kind:'request.mod.*', payload}); the kernel stages and raises the normal
 *   card, which the human decides in the stack (Touch ID, root key). The GUI never signs and never decides here.
 *
 * #gui-mod-setup (8.2 fixes item 1, #mcp-setup): a mod whose effective launch is not absolute is `needs-config` and its
 * server never reaches a session. status.mods.installed[].mcp.setup lists the Claude Code servers it can be set up
 * from (names only: the GUI never holds a value). One press sends request.mod.setup{items:[{name, from}]} with the
 * preselected candidate, and the card in the stack is the review; "Review first" opens the form filled from the row.
 * One press only for a candidate the kernel marked oneTap (first-party mod; user source, or plugin by command and
 * name); a local candidate is never preselected; a project one is a disabled row. The banner sends every one-press
 * mod on one grouped card. modServerNotices derives the session's kernel-voiced line from status and log rows: GUI
 * constant words and the server name only, never a row's detail (a failed row may carry stderr).
 */
import { MOD_INSTALL_LIMITS } from '@a-company/gnomon-contracts';
import type { StackCard } from './store.js';

export type ModRequestKind = 'request.mod.install' | 'request.mod.link' | 'request.mod.pause' | 'request.mod.start' | 'request.mod.uninstall' | 'request.mod.config' | 'request.mod.setup';
export interface ModRequest {
  kind: ModRequestKind;
  payload: Record<string, unknown>;
}

export interface ModDesk {
  shown: number;
  suppressed: number;
  kept: number;
}

export interface ModPending {
  cardId: string;
  /** what the card decides, in the panel's words */
  what: 'install' | 'update' | 'uninstall' | 'configure';
}

/** One Claude Code server a needs-config mod can be set up from (status: names, never values). */
export interface SetupOffer {
  declId: string;
  name: string;
  source: 'user' | 'plugin' | 'local' | 'project';
  plugin: { id: string; version: string | null } | null;
  match: 'name' | 'command' | 'both';
  command: string | null;
  realCommand: string | null;
  args: string[];
  envNames: string[];
  envDropped: string[];
  envSecret: string[];
  /** why it cannot be copied (the kernel's words), or null */
  problem: string | null;
  scopeNote: string | null;
  oneTap: boolean;
  preselected: boolean;
}

export interface ModMcp {
  server: string;
  overridden: boolean;
  configRequested: boolean;
  configurable: { command: boolean; args: boolean; env: string[]; secret: string[] };
  /** the EFFECTIVE launch (the kernel's override when one is in force), args as the kernel shows them */
  command: string;
  args: string[];
  launch: 'ok' | 'needs-config';
  setup: SetupOffer[];
  setupPending: string | null;
}

export interface InstalledMod {
  name: string;
  publisher: string;
  version: string | null;
  description: string | null;
  tier: string;
  source: string;
  /** the first 12 hex of the pinned packageHash */
  pin: string;
  dev: boolean;
  state: 'running' | 'paused' | 'stopped' | 'error';
  pausedWhy: string | null;
  /** kernel-composed: why a stopped mod is not running (for example, it needs an update for this Gnomon) */
  note: string | null;
  uninstallRequested: boolean;
  mcp: ModMcp | null;
  offers: Array<{ kind: string; title: string }>;
  desk: ModDesk;
  update: { version: string; path: string } | null;
  pending: ModPending[];
}

export interface AvailableMod {
  name: string;
  version: string;
  description: string | null;
  path: string;
  tier: string;
  pending: ModPending[];
}

export interface ModsView {
  /** status carries no #mods-admin view (an older kernel, or not the human class) */
  unsupported: boolean;
  /** the kernel's own read of the mods failed (status.mods.adminError) */
  error: string | null;
  installed: InstalledMod[];
  available: AvailableMod[];
  /** pending install cards naming no listed mod (a folder staged by `gnomon mod link`, say) */
  otherPending: Array<ModPending & { name: string }>;
  catalogRoot: string | null;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const strs = (v: unknown, max = 64): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : []);
const MOD_ID = /^[a-z0-9][a-z0-9-]{0,30}\.[a-z0-9][a-z0-9-]{0,62}$/;
const STATES = new Set(['running', 'paused', 'stopped', 'error']);

/** The packageHash as the panel shows it: `sha256:` + 12 hex (the full hash is the key's title). */
export function pinPrefix(h: unknown): string {
  return typeof h === 'string' && /^sha256:[0-9a-f]{64}$/.test(h) ? h.slice(0, 19) : '?';
}

/** Pending stack cards that name a mod: mod name → cards (install, uninstall, mod.mcp.config). */
export function modCards(cards: Iterable<StackCard>): Map<string, Array<{ cardId: string; kind: 'install' | 'uninstall' | 'configure' }>> {
  const out = new Map<string, Array<{ cardId: string; kind: 'install' | 'uninstall' | 'configure' }>>();
  for (const c of cards) {
    const d = obj(c.card.detail);
    // #gui-mod-setup: one setup card names every mod on it (detail.mods[]); each row says a card is waiting
    if (d?.action === 'mod.mcp.setup' && Array.isArray(d.mods)) {
      for (const m of d.mods.slice(0, 16)) {
        const n = str(obj(m)?.name);
        if (!n || !MOD_ID.test(n)) continue;
        const l = out.get(n) ?? [];
        l.push({ cardId: c.cardId, kind: 'configure' });
        out.set(n, l);
      }
      continue;
    }
    const name = str(d?.name);
    if (!name || !MOD_ID.test(name)) continue;
    const kind = c.kind === 'install' ? 'install' : d?.action === 'mod.uninstall' ? 'uninstall' : d?.action === 'mod.mcp.config' ? 'configure' : null;
    if (!kind) continue;
    const l = out.get(name) ?? [];
    l.push({ cardId: c.cardId, kind });
    out.set(name, l);
  }
  return out;
}

/** The panel's view from status and the pending stack cards. */
export function modsViewOf(status: unknown, cards: Iterable<StackCard> = []): ModsView {
  const mods = obj(obj(status)?.mods);
  const pending = modCards(cards);
  const empty: ModsView = { unsupported: true, error: null, installed: [], available: [], otherPending: [], catalogRoot: null };
  if (!mods) return empty;
  const error = str(mods.adminError);
  if (!Array.isArray(mods.installed) && !Array.isArray(mods.available)) return { ...empty, unsupported: error === null, error };
  const used = new Set<string>();
  const installed: InstalledMod[] = [];
  for (const raw of Array.isArray(mods.installed) ? mods.installed.slice(0, 128) : []) {
    const m = obj(raw);
    const name = str(m?.name);
    if (!m || !name || !MOD_ID.test(name)) continue;
    used.add(name);
    const mcp = obj(m.mcp);
    const cfg = obj(mcp?.configurable);
    const desk = obj(m.desk);
    const upd = obj(m.update);
    const state = str(m.state);
    installed.push({
      name,
      publisher: str(m.publisher) ?? name.split('.')[0]!,
      version: str(m.version),
      description: str(m.description),
      tier: str(m.tier) ?? 'local',
      source: str(m.source) ?? 'package',
      pin: pinPrefix(m.packageHash),
      dev: m.dev === true,
      state: state && STATES.has(state) ? (state as InstalledMod['state']) : 'error',
      pausedWhy: str(m.pausedWhy),
      note: noteOf(m.note),
      uninstallRequested: m.uninstallRequested === true,
      mcp: mcp && str(mcp.server) ? { server: str(mcp.server)!, overridden: mcp.overridden === true, configRequested: mcp.configRequested === true, configurable: { command: cfg?.command === true, args: cfg?.args === true, env: strs(cfg?.env), secret: strs(cfg?.secret) }, command: str(mcp.command) ?? '', args: strs(mcp.args), launch: mcp.launch === 'needs-config' ? 'needs-config' : 'ok', setup: setupOffersOf(mcp.setup), setupPending: str(mcp.setupPending) } : null,
      offers: (Array.isArray(m.offers) ? m.offers : []).map(obj).filter((o): o is Record<string, unknown> => !!o).map((o) => ({ kind: str(o.kind) ?? '', title: str(o.title) ?? '' })).slice(0, 16),
      desk: { shown: num(desk?.shown), suppressed: num(desk?.suppressed), kept: num(desk?.kept) },
      update: upd && str(upd.path) && str(upd.version) ? { version: str(upd.version)!, path: str(upd.path)! } : null,
      pending: (pending.get(name) ?? []).map((c) => ({ cardId: c.cardId, what: c.kind === 'install' ? 'update' : c.kind })),
    });
  }
  const available: AvailableMod[] = [];
  for (const raw of Array.isArray(mods.available) ? mods.available.slice(0, 64) : []) {
    const a = obj(raw);
    const name = str(a?.name);
    if (!a || !name || !MOD_ID.test(name) || used.has(name) || !str(a.path)) continue;
    used.add(name);
    available.push({ name, version: str(a.version) ?? '?', description: str(a.description), path: str(a.path)!, tier: str(a.tier) ?? 'local', pending: (pending.get(name) ?? []).filter((c) => c.kind === 'install').map((c) => ({ cardId: c.cardId, what: 'install' as const })) });
  }
  const otherPending: ModsView['otherPending'] = [];
  for (const [name, cs] of pending) if (!used.has(name)) for (const c of cs) if (c.kind === 'install') otherPending.push({ name, cardId: c.cardId, what: 'install' });
  return { unsupported: false, error, installed, available, otherPending, catalogRoot: str(obj(mods.catalog)?.root) };
}

const SOURCES = new Set(['user', 'plugin', 'local', 'project']);
const MATCHES = new Set(['name', 'command', 'both']);
function setupOffersOf(v: unknown): SetupOffer[] {
  const out: SetupOffer[] = [];
  for (const raw of Array.isArray(v) ? v.slice(0, 16) : []) {
    const o = obj(raw);
    const declId = str(o?.declId);
    const source = str(o?.source);
    if (!o || !declId || !source || !SOURCES.has(source)) continue;
    const pl = obj(o.plugin);
    out.push({
      declId,
      name: str(o.name) ?? '?',
      source: source as SetupOffer['source'],
      plugin: pl && str(pl.id) ? { id: str(pl.id)!, version: str(pl.version) } : null,
      match: MATCHES.has(str(o.match) ?? '') ? (o.match as SetupOffer['match']) : 'name',
      command: str(o.command),
      realCommand: str(o.realCommand),
      args: strs(o.args),
      envNames: strs(o.envNames),
      envDropped: strs(o.envDropped),
      envSecret: strs(o.envSecret),
      problem: str(o.problem),
      scopeNote: str(o.scopeNote),
      // a project row is never copied, whatever a status says (Aegis condition 3)
      oneTap: o.oneTap === true && source !== 'project' && source !== 'local' && !str(o.problem),
      preselected: o.preselected === true && source !== 'local' && source !== 'project' && !str(o.problem),
    });
  }
  return out;
}

/* ── #gui-mod-setup ─────────────────────────────────────────────────────── */

export const SETUP_COPY = Object.freeze({
  key: 'Set up from your Claude Code config',
  review: 'Review first',
  reviewOnly: 'Set up from your Claude Code config…',
  bannerKey: 'Set them up',
  bannerKeyOne: 'Set it up',
  copied: 'copied from your ~/.claude.json, value not shown',
  send: 'Set up',
  failedKey: 'Review its setup',
});

/** The candidate one press sends (the kernel's preselected, one-press candidate), or null. */
export function oneTapOffer(m: Pick<InstalledMod, 'mcp' | 'pending'>): SetupOffer | null {
  if (!m.mcp || m.mcp.launch !== 'needs-config' || m.mcp.setupPending || m.pending.length) return null;
  return m.mcp.setup.find((o) => o.preselected && o.oneTap) ?? null;
}

/** The candidates "Review first" may pre-fill (never a project row, never a disqualified one). */
export function reviewOffers(m: Pick<InstalledMod, 'mcp'>): SetupOffer[] {
  return (m.mcp?.setup ?? []).filter((o) => o.source !== 'project' && !o.problem);
}

/** One request for every item (one grouped card). */
export function setupRequest(items: ReadonlyArray<{ name: string; from: string; args?: string[]; env?: Record<string, string> }>): ModRequest {
  return { kind: 'request.mod.setup', payload: { items: items.map((i) => ({ name: i.name, from: i.from, ...(i.args ? { args: [...i.args] } : {}), ...(i.env && Object.keys(i.env).length ? { env: { ...i.env } } : {}) })) } };
}

/** The Mods banner: how many mod servers wait for setup, and the one-press items. */
export function setupBanner(v: Pick<ModsView, 'installed'>): { waiting: string[]; oneTap: Array<{ name: string; from: string }> } | null {
  const waiting = v.installed.filter((m) => m.mcp?.launch === 'needs-config' && m.state !== 'paused' && !m.mcp.setupPending && !m.pending.length);
  if (!waiting.length) return null;
  const oneTap = waiting.map((m) => ({ m, o: oneTapOffer(m) })).filter((x) => x.o).slice(0, 8).map((x) => ({ name: x.m.name, from: x.o!.declId }));
  return { waiting: waiting.map((m) => m.name), oneTap };
}

export function bannerText(b: { waiting: string[]; oneTap: unknown[] }): string {
  const n = b.waiting.length;
  const k = b.oneTap.length;
  const lead = n === 1 ? "1 mod server isn't set up." : `${n} mod servers aren't set up.`;
  if (!k) return `${lead} Set ${n === 1 ? 'it' : 'them'} up from ${n === 1 ? 'its row' : 'their rows'} below.`;
  return `${lead} ${k === n ? (n === 1 ? 'It' : n === 2 ? 'Both' : 'All') : `${k} of ${n}`} can be set up from your Claude Code config.`;
}

/** The plain lines "Review first" shows for one candidate (names only). */
export function offerLines(o: SetupOffer): string[] {
  const src = o.source === 'user' ? 'your ~/.claude.json (every project)' : o.source === 'plugin' ? `the Claude Code plugin ${o.plugin?.id ?? '?'}${o.plugin?.version ? ` ${o.plugin.version}` : ''} (third-party code)` : o.source === 'local' ? 'your ~/.claude.json, for one folder' : "a repo's .mcp.json";
  return [
    `from ${src}, as ${o.name}`,
    `command ${o.command ?? '?'}${o.realCommand && o.realCommand !== o.command ? ` → ${o.realCommand}` : ''}`,
    `args ${o.args.join(' ') || '(none)'}`,
    ...o.envNames.map((n) => `${n} ${SETUP_COPY.copied}`),
    ...(o.envDropped.length ? [`not copied, this mod does not take them: ${o.envDropped.join(', ')}`] : []),
    ...(o.envSecret.length ? [`not copied, marked secret (Gnomon cannot keep a mod secret yet): ${o.envSecret.join(', ')}`] : []),
    ...(o.scopeNote ? [o.scopeNote] : []),
  ];
}

/** The session's kernel-voiced line for one mod server (GUI constant words and the server name only). */
export interface ModServerNotice {
  server: string;
  mod: string | null;
  state: 'unset' | 'failed';
  text: string;
  key: string;
}
const GM = /^g[mx]_[A-Za-z0-9_.-]{1,80}$/;

/**
 * The mod servers this session does not have: a needs-config mod (status) is `unset`; a gm_ server a session listed
 * as failed (Claude's init `mcp_servers[].status`, or a local-lane session.mcp{state:'failed'}) is `failed`. Only the
 * server NAME is read from a row: never its error or detail (Aegis condition 12).
 */
export function modServerNotices(v: Pick<ModsView, 'installed'>, rows: Iterable<{ kind: string; payload?: unknown }>): ModServerNotice[] {
  const failed = new Set<string>();
  for (const r of rows) {
    const p = obj(r.payload);
    if (r.kind === 'session.mcp' && p?.state === 'failed' && typeof p.server === 'string' && GM.test(p.server)) failed.add(p.server);
    if (r.kind === 'turn.event' && typeof p?.line === 'string' && p.line.length < 262144 && p.line.includes('"init"')) {
      let m: unknown;
      try {
        m = JSON.parse(p.line);
      } catch {
        continue;
      }
      const o = obj(m);
      if (o?.type !== 'system' || o.subtype !== 'init' || !Array.isArray(o.mcp_servers)) continue;
      for (const s of o.mcp_servers.slice(0, 64)) {
        const x = obj(s);
        if (typeof x?.name === 'string' && GM.test(x.name) && x.status === 'failed') failed.add(x.name);
      }
    }
  }
  const out: ModServerNotice[] = [];
  const byServer = new Map(v.installed.filter((m) => m.mcp).map((m) => [m.mcp!.server, m]));
  for (const m of v.installed) {
    if (m.mcp?.launch !== 'needs-config' || m.state === 'paused' || failed.has(m.mcp.server)) continue;
    out.push({ server: m.mcp.server, mod: m.name, state: 'unset', text: `${m.mcp.server} isn't set up, so this session doesn't have it`, key: SETUP_COPY.key });
  }
  for (const server of [...failed].sort()) out.push({ server, mod: byServer.get(server)?.name ?? null, state: 'failed', text: `${server} failed to start`, key: SETUP_COPY.failedKey });
  return out;
}

/** The names as one phrase: "a", "a and b", "a, b and c". */
const listed = (xs: readonly string[]): string => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/**
 * The session's line(s), grouped (the design's ONE kernel-voiced line per kind): every server that isn't set up on one
 * line whose key sends every one-press mod on one card (none: it opens Mods), every failed server on one line whose key
 * opens Mods. GUI words and server names only.
 */
export function noticeLines(ns: readonly ModServerNotice[], v: Pick<ModsView, 'installed'>): Array<{ state: 'unset' | 'failed'; text: string; key: string; items: Array<{ name: string; from: string }> }> {
  const out: Array<{ state: 'unset' | 'failed'; text: string; key: string; items: Array<{ name: string; from: string }> }> = [];
  const unset = ns.filter((n) => n.state === 'unset');
  const failed = ns.filter((n) => n.state === 'failed');
  if (unset.length) {
    const items = unset.flatMap((n) => {
      const m = v.installed.find((x) => x.name === n.mod);
      const o = m ? oneTapOffer(m) : null;
      return m && o ? [{ name: m.name, from: o.declId }] : [];
    }).slice(0, 8);
    out.push({ state: 'unset', text: unset.length === 1 ? unset[0]!.text : `${listed(unset.map((n) => n.server))} aren't set up, so this session doesn't have them`, key: SETUP_COPY.key, items });
  }
  if (failed.length) out.push({ state: 'failed', text: `${listed(failed.map((n) => n.server))} failed to start`, key: SETUP_COPY.failedKey, items: [] });
  return out;
}

/** An absolute folder path the kernel will accept (POSIX `/…`, Windows `X:\…` / `X:/…`); the error, else null. */
export function folderPathError(raw: string): string | null {
  const s = raw.trim();
  if (!s) return 'type the folder that holds the mod (it has a gnomon-manifest.json)';
  if (s.length > MOD_INSTALL_LIMITS.path) return `the path is longer than ${MOD_INSTALL_LIMITS.path} characters`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return 'a URL is not a folder: installing from git lands later; clone it and give the folder';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(s)) return 'the path holds a control or line-separator character';
  if (s.startsWith('\\\\') || s.startsWith('//')) return 'a network (UNC) path is not accepted: use a local folder';
  if (!(s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s))) return 'give the full path from the root (it starts with / or a drive letter); ~ is not expanded';
  return null;
}

export const installRequest = (path: string): ModRequest => ({ kind: 'request.mod.install', payload: { source: 'folder', path } });
export const linkRequest = (path: string): ModRequest => ({ kind: 'request.mod.link', payload: { path: path.trim() } });
export const pauseRequest = (name: string): ModRequest => ({ kind: 'request.mod.pause', payload: { name } });
export const startRequest = (name: string): ModRequest => ({ kind: 'request.mod.start', payload: { name } });
export const uninstallRequest = (name: string): ModRequest => ({ kind: 'request.mod.uninstall', payload: { name } });

export interface ConfigForm {
  command: string;
  /** one argument per line */
  args: string;
  /** one NAME=value per line */
  env: string;
}

/** The Configure form → the request.mod.config request, or the first error. Only the fields the manifest permits. */
export function configRequest(name: string, mcp: ModMcp, f: ConfigForm): { request: ModRequest } | { error: string } {
  const payload: Record<string, unknown> = { name };
  const command = f.command.trim();
  if (command) {
    if (!mcp.configurable.command) return { error: `${name} does not let you change its command` };
    if (!(command.startsWith('/') || /^[A-Za-z]:[\\/]/.test(command)) || command.startsWith('//')) return { error: 'the command must be an absolute path' };
    payload.command = command;
  }
  const args = f.args.split('\n').map((a) => a.trim()).filter((a) => a.length > 0);
  if (args.length) {
    if (!mcp.configurable.args) return { error: `${name} does not let you change its arguments` };
    payload.args = args;
  }
  const env: Record<string, string> = {};
  for (const line of f.env.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)) {
    const eq = line.indexOf('=');
    if (eq <= 0) return { error: `env takes NAME=value lines (${line.slice(0, 40)})` };
    const k = line.slice(0, eq);
    if (!mcp.configurable.env.includes(k)) return { error: `${k} is not an env name ${name} lets you set${mcp.configurable.env.length ? ` (it allows ${mcp.configurable.env.join(', ')})` : ''}` };
    if (mcp.configurable.secret.includes(k)) return { error: `${k} holds a secret: it cannot be set here until Gnomon has a secret store` };
    env[k] = line.slice(eq + 1);
  }
  if (Object.keys(env).length) payload.env = env;
  if (Object.keys(payload).length === 1) return { error: 'change at least one field' };
  return { request: { kind: 'request.mod.config', payload } };
}

/** Whether a mod lets the user configure anything at all (the Configure key shows only then). */
export function configurable(m: Pick<InstalledMod, 'mcp'>): boolean {
  const c = m.mcp?.configurable;
  return !!c && (c.command || c.args || c.env.some((e) => !c.secret.includes(e)));
}

/** A kernel-composed note: plain printable ASCII words, at most 80 characters, else dropped. */
function noteOf(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ,.:'()-]{0,79}$/.test(v) ? v : null;
}

/** The state line of an installed mod. */
export function stateText(m: Pick<InstalledMod, 'state' | 'pausedWhy' | 'uninstallRequested'> & { note?: string | null }): string {
  if (m.uninstallRequested) return 'uninstall requested';
  // the kernel's own words for why a stopped mod is not running (it was refused at start), never the mod's
  if (m.state === 'stopped' && m.note) return m.note;
  if (m.state === 'paused') return m.pausedWhy && m.pausedWhy !== 'user' ? `paused (${m.pausedWhy})` : 'paused';
  if (m.state === 'error') return 'error: its pinned snapshot does not read';
  return m.state;
}

/** The MCP line of an installed mod. */
export function mcpText(m: Pick<InstalledMod, 'mcp' | 'state'>): string {
  if (!m.mcp) return 'no MCP server';
  if (m.mcp.launch === 'needs-config' && m.state !== 'paused') return `${m.mcp.server} · isn't set up, so sessions don't get it${m.mcp.setupPending ? ' · a setup card waits' : ''}`;
  const on = m.state === 'paused' ? 'off while paused' : 'passed to new sessions';
  return `${m.mcp.server} · ${on}${m.mcp.overridden ? ' · your launch override' : ''}${m.mcp.configRequested ? ' · a change waits on its card' : ''}`;
}

export const deskText = (d: ModDesk): string => `shown ${d.shown} · suppressed ${d.suppressed} · kept ${d.kept}`;

/** The Workshop catalog entry the footer's Install Workshop key installs from, or null. */
export function workshopSource(status: unknown): string | null {
  const v = modsViewOf(status);
  return v.available.find((a) => a.name === 'gnomon.workshop')?.path ?? null;
}

/** What one panel action is waiting on, for its busy state and its result line. */
export function resultText(kind: ModRequestKind, r: unknown): string {
  const o = obj(r);
  const note = str(o?.note);
  if (kind === 'request.mod.pause') return `${str(o?.name) ?? 'the mod'} paused: it stops now and its MCP server leaves new sessions`;
  if (kind === 'request.mod.start') return `${str(o?.name) ?? 'the mod'} starting from its pinned snapshot`;
  if (kind === 'request.mod.setup') return 'the setup card is in the stack: allow it there (Touch ID); nothing changes until you do';
  if (o?.state === 'unchanged') return note ?? 'already installed: nothing to approve';
  return note ?? 'requested: decide the card in the stack';
}
