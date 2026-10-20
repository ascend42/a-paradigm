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
 * an overridden command must be an absolute path. Claude Code spawns stdio MCP servers directly (no shell).
 */

import { createHash } from 'node:crypto';
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

const sha = (s: string): string => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;

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
export function checkMcpOverride(entry: ManifestMcp, override: unknown): McpUserConfig {
  const u = validateMcpUserConfig(entry, override);
  if (u.command !== undefined && !path.isAbsolute(u.command)) throw new TypeError(`mcp config ${entry.name}: command must be an absolute path`);
  return u;
}

export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The effective launch of one server under the store (an override that fails the checks is ignored: fail closed). */
export function effectiveLaunch(entry: ManifestMcp, override: unknown): { launch: McpLaunch; overridden: boolean } {
  if (override !== undefined) {
    try {
      checkMcpOverride(entry, override);
      return { launch: resolveMcpLaunch(entry, override), overridden: true };
    } catch {
      /* fall through to the manifest's own launch */
    }
  }
  return { launch: resolveMcpLaunch(entry), overridden: false };
}

/** The launch hash (logged on the config card; values hashed, never shown). */
export function launchHashOf(l: McpLaunch): string {
  const env = Object.keys(l.env).sort().map((k) => [k, l.env[k]]);
  return sha(JSON.stringify([l.command, l.args, env]));
}

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
  added: Array<{ mod: string; server: string; launchHash: string; overridden: boolean }>;
  skipped: Array<{ mod: string; server?: string; why: 'repo-muted' | 'name-taken' | 'needs-config' }>;
}

/**
 * Merge mods' provides.mcp into the repo's mcp servers. Pure (overrides passed in). The repo's entries come first and
 * are never replaced.
 */
export function mergeDeskMcp(repo: Record<string, unknown>, mods: readonly DeskMod[], opts: { overrides?: McpOverrides; repoMuted?: (mod: string) => boolean } = {}): PassthroughResult {
  const servers: Record<string, unknown> = { ...repo };
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
      const { launch, overridden } = effectiveLaunch(e, opts.overrides?.[m.name]?.[e.name]);
      // fail closed: a relative command (e.g. `neurons`, `constellation-mcp`) never launches
      if (!isAbsoluteCommand(launch.command)) {
        skipped.push({ mod: m.name, server, why: 'needs-config' });
        continue;
      }
      servers[server] = { type: 'stdio', command: launch.command, args: launch.args, ...(Object.keys(launch.env).length ? { env: launch.env } : {}) };
      added.push({ mod: m.name, server, launchHash: launchHashOf(launch), overridden });
    }
  }
  return { servers, added, skipped };
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
export function requestMcpConfig(home: string, mod: DeskMod, server: string, config: unknown, at = new Date()): McpConfigRequest {
  const entry = (mod.manifest.provides?.mcp ?? []).find((e) => e.name === server);
  if (!entry) throw new TypeError(`${mod.name} declares no mcp server ${server}`);
  const checked = checkMcpOverride(entry, config);
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
export function launchCardLines(mod: string, server: string, launch: McpLaunch): string[] {
  const args = launch.args.join(' ');
  return [
    `Set how mod ${mod} launches its MCP server ${server}`,
    `command ${launch.command}`,
    `args ${args.length > 300 ? `${args.slice(0, 299)}…` : args || '(none)'}`,
    `env names ${Object.keys(launch.env).sort().join(', ') || '(none)'} (values not shown)`,
    `launch ${launchHashOf(launch)}`,
    'every new session in every repo starts this command as you, under the session sandbox',
  ];
}

/** The kernel half: raise a root-class card per pending request; `allow` writes the store. */
export class McpConfigCards {
  readonly #o: { home: string; broker: Pick<ApprovalBroker, 'raise' | 'card'>; mods: () => readonly DeskMod[]; requestedBy: string };
  readonly #raised = new Map<string, string>();
  #seen = new Map<string, string>();

  constructor(o: { home: string; broker: Pick<ApprovalBroker, 'raise' | 'card'>; mods: () => readonly DeskMod[]; requestedBy: string }) {
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
        checkMcpOverride(entry, req.config);
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
          detail: { action: 'mod.mcp.config', name, server: req.server, launchHash: launchHashOf(launch), envNames: Object.keys(launch.env).sort() },
          lines: launchCardLines(name, server, launch),
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
