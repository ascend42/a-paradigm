/**
 * @symbol #always-rules
 *
 * #always-rules (spec §3.4 decisions: `always` appends
 * `approval.rule.learned{tool, matchExact}`, S-L1; S25-C2 fresh presence;
 * gui-complete item 2). A standing "always allow" rule is DERIVED, never
 * stored: the RuleBook folds kernel-signed chain rows only (principal = the
 * kernel principal AND keyId a kernel key; any other row — a forged
 * `approval.rule.learned` from a client, a session or a mod — is ignored).
 *
 * A rule exists for card C when, all kernel-signed:
 *   approval.request{card:{cardId:C, kind:'permission'}, tool, tool_input}
 *   approval.decide{cardId:C, decision:'always'}
 *   approval.rule.learned{cardId:C, tool, matchExact:true, repoKey,
 *                         presence ≠ 'cached'}
 * and the request's tool equals the learned row's tool. The rule is keyed
 * (repoKey, tool, inputHash) with inputHash = sha256 over the canonical
 * tool_input (permission.ts inputHash, the same function the card uses):
 * an EXACT match only — a different input or a different repo never matches.
 * RC5 (TD-2026-10-20-086): a Bash exact rule ALSO matches by bashCommandHash =
 * sha256 over canonical `{command}` (no description, no timeout), when both the
 * learned request and the later input have no key besides command,
 * description and timeout; so a fresh free-text `description` re-matches, while
 * `run_in_background` (or any other key) still raises the card. Both hashes are
 * derived at fold time from the kernel-signed request, so rules learned before
 * this change match by command too.
 * The rule id is the card id (`modeRef: 'rule:<cardId>'` on approval.auto).
 *
 * Bounded: at most MAX_TRACKED_REQUESTS permission requests and decisions are
 * remembered for the join (oldest forgotten: a rule whose request fell out of
 * the window is not formed — fail closed, the card is raised again) and at
 * most MAX_RULES rules (oldest dropped first, same fail-closed direction).
 *
 * The learned row's match mode (TD-2026-10-19-528 F2, amended TD-2026-10-20-294):
 * v1 `matchExact:true` or `match:'exact'` (exact, as above), or
 * `match:'prefix', prefix:[1..3 words]` — a PREFIX rule, formed only when the
 * kernel-signed request is a Bash card whose command is ONE literal simple
 * command (shell-readonly simpleArgv) starting with the prefix AND the
 * kernel-signed `approval.decide{always}` for the card carries the SAME
 * `scope:{kind:'prefix', prefix}` (the scope its decisionSig bound). A later
 * Bash input matches it only when simpleArgv(command) succeeds (no ; && || |
 * & newline, substitution, parameter, glob, redirection or assignment), argv
 * starts with the prefix word for word, the repoKey and tool are the same and
 * the input has no key besides command, description and timeout. A prefix
 * rule widens only within a single literal simple command. Any other `match`
 * value forms no rule. Aegis H1/M2/M3 (#prefix-policy): a prefix the policy refuses
 * (one word, an interpreter/runner, a script-running package-manager subcommand,
 * a non-read-ish git subcommand) forms no rule; a match is refused in manual mode,
 * without the session roots, or when a later argument is a refused git option, a
 * `-C`-style option, a `..`/`~` path or an absolute path outside the roots.
 *
 * REVOKE (P8-D98, TD-2026-10-19-528 F1): a kernel-signed
 * `approval.rule.revoked{ruleId, repoKey, tool, connId}` (written by the
 * `rules.revoke` human-device verb, socket/rules-revoke.ts) removes the rule
 * and forgets the card's `always` decision, so a replayed learned row for the
 * same card never brings it back. A forged revoked row is ignored like any
 * other forged row. A revoke never widens anything: a later `always` on a
 * NEW card learns a new rule (a new id).
 * `gnomon rules list` reads the same fold offline (rules-cli.ts).
 *
 * SCOPED EDITS (TD-2026-10-23-939 follow-up, Aegis 2026-10-23): `match:'file', path` (the kernel-held detail.editPath
 * of an Edit / Write / MultiEdit / NotebookEdit card, whose decide row carries scope {kind:'file'}) and
 * `match:'repo-edits'` (scope {kind:'repo-edits'}). They are `always` rules like the others (fresh or CLI presence,
 * revocable the same way) and match only through the supervisor's own auto-edits pass for the request
 * (`ctx.editPath`: autoEditPass ok, the same in-root / session-roots / not-home-root / no-symlink / not-gate-class /
 * not-flagged check auto-edits uses): a file rule when that path is the rule's path, a repo-edits rule for any edit
 * in the rule's repo. Never in manual mode (`ctx.prefixRules` false), never without the pass. Bash file writes never
 * match them (a Bash card stays a card).
 *
 * OFF AND BACK ON (8.0:rules-view, Aegis M2/L2; socket/rules-apply.ts writes the rows): a kernel-signed
 * `approval.rule.disabled{ruleId, until}` marks a STANDING rule off, until `until` passes on the KERNEL clock (the
 * book's `clock`, never a page's), or until turned back on when `until` is null. An off rule never matches, is never
 * the repo's repoEditsRule (the mode chip) and lists as off. `approval.rule.enabled{cause:'human'}` (the batch card's
 * allowed effect, carrying the `until` it saw at raise) and `{cause:'expired', until}` (the kernel sweep's feed row) clear
 * it only while it is still the flag that `until` names (Aegis M-2: a stale card never undoes a newer off). Enabled ONLY clears a flag on a rule that stands: it never creates a rule, and a
 * revoke (or the repo brake) drops the flag with the rule, so nothing brings a revoked rule back.
 *
 * BROKERED TOOLS (8.0:local-lane C5'a2, ^local-tool-grant): `match:'tool', bindHash` — later calls of ONE brokered MCP
 * tool (+ op) `mcp:<server>/<tool>` on ONE server in the repo, any arguments. Formed only when the kernel-signed
 * approval.request carries the card's bindHash (the broker copies detail.brokered.bindHash, inside the contentHash, of a
 * card #local-tool-broker offered the tool scope on), the decide row carries scope {kind:'tool'} and the learned row
 * names the SAME bindHash and tool. It matches only a call whose bindHash (the entry id, the sha256 of its FULL schema,
 * its class and the server's live trust binding) is the rule's: a schema, class or trust change leaves it dormant (it
 * stands, listed, and matches again only if that exact binding comes back). Never in manual mode (`ctx.prefixRules`
 * false). An `mcp:` tool never matches an exact, prefix or edit rule.
 *
 * DESTRUCTIVE TOOL RULES (8.0:local-lane C6'a2-1, TD-2026-10-28-969): a tool rule is DESTRUCTIVE when its kernel-signed
 * approval.request carries flags including `irreversible` (#local-tool-broker flags every destructive brokered card). It
 * is formed ONLY when the decide row's presence is exactly 'fresh' AND it carries a rootSig (the card's `always` is root
 * class), and the learned row's presence is 'fresh' too: never from a standing grant, a CLI touch, a cached unlock or
 * voice. It has no expiry (it stands until revoked or its binding changes). It matches only a call whose class is
 * destructive (PrefixMatchContext.toolClass), and a mutate rule never matches a destructive call (nor the reverse;
 * the bindHash covers the class too).
 */
import path from 'node:path';
import { sanitizeDisplayText } from '@a-company/gnomon-contracts';
import type { KernelLog } from '../log/index.js';
import { inputHash } from './permission.js';
import { pushRuleWords } from '../git/verbs.js';
import { simpleArgv } from './shell-readonly.js';
import { prefixMatchRefusal, prefixRefusal } from './prefix-policy.js';
import { isNarrowingRow } from '../log/narrowing.js'; // Aegis S2 H-3: narrowing rows from any key in the chain

/** Input keys a prefix rule tolerates besides `command` (anything else, e.g. run_in_background, raises the card). */
export const PREFIX_RULE_INPUT_KEYS: ReadonlySet<string> = new Set(['command', 'description', 'timeout']);

/**
 * RC5 (TD-2026-10-20-086): the hash an exact Bash rule ALSO matches by — sha256 over canonical `{command}` alone, so
 * Claude's fresh free-text `description` (and `timeout`) never defeat a rule. Only for an input whose keys are within
 * PREFIX_RULE_INPUT_KEYS (command, description, timeout); any other key (run_in_background, …) ⇒ null and only the
 * whole-input hash can match.
 */
export function bashCommandHash(toolInput: unknown): string | null {
  if (toolInput === null || typeof toolInput !== 'object' || Array.isArray(toolInput)) return null;
  const o = toolInput as Record<string, unknown>;
  if (typeof o.command !== 'string' || Object.keys(o).some((k) => !PREFIX_RULE_INPUT_KEYS.has(k))) return null;
  return inputHash({ command: o.command });
}

/** The argv of a Bash input whose command is one literal simple command, else null. */
export function bashArgvOfInput(toolInput: unknown): string[] | null {
  if (toolInput === null || typeof toolInput !== 'object' || Array.isArray(toolInput)) return null;
  const o = toolInput as Record<string, unknown>;
  if (typeof o.command !== 'string' || Object.keys(o).some((k) => !PREFIX_RULE_INPUT_KEYS.has(k))) return null;
  return simpleArgv(o.command);
}

const startsWith = (argv: readonly string[], prefix: readonly string[]): boolean => prefix.length > 0 && prefix.length <= argv.length && prefix.every((w, i) => argv[i] === w);
const prefixOk = (v: unknown): v is string[] => Array.isArray(v) && v.length >= 1 && v.length <= 3 && v.every((w) => typeof w === 'string' && w.length > 0 && w.length <= 128);

/**
 * What a prefix match needs from the session (Aegis M2/M3). Absent ⇒ no prefix rule matches (fail closed).
 * `prefixRules` is false in `manual` mode (a card is raised); `roots` are the session's cwd (+ worktree): a later
 * argument naming a path outside them, a `..` or a `-C`-style option refuses the match (#prefix-policy).
 */
export interface PrefixMatchContext {
  prefixRules: boolean;
  roots: readonly string[];
  /** scoped edit rules: the path the auto-edits pass resolved for this edit request (pass ok), else absent/null */
  editPath?: string | null;
  /**
   * Aegis H1: repo-edits rules may match (the strictness ceiling allows auto-edits AND the mode is not manual). Absent or
   * false ⇒ no repo-edits rule matches (fail closed); file rules, like prefix rules, need only prefixRules.
   */
  repoEdits?: boolean;
  /**
   * 8.0:local-lane C5'a2: a brokered call's bindHash NOW (#local-tool-broker); a tool rule matches only this exact value
   * (a different one leaves the rule dormant). Absent or null ⇒ no tool rule matches.
   */
  bindHash?: string | null;
  /**
   * 8.0:local-lane C6'a2-1: the brokered call's class. A destructive call matches only a destructive tool rule; any other
   * value (absent included) matches only a mutate tool rule.
   */
  toolClass?: 'mutate' | 'destructive';
}

/** The tools a scoped edit rule covers (the auto-edits tools). */
export const EDIT_RULE_TOOLS: readonly string[] = Object.freeze(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** 8.0:local-lane C5'a2: a brokered MCP tool's rule name (contracts TOOL_NAME's mcp form; tool-broker.ts brokeredToolName). */
export const BROKERED_RULE_TOOL = /^mcp:[a-z0-9][a-z0-9_-]{0,63}\/[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const BIND_HASH = /^sha256:[0-9a-f]{64}$/;

export const MAX_RULES = 1024;
export const MAX_TRACKED_REQUESTS = 4096;
// approval.mode.set (Aegis H1, TD-2026-10-23-939 follow-up): a REPO tightened (the emergency brake) stops its repo-edits rules
// grant.standing / grant.standing.revoked (TD-2026-10-23-815): a standing-covered always is verified against the grant's own rows
// approval.rule.disabled / approval.rule.enabled (8.0:rules-view): off for a time, and back on
export const RULE_KINDS = Object.freeze(['approval.request', 'approval.decide', 'approval.rule.learned', 'approval.rule.revoked', 'approval.mode.set', 'grant.standing', 'grant.standing.revoked', 'approval.rule.disabled', 'approval.rule.enabled'] as const);
export const RULE_ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const STANDING_PREFIX = 'standing:';
const GRANT_ID = /^card:[0-9A-HJKMNP-TV-Z]{26}$/;
const RULE_MODE_RANK: Readonly<Record<string, number>> = Object.freeze({ manual: 0, ask: 1, 'auto-edits': 2 });

export interface RuleRow {
  seq?: number;
  /** the row's kernel time (EventV1.at): a standing-covered always is checked against its grant's expiresAt at this time */
  at?: string;
  kind: string;
  principal: string;
  keyId?: unknown;
  payload?: unknown;
  /** the row's session (an approval.request names the session that asked; the Rules view shows it) */
  session?: string;
}

export interface AlwaysRule {
  /** the card the human decided `always` on */
  ruleId: string;
  repoKey: string;
  tool: string;
  inputHash: string;
  /** RC5: Bash exact rules only — bashCommandHash of the learned request's input (null when it had another key) */
  commandHash?: string | null;
  /** 'exact' (inputHash), 'prefix' (a Bash rule over one literal simple command starting with `prefix`), 'file' (edits of `path`), 'repo-edits' (every edit the auto-edits pass allows in the repo) or 'tool' (any call of one brokered MCP tool while `bindHash` holds) */
  match: 'exact' | 'prefix' | 'file' | 'repo-edits' | 'tool';
  /** tool rules only (8.0:local-lane C5'a2): the binding the card showed; a call with another bindHash never matches */
  bindHash?: string;
  /** tool rules only (8.0:local-lane C6'a2-1): a destructive tool rule (its card was irreversible; root class, fresh) */
  destructive?: boolean;
  /** prefix rules only: the literal argv words */
  prefix?: string[];
  /** file rules only: the absolute path the auto-edits pass resolved on the card */
  path?: string;
  /** seq of the approval.rule.learned row (when the reader knows it) */
  seq: number | null;
  presence: string;
  /** the learned row's kernel time (the Rules view's "since"), when the reader knows it */
  learnedAt?: string;
  /** the session whose card learned it, when the request row named one */
  hsid?: string;
  /** exact Bash rules: the command text (at most RULE_COMMAND_TEXT_MAX characters kept) and its full length */
  command?: string;
  commandChars?: number;
  /** #git-verbs (Mika): a gnomon_git_push rule's words, from its kernel-held input (host/owner/repo slug; pushRuleWords) */
  words?: string;
}

/** The most command text a rule keeps for its plain words (a longer command is described by its length, never cut silently). */
export const RULE_COMMAND_TEXT_MAX = 4096;

function commandTextOf(tool: unknown, input: unknown): { command?: string; commandChars?: number } {
  const o = obj(input);
  if (tool !== 'Bash' || !o || typeof o.command !== 'string') return {};
  return { command: o.command.slice(0, RULE_COMMAND_TEXT_MAX), commandChars: o.command.length };
}

/**
 * 8.0:rules-view (Aegis L1): what a rule allows, in plain words the KERNEL composes from its own RuleBook (never page
 * text). The Rules view lists them and the batch card's lines name each re-enabled rule with them.
 */
/**
 * 8.0:local-lane C5'a3 (Mika): a brokered tool rule's words, `any call of <tool> on the <server> MCP server (any
 * arguments)`. The names come from the rule's own mcp:<server>/<tool> name (BROKERED_RULE_TOOL), each cleaned by the
 * display sanitizer every card line passes through (sanitizeDisplayText); a name of another shape is shown whole.
 */
export function toolRuleWords(tool: string): string {
  const clean = (s: string): string => sanitizeDisplayText(s).text;
  const m = BROKERED_RULE_TOOL.test(tool) ? /^mcp:([^/]+)\/(.+)$/.exec(tool) : null;
  return m ? `any call of ${clean(m[2]!)} on the ${clean(m[1]!)} MCP server (any arguments)` : `any call of ${clean(tool)} (any arguments)`;
}

export function ruleWords(r: AlwaysRule): string {
  if (r.words) return r.words;
  if (r.match === 'prefix') return `Bash commands starting ${(r.prefix ?? []).join(' ')} …`;
  if (r.match === 'file') return `edits to ${r.path ?? '?'}`;
  if (r.match === 'repo-edits') return 'edits in this repo (same as auto-edits)';
  if (r.match === 'tool') return toolRuleWords(r.tool);
  if (r.tool === 'Bash') {
    if (r.command === undefined) return 'this exact Bash command';
    const n = r.commandChars ?? r.command.length;
    return n > r.command.length ? `this exact command (${n} characters), starting: ${r.command}` : `this exact command: ${r.command}`;
  }
  return EDIT_RULE_TOOLS.includes(r.tool) ? `this exact edit (${r.tool})` : `this exact ${r.tool} call`;
}

/** 8.0:rules-view: a rule's state on the kernel clock. `until` null = off until turned back on. */
export type RuleState = { state: 'on' } | { state: 'off'; until: string | null; since: string | null };

/** A clock in epoch ms (the kernel's: Date.now or the daemon's seam). */
export type KernelClock = () => number;

export interface KernelTrust {
  principal: string;
  isKernelKey: (keyId: string, seq?: number) => boolean;
}

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function bump<V>(m: Map<string, V>, k: string, v: V, cap: number): void {
  m.delete(k);
  m.set(k, v);
  while (m.size > cap) m.delete(m.keys().next().value!);
}

export class RuleBook {
  readonly #trust: KernelTrust;
  readonly #requests = new Map<string, { tool: string; inputHash: string; commandHash: string | null; argv: string[] | null; hsid?: string; command?: string; commandChars?: number; words?: string; bindHash?: string; irreversible?: boolean }>();
  /** 8.0:local-lane C6'a2-1: cardId → the always decide row was presence 'fresh' exactly AND carried a rootSig */
  readonly #freshRoot = new Map<string, boolean>();
  /** cardId → the decide row's scope key ('exact' or the canonical prefix JSON) */
  readonly #always = new Map<string, string>();
  readonly #rules = new Map<string, AlwaysRule>();
  /** TD-2026-10-23-815: the standing grants as their kernel-signed rows say (permission:always tuple, repos, expiry, revoked) */
  readonly #grants = new Map<string, { always: boolean; repos: string[]; device: string; expiresAt: number; revoked: boolean }>();
  /** cardId → the standing grant that covered its always decide row, verified valid AT that row (else absent) */
  readonly #standingDecides = new Map<string, { grantId: string; repos: string[] }>();
  /** 8.0:rules-view: ruleId → its off flag (until: epoch ms, or null = until turned back on) */
  readonly #off = new Map<string, { until: number | null; untilIso: string | null; since: string | null }>();
  readonly #clock: KernelClock;
  /** the last seq folded (incremental readers resume after it) */
  lastSeq = 0;

  constructor(trust: KernelTrust, opts: { clock?: KernelClock } = {}) {
    this.#trust = trust;
    this.#clock = opts.clock ?? Date.now;
  }

  /** Fold one chain row. Rows not signed by the kernel are ignored. */
  fold(r: RuleRow): void {
    if (typeof r.seq === 'number' && r.seq > this.lastSeq) this.lastSeq = r.seq;
    if (r.principal !== this.#trust.principal || typeof r.keyId !== 'string') return;
    const trusted = this.#trust.isKernelKey(r.keyId, r.seq) || isNarrowingRow(r.kind, r.payload);
    // Aegis S2 re-check H-1: from a key the kernel does not trust only a pure revoke, or an off that EXTENDS the off period
    if (!trusted && r.kind !== 'approval.rule.disabled') return;
    const p = obj(r.payload);
    if (!p) return;
    if (r.kind === 'approval.request') {
      const card = obj(p.card);
      if (!card || card.kind !== 'permission' || typeof card.cardId !== 'string' || typeof p.tool !== 'string' || !('tool_input' in p)) return;
      // 8.0:local-lane C5'a2: a brokered card's request row carries the bindHash of its detail (inside the contentHash)
      const bindHash = BROKERED_RULE_TOOL.test(p.tool) && typeof p.bindHash === 'string' && BIND_HASH.test(p.bindHash) ? p.bindHash : null;
      // 8.0:local-lane C6'a2-1: a destructive brokered card is flagged irreversible (the flags inside its contentHash)
      const irreversible = Array.isArray(p.flags) && p.flags.includes('irreversible');
      bump(this.#requests, card.cardId, { tool: p.tool, inputHash: inputHash(p.tool_input), commandHash: p.tool === 'Bash' ? bashCommandHash(p.tool_input) : null, argv: p.tool === 'Bash' && obj(p.tool_input) && typeof obj(p.tool_input)!.command === 'string' ? simpleArgv(String(obj(p.tool_input)!.command)) : null, ...(typeof r.session === 'string' ? { hsid: r.session } : {}), ...commandTextOf(p.tool, p.tool_input), ...((): { words?: string } => { const w = p.tool === 'gnomon_git_push' ? pushRuleWords(p.tool_input) : null; return w ? { words: w } : {}; })(), ...(bindHash ? { bindHash } : {}), ...(irreversible ? { irreversible: true } : {}) }, MAX_TRACKED_REQUESTS);
    } else if (r.kind === 'grant.standing') {
      // TD-2026-10-23-815: the grant as minted (kernel-signed; a malformed row covers nothing)
      const exp = typeof p.expiresAt === 'string' ? Date.parse(p.expiresAt) : NaN;
      if (typeof p.grantId !== 'string' || !GRANT_ID.test(p.grantId) || !Number.isFinite(exp) || typeof p.device !== 'string' || p.device.length === 0) return;
      // Aegis L1: a grant id is minted once; a second grant.standing row for a known id never re-mints (or un-revokes) it
      if (this.#grants.has(p.grantId)) return;
      const tuples = Array.isArray(p.tuples) ? p.tuples : [];
      const repos = Array.isArray(p.repos) ? p.repos.filter((x): x is string => typeof x === 'string') : [];
      bump(this.#grants, p.grantId, { always: tuples.includes('permission:always'), repos, device: p.device, expiresAt: exp, revoked: false }, MAX_TRACKED_REQUESTS);
    } else if (r.kind === 'grant.standing.revoked') {
      const g = typeof p.grantId === 'string' ? this.#grants.get(p.grantId) : undefined;
      if (g) g.revoked = true;
    } else if (r.kind === 'approval.decide') {
      if (p.decision !== 'always' || typeof p.cardId !== 'string') return;
      // TD-2026-10-23-815: a standing-covered always counts only when ITS grant, from the kernel's own rows, was live at
      // this decide row: minted (folded before it), covering permission:always, not revoked before it, not expired at
      // the row's kernel time. The id in the row alone is never trusted.
      this.#standingDecides.delete(p.cardId);
      if (typeof p.presence === 'string' && p.presence.startsWith(STANDING_PREFIX)) {
        const grantId = p.presence.slice(STANDING_PREFIX.length);
        const g = this.#grants.get(grantId);
        const at = typeof r.at === 'string' ? Date.parse(r.at) : NaN;
        // Aegis L2: the decide row's device (the unlock key the broker matched the grant on) must be the grant's own
        if (g && g.always && !g.revoked && Number.isFinite(at) && at < g.expiresAt && typeof p.device === 'string' && p.device === g.device) bump(this.#standingDecides, p.cardId, { grantId, repos: [...g.repos] }, MAX_TRACKED_REQUESTS);
      }
      let key = 'exact';
      if (p.scope !== undefined) {
        const sc = obj(p.scope);
        if (sc && (sc.kind === 'file' || sc.kind === 'repo-edits' || sc.kind === 'tool') && Object.keys(sc).length === 1) key = `@${sc.kind}`;
        else {
          if (!sc || sc.kind !== 'prefix' || !prefixOk(sc.prefix) || Object.keys(sc).length !== 2) return; // a malformed scope learns nothing
          key = JSON.stringify(sc.prefix);
        }
      }
      bump(this.#always, p.cardId, key, MAX_TRACKED_REQUESTS);
      // 8.0:local-lane C6'a2-1: a destructive tool rule needs THIS: fresh presence exactly and the root signature
      const rs = obj(p.rootSig);
      bump(this.#freshRoot, p.cardId, p.presence === 'fresh' && !!rs && typeof rs.signer === 'string' && rs.signer.length > 0 && typeof rs.sig === 'string' && rs.sig.length > 0, MAX_TRACKED_REQUESTS);
    } else if (r.kind === 'approval.rule.learned') {
      const cardId = p.cardId;
      const isPrefix = p.match === 'prefix';
      const isEdit = p.match === 'file' || p.match === 'repo-edits';
      const isTool = p.match === 'tool';
      const exact = 'match' in p ? p.match === 'exact' : p.matchExact === true;
      if (typeof cardId !== 'string' || (!exact && !isPrefix && !isEdit && !isTool) || typeof p.tool !== 'string' || typeof p.repoKey !== 'string') return;
      // Aegis W4-A L2: only a fresh (or CLI) touch learns a rule, never cached or click. TD-2026-10-23-815: or a standing
      // grant the fold verified at the decide row (same grant, permission:always, the rule's repo among its repos)
      if (p.presence !== 'fresh' && p.presence !== 'cli') {
        const sd = this.#standingDecides.get(cardId);
        if (typeof p.presence !== 'string' || !sd || p.presence !== `${STANDING_PREFIX}${sd.grantId}` || !sd.repos.includes(p.repoKey)) return;
      }
      const req = this.#requests.get(cardId);
      const decided = this.#always.get(cardId);
      if (!req || req.tool !== p.tool || decided === undefined) return;
      const base = { ruleId: cardId, repoKey: p.repoKey, tool: p.tool, inputHash: req.inputHash, seq: typeof r.seq === 'number' ? r.seq : null, presence: String(p.presence ?? 'fresh'), ...(typeof r.at === 'string' ? { learnedAt: r.at } : {}), ...(req.hsid ? { hsid: req.hsid } : {}) };
      // 8.0:local-lane C5'a2: a brokered MCP tool learns ONLY a tool rule (never exact, prefix or edits)
      if (BROKERED_RULE_TOOL.test(p.tool) !== isTool) return;
      if (isTool) {
        // the decide row's scope is the tool scope, and the learned bindHash is the one the kernel-signed request row
        // carried from the card's detail (the same check as the tool name above)
        if (decided !== '@tool' || !req.bindHash || p.bindHash !== req.bindHash) return;
        // 8.0:local-lane C6'a2-1 (TD-2026-10-28-969): a destructive (irreversible) card learns only from a FRESH touch
        // with the root key — never standing, CLI, cached or voice
        if (req.irreversible) {
          if (p.presence !== 'fresh' || this.#freshRoot.get(cardId) !== true) return;
          bump(this.#rules, cardId, { ...base, match: 'tool', bindHash: req.bindHash, destructive: true }, MAX_RULES);
          return;
        }
        bump(this.#rules, cardId, { ...base, match: 'tool', bindHash: req.bindHash }, MAX_RULES);
        return;
      }
      if (exact) {
        if (decided !== 'exact') return; // a scoped decision never learns a different rule
        bump(this.#rules, cardId, { ...base, match: 'exact', ...(req.words ? { words: req.words } : {}), ...(p.tool === 'Bash' ? { commandHash: req.commandHash, ...(req.command !== undefined ? { command: req.command, commandChars: req.commandChars ?? req.command.length } : {}) } : {}) }, MAX_RULES);
        return;
      }
      if (isEdit) {
        // scoped edits: an edit tool only, the decide row's scope is the same kind, a file rule names an absolute path
        if (!EDIT_RULE_TOOLS.includes(p.tool) || decided !== `@${String(p.match)}`) return;
        if (p.match === 'file') {
          if (typeof p.path !== 'string' || !path.isAbsolute(p.path) || p.path.includes('\u0000')) return;
          bump(this.#rules, cardId, { ...base, match: 'file', path: p.path }, MAX_RULES);
        } else bump(this.#rules, cardId, { ...base, match: 'repo-edits' }, MAX_RULES);
        return;
      }
      // prefix: Bash only, the decide row's scope is the same prefix, and the shown command starts with it
      if (p.tool !== 'Bash' || !prefixOk(p.prefix) || decided !== JSON.stringify(p.prefix) || !req.argv || !startsWith(req.argv, p.prefix)) return;
      if (prefixRefusal(p.prefix) !== null) return; // Aegis H1: a prefix the policy refuses forms no rule, whatever the chain says
      bump(this.#rules, cardId, { ...base, match: 'prefix', prefix: [...p.prefix] }, MAX_RULES);
    } else if (r.kind === 'approval.mode.set') {
      // Aegis H1: the emergency brake. A REPO-scope tightening (no hsid) stops that repo's repo-edits rules, as a revoke
      // would (the always decision is forgotten too, so a replayed learned row never brings one back); a later always
      // on a new card learns a new rule. File and prefix rules are untouched (they stay allowed at a stricter level).
      const sc = obj(p.scope);
      if (!sc || typeof sc.repo !== 'string' || sc.hsid !== undefined) return;
      const from = RULE_MODE_RANK[String(p.from)];
      const to = RULE_MODE_RANK[String(p.to)];
      if (from === undefined || to === undefined || to >= from) return;
      for (const [id, rule] of [...this.#rules]) {
        if (rule.match !== 'repo-edits' || rule.repoKey !== sc.repo) continue;
        this.#rules.delete(id);
        this.#always.delete(id);
        this.#off.delete(id);
      }
    } else if (r.kind === 'approval.rule.revoked') {
      if (typeof p.ruleId !== 'string') return;
      this.#rules.delete(p.ruleId);
      this.#always.delete(p.ruleId);
      this.#freshRoot.delete(p.ruleId);
      this.#off.delete(p.ruleId);
    } else if (r.kind === 'approval.rule.disabled') {
      // 8.0:rules-view: off, on a rule that STANDS (an off row for an unknown or revoked rule marks nothing)
      if (typeof p.ruleId !== 'string' || !this.#rules.has(p.ruleId)) return;
      let until: number | null = null;
      if (p.until !== null) {
        if (typeof p.until !== 'string' || !RULE_ISO_TIME.test(p.until)) return;
        until = Date.parse(p.until);
        if (!Number.isFinite(until)) return;
      }
      if (!trusted) {
        const cur = this.#off.get(p.ruleId);
        const extends_ = !cur || (cur.until !== null && (until === null || until > cur.until));
        if (!extends_) return;
      }
      this.#off.set(p.ruleId, { until, untilIso: until === null ? null : (p.until as string), since: typeof r.at === 'string' ? r.at : null });
    } else if (r.kind === 'approval.rule.enabled') {
      // Aegis M2: enabled only clears a flag on a standing rule; it never creates one and never undoes a revoke
      if (typeof p.ruleId !== 'string' || !this.#rules.has(p.ruleId)) return;
      const cur = this.#off.get(p.ruleId);
      if (!cur) return;
      // Aegis M-2 (review 2026-10-23): BOTH causes clear only the flag they name (`until`, null = until turned back on),
      // so a stale card's allow, or an old expiry, never undoes a later off with another time
      if ((p.cause === 'human' && 'until' in p && (p.until === null || typeof p.until === 'string') && cur.untilIso === p.until) || (p.cause === 'expired' && typeof p.until === 'string' && cur.untilIso === p.until)) this.#off.delete(p.ruleId);
    }
  }

  /** 8.0:rules-view: the rule's state at `now` (the kernel clock): an off whose time has passed reads on. */
  stateOf(ruleId: string, now: number = this.#clock()): RuleState {
    const f = this.#off.get(ruleId);
    if (!f || !this.#rules.has(ruleId) || (f.until !== null && f.until <= now)) return { state: 'on' };
    return { state: 'off', until: f.untilIso, since: f.since };
  }

  /** The rule stands and no live off flag covers it at `now`. */
  isOn(ruleId: string, now: number = this.#clock()): boolean {
    return this.#rules.has(ruleId) && this.stateOf(ruleId, now).state === 'on';
  }

  /** The kernel clock this book reads (status shows it; the apply handler validates `until` against it). */
  now(): number {
    return this.#clock();
  }

  /** The off flags whose time has passed (the sweep writes approval.rule.enabled{cause:'expired'} for each). */
  dueExpiries(now: number = this.#clock()): Array<{ rule: AlwaysRule; until: string }> {
    const out: Array<{ rule: AlwaysRule; until: string }> = [];
    for (const [id, f] of this.#off) {
      const rule = this.#rules.get(id);
      if (rule && f.until !== null && f.untilIso !== null && f.until <= now) out.push({ rule, until: f.untilIso });
    }
    return out;
  }

  /** The standing rule with this id, or null (revoked or never learned). */
  get(ruleId: string): AlwaysRule | null {
    return this.#rules.get(ruleId) ?? null;
  }

  /**
   * The rule (repoKey, tool, input) matches, or null: an exact rule by inputHash; a prefix rule only when the
   * input is a Bash command that is one literal simple command whose argv starts with the prefix, `ctx` allows prefix
   * rules (not manual mode) and #prefix-policy passes the argv against the session roots.
   */
  match(repoKey: string, tool: string, hash: string, toolInput?: unknown, ctx?: PrefixMatchContext): AlwaysRule | null {
    // 8.0:rules-view: an off rule never matches (one clock reading for the whole match)
    const now = this.#clock();
    const live = [...this.#rules.values()].filter((r) => this.isOn(r.ruleId, now));
    // 8.0:local-lane C5'a2 (^local-tool-grant): a brokered MCP tool matches only a tool rule with the call's bindHash NOW,
    // never in manual mode; a rule whose binding differs is dormant (it stands, it does not match)
    if (tool.startsWith('mcp:')) {
      if (!ctx || !ctx.prefixRules || typeof ctx.bindHash !== 'string' || !BIND_HASH.test(ctx.bindHash)) return null;
      // 8.0:local-lane C6'a2-1: a destructive call matches only a destructive rule, any other call only a mutate rule
      const destructive = ctx.toolClass === 'destructive';
      for (const r of live) if (r.match === 'tool' && r.repoKey === repoKey && r.tool === tool && r.bindHash === ctx.bindHash && (r.destructive === true) === destructive) return r;
      return null;
    }
    for (const r of live) if (r.match === 'exact' && r.repoKey === repoKey && r.tool === tool && r.inputHash === hash) return r;
    // RC5: an exact Bash rule also matches the same command text with another description/timeout (both hashes fold)
    if (tool === 'Bash' && toolInput !== undefined) {
      const ch = bashCommandHash(toolInput);
      if (ch !== null) for (const r of live) if (r.match === 'exact' && r.repoKey === repoKey && r.tool === tool && r.commandHash === ch) return r;
    }
    // scoped edits: only through the supervisor's auto-edits pass for this request, never in manual mode
    if (EDIT_RULE_TOOLS.includes(tool)) {
      if (!ctx || !ctx.prefixRules || typeof ctx.editPath !== 'string' || !ctx.roots.length) return null;
      // Aegis L4: a file rule covers ANY edit tool on that path ("edits to this file, any content"), by design
      for (const r of live) if (r.repoKey === repoKey && r.match === 'file' && r.path === ctx.editPath) return r;
      // Aegis H1: a repo-edits rule is auto-edits by another name: only where the ceiling allows auto-edits
      if (ctx.repoEdits !== true) return null;
      for (const r of live) if (r.repoKey === repoKey && r.match === 'repo-edits') return r;
      return null;
    }
    // Aegis M2/M3: prefix rules need the session context (roots) and never apply in manual mode
    if (tool !== 'Bash' || toolInput === undefined || !ctx || !ctx.prefixRules || !ctx.roots.length) return null;
    let argv: string[] | null = null;
    for (const r of live) {
      if (r.match !== 'prefix' || r.repoKey !== repoKey || r.tool !== tool || !r.prefix) continue;
      argv ??= bashArgvOfInput(toolInput);
      if (!argv) return null;
      if (startsWith(argv, r.prefix) && prefixMatchRefusal(argv, r.prefix, ctx.roots) === null) return r;
    }
    return null;
  }

  /** The repo's standing "edits in this repo" rule (the newest), or null: the mode chip says "ask · edits allowed by rule". */
  repoEditsRule(repoKey: string): AlwaysRule | null {
    // 8.0:rules-view (Aegis L2): an off rule is not "edits allowed by rule"
    const now = this.#clock();
    let last: AlwaysRule | null = null;
    for (const r of this.#rules.values()) if (r.match === 'repo-edits' && r.repoKey === repoKey && this.isOn(r.ruleId, now)) last = r;
    return last;
  }

  list(): AlwaysRule[] {
    return [...this.#rules.values()];
  }

  /** Everything up to `seq` has been scanned (rule kind or not): the next read starts after it. */
  advanceTo(seq: number): void {
    if (seq > this.lastSeq) this.lastSeq = seq;
  }
}

/**
 * A chain reader for catchUp: `head()` MUST be a seq every row at or below
 * which `read` can return — the RELEASED head (kernel-log.ts releasedHead,
 * D83), never the committed tip. A critical row waiting on its anchors hides
 * itself and every later row from `log.read`; a tip-valued head would make
 * catchUp advance past rows it never saw and skip them forever (Aegis H1: a
 * revoke appended while a critical approval.decide is pending was never
 * folded). Released heads only grow, so a row hidden now is read next time.
 */
export interface RuleSource {
  head(): number;
  read(fromSeq: number, toSeq: number): Iterable<RuleRow>;
}

/** The kernel log as a RuleSource: released head + the RULE_KINDS rows in full view (shared by the daemon and its tests). */
export function ruleSourceOf(log: Pick<KernelLog, 'releasedHead' | 'read'>): RuleSource {
  return {
    head: () => log.releasedHead(),
    read: function* (fromSeq, toSeq) {
      for (const v of log.read({ reader: { class: 'human' }, fromSeq, toSeq, kinds: RULE_KINDS })) {
        if (v.view === 'full') yield { seq: v.event.seq, at: v.event.at, kind: v.event.kind, principal: v.event.principal, keyId: v.event.keyId, payload: v.event.payload, ...(typeof v.event.session === 'string' ? { session: v.event.session } : {}) };
      }
    },
  };
}

/**
 * Aegis C2: fold the rows appended since the last catch-up and advance past
 * EVERY row up to the head captured first — not only past rule kinds — so a
 * chain of non-rule rows is scanned once, never on each request. Rows
 * appended after the head was captured are read next time. Returns whether
 * the source was read at all. Aegis H1: the head is the source's RELEASED
 * head (RuleSource), so the advance never passes a row the read could not
 * return; a row seq above the captured head is never folded early either.
 */
export function catchUp(book: Pick<RuleBook, 'lastSeq' | 'fold' | 'advanceTo'>, src: RuleSource): boolean {
  const head = src.head();
  if (head <= book.lastSeq) return false;
  for (const r of src.read(book.lastSeq + 1, head)) {
    if (r.seq !== undefined && r.seq > head) break;
    book.fold(r);
  }
  book.advanceTo(head);
  return true;
}
