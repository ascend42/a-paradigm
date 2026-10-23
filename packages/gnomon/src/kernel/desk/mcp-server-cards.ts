/**
 * @symbol #mcp-servers
 *
 * The human's decisions about their MCP servers (T-2026-10-23-003): which discovered servers a Gnomon session gets,
 * kept by the kernel, decided only by the human.
 *
 *   store      <home>/desk/mcp-servers.json (0600, written atomically, never through a link). The session profile
 *              read- and write-denies the whole Gnomon home, so no session can read or plant an entry. Each entry
 *              is {id, scope: 'all' | {repo: <realpath>}, launchHash, at, cardId}: a server is on for a session only
 *              while its CURRENT declaration hashes to the entry's launchHash (a changed command, args, URL, env or
 *              header block, or plugin root shows as `changed` and is not launched until turned on again).
 *   enable     request.mcp.enable{id, scope:'all'} | {id, scope:'repo', repo} from the human on a gui or device
 *              connection only (dispatch.ts) raises ONE `grant` card, detail.action 'mcp.enable' (the ⊙ gnomon card
 *              family): root class (fresh presence AND the root key), hand-only (never voice) and never standing
 *              ('grant' is in NEVER_STANDING_KINDS; TD-2026-10-23-815's standing tuples are a closed contract list
 *              and no tuple covers turning on code that runs in every session). Its rows: the decision row only
 *              (row table 'grant'). prepare re-reads the declaration inside the one touch: a different launch hash
 *              or a new problem refuses "the server changed while the card was open". Allow writes the entry.
 *              A project server (the repo's own .mcp.json) and a local one (~/.claude.json projects) take scope
 *              'repo' for their own repo only: never `all`, never automatic.
 *   disable    request.mcp.disable{id[, scope, repo]}: a narrowing, so notify-and-proceed with no card.
 *   first party  the Paradigm MCP is on by default in every session; {id:'first-party:paradigm'} turns it off or
 *              back on (back to the default) with no card.
 *   Windows    discovery and rows work; turning a server on is refused (a root-class decision needs the root key,
 *              which lives in the Mac helper in 8.0); the first-party Paradigm MCP still runs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mintId } from '@a-company/gnomon-contracts';
import type { ApprovalBroker } from '../broker/broker.js';
import type { PolicyPath } from '../manifest/policy.js';
import { RpcRefusal } from '../socket/rpc.js';
import { composeSessionMcp, declHash, discoverMcpServers, FIRST_PARTY_PARADIGM, FIRST_PARTY_PARADIGM_NAME, LOOP_ENV_SHOWN, loopEnvValues, mcpServerRow, PARADIGM_INSTALL_HINT, type ComposeResult, type FirstPartyResolution, type McpServerDecl, type McpServerRow } from './mcp-servers.js';

export const MCP_SERVERS_SCHEMA = 'gnomon-mcp-servers:v1' as const;
export const MCP_ENABLE_REQUEST = 'request.mcp.enable' as const;
export const MCP_DISABLE_REQUEST = 'request.mcp.disable' as const;
export const MCP_REQUESTS: readonly string[] = Object.freeze([MCP_ENABLE_REQUEST, MCP_DISABLE_REQUEST]);
export const MCP_ENABLE_CARD_TTL_MS = 24 * 3600 * 1000;
export const MCP_CHANGED_WHILE_OPEN = 'the server changed while the card was open: ask again';
const STORE_MAX_BYTES = 512 * 1024;
const MAX_ENTRIES = 512;

export type McpScope = 'all' | { repo: string };
export interface McpEnabledEntry {
  id: string;
  scope: McpScope;
  launchHash: string;
  at: string;
  cardId: string;
}
export interface McpServersStore {
  enabled: McpEnabledEntry[];
  firstParty: { paradigm: 'on' | 'off' };
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const realOr = (p: string): string => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
const sameScope = (a: McpScope, b: McpScope): boolean => (a === 'all' ? b === 'all' : b !== 'all' && a.repo === b.repo);

export function mcpServersPath(home: string): string {
  return path.join(home, 'desk', 'mcp-servers.json');
}

/** The store, or the default (nothing on, Paradigm on) when absent or unreadable. Entries are re-checked at use. */
export function readMcpServersStore(home: string): McpServersStore {
  const empty: McpServersStore = { enabled: [], firstParty: { paradigm: 'on' } };
  try {
    const p = mcpServersPath(home);
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.size > STORE_MAX_BYTES) return empty;
    const v = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    if (v.schema !== MCP_SERVERS_SCHEMA) return empty;
    const enabled = (Array.isArray(v.enabled) ? v.enabled : []).filter(
      (e): e is McpEnabledEntry => isObj(e) && typeof e.id === 'string' && typeof e.launchHash === 'string' && typeof e.cardId === 'string' && typeof e.at === 'string' && (e.scope === 'all' || (isObj(e.scope) && typeof e.scope.repo === 'string' && path.isAbsolute(e.scope.repo))),
    );
    const fp = isObj(v.firstParty) && v.firstParty.paradigm === 'off' ? 'off' : 'on';
    return { enabled: enabled.slice(0, MAX_ENTRIES), firstParty: { paradigm: fp } };
  } catch {
    return empty;
  }
}

export function writeMcpServersStore(home: string, s: McpServersStore): void {
  const p = mcpServersPath(home);
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  try {
    if (fs.lstatSync(p).isSymbolicLink()) fs.rmSync(p); // never write through a link
  } catch {
    /* absent */
  }
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ schema: MCP_SERVERS_SCHEMA, enabled: s.enabled.slice(0, MAX_ENTRIES), firstParty: s.firstParty }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, p);
}

/**
 * Is this server on for a session in `repo` (the session cwd's realpath) at this launch hash? A project or local
 * server counts only an entry scoped to ITS repo (an `all` entry for one never applies: fail closed).
 */
export function enabledState(store: McpServersStore, d: Pick<McpServerDecl, 'id' | 'source' | 'repo'>, hash: string, repo: string): 'on' | 'off' | 'changed' {
  const repoBound = d.source === 'project' || d.source === 'local';
  const hits = store.enabled.filter((e) => e.id === d.id && (e.scope === 'all' ? !repoBound : e.scope.repo === repo && (!repoBound || d.repo === repo)));
  if (!hits.length) return 'off';
  return hits.some((e) => e.launchHash === hash) ? 'on' : 'changed';
}

const hhmm = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const SOURCE_TEXT: Readonly<Record<McpServerRow['source'], string>> = Object.freeze({
  user: 'your ~/.claude.json (every project)',
  local: 'your ~/.claude.json, for this folder only',
  project: "this repo's .mcp.json (written by the repo, not by you)",
  plugin: 'a Claude Code plugin you enabled',
});

/** The enable card's lines: title, the kernel line, then what turns on. Names only, never a value. */
export function mcpEnableCardLines(r: McpServerRow, f: { scope: McpScope; via: 'settings' | 'terminal'; at: number; launchHash: string; pluginRoot?: string | null }): string[] {
  const where = f.scope === 'all' ? 'for all your repos' : `in ${path.basename(f.scope.repo)}`;
  const anyValue = r.envNames.length + r.headerNames.length + r.needs.length > 0;
  return [
    `Turn on MCP server ${r.name} ${where}`,
    `asked from ${f.via === 'settings' ? 'Settings' : 'the terminal'} · ${hhmm(f.at)} · applies to new sessions`,
    `from ${SOURCE_TEXT[r.source]}${r.plugin ? ` · ${r.plugin.id}${r.plugin.version ? ` ${r.plugin.version}` : ''}${f.pluginRoot ? ` at ${f.pluginRoot}` : ''}` : ''}`,
    ...(f.scope !== 'all' ? [`folder ${f.scope.repo}`] : []),
    ...(r.transport === 'stdio'
      ? [`runs ${r.command ?? '?'}${r.args.length ? ` ${r.args.join(' ')}` : ''}`, "inside the session's sandbox: the same files and network as the session, nothing more"]
      : [`connects to ${r.host ?? '?'} (${r.url ?? r.transport}) from the session: tool calls send data there`]),
    ...(r.shell ? [`runs a shell (${r.shell}): Gnomon cannot see what that command line starts`] : []),
    ...(r.fetches ? [`downloads what it runs at every launch (${r.fetches}): what runs can change without a new card`] : []),
    ...(r.envNames.length ? [`env names ${r.envNames.join(', ')} (values not shown)`] : []),
    ...(r.headerNames.length ? [`header names ${r.headerNames.join(', ')} (values not shown)`] : []),
    ...(r.needs.length ? [`takes ${r.needs.join(', ')} from ${LOOP_ENV_SHOWN}`] : []),
    ...(anyValue ? ["env and header values are written to this session's mcp.json and readable by the session"] : []),
    "its tools ask like any tool: cards and Always rules apply; nothing is allowed automatically, and its tool descriptions are the server's words, not Gnomon's",
    ...(r.source === 'project' ? ["this repo's .mcp.json is the repo's code: allow only if you trust this repo"] : []),
    `launch ${f.launchHash}`,
    'Allow takes the root key and your presence (Touch ID or your Mac password) · never standing, never by voice; deny changes nothing',
  ];
}

export interface McpAsker {
  connId: string;
  principal: string | undefined;
  principalClass: string;
  credential: string | undefined;
}

export interface McpServersOptions {
  home: string;
  broker: Pick<ApprovalBroker, 'raise' | 'card'>;
  userHome: string;
  /** the session PATH dirs (a bare command resolves on them, never on the daemon's PATH) */
  pathDirs: () => readonly string[];
  launchKey: Buffer;
  firstParty: () => FirstPartyResolution;
  /** the live sessions' folders (status lists their local and project servers) */
  liveRepos?: () => Array<{ cwd: string; hsid: string }>;
  platform?: string;
  clock?: () => number;
  /** daemon events (names, never values) */
  emit?: (e: Record<string, unknown>) => void;
}

const bad = (field: string, msg: string, data: Record<string, unknown> = {}): RpcRefusal => new RpcRefusal('BAD_REQUEST', 'bad-params', `#mcp-servers: ${msg}`, { field, ...data });

/** The kernel half: status.mcp, the human's requests, and each session's composed servers. */
export class McpServers {
  readonly #o: McpServersOptions;
  /** `${id}|${scope}` → pending cardId */
  readonly #pending = new Map<string, { cardId: string; id: string; scope: McpScope }>();

  constructor(o: McpServersOptions) {
    this.#o = o;
  }

  #platform(): string {
    return this.#o.platform ?? process.platform;
  }

  #discover(repos: readonly string[]): McpServerDecl[] {
    return discoverMcpServers({ userHome: this.#o.userHome, repos, pathDirs: this.#o.pathDirs(), platform: this.#platform() });
  }

  #pendingList(): Array<{ cardId: string; id: string; scope: McpScope }> {
    for (const [k, p] of [...this.#pending]) {
      const c = this.#o.broker.card?.(p.cardId);
      if (!c || c.state !== 'pending') this.#pending.delete(k);
    }
    return [...this.#pending.values()];
  }

  /** The write-denies every session gets for the first-party server (its package dir and node). */
  sessionDenies(): PolicyPath[] {
    const fp = this.#o.firstParty();
    if (!fp.available || readMcpServersStore(this.#o.home).firstParty.paradigm === 'off') return [];
    return [
      { path: fp.dir, match: 'subpath', class: 'binary' },
      { path: fp.node, match: 'literal', class: 'binary' },
    ];
  }

  /** The session's own servers (first-party + enabled) for a session opened in `cwd`. */
  compose(ctx: { hsid: string; cwd: string; worktree?: string }): ComposeResult {
    const store = readMcpServersStore(this.#o.home);
    const repo = realOr(ctx.cwd);
    const fp = store.firstParty.paradigm === 'on' ? this.#o.firstParty() : null;
    const decls = this.#discover([ctx.cwd]);
    const needsEnv = decls.some((d) => Object.keys(d.refs).length > 0 && enabledState(store, d, declHash(d, this.#o.launchKey), repo) === 'on');
    const env = needsEnv ? loopEnvValues(this.#o.home) : { values: new Map<string, string>(), refused: null };
    if (env.refused) this.#o.emit?.({ event: 'mcp.user.env-refused', hsid: ctx.hsid, reason: env.refused });
    const r = composeSessionMcp({ decls, enabled: (d, hash) => enabledState(store, d, hash, repo), launchKey: this.#o.launchKey, cwd: ctx.cwd, firstParty: fp && fp.available ? fp : null, envValue: (n) => env.values.get(n) });
    if (fp && !fp.available) this.#o.emit?.({ event: 'mcp.first-party.unavailable', hsid: ctx.hsid, why: fp.why });
    for (const a of r.added) this.#o.emit?.({ event: 'mcp.user.added', hsid: ctx.hsid, id: a.id, server: a.server, source: a.source, launchHash: a.launchHash });
    for (const s of r.skipped) this.#o.emit?.({ event: 'mcp.user.skipped', hsid: ctx.hsid, id: s.id, server: s.server, why: s.why, ...(s.names ? { names: s.names } : {}) });
    return r;
  }

  status(): Record<string, unknown> {
    const store = readMcpServersStore(this.#o.home);
    const fp = this.#o.firstParty();
    const key = this.#o.launchKey;
    const state = (d: McpServerDecl) => {
      const hash = declHash(d, key);
      const mine = store.enabled.filter((e) => e.id === d.id);
      return { ...mcpServerRow(d), on: { all: mine.some((e) => e.scope === 'all' && e.launchHash === hash), repos: mine.filter((e) => e.scope !== 'all' && e.launchHash === hash).map((e) => (e.scope as { repo: string }).repo) }, changed: mine.some((e) => e.launchHash !== hash) };
    };
    const live = new Map<string, string[]>();
    for (const l of this.#o.liveRepos?.() ?? []) {
      const r = realOr(l.cwd);
      live.set(r, [...(live.get(r) ?? []), l.hsid]);
    }
    const all = this.#discover([...live.keys()]);
    return {
      offered: true,
      platform: this.#platform(),
      unsupported: this.#platform() === 'win32' ? 'platform' : null,
      envFile: LOOP_ENV_SHOWN,
      firstParty: { id: FIRST_PARTY_PARADIGM, name: FIRST_PARTY_PARADIGM_NAME, on: store.firstParty.paradigm === 'on', available: fp.available, ...(fp.available ? { version: fp.version, dir: fp.dir } : { why: fp.why }) },
      servers: all.filter((d) => d.source === 'user' || d.source === 'plugin').map(state),
      repos: [...live].map(([repo, hsids]) => ({ repo, folder: path.basename(repo), hsids, servers: all.filter((d) => d.repo === repo).map(state) })),
      pending: this.#pendingList().map((p) => ({ cardId: p.cardId, id: p.id, scope: p.scope === 'all' ? 'all' : 'repo', repo: p.scope === 'all' ? null : p.scope.repo })),
    };
  }

  #human(asker: McpAsker, kind: string): void {
    if (asker.principalClass !== 'human' || !asker.principal || (asker.credential !== 'gui' && asker.credential !== 'device')) {
      throw new RpcRefusal('FORBIDDEN', 'matrix', `${kind} is the human's, on a gui or device connection (never voice, an agent or a session)`);
    }
  }

  #parse(kind: string, payload: unknown): { id: string; scope: McpScope | null } {
    if (!isObj(payload)) throw bad('id', `${kind} takes {id, scope?: 'all' | 'repo', repo?}`);
    for (const k of Object.keys(payload)) if (!['id', 'scope', 'repo'].includes(k)) throw bad(k, `unknown field ${k.slice(0, 32)}`);
    if (typeof payload.id !== 'string' || payload.id.length === 0 || payload.id.length > 2048) throw bad('id', 'id names one server (status.mcp)');
    if (payload.scope === undefined) return { id: payload.id, scope: null };
    if (payload.scope === 'all') return { id: payload.id, scope: 'all' };
    if (payload.scope !== 'repo') throw bad('scope', "scope is 'all' or 'repo'");
    if (typeof payload.repo !== 'string' || !path.isAbsolute(payload.repo)) throw bad('repo', 'a repo scope names the folder (an absolute path)');
    const repo = realOr(payload.repo);
    try {
      if (!fs.statSync(repo).isDirectory()) throw new Error('not a dir');
    } catch {
      throw bad('repo', 'the folder does not exist');
    }
    return { id: payload.id, scope: { repo } };
  }

  async request(asker: McpAsker, kind: string, payload: unknown): Promise<unknown> {
    this.#human(asker, kind);
    const p = this.#parse(kind, payload);
    if (kind === MCP_DISABLE_REQUEST) return this.#disable(p.id, p.scope);
    if (kind !== MCP_ENABLE_REQUEST) throw bad('kind', `unknown request ${kind.slice(0, 40)}`);
    if (p.id === FIRST_PARTY_PARADIGM) return this.#firstParty('on');
    if (p.scope === null) throw bad('scope', "an enable names its scope: 'all' or 'repo'");
    if (this.#platform() === 'win32') throw new RpcRefusal('UNSUPPORTED', 'presence', '#mcp-servers: turning a server on takes the root key, which lives in the Mac helper in 8.0: not on Windows yet', { why: 'platform' });
    return this.#raise(asker, p.id, p.scope);
  }

  #firstParty(to: 'on' | 'off'): unknown {
    const s = readMcpServersStore(this.#o.home);
    s.firstParty.paradigm = to;
    writeMcpServersStore(this.#o.home, s);
    this.#o.emit?.({ event: `mcp.first-party.${to}`, id: FIRST_PARTY_PARADIGM });
    const fp = this.#o.firstParty();
    return { id: FIRST_PARTY_PARADIGM, on: to === 'on', available: fp.available, ...(fp.available ? {} : { next: PARADIGM_INSTALL_HINT }) };
  }

  #disable(id: string, scope: McpScope | null): unknown {
    if (id === FIRST_PARTY_PARADIGM) return this.#firstParty('off');
    const s = readMcpServersStore(this.#o.home);
    const before = s.enabled.length;
    s.enabled = s.enabled.filter((e) => !(e.id === id && (scope === null || sameScope(e.scope, scope))));
    if (s.enabled.length !== before) writeMcpServersStore(this.#o.home, s);
    this.#o.emit?.({ event: 'mcp.user.disabled', id, removed: before - s.enabled.length });
    return { id, disabled: true, removed: before - s.enabled.length };
  }

  /** Find a server by id, re-read now (local/project ids carry their repo). */
  #find(id: string): McpServerDecl | null {
    const source = id.slice(0, id.indexOf(':'));
    const owner = id.slice(id.indexOf(':') + 1, id.lastIndexOf(':'));
    const repos = source === 'local' || source === 'project' ? [owner] : [];
    return this.#discover(repos).find((d) => d.id === id) ?? null;
  }

  async #raise(asker: McpAsker, id: string, scope: McpScope): Promise<unknown> {
    const d = this.#find(id);
    if (!d) throw bad('id', 'no such server in your Claude Code config now (status.mcp lists them)', { why: 'not-found' });
    if (d.problems.length) throw bad('id', `${d.name} cannot be turned on: ${d.problems[0]!.text}`, { why: d.problems[0]!.code });
    if ((d.source === 'project' || d.source === 'local') && (scope === 'all' || scope.repo !== d.repo)) {
      throw bad('scope', `${d.name} comes from ${d.source === 'project' ? "a repo's .mcp.json" : 'one folder in your ~/.claude.json'}: it is turned on for that repo only, never for all`, { why: 'repo-only' });
    }
    const hash = declHash(d, this.#o.launchKey);
    const store = readMcpServersStore(this.#o.home);
    if (store.enabled.some((e) => e.id === id && sameScope(e.scope, scope) && e.launchHash === hash)) return { id, on: true, unchanged: true };
    const pkey = `${id}|${scope === 'all' ? 'all' : scope.repo}`;
    const open = this.#pendingList().find((x) => `${x.id}|${x.scope === 'all' ? 'all' : x.scope.repo}` === pkey);
    if (open) return { pending: true, cardId: open.cardId, id };
    const row = mcpServerRow(d);
    const now = this.#o.clock ?? Date.now;
    const cardId = mintId('card');
    const home = this.#o.home;
    this.#pending.set(pkey, { cardId, id, scope });
    try {
      const card = await this.#o.broker.raise({
        kind: 'grant',
        cardId,
        requestedBy: asker.principal!,
        attended: true,
        detail: { action: 'mcp.enable', id, name: d.name, server: d.sessionName, source: d.source, scope: scope === 'all' ? 'all' : 'repo', repo: scope === 'all' ? null : scope.repo, transport: d.transport, host: row.host, envNames: row.envNames, headerNames: row.headerNames, needs: row.needs, shell: d.shell, fetches: d.fetches, launchHash: hash, rootRows: [] },
        lines: mcpEnableCardLines(row, { scope, via: asker.credential === 'gui' ? 'settings' : 'terminal', at: now(), launchHash: hash, pluginRoot: d.plugin?.root ?? null }),
        decisions: ['allow', 'deny'],
        handOnly: true,
        timeoutMs: MCP_ENABLE_CARD_TTL_MS,
        prepare: (decision: string) => {
          if (decision !== 'allow') return null;
          // TOCTOU: the declaration must still be the one the card shows (checked inside the one touch)
          const again = this.#find(id);
          if (!again || again.problems.length || declHash(again, this.#o.launchKey) !== hash) throw bad('id', MCP_CHANGED_WHILE_OPEN, { why: 'changed' });
          return null;
        },
        effect: async (decision) => {
          this.#pending.delete(pkey);
          if (decision !== 'allow') return;
          const s = readMcpServersStore(home);
          s.enabled = [...s.enabled.filter((e) => !(e.id === id && sameScope(e.scope, scope))), { id, scope, launchHash: hash, at: new Date(now()).toISOString(), cardId }];
          writeMcpServersStore(home, s);
          this.#o.emit?.({ event: 'mcp.user.enabled', id, server: d.sessionName, scope: scope === 'all' ? 'all' : 'repo', launchHash: hash });
        },
      });
      return { pending: true, cardId: card.cardId, id };
    } catch (err) {
      this.#pending.delete(pkey);
      throw err;
    }
  }
}
