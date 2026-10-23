/**
 * @symbol #gui-mcp-servers
 *
 * #gui-mcp-servers (T-2026-10-23-003): the Settings sheet's "MCP servers · kernel-owned" section. PURE: the section in
 * every state from the kernel's status.mcp, the requests a press sends and the words of every outcome. The press path
 * is ui/mcp-servers.ts; the DOM is ui/settings-sheet.ts (component settings-form rows: readonly rows with keys, and
 * the request row while a card waits).
 *
 *   - Every row is the kernel's status.mcp (names only: env and header NAMES, never a value).
 *   - Turning a server on raises ONE root card (the ⊙ gnomon grant family); while it waits the section shows the
 *     request line with Decide in the stack (rule form-says-where-the-card-is). Turning one off takes no card.
 *   - A server from the repo's own .mcp.json offers "On in <folder>" only: never "for all repos".
 *   - A server with a problem shows ✕ and the kernel's reason, and has no key.
 *   - Windows: rows show, keys don't; the how line says why (the root key lives in the Mac helper in 8.0).
 *
 * Keys name their press as `mcp:<verb>` (data-lm-act) with the server id (or the card id) as the value; the sheet routes
 * `mcp:` presses here, never through SETTINGS_RUNS.
 */
import { sanitizeDisplayText } from '@a-company/gnomon-contracts';
import type { FormKey, ResultView, SettingRow, SettingsSection } from './settings.js';

export const MCP_SECTION = 'mcp-servers' as const;
export const MCP_ENABLE_REQUEST = 'request.mcp.enable' as const;
export const MCP_DISABLE_REQUEST = 'request.mcp.disable' as const;
export const MCP_FIRST_PARTY = 'first-party:paradigm';

export const MCP_COPY = Object.freeze({
  title: 'MCP servers',
  owner: '· kernel-owned',
  intro: 'The MCP servers your Claude Code uses in your other projects. Gnomon runs the Paradigm MCP in every session; each of yours runs only after you turn it on, inside the session’s sandbox. Turning one on raises a root card; turning one off doesn’t. New sessions pick up a change.',
  notConnected: { value: 'not connected', how: 'Reconnect (⌘K, then “Reconnect”) to see your MCP servers.' },
  notOffered: { value: 'not offered by this kernel', how: 'Update Gnomon to bring your MCP servers into sessions.' },
  windows: 'Turning a server on takes the root key, which lives in the Mac helper in 8.0: not on Windows yet. The Paradigm MCP still runs.',
  none: { value: 'none found', how: 'Gnomon reads ~/.claude.json, your enabled Claude Code plugins and the repo’s .mcp.json. Add a server there with `claude mcp add`, then look again.' },
  fpHow: 'First-party: Gnomon runs it as `node <paradigm-mcp> <folder>` inside the session’s sandbox; its install folder is write-protected from sessions.',
  fpMissing: 'Install Paradigm (`npm install -g @a-company/paradigm`) and open a new session.',
  requestHow: 'Allow takes the root key and your presence. Deny keeps the server off.',
  decide: 'Decide in the stack',
  palette: 'MCP servers…',
});

export const SOURCE_WORDS: Readonly<Record<string, string>> = Object.freeze({ user: '~/.claude.json', local: '~/.claude.json, this folder', project: 'the repo’s .mcp.json', plugin: 'plugin' });

export interface McpRowView {
  id: string;
  name: string;
  sessionName: string;
  source: string;
  repo: string | null;
  plugin: { id: string; version: string | null } | null;
  transport: string;
  command: string | null;
  args: string[];
  url: string | null;
  host: string | null;
  envNames: string[];
  headerNames: string[];
  needs: string[];
  shell: string | null;
  fetches: string | null;
  problems: Array<{ code: string; text: string }>;
  on: { all: boolean; repos: string[] };
  changed: boolean;
}
export interface McpStatusView {
  state: 'not-connected' | 'not-offered' | 'ok';
  windows: boolean;
  envFile: string;
  firstParty: { on: boolean; available: boolean; version: string | null; why: string | null } | null;
  servers: McpRowView[];
  repos: Array<{ repo: string; folder: string; hsids: string[]; servers: McpRowView[] }>;
  pending: Array<{ cardId: string; id: string; scope: string; repo: string | null }>;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
/** Display text only (Aegis: a server's own words are untrusted; bidi and control characters are dropped). */
const shown = (v: unknown, n = 160): string => {
  const s = typeof v === 'string' ? sanitizeDisplayText(v).text : '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

function rowOf(v: unknown): McpRowView | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.name !== 'string') return null;
  const on = isObj(v.on) ? v.on : {};
  return {
    id: v.id,
    name: shown(v.name, 64),
    sessionName: shown(v.sessionName ?? v.name, 80),
    source: str(v.source) ?? 'user',
    repo: str(v.repo),
    plugin: isObj(v.plugin) && typeof v.plugin.id === 'string' ? { id: shown(v.plugin.id, 80), version: str(v.plugin.version) } : null,
    transport: str(v.transport) ?? 'stdio',
    command: v.command === null || v.command === undefined ? null : shown(v.command, 200),
    args: strs(v.args).map((a) => shown(a, 120)),
    url: v.url === null || v.url === undefined ? null : shown(v.url, 200),
    host: str(v.host),
    envNames: strs(v.envNames),
    headerNames: strs(v.headerNames),
    needs: strs(v.needs),
    shell: str(v.shell),
    fetches: str(v.fetches),
    problems: (Array.isArray(v.problems) ? v.problems : []).filter(isObj).map((p) => ({ code: String(p.code), text: shown(p.text, 240) })),
    on: { all: on.all === true, repos: strs(on.repos) },
    changed: v.changed === true,
  };
}

/** status.mcp as the section reads it. */
export function mcpStatusOf(status: unknown): McpStatusView {
  const empty = { windows: false, envFile: '~/.gnomon/loop-env', firstParty: null, servers: [], repos: [], pending: [] };
  if (!isObj(status)) return { state: 'not-connected', ...empty };
  const m = status.mcp;
  if (!isObj(m) || m.offered !== true || !Array.isArray(m.servers)) return { state: 'not-offered', ...empty };
  const fp = isObj(m.firstParty) ? m.firstParty : null;
  return {
    state: 'ok',
    windows: m.unsupported === 'platform' || m.platform === 'win32',
    envFile: str(m.envFile) ?? '~/.gnomon/loop-env',
    firstParty: fp ? { on: fp.on === true, available: fp.available === true, version: str(fp.version), why: fp.why ? shown(fp.why, 200) : null } : null,
    servers: m.servers.map(rowOf).filter((r): r is McpRowView => r !== null),
    repos: (Array.isArray(m.repos) ? m.repos : []).filter(isObj).map((r) => ({ repo: String(r.repo), folder: shown(r.folder, 80), hsids: strs(r.hsids), servers: (Array.isArray(r.servers) ? r.servers : []).map(rowOf).filter((x): x is McpRowView => x !== null) })),
    pending: (Array.isArray(m.pending) ? m.pending : []).filter(isObj).map((p) => ({ cardId: String(p.cardId), id: String(p.id), scope: String(p.scope), repo: str(p.repo) })),
  };
}

/** The section's transient state (ui/mcp-servers.ts owns it). */
export interface McpUi {
  /** a card this page asked for and is waiting on */
  request: { cardId: string; line: string } | null;
  /** a press in flight (its key shows busy) */
  busy: string | null;
  result: ResultView | null;
}
export const emptyMcpUi = (): McpUi => ({ request: null, busy: null, result: null });

/** What runs, in one line: the command and args, or the transport and its URL. */
export function runsWords(r: McpRowView): string {
  if (r.transport === 'stdio') return `runs ${r.command ?? '?'}${r.args.length ? ` ${r.args.join(' ')}` : ''}`;
  return `${r.transport} · ${r.url ?? r.host ?? '?'}`;
}

/** The how line: where it comes from, what it needs (names only), and what the card will say about it. */
export function howWords(r: McpRowView, envFile: string): string {
  const from = r.plugin ? `plugin ${r.plugin.id}${r.plugin.version ? ` ${r.plugin.version}` : ''}` : SOURCE_WORDS[r.source] ?? r.source;
  const parts = [`from ${from}`, runsWords(r)];
  if (r.envNames.length) parts.push(`env ${r.envNames.join(', ')} (values not shown)`);
  if (r.headerNames.length) parts.push(`headers ${r.headerNames.join(', ')} (values not shown)`);
  if (r.needs.length) parts.push(`takes ${r.needs.join(', ')} from \`${envFile}\``);
  if (r.shell) parts.push(`runs a shell (${r.shell})`);
  if (r.fetches) parts.push(`downloads what it runs at each launch (${r.fetches})`);
  if (r.transport !== 'stdio' && r.host) parts.push(`connects to ${r.host}`);
  return parts.join(' · ');
}

/** The value a row shows, with its mark: ✓ on, ✕ cannot run, ? changed since it was turned on. */
function stateOf(r: McpRowView, repo: string | null): { mark?: string; value: string } {
  if (r.problems.length) return { mark: '✕', value: r.problems[0]!.text };
  if (r.changed && !r.on.all && !(repo && r.on.repos.includes(repo))) return { mark: '?', value: 'changed since you turned it on: off until you turn it on again' };
  if (r.on.all) return { mark: '✓', value: 'on in every repo' };
  if (repo && r.on.repos.includes(repo)) return { mark: '✓', value: 'on in this folder' };
  if (r.on.repos.length) return { value: `on in ${r.on.repos.length} other folder${r.on.repos.length === 1 ? '' : 's'}` };
  return { value: 'off' };
}

function keysOf(r: McpRowView, repo: { repo: string; folder: string } | null, ui: McpUi, windows: boolean, pending: boolean): FormKey[] {
  if (windows || r.problems.length) return [];
  const busy = (act: string): Partial<FormKey> => (ui.busy === `${act}|${r.id}` ? { busy: true, disabled: true } : ui.busy || ui.request ? { disabled: true } : {});
  const keys: FormKey[] = [];
  const repoBound = r.source === 'project' || r.source === 'local';
  const onHere = !!repo && r.on.repos.includes(repo.repo);
  if (r.on.all || onHere) keys.push({ act: 'mcp:off', value: r.id, label: 'Turn off', quiet: true, ...busy('mcp:off') });
  if (!r.on.all && !repoBound && !pending) keys.push({ act: 'mcp:on-all', value: r.id, label: 'On for all repos', pri: !repo, ...busy('mcp:on-all') });
  if (!r.on.all && !onHere && repo && !pending && (!repoBound || r.repo === repo.repo)) keys.push({ act: 'mcp:on-repo', value: r.id, label: `On in ${repo.folder}`, pri: repoBound, ...busy('mcp:on-repo') });
  return keys;
}

export interface McpSectionInput {
  status: unknown;
  ui: McpUi;
  /** the focused session (its folder's servers show, and "On in <folder>") */
  hsid: string | null;
}

export function mcpSection(i: McpSectionInput): SettingsSection {
  const v = mcpStatusOf(i.status);
  const sec = (rows: SettingRow[]): SettingsSection => ({ id: MCP_SECTION, title: MCP_COPY.title, owner: MCP_COPY.owner, intro: MCP_COPY.intro, rows });
  if (v.state === 'not-connected') return sec([{ kind: 'readonly', id: 'mcp', label: 'MCP servers', value: MCP_COPY.notConnected.value, how: MCP_COPY.notConnected.how }]);
  if (v.state === 'not-offered') return sec([{ kind: 'readonly', id: 'mcp', label: 'MCP servers', value: MCP_COPY.notOffered.value, how: MCP_COPY.notOffered.how }]);
  const rows: SettingRow[] = [];
  const fp = v.firstParty;
  if (fp) {
    const k: FormKey[] = fp.available ? [{ act: fp.on ? 'mcp:fp-off' : 'mcp:fp-on', value: MCP_FIRST_PARTY, label: fp.on ? 'Turn off' : 'Turn on', quiet: fp.on, ...(i.ui.busy ? { disabled: true } : {}) }] : [];
    rows.push({ kind: 'readonly', id: 'mcp-paradigm', label: 'Paradigm MCP · first-party', value: !fp.available ? 'not installed' : fp.on ? `on in every session${fp.version ? ` · paradigm ${fp.version}` : ''}` : 'off', how: fp.available ? MCP_COPY.fpHow : MCP_COPY.fpMissing, ...(fp.available ? (fp.on ? { mark: '✓' } : {}) : { mark: '✕' }), ...(k.length ? { keys: k } : {}) });
  }
  const repo = i.hsid ? (v.repos.find((r) => r.hsids.includes(i.hsid!)) ?? null) : null;
  const pendingIds = new Set(v.pending.map((p) => p.id));
  const add = (r: McpRowView, n: number, label: string): void => {
    const st = stateOf(r, repo?.repo ?? null);
    const keys = keysOf(r, repo, i.ui, v.windows, pendingIds.has(r.id));
    rows.push({ kind: 'readonly', id: `mcp-${r.source}-${n}`, label, value: st.value, how: howWords(r, v.envFile), ...(st.mark ? { mark: st.mark } : {}), ...(n === 0 ? { grp: true } : {}), ...(keys.length ? { keys } : {}), title: `${r.sessionName} · tools mcp__${r.sessionName}__*` });
  };
  v.servers.forEach((r, n) => add(r, n, r.plugin ? `${r.name} · plugin` : r.name));
  if (repo) repo.servers.forEach((r, n) => add(r, n + v.servers.length, `${r.name} · ${repo.folder}${r.source === 'project' ? ' (repo)' : ''}`));
  if (!v.servers.length && !(repo?.servers.length)) rows.push({ kind: 'readonly', id: 'mcp-none', label: 'Your servers', value: MCP_COPY.none.value, how: MCP_COPY.none.how, grp: true });
  const req = i.ui.request ?? (v.pending[0] ? { cardId: v.pending[0].cardId, line: `turn on ${[...v.servers, ...(repo?.servers ?? [])].find((r) => r.id === v.pending[0]!.id)?.name ?? 'a server'} · ${v.pending[0].scope === 'all' ? 'all repos' : (v.pending[0].repo ?? '').split(/[\\/]/).pop()}` } : null);
  if (req) rows.push({ kind: 'request', id: 'mcp-request', label: 'Asked', chip: 'card waiting', line: req.line, keys: [{ act: 'mcp:decide', value: req.cardId, label: MCP_COPY.decide }], how: MCP_COPY.requestHow });
  else if (i.ui.result) rows.push({ kind: 'form', id: 'mcp-result', label: '', keys: [], result: i.ui.result });
  if (v.windows) rows.push({ kind: 'readonly', id: 'mcp-windows', label: 'On this PC', value: 'rows only', how: MCP_COPY.windows, grp: true });
  return sec(rows);
}

/** The request a press sends (log.append), or null for a press that sends nothing. */
export function mcpRequestOf(act: string, id: string, repo: string | null): { kind: string; payload: Record<string, unknown> } | null {
  switch (act) {
    case 'mcp:on-all':
      return { kind: MCP_ENABLE_REQUEST, payload: { id, scope: 'all' } };
    case 'mcp:on-repo':
      return repo ? { kind: MCP_ENABLE_REQUEST, payload: { id, scope: 'repo', repo } } : null;
    case 'mcp:off':
      return { kind: MCP_DISABLE_REQUEST, payload: { id } };
    case 'mcp:fp-on':
      return { kind: MCP_ENABLE_REQUEST, payload: { id: MCP_FIRST_PARTY } };
    case 'mcp:fp-off':
      return { kind: MCP_DISABLE_REQUEST, payload: { id: MCP_FIRST_PARTY } };
    default:
      return null;
  }
}

export const turnedOffResult = (name: string, at: string): ResultView => ({ lead: 'Turned off', text: ` ${name} at ${at}. New sessions won’t start it.` });
export const turnedOnResult = (name: string, at: string): ResultView => ({ lead: 'On', text: ` ${name} at ${at}. New sessions start it.` });
export const notChangedResult = (name: string, at: string, why: 'denied' | 'expired'): ResultView => ({ lead: 'Not changed:', text: ` ${name} stays off; the card was ${why} at ${at}.` });
