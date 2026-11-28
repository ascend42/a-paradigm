/**
 * @symbol #mcp-setup
 *
 * Set up a mod's MCP server from the person's own Claude Code config (8.2 fixes item 1, T-2026-11-28-001; design
 * items-1-2-design.md, Aegis items-1-2-aegis.md conditions 1-12; founder TD-2026-11-28-518 / -897).
 *
 * A mod whose effective launch is not an absolute command is `needs-config` (#mcp-passthrough mergeDeskMcp never adds
 * it). The person usually already runs that server in Claude Code. This module pairs each needs-config mod with the
 * matching servers #mcp-servers discovered, and builds the override copy ON THE KERNEL SIDE. Values never travel to the
 * GUI and back: status carries names only, a request names the server by its declaration id (`from`), and the kernel
 * re-discovers and rebuilds the copy.
 *
 * MATCHING (deterministic; there is NO manifest `match` field: TD-2026-11-28-897 deferred it):
 *   name     the server key equals the mod's name part (`gnomon.neurons` ⇒ `neurons`) or the mod id
 *   command  the basename of the server's command, or of its first non-flag arg (.js/.mjs/.cjs/.ts/.exe dropped),
 *            equals the basename of the manifest's command
 *   order    user, then plugin, then local; inside one source, the order Claude Code lists them
 *   project  a repo's own .mcp.json server is NEVER a candidate (Aegis Q2): a disabled row with its reason, no copy
 *
 * DISQUALIFIED (listed with its reason, never preselected, never copied): a declaration problem (law-7, env-name,
 * not on the session PATH, args too long…), a transport other than stdio, inline code (node -e), a `${NAME}` ref (a mod
 * override has no loop-env path), an arg that looks like a secret (shownArgs would hide it: the card prints args raw),
 * or a copy the manifest's `config` does not permit (checkMcpOverride throws). Reasons come from the closed
 * SETUP_PROBLEMS list, never from a thrown message.
 *
 * THE COPY (McpUserConfig, kernel only): command = the PATH-found path (d.resolved, found on the SESSION PATH, never
 * the daemon's; the card shows its realpath too); args as they are; env = only the names the manifest's config.env
 * declares minus config.secret (the others are named in envDropped / envSecret, never copied).
 *
 * ONE PRESS (Aegis condition 6): only a first-party (verified-tier) mod, and only a user-scope candidate or a plugin
 * candidate matched by command AND name. A local candidate is never preselected and never one press (condition 1).
 * Everything else gets the pre-filled "Review first" form only.
 *
 * REQUEST request.mod.setup{items:[{name, from, command?, args?, env?}]} (1..MOD_SETUP_MAX; dispatcher-only, never a
 * row; ^mod-mcp-config): the human on a gui or device connection. Validate everything first; any refusal names
 * items[i] and field names, never a value. ONE root-class grant card, detail.action 'mod.mcp.setup', one fieldLines
 * block per mod, never standing, never voice. The card-size cap refuses, never cuts. At allow each item's launch hash is
 * checked again against a fresh rebuild; a changed item is skipped and named; the store gets EXACTLY the config whose
 * hash the card showed (never a fresh copy).
 *
 * EVENTS (names only): mcp.setup.offered{mod, declId, source} when a mod's candidate set changes (not per status read),
 * mcp.setup.requested{mods, cardId}, mcp.setup.set{mod, cardId}, mcp.setup.skipped{mod, cardId, why} (why from
 * SETUP_SKIPS).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mintId, parseModId } from '@a-company/gnomon-contracts';
import { batchCardBlock } from '../broker/batch-card.js';
import type { ApprovalBroker } from '../broker/broker.js';
import { resolveMcpLaunch, type ManifestMcp, type McpUserConfig } from '../manifest/manifest.js';
import { RpcRefusal } from '../socket/rpc.js';
import { fieldLines, MAX_CARD_CHARS } from '../supervisor/permission.js';
import { checkMcpOverride, effectiveLaunch, isAbsoluteCommand, launchHashOf, readMcpConfigRequest, readMcpOverrides, serverNameOf, writeMcpOverride, type DeskMod, type McpLaunch, type McpOverrides } from './mcp-passthrough.js';
import { autoAllowRules, discoverMcpServers, fetchesOf, inlineOf, mcpServerRow, shellOf, shownArgs, type McpServerDecl, type McpServerRow } from './mcp-servers.js';
import { mcpServerFactLines, readMcpServersStore } from './mcp-server-cards.js';

export const MOD_SETUP_REQUEST = 'request.mod.setup' as const;
/** At most this many mods on one setup card (more is refused, never cut). */
export const MOD_SETUP_MAX = 8;
export const MOD_SETUP_CARD_TTL_MS = 24 * 3600 * 1000;

/** Why a discovered server cannot be copied (closed; the row says SETUP_PROBLEM_TEXT[code]). */
export const SETUP_PROBLEMS = Object.freeze(['project', 'problem', 'transport', 'inline', 'ref', 'secret-arg', 'not-permitted'] as const);
export type SetupProblem = (typeof SETUP_PROBLEMS)[number];
export const SETUP_PROBLEM_TEXT: Readonly<Record<SetupProblem, string>> = Object.freeze({
  project: "it comes from a repo's .mcp.json, written by the repo: a mod's launch applies to every repo, so it is never copied",
  problem: 'Claude Code lists it, but Gnomon cannot run it as it is',
  transport: 'it is a remote server; a mod server runs as a local command',
  inline: 'it runs inline code (node -e and the like)',
  ref: 'it takes a ${NAME} value, which a mod launch cannot take',
  'secret-arg': 'an argument looks like a secret, and the card would print it',
  'not-permitted': "this mod's manifest does not let you set that command, args or env",
});

/** Why a request item is refused or skipped at allow (closed: replies and events use these, never a thrown message). */
export const SETUP_REFUSALS = Object.freeze(['not-installed', 'no-server', 'configured', 'card-pending', 'stale', 'project', 'disqualified', 'secret-arg', 'not-permitted', 'twice', 'too-many', 'too-large'] as const);
export type SetupRefusal = (typeof SETUP_REFUSALS)[number];
const REFUSAL_TEXT: Readonly<Record<SetupRefusal, string>> = Object.freeze({
  'not-installed': 'is not an installed, granted, unpaused mod',
  'no-server': 'declares no MCP server',
  configured: 'already launches (it is not waiting for setup)',
  'card-pending': 'already has a launch card waiting: decide it first',
  stale: 'that server is no longer in your Claude Code config as it was: look again',
  project: "a repo's .mcp.json server is never copied into a mod launch",
  disqualified: 'that server cannot be copied (status names why)',
  'secret-arg': 'an argument looks like a secret, and the card would print it: put it in an env name the mod declares',
  'not-permitted': "the mod's manifest does not let you set that field this way",
  twice: 'names the same mod twice',
  'too-many': `at most ${MOD_SETUP_MAX} mods on one card`,
  'too-large': 'the card would be longer than a card shows in full: set up fewer at once',
});
/** Why an item was skipped at allow (closed). */
export const SETUP_SKIPS = Object.freeze(['changed', 'gone', 'configured'] as const);
export type SetupSkip = (typeof SETUP_SKIPS)[number];

export type SetupMatch = 'name' | 'command' | 'both';

/** A candidate as the KERNEL holds it (the copy has values). Never sent anywhere: see setupRow. */
export interface SetupCandidate {
  mod: string;
  decl: McpServerDecl;
  match: SetupMatch;
  /** the override copy; null when disqualified */
  config: McpUserConfig | null;
  envDropped: string[];
  envSecret: string[];
  problem: SetupProblem | null;
  /** the scope words for a local source (was folder-only; a mod launch applies everywhere) */
  scopeNote: string | null;
  /** one press is allowed (Aegis condition 6) */
  oneTap: boolean;
}

/** What a candidate SAYS (status, GUI): names, never values. */
export interface SetupRow {
  declId: string;
  name: string;
  source: McpServerDecl['source'];
  plugin: { id: string; version: string | null } | null;
  match: SetupMatch;
  command: string | null;
  realCommand: string | null;
  args: string[];
  envNames: string[];
  envDropped: string[];
  envSecret: string[];
  problem: string | null;
  problemCode: SetupProblem | null;
  scopeNote: string | null;
  oneTap: boolean;
  preselected: boolean;
}

const RUNNABLE_EXT = /\.(js|mjs|cjs|ts|mts|cts|exe)$/i;
const baseOf = (s: string): string => path.basename(s.replace(/\\/g, '/')).replace(RUNNABLE_EXT, '').toLowerCase();
const realOr = (p: string): string => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
};

/** How a server matches a mod, or null (name: the key; command: the command's or first non-flag arg's basename). */
export function matchOf(mod: string, entry: ManifestMcp, d: McpServerDecl): SetupMatch | null {
  const part = parseModId(mod)?.name ?? mod;
  const byName = d.name === part || d.name === mod;
  const want = baseOf(entry.command);
  const firstArg = d.args.find((a) => !a.startsWith('-'));
  const byCommand = want.length > 0 && ((d.command !== undefined && baseOf(d.resolved ?? d.command) === want) || (firstArg !== undefined && baseOf(firstArg) === want));
  return byName && byCommand ? 'both' : byName ? 'name' : byCommand ? 'command' : null;
}

export const LOCAL_SCOPE_NOTE = (repo: string): string => `was for folder ${path.basename(repo)} only (${repo}); a mod launch applies to every repo`;

/** One candidate: disqualify, or build the override copy (kernel side). */
export function candidateOf(mod: DeskMod, entry: ManifestMcp, d: McpServerDecl, match: SetupMatch, platform: string = process.platform): SetupCandidate {
  const cfg = entry.config ?? {};
  const declared = new Set(cfg.env ?? []);
  const secret = new Set(cfg.secret ?? []);
  const names = Object.keys(d.env).sort();
  const envSecret = names.filter((n) => declared.has(n) && secret.has(n));
  const envDropped = names.filter((n) => !declared.has(n));
  const base = { mod: mod.name, decl: d, match, envDropped, envSecret, scopeNote: d.source === 'local' && d.repo ? LOCAL_SCOPE_NOTE(d.repo) : null };
  const no = (problem: SetupProblem): SetupCandidate => ({ ...base, config: null, problem, oneTap: false });
  if (d.source === 'project') return no('project');
  if (d.transport !== 'stdio') return no('transport');
  if (d.problems.length || !d.resolved) return no('problem');
  if (d.inline) return no('inline');
  if (Object.keys(d.refs).length || d.args.some((a) => a.includes('${'))) return no('ref');
  if (shownArgs(d.args).some((a, i) => a !== d.args[i])) return no('secret-arg');
  const config: McpUserConfig = { command: d.resolved };
  const argsSame = JSON.stringify(d.args) === JSON.stringify(entry.args ?? []);
  if (cfg.args === true) config.args = [...d.args];
  else if (!argsSame) return no('not-permitted');
  const env = Object.fromEntries(names.filter((n) => declared.has(n) && !secret.has(n)).map((n) => [n, d.env[n]!]));
  if (Object.keys(env).length) config.env = env;
  let checked: McpUserConfig;
  try {
    checked = checkMcpOverride(entry, config, platform);
  } catch {
    return no('not-permitted');
  }
  const oneTap = mod.tier === 'first-party' && (d.source === 'user' || (d.source === 'plugin' && match === 'both'));
  return { ...base, config: checked, problem: null, oneTap };
}

const SOURCE_RANK: Readonly<Record<McpServerDecl['source'], number>> = { user: 0, plugin: 1, local: 2, project: 3 };

/** Does this mod wait for setup (its effective launch is not an absolute command)? */
export function needsConfig(mod: DeskMod, overrides: McpOverrides, platform: string = process.platform): boolean {
  const entry = mod.manifest.provides?.mcp?.[0];
  if (!entry) return false;
  return !isAbsoluteCommand(effectiveLaunch(entry, overrides[mod.name], platform).launch.command);
}

/**
 * Every needs-config mod's candidates, in match order (user, plugin, local, then the project rows). Configured mods
 * are offered nothing. Pure over its inputs.
 */
export function setupCandidates(i: { mods: readonly DeskMod[]; decls: readonly McpServerDecl[]; overrides: McpOverrides; platform?: string }): Map<string, SetupCandidate[]> {
  const platform = i.platform ?? process.platform;
  const out = new Map<string, SetupCandidate[]>();
  for (const m of i.mods) {
    const entry = m.manifest.provides?.mcp?.[0];
    if (!entry || !needsConfig(m, i.overrides, platform)) continue;
    const hits: SetupCandidate[] = [];
    i.decls.forEach((d) => {
      const match = matchOf(m.name, entry, d);
      if (match) hits.push(candidateOf(m, entry, d, match, platform));
    });
    const order = new Map(i.decls.map((d, k) => [d, k]));
    hits.sort((a, b) => SOURCE_RANK[a.decl.source] - SOURCE_RANK[b.decl.source] || order.get(a.decl)! - order.get(b.decl)!);
    out.set(m.name, hits);
  }
  return out;
}

/** The candidate a press sends: the first usable one that is not local (Aegis condition 1), or null. */
export function preselectedOf(cs: readonly SetupCandidate[]): SetupCandidate | null {
  return cs.find((c) => !c.problem && c.decl.source !== 'local') ?? null;
}

/** A candidate as status shows it (names only; args through shownArgs, which a copy already equals). */
export function setupRow(c: SetupCandidate, preselected: boolean): SetupRow {
  const r = mcpServerRow(c.decl);
  const cmd = c.decl.resolved ?? c.decl.command ?? null;
  return {
    declId: c.decl.id,
    name: c.decl.name,
    source: c.decl.source,
    plugin: r.plugin,
    match: c.match,
    command: cmd,
    realCommand: cmd && path.isAbsolute(cmd) ? realOr(cmd) : null,
    args: r.args,
    envNames: c.config?.env ? Object.keys(c.config.env).sort() : [],
    envDropped: [...c.envDropped],
    envSecret: [...c.envSecret],
    problem: c.problem ? (c.problem === 'problem' && c.decl.problems[0] ? c.decl.problems[0].text : SETUP_PROBLEM_TEXT[c.problem]) : null,
    problemCode: c.problem,
    scopeNote: c.scopeNote,
    oneTap: c.oneTap,
    preselected,
  };
}

/* ── the setup card ──────────────────────────────────────────────────────── */

export const PLUGIN_THIRD_PARTY = (id: string, version: string | null, root: string): string => `the plugin ${id}${version ? ` ${version}` : ''} is third-party code, installed at ${root}`;
export const PLUGIN_OUTLIVES = 'this copy stays on if you later disable, update or uninstall the plugin in Claude Code';
export const REQUESTED_VIA = (credential: string | undefined): string => (credential === 'gui' ? 'requested via: the Mods panel in the Gnomon app, on your own connection' : "requested via: this home's device connection");

/** One item ready for the card: the merged copy, its launch and hash, what the person edited. */
export interface SetupItem {
  cand: SetupCandidate;
  entry: ManifestMcp;
  config: McpUserConfig;
  launch: McpLaunch;
  hash: string;
  edited: Array<'command' | 'args' | 'env'>;
  /** the enabled user servers that run the same command and args */
  duplicates: string[];
}

/** The row of the MERGED launch (Aegis condition 7: facts are recomputed on what will run, not on the source). */
export function mergedRow(it: Pick<SetupItem, 'cand' | 'launch'>): McpServerRow {
  const r = mcpServerRow(it.cand.decl);
  return { ...r, command: it.launch.command, args: shownArgs(it.launch.args), envNames: Object.keys(it.launch.env).sort(), headerNames: [], needs: [], shell: shellOf(it.launch.command), fetches: fetchesOf(it.launch.command, it.launch.args), inline: inlineOf(it.launch.command, it.launch.args) };
}

/** The lines of one mod's block on the setup card (names only, never a value). */
export function setupItemLines(it: SetupItem, o: { userHome: string }): string[] {
  const d = it.cand.decl;
  const server = serverNameOf(it.cand.mod);
  const real = realOr(it.launch.command);
  return [
    `set how mod ${it.cand.mod} launches its MCP server ${server}, from your ${d.name} server`,
    ...mcpServerFactLines(mergedRow(it), { scope: 'all', via: 'settings', at: 0, launchHash: it.hash, pluginRoot: d.plugin?.root ?? null, autoAllowed: autoAllowRules(o.userHome, server) }),
    `command ${it.launch.command}${real !== it.launch.command ? ` → ${real}` : ''}`,
    ...(it.edited.length ? [`edited by you: ${it.edited.join(', ')}`] : []),
    ...(d.plugin ? [PLUGIN_THIRD_PARTY(d.plugin.id, d.plugin.version, d.plugin.root), PLUGIN_OUTLIVES] : []),
    ...(it.cand.scopeNote ? [it.cand.scopeNote] : []),
    ...(it.cand.envDropped.length ? [`not copied (this mod does not take them): ${it.cand.envDropped.join(', ')}`] : []),
    ...(it.cand.envSecret.length ? [`not copied (marked secret; Gnomon cannot store a secret for a mod yet): ${it.cand.envSecret.join(', ')}`] : []),
    ...it.duplicates.map((n) => `also on as your server ${n}; sessions get both`),
    'every new session in every repo starts this command as you, under the session sandbox',
  ];
}

export function setupCardLines(items: readonly SetupItem[], o: { userHome: string; credential: string | undefined }): string[] {
  const n = items.length;
  return [
    n === 1 ? `Set up mod ${items[0]!.cand.mod}'s MCP server from your Claude Code config` : `Set up ${n} mod MCP servers from your Claude Code config`,
    REQUESTED_VIA(o.credential),
    ...items.flatMap((it, i) => fieldLines(`mod ${i + 1} of ${n}: ${it.cand.mod}`, setupItemLines(it, o).join('\n'))),
    `Allow takes the root key and your presence (Touch ID or your Mac password)${n > 1 ? `, once for all ${n}` : ''} · never standing, never by voice; a server that changes before you allow is skipped and named; deny changes nothing`,
  ];
}

/* ── the kernel half: status offers and request.mod.setup ───────────────── */

export interface ModSetupAsker {
  connId: string;
  principal: string | undefined;
  principalClass: string;
  credential: string | undefined;
}

export interface ModSetupOptions {
  home: string;
  broker: Pick<ApprovalBroker, 'raise' | 'card'>;
  mods: () => readonly DeskMod[];
  userHome: string;
  /** the session PATH dirs (never the daemon's PATH) */
  pathDirs: () => readonly string[];
  /** the live sessions' folders (their local servers are candidates, flagged) */
  liveRepos?: () => readonly string[];
  launchKey: Buffer;
  platform?: string;
  emit?: (e: Record<string, unknown>) => void;
  maxCardChars?: number;
}

const bad = (field: string, why: SetupRefusal, at: string, data: Record<string, unknown> = {}): RpcRefusal =>
  new RpcRefusal('BAD_REQUEST', 'bad-params', `${MOD_SETUP_REQUEST}: ${at ? `${at}: ` : ''}${REFUSAL_TEXT[why]}`, { field, why, ...data });

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export class ModSetup {
  readonly #o: ModSetupOptions;
  /** mod → its waiting setup card */
  readonly #pending = new Map<string, string>();
  /** mod → the candidate-set key last offered (mcp.setup.offered fires on a change only; Aegis note 4) */
  readonly #offered = new Map<string, string>();

  constructor(o: ModSetupOptions) {
    this.#o = o;
  }

  #platform(): string {
    return this.#o.platform ?? process.platform;
  }

  #candidates(mods: readonly DeskMod[] = this.#o.mods()): Map<string, SetupCandidate[]> {
    const decls = discoverMcpServers({ userHome: this.#o.userHome, repos: this.#o.liveRepos?.() ?? [], pathDirs: this.#o.pathDirs(), platform: this.#platform() });
    return setupCandidates({ mods, decls, overrides: readMcpOverrides(this.#o.home), platform: this.#platform() });
  }

  /** The waiting setup card of a mod, or null. */
  pendingOf(mod: string): string | null {
    const id = this.#pending.get(mod);
    if (!id) return null;
    const c = this.#o.broker.card(id);
    if (!c || c.state !== 'pending') {
      this.#pending.delete(mod);
      return null;
    }
    return id;
  }

  /** status.mods.installed[].mcp.setup per needs-config mod (names only). */
  offers(): Map<string, SetupRow[]> {
    const out = new Map<string, SetupRow[]>();
    for (const [mod, cs] of this.#candidates()) {
      const pre = preselectedOf(cs);
      out.set(mod, cs.map((c) => setupRow(c, c === pre)));
      const key = cs.map((c) => `${c.decl.id}:${c.problem ?? 'ok'}`).join('|');
      if (this.#offered.get(mod) !== key) {
        this.#offered.set(mod, key);
        for (const c of cs) this.#o.emit?.({ event: 'mcp.setup.offered', mod, declId: c.decl.id, source: c.decl.source });
      }
    }
    return out;
  }

  /** request.mod.setup{items:[{name, from, command?, args?, env?}]} (^mod-mcp-config). */
  async request(asker: ModSetupAsker, payload: unknown): Promise<Record<string, unknown>> {
    if (asker.principalClass !== 'human' || !asker.principal || (asker.credential !== 'gui' && asker.credential !== 'device')) {
      throw new RpcRefusal('FORBIDDEN', 'human-only', `${MOD_SETUP_REQUEST} is the human's, on a gui or device connection (never voice, an agent or a session)`);
    }
    if (!isObj(payload) || Object.keys(payload).some((k) => k !== 'items')) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `${MOD_SETUP_REQUEST} takes {items:[{name, from, command?, args?, env?}]}`, { field: 'items' });
    const list = payload.items;
    if (!Array.isArray(list) || list.length === 0) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `${MOD_SETUP_REQUEST}: items is a non-empty list`, { field: 'items' });
    if (list.length > MOD_SETUP_MAX) throw bad('items', 'too-many', '', { max: MOD_SETUP_MAX });
    const mods = this.#o.mods();
    const cands = this.#candidates(mods);
    const overrides = readMcpOverrides(this.#o.home);
    const store = readMcpServersStore(this.#o.home);
    const discovered = discoverMcpServers({ userHome: this.#o.userHome, repos: [], pathDirs: this.#o.pathDirs(), platform: this.#platform() });
    const onUser = discovered.filter((d) => d.transport === 'stdio' && d.resolved && store.enabled.some((e) => e.id === d.id));
    const seen = new Set<string>();
    const items: SetupItem[] = list.map((raw, i) => {
      const at = `items[${i}]`;
      if (!isObj(raw)) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `${MOD_SETUP_REQUEST}: ${at} is {name, from, command?, args?, env?}`, { field: at });
      for (const k of Object.keys(raw)) if (!['name', 'from', 'command', 'args', 'env'].includes(k)) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `${MOD_SETUP_REQUEST}: ${at}: unknown field ${k.slice(0, 32)}`, { field: `${at}.${k.slice(0, 32)}` });
      if (typeof raw.name !== 'string' || !parseModId(raw.name)) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `${MOD_SETUP_REQUEST}: ${at}.name is a mod id`, { field: `${at}.name` });
      if (typeof raw.from !== 'string' || raw.from.length === 0 || raw.from.length > 2048) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `${MOD_SETUP_REQUEST}: ${at}.from names one server (status.mods.installed[].mcp.setup[].declId)`, { field: `${at}.from` });
      const name = raw.name;
      if (seen.has(name)) throw bad(at, 'twice', at, { name });
      seen.add(name);
      const mod = mods.find((m) => m.name === name);
      if (!mod) throw bad(`${at}.name`, 'not-installed', at, { name });
      const entry = mod.manifest.provides?.mcp?.[0];
      if (!entry) throw bad(`${at}.name`, 'no-server', at, { name });
      if (!needsConfig(mod, overrides, this.#platform())) throw bad(`${at}.name`, 'configured', at, { name });
      if (this.pendingOf(name) || readMcpConfigRequest(this.#o.home, name)) throw bad(`${at}.name`, 'card-pending', at, { name });
      const cand = (cands.get(name) ?? []).find((c) => c.decl.id === raw.from);
      if (!cand) throw bad(`${at}.from`, 'stale', at, { name });
      if (cand.problem === 'project') throw bad(`${at}.from`, 'project', at, { name });
      // the person's own edits override only their field (a value is never sent by the GUI unless typed)
      const edits = parseEdits(raw, at);
      if (cand.problem && !(cand.problem === 'secret-arg' && edits.args !== undefined)) throw bad(`${at}.from`, cand.problem === 'secret-arg' ? 'secret-arg' : cand.problem === 'not-permitted' ? 'not-permitted' : 'disqualified', at, { name });
      const item = this.#merge(cand, entry, edits, at);
      item.duplicates = onUser.filter((d) => d.resolved === item.launch.command && JSON.stringify(d.args) === JSON.stringify(item.launch.args)).map((d) => d.name);
      return item;
    });
    const lines = setupCardLines(items, { userHome: this.#o.userHome, credential: asker.credential });
    const shown = batchCardBlock(lines);
    if (shown.size > (this.#o.maxCardChars ?? MAX_CARD_CHARS)) throw bad('items', 'too-large', '');
    const cardId = mintId('card');
    for (const it of items) this.#pending.set(it.cand.mod, cardId);
    const home = this.#o.home;
    const stillSame = (it: SetupItem): SetupSkip | null => {
      const mod = this.#o.mods().find((m) => m.name === it.cand.mod);
      const entry = mod?.manifest.provides?.mcp?.[0];
      if (!mod || !entry) return 'gone';
      if (!needsConfig(mod, readMcpOverrides(home), this.#platform())) return 'configured';
      const again = (this.#candidates([mod]).get(mod.name) ?? []).find((c) => c.decl.id === it.cand.decl.id);
      if (!again || (again.problem && !(again.problem === 'secret-arg' && it.edited.includes('args')))) return 'changed';
      try {
        const re = this.#merge(again, entry, editsOf(it), '');
        return re.hash === it.hash ? null : 'changed';
      } catch {
        return 'changed';
      }
    };
    try {
      const card = await this.#o.broker.raise({
        kind: 'grant',
        cardId,
        requestedBy: asker.principal,
        attended: true,
        detail: { action: 'mod.mcp.setup', mods: items.map((it) => ({ name: it.cand.mod, server: serverNameOf(it.cand.mod), from: it.cand.decl.id, source: it.cand.decl.source, envNames: Object.keys(it.launch.env).sort(), edited: it.edited, launchHash: it.hash })), rootRows: [] },
        lines,
        block: shown.block,
        decisions: ['allow', 'deny'],
        handOnly: true,
        timeoutMs: MOD_SETUP_CARD_TTL_MS,
        prepare: (decision: string) => {
          if (decision === 'allow' && items.every((it) => stillSame(it) !== null)) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `${MOD_SETUP_REQUEST}: every server on the card changed while it was open: ask again`, { why: 'changed' });
          return null;
        },
        effect: async (decision) => {
          for (const it of items) if (this.#pending.get(it.cand.mod) === cardId) this.#pending.delete(it.cand.mod);
          if (decision !== 'allow') return;
          for (const it of items) {
            const why = stillSame(it);
            if (why) {
              this.#o.emit?.({ event: 'mcp.setup.skipped', mod: it.cand.mod, cardId, why });
              continue;
            }
            // exactly the config whose hash the card showed (Aegis Q6), never a fresh copy
            writeMcpOverride(home, it.cand.mod, it.config);
            this.#o.emit?.({ event: 'mcp.setup.set', mod: it.cand.mod, cardId, launchHash: it.hash });
          }
        },
      });
      this.#o.emit?.({ event: 'mcp.setup.requested', mods: items.map((it) => it.cand.mod), cardId: card.cardId });
      return { pending: true, cardId: card.cardId, mods: items.map((it) => it.cand.mod), note: 'the kernel raised the setup card: decide it in the stack' };
    } catch (err) {
      for (const it of items) if (this.#pending.get(it.cand.mod) === cardId) this.#pending.delete(it.cand.mod);
      throw err;
    }
  }

  /** The candidate's copy with the person's edits on top, checked (names items[i] and fields only). */
  #merge(cand: SetupCandidate, entry: ManifestMcp, edits: Edits, at: string): SetupItem {
    const base: McpUserConfig = cand.config ? { ...cand.config } : { command: cand.decl.resolved!, ...(entry.config?.args ? { args: [...cand.decl.args] } : {}) };
    const merged: McpUserConfig = { ...base };
    const edited: SetupItem['edited'] = [];
    if (edits.command !== undefined) {
      merged.command = edits.command;
      edited.push('command');
    }
    if (edits.args !== undefined) {
      merged.args = edits.args;
      edited.push('args');
    }
    if (edits.env !== undefined) {
      merged.env = { ...(base.env ?? {}), ...edits.env };
      edited.push('env');
    }
    // Aegis Q5: a secret-looking arg would print raw on the card: refused here (both request paths), not at launch
    if (shownArgs(merged.args ?? []).some((a, i) => a !== merged.args![i])) throw bad(`${at}.args`, 'secret-arg', at);
    let config: McpUserConfig;
    try {
      config = checkMcpOverride(entry, merged, this.#platform());
    } catch {
      throw bad(edited.length ? `${at}.${edited.join(',')}` : `${at}.from`, 'not-permitted', at);
    }
    const launch = resolveMcpLaunch(entry, config);
    return { cand, entry, config, launch, hash: launchHashOf(launch, this.#o.launchKey), edited, duplicates: [] };
  }
}

interface Edits {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

function editsOf(it: SetupItem): Edits {
  return {
    ...(it.edited.includes('command') ? { command: it.config.command! } : {}),
    ...(it.edited.includes('args') ? { args: [...(it.config.args ?? [])] } : {}),
    ...(it.edited.includes('env') ? { env: { ...(it.config.env ?? {}) } } : {}),
  };
}

function parseEdits(raw: Record<string, unknown>, at: string): Edits {
  const e: Edits = {};
  const refuse = (k: string, what: string): never => {
    throw new RpcRefusal('BAD_REQUEST', 'bad-params', `${MOD_SETUP_REQUEST}: ${at}.${k} ${what}`, { field: `${at}.${k}` });
  };
  if (raw.command !== undefined) {
    if (typeof raw.command !== 'string' || raw.command.length === 0 || raw.command.length > 1024) refuse('command', 'must be a non-empty string');
    e.command = raw.command as string;
  }
  if (raw.args !== undefined) {
    if (!Array.isArray(raw.args) || raw.args.length > 64 || raw.args.some((a) => typeof a !== 'string' || a.length > 1024)) refuse('args', 'must be at most 64 strings');
    e.args = [...(raw.args as string[])];
  }
  if (raw.env !== undefined) {
    if (!isObj(raw.env) || Object.keys(raw.env).length > 32 || Object.values(raw.env).some((v) => typeof v !== 'string' || v.length > 4096)) refuse('env', 'must be an object of at most 32 NAME: value strings');
    e.env = { ...(raw.env as Record<string, string>) };
  }
  return e;
}

/** The secret-arg rule for any request path (Aegis Q5): true when shownArgs would hide one of these args. */
export function hasSecretArg(args: readonly string[]): boolean {
  return shownArgs(args).some((a, i) => a !== args[i]);
}
