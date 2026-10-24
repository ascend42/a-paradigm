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
 */
import { MOD_INSTALL_LIMITS } from '@a-company/gnomon-contracts';
import type { StackCard } from './store.js';

export type ModRequestKind = 'request.mod.install' | 'request.mod.link' | 'request.mod.pause' | 'request.mod.start' | 'request.mod.uninstall' | 'request.mod.config';
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

export interface ModMcp {
  server: string;
  overridden: boolean;
  configRequested: boolean;
  configurable: { command: boolean; args: boolean; env: string[]; secret: string[] };
  command: string;
  args: string[];
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
      uninstallRequested: m.uninstallRequested === true,
      mcp: mcp && str(mcp.server) ? { server: str(mcp.server)!, overridden: mcp.overridden === true, configRequested: mcp.configRequested === true, configurable: { command: cfg?.command === true, args: cfg?.args === true, env: strs(cfg?.env), secret: strs(cfg?.secret) }, command: str(mcp.command) ?? '', args: strs(mcp.args) } : null,
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

/** The state line of an installed mod. */
export function stateText(m: Pick<InstalledMod, 'state' | 'pausedWhy' | 'uninstallRequested'>): string {
  if (m.uninstallRequested) return 'uninstall requested';
  if (m.state === 'paused') return m.pausedWhy && m.pausedWhy !== 'user' ? `paused (${m.pausedWhy})` : 'paused';
  if (m.state === 'error') return 'error: its pinned snapshot does not read';
  return m.state;
}

/** The MCP line of an installed mod. */
export function mcpText(m: Pick<InstalledMod, 'mcp' | 'state'>): string {
  if (!m.mcp) return 'no MCP server';
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
  if (o?.state === 'unchanged') return note ?? 'already installed: nothing to approve';
  return note ?? 'requested: decide the card in the stack';
}
