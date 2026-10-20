/**
 * @symbol #mcp-passthrough
 *
 * The Desk's MCP passthrough (TD-2026-10-20-812 A2, slice S1). A mod reaches the model through its own local MCP
 * server (`provides.mcp`); this module puts the servers of every installed, granted, unpaused mod into the session's
 * kernel-written mcp.json (supervisor.ts, `--strict-mcp-config`), namespaced `gnomon-<mod>`:
 *
 *   - the entry named like the mod (or `gnomon-<mod>`) is `gnomon-<mod>`; any other entry `gnomon-<mod>-<entry>`
 *     (serverNameOf, the one naming helper);
 *   - a name the repo's own .mcp.json already uses is NEVER overridden (the mod server is skipped), nor is a name an
 *     earlier mod (sorted by name) took;
 *   - a mod the human muted for the session's repo (request.offer.mute) is skipped;
 *   - a server whose resolved command is not absolute (isAbsoluteCommand) is skipped as 'needs-config' (fail
 *     closed; the daemon reports UNCONFIGURED_HINT).
 *
 * PER-USER LAUNCH OVERRIDE (S0's resolveMcpLaunch; Aegis D2). First-party servers launch as `node <absolute path>`
 * from their own repos, so a manifest's fixed command cannot name them. The override lives ONLY in kernel state
 * (`<home>/desk/mcp-overrides.json`, 0600), never in a repo file, so a cloned repo cannot set a command. Writing it is
 * human-only and goes through a card: `gnomon mod config <mod> --command <abs> --args …` writes a REQUEST under the
 * mod's home dir (a session's sandbox cannot write the home), and the kernel (McpConfigCards) raises a root-class
 * `grant` card showing the effective launch — command, args and env NAMES, never values — plus its launch hash. Only
 * `allow` writes the store. Only what the manifest entry's `config` declares is accepted (validateMcpUserConfig), and
 * an overridden command must be an absolute path (an .exe on Windows), args must fit the card unshortened, and
 * secret-marked env names are refused. WRITE LIMITS (confirmed): the request file lives under <home>/mods/<mod>/, which
 * the `session` sandbox profile write-denies (modhost/control.ts "WHO MAY WRITE"), so a session cannot plant one; any
 * process of the OS user can, which is why the card labels it unverified and shows the full effective launch.
 * Claude Code spawns stdio MCP servers itself (its own spawn, outside the kernel's control).
 */

import { createHmac, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mintId } from '@a-company/gnomon-contracts';
import type { RowVerifier } from '../identity/registry.js';
import type { ApprovalBroker } from '../broker/broker.js';
import { checkAgainstGrants, effectiveInstall, grantsPath, readGrants } from '../manifest/grants.js';
import { MANIFEST_FILE, manifestHash, resolveMcpLaunch, validateManifest, validateMcpUserConfig, type ManifestMcp, type ManifestV1, type McpUserConfig } from '../manifest/manifest.js';
import { computePackageHash, hashPinnedTree, modDir, pinnedDir } from '../manifest/snapshot.js';
import { isUserPaused, modNames } from '../modhost/control.js';

/** An installed, granted, unpaused mod as the Desk sees it (manifest read from its pinned snapshot). */
export interface DeskMod {
  name: string;
  manifest: ManifestV1;
}

/**
 * Desk server-name prefixes the kernel reserves (Aegis S1 H1a): `gnomon-` now, `gm_` and `gx_` for the coming
 * gm_<pub>_<name> rename. A repo .mcp.json entry with such a name is dropped (it could receive a mod's handoff).
 */
export const RESERVED_DESK_PREFIXES = Object.freeze(['gnomon-', 'gm_', 'gx_']);
export function isReservedDeskName(name: string): boolean {
  return RESERVED_DESK_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Every installed mod whose pinned snapshot verifies, whose manifest matches its grant, whose capabilities and egress
 * are granted and which the user has not paused. Fail closed per mod (a mod that does not verify is left out).
 */
export function readDeskMods(home: string, trust: RowVerifier): DeskMod[] {
  const grants = readGrants(home, trust);
  const out: DeskMod[] = [];
  for (const name of [...new Set(grants.installs.map((r) => r.name))].sort()) {
    const row = effectiveInstall(grants, name);
    if (!row || isUserPaused(home, name)) continue;
    try {
      const dir = pinnedDir(home, name, row.packageHash);
      if (computePackageHash(hashPinnedTree(dir)) !== row.packageHash) continue;
      const m = validateManifest(JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')), { tier: grants.trust.get(row.manifestHash) ?? 'local' });
      if (manifestHash(m) !== row.manifestHash || !checkAgainstGrants(m, row.manifestHash, grants).ok) continue;
      out.push({ name, manifest: m });
    } catch {
      continue;
    }
  }
  return out;
}

/** readDeskMods cached on the grant table and pause markers (the pinned-tree hash runs only on a change). */
export class DeskMods {
  readonly #home: string;
  readonly #trust: RowVerifier;
  #key = '';
  #mods: DeskMod[] = [];
  constructor(home: string, trust: RowVerifier) {
    this.#home = home;
    this.#trust = trust;
  }
  list(): readonly DeskMod[] {
    let st = 'absent';
    try {
      const s = fs.statSync(grantsPath(this.#home));
      st = `${s.size}:${s.mtimeMs}`;
    } catch {
      /* no grants yet */
    }
    const key = `${st}|${modNames(this.#home).filter((n) => isUserPaused(this.#home, n)).join(',')}|${this.#trust.rootKeyId ?? ''}`;
    if (key !== this.#key) {
      this.#mods = readDeskMods(this.#home, this.#trust);
      this.#key = key;
    }
    return this.#mods;
  }
}

/* ── the per-user override store (kernel state only) ─────────────────────── */

export const MCP_OVERRIDES_SCHEMA = 'gnomon-mcp-overrides:v1' as const;
export const MCP_CONFIG_REQUEST = 'mcp-config.request.json';
const STORE_MAX_BYTES = 256 * 1024;

export type McpOverrides = Record<string, Record<string, McpUserConfig>>;

export function mcpOverridesPath(home: string): string {
  return path.join(home, 'desk', 'mcp-overrides.json');
}

/** The store, or {} when absent or unreadable (fail closed: no override). Each entry is re-validated at use. */
export function readMcpOverrides(home: string): McpOverrides {
  try {
    const p = mcpOverridesPath(home);
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.size > STORE_MAX_BYTES) return {};
    const v = JSON.parse(fs.readFileSync(p, 'utf8')) as { schema?: unknown; mods?: unknown };
    if (v.schema !== MCP_OVERRIDES_SCHEMA || v.mods === null || typeof v.mods !== 'object' || Array.isArray(v.mods)) return {};
    return v.mods as McpOverrides;
  } catch {
    return {};
  }
}

/** Write one server's override (the card's `allow` effect; never called from a request path). null removes it. */
export function writeMcpOverride(home: string, mod: string, server: string, config: McpUserConfig | null): void {
  const all = readMcpOverrides(home);
  const forMod = { ...(all[mod] ?? {}) };
  if (config === null) delete forMod[server];
  else forMod[server] = config;
  if (Object.keys(forMod).length) all[mod] = forMod;
  else delete all[mod];
  const p = mcpOverridesPath(home);
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ schema: MCP_OVERRIDES_SCHEMA, mods: all }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, p);
}

/** An override after the S0 check, with D2's extra rule: an overridden command is an absolute path. Throws. */
export function checkMcpOverride(entry: ManifestMcp, override: unknown, platform: string = process.platform): McpUserConfig {
  const u = validateMcpUserConfig(entry, override);
  if (u.command !== undefined && !isAbsoluteCommand(u.command)) throw new TypeError(`mcp config ${entry.name}: command must be an absolute path`);
  // Aegis S1 M2: on Windows only an .exe runs (never a .cmd/.bat that a shell would interpret)
  if (u.command !== undefined && platform === 'win32' && !/\.exe$/i.test(u.command)) throw new TypeError(`mcp config ${entry.name}: on Windows the command must be an .exe`);
  if ((u.args ?? []).join(' ').length > MCP_CARD_ARGS_MAX) throw new TypeError(`mcp config ${entry.name}: args are longer than the card can show (${MCP_CARD_ARGS_MAX} characters)`);
  return u;
}

/** The card shows args in full (Aegis S1 L6): a request whose args would not fit is refused, never truncated. */
export const MCP_CARD_ARGS_MAX = 300;

export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The effective launch of one server under the store (an override that fails the checks is ignored: fail closed). */
export function effectiveLaunch(entry: ManifestMcp, override: unknown, platform: string = process.platform): { launch: McpLaunch; overridden: boolean } {
  if (override !== undefined) {
    try {
      checkMcpOverride(entry, override, platform);
      return { launch: resolveMcpLaunch(entry, override), overridden: true };
    } catch {
      /* fall through to the manifest's own launch */
    }
  }
  return { launch: resolveMcpLaunch(entry), overridden: false };
}

/**
 * The launch hash (Aegis S1 M2): an HMAC under a kernel-held key, so a logged hash never lets anyone confirm a guessed
 * env value. Logged on the config card and per added server at spawn; values are never shown.
 */
export function launchHashOf(l: McpLaunch, key: Buffer): string {
  const env = Object.keys(l.env).sort().map((k) => [k, l.env[k]]);
  return `hmac-sha256:${createHmac('sha256', key).update(JSON.stringify([l.command, l.args, env]), 'utf8').digest('hex')}`;
}

/** The kernel-held launch-hash key (<home>/desk/launch-hash.key, 32 random bytes, 0600; created on first use). */
export function deskLaunchKey(home: string): Buffer {
  const p = path.join(home, 'desk', 'launch-hash.key');
  try {
    const b = fs.readFileSync(p);
    if (b.length === 32) return b;
  } catch {
    /* first use */
  }
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  const k = randomBytes(32);
  fs.writeFileSync(p, k, { mode: 0o600 });
  return k;
}
const PROCESS_KEY = randomBytes(32);

/** The namespaced server name of one mod entry. */
export function serverNameOf(mod: string, entry: ManifestMcp, _entries?: readonly ManifestMcp[]): string {
  // the ONE naming helper (a convention rename at integration changes only this)
  return entry.name === mod || entry.name === `gnomon-${mod}` ? `gnomon-${mod}` : `gnomon-${mod}-${entry.name}`;
}

/**
 * The fail-closed launch rule (Aegis, coordinator ruling): the RESOLVED command (manifest default or per-user override)
 * must be an absolute path — POSIX `/…` or a Windows drive path `X:\…` / `X:/…`; a UNC or `//` prefix is refused.
 * Otherwise the server is not added to mcp.json and is reported needs-config. Both shipped first-party defaults fail
 * this until the user sets an absolute command with `gnomon mod config`.
 */
export function isAbsoluteCommand(cmd: string): boolean {
  if (cmd.startsWith('//') || cmd.startsWith('\\\\')) return false;
  return cmd.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cmd);
}
export const UNCONFIGURED_HINT = 'set it with gnomon mod config <mod> --command <abs> --args …';

export interface PassthroughResult {
  servers: Record<string, unknown>;
  /** repo server names dropped for using a reserved desk prefix (H1a) */
  dropped: string[];
  added: Array<{ mod: string; server: string; launchHash: string; overridden: boolean }>;
  skipped: Array<{ mod: string; server?: string; why: 'repo-muted' | 'name-taken' | 'needs-config' }>;
}

/**
 * Merge mods' provides.mcp into the repo's mcp servers. Pure (overrides passed in). The repo's entries come first and
 * are never replaced.
 */
export function mergeDeskMcp(repo: Record<string, unknown>, mods: readonly DeskMod[], opts: { overrides?: McpOverrides; repoMuted?: (mod: string) => boolean; launchKey?: Buffer; platform?: string } = {}): PassthroughResult {
  const { servers, dropped } = repoServersOnly(repo);
  const added: PassthroughResult['added'] = [];
  const skipped: PassthroughResult['skipped'] = [];
  for (const m of [...mods].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const entries = m.manifest.provides?.mcp ?? [];
    if (!entries.length) continue;
    if (opts.repoMuted?.(m.name)) {
      skipped.push({ mod: m.name, why: 'repo-muted' });
      continue;
    }
    for (const e of entries) {
      const server = serverNameOf(m.name, e, entries);
      if (Object.prototype.hasOwnProperty.call(servers, server)) {
        skipped.push({ mod: m.name, server, why: 'name-taken' });
        continue;
      }
      const { launch, overridden } = effectiveLaunch(e, opts.overrides?.[m.name]?.[e.name], opts.platform);
      // fail closed: a relative command (e.g. `neurons`, `constellation-mcp`) never launches
      if (!isAbsoluteCommand(launch.command)) {
        skipped.push({ mod: m.name, server, why: 'needs-config' });
        continue;
      }
      servers[server] = { type: 'stdio', command: launch.command, args: launch.args, ...(Object.keys(launch.env).length ? { env: launch.env } : {}) };
      added.push({ mod: m.name, server, launchHash: launchHashOf(launch, opts.launchKey ?? PROCESS_KEY), overridden });
    }
  }
  return { servers, dropped, added, skipped };
}

/** The repo's servers minus any using a reserved desk prefix (H1a; also the fail-closed result when the Desk is not bound). */
export function repoServersOnly(repo: Record<string, unknown>): { servers: Record<string, unknown>; dropped: string[] } {
  const servers: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(repo)) {
    if (isReservedDeskName(k)) dropped.push(k);
    else servers[k] = v;
  }
  return { servers, dropped };
}

/* ── the human-only config request → card → store ────────────────────────── */

export interface McpConfigRequest {
  server: string;
  config: McpUserConfig;
  at: string;
}

function requestPath(home: string, mod: string): string {
  return path.join(modDir(home, mod), MCP_CONFIG_REQUEST);
}

/** The CLI half: write the request (the kernel raises the card). Validates against the installed manifest first. */
export function requestMcpConfig(home: string, mod: DeskMod, server: string, config: unknown, at = new Date(), platform: string = process.platform): McpConfigRequest {
  const entry = (mod.manifest.provides?.mcp ?? []).find((e) => e.name === server);
  if (!entry) throw new TypeError(`${mod.name} declares no mcp server ${server}`);
  const checked = checkMcpOverride(entry, config, platform);
  const req: McpConfigRequest = { server, config: checked, at: at.toISOString() };
  const p = requestPath(home, mod.name);
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, `${JSON.stringify(req)}\n`, { mode: 0o600 });
  return req;
}

export function readMcpConfigRequest(home: string, mod: string): McpConfigRequest | null {
  try {
    const p = requestPath(home, mod);
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.size > 64 * 1024) return null;
    const v = JSON.parse(fs.readFileSync(p, 'utf8')) as McpConfigRequest;
    if (typeof v?.server !== 'string' || v.config === null || typeof v.config !== 'object') return null;
    return v;
  } catch {
    return null;
  }
}

function dropRequest(home: string, mod: string): void {
  try {
    fs.rmSync(requestPath(home, mod), { force: true });
  } catch {
    /* gone */
  }
}

/** The card lines of an effective launch: command, args, env NAMES (never values), the launch hash. */
export function launchCardLines(mod: string, server: string, launch: McpLaunch, key: Buffer): string[] {
  const args = launch.args.join(' '); // never truncated: checkMcpOverride refuses args over MCP_CARD_ARGS_MAX
  return [
    `Set how mod ${mod} launches its MCP server ${server}`,
    `command ${launch.command}`,
    `args ${args || '(none)'}`,
    `env names ${Object.keys(launch.env).sort().join(', ') || '(none)'} (values not shown)`,
    ...(Object.keys(launch.env).length ? ["env values are written to this session's mcp.json and readable by the session"] : []),
    `launch ${launchHashOf(launch, key)}`,
    'requested by: a request file under the Gnomon home (unverified; a session sandbox cannot write there)',
    'every new session in every repo starts this command as you, under the session sandbox',
  ];
}

/** The kernel half: raise a root-class card per pending request; `allow` writes the store. */
export class McpConfigCards {
  readonly #o: { home: string; broker: Pick<ApprovalBroker, 'raise' | 'card'>; mods: () => readonly DeskMod[]; requestedBy: string; launchKey: Buffer; platform?: string };
  readonly #raised = new Map<string, string>();
  #seen = new Map<string, string>();

  constructor(o: { home: string; broker: Pick<ApprovalBroker, 'raise' | 'card'>; mods: () => readonly DeskMod[]; requestedBy: string; launchKey: Buffer; platform?: string }) {
    this.#o = o;
  }

  async scan(): Promise<void> {
    const { home, broker } = this.#o;
    for (const [mod, id] of [...this.#raised]) {
      const c = broker.card(id);
      if (!c || c.state !== 'pending') this.#raised.delete(mod);
    }
    const mods = new Map(this.#o.mods().map((m) => [m.name, m]));
    for (const name of modNames(home)) {
      if (this.#raised.has(name)) continue;
      const req = readMcpConfigRequest(home, name);
      if (!req) continue;
      const stamp = JSON.stringify(req);
      if (this.#seen.get(name) === stamp) continue;
      const mod = mods.get(name);
      const entry = mod?.manifest.provides?.mcp?.find((e) => e.name === req.server);
      let launch: McpLaunch;
      try {
        if (!mod || !entry) throw new TypeError('not an installed server');
        checkMcpOverride(entry, req.config, this.#o.platform);
        launch = resolveMcpLaunch(entry, req.config);
      } catch {
        dropRequest(home, name); // refused: nothing the request says reaches a card
        continue;
      }
      this.#seen.set(name, stamp);
      const cardId = mintId('card');
      const server = serverNameOf(name, entry, mod.manifest.provides?.mcp ?? []);
      const card = await broker
        .raise({
          kind: 'grant',
          cardId,
          requestedBy: this.#o.requestedBy,
          attended: true,
          detail: { action: 'mod.mcp.config', name, server: req.server, launchHash: launchHashOf(launch, this.#o.launchKey), envNames: Object.keys(launch.env).sort(), requestedVia: 'request-file' },
          lines: launchCardLines(name, server, launch, this.#o.launchKey),
          decisions: ['allow', 'deny'],
          effect: async (decision) => {
            dropRequest(home, name);
            if (decision === 'allow') writeMcpOverride(home, name, req.server, req.config);
          },
        })
        .catch(() => null);
      if (card) this.#raised.set(name, card.cardId);
    }
  }
}
