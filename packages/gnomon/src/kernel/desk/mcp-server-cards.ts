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
 *   batch      request.mcp.enable{servers:[{id, scope, repo?}, …]} (#batch-card; founder 2026-10-23 "grouped cards
 *              of related things, one password"): 1..MCP_ENABLE_MAX servers, each with its own scope, on ONE grant card
 *              (detail.servers[], rootRows: []), each server its own field block (what runs, env names, network host,
 *              auto-allow rules). Validate everything first (any refusal names servers[i] and raises nothing); over
 *              MCP_ENABLE_MAX or MAX_CARD_CHARS (measured after wrapping) refused, never cut. A server already on is
 *              left out (unchanged); a server on a waiting card refuses the batch (card-pending). At allow each launch
 *              hash is checked again: a changed server is skipped and reported (status.mcp.skips by cardId); when all changed,
 *              prepare refuses before the presence prompt. A single {id, scope} is a batch of one with its own card.
 *   disable    request.mcp.disable{id[, scope, repo]}: a narrowing, so notify-and-proceed with no card.
 *   first party  the Paradigm MCP is on by default in every session; {id:'first-party:paradigm'} turns it off or
 *              back on (back to the default) with no card.
 *   Windows    discovery and rows work; turning a server on is refused (a root-class decision needs the root key,
 *              which lives in the Mac helper in 8.0); the first-party Paradigm MCP still runs.
 *   trust      (TD-2026-10-27-833 slice C5'a1, #local-mcp-client) request.mcp.trust{id, op:'preview'|'commit'|'clear',
 *              token?}, the human on a gui or device connection only (like enable). How much a LOCAL session believes
 *              a user or plugin server's own tool labels lives in KERNEL-signed tool.trust rows (#trust-book TrustBook),
 *              never in this store: composeLocal no longer reads the store's old `trust` field and the next write drops
 *              it. preview works from the newest listing of the server in this daemon run (McpListCache, injected as
 *              listedOf; none: why 'not-listed') and answers the notice, the tools that would run with no card and a
 *              single-use TRUST_TOKEN_TTL_MS token bound to (principal, id, launchHash, toolsHash); commit re-checks the
 *              token, the newest listing and the current declaration, then writes tool.trust{op:'set'}; clear takes no
 *              token (it only narrows). Refused: a `fetches` server, a remote proxy, a remote, a project or local server,
 *              the first-party server (already first-party) and Windows. Turning a server off drops its trust (why
 *              disabled). Slice C5'a2 (Aegis hardening): ONE open trust card per server id; a repeat commit (a fresh
 *              valid token) returns the open card's cardId, the way enable de-dupes with #pending.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mintId } from '@a-company/gnomon-contracts';
import { batchCardBlock } from '../broker/batch-card.js';
import type { ApprovalBroker } from '../broker/broker.js';
import type { PolicyPath } from '../manifest/policy.js';
import { RpcRefusal } from '../socket/rpc.js';
import { randomBytes } from 'node:crypto';
import { TOOL_BROKER_SERVER_PATTERN, TOOL_TRUST_ID_PATTERN } from '@a-company/gnomon-contracts';
import { narrow } from '../local/capability-index.js';
import { serverLabel, type ListedIndex } from '../local/mcp-client.js';
import { bindingOf, type TrustEntry } from '../local/trust-book.js';
import { fieldLines, MAX_CARD_CHARS } from '../supervisor/permission.js';
import type { LocalMcpServer } from '../local/mcp-client.js';
import { autoStage, builtAtOf, gitStatusOf, headCommitTimeOf, readParadigmPin, sourceKindOf, stageParadigm, StageRefused, verifyStaged, type ParadigmPin, type VerifyResult } from '../local/paradigm-stage.js';
import { localWritesUnder } from '../local/edit-ledger.js';
import { allowRuleWords, autoAllowRules, composeSessionMcp, declHash, discoverMcpServers, FIRST_PARTY_PARADIGM, FIRST_PARTY_PARADIGM_NAME, LOOP_ENV_SHOWN, loopEnvValues, mcpServerRow, PARADIGM_INSTALL_HINT, type ComposeResult, type FirstPartyResolution, type McpServerDecl, type McpServerRow } from './mcp-servers.js';

export const MCP_SERVERS_SCHEMA = 'gnomon-mcp-servers:v1' as const;
/**
 * The server sources a LOCAL session may reach. TD-2026-10-27-833: `first-party` again, but ONLY from a verified
 * staged pin (#paradigm-stage; otherwise it is listed refused `pin-mismatch`). Project and local scope stay out.
 */
export const LOCAL_MCP_SOURCES: readonly string[] = Object.freeze(['first-party', 'user', 'plugin']);
export const MCP_ENABLE_REQUEST = 'request.mcp.enable' as const;
export const MCP_DISABLE_REQUEST = 'request.mcp.disable' as const;
/** TD-2026-10-27-833: the human stages the first-party Paradigm MCP (the only way a linked checkout is ever staged). */
export const MCP_PARADIGM_STAGE_REQUEST = 'request.mcp.paradigm.stage' as const;
/** Slice C5'a1: the human trusts (or stops trusting) a server's own tool labels for local sessions. */
export const MCP_TRUST_REQUEST = 'request.mcp.trust' as const;
export const MCP_REQUESTS: readonly string[] = Object.freeze([MCP_ENABLE_REQUEST, MCP_DISABLE_REQUEST, MCP_PARADIGM_STAGE_REQUEST, MCP_TRUST_REQUEST]);
/** Slice C5'a1: a trust preview's token is single-use and lives this long. */
export const TRUST_TOKEN_TTL_MS = 60_000;
/** Aegis H1: the trust card waits this long for the human's fresh press. */
export const MCP_TRUST_CARD_TTL_MS = 10 * 60_000;
/** Slice C5'a1: at most this many preview tokens wait at once (oldest dropped). */
const TRUST_TOKENS_MAX = 64;
/**
 * Slice C5'a1: why a server cannot be trusted (closed): platform (Windows), not-found, first-party (it already is),
 * not-local (a project or local server: never in a local session), remote (http/sse), fetches (downloads what it runs
 * at each launch), remote-proxy (a stdio proxy to a remote server), problem (its declaration has a problem), bad-id
 * (an id or label the tool.trust row cannot carry), not-enabled (not on at its current launch hash), not-listed (no
 * local session listed it in this daemon run), changed (the newest listing is not its current launch).
 */
export const MCP_TRUST_REFUSALS = Object.freeze(['platform', 'not-found', 'first-party', 'not-local', 'remote', 'fetches', 'remote-proxy', 'problem', 'bad-id', 'not-enabled', 'not-listed', 'changed'] as const);
export type McpTrustRefusal = (typeof MCP_TRUST_REFUSALS)[number];
const TRUST_REFUSAL_TEXT: Readonly<Record<McpTrustRefusal, string>> = Object.freeze({
  platform: 'per-server trust is not offered on Windows yet',
  'not-found': 'no such server in your Claude Code config now (status.mcp lists them)',
  'first-party': 'the Paradigm MCP is first-party already',
  'not-local': "a project or local server never reaches a local session, so it has nothing to trust",
  remote: 'a remote server never reaches a local session',
  fetches: 'it downloads what it runs at every launch, so what Gnomon would trust can change without a sign',
  'remote-proxy': 'it is a proxy to a remote server, so what Gnomon would trust is not on this machine',
  problem: 'its declaration has a problem',
  'bad-id': 'its id or name cannot be recorded',
  'not-enabled': 'it is not turned on at its current launch',
  'not-listed': 'no local session listed its tools since Gnomon started: open a local session that uses it, then ask again',
  changed: 'it changed since a local session listed its tools: open a local session that uses it, then ask again',
});

/** Slice C5'a1: the trust card's words (the GUI shows them as they are). */
export function trustNotice(name: string, reads: readonly string[]): string {
  return `Trust ${name}'s tool labels? Gnomon will believe what ${name} says about its tools. These run with no card: ${reads.length ? reads.join(', ') : 'none'}. You can make Always rules for its other tools. Tools that change or delete things still ask each time. Trust ends by itself if its command, arguments, environment or tool list changes.`;
}

const DROP_WHY_TEXT: Readonly<Record<'launch-changed' | 'tools-changed' | 'disabled', string>> = Object.freeze({ 'launch-changed': 'its launch changed', 'tools-changed': 'its tool list changed', disabled: 'it was turned off' });
/** Slice C5'a1: what the human reads when the kernel dropped a server's trust. */
export function trustDropNotice(name: string, why: 'launch-changed' | 'tools-changed' | 'disabled'): string {
  return `${name} changed (${DROP_WHY_TEXT[why]}), so Gnomon stopped trusting its tool labels. Its tools ask again and its Always rules are paused. Trust it again in Settings › MCP servers.`;
}

/** The kernel's TrustBook as McpServers uses it (#trust-book McpTrust). */
export interface McpTrustStore {
  of(id: string): TrustEntry | null;
  set(e: { id: string; label: string; binding: string; launchHash: string; toolsHash: string }): Promise<void>;
  clear(id: string): Promise<boolean>;
  drop(id: string, why: 'launch-changed' | 'tools-changed' | 'disabled'): void;
  all?(): TrustEntry[];
}
export const MCP_ENABLE_CARD_TTL_MS = 24 * 3600 * 1000;
export const MCP_CHANGED_WHILE_OPEN = 'the server changed while the card was open: ask again';
export const MCP_ALL_CHANGED_WHILE_OPEN = 'every server on the card changed while it was open: ask again';
/** #batch-card: at most this many servers on one enable card (more is refused, never cut). */
export const MCP_ENABLE_MAX = 16;
/** Aegis L1: how many cards' skip reports status.mcp.skips keeps (oldest dropped first). */
export const MCP_SKIPS_KEPT = 16;
/** The servers one allowed card skipped (changed while it waited), and who decided it. */
export interface McpSkip {
  cardId: string;
  ids: string[];
  names: string[];
  /** the servers the same card turned on */
  on: string[];
  /** the deciding connection */
  connId: string | null;
  at: string;
}
const STORE_MAX_BYTES = 512 * 1024;
const MAX_ENTRIES = 512;

export type McpScope = 'all' | { repo: string };
export interface McpEnabledEntry {
  id: string;
  scope: McpScope;
  launchHash: string;
  at: string;
  cardId: string;
  // slice C5'a1: no `trust` field. Trust lives in kernel-signed tool.trust rows; a store's old field is never read and the
  // next write drops it (both only narrow)
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
const keyOf = (id: string, scope: McpScope): string => `${id}|${scope === 'all' ? 'all' : scope.repo}`;
const windowsRefusal = (): RpcRefusal => new RpcRefusal('UNSUPPORTED', 'presence', '#mcp-servers: turning a server on takes the root key, which lives in the Mac helper in 8.0: not on Windows yet', { why: 'platform' });

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
    // slice C5'a1: only the entry's own fields are kept (an old or edited `trust` field is never read, and the next
    // write drops it)
    return { enabled: enabled.slice(0, MAX_ENTRIES).map((e) => ({ id: e.id, scope: e.scope, launchHash: e.launchHash, at: e.at, cardId: e.cardId })), firstParty: { paradigm: fp } };
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
  const enabled = s.enabled.slice(0, MAX_ENTRIES).map((e) => ({ id: e.id, scope: e.scope, launchHash: e.launchHash, at: e.at, cardId: e.cardId }));
  fs.writeFileSync(tmp, `${JSON.stringify({ schema: MCP_SERVERS_SCHEMA, enabled, firstParty: s.firstParty }, null, 2)}\n`, { mode: 0o600 });
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

export interface McpCardFacts {
  scope: McpScope;
  via: 'settings' | 'terminal';
  at: number;
  launchHash: string;
  pluginRoot?: string | null;
  autoAllowed?: readonly string[];
}

const whereWords = (scope: McpScope): string => (scope === 'all' ? 'for all your repos' : `in ${path.basename(scope.repo)}`);
const askedLine = (via: 'settings' | 'terminal', at: number): string => `asked from ${via === 'settings' ? 'Settings' : 'the terminal'} · ${hhmm(at)} · applies to new sessions`;

/** What turns on with one server: where it comes from, what it runs or where it connects, env names, auto-allow rules. Names only, never a value. */
/** Aegis Q7: known stdio-to-remote proxy packages (a stdio server that is really a remote one). */
export const REMOTE_PROXY_PACKAGES: readonly string[] = Object.freeze(['mcp-remote', 'supergateway', 'mcp-proxy']);
/** The proxy package an arg names (`mcp-remote`, `mcp-remote@1.2`, `@scope/mcp-proxy`…), or null. */
export function remoteProxyOf(args: readonly string[]): string | null {
  for (const a of args) {
    const base = a.replace(/^@[^/]+\//, '').replace(/@[^@]*$/, '').toLowerCase();
    if (REMOTE_PROXY_PACKAGES.includes(base)) return base;
  }
  return null;
}

export function mcpServerFactLines(r: McpServerRow, f: McpCardFacts): string[] {
  const anyValue = r.envNames.length + r.headerNames.length + r.needs.length > 0;
  return [
    `from ${SOURCE_TEXT[r.source]}${r.plugin ? ` · ${r.plugin.id}${r.plugin.version ? ` ${r.plugin.version}` : ''}${f.pluginRoot ? ` at ${f.pluginRoot}` : ''}` : ''}`,
    ...(f.scope !== 'all' ? [`folder ${f.scope.repo}`] : []),
    ...(r.transport === 'stdio'
      ? [`runs ${r.command ?? '?'}${r.args.length ? ` ${r.args.join(' ')}` : ''}`, "inside the session's sandbox: the same files and network as the session, nothing more"]
      : [`connects to ${r.host ?? '?'} (${r.url ?? r.transport}) from the session: tool calls send data there`]),
    ...(r.shell ? [`runs a shell (${r.shell}): Gnomon cannot see what that command line starts`] : []),
    ...(r.fetches ? [`downloads what it runs at every launch (${r.fetches}): what runs can change without a new card`] : []),
    ...(r.transport === 'stdio' && remoteProxyOf(r.args) ? [`connects to a remote server (${remoteProxyOf(r.args)} is a proxy): tool calls can send data off this machine`] : []),
    ...(r.inline ? [`runs inline code (${r.inline}): the program is the args above`] : []),
    ...(r.envNames.length ? [`env names ${r.envNames.join(', ')} (values not shown)`] : []),
    ...(r.headerNames.length ? [`header names ${r.headerNames.join(', ')} (values not shown)`] : []),
    ...(r.needs.length ? [`takes ${r.needs.join(', ')} from ${LOOP_ENV_SHOWN}`] : []),
    ...(anyValue ? ["env and header values are written to this session's mcp.json and readable by the session"] : []),
    // TD-2026-10-23-361 (H1, founder): the human's own Claude Code allow rules are honoured, and named here
    ...(f.autoAllowed?.length ? [`your Claude Code settings auto-allow: ${allowRuleWords(f.autoAllowed)}; those tools run with no card`] : []),
    `its other tools ask like any tool (cards and Always rules); Gnomon adds no allow rule, and its tool descriptions are the server's words, not Gnomon's`,
    ...(r.source === 'project' ? ["this repo's .mcp.json is the repo's code: allow only if you trust this repo"] : []),
    `launch ${f.launchHash}`,
  ];
}

/** The enable card's lines for ONE server: title, the kernel line, then what turns on. Names only, never a value. */
export function mcpEnableCardLines(r: McpServerRow, f: McpCardFacts): string[] {
  return [
    `Turn on MCP server ${r.name} ${whereWords(f.scope)}`,
    askedLine(f.via, f.at),
    ...mcpServerFactLines(r, f),
    'Allow takes the root key and your presence (Touch ID or your Mac password) · never standing, never by voice; deny changes nothing',
  ];
}

/**
 * #batch-card (founder 2026-10-23: "grouped cards of related things, one password"): the lines of ONE card turning
 * several servers on. Each server is its own field block (permission.ts fieldLines: a kernel label line, every fact
 * fenced, an end marker), so no server's words can read as the next server's.
 */
export function mcpBatchCardLines(items: ReadonlyArray<{ row: McpServerRow; f: McpCardFacts }>, o: { via: 'settings' | 'terminal'; at: number }): string[] {
  const n = items.length;
  return [
    `Turn on ${n} MCP servers`,
    askedLine(o.via, o.at),
    ...items.flatMap((it, i) => fieldLines(`server ${i + 1} of ${n}: ${it.row.name} ${whereWords(it.f.scope)}`, mcpServerFactLines(it.row, it.f).join('\n'))),
    `Allow takes the root key and your presence (Touch ID or your Mac password), once for all ${n} · never standing, never by voice; a server that changes before you allow is skipped and named; deny changes nothing`,
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
  broker: Pick<ApprovalBroker, 'raise' | 'card'> & Partial<Pick<ApprovalBroker, 'expire'>>;
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
  /** the card size cap (tests lower it); default MAX_CARD_CHARS */
  maxCardChars?: number;
  /**
   * slice C5'a1 (Arky 6): the newest listing of a server id in this daemon run (the daemon's McpListCache, which only
   * LocalLane's sessions fill); absent: request.mcp.trust answers not-listed
   */
  listedOf?: (id: string) => (ListedIndex & { tools: Array<Record<string, unknown>> | null }) | null;
  /** slice C5'a1: the kernel's TrustBook (absent: request.mcp.trust refuses, status says untrusted) */
  trust?: McpTrustStore;
}

const bad = (field: string, msg: string, data: Record<string, unknown> = {}): RpcRefusal => new RpcRefusal('BAD_REQUEST', 'bad-params', `#mcp-servers: ${msg}`, { field, ...data });

/** The kernel half: status.mcp, the human's requests, and each session's composed servers. */
export class McpServers {
  readonly #o: McpServersOptions;
  /** `${id}|${scope}` → pending cardId */
  readonly #pending = new Map<string, { cardId: string; id: string; scope: McpScope }>();
  /** Aegis L1: per card (newest last, at most MCP_SKIPS_KEPT), so the next card never overwrites another's report */
  readonly #skips = new Map<string, McpSkip>();
  /** TD-2026-10-27-833: the last full verification of the staged Paradigm pin (status reads it; never re-hashes) */
  #lastVerify: { at: string; ok: boolean; why: string | null } | null = null;
  /** slice C5'a1: single-use trust preview tokens → what they are bound to */
  readonly #trustTokens = new Map<string, { principal: string; id: string; launchHash: string; toolsHash: string; expires: number }>();
  /** slice C5'a2 (Aegis hardening): server id → its open trust card (raised: false while the raise is in flight) */
  readonly #trustCards = new Map<string, { cardId: string; raised: boolean; launchHash: string; toolsHash: string }>();

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

  /**
   * The write-denies a session gets for the first-party server: its node, and its package dir unless that dir lies
   * inside the session's own roots. A developer's global install is often an `npm link` into a Paradigm checkout
   * (measured on the founder's Mac: the global package realpaths into a-paradigm/packages/paradigm); a session working
   * in that checkout must still edit it. Residual: such a session can change the server the next session runs, which
   * then runs under the same session profile (no escalation).
   * LOCAL sessions (TD-2026-10-27-833 slice C2', Aegis H1) do not rely on this overlap skip: their profile also
   * write-denies every launch-closure path of their servers INSIDE the roots (#local-mcp-client launchDenies), and a
   * server whose closure is a root itself is refused `launch-writable`.
   */
  sessionDenies(ctx?: { cwd: string; worktree?: string }): PolicyPath[] {
    const roots = ctx ? [ctx.cwd, ...(ctx.worktree ? [ctx.worktree] : [])].map(realOr) : [];
    const overlaps = (p: string): boolean =>
      roots.some((r) => {
        const a = path.relative(r, p);
        const b = path.relative(p, r);
        return a === '' || (!a.startsWith('..') && !path.isAbsolute(a)) || (!b.startsWith('..') && !path.isAbsolute(b));
      });
    const out: PolicyPath[] = [];
    const add = (p: string, match: 'literal' | 'subpath', id: string): void => {
      if (overlaps(p)) {
        this.#o.emit?.({ event: 'mcp.deny.skipped', id, path: p, why: 'inside-session-roots' }); // logged (Aegis M3)
        return;
      }
      if (!out.some((x) => x.path === p)) out.push({ path: p, match, class: 'binary' });
    };
    const fp = this.#o.firstParty();
    if (fp.available && readMcpServersStore(this.#o.home).firstParty.paradigm === 'on') {
      add(fp.dir, 'subpath', FIRST_PARTY_PARADIGM);
      add(fp.node, 'literal', FIRST_PARTY_PARADIGM);
    }
    // TD-2026-10-23-361 (M3): every enabled `all` server's resolved command and absolute-path args are write-denied in
    // every session, so no session can swap what the next session's server runs (a repo-scoped one runs only there)
    const store = readMcpServersStore(this.#o.home);
    const all = store.enabled.filter((e) => e.scope === 'all');
    if (all.length) {
      for (const d of this.#discover([])) {
        if (d.transport !== 'stdio' || !d.resolved || d.problems.length) continue;
        const hash = declHash(d, this.#o.launchKey);
        if (!all.some((e) => e.id === d.id && e.launchHash === hash)) continue;
        add(realOr(d.resolved), 'literal', d.id);
        for (const a of d.args) {
          if (!path.isAbsolute(a) || a.includes('${')) continue;
          try {
            const st = fs.statSync(a);
            add(realOr(a), st.isDirectory() ? 'subpath' : 'literal', d.id);
          } catch {
            /* not a path on disk: nothing to protect */
          }
        }
      }
    }
    return out;
  }

  /** Aegis L5: `mcp.user.added` only for servers that made it into the session's FINAL mcpServers (after the merge). */
  noteMerged(hsid: string, r: ComposeResult, finalServers: Record<string, unknown>): void {
    for (const a of r.added) if (finalServers[a.server] !== undefined && finalServers[a.server] === r.servers[a.server]) this.#o.emit?.({ event: 'mcp.user.added', hsid, id: a.id, server: a.server, source: a.source, launchHash: a.launchHash });
  }

  /** The session's own servers (first-party + enabled) for a session opened in `cwd`. */
  compose(ctx: { hsid: string; cwd: string; worktree?: string }): ComposeResult {
    return this.#compose(ctx).r;
  }

  #compose(ctx: { hsid: string; cwd: string; worktree?: string }): { r: ComposeResult; decls: McpServerDecl[] } {
    const store = readMcpServersStore(this.#o.home);
    const repo = realOr(ctx.cwd);
    const fp = store.firstParty.paradigm === 'on' ? this.#o.firstParty() : null;
    const decls = this.#discover([ctx.cwd]);
    const needsEnv = decls.some((d) => Object.keys(d.refs).length > 0 && enabledState(store, d, declHash(d, this.#o.launchKey), repo) === 'on');
    const env = needsEnv ? loopEnvValues(this.#o.home) : { values: new Map<string, string>(), refused: null };
    if (env.refused) this.#o.emit?.({ event: 'mcp.user.env-refused', hsid: ctx.hsid, reason: env.refused });
    const r = composeSessionMcp({ decls, enabled: (d, hash) => enabledState(store, d, hash, repo), launchKey: this.#o.launchKey, cwd: ctx.cwd, firstParty: fp && fp.available ? fp : null, envValue: (n) => env.values.get(n) });
    if (fp && !fp.available) this.#o.emit?.({ event: 'mcp.first-party.unavailable', hsid: ctx.hsid, why: fp.why });
    for (const s of r.skipped) this.#o.emit?.({ event: 'mcp.user.skipped', hsid: ctx.hsid, id: s.id, server: s.server, why: s.why, ...(s.names ? { names: s.names } : {}) });
    return { r, decls };
  }

  /**
   * TD-2026-10-27-833 slice C2': the servers a LOCAL session in `ctx.cwd` may reach (#local-mcp-client): exactly the
   * servers compose() gives a Claude session there (the first-party Paradigm MCP as trust `first-party`, then every
   * enabled server at its current launch hash, a project or local server only in its own repo). Remote servers are
   * listed as composed; the pool refuses them (remote-refused). Slice C5'a1: every non-first-party server is `enabled`
   * here and carries its launch hash and plugin version; the pool asks the TrustBook (the store's trust is never read).
   */
  composeLocal(ctx: { hsid: string; cwd: string; worktree?: string }): LocalMcpServer[] {
    const { r, decls } = this.#compose(ctx);
    const out: LocalMcpServer[] = [];
    for (const a of r.added) {
      // INTERIM (Aegis H1, until the first-party Paradigm MCP is staged as a pinned, hashed copy in the Gnomon home):
      // a local session gets neither the first-party server (it can run from a linked checkout inside the roots) nor a
      // repo-written project/local-scope server. Only user and plugin servers reach local sessions today.
      if (!LOCAL_MCP_SOURCES.includes(a.source)) continue;
      if (a.source === 'first-party') {
        out.push(this.#stagedParadigm(ctx));
        continue;
      }
      const e = r.servers[a.server] as Record<string, unknown> | undefined;
      if (!e) continue;
      const transport = e.type === 'http' || e.type === 'sse' ? e.type : 'stdio';
      const d = decls.find((x) => x.id === a.id);
      out.push({
        id: a.id,
        name: a.server,
        transport,
        ...(transport === 'stdio' && typeof e.command === 'string' ? { command: e.command, args: Array.isArray(e.args) ? e.args.map(String) : [] } : {}),
        ...(transport === 'stdio' && e.env && typeof e.env === 'object' ? { env: { ...(e.env as Record<string, string>) } } : {}),
        trust: 'enabled',
        launchHash: a.launchHash,
        pluginVersion: d?.plugin?.version ?? null,
      });
    }
    return out;
  }

  /**
   * TD-2026-10-27-833: the first-party Paradigm MCP for a LOCAL session — an npm-global install is staged when its
   * version changed (autoStage; a linked checkout never), then the pin is FULLY verified. Verified: launched as
   * `<node> <staged entry> <repo root>` (the lane swaps in the runner's pinned node), trust first-party. Otherwise it is
   * listed refused `pin-mismatch` and the event is logged (daemon.desk mcp.first-party.pin-mismatch).
   */
  #stagedParadigm(ctx: { hsid: string; cwd: string }): LocalMcpServer {
    const base = { id: FIRST_PARTY_PARADIGM, name: FIRST_PARTY_PARADIGM_NAME, transport: 'stdio' as const, trust: 'first-party' as const };
    // Aegis (low): no helper grants a Windows session SID a read ACE on the staged dir yet, so win32 refuses it outright
    if (this.#platform() === 'win32') return { ...base, refused: { fit: 'pin-mismatch', why: 'the staged Paradigm MCP is not offered to local sessions on Windows yet (no read grant for the session on the staged dir)' } };
    const fp = this.#o.firstParty();
    if (fp.available) {
      const st = autoStage(this.#o.home, { dir: fp.dir, entry: fp.entry, version: fp.version, linked: fp.linked });
      if (st.staged && st.pin) this.#o.emit?.({ event: 'mcp.first-party.staged', id: FIRST_PARTY_PARADIGM, version: st.pin.version, treeSha256: st.pin.treeSha256, sourceKind: st.pin.sourceKind, by: 'auto' });
      else if (st.why && st.why !== 'linked-checkout') this.#o.emit?.({ event: 'mcp.first-party.stage-failed', id: FIRST_PARTY_PARADIGM, why: st.why });
    }
    const v: VerifyResult = verifyStaged(this.#o.home);
    this.#lastVerify = { at: new Date((this.#o.clock ?? Date.now)()).toISOString(), ok: v.ok, why: v.ok ? null : v.why };
    if (!v.ok) {
      this.#o.emit?.({ event: 'mcp.first-party.pin-mismatch', hsid: ctx.hsid, id: FIRST_PARTY_PARADIGM, why: v.why });
      return { ...base, refused: { fit: 'pin-mismatch', why: v.why === 'no pin' ? 'the Paradigm MCP is not staged (a linked checkout is staged from Settings: request.mcp.paradigm.stage)' : `the staged Paradigm MCP does not verify: ${v.why}` } };
    }
    const repo = realOr(ctx.cwd);
    return { ...base, command: fp.available ? fp.node : process.execPath, args: [v.entry, repo], staged: { dir: v.dir, snapshot: v.snapshot, repo } };
  }

  /** TD-2026-10-27-833: status.mcp.firstParty.staged — the pin, its dir and the last verification (no re-hash). */
  #stagedStatus(): { staged: (ParadigmPin & { dir: string }) | null; pinMismatch: string | null; verifiedAt: string | null } {
    const pin = readParadigmPin(this.#o.home);
    const lv = this.#lastVerify;
    return { staged: pin ? { ...pin, dir: path.join(this.#o.home, 'mcp', 'first-party', 'paradigm', `${pin.version.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'unknown'}-${pin.treeSha256.slice(0, 12)}`) } : null, pinMismatch: lv && !lv.ok ? lv.why : pin ? null : 'no pin', verifiedAt: lv?.at ?? null };
  }

  /**
   * request.mcp.paradigm.stage{preview?, force?} (human, gui/device): stage the installed Paradigm MCP now (an
   * npm-global install or a LINKED CHECKOUT — the only way one is ever staged). The reply names the source path,
   * version, source kind, the checkout's full git status under the package (tracked, untracked AND ignored:
   * dist/mcp-bundle is gitignored), the build's time against HEAD's commit time, and the local sessions that could
   * have written the source since that build (#paradigm-stage edit ledger). Aegis H3: for a linked checkout, any such
   * local edit or live session REFUSES the stage (`local-writes`) unless the human re-sends {force: true}; {preview:
   * true} answers the same without staging.
   */
  #stageRequest(payload: unknown): unknown {
    if (payload !== undefined && payload !== null && !isObj(payload)) throw bad('payload', `${MCP_PARADIGM_STAGE_REQUEST} takes {preview?: boolean}`);
    const p = (payload ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(p)) if (k !== 'preview' && k !== 'force') throw bad(k.slice(0, 32), `unknown field ${k.slice(0, 32)}`);
    if (p.preview !== undefined && typeof p.preview !== 'boolean') throw bad('preview', 'preview is a boolean');
    if (p.force !== undefined && typeof p.force !== 'boolean') throw bad('force', 'force is a boolean');
    const fp = this.#o.firstParty();
    if (!fp.available) throw new RpcRefusal('NOT_FOUND', 'bad-params', `#mcp-servers: ${fp.why}`, { why: 'not-installed', next: PARADIGM_INSTALL_HINT });
    const sourceKind = sourceKindOf(fp);
    const status = gitStatusOf(fp.dir);
    const dirty = status?.dirty ?? null;
    const builtAt = builtAtOf({ dir: fp.dir, entry: fp.entry, version: fp.version, linked: fp.linked });
    const headAt = headCommitTimeOf(fp.dir);
    const writes = localWritesUnder(this.#o.home, realOr(fp.dir), builtAt ?? 0);
    // Aegis should-fix: a ledger read only in part (incomplete inside the window) counts as local writes
    const localWrites = writes.edits.length + writes.sessions.length > 0 || writes.incomplete !== null;
    const facts = {
      id: FIRST_PARTY_PARADIGM, source: fp.dir, version: fp.version, sourceKind, dirty,
      git: status, builtAt: builtAt === null ? null : new Date(builtAt).toISOString(), headCommitAt: headAt === null ? null : new Date(headAt).toISOString(),
      builtAfterHead: builtAt !== null && headAt !== null ? builtAt > headAt : null,
      localWrites: { edits: writes.edits.map((e) => ({ hsid: e.hsid, path: e.path, at: new Date(e.at).toISOString() })), sessions: writes.sessions, incompleteSince: writes.incomplete === null ? null : new Date(writes.incomplete).toISOString() },
      // informational: edits under the source in the last 7 days, whatever the build time
      recentLocalEdits: writes.recent.map((e) => ({ hsid: e.hsid, path: e.path, at: new Date(e.at).toISOString() })),
    };
    if (p.preview === true) return { ...facts, staged: false, preview: true, current: readParadigmPin(this.#o.home), ...(sourceKind === 'linked-checkout' && localWrites ? { needsForce: true } : {}) };
    if (sourceKind === 'linked-checkout' && localWrites && p.force !== true) {
      throw new RpcRefusal('UNSUPPORTED', 'bad-params', '#mcp-servers: a local session could have written this checkout since its Paradigm build: re-send with {force: true} to stage it anyway', { why: 'local-writes', edits: facts.localWrites.edits.slice(0, 10), sessions: writes.sessions.slice(0, 10), incompleteSince: facts.localWrites.incompleteSince, hint: 'rebuild Paradigm yourself, or stage with force' });
    }
    let pin: ParadigmPin;
    try {
      pin = stageParadigm(this.#o.home, { dir: fp.dir, entry: fp.entry, version: fp.version, linked: fp.linked }, { sourceKind, dirty, ...(this.#o.clock ? { now: this.#o.clock } : {}) });
    } catch (e) {
      if (e instanceof StageRefused) throw new RpcRefusal('UNSUPPORTED', 'bad-params', e.message, { why: e.why });
      throw e;
    }
    const v = verifyStaged(this.#o.home);
    this.#lastVerify = { at: new Date((this.#o.clock ?? Date.now)()).toISOString(), ok: v.ok, why: v.ok ? null : v.why };
    this.#o.emit?.({ event: 'mcp.first-party.staged', id: FIRST_PARTY_PARADIGM, version: pin.version, treeSha256: pin.treeSha256, sourceKind, dirty, by: 'human' });
    return { ...facts, staged: true, forced: p.force === true && localWrites, treeSha256: pin.treeSha256, layout: pin.layout, stagedAt: pin.stagedAt, verified: v.ok };
  }

  status(): Record<string, unknown> {
    const store = readMcpServersStore(this.#o.home);
    const fp = this.#o.firstParty();
    const key = this.#o.launchKey;
    const state = (d: McpServerDecl) => {
      const hash = declHash(d, key);
      const mine = store.enabled.filter((e) => e.id === d.id);
      return { ...mcpServerRow(d), autoAllowed: autoAllowRules(this.#o.userHome, d.sessionName), on: { all: mine.some((e) => e.scope === 'all' && e.launchHash === hash), repos: mine.filter((e) => e.scope !== 'all' && e.launchHash === hash).map((e) => (e.scope as { repo: string }).repo) }, changed: mine.some((e) => e.launchHash !== hash), trust: this.#trustRow(d, hash, mine.some((e) => e.launchHash === hash)) };
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
      // TD-2026-10-27-833: staged (the pin a local session runs) and pinMismatch (why it is not offered), for the C6' card
      firstParty: { id: FIRST_PARTY_PARADIGM, name: FIRST_PARTY_PARADIGM_NAME, trust: { level: 'first-party', why: 'first-party' }, on: store.firstParty.paradigm === 'on', available: fp.available, autoAllowed: autoAllowRules(this.#o.userHome, FIRST_PARTY_PARADIGM_NAME), ...(fp.available ? { version: fp.version, dir: fp.dir, linked: fp.linked } : { why: fp.why }), ...this.#stagedStatus() },
      servers: all.filter((d) => d.source === 'user' || d.source === 'plugin').map(state),
      repos: [...live].map(([repo, hsids]) => ({ repo, folder: path.basename(repo), hsids, servers: all.filter((d) => d.repo === repo).map(state) })),
      // one entry per server; the servers of one batch card share its cardId
      pending: this.#pendingList().map((p) => ({ cardId: p.cardId, id: p.id, scope: p.scope === 'all' ? 'all' : 'repo', repo: p.scope === 'all' ? null : p.scope.repo })),
      max: MCP_ENABLE_MAX,
      // Aegis L1: every recent card's skips by cardId (bounded); `skipped` stays the newest (the GUI's old read)
      skips: [...this.#skips.values()],
      ...(this.#skips.size ? { skipped: [...this.#skips.values()].at(-1) } : {}),
    };
  }

  /**
   * Slice C5'a1 (for the C5'b GUI): a server row's trust — level untrusted | trusted (the TrustBook holds it; the pool
   * still checks the binding at every listing), and why it cannot be trusted now (MCP_TRUST_REFUSALS) or null when a
   * preview would be answered. Hashes and names only.
   */
  #trustRow(d: McpServerDecl, hash: string, on: boolean): { level: 'untrusted' | 'trusted'; why: McpTrustRefusal | null; since?: number } {
    const t = this.#o.trust?.of(d.id) ?? null;
    let why: McpTrustRefusal | null = this.#trustRefusal(d);
    if (!why && !on) why = 'not-enabled';
    if (!why) {
      const l = this.#o.listedOf?.(d.id) ?? null;
      why = !l || !l.tools ? 'not-listed' : l.launchHash !== hash || l.pluginVersion !== (d.plugin?.version ?? null) ? 'changed' : null;
    }
    return { level: t ? 'trusted' : 'untrusted', why, ...(t ? { since: t.seq } : {}) };
  }

  #human(asker: McpAsker, kind: string): void {
    if (asker.principalClass !== 'human' || !asker.principal || (asker.credential !== 'gui' && asker.credential !== 'device')) {
      throw new RpcRefusal('FORBIDDEN', 'matrix', `${kind} is the human's, on a gui or device connection (never voice, an agent or a session)`);
    }
  }

  /** One {id, scope?, repo?}. `at` names the item inside a batch ("servers[2]: ") in the field and the message. */
  #parse(kind: string, payload: unknown, at = ''): { id: string; scope: McpScope | null } {
    const f = (k: string): string => (at ? `servers[${at}].${k}` : k);
    const w = at ? `servers[${at}]: ` : '';
    if (!isObj(payload)) throw bad(f('id'), `${w}${kind} takes {id, scope?: 'all' | 'repo', repo?}`);
    for (const k of Object.keys(payload)) if (!['id', 'scope', 'repo'].includes(k)) throw bad(f(k), `${w}unknown field ${k.slice(0, 32)}`);
    if (typeof payload.id !== 'string' || payload.id.length === 0 || payload.id.length > 2048) throw bad(f('id'), `${w}id names one server (status.mcp)`);
    if (payload.scope === undefined) return { id: payload.id, scope: null };
    if (payload.scope === 'all') return { id: payload.id, scope: 'all' };
    if (payload.scope !== 'repo') throw bad(f('scope'), `${w}scope is 'all' or 'repo'`);
    if (typeof payload.repo !== 'string' || !path.isAbsolute(payload.repo)) throw bad(f('repo'), `${w}a repo scope names the folder (an absolute path)`);
    const repo = realOr(payload.repo);
    try {
      if (!fs.statSync(repo).isDirectory()) throw new Error('not a dir');
    } catch {
      throw bad(f('repo'), `${w}the folder does not exist`);
    }
    return { id: payload.id, scope: { repo } };
  }

  /** request.mcp.enable{servers:[…]}: 1..MCP_ENABLE_MAX items, each with its scope, one per server and scope. */
  #parseBatch(payload: Record<string, unknown>): Array<{ id: string; scope: McpScope }> {
    const extra = Object.keys(payload).filter((k) => k !== 'servers');
    if (extra.length) throw bad(extra[0]!.slice(0, 32), `a batch takes only {servers} (unknown: ${extra.slice(0, 4).join(', ').slice(0, 80)})`);
    const list = payload.servers;
    if (!Array.isArray(list) || list.length === 0) throw bad('servers', 'servers is a non-empty list of {id, scope, repo?}');
    if (list.length > MCP_ENABLE_MAX) throw bad('servers', `at most ${MCP_ENABLE_MAX} servers on one card (asked: ${list.length})`, { why: 'too-many', max: MCP_ENABLE_MAX, hint: `turn them on in parts of ${MCP_ENABLE_MAX} or fewer` });
    const seen = new Set<string>();
    return list.map((raw, i) => {
      const p = this.#parse(MCP_ENABLE_REQUEST, raw, String(i));
      if (p.id === FIRST_PARTY_PARADIGM) throw bad(`servers[${i}].id`, `servers[${i}]: the Paradigm MCP turns on with no card: use its own key`, { why: 'first-party' });
      if (p.scope === null) throw bad(`servers[${i}].scope`, `servers[${i}]: each server names its scope: 'all' or 'repo'`);
      const k = keyOf(p.id, p.scope);
      if (seen.has(k)) throw bad(`servers[${i}]`, `servers[${i}]: ${p.id.slice(0, 80)} is named twice for the same scope`, { why: 'twice' });
      seen.add(k);
      return { id: p.id, scope: p.scope };
    });
  }

  async request(asker: McpAsker, kind: string, payload: unknown): Promise<unknown> {
    this.#human(asker, kind);
    if (kind === MCP_PARADIGM_STAGE_REQUEST) return this.#stageRequest(payload);
    if (kind === MCP_TRUST_REQUEST) return this.#trustRequest(asker, payload);
    // #batch-card: several servers, each with its scope, on ONE card (one presence decides them all)
    if (kind === MCP_ENABLE_REQUEST && isObj(payload) && 'servers' in payload) {
      const items = this.#parseBatch(payload);
      if (this.#platform() === 'win32') throw windowsRefusal();
      return this.#raise(asker, items, true);
    }
    const p = this.#parse(kind, payload);
    if (kind === MCP_DISABLE_REQUEST) return this.#disable(p.id, p.scope);
    if (kind !== MCP_ENABLE_REQUEST) throw bad('kind', `unknown request ${kind.slice(0, 40)}`);
    if (p.id === FIRST_PARTY_PARADIGM) return this.#firstParty('on');
    if (p.scope === null) throw bad('scope', "an enable names its scope: 'all' or 'repo'");
    if (this.#platform() === 'win32') throw windowsRefusal();
    return this.#raise(asker, [{ id: p.id, scope: p.scope }], false);
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
    // slice C5'a1: a server turned off everywhere is trusted no more (one dropped row, why disabled)
    if (!s.enabled.some((e) => e.id === id) && this.#o.trust?.of(id)) this.#o.trust.drop(id, 'disabled');
    this.#o.emit?.({ event: 'mcp.user.disabled', id, removed: before - s.enabled.length });
    return { id, disabled: true, removed: before - s.enabled.length };
  }

  /** Slice C5'a1: why this declaration can never be trusted (before listing), or null. */
  #trustRefusal(d: McpServerDecl | null): McpTrustRefusal | null {
    if (this.#platform() === 'win32') return 'platform';
    if (!d) return 'not-found';
    if (d.id === FIRST_PARTY_PARADIGM) return 'first-party';
    if (d.source !== 'user' && d.source !== 'plugin') return 'not-local';
    if (d.transport !== 'stdio') return 'remote';
    if (d.fetches) return 'fetches';
    if (remoteProxyOf(d.args)) return 'remote-proxy';
    if (d.problems.length) return 'problem';
    if (!TOOL_TRUST_ID_PATTERN.test(d.id) || !TOOL_BROKER_SERVER_PATTERN.test(serverLabel(d.sessionName))) return 'bad-id';
    return null;
  }

  #trustRefused(why: McpTrustRefusal, id: string): RpcRefusal {
    return new RpcRefusal(why === 'not-found' ? 'NOT_FOUND' : 'UNSUPPORTED', 'bad-params', `#mcp-servers: cannot trust this server: ${TRUST_REFUSAL_TEXT[why]}`, { why, id });
  }

  /**
   * Slice C5'a1: the server as it is now and its newest listing, checked for trust: refusable, on at its current launch
   * hash, listed in this daemon run at that launch hash and plugin version.
   */
  #trustable(id: string): { d: McpServerDecl; hash: string; l: ListedIndex & { tools: Array<Record<string, unknown>> } } {
    const d = id === FIRST_PARTY_PARADIGM ? null : this.#find(id);
    const why = id === FIRST_PARTY_PARADIGM ? 'first-party' : this.#trustRefusal(d);
    if (why) throw this.#trustRefused(why, id);
    const hash = declHash(d!, this.#o.launchKey);
    if (!readMcpServersStore(this.#o.home).enabled.some((e) => e.id === id && e.launchHash === hash)) throw this.#trustRefused('not-enabled', id);
    const l = this.#o.listedOf?.(id) ?? null;
    if (!l || !l.tools) throw this.#trustRefused('not-listed', id);
    if (l.launchHash !== hash || l.pluginVersion !== (d!.plugin?.version ?? null)) throw this.#trustRefused('changed', id);
    return { d: d!, hash, l: { ...l, tools: l.tools } };
  }

  /**
   * request.mcp.trust{id, op, token?} (slice C5'a1; human, gui or device). preview: the notice, the tools that would run
   * with no card, and a single-use token; commit: the token again, re-checked, then one tool.trust{op:'set'} row; clear:
   * one tool.trust{op:'cleared'} row (no token: it only narrows).
   */
  async #trustRequest(asker: McpAsker, payload: unknown): Promise<unknown> {
    if (!isObj(payload)) throw bad('id', `${MCP_TRUST_REQUEST} takes {id, op: 'preview' | 'commit' | 'clear', token?}`);
    for (const k of Object.keys(payload)) if (!['id', 'op', 'token'].includes(k)) throw bad(k.slice(0, 32), `unknown field ${k.slice(0, 32)}`);
    const { id, op, token } = payload;
    if (typeof id !== 'string' || id.length === 0 || id.length > 2048) throw bad('id', 'id names one server (status.mcp)');
    if (op !== 'preview' && op !== 'commit' && op !== 'clear') throw bad('op', "op is 'preview', 'commit' or 'clear'");
    if (op === 'commit' ? typeof token !== 'string' || token.length === 0 || token.length > 128 : token !== undefined) throw bad('token', op === 'commit' ? 'a commit carries the preview token' : 'only a commit carries a token');
    const trust = this.#o.trust;
    if (op === 'clear') {
      const cleared = trust ? await trust.clear(id) : false;
      if (cleared) this.#o.emit?.({ event: 'mcp.trust.cleared', id });
      return { id, trusted: false, cleared };
    }
    if (!trust) throw new RpcRefusal('UNSUPPORTED', 'bad-params', '#mcp-servers: per-server trust is not available in this kernel', { why: 'unavailable', id });
    const now = (this.#o.clock ?? Date.now)();
    for (const [t, v] of [...this.#trustTokens]) if (v.expires < now) this.#trustTokens.delete(t);
    if (op === 'preview') {
      const { d, l } = this.#trustable(id);
      const reads = narrow(l.tools, l.label, { trust: 'trusted' }).filter((e) => e.class === 'read' && !e.humanOnly).map((e) => e.name);
      const t = randomBytes(24).toString('base64url');
      this.#trustTokens.set(t, { principal: asker.principal!, id, launchHash: l.launchHash, toolsHash: l.toolsHash, expires: now + TRUST_TOKEN_TTL_MS });
      while (this.#trustTokens.size > TRUST_TOKENS_MAX) this.#trustTokens.delete(this.#trustTokens.keys().next().value!);
      return { id, name: d.name, label: l.label, preview: true, trusted: trust.of(id) !== null, token: t, expiresAt: new Date(now + TRUST_TOKEN_TTL_MS).toISOString(), notice: trustNotice(d.name, reads), reads, launchHash: l.launchHash, toolsHash: l.toolsHash, listedAt: new Date(l.at).toISOString() };
    }
    // commit: the token is used up whatever happens next (single use)
    const pend = this.#trustTokens.get(token as string);
    this.#trustTokens.delete(token as string);
    if (!pend || pend.principal !== asker.principal || pend.id !== id || now > pend.expires) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `${MCP_TRUST_REQUEST}: the preview is stale, expired or already used: preview again`, { why: 'stale', id });
    const { l } = this.#trustable(id);
    if (l.launchHash !== pend.launchHash || l.toolsHash !== pend.toolsHash) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `${MCP_TRUST_REQUEST}: the server changed since the preview: preview again`, { why: 'stale', id });
    // Aegis H1 (founder: "Trusting a server always needs a fresh press"): the commit raises ONE grant card (root key and
    // a FRESH presence, hand-only, never standing: 'grant' is in NEVER_STANDING_KINDS, never voice). Its detail (inside
    // the contentHash) binds {id, launchHash, toolsHash, reads}; the token stays the preview's TOCTOU binding. Trust is
    // set only when the card is allowed, after the listing is checked again.
    // Aegis hardening (C5'a2): one open trust card per server id; a repeat commit returns it (like enable's #pending)
    // Aegis L1 (C5'a2 sign-off): an open card for ANOTHER listing (the server re-listed since) is withdrawn and a new
    // card raised for this one, so an old card never blocks a commit until it times out (its allow is refused)
    const open = this.#trustCards.get(id);
    if (open) {
      const c = open.raised ? this.#o.broker.card?.(open.cardId) : null;
      const live = !open.raised || (c !== null && c !== undefined && c.state === 'pending');
      const same = open.launchHash === l.launchHash && open.toolsHash === l.toolsHash;
      if (live && same) return { id, pending: true, cardId: open.cardId };
      if (live && !open.raised) return { id, pending: true, cardId: open.cardId }; // its raise is still in flight
      if (live) await this.#o.broker.expire?.(open.cardId, 'cancelled').catch(() => false);
      this.#trustCards.delete(id);
    }
    const d = this.#find(id)!;
    const reads = narrow(l.tools, l.label, { trust: 'trusted' }).filter((e) => e.class === 'read' && !e.humanOnly).map((e) => e.name);
    const via = asker.credential === 'gui' ? ('settings' as const) : ('terminal' as const);
    const lines = [
      `Trust ${d.name}'s tool labels for local sessions`,
      askedLine(via, now),
      trustNotice(d.name, reads),
      `launch ${l.launchHash} · tools ${l.toolsHash}`,
      'Allow takes the root key and your presence (Touch ID or your Mac password) · never standing, never by voice; deny changes nothing',
    ];
    const shown = batchCardBlock(lines);
    const sameListing = (): ListedIndex & { tools: Array<Record<string, unknown>> } => {
      const again = this.#trustable(id).l;
      if (again.launchHash !== l.launchHash || again.toolsHash !== l.toolsHash || again.pluginVersion !== l.pluginVersion) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `${MCP_TRUST_REQUEST}: the server changed while the card was open: ask again`, { why: 'changed', id });
      return again;
    };
    const trustCardId = mintId('card');
    const slot = { cardId: trustCardId, raised: false, launchHash: l.launchHash, toolsHash: l.toolsHash };
    this.#trustCards.set(id, slot);
    let card: Awaited<ReturnType<McpServersOptions['broker']['raise']>>;
    try {
      card = await this.#o.broker.raise({
        kind: 'grant',
        cardId: trustCardId,
        requestedBy: asker.principal!,
        attended: true,
        detail: { action: 'mcp.trust', id, name: d.name, server: l.label, launchHash: l.launchHash, toolsHash: l.toolsHash, reads, rootRows: [] },
        lines,
        block: shown.block,
        decisions: ['allow', 'deny'],
        handOnly: true,
        timeoutMs: MCP_TRUST_CARD_TTL_MS,
        // TOCTOU inside the one touch, BEFORE the presence prompt
        prepare: (decision: string) => {
          if (decision === 'allow') sameListing();
          return null;
        },
        effect: async (decision) => {
          if (decision !== 'allow') return;
          const again = sameListing();
          await trust.set({ id, label: again.label, binding: bindingOf({ id, launchHash: again.launchHash, pluginVersion: again.pluginVersion, toolsHash: again.toolsHash }), launchHash: again.launchHash, toolsHash: again.toolsHash });
          this.#o.emit?.({ event: 'mcp.trust.set', id, label: again.label });
        },
      });
    } catch (err) {
      if (this.#trustCards.get(id) === slot) this.#trustCards.delete(id);
      throw err;
    }
    slot.raised = true;
    return { id, pending: true, cardId: card.cardId };
  }

  /**
   * Aegis L3: a server trusted on the chain but no longer on anywhere (its `disabled` drop row failed to write, or the
   * store was edited while the daemon was down) is dropped again (why disabled). Run at daemon start; returns the ids.
   */
  reconcileTrust(): string[] {
    const t = this.#o.trust;
    if (!t?.all) return [];
    const on = new Set(readMcpServersStore(this.#o.home).enabled.map((e) => e.id));
    const out: string[] = [];
    for (const e of t.all()) {
      if (on.has(e.id)) continue;
      t.drop(e.id, 'disabled');
      out.push(e.id);
    }
    return out;
  }

  /** Find a server by id, re-read now (local/project ids carry their repo). */
  #find(id: string): McpServerDecl | null {
    const source = id.slice(0, id.indexOf(':'));
    const owner = id.slice(id.indexOf(':') + 1, id.lastIndexOf(':'));
    const repos = source === 'local' || source === 'project' ? [owner] : [];
    return this.#discover(repos).find((d) => d.id === id) ?? null;
  }

  /** Validate one item now: it exists, has no problem, and a repo-bound server takes its own repo only. */
  #check(id: string, scope: McpScope, at: string): McpServerDecl {
    const w = at ? `servers[${at}]: ` : '';
    const field = at ? `servers[${at}].id` : 'id';
    const d = this.#find(id);
    if (!d) throw bad(field, `${w}no such server in your Claude Code config now (status.mcp lists them)`, { why: 'not-found', id });
    if (d.problems.length) throw bad(field, `${w}${d.name} cannot be turned on: ${d.problems[0]!.text}`, { why: d.problems[0]!.code, id });
    if ((d.source === 'project' || d.source === 'local') && (scope === 'all' || scope.repo !== d.repo)) {
      throw bad(at ? `servers[${at}].scope` : 'scope', `${w}${d.name} comes from ${d.source === 'project' ? "a repo's .mcp.json" : 'one folder in your ~/.claude.json'}: it is turned on for that repo only, never for all`, { why: 'repo-only', id });
    }
    return d;
  }

  /**
   * #batch-card: ONE grant card for every server of the batch (a single enable is a batch of one, with the card it
   * always had). VALIDATE EVERYTHING FIRST: any refusal names its item and raises nothing. Over MCP_ENABLE_MAX servers
   * or MAX_CARD_CHARS (measured after wrapping) the batch is refused, never cut. A server already on at its current
   * launch hash is left out (`unchanged`). At allow, each server's launch hash is checked again: a changed one is
   * skipped and reported (status.mcp.skips by cardId, bounded; event mcp.user.skipped-changed with the deciding connId); only when every one changed does the
   * card refuse, in prepare, before the presence prompt.
   */
  async #raise(asker: McpAsker, items: ReadonlyArray<{ id: string; scope: McpScope }>, batch: boolean): Promise<unknown> {
    const checked = items.map((it, i) => {
      const d = this.#check(it.id, it.scope, batch ? String(i) : '');
      return { ...it, d, hash: declHash(d, this.#o.launchKey), row: mcpServerRow(d) };
    });
    type Item = (typeof checked)[number];
    const store = readMcpServersStore(this.#o.home);
    const isOn = (c: Item): boolean => store.enabled.some((e) => e.id === c.id && sameScope(e.scope, c.scope) && e.launchHash === c.hash);
    const unchanged = checked.filter(isOn).map((c) => c.id);
    const want = checked.filter((c) => !isOn(c));
    if (!want.length) return batch ? { on: true, unchanged, cardId: null } : { id: checked[0]!.id, on: true, unchanged: true };
    // a card already waiting: the same servers and scopes again return it (one at a time); a batch overlapping it is refused
    const open = this.#pendingList();
    const waiting = want.map((c) => open.find((x) => x.id === c.id && sameScope(x.scope, c.scope)) ?? null);
    if (waiting.every((x) => x !== null) && new Set(waiting.map((x) => x!.cardId)).size === 1) return { pending: true, cardId: waiting[0]!.cardId, id: want[0]!.id, ...(batch ? { ids: want.map((c) => c.id) } : {}) };
    const clash = waiting.find((x) => x !== null);
    if (clash) throw bad('servers', `${want.find((c) => c.id === clash.id)?.d.name ?? 'a server'} is already on a card that is waiting: decide it first`, { why: 'card-pending', cardId: clash.cardId, hint: 'Decide in the stack' });
    const now = this.#o.clock ?? Date.now;
    const via = asker.credential === 'gui' ? ('settings' as const) : ('terminal' as const);
    const at = now();
    const facts = (c: Item): McpCardFacts => ({ scope: c.scope, via, at, launchHash: c.hash, pluginRoot: c.d.plugin?.root ?? null, autoAllowed: autoAllowRules(this.#o.userHome, c.d.sessionName) });
    const lines = want.length === 1 ? mcpEnableCardLines(want[0]!.row, facts(want[0]!)) : mcpBatchCardLines(want.map((c) => ({ row: c.row, f: facts(c) })), { via, at });
    const shown = batchCardBlock(lines);
    const max = this.#o.maxCardChars ?? MAX_CARD_CHARS;
    if (shown.size > max) throw bad('servers', `the card that turns ${want.length === 1 ? 'this server' : `these ${want.length} servers`} on would be ${shown.size} characters, over the ${max} a card shows in full`, { why: 'too-large', hint: 'turn fewer servers on in one card' });
    const one = (c: Item): Record<string, unknown> => ({ id: c.id, name: c.d.name, server: c.d.sessionName, source: c.d.source, scope: c.scope === 'all' ? 'all' : 'repo', repo: c.scope === 'all' ? null : c.scope.repo, transport: c.d.transport, host: c.row.host, envNames: c.row.envNames, headerNames: c.row.headerNames, needs: c.row.needs, shell: c.d.shell, fetches: c.d.fetches, launchHash: c.hash });
    const detail = want.length === 1 ? { action: 'mcp.enable', ...one(want[0]!), rootRows: [] } : { action: 'mcp.enable', servers: want.map(one), rootRows: [] };
    const cardId = mintId('card');
    const home = this.#o.home;
    const keys = want.map((c) => keyOf(c.id, c.scope));
    for (const c of want) this.#pending.set(keyOf(c.id, c.scope), { cardId, id: c.id, scope: c.scope });
    const stillSame = (c: Item): boolean => {
      const again = this.#find(c.id);
      return !!again && !again.problems.length && declHash(again, this.#o.launchKey) === c.hash;
    };
    try {
      const card = await this.#o.broker.raise({
        kind: 'grant',
        cardId,
        requestedBy: asker.principal!,
        attended: true,
        detail,
        lines,
        // a batch card's field blocks are wrapped, never cut (one server keeps the card it always had)
        // Aegis L3: the wrapped block on every enable card (one server too), so no line is ever cut
        block: shown.block,
        decisions: ['allow', 'deny'],
        handOnly: true,
        timeoutMs: MCP_ENABLE_CARD_TTL_MS,
        prepare: (decision: string) => {
          if (decision !== 'allow') return null;
          // TOCTOU, inside the one touch and BEFORE the presence prompt: when every server changed there is nothing
          // left to allow (no password for nothing)
          if (!want.some(stillSame)) throw bad('id', want.length === 1 ? MCP_CHANGED_WHILE_OPEN : MCP_ALL_CHANGED_WHILE_OPEN, { why: 'changed' });
          return null;
        },
        effect: async (decision, ctx) => {
          for (const k of keys) this.#pending.delete(k);
          if (decision !== 'allow') return;
          // re-check each server at allow: a changed one is skipped and reported, the rest turn on
          const ok = want.filter(stillSame);
          const skipped = want.filter((c) => !ok.includes(c));
          if (ok.length) {
            const s = readMcpServersStore(home);
            const stamp = new Date(now()).toISOString();
            s.enabled = [...s.enabled.filter((e) => !ok.some((c) => e.id === c.id && sameScope(e.scope, c.scope))), ...ok.map((c) => ({ id: c.id, scope: c.scope, launchHash: c.hash, at: stamp, cardId }))];
            writeMcpServersStore(home, s);
          }
          for (const c of ok) this.#o.emit?.({ event: 'mcp.user.enabled', id: c.id, server: c.d.sessionName, scope: c.scope === 'all' ? 'all' : 'repo', launchHash: c.hash, cardId });
          const connId = typeof ctx?.connId === 'string' ? ctx.connId : null;
          for (const c of skipped) this.#o.emit?.({ event: 'mcp.user.skipped-changed', id: c.id, server: c.d.sessionName, cardId, connId });
          if (skipped.length) {
            this.#skips.delete(cardId);
            this.#skips.set(cardId, { cardId, ids: skipped.map((c) => c.id), names: skipped.map((c) => c.d.name), on: ok.map((c) => c.id), connId, at: new Date(now()).toISOString() });
            while (this.#skips.size > MCP_SKIPS_KEPT) this.#skips.delete(this.#skips.keys().next().value!);
          }
        },
      });
      return { pending: true, cardId: card.cardId, id: want[0]!.id, ...(batch ? { ids: want.map((c) => c.id), unchanged } : {}) };
    } catch (err) {
      for (const k of keys) this.#pending.delete(k);
      throw err;
    }
  }
}
