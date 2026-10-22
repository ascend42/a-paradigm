/**
 * @symbol #mods-admin
 * @symbol #mod-host
 *
 * The GUI's half of `gnomon mod` (founder dogfood 2026-10-21: "Install Workshop does nothing … I don't see any way
 * to access mods"; rule: every setup step gets a guided UI, the CLI verbs stay as the raw form). Two things:
 *
 *   1. status.mods.installed / status.mods.available / status.mods.catalog — what the Mods panel shows: every
 *      installed mod (pin, tier, source, version, run state, its MCP server, its offers, its Desk counts) and the
 *      first-party mods shipped beside this kernel (packages/gnomon-mods) that are not installed, or whose shipped
 *      tree is not the pinned one (an Update). Display only: nothing here decides a load (the host and the
 *      root-signed grant table do).
 *   2. The human's mod requests, on a first-party human connection (credential gui or device; dispatch.ts stamps
 *      the asker): each one does EXACTLY what its CLI verb does, through the same functions, and signs nothing.
 *        request.mod.install {source:'folder', path}  `gnomon mod install <path>`   stageInstall via package
 *        request.mod.link    {path}                   `gnomon mod link <folder>`    stageInstall via linked
 *        request.mod.pause   {name}                   `gnomon mod pause <name>`     writePause
 *        request.mod.start   {name}                   `gnomon mod start <name>`     requestStart
 *        request.mod.uninstall {name}                 `gnomon mod uninstall <name>` requestUninstall
 *        request.mod.config  {name, command?, args?, env?}  `gnomon mod config`     requestMcpConfig
 *      Then the kernel's own scans run at once (StagedCardPickup, McpConfigCards), so the install / uninstall /
 *      config card is raised in the stack before the request answers, with its cardId. Every card is the normal
 *      one: re-derived from the pinned snapshot, root key + fresh presence to decide. `source:'git'` is S4 and is
 *      refused UNSUPPORTED here (as the CLI refuses a URL).
 *      request.mod.install is the A8 kind in contracts KIND_PAYLOADS: the kernel writes it as a row (the human's
 *      ask, like request.session.model). The other five are dispatcher-only, never rows (like request.voice.client:
 *      not in the §9.1 registry, so no contract id moves); what they cause is logged by the paths they drive
 *      (manifest.staged, mod.paused, manifest.uninstall, …).
 */
import * as fs from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isModId, MOD_INSTALL_LIMITS, parseModId, validateKindPayload } from '@a-company/gnomon-contracts';
import type { RowVerifier } from '../identity/registry.js';
import { effectiveInstall, pinDirKey, readGrants } from '../manifest/grants.js';
import { FIRST_PARTY_PACKAGE_HASHES, stageInstall } from '../manifest/install.js';
import { MANIFEST_FILE, readManifest, type ManifestV2, type TrustTier } from '../manifest/manifest.js';
import { ManifestRefusal, noEvents } from '../manifest/refusal.js';
import { hashSourceTree, pinnedDir } from '../manifest/snapshot.js';
import { userMcpServerNames } from '../manifest/user-mcp.js';
import { appBundleOf } from '../lifecycle/app-bundle.js';
import { readDeskMods, readMcpConfigRequest, readMcpOverrides, requestMcpConfig, serverNameOf } from '../desk/mcp-passthrough.js';
import type { DeskTallyView } from '../desk/desk-stats.js';
import { RpcRefusal } from '../socket/rpc.js';
import { isUserPaused, requestStart, requestUninstall, uninstallRequested, writePause } from './control.js';

export const MOD_INSTALL_REQUEST = 'request.mod.install' as const;
export const MOD_LINK_REQUEST = 'request.mod.link' as const;
export const MOD_PAUSE_REQUEST = 'request.mod.pause' as const;
export const MOD_START_REQUEST = 'request.mod.start' as const;
export const MOD_UNINSTALL_REQUEST = 'request.mod.uninstall' as const;
export const MOD_CONFIG_REQUEST = 'request.mod.config' as const;
/** The human's mod requests dispatch.ts routes here (gui / device human connections only). */
export const MOD_ADMIN_REQUESTS: readonly string[] = Object.freeze([MOD_INSTALL_REQUEST, MOD_LINK_REQUEST, MOD_PAUSE_REQUEST, MOD_START_REQUEST, MOD_UNINSTALL_REQUEST, MOD_CONFIG_REQUEST]);
export type ModAdminRequest = (typeof MOD_ADMIN_REQUESTS)[number];

/** The first-party catalog folder name beside this kernel's package (packages/gnomon-mods). */
export const FIRST_PARTY_DIR = 'gnomon-mods';
/** Catalog entries read (each a folder with a gnomon-manifest.json), and a manifest's size cap. */
export const MAX_CATALOG = 32;
const MAX_MANIFEST_BYTES = 64 * 1024;
/** request.mod.config bounds (the card shows every one; mcp-passthrough re-checks against the manifest). */
const MAX_CONFIG_ARGS = 64;
const MAX_CONFIG_ENV = 32;
const MAX_DESCRIPTION = 280;

/**
 * Where the shipped first-party mods are. Inside a release Gnomon.app (#app-bundle, 8.0 M4): ONLY the app's own
 * Contents/Resources/gnomon-mods (null when absent; the lookup never walks out of the app, so a `gnomon-mods` folder
 * planted beside the app in /Applications is never read). Elsewhere: the nearest `gnomon-mods` folder above this
 * module (the clone layout, and the npm package where prepack copies it).
 */
export function findFirstPartyRoot(from: string = path.dirname(fileURLToPath(import.meta.url))): string | null {
  const bundle = appBundleOf(from);
  if (bundle) {
    try {
      return fs.statSync(bundle.mods).isDirectory() ? fs.realpathSync.native(bundle.mods) : null;
    } catch {
      return null;
    }
  }
  let d = from;
  for (let i = 0; i < 6; i++) {
    const c = path.join(d, FIRST_PARTY_DIR);
    try {
      if (fs.statSync(c).isDirectory()) return fs.realpathSync.native(c);
    } catch {
      /* not here */
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

export interface CatalogEntry {
  name: string;
  version: string;
  description: string | null;
  /** the absolute folder the GUI installs from (request.mod.install{source:'folder', path}) */
  path: string;
  packageHash: string | null;
  /** first-party only when the shipped tree is a bundled first-party pin (the tier is derived by hash at install) */
  tier: 'first-party' | 'local';
}

export interface InstalledModView {
  name: string;
  publisher: string;
  version: string | null;
  description: string | null;
  tier: string;
  source: 'package' | 'linked' | 'git';
  packageHash: string;
  dev: boolean;
  /** running | paused | stopped (installed, not running) | error (its pinned manifest no longer reads) */
  state: 'running' | 'paused' | 'stopped' | 'error';
  pausedWhy: string | null;
  uninstallRequested: boolean;
  mcp: { server: string; overridden: boolean; configRequested: boolean; configurable: { command: boolean; args: boolean; env: string[]; secret: string[] }; command: string; args: string[] } | null;
  offers: Array<{ kind: string; title: string }>;
  desk: DeskTallyView;
  /** the shipped first-party tree differs from the pin: installing it raises a re-pin (Update) card */
  update: { version: string; path: string; packageHash: string | null } | null;
}

export interface ModsAdminOptions {
  home: string;
  trust: RowVerifier;
  /** the mod host's running + paused views */
  host: { status(): Record<string, unknown> };
  /** StagedCardPickup.scan (raises staged install / uninstall cards, honours pause / start) */
  scan: () => Promise<void>;
  /** McpConfigCards.scan (raises the mod.mcp.config card) */
  scanConfig: () => Promise<void>;
  /** the staged card ids the broker raised (pickup.raised()) */
  raised?: () => string[];
  desk?: { of(mod: string): DeskTallyView };
  /** the request.mod.install row (the kernel writes it; reject if it was not written) */
  logRequest?: (kind: typeof MOD_INSTALL_REQUEST, payload: Record<string, unknown>, ids: { connId: string }) => Promise<void>;
  /** default findFirstPartyRoot(); null = no catalog */
  firstPartyRoot?: string | null;
  userHome?: string;
  now?: () => Date;
}

export interface ModAsker {
  connId: string;
  principal: string | undefined;
  principalClass: string;
  credential: string | undefined;
}

const ZERO_DESK: DeskTallyView = Object.freeze({ shown: 0, suppressed: 0, kept: 0, open: 0, notNow: 0, stopHere: 0 });

const bad = (message: string, data: Record<string, unknown> = {}): RpcRefusal => new RpcRefusal('BAD_REQUEST', 'bad-params', message, data);

function closedObject(payload: unknown, keys: readonly string[], shape: string): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw bad(shape);
  const extra = Object.keys(payload).filter((k) => !keys.includes(k));
  if (extra.length) throw bad(`${shape} (unknown: ${extra.slice(0, 4).join(', ')})`);
  return payload as Record<string, unknown>;
}

function modNameOf(p: Record<string, unknown>, shape: string): string {
  if (typeof p.name !== 'string' || !isModId(p.name)) throw bad(`${shape}: name must be a mod id <publisher>.<name>`);
  return p.name;
}

/** An absolute local folder, bounded; the same rules as request.mod.install{path}. */
function folderOf(raw: unknown, shape: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MOD_INSTALL_LIMITS.path) throw bad(`${shape}: path must be an absolute folder path (at most ${MOD_INSTALL_LIMITS.path} characters)`);
  if (!path.isAbsolute(raw)) throw bad(`${shape}: path must be absolute`, { field: 'path' });
  let st: fs.Stats;
  try {
    st = fs.statSync(raw);
  } catch {
    throw new RpcRefusal('NOT_FOUND', 'no-folder', `no folder at ${raw.slice(0, 200)}`, { field: 'path' });
  }
  if (!st.isDirectory()) throw new RpcRefusal('BAD_REQUEST', 'not-a-folder', `${raw.slice(0, 200)} is not a folder`, { field: 'path' });
  try {
    fs.statSync(path.join(raw, MANIFEST_FILE));
  } catch {
    throw new RpcRefusal('BAD_REQUEST', 'no-manifest', `${raw.slice(0, 200)} has no ${MANIFEST_FILE}: it is not a mod folder`, { field: 'path' });
  }
  return fs.realpathSync.native(raw);
}

function manifestRefusal(err: unknown): never {
  if (err instanceof ManifestRefusal) throw new RpcRefusal('FORBIDDEN', `manifest-${err.manifestCode.toLowerCase()}`, err.message.slice(0, 400), { manifestCode: err.manifestCode });
  throw err;
}

/** The #mods-admin port: the Mods panel's status and the human's mod requests. */
export class ModsAdmin {
  readonly #o: ModsAdminOptions;
  readonly #root: string | null;
  #catalogKey = '';
  #catalog: CatalogEntry[] = [];

  constructor(o: ModsAdminOptions) {
    this.#o = o;
    this.#root = o.firstPartyRoot === undefined ? findFirstPartyRoot() : o.firstPartyRoot;
  }

  /** The shipped first-party mods (cached on their manifests' size + mtime; the tree hash runs only on a change). */
  catalog(): CatalogEntry[] {
    const root = this.#root;
    if (!root) return [];
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(root).filter((d) => /^[a-z][a-z0-9-]{0,62}$/.test(d)).sort().slice(0, MAX_CATALOG);
    } catch {
      return [];
    }
    const stamps: string[] = [];
    for (const d of dirs) {
      try {
        const st = fs.statSync(path.join(root, d, MANIFEST_FILE));
        stamps.push(`${d}:${st.size}:${st.mtimeMs}`);
      } catch {
        /* not a mod folder */
      }
    }
    const key = stamps.join('|');
    if (key === this.#catalogKey) return this.#catalog;
    const out: CatalogEntry[] = [];
    for (const d of dirs) {
      const dir = path.join(root, d);
      try {
        const file = path.join(dir, MANIFEST_FILE);
        if (fs.statSync(file).size > MAX_MANIFEST_BYTES) continue;
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        const publisher = typeof raw.publisher === 'string' ? raw.publisher : 'gnomon';
        const name = `${publisher}.${String(raw.name)}`;
        if (!isModId(name) || typeof raw.version !== 'string') continue;
        let packageHash: string | null = null;
        try {
          packageHash = hashSourceTree(dir, name, noEvents).packageHash;
        } catch {
          packageHash = null;
        }
        const description = typeof raw.description === 'string' ? raw.description.slice(0, MAX_DESCRIPTION) : null;
        out.push({ name, version: raw.version.slice(0, 64), description, path: dir, packageHash, tier: packageHash && FIRST_PARTY_PACKAGE_HASHES.has(packageHash) ? 'first-party' : 'local' });
      } catch {
        continue;
      }
    }
    this.#catalog = out;
    this.#catalogKey = key;
    return out;
  }

  /** status.mods.installed / available / catalog (the human class only; dispatch.ts merges it into status.mods). */
  status(): { installed: InstalledModView[]; available: CatalogEntry[]; catalog: { root: string | null } } {
    const { home, trust } = this.#o;
    const grants = readGrants(home, trust);
    const host = this.#o.host.status() as { running?: Array<{ name?: unknown; dev?: unknown }>; paused?: Array<{ name?: unknown; why?: unknown }> };
    const running = new Set((host.running ?? []).map((r) => r.name).filter((n): n is string => typeof n === 'string'));
    const paused = new Map((host.paused ?? []).filter((p) => typeof p.name === 'string').map((p) => [p.name as string, typeof p.why === 'string' ? p.why : 'user']));
    const overrides = readMcpOverrides(home);
    const catalog = this.catalog();
    const byName = new Map(catalog.map((c) => [c.name, c]));
    const installed: InstalledModView[] = [];
    for (const name of [...new Set(grants.installs.map((r) => r.name))].sort()) {
      const row = effectiveInstall(grants, name);
      if (!row) continue;
      const tier = grants.trust.get(row.manifestHash) ?? 'local';
      let manifest: ManifestV2 | null = null;
      try {
        const pub = parseModId(name)?.publisher;
        const r = readManifest(fs.readFileSync(path.join(pinnedDir(home, pinDirKey(row), row.packageHash), MANIFEST_FILE)), { tier: tier as TrustTier, ...(row.legacyName ? { legacyPublisher: pub === 'gnomon' ? 'gnomon' : 'local' } : {}) });
        if (r.manifestHash === row.manifestHash) manifest = r.manifest;
      } catch {
        manifest = null;
      }
      const userPaused = isUserPaused(home, name);
      const state: InstalledModView['state'] = !manifest ? 'error' : running.has(name) ? 'running' : userPaused || paused.has(name) ? 'paused' : 'stopped';
      const entry = manifest?.provides?.mcp?.[0];
      const cfg = entry?.config;
      const shipped = byName.get(name);
      installed.push({
        name,
        publisher: parseModId(name)?.publisher ?? name.split('.')[0]!,
        version: manifest?.version ?? null,
        description: manifest?.description?.slice(0, MAX_DESCRIPTION) ?? null,
        tier,
        source: row.source === 'package' ? 'package' : row.source.startsWith('git:') ? 'git' : 'linked',
        packageHash: row.packageHash,
        dev: row.dev !== undefined,
        state,
        pausedWhy: state === 'paused' ? (userPaused ? 'user' : (paused.get(name) ?? null)) : null,
        uninstallRequested: uninstallRequested(home, name) !== null,
        mcp: entry
          ? {
              server: serverNameOf(name),
              overridden: Object.hasOwn(overrides, name),
              configRequested: readMcpConfigRequest(home, name) !== null,
              configurable: { command: cfg?.command === true, args: cfg?.args === true, env: [...(cfg?.env ?? [])], secret: [...(cfg?.secret ?? [])] },
              command: entry.command,
              args: [...(entry.args ?? [])],
            }
          : null,
        offers: (manifest?.provides?.offers ?? []).map((o) => ({ kind: String((o as { kind?: unknown }).kind ?? ''), title: String((o as { title?: unknown }).title ?? '') })),
        desk: this.#o.desk?.of(name) ?? { ...ZERO_DESK },
        update: shipped && shipped.packageHash !== row.packageHash && row.source === 'package' ? { version: shipped.version, path: shipped.path, packageHash: shipped.packageHash } : null,
      });
    }
    const have = new Set(installed.map((m) => m.name));
    return { installed, available: catalog.filter((c) => !have.has(c.name)), catalog: { root: this.#root } };
  }

  /** One human mod request (dispatch.ts has checked: human class, gui / device credential). */
  async request(asker: ModAsker, kind: string, payload: unknown): Promise<Record<string, unknown>> {
    if (asker.principalClass !== 'human' || (asker.credential !== 'gui' && asker.credential !== 'device')) {
      throw new RpcRefusal('FORBIDDEN', 'human-only', `${kind} is the human's, on a first-party connection (GUI or this home's device)`);
    }
    switch (kind) {
      case MOD_INSTALL_REQUEST:
        return this.#install(asker, payload);
      case MOD_LINK_REQUEST: {
        const p = closedObject(payload, ['path'], `log.append{kind:'${MOD_LINK_REQUEST}', payload:{path}}`);
        return this.#stage(asker, folderOf(p.path, MOD_LINK_REQUEST), 'linked');
      }
      case MOD_PAUSE_REQUEST:
      case MOD_START_REQUEST:
      case MOD_UNINSTALL_REQUEST: {
        const shape = `log.append{kind:'${kind}', payload:{name}}`;
        const name = modNameOf(closedObject(payload, ['name'], shape), shape);
        const row = effectiveInstall(readGrants(this.#o.home, this.#o.trust), name);
        if (!row) throw new RpcRefusal('NOT_FOUND', 'not-installed', `${name} is not installed`, { name });
        const now = this.#o.now?.();
        if (kind === MOD_PAUSE_REQUEST) writePause(this.#o.home, name, now);
        else if (kind === MOD_START_REQUEST) requestStart(this.#o.home, name, now);
        else requestUninstall(this.#o.home, name, row.packageHash, now, { attended: true });
        await this.#o.scan();
        if (kind === MOD_PAUSE_REQUEST) return { name, state: 'paused' };
        if (kind === MOD_START_REQUEST) return { name, state: 'start-requested' };
        return { name, state: 'uninstall-requested', note: 'the kernel raised the uninstall card: decide it in the stack (root key)' };
      }
      case MOD_CONFIG_REQUEST:
        return this.#config(payload);
      default:
        throw new RpcRefusal('BAD_REQUEST', 'bad-kind', `${kind} is not a mod request`);
    }
  }

  async #install(asker: ModAsker, payload: unknown): Promise<Record<string, unknown>> {
    const errs = validateKindPayload(MOD_INSTALL_REQUEST, payload);
    if (errs.length) throw bad(`log.append{kind:'${MOD_INSTALL_REQUEST}', payload:{source:'folder', path}}: ${errs.slice(0, 3).join('; ')}`);
    const p = payload as { source: string; path?: string };
    if (p.source !== 'folder') throw new RpcRefusal('UNSUPPORTED', 'git-install-s4', 'installing from a git URL lands with slice S4; clone it and install the folder');
    const dir = folderOf(p.path, MOD_INSTALL_REQUEST);
    if (this.#o.logRequest) await this.#o.logRequest(MOD_INSTALL_REQUEST, { source: 'folder', path: dir }, { connId: asker.connId });
    return this.#stage(asker, dir, 'package');
  }

  async #stage(asker: ModAsker, dir: string, via: 'package' | 'linked'): Promise<Record<string, unknown>> {
    let st: ReturnType<typeof stageInstall>;
    try {
      st = stageInstall({
        home: this.#o.home,
        source: dir,
        via,
        requestedBy: asker.principal ?? `p:${this.#o.trust.ns ?? '00000000'}/gui`,
        attended: true,
        trust: this.#o.trust,
        userMcpServers: userMcpServerNames({ userHome: this.#o.userHome ?? os.homedir() }),
        ...(this.#o.now ? { now: this.#o.now() } : {}),
      });
    } catch (err) {
      manifestRefusal(err);
    }
    if (st.state === 'unchanged') return { state: 'unchanged', packageHash: st.packageHash, note: 'this folder is already the installed pin: nothing to approve' };
    // a scan already in flight may have listed the staged dir before this card existed: one more pass picks it up
    await this.#o.scan();
    if (this.#o.raised && !this.#o.raised().includes(st.cardId)) await this.#o.scan();
    const raised = this.#o.raised?.().includes(st.cardId) ?? false;
    return { state: 'staged', name: st.record.detail.name, cardId: st.cardId, raised, note: raised ? 'the install card is in the stack: decide it there (Touch ID, root key)' : 'staged: the kernel raises the install card on its next scan' };
  }

  async #config(payload: unknown): Promise<Record<string, unknown>> {
    const shape = `log.append{kind:'${MOD_CONFIG_REQUEST}', payload:{name, command?, args?, env?}}`;
    const p = closedObject(payload, ['name', 'command', 'args', 'env'], shape);
    const name = modNameOf(p, shape);
    const config: { command?: string; args?: string[]; env?: Record<string, string> } = {};
    if (p.command !== undefined) {
      if (typeof p.command !== 'string' || p.command.length === 0 || p.command.length > 1024) throw bad(`${shape}: command must be a non-empty string`);
      config.command = p.command;
    }
    if (p.args !== undefined) {
      if (!Array.isArray(p.args) || p.args.length > MAX_CONFIG_ARGS || p.args.some((a) => typeof a !== 'string' || a.length > 1024)) throw bad(`${shape}: args must be at most ${MAX_CONFIG_ARGS} strings`);
      config.args = [...(p.args as string[])];
    }
    if (p.env !== undefined) {
      if (p.env === null || typeof p.env !== 'object' || Array.isArray(p.env) || Object.keys(p.env).length > MAX_CONFIG_ENV || Object.values(p.env).some((v) => typeof v !== 'string' || v.length > 4096)) throw bad(`${shape}: env must be an object of at most ${MAX_CONFIG_ENV} NAME: value strings`);
      config.env = { ...(p.env as Record<string, string>) };
    }
    if (config.command === undefined && config.args === undefined && config.env === undefined) throw bad(`${shape}: give command, args or env`);
    const mod = readDeskMods(this.#o.home, this.#o.trust).find((m) => m.name === name);
    if (!mod) throw new RpcRefusal('NOT_FOUND', 'not-installed', `${name} is not an installed, granted, running-eligible mod (a paused mod is not configured)`, { name });
    if (!mod.manifest.provides?.mcp?.[0]) throw new RpcRefusal('NOT_FOUND', 'no-server', `${name} declares no mcp server`, { name });
    try {
      requestMcpConfig(this.#o.home, mod, config, this.#o.now?.());
    } catch (err) {
      throw new RpcRefusal('FORBIDDEN', 'not-declared', (err as Error).message.slice(0, 300), { name });
    }
    await this.#o.scanConfig();
    return { name, server: serverNameOf(name), state: 'config-requested', note: 'the kernel raised the launch card: decide it in the stack' };
  }
}
