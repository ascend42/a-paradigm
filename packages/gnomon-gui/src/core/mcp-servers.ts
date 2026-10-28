/**
 * @symbol #gui-mcp-servers
 *
 * #gui-mcp-servers (T-2026-10-23-003): the Settings sheet's "MCP servers · kernel-owned" section. PURE: the section in
 * every state from the kernel's status.mcp, the requests a press sends and the words of every outcome. The press path
 * is ui/mcp-servers.ts; the DOM is ui/settings-sheet.ts (component settings-form rows: readonly rows with keys, and
 * the request row while a card waits).
 *
 *   - Every row is the kernel's status.mcp (names only: env and header NAMES, never a value).
 *   - One server, one press (Mika 2026-10-23, founder: fewer hurdles): On for all repos / On in <folder> raises its root
 *     card at once (request.mcp.enable{id, scope}); its request row shows under that server's row.
 *   - #batch-card (founder 2026-10-23: "grouped cards of related things, one password"): "Mark several" (the row after
 *     the last server) turns the keys into Mark for all repos / Mark in <folder>, which STAGE a server in the page (word
 *     and weight: "marked to turn on for all repos", Unmark); the marked row names the servers and the cost, "Turn on N
 *     servers · asks Touch ID or your Mac password once", and sends ONE request.mcp.enable{servers}. The kernel raises
 *     ONE root card (the ⊙ gnomon grant family) for them all. Clear marks (or Stop marking) brings the one-press keys
 *     back.
 *   - While a card waits, its servers show "off until you allow its card" and the request line with Decide in the
 *     stack (rule form-says-where-the-card-is); the other servers can be marked for the NEXT card; Turn on waits, and
 *     says so. Turning one off takes no card and applies at once, even while a card waits.
 *   - An allowed card that skipped a server (changed while it waited) names it in the outcome, with next:.
 *   - A server from the repo's own .mcp.json offers "On in <folder>" only: never "for all repos".
 *   - A server with a problem shows ✕ and the kernel's reason, and has no key.
 *   - Windows: rows show, keys don't; the how line says why (the root key lives in the Mac helper in 8.0).
 *   - C5'b (8.0:local-lane, Mika): per-server trust on the server's own row. A chip says untrusted, trusted or
 *     first-party by its word (never a hue); Trust… (untrusted and allowed) opens the preview INLINE under the row (a
 *     settings-form confirm block: checking, ready, expired, refused, committing), then the request row while the root
 *     card waits, then the outcome under the row. Clear trust (quiet) takes no card. A refusal that lasts shows no key;
 *     one that passes keeps Trust… aria-disabled, and the row's how line says why (trustRefusalWords), never the code.
 *
 * Keys name their press as `mcp:<verb>` (data-lm-act) with the server id (or the card id) as the value; the sheet routes
 * `mcp:` presses here, never through SETTINGS_RUNS.
 */
import { sanitizeDisplayText } from '@a-company/gnomon-contracts';
import type { FormKey, ResultView, SettingRow, SettingsSection } from './settings.js';

export const MCP_SECTION = 'mcp-servers' as const;
export const MCP_ENABLE_REQUEST = 'request.mcp.enable' as const;
export const MCP_DISABLE_REQUEST = 'request.mcp.disable' as const;
/** C5'b: request.mcp.trust{id, op: 'preview' | 'commit' | 'clear', token?} (kernel #mcp-servers, slice C5'a1). */
export const MCP_TRUST_REQUEST = 'request.mcp.trust' as const;
export const MCP_FIRST_PARTY = 'first-party:paradigm';
/** #batch-card: the kernel's cap of servers on one enable card (kernel MCP_ENABLE_MAX; status.mcp.max wins). */
export const MCP_ENABLE_MAX = 16;
/** The `at` of the batch's own outcome (it shows with the batch, not under a server). */
export const MCP_BATCH = 'batch';

export const MCP_COPY = Object.freeze({
  title: 'MCP servers',
  owner: '· kernel-owned',
  intro: 'The MCP servers your Claude Code uses in your other projects. Gnomon runs the Paradigm MCP in every session; each of yours runs only after you turn it on, inside the session’s sandbox. Turning one on raises a root card; to turn several on with one card and one Touch ID, use Mark several after the list. Turning one off takes no card. New sessions pick up a change.',
  notConnected: { value: 'not connected', how: 'Reconnect (⌘K, then “Reconnect”) to see your MCP servers.' },
  notOffered: { value: 'not offered by this kernel', how: 'Update Gnomon to bring your MCP servers into sessions.' },
  windows: 'Turning a server on takes the root key, which lives in the Mac helper in 8.0: not on Windows yet. The Paradigm MCP still runs.',
  none: { value: 'none found', how: 'Gnomon reads ~/.claude.json, your enabled Claude Code plugins and the repo’s .mcp.json. Add a server there with `claude mcp add`, then look again.' },
  fpHow: 'First-party: Gnomon runs it as `node <paradigm-mcp> <folder>` inside the session’s sandbox; its install folder is write-protected from sessions.',
  fpMissing: 'Install Paradigm (`npm install -g @a-company/paradigm`) and open a new session.',
  requestHow: 'Allow takes the root key and your presence. Deny keeps the server off.',
  /** a batch card: one presence for all of them (Mika: never "the server" for four) */
  requestHowMany: 'Allow takes the root key and your presence once for all of them. Deny keeps them off.',
  /** #batch-card: while a card waits, the other servers can be marked for the next card */
  markMeanwhile: ' Meanwhile you can mark the next servers; they go on the next card.',
  /** Mika: "marked: on" read as already on; the words say it is not on yet */
  markedWord: 'marked to turn on',
  /** the entry to marking, after the last server (one-press keys stay the default) */
  several: { label: 'Several at once', value: 'one card, one Touch ID or password', how: 'Mark the servers you want, then turn them all on with one root card.', key: 'Mark several' },
  noneMarked: { value: 'none yet', how: 'Press Mark on each server you want; Turn on shows here once one is marked.' },
  stopMarking: 'Stop marking',
  waitingWord: 'off until you allow its card',
  batchHow: 'One card lists every marked server, each with what it runs, its env names, its network host and your auto-allow rules. Allow takes the root key and your presence once.',
  batchWaits: 'Turn on waits until you decide the card above: one card at a time.',
  full: 'one card takes at most 16 servers',
  decide: 'Decide in the stack',
  palette: 'MCP servers…',
  /** Mika 2026-10-23: the Paradigm plugin copy is covered, not broken (no ✕) */
  covered: 'covered by the Paradigm MCP above (first-party)',
});

/** Mika 2026-10-23 (principle 5): a ✕ row says what to do next, by the kernel's problem code. */
export function problemNext(code: string, r: { source: string; plugin: { id: string } | null }): string {
  const where = r.plugin ? `the plugin ${r.plugin.id}` : SOURCE_WORDS[r.source] ?? r.source;
  switch (code) {
    case 'command':
    case 'plugin-path':
      return `next: install it, or give its full path in ${where}`;
    case 'remote':
      return `next: give it a public https URL in ${where}`;
    case 'env-name':
    case 'law-7':
      return `next: remove that variable from its entry in ${where}`;
    case 'name':
      return `next: rename it in ${where}`;
    default:
      return `next: change its entry in ${where}`;
  }
}

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
  /** inline code on the command line (node -e, python -c …) */
  inline: string | null;
  /** TD-2026-10-23-361 (H1): the human's own Claude Code allow rules that cover this server's tools */
  autoAllowed: string[];
  problems: Array<{ code: string; text: string }>;
  on: { all: boolean; repos: string[] };
  changed: boolean;
  /** C5'b: status.mcp row trust{level, why} (null: a kernel that does not report trust; no chip, no key) */
  trust: McpTrustView | null;
}
/** C5'b: a server's trust as the kernel reports it; why: the kernel's closed reason it cannot be trusted now, or null. */
export interface McpTrustView {
  level: 'untrusted' | 'trusted' | 'first-party';
  why: string | null;
}
export interface McpStatusView {
  state: 'not-connected' | 'not-offered' | 'ok';
  windows: boolean;
  envFile: string;
  firstParty: { on: boolean; available: boolean; version: string | null; why: string | null; dir: string | null; linked: boolean; autoAllowed: string[]; trust?: McpTrustView | null } | null;
  servers: McpRowView[];
  repos: Array<{ repo: string; folder: string; hsids: string[]; servers: McpRowView[] }>;
  pending: Array<{ cardId: string; id: string; scope: string; repo: string | null }>;
  /** #batch-card: the kernel's cap of servers on one card */
  max: number;
  /** the newest entry of skips (kept for an older kernel that sends only status.mcp.skipped) */
  skipped: McpSkip | null;
  /** kernel 09ecc6a8: per allowed card, the servers it skipped (changed while it waited), newest last, at most 16 */
  skips: McpSkip[];
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
    inline: str(v.inline),
    autoAllowed: strs(v.autoAllowed),
    problems: (Array.isArray(v.problems) ? v.problems : []).filter(isObj).map((p) => ({ code: String(p.code), text: shown(p.text, 240) })),
    on: { all: on.all === true, repos: strs(on.repos) },
    changed: v.changed === true,
    trust: trustOf(v.trust),
  };
}

function trustOf(v: unknown): McpTrustView | null {
  if (!isObj(v) || (v.level !== 'untrusted' && v.level !== 'trusted' && v.level !== 'first-party')) return null;
  return { level: v.level, why: typeof v.why === 'string' ? v.why : null };
}

/** One allowed card's skips (status.mcp.skips[i]): who decided it (connId) and which servers did turn on (on). */
export interface McpSkip {
  cardId: string;
  ids: string[];
  names: string[];
  /** the ids that turned on */
  on: string[];
  /** the connection that decided the card (null: not known, e.g. an older kernel) */
  connId: string | null;
  at: string | null;
}
/** the kernel keeps at most 16 (MCP_SKIPS_KEPT); the page reads no more */
export const MCP_SKIPS_SHOWN = 16;
function skipOf(v: unknown): McpSkip | null {
  if (!isObj(v) || typeof v.cardId !== 'string') return null;
  return { cardId: v.cardId, ids: strs(v.ids), names: strs(v.names).map((n) => shown(n, 64)), on: strs(v.on), connId: typeof v.connId === 'string' ? v.connId : null, at: typeof v.at === 'string' ? v.at : null };
}

/** status.mcp as the section reads it. */
export function mcpStatusOf(status: unknown): McpStatusView {
  const empty = { windows: false, envFile: '~/.gnomon/loop-env', firstParty: null, servers: [], repos: [], pending: [], max: MCP_ENABLE_MAX, skipped: null, skips: [] };
  if (!isObj(status)) return { state: 'not-connected', ...empty };
  const m = status.mcp;
  if (!isObj(m) || m.offered !== true || !Array.isArray(m.servers)) return { state: 'not-offered', ...empty };
  const fp = isObj(m.firstParty) ? m.firstParty : null;
  return {
    state: 'ok',
    windows: m.unsupported === 'platform' || m.platform === 'win32',
    envFile: str(m.envFile) ?? '~/.gnomon/loop-env',
    firstParty: fp ? { on: fp.on === true, available: fp.available === true, version: str(fp.version), why: fp.why ? shown(fp.why, 200) : null, dir: fp.dir ? shown(fp.dir, 200) : null, linked: fp.linked === true, autoAllowed: strs(fp.autoAllowed), trust: trustOf(fp.trust) } : null,
    servers: m.servers.map(rowOf).filter((r): r is McpRowView => r !== null),
    repos: (Array.isArray(m.repos) ? m.repos : []).filter(isObj).map((r) => ({ repo: String(r.repo), folder: shown(r.folder, 80), hsids: strs(r.hsids), servers: (Array.isArray(r.servers) ? r.servers : []).map(rowOf).filter((x): x is McpRowView => x !== null) })),
    pending: (Array.isArray(m.pending) ? m.pending : []).filter(isObj).map((p) => ({ cardId: String(p.cardId), id: String(p.id), scope: String(p.scope), repo: str(p.repo) })),
    max: typeof m.max === 'number' && m.max >= 1 ? Math.min(m.max, 64) : MCP_ENABLE_MAX,
    skipped: skipOf(m.skipped),
    // an older kernel sends only `skipped` (the newest): read it as a list of one
    skips: Array.isArray(m.skips) ? m.skips.slice(-MCP_SKIPS_SHOWN).map(skipOf).filter((x): x is McpSkip => x !== null) : [skipOf(m.skipped)].filter((x): x is McpSkip => x !== null),
  };
}

/** #batch-card: one server marked for the next card, with its scope. */
export interface McpMarked {
  id: string;
  name: string;
  scope: 'all' | 'repo';
  /** repo scope: the folder's path */
  repo: string | null;
  /** repo scope: the folder's name */
  folder: string | null;
}

/** The section's transient state (ui/mcp-servers.ts owns it). */
export interface McpUi {
  /** the server the last press was for (its result row shows under that server's row, Mika), or MCP_BATCH */
  at?: string | null;
  /** #batch-card: the servers marked for the next card, in the order marked (staged in the page until Turn on) */
  staged: readonly McpMarked[];
  /** "Mark several" was pressed: the rows offer Mark keys (also while anything is marked or a card waits) */
  marking?: boolean;
  /** the card this page asked for and is waiting on (ids: the servers on it) */
  request: { cardId: string; line: string; ids?: string[] } | null;
  /** a press in flight (its key shows busy) */
  busy: string | null;
  result: ResultView | null;
  /** C5'b: the trust preview open under one server's row (ui/mcp-servers.ts TrustFlow holds its token), or null */
  trust?: McpTrustUi | null;
}
export const emptyMcpUi = (): McpUi => ({ at: null, staged: [], marking: false, request: null, busy: null, result: null, trust: null });

/* ── C5'b per-server trust ──────────────────────────────────────── */

/** The trust panel's phases (the C4'b tier sheet's, inline): checking → ready → committing → pending; expired, refused. */
export type TrustPhase = 'checking' | 'ready' | 'expired' | 'refused' | 'committing' | 'pending';
export interface McpTrustUi {
  id: string;
  /** display text (a server's name is untrusted text) */
  name: string;
  phase: TrustPhase;
  /** the kernel's notice, verbatim (display text) */
  notice: string | null;
  /** the tools that would run with no card (display text) */
  reads: string[];
  expiresAt: string | null;
  /** refused: the plain words ("Not changed: …"); expired: why Preview again */
  result: ResultView | null;
  /** pending: the trust card */
  cardId: string | null;
}

export const TRUST_COPY = Object.freeze({
  chip: Object.freeze({ untrusted: 'untrusted', trusted: 'trusted', 'first-party': 'first-party' }) as Readonly<Record<McpTrustView['level'], string>>,
  trust: 'Trust…',
  clear: 'Clear trust',
  commit: 'Trust · root card',
  cancel: 'Cancel',
  again: 'Preview again',
  checking: 'Checking what Gnomon would trust…',
  committing: 'Raising the card…',
  noReads: 'No tool runs without a card. Trust lets you make Always rules for its tools.',
  readsLead: 'These run with no card:',
  /** the panel's own words (Mika: the kernel's notice stays on the card, which is what is signed) */
  believe: (name: string): string => `Gnomon will believe what ${name} says about its tools.`,
  after: 'You can make Always rules for its other tools. Tools that change or delete things still ask each time. Trust ends by itself if its command, arguments, environment or tool list changes.',
  close: 'Close',
  expired: 'Not changed: this preview expired.',
  stale: 'Not changed: the server changed since the preview.',
  pendingChip: 'card waiting',
  requestHow: 'Allow takes the root key and your presence. Deny keeps it untrusted.',
  /** the reads list shows at most this many, then "+N more" */
  readsMax: 12,
});

/** "the plugin x" or the config file a server comes from (problemNext's where). */
const whereOf = (r: { source: string; plugin: { id: string } | null }): string => (r.plugin ? `the plugin ${r.plugin.id}` : (SOURCE_WORDS[r.source] ?? r.source));

/**
 * C5'b (Mika's table): why a server can't be trusted now, in plain words with next:, and whether Trust… shows at all.
 * key 'none': a refusal that lasts (no key); 'disabled': one that passes (Trust… stays, aria-disabled). The kernel's code
 * is never shown: an unknown one reads as a generic line.
 */
export function trustRefusalWords(why: string, r: { source: string; plugin: { id: string } | null } = { source: 'user', plugin: null }): { key: 'none' | 'disabled'; how: string } {
  switch (why) {
    case 'platform':
    case 'problem':
    case 'not-found':
    case 'first-party':
      // the Windows line, the ✕ line or the first-party row already says it
      return { key: 'none', how: '' };
    case 'not-local':
    case 'remote':
      return { key: 'none', how: 'trust: not needed · it never runs in a local session' };
    case 'fetches':
      return { key: 'none', how: 'can’t be trusted: it downloads what it runs at each launch · next: install it and point its command at the installed copy' };
    case 'remote-proxy':
      return { key: 'none', how: 'can’t be trusted: it forwards to a remote server · its tools keep asking' };
    case 'bad-id':
      return { key: 'none', how: `can’t be trusted: its name can’t be recorded · next: rename it in ${whereOf(r)}` };
    case 'not-enabled':
      return { key: 'disabled', how: 'turn it on first, then Trust…' };
    case 'not-listed':
      return { key: 'disabled', how: 'Trust… opens once a local session lists its tools · next: open a local session in a folder where it’s on' };
    case 'changed':
      return { key: 'disabled', how: 'it changed since a session listed its tools · next: open a new local session' };
    case 'unavailable':
      return { key: 'none', how: 'can’t be trusted: this Gnomon does not offer per-server trust · next: update Gnomon' };
    default:
      return { key: 'none', how: 'can’t be trusted now · next: close Settings and open it again' };
  }
}

/** The words of a refused preview or commit: "Not changed: " + the table's words (with next:); never the code. */
export function trustRefusedResult(why: string | null, r?: { source: string; plugin: { id: string } | null }): ResultView {
  const w = why ? trustRefusalWords(why, r).how : '';
  return { lead: 'Not changed:', text: ` ${w || 'Gnomon did not trust it · next: close Settings and open it again'}`, fail: true };
}

/** C5'b: the row's trust chip, told by its word (trusted and first-party in ink, untrusted plain), never by a hue. */
export function trustChipOf(t: McpTrustView | null | undefined): { text: string; ink?: boolean } | null {
  if (!t) return null;
  return t.level === 'untrusted' ? { text: TRUST_COPY.chip.untrusted } : { text: TRUST_COPY.chip[t.level], ink: true };
}

/** C5'b: a row's trust keys: Trust… (untrusted and allowed; aria-disabled while a refusal passes) or Clear trust. */
export function trustKeys(r: McpRowView, ui: McpUi, windows: boolean): FormKey[] {
  const t = r.trust;
  if (!t || windows || t.level === 'first-party' || r.problems.length) return [];
  const title = (label: string): string => `${label} · ${r.name}`;
  if (t.level === 'trusted') return [{ act: 'mcp:untrust', value: r.id, label: TRUST_COPY.clear, quiet: true, title: title(TRUST_COPY.clear), ...(ui.busy === `mcp:untrust|${r.id}` ? { busy: true, ariaDisabled: true } : ui.busy ? { disabled: true } : {}) }];
  const words = t.why ? trustRefusalWords(t.why, r) : null;
  if (words?.key === 'none') return [];
  const open = ui.trust?.id === r.id;
  // Mika: the open server's own Trust… is dead while its commit is in flight or its card waits; another server's
  // Trust… waits only then (a ready, expired or refused panel gives way to it), and its title says why
  const blocked = trustBlocking(ui.trust);
  const other = !!blocked && !open;
  return [{ act: 'mcp:trust', value: r.id, label: TRUST_COPY.trust, title: other ? trustBlockedWords(ui.trust!.name) : title('Trust'), expanded: open, ...(words || blocked ? { ariaDisabled: true } : ui.busy ? { disabled: true } : {}) }];
}

/** C5'b: a panel that holds the one-at-a-time slot (its commit is in flight or its card waits). */
export const trustBlocking = (t: McpTrustUi | null | undefined): boolean => !!t && (t.phase === 'committing' || t.phase === 'pending');
/** C5'b: why another server's Trust… waits (its title and its how line). */
export const trustBlockedWords = (name: string): string => `one trust preview at a time: finish or cancel ${name}’s first`;

/** C5'b (Mika): no chip where there is no trust question (never runs locally, a problem, Windows). */
const NO_TRUST_CHIP: readonly string[] = ['not-local', 'remote', 'problem', 'platform'];

/** The reads as the panel lists them: at most readsMax, then "+N more". */
export function readsShown(reads: readonly string[]): string[] {
  const max = TRUST_COPY.readsMax;
  return reads.length > max ? [...reads.slice(0, max), `+${reads.length - max} more`] : [...reads];
}

/** The rows the trust panel adds under its server's row: the confirm block, or the request row while its card waits. */
export function trustPanelRows(t: McpTrustUi): SettingRow[] {
  if (t.phase === 'pending' && t.cardId) return [{ kind: 'request', id: 'mcp-trust-request', label: 'Asked', chip: TRUST_COPY.pendingChip, line: `trust ${t.name}’s tool labels`, keys: [{ act: 'mcp:decide', value: t.cardId, label: MCP_COPY.decide }], how: TRUST_COPY.requestHow }];
  const cancel: FormKey = { act: 'mcp:trust-cancel', value: t.id, label: TRUST_COPY.cancel, quiet: true, ...(t.phase === 'committing' ? { ariaDisabled: true } : {}) };
  const commit = (o: Partial<FormKey>): FormKey => ({ act: 'mcp:trust-commit', value: t.id, label: TRUST_COPY.commit, pri: true, ...o });
  const label = `Trust ${t.name}’s tool labels`;
  const form = (confirm: NonNullable<Extract<SettingRow, { kind: 'form' }>['confirm']>, result?: ResultView | null): SettingRow => ({ kind: 'form', id: 'mcp-trust', label: '', keys: [], confirm, ...(result ? { result } : {}) });
  switch (t.phase) {
    case 'checking':
      return [form({ label, text: TRUST_COPY.checking, keys: [commit({ busy: true, ariaDisabled: true }), cancel] })];
    case 'committing':
      return [form({ label, text: TRUST_COPY.committing, keys: [commit({ busy: true, ariaDisabled: true }), cancel] })];
    case 'refused':
      // Mika: the reason sits inside the block (its result line, role=alert), and the one key closes it
      return [form({ label, text: '', ...(t.result ? { result: t.result } : {}), keys: [{ ...cancel, label: TRUST_COPY.close }] })];
    default: {
      const list = t.reads.length ? readsShown(t.reads) : null;
      const keys: FormKey[] = t.phase === 'expired' ? [{ act: 'mcp:trust-again', value: t.id, label: TRUST_COPY.again, pri: true }, cancel] : [commit({}), cancel];
      const words = list ? { lines: [TRUST_COPY.readsLead], list, after: [TRUST_COPY.after] } : { lines: [TRUST_COPY.noReads] };
      return [form({ label, text: TRUST_COPY.believe(t.name), ...words, keys }, t.phase === 'expired' ? t.result : null)];
    }
  }
}

/** The section's one polite line (empty when idle): what the trust panel is doing now. */
export function trustLiveText(t: McpTrustUi | null | undefined): string {
  if (!t) return '';
  switch (t.phase) {
    case 'checking':
      return TRUST_COPY.checking;
    case 'ready':
      return `Ready: ${TRUST_COPY.commit} raises the card for ${t.name}.`;
    case 'expired':
      return `${t.result?.lead ?? 'Not changed:'}${t.result?.text ?? ''}`;
    case 'refused':
      return `${t.result?.lead ?? 'Not changed:'}${t.result?.text ?? ''}`;
    case 'committing':
      return TRUST_COPY.committing;
    case 'pending':
      return `Card waiting: trust ${t.name}’s tool labels. ${MCP_COPY.decide}.`;
  }
}

export const trustedResult = (name: string, at: string, n: number): ResultView => ({ lead: 'Trusted', text: ` ${name}’s tool labels at ${at}. ${n} tool${n === 1 ? ' runs' : 's run'} with no card.` });
export const trustNotChangedResult = (name: string, at: string, why: 'denied' | 'expired'): ResultView => ({ lead: 'Not changed:', text: ` ${name} stays untrusted; ${why === 'expired' ? 'the card expired' : 'the card was denied'} at ${at}.` });
export const trustClearedResult = (name: string, at: string): ResultView => ({ lead: 'Cleared:', text: ` Gnomon no longer trusts ${name}’s tool labels (${at}). Its tools ask again; its Always rules are paused.` });

/** request.mcp.trust: preview and clear take no token; a commit carries the preview's. */
export function trustRequest(id: string, op: 'preview' | 'commit' | 'clear', token?: string): { kind: string; payload: Record<string, unknown> } {
  return { kind: MCP_TRUST_REQUEST, payload: op === 'commit' ? { id, op, token } : { id, op } };
}

/** A preview answer as the panel reads it, or null (not one the page reads). The notice and reads become display text. */
export function trustPreviewOf(v: unknown): { notice: string; reads: string[]; token: string; expiresAt: string | null } | null {
  if (!isObj(v) || typeof v.token !== 'string' || !v.token || typeof v.notice !== 'string') return null;
  return { notice: shown(v.notice, 2000), reads: strs(v.reads).map((x) => shown(x, 120)), token: v.token, expiresAt: typeof v.expiresAt === 'string' ? v.expiresAt : null };
}

/**
 * TD-2026-10-23-361 (H1, founder: honour their rules, show them): the human's own Claude Code allow rules that let a
 * server's tools run with no card. Gnomon never adds or overrides one.
 */
export function autoAllowWords(rules: readonly string[]): string {
  const words = rules.map((r) => (r === 'mcp__*' ? `${r} (every MCP tool)` : r.endsWith('__*') || !r.slice(5).includes('__') ? `${r} (all tools)` : r));
  // Mika 2026-10-23: lead with the consequence (no card), then the founder's own rule words
  return `no card for its tools: your Claude Code settings allow ${words.join(', ')}`;
}

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
  if (r.inline) parts.push(`runs inline code (${r.inline})`);
  if (r.transport !== 'stdio' && r.host) parts.push(`connects to ${r.host}`);
  // last, where the eye ends: whether its tools ask at all (Mika 2026-10-23)
  if (r.autoAllowed.length) parts.push(autoAllowWords(r.autoAllowed));
  return parts.join(' · ');
}

/** The value a row shows, with its mark: ✓ on, ✕ cannot run, ? changed since it was turned on. */
function stateOf(r: McpRowView, repo: string | null, marked: McpMarked | null, waiting: boolean): { mark?: string; value: string } {
  if (r.problems[0]?.code === 'first-party') return { value: MCP_COPY.covered };
  if (r.problems.length) return { mark: '✕', value: r.problems[0]!.text };
  // staged rows are marked by word and weight, never by a hue (the Rules view's rule)
  if (marked) return { value: `${MCP_COPY.markedWord} ${marked.scope === 'all' ? 'for all repos' : `in ${marked.folder ?? 'this folder'}`}` };
  if (waiting) return { value: MCP_COPY.waitingWord };
  if (r.changed && !r.on.all && !(repo && r.on.repos.includes(repo))) return { mark: '?', value: 'changed since you turned it on: off until you turn it on again' };
  if (r.on.all) return { mark: '✓', value: 'on in every repo' };
  if (repo && r.on.repos.includes(repo)) return { mark: '✓', value: 'on in this folder' };
  if (r.on.repos.length) return { value: `on in ${r.on.repos.length} other folder${r.on.repos.length === 1 ? '' : 's'}` };
  return { value: 'off' };
}

function keysOf(r: McpRowView, repo: { repo: string; folder: string } | null, ui: McpUi, windows: boolean, waiting: boolean, full: boolean, batching: boolean): FormKey[] {
  if (windows || r.problems.length) return [];
  const busy = (act: string): Partial<FormKey> => (ui.busy === `${act}|${r.id}` ? { busy: true, disabled: true } : ui.busy ? { disabled: true } : {});
  const keys: FormKey[] = [];
  const repoBound = r.source === 'project' || r.source === 'local';
  const onHere = !!repo && r.on.repos.includes(repo.repo);
  // turning off is a narrowing: no card, applies at once, even while a batch card waits
  if (r.on.all || onHere) keys.push({ act: 'mcp:off', value: r.id, label: 'Turn off', quiet: true, ...busy('mcp:off') });
  if (ui.staged.some((m) => m.id === r.id)) keys.push({ act: 'mcp:unmark', value: r.id, label: 'Unmark', quiet: true, ...busy('mcp:unmark') });
  else if (!waiting) {
    // one server, one press (On …) unless the human is marking several for one card (Mark …); marking stages the
    // server for the next card and the cap says why it is reached (disabled-says-why)
    const cap: Partial<FormKey> = batching && full ? { disabled: true } : {};
    const [all, here, verb] = batching ? ['mcp:mark-all', 'mcp:mark-repo', 'Mark'] : ['mcp:on-all', 'mcp:on-repo', 'On'];
    if (!r.on.all && !repoBound) keys.push({ act: all, value: r.id, label: `${verb} for all repos`, pri: !repo, ...busy(all), ...cap });
    if (!r.on.all && !onHere && repo && (!repoBound || r.repo === repo.repo)) keys.push({ act: here, value: r.id, label: `${verb} in ${repo.folder}`, pri: repoBound, ...busy(here), ...cap });
  }
  // Mika: ten rows of "Turn off" and "On for all repos" read the same out of context; the key names its server
  return keys.map((k) => ({ ...k, title: `${k.label} · ${r.name}${batching && full && k.act.startsWith('mcp:mark-') ? ` · ${MCP_COPY.full}` : ''}` }));
}

export interface McpSectionInput {
  status: unknown;
  ui: McpUi;
  /** the focused session (its folder's servers show, and "On in <folder>") */
  hsid: string | null;
}

const scopeWords = (scope: string, repo: string | null): string => (scope === 'all' ? 'all repos' : (repo ?? '').split(/[\\/]/).pop() || 'a folder');

/** The waiting cards, one per cardId (a batch card names every server on it). */
export function waitingCards(v: McpStatusView): Array<{ cardId: string; ids: string[]; line: string }> {
  const all = [...v.servers, ...v.repos.flatMap((r) => r.servers)];
  const by = new Map<string, Array<McpStatusView['pending'][number]>>();
  for (const p of v.pending) by.set(p.cardId, [...(by.get(p.cardId) ?? []), p]);
  return [...by].map(([cardId, ps]) => ({ cardId, ids: ps.map((p) => p.id), line: `turn on ${ps.map((p) => `${all.find((r) => r.id === p.id)?.name ?? 'a server'} · ${scopeWords(p.scope, p.repo)}`).join(', ')}` }));
}

export function mcpSection(i: McpSectionInput): SettingsSection {
  const v = mcpStatusOf(i.status);
  const sec = (rows: SettingRow[]): SettingsSection => ({ id: MCP_SECTION, title: MCP_COPY.title, owner: MCP_COPY.owner, intro: MCP_COPY.intro, rows, live: trustLiveText(i.ui.trust) });
  if (v.state === 'not-connected') return sec([{ kind: 'readonly', id: 'mcp', label: 'MCP servers', value: MCP_COPY.notConnected.value, how: MCP_COPY.notConnected.how }]);
  if (v.state === 'not-offered') return sec([{ kind: 'readonly', id: 'mcp', label: 'MCP servers', value: MCP_COPY.notOffered.value, how: MCP_COPY.notOffered.how }]);
  const rows: SettingRow[] = [];
  const fp = v.firstParty;
  if (fp) {
    const k: FormKey[] = fp.available ? [{ act: fp.on ? 'mcp:fp-off' : 'mcp:fp-on', value: MCP_FIRST_PARTY, label: fp.on ? 'Turn off' : 'Turn on', quiet: fp.on, ...(i.ui.busy ? { disabled: true } : {}) }] : [];
    rows.push({ kind: 'readonly', id: 'mcp-paradigm', label: 'Paradigm MCP · first-party', value: !fp.available ? 'not installed' : fp.on ? `on in every session${fp.version ? ` · paradigm ${fp.version}` : ''}` : 'off', how: fp.available ? [fp.dir || fp.autoAllowed.length ? MCP_COPY.fpHow.replace(/\.$/, '') : MCP_COPY.fpHow, ...(fp.dir ? [`runs from ${fp.dir}${fp.linked ? ' (linked: it runs live as that folder changes, and sessions working in that folder can edit it)' : ''}`] : []), ...(fp.autoAllowed.length ? [autoAllowWords(fp.autoAllowed)] : [])].join(' · ') : MCP_COPY.fpMissing, ...(fp.available ? (fp.on ? { mark: '✓' } : {}) : { mark: '✕' }), ...(k.length ? { keys: k } : {}), ...(fp.trust ? { chip: trustChipOf(fp.trust)! } : {}) });
  }
  const repo = i.hsid ? (v.repos.find((r) => r.hsids.includes(i.hsid!)) ?? null) : null;
  const pendingIds = new Set(v.pending.map((p) => p.id));
  if (i.ui.request) for (const id of i.ui.request.ids ?? []) pendingIds.add(id);
  const full = i.ui.staged.length >= v.max;
  // #batch-card: the waiting card(s) (the kernel's, and the one this page asked for)
  const cards = waitingCards(v);
  const mine = i.ui.request;
  const shownCards = mine && !cards.some((c) => c.cardId === mine.cardId) ? [{ cardId: mine.cardId, ids: mine.ids ?? [], line: mine.line }, ...cards] : cards.map((c) => (mine && c.cardId === mine.cardId ? { ...c, line: mine.line } : c));
  // the rows offer Mark keys while the human marks several, anything is marked, or a card waits (one card at a time:
  // the next servers go on the next card); else each server turns on with one press
  const batching = !!i.ui.marking || i.ui.staged.length > 0 || shownCards.length > 0;
  // a one-server card this page asked for shows under that server's row (Delta 7: the outcome sits where you pressed)
  const under = mine && (mine.ids ?? []).length === 1 && i.ui.at === mine.ids![0] ? mine.ids![0]! : null;
  const requestRow = (c: { cardId: string; ids: string[]; line: string }, id: string, first: boolean): SettingRow => ({ kind: 'request', id, label: 'Asked', chip: 'card waiting', line: c.line, keys: [{ act: 'mcp:decide', value: c.cardId, label: MCP_COPY.decide }], how: (c.ids.length > 1 ? MCP_COPY.requestHowMany : MCP_COPY.requestHow) + (i.ui.staged.length || first ? MCP_COPY.markMeanwhile : '') });
  let offerable = 0;
  // Mika 2026-10-23: on Windows the reason no row has a key comes first, not after the last server
  if (v.windows) rows.push({ kind: 'readonly', id: 'mcp-windows', label: 'On this PC', value: 'rows only', how: MCP_COPY.windows, grp: true });
  // a press's result shows under the row that was pressed (else it lands a screen below the press, out of sight); the
  // batch's own outcome shows with the batch
  const at = i.ui.result ? (i.ui.at ?? null) : null;
  const outcome = (): void => {
    if (i.ui.result) rows.push({ kind: 'form', id: 'mcp-result', label: '', keys: [], result: i.ui.result });
  };
  if (at === MCP_FIRST_PARTY && fp) outcome();
  const add = (r: McpRowView, n: number, label: string, grp: boolean): void => {
    const marked = i.ui.staged.find((m) => m.id === r.id) ?? null;
    const waiting = pendingIds.has(r.id);
    const st = stateOf(r, repo?.repo ?? null, marked, waiting);
    const keys = [...keysOf(r, repo, i.ui, v.windows, waiting, full, batching), ...trustKeys(r, i.ui, v.windows)];
    if (keys.some((k) => /^mcp:(on|mark)-/.test(k.act))) offerable += 1;
    const p0 = r.problems[0];
    // C5'b: why it can't be trusted now sits in the row's how line (never the kernel's code)
    const tw0 = r.trust && r.trust.level === 'untrusted' && r.trust.why && !r.problems.length && !v.windows ? trustRefusalWords(r.trust.why, r).how : '';
    // another server's panel holds the slot: this row's Trust… says why it waits
    const waitsFor = r.trust?.level === 'untrusted' && !r.trust.why && !r.problems.length && !v.windows && trustBlocking(i.ui.trust) && i.ui.trust!.id !== r.id ? trustBlockedWords(i.ui.trust!.name) : '';
    const tw = tw0 || waitsFor;
    const how0 = p0 && p0.code !== 'first-party' ? `${howWords(r, v.envFile)} · ${problemNext(p0.code, r)}` : howWords(r, v.envFile);
    const how = tw ? `${how0} · ${tw}` : how0;
    const chip = p0?.code === 'first-party' || NO_TRUST_CHIP.includes(r.trust?.why ?? '') || r.problems.length ? null : trustChipOf(r.trust);
    rows.push({ kind: 'readonly', id: `mcp-${r.source}-${n}`, label, value: st.value, how, ...(st.mark ? { mark: st.mark } : {}), ...(grp ? { grp: true } : {}), ...(keys.length ? { keys } : {}), ...(chip ? { chip } : {}), title: `${r.sessionName} · tools mcp__${r.sessionName}__*` });
    // C5'b: the trust preview opens INLINE under its row (never a modal over the sheet); then its outcome
    if (i.ui.trust?.id === r.id) rows.push(...trustPanelRows(i.ui.trust));
    if (r.id === at) outcome();
    if (r.id === under && mine) rows.push(requestRow({ cardId: mine.cardId, ids: mine.ids ?? [], line: mine.line }, 'mcp-request', true));
  };
  v.servers.forEach((r, n) => add(r, n, r.plugin ? `${r.name} · plugin` : r.name, n === 0));
  // the focused folder's own servers start their own group (Mika: space between groups, not only between rows)
  if (repo) repo.servers.forEach((r, n) => add(r, n + v.servers.length, `${r.name} · ${repo.folder}${r.source === 'project' ? ' (repo)' : ''}`, n === 0));
  if (!v.servers.length && !(repo?.servers.length)) rows.push({ kind: 'readonly', id: 'mcp-none', label: 'Your servers', value: MCP_COPY.none.value, how: MCP_COPY.none.how, grp: true });
  // #batch-card: the waiting card(s) (with the batch: a card for several servers belongs to no one row; each of its
  // rows says "off until you allow its card"), then what is marked for the next card, then the batch's outcome
  shownCards.filter((c) => !(under && mine && c.cardId === mine.cardId)).forEach((c, n) => rows.push(requestRow(c, n === 0 && !under ? 'mcp-request' : `mcp-request-${n + 1}`, n === 0)));
  if (i.ui.staged.length) {
    const n = i.ui.staged.length;
    const blocked = !!mine || shownCards.length > 0;
    rows.push({
      kind: 'readonly',
      id: 'mcp-batch',
      label: 'Marked to turn on',
      value: `${n} server${n === 1 ? '' : 's'}: ${i.ui.staged.map((m) => `${m.name} (${m.scope === 'all' ? 'all repos' : (m.folder ?? 'this folder')})`).join(', ')}`,
      how: blocked ? MCP_COPY.batchWaits : full ? `${MCP_COPY.batchHow} ${MCP_COPY.full}.` : MCP_COPY.batchHow,
      grp: true,
      live: true,
      keys: [
        { act: 'mcp:enable', value: 'batch', label: batchKeyLabel(n), pri: true, ...(i.ui.busy === 'mcp:enable|batch' ? { busy: true, disabled: true } : i.ui.busy || blocked ? { disabled: true } : {}) },
        { act: 'mcp:clear', value: 'batch', label: 'Clear marks', quiet: true, ...(i.ui.busy ? { disabled: true } : {}) },
      ],
    });
  } else if (i.ui.marking && !v.windows) {
    // marking, nothing marked yet: say what to do; Stop marking brings the one-press keys back
    rows.push({ kind: 'readonly', id: 'mcp-batch', label: 'Marked to turn on', value: MCP_COPY.noneMarked.value, how: MCP_COPY.noneMarked.how, grp: true, live: true, keys: [{ act: 'mcp:clear', value: 'batch', label: MCP_COPY.stopMarking, quiet: true, ...(i.ui.busy ? { disabled: true } : {}) }] });
  } else if (!batching && !v.windows && offerable >= 2) {
    // the entry to one card for several (the one-press keys stay the default: founder, fewer hurdles)
    rows.push({ kind: 'readonly', id: 'mcp-batch', label: MCP_COPY.several.label, value: MCP_COPY.several.value, how: MCP_COPY.several.how, grp: true, keys: [{ act: 'mcp:marking', value: 'batch', label: MCP_COPY.several.key, quiet: true, ...(i.ui.busy ? { disabled: true } : {}) }] });
  }
  if (at === MCP_BATCH) outcome();
  return sec(rows);
}

/** The batch key names its cost before the press (the Rules view's save bar does the same). */
export const batchKeyLabel = (n: number): string => `Turn on ${n === 1 ? '1 server' : `${n} servers`} · asks Touch ID or your Mac password once`;

/* ── #batch-card staging (pure) ─────────────────────────────────── */

/** Mark one server for the next card (one scope per server: marking it again replaces the scope). At the cap, nothing. */
export function markMcp(ui: McpUi, m: McpMarked, max: number = MCP_ENABLE_MAX): McpUi {
  const rest = ui.staged.filter((x) => x.id !== m.id);
  if (rest.length >= max) return ui;
  return { ...ui, staged: [...rest, m], marking: true, result: null, at: m.id };
}
/** "Mark several": the rows offer Mark keys until the marks are sent or cleared. */
export function startMarking(ui: McpUi): McpUi {
  return { ...ui, marking: true, result: null };
}
export function unmarkMcp(ui: McpUi, id: string): McpUi {
  return { ...ui, staged: ui.staged.filter((x) => x.id !== id), result: null, at: id };
}
export function clearMcp(ui: McpUi): McpUi {
  return { ...ui, staged: [], marking: false, result: null };
}

/** Drop marks for servers the kernel no longer lists, that cannot run, or that are already on at that scope. */
export function reconcileMcp(ui: McpUi, v: McpStatusView): McpUi {
  if (!ui.staged.length || v.state !== 'ok') return ui;
  const all = [...v.servers, ...v.repos.flatMap((r) => r.servers)];
  const keep = ui.staged.filter((m) => {
    const r = all.find((x) => x.id === m.id);
    if (!r || r.problems.length) return false;
    return m.scope === 'all' ? !r.on.all : !(m.repo && r.on.repos.includes(m.repo));
  });
  return keep.length === ui.staged.length ? ui : { ...ui, staged: keep };
}

/** The ONE request for what is marked: request.mcp.enable{servers:[…]} (the kernel raises one card). */
export function mcpBatchRequest(ui: McpUi): { kind: string; payload: { servers: Array<Record<string, unknown>> } } | null {
  if (!ui.staged.length) return null;
  return { kind: MCP_ENABLE_REQUEST, payload: { servers: ui.staged.map((m) => (m.scope === 'all' ? { id: m.id, scope: 'all' } : { id: m.id, scope: 'repo', repo: m.repo })) } };
}

/** The request a press sends (log.append), or null for a press that sends nothing (marking is staged in the page). */
export function mcpRequestOf(act: string, id: string, repo: string | null = null): { kind: string; payload: Record<string, unknown> } | null {
  switch (act) {
    // one server, one press: its own root card (the kernel's batch of one)
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

/** Mika 2026-10-23 (principle 5): a refusal in plain words with next:, never the wire code or the symbol. */
export function mcpRefusalText(r: { code: string; reason: string | null; message: string; next: string[]; data?: Record<string, unknown> | null }): string {
  const why = r.data && typeof r.data.why === 'string' ? r.data.why : null;
  const known: Record<string, string> = {
    'repo-only': 'it comes from one repo, so it turns on for that repo only. next: from a session in that repo, use the On in key for its folder',
    'not-found': 'it is no longer in your Claude Code config. next: close Settings and open it again to see the list as it is now',
    changed: 'its entry changed while the card was open. next: look at it again, then turn it on',
    platform: 'turning a server on takes the root key, which lives in the Mac helper in 8.0. next: turn it on from your Mac',
  };
  if (why && known[why]) return ` ${known[why]}.`;
  if (r.code === 'FORBIDDEN') return ' only you can turn a server on, from Settings or the terminal. next: press it again in Settings.';
  const msg = r.message.replace(/^#[a-z0-9-]+:\s*/, '');
  return ` ${msg}${r.next.length ? `. next: ${r.next.join(' · ')}` : ''}`;
}

export const turnedOffResult = (name: string, at: string): ResultView => ({ lead: 'Turned off', text: ` ${name} at ${at}. New sessions won’t start it.` });
export const turnedOnResult = (name: string, at: string): ResultView => ({ lead: 'On', text: ` ${name} at ${at}. New sessions start ${name.includes(', ') ? 'them' : 'it'}.` });
/** #batch-card: an allowed card that skipped servers which changed while it waited (kernel status.mcp.skipped). */
export const skippedResult = (on: readonly string[], skipped: readonly string[], at: string): ResultView => ({
  lead: on.length ? 'On' : 'Not changed:',
  text: `${on.length ? ` ${on.join(', ')} at ${at}.` : ''} ${skipped.join(', ')} changed while the card waited, so ${skipped.length === 1 ? 'it stays' : 'they stay'} off. next: look at ${skipped.length === 1 ? 'it' : 'them'} again, then turn ${skipped.length === 1 ? 'it' : 'them'} on again.`,
  ...(on.length ? {} : { fail: true }),
});
export const notChangedResult = (name: string, at: string, why: 'denied' | 'expired'): ResultView => ({ lead: 'Not changed:', text: ` ${name} ${name.includes(', ') ? 'stay' : 'stays'} off; ${why === 'expired' ? 'the card expired' : 'the card was denied'} at ${at}.` });
