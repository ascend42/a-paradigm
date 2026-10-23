/**
 * @symbol #mcp-servers
 *
 * The human's own MCP servers in Gnomon sessions (T-2026-10-23-003). A Gnomon session runs `claude -p --mcp-config
 * <kernel mcp.json> --strict-mcp-config` (adapter.ts), so before this module only Gnomon's own servers (verified
 * distro + granted mods, #mcp-passthrough) reached it: the servers the human uses in every other project were
 * dropped and the agent fell back to the CLI. This module is the kernel half that brings them back, one human
 * decision per server, and keeps --strict-mcp-config (nothing reaches a session that this module did not compose).
 *
 * DISCOVERY (discoverMcpServers, read-only, fail-soft per file, ≤ 8 MiB per file, ≤ MAX_PER_SOURCE servers each):
 *   user     <userHome>/.claude.json mcpServers
 *   local    <userHome>/.claude.json projects[<repo>].mcpServers (the key matched at the realpath of the session cwd)
 *   project  <repo>/.mcp.json mcpServers: WRITTEN BY THE REPO, so a server from it is only ever turned on for that one
 *            repo, by an explicit human decision (never `all`, never automatically, never by a standing grant)
 *   plugin   every plugin enabled in <userHome>/.claude/settings.json enabledPlugins with a user-scope install in
 *            <userHome>/.claude/plugins/installed_plugins.json: its .claude-plugin/plugin.json mcpServers (an object,
 *            or a relative path to a JSON file) else <root>/.mcp.json. PLUGIN PATHS: the install root must realpath
 *            inside <userHome>/.claude/plugins (which the session profile write-denies, so a session cannot swap a
 *            plugin's code), a declared file must realpath inside the root, `${CLAUDE_PLUGIN_ROOT}` expands to that
 *            realpath and a `./x` command resolves inside it. Session name `plugin_<plugin>_<server>` (Claude Code's
 *            own tool naming, so mcp__plugin_<p>_<s>__* rules keep their meaning).
 *
 * WHAT A ROW SAYS (mcpServerRow; the GUI and status get ONLY rows): name, source, the plugin or repo, transport,
 * the resolved command and args (an arg that looks like a secret is shown hidden), an http/sse server's scheme, host
 * and path (never its query or userinfo), the env NAMES and header NAMES it carries, the names it takes from
 * `~/.gnomon/loop-env`, whether its command is a shell wrapper or a fetch-at-launch runner (npx, uvx, …), and the
 * problems that stop it being turned on. Values (env, headers, a hidden arg) never leave this module except into
 * the session's own mcp.json (0600, the session's private dir).
 *
 * PROBLEMS (a server with one cannot be turned on; the row says why):
 *   name            not [A-Za-z0-9][A-Za-z0-9_.-]{0,63}, or a reserved desk prefix (gnomon-, gm_, gx_; Aegis H1a)
 *   law-7           an env or header name that bills API credits or reroutes Claude (API_BILLING_ENV, *_BASE_URL,
 *                   the scrubbed names): the supervisor's law-7 scan of the session's mcp.json would refuse EVERY
 *                   session, so the server is refused instead
 *   env-name        a name loopEnvHazard refuses (NODE_OPTIONS, DYLD_*, LD_*, GNOMON_*, the kernel-set PATH/HOME …)
 *   remote          an http/sse URL that is not https (loopback excepted), an Anthropic host, an IP literal or a
 *                   private name (checkEgressHost, the egress rules mods follow)
 *   command         no command, a relative path outside a plugin, or a name not found on the session PATH
 *   plugin-path     a plugin root or declared file outside the plugin cache
 *   args            longer than the card can show in full (MCP_CARD_ARGS_MAX, never truncated)
 *   transport       a type other than stdio, http or sse
 *   first-party     the Paradigm plugin's own server: Gnomon runs the Paradigm MCP itself in every session
 *
 * NETWORK (measured 2026-10-23, macOS 15): SBPL cannot narrow one child of a sandboxed process — a nested
 * sandbox_apply is refused EPERM ("sandbox-exec: sandbox_apply: Operation not permitted") and `remote ip` filters
 * take only localhost or `*` as the host. So a stdio server runs inside the session's own profile with exactly the
 * session's files and network, no more; an http/sse server is a connection Claude Code itself opens from inside the
 * session. Chosen: nothing is ever spawned outside the session sandbox; the enable card names the host (http/sse)
 * and says the server has the session's network. A per-server egress proxy is future work (see the spec).
 */
import { createHmac } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson } from '@a-company/gnomon-contracts';
import { API_BILLING_ENV } from '../budget/billing.js';
import { checkEgressHost } from '../manifest/egress.js';
import { isScrubbed, loopEnvHazard } from '../runner/env.js';
import { readEnvFile } from '../loops/loop-env.js';
import { isAbsoluteCommand, isReservedDeskName, MCP_CARD_ARGS_MAX } from './mcp-passthrough.js';

export const MCP_FILE_MAX_BYTES = 8 * 1024 * 1024;
export const MAX_PER_SOURCE = 64;
/** The id of the first-party Paradigm MCP row (not a discovered server). */
export const FIRST_PARTY_PARADIGM = 'first-party:paradigm';
/** Its name in the session (the same as the plugin's, so mcp__paradigm__* means what it means everywhere). */
export const FIRST_PARTY_PARADIGM_NAME = 'paradigm';
/** The Paradigm plugin whose own server the first-party one replaces. */
export const PARADIGM_PLUGIN_RE = /^paradigm@/;
export const LOOP_ENV_SHOWN = '~/.gnomon/loop-env';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
/** Expanded by the kernel, never looked up in an env source. */
export const BUILTIN_REFS = Object.freeze(['CLAUDE_PLUGIN_ROOT', 'CLAUDE_PROJECT_DIR']);

export type McpSource = 'user' | 'local' | 'project' | 'plugin';
export type McpTransport = 'stdio' | 'http' | 'sse';
export type McpProblemCode = 'name' | 'law-7' | 'env-name' | 'remote' | 'command' | 'plugin-path' | 'args' | 'transport' | 'first-party';
export interface McpProblem {
  code: McpProblemCode;
  text: string;
}

/** A discovered server as the KERNEL holds it (values included). Never sent anywhere: see mcpServerRow. */
export interface McpServerDecl {
  /** `<source>:<owner>:<name>`: owner '' (user), the plugin id, or the repo realpath (local, project) */
  id: string;
  name: string;
  /** the name in the session's mcp.json */
  sessionName: string;
  source: McpSource;
  /** local / project: the repo realpath the server belongs to */
  repo?: string;
  plugin?: { id: string; version: string | null; root: string };
  transport: McpTransport;
  /** stdio: the command as declared (CLAUDE_PLUGIN_ROOT expanded) and as resolved (absolute) */
  command?: string;
  resolved?: string;
  args: string[];
  url?: string;
  env: Record<string, string>;
  headers: Record<string, string>;
  /** `${NAME}` references (not the built-ins), with a default when written `${NAME:-default}` */
  refs: Record<string, string | null>;
  shell: string | null;
  fetches: string | null;
  problems: McpProblem[];
}

/** What a row SAYS (status, GUI, card): names, never values. */
export interface McpServerRow {
  id: string;
  name: string;
  sessionName: string;
  source: McpSource;
  repo: string | null;
  plugin: { id: string; version: string | null } | null;
  transport: McpTransport;
  command: string | null;
  args: string[];
  /** http/sse: scheme://host[:port]/path (no query, no userinfo) */
  url: string | null;
  host: string | null;
  envNames: string[];
  headerNames: string[];
  /** names taken from ~/.gnomon/loop-env (the `${NAME}` references) */
  needs: string[];
  shell: string | null;
  fetches: string | null;
  problems: McpProblem[];
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A JSON file, or null (absent, not a regular file, too large, malformed): fail-soft. */
export function readJsonFile(file: string): unknown {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MCP_FILE_MAX_BYTES) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

const realOr = (p: string): string | null => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
};
const within = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/* ── secrets in args ─────────────────────────────────────────────────────── */

const SECRET_FLAG = /(key|token|secret|passw(or)?d|auth|bearer|credential|cookie|session)/i;
const SECRET_SHAPE = /^(sk-|sk_|pk_|rk_|ghp_|gho_|ghs_|github_pat_|glpat-|xox[abprs]-|AKIA|ya29\.|eyJ)[A-Za-z0-9._-]{8,}/;
export const HIDDEN_ARG = '(hidden: looks like a secret)';

/** Args as a row shows them: a value that looks like a secret (after a secret-named flag, or by its shape) is hidden. */
export function shownArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const eq = /^(--?[A-Za-z0-9_.-]+)=(.*)$/s.exec(a);
    if (eq && SECRET_FLAG.test(eq[1]!) && eq[2]!.length > 0) out.push(`${eq[1]}=${HIDDEN_ARG}`);
    else if (SECRET_SHAPE.test(a) || /^(Bearer|Basic)\s+\S+/i.test(a) || /:\/\/[^/@\s]+:[^/@\s]+@/.test(a)) out.push(HIDDEN_ARG);
    else if (i > 0 && /^--?[A-Za-z0-9_.-]+$/.test(args[i - 1]!) && SECRET_FLAG.test(args[i - 1]!) && !a.startsWith('-')) out.push(HIDDEN_ARG);
    else out.push(a);
  }
  return out;
}

/* ── launchers ───────────────────────────────────────────────────────────── */

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'cmd', 'powershell', 'pwsh', 'env']);
/** A command that is a shell (or `env`) or a script a shell interprets: the card says Gnomon cannot see what it starts. */
export function shellOf(command: string): string | null {
  const base = path.basename(command.replace(/\\/g, '/')).toLowerCase();
  const bare = base.replace(/\.exe$/, '');
  if (SHELLS.has(bare)) return bare;
  if (/\.(sh|bash|zsh|command|bat|cmd|ps1)$/.test(base)) return base;
  return null;
}

/** A runner that downloads what it runs at every launch (what runs can change without a new card). */
export function fetchesOf(command: string, args: readonly string[]): string | null {
  const bare = path.basename(command.replace(/\\/g, '/')).toLowerCase().replace(/\.(exe|cmd)$/, '');
  if (['npx', 'bunx', 'pnpx', 'uvx'].includes(bare)) return bare;
  const a0 = args.find((a) => !a.startsWith('-'));
  if ((bare === 'pnpm' || bare === 'yarn') && a0 === 'dlx') return `${bare} dlx`;
  if (bare === 'npm' && a0 === 'exec') return 'npm exec';
  if (bare === 'bun' && a0 === 'x') return 'bun x';
  if (bare === 'pipx' && a0 === 'run') return 'pipx run';
  if (bare === 'uv' && (a0 === 'tool' || args.includes('--with'))) return 'uv tool run';
  if (bare === 'docker' && a0 === 'run') return 'docker run';
  if (bare === 'deno' && args.some((a) => /^https?:\/\//.test(a))) return 'deno run (a URL)';
  return null;
}

/** Find a bare command on the session PATH (never the daemon's PATH); null when absent. */
export function resolveOnPath(cmd: string, dirs: readonly string[], platform: string = process.platform): string | null {
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const d of dirs) {
    if (!path.isAbsolute(d)) continue;
    for (const e of exts) {
      const p = path.join(d, `${cmd}${e}`);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && (platform === 'win32' || (st.mode & 0o111) !== 0)) return p;
      } catch {
        /* next */
      }
    }
  }
  return null;
}

/* ── references ──────────────────────────────────────────────────────────── */

function collectRefs(values: readonly string[], into: Record<string, string | null>): void {
  for (const v of values)
    for (const m of v.matchAll(REF_RE)) {
      const name = m[1]!;
      if (BUILTIN_REFS.includes(name)) continue;
      if (!(name in into) || into[name] === null) into[name] = m[2] ?? null;
    }
}

/** Replace `${NAME}` / `${NAME:-default}`; `missing` collects names with no value and no default. */
export function expandRefs(s: string, lookup: (name: string) => string | undefined, missing: Set<string>): string {
  return s.replace(REF_RE, (_all, name: string, def: string | undefined) => {
    const v = lookup(name);
    if (v !== undefined && v !== '') return v;
    if (def !== undefined) return def;
    missing.add(name);
    return '';
  });
}

/* ── one declaration ─────────────────────────────────────────────────────── */

export interface DeclContext {
  source: McpSource;
  owner: string;
  repo?: string;
  plugin?: { id: string; version: string | null; root: string };
  /** the session PATH dirs a bare command resolves against */
  pathDirs: readonly string[];
  platform?: string;
}

const strMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x;
  return out;
};

/** Read and classify one server entry. Never throws: anything odd is a problem on the row. */
export function declOf(name: string, raw: unknown, c: DeclContext): McpServerDecl {
  const platform = c.platform ?? process.platform;
  const problems: McpProblem[] = [];
  const e = isObj(raw) ? raw : {};
  const pluginName = c.plugin ? c.plugin.id.split('@')[0]! : '';
  const sessionName = c.source === 'plugin' ? `plugin_${pluginName}_${name}` : name;
  const t = typeof e.type === 'string' ? e.type : typeof e.url === 'string' && typeof e.command !== 'string' ? 'http' : 'stdio';
  const transport: McpTransport = t === 'http' || t === 'sse' || t === 'stdio' ? t : 'stdio';
  if (t !== transport) problems.push({ code: 'transport', text: `transport ${String(t).slice(0, 24)} is not one Gnomon composes (stdio, http, sse)` });
  if (!NAME_RE.test(name) || !NAME_RE.test(sessionName)) problems.push({ code: 'name', text: 'its name is not 1..64 letters, digits, dot, dash or underscore' });
  else if (isReservedDeskName(sessionName)) problems.push({ code: 'name', text: 'its name starts with a prefix Gnomon keeps for its own servers (gnomon-, gm_, gx_)' });
  const root = c.plugin?.root;
  const withRoot = (s: string): string => (root ? s.split('${CLAUDE_PLUGIN_ROOT}').join(root) : s);
  const args = Array.isArray(e.args) ? e.args.filter((a): a is string => typeof a === 'string').map(withRoot) : [];
  const env = Object.fromEntries(Object.entries(strMap(e.env)).map(([k, v]) => [k, withRoot(v)]));
  const headers = strMap(e.headers);
  const d: McpServerDecl = { id: `${c.source}:${c.owner}:${name}`, name, sessionName, source: c.source, ...(c.repo ? { repo: c.repo } : {}), ...(c.plugin ? { plugin: c.plugin } : {}), transport, args, env, headers, refs: {}, shell: null, fetches: null, problems };
  const law7 = (k: string): boolean => API_BILLING_ENV.includes(k.toUpperCase()) || /_BASE_URL$/i.test(k) || isScrubbed(k);
  for (const k of [...Object.keys(env), ...Object.keys(headers)]) {
    if (law7(k)) problems.push({ code: 'law-7', text: `it sets ${k.slice(0, 64)}, a name that bills API credits or reroutes Claude (law 7: every session would be refused)` });
  }
  for (const k of Object.keys(env)) {
    const why = law7(k) ? null : loopEnvHazard(k);
    if (why) problems.push({ code: 'env-name', text: `env ${k.slice(0, 64)} is refused: ${why}` });
  }
  if (transport === 'stdio') {
    const cmd0 = typeof e.command === 'string' ? withRoot(e.command) : '';
    d.command = cmd0;
    if (!cmd0) problems.push({ code: 'command', text: 'it names no command' });
    else if (cmd0.includes('${')) problems.push({ code: 'command', text: 'its command takes a variable; Gnomon runs only a command it can show' });
    else if (isAbsoluteCommand(cmd0)) d.resolved = cmd0;
    else if (/[\\/]/.test(cmd0)) {
      const p = root ? path.resolve(root, cmd0) : null;
      if (p && within(realOr(p) ?? p, root!)) d.resolved = p;
      else problems.push({ code: root ? 'plugin-path' : 'command', text: root ? 'its command is outside the plugin' : 'its command is a relative path; Gnomon runs an absolute path or a name on the session PATH' });
    } else {
      const found = resolveOnPath(cmd0, c.pathDirs, platform);
      if (found) d.resolved = found;
      else problems.push({ code: 'command', text: `${cmd0.slice(0, 64)} is not on the session PATH (${c.pathDirs.join(platform === 'win32' ? ';' : ':').slice(0, 200)})` });
    }
    if (d.resolved && root && d.resolved.startsWith(root) && !within(realOr(d.resolved) ?? d.resolved, root)) problems.push({ code: 'plugin-path', text: 'its command resolves outside the plugin' });
    d.shell = cmd0 ? shellOf(d.resolved ?? cmd0) : null;
    d.fetches = cmd0 ? fetchesOf(d.resolved ?? cmd0, args) : null;
    if (shownArgs(args).join(' ').length > MCP_CARD_ARGS_MAX) problems.push({ code: 'args', text: `its args are longer than the card can show (${MCP_CARD_ARGS_MAX} characters)` });
  } else {
    const url = typeof e.url === 'string' ? e.url : '';
    d.url = url;
    let u: URL | null = null;
    try {
      u = new URL(url.replace(REF_RE, 'x'));
    } catch {
      u = null;
    }
    if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) problems.push({ code: 'remote', text: 'its URL is not an http(s) URL' });
    else {
      const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      const loop = host === 'localhost' || host === '::1' || /^127\./.test(host);
      if (!loop) {
        const v = checkEgressHost(host);
        if (!v.ok) problems.push({ code: 'remote', text: v.why === 'anthropic' ? `${host} is an Anthropic host (law 7: the subscription path is the kernel's)` : `${host.slice(0, 80)} is not a public host name (${v.why})` });
        else if (u.protocol !== 'https:') problems.push({ code: 'remote', text: `${host.slice(0, 80)} is reached over plain http; Gnomon connects remote servers over https only` });
      }
    }
  }
  collectRefs([...(d.command ? [d.command] : []), ...args, ...(d.url ? [d.url] : []), ...Object.values(env), ...Object.values(headers)], d.refs);
  for (const n of Object.keys(d.refs)) {
    const why = loopEnvHazard(n);
    if (why) problems.push({ code: 'env-name', text: `it takes ${n.slice(0, 64)}, which is refused: ${why}` });
  }
  if (c.source === 'plugin' && c.plugin && PARADIGM_PLUGIN_RE.test(c.plugin.id) && name === FIRST_PARTY_PARADIGM_NAME) {
    problems.push({ code: 'first-party', text: 'Gnomon runs the Paradigm MCP itself in every session (first-party), so this plugin copy stays off' });
  }
  return d;
}

/** The row a declaration may show (names only). */
export function mcpServerRow(d: McpServerDecl): McpServerRow {
  let url: string | null = null;
  let host: string | null = null;
  if (d.url !== undefined) {
    try {
      const u = new URL(d.url.replace(REF_RE, 'x'));
      host = u.hostname;
      url = `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`;
    } catch {
      url = null;
    }
  }
  return {
    id: d.id,
    name: d.name,
    sessionName: d.sessionName,
    source: d.source,
    repo: d.repo ?? null,
    plugin: d.plugin ? { id: d.plugin.id, version: d.plugin.version } : null,
    transport: d.transport,
    command: d.transport === 'stdio' ? (d.resolved ?? d.command ?? null) : null,
    args: shownArgs(d.args),
    url,
    host,
    envNames: Object.keys(d.env).sort(),
    headerNames: Object.keys(d.headers).sort(),
    needs: Object.keys(d.refs).sort(),
    shell: d.shell,
    fetches: d.fetches,
    problems: d.problems.map((p) => ({ ...p })),
  };
}

/**
 * The launch hash: an HMAC under the kernel-held key (deskLaunchKey) over everything that decides what runs — the
 * source and owner, the transport, the resolved command, the args, the URL, the env and header blocks WITH their
 * declared values, and the plugin root. A logged hash never lets anyone confirm a guessed value (Aegis S1 M2). A
 * value taken from ~/.gnomon/loop-env is NOT in it (editing a secret there needs no new card, like loops).
 */
export function declHash(d: McpServerDecl, key: Buffer): string {
  const sorted = (m: Record<string, string>) => Object.keys(m).sort().map((k) => [k, m[k]]);
  const body = canonicalJson({ id: d.id, transport: d.transport, command: d.resolved ?? d.command ?? null, args: d.args, url: d.url ?? null, env: sorted(d.env), headers: sorted(d.headers), root: d.plugin?.root ?? null });
  return `hmac-sha256:${createHmac('sha256', key).update(body, 'utf8').digest('hex')}`;
}

/* ── discovery ───────────────────────────────────────────────────────────── */

export interface DiscoverInput {
  userHome: string;
  /** the session cwd (and worktree) whose local and project servers to include */
  repos?: readonly string[];
  pathDirs: readonly string[];
  platform?: string;
}

function serversOf(v: unknown): Array<[string, unknown]> {
  const m = isObj(v) && isObj(v.mcpServers) ? v.mcpServers : null;
  return m ? Object.entries(m).slice(0, MAX_PER_SOURCE) : [];
}

/** The enabled plugins with a user-scope install inside the plugin cache, and their MCP declarations. */
export function pluginServers(userHome: string, pathDirs: readonly string[], platform: string = process.platform): McpServerDecl[] {
  const settings = readJsonFile(path.join(userHome, '.claude', 'settings.json'));
  const enabled = isObj(settings) && isObj(settings.enabledPlugins) ? Object.entries(settings.enabledPlugins).filter(([, on]) => on === true).map(([id]) => id) : [];
  if (!enabled.length) return [];
  const installed = readJsonFile(path.join(userHome, '.claude', 'plugins', 'installed_plugins.json'));
  const plugins = isObj(installed) && isObj(installed.plugins) ? installed.plugins : {};
  const cache = realOr(path.join(userHome, '.claude', 'plugins'));
  const out: McpServerDecl[] = [];
  for (const id of enabled.sort().slice(0, MAX_PER_SOURCE)) {
    const entries = Array.isArray(plugins[id]) ? (plugins[id] as unknown[]) : [];
    const e = entries.find((x) => isObj(x) && x.scope === 'user' && typeof x.installPath === 'string') as Record<string, unknown> | undefined;
    if (!e) continue;
    const version = typeof e.version === 'string' ? e.version : null;
    const root = realOr(String(e.installPath));
    /** a plugin whose MCP declaration cannot be trusted shows as ONE row with the reason (never launched) */
    const bad = (why: string): void => {
      const d = declOf(id.split('@')[0]!, {}, { source: 'plugin', owner: id, plugin: { id, version, root: root ?? String(e.installPath) }, pathDirs, platform });
      d.problems.push({ code: 'plugin-path', text: why });
      out.push(d);
    };
    if (!root) continue; // not installed any more: nothing to show
    if (!cache || !within(root, cache)) {
      bad('its install path is outside ~/.claude/plugins');
      continue;
    }
    const manifest = readJsonFile(path.join(root, '.claude-plugin', 'plugin.json'));
    let decl: unknown = null;
    const m = isObj(manifest) ? manifest.mcpServers : undefined;
    if (isObj(m)) decl = { mcpServers: m };
    else if (typeof m === 'string') {
      const f = realOr(path.resolve(root, m));
      if (!f || !within(f, root)) {
        bad('its plugin.json names an MCP file outside the plugin');
        continue;
      }
      const j = readJsonFile(f);
      decl = isObj(j) && isObj(j.mcpServers) ? j : isObj(j) ? { mcpServers: j } : null;
    } else {
      const j = readJsonFile(path.join(root, '.mcp.json'));
      decl = isObj(j) && isObj(j.mcpServers) ? j : isObj(j) ? { mcpServers: j } : null;
    }
    for (const [name, raw] of serversOf(decl)) out.push(declOf(name, raw, { source: 'plugin', owner: id, plugin: { id, version, root }, pathDirs, platform }));
  }
  return out;
}

/**
 * Every server the human's Claude Code would load for these repos: user, plugin, then for each repo its local
 * (~/.claude.json projects) and project (.mcp.json) servers. Fail-soft: an unreadable file contributes nothing.
 */
export function discoverMcpServers(i: DiscoverInput): McpServerDecl[] {
  const platform = i.platform ?? process.platform;
  const cfg = readJsonFile(path.join(i.userHome, '.claude.json'));
  const out: McpServerDecl[] = [];
  for (const [name, raw] of serversOf(cfg)) out.push(declOf(name, raw, { source: 'user', owner: '', pathDirs: i.pathDirs, platform }));
  out.push(...pluginServers(i.userHome, i.pathDirs, platform));
  const projects = isObj(cfg) && isObj(cfg.projects) ? cfg.projects : {};
  const seen = new Set<string>();
  for (const r of i.repos ?? []) {
    const repo = realOr(r) ?? path.resolve(r);
    if (seen.has(repo)) continue;
    seen.add(repo);
    for (const [key, p] of Object.entries(projects)) {
      if ((realOr(key) ?? path.resolve(key)) !== repo) continue;
      for (const [name, raw] of serversOf(p)) out.push(declOf(name, raw, { source: 'local', owner: repo, repo, pathDirs: i.pathDirs, platform }));
    }
    for (const [name, raw] of serversOf(readJsonFile(path.join(repo, '.mcp.json')))) out.push(declOf(name, raw, { source: 'project', owner: repo, repo, pathDirs: i.pathDirs, platform }));
  }
  return out;
}

/* ── the first-party Paradigm MCP ────────────────────────────────────────── */

export interface FirstPartyLaunch {
  available: true;
  /** the node that runs it (the kernel's own, realpath) */
  node: string;
  /** the package dir (write-denied in every session) and its paradigm-mcp entry */
  dir: string;
  entry: string;
  version: string | null;
}
export type FirstPartyResolution = FirstPartyLaunch | { available: false; why: string };

export const PARADIGM_INSTALL_HINT = 'install Paradigm (npm install -g @a-company/paradigm) and open a new session';

/** Where a global @a-company/paradigm can live: beside the kernel's node, then the usual npm prefixes. */
export function paradigmCandidates(o: { execPath: string; userHome: string; platform?: string; appData?: string }): string[] {
  const platform = o.platform ?? process.platform;
  const node = realOr(o.execPath) ?? o.execPath;
  const prefix = path.dirname(path.dirname(node));
  const roots = platform === 'win32'
    ? [path.join(path.dirname(node), 'node_modules'), ...(o.appData ? [path.join(o.appData, 'npm', 'node_modules')] : [])]
    : [path.join(prefix, 'lib', 'node_modules'), '/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules', path.join(o.userHome, '.npm-global', 'lib', 'node_modules'), path.join(o.userHome, '.local', 'lib', 'node_modules')];
  return [...new Set(roots.map((r) => path.join(r, '@a-company', 'paradigm')))];
}

/** The installed @a-company/paradigm whose package.json bin names paradigm-mcp inside the package. */
export function resolveFirstPartyParadigm(o: { execPath: string; userHome: string; platform?: string; appData?: string; candidates?: readonly string[] }): FirstPartyResolution {
  const node = realOr(o.execPath);
  if (!node) return { available: false, why: 'the kernel cannot name its own node' };
  for (const c of o.candidates ?? paradigmCandidates(o)) {
    const dir = realOr(c);
    if (!dir) continue;
    const pkg = readJsonFile(path.join(dir, 'package.json'));
    if (!isObj(pkg) || pkg.name !== '@a-company/paradigm' || !isObj(pkg.bin) || typeof pkg.bin['paradigm-mcp'] !== 'string') continue;
    const entry = realOr(path.resolve(dir, pkg.bin['paradigm-mcp']));
    if (!entry || !within(entry, dir)) continue;
    return { available: true, node, dir, entry, version: typeof pkg.version === 'string' ? pkg.version : null };
  }
  return { available: false, why: `no @a-company/paradigm found: ${PARADIGM_INSTALL_HINT}` };
}

/* ── composing one session's servers ─────────────────────────────────────── */

export interface ComposeInput {
  decls: readonly McpServerDecl[];
  /** is this server turned on for this session's repo, at this launch hash? */
  enabled: (d: McpServerDecl, hash: string) => 'on' | 'off' | 'changed';
  launchKey: Buffer;
  /** the session cwd (expands ${CLAUDE_PROJECT_DIR}) */
  cwd: string;
  /** the first-party Paradigm MCP, when on and available */
  firstParty?: FirstPartyLaunch | null;
  /** the human's env values for `${NAME}` (read by the kernel from ~/.gnomon/loop-env); never logged */
  envValue: (name: string) => string | undefined;
}

export interface ComposeResult {
  servers: Record<string, unknown>;
  added: Array<{ id: string; server: string; source: McpSource | 'first-party'; launchHash: string | null }>;
  skipped: Array<{ id: string; server: string; why: 'changed' | 'env-missing' | 'problem' | 'name-taken'; names?: string[] }>;
}

/** The session's own servers: the first-party Paradigm MCP, then every enabled server whose launch still matches. */
export function composeSessionMcp(i: ComposeInput): ComposeResult {
  const servers: Record<string, unknown> = {};
  const added: ComposeResult['added'] = [];
  const skipped: ComposeResult['skipped'] = [];
  if (i.firstParty) {
    servers[FIRST_PARTY_PARADIGM_NAME] = { type: 'stdio', command: i.firstParty.node, args: [i.firstParty.entry, i.cwd] };
    added.push({ id: FIRST_PARTY_PARADIGM, server: FIRST_PARTY_PARADIGM_NAME, source: 'first-party', launchHash: null });
  }
  // Claude Code's own precedence on a shared name: local, then project, then user (plugins are namespaced)
  const rank: Record<McpSource, number> = { local: 0, project: 1, user: 2, plugin: 3 };
  for (const d of [...i.decls].sort((a, b) => rank[a.source] - rank[b.source])) {
    const hash = declHash(d, i.launchKey);
    const state = i.enabled(d, hash);
    if (state === 'off') continue;
    if (state === 'changed') {
      skipped.push({ id: d.id, server: d.sessionName, why: 'changed' });
      continue;
    }
    if (d.problems.length) {
      skipped.push({ id: d.id, server: d.sessionName, why: 'problem' });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(servers, d.sessionName)) {
      skipped.push({ id: d.id, server: d.sessionName, why: 'name-taken' });
      continue;
    }
    const missing = new Set<string>();
    const lookup = (n: string): string | undefined => (n === 'CLAUDE_PROJECT_DIR' ? i.cwd : i.envValue(n));
    const x = (s: string): string => expandRefs(s, lookup, missing);
    const env = Object.fromEntries(Object.entries(d.env).map(([k, v]) => [k, x(v)]));
    const headers = Object.fromEntries(Object.entries(d.headers).map(([k, v]) => [k, x(v)]));
    const entry: Record<string, unknown> =
      d.transport === 'stdio'
        ? { type: 'stdio', command: d.resolved!, args: d.args.map(x), ...(Object.keys(env).length ? { env } : {}) }
        : { type: d.transport, url: x(d.url!), ...(Object.keys(headers).length ? { headers } : {}) };
    if (missing.size) {
      skipped.push({ id: d.id, server: d.sessionName, why: 'env-missing', names: [...missing].sort() });
      continue;
    }
    servers[d.sessionName] = entry;
    added.push({ id: d.id, server: d.sessionName, source: d.source, launchHash: hash });
  }
  return { servers, added, skipped };
}

/** The human's values from `<home>/loop-env` (owner-only, never a symlink), read at spawn; absent ⇒ none. */
export function loopEnvValues(home: string): { values: Map<string, string>; refused: string | null } {
  const r = readEnvFile(path.join(home, 'loop-env'), LOOP_ENV_SHOWN, { owner: true });
  if (r.ok) return { values: r.vars, refused: null };
  return { values: new Map(), refused: r.absent ? null : r.reason };
}
