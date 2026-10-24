/**
 * @symbol #gui-host-hints
 *
 * Host-aware rendering, the founder's "pre-sanitization" (2026-10-23): "the gnomon tool should always do a pre
 * sanitization before output goes to the user based on the context of the situation". A Gnomon session runs claude
 * headless, so a reply that says "run `/plugin marketplace add x` and restart" asks for something Gnomon cannot do.
 * PURE. This module is the ONE mapping table from such an instruction to the Gnomon way of doing it.
 *
 *   - The reply text is NEVER rewritten, hidden or struck (honesty and the audit trail): hostHintsOf only READS it and
 *     returns hints the page draws as host slips under the reply (ui/host-slip.ts, design-system host-slip).
 *   - Recognised: slash commands (/plugin …, /mcp, /config, /login, /permissions, /clear, … and any /command after
 *     "run", "type", "use", "enter", "try"), "restart the session" / "restart Claude Code", and "run claude …".
 *   - Where a slash command counts: an inline code span that starts with it, a line that starts with it (prose or a
 *     fence; a "$ " or "> " prompt and list bullets allowed), or right after one of the verbs above. A path
 *     (/usr/bin, /api/users), an HTTP route ("GET /login", "the /login route") and a bare word in prose never count.
 *     A name this table does not know counts only after a verb or when namespaced (/plugin-name:command).
 *   - An action is ONE of: copy a terminal command (the exact bytes the slip shows; built from the table and an
 *     argument that is a plain token, SAFE_ARG, else no command at all), or open a Gnomon screen by palette command id
 *     (HOST_OPEN_IDS only: opening a screen decides nothing). Recognition itself never executes, sends or writes.
 *   - At most HOST_HINTS_MAX hints per reply, one per instruction (deduplicated).
 */

/** The palette command ids a host slip may open (screens only: none sends, decides or changes anything). */
export const HOST_OPEN_IDS = Object.freeze(['mcp.open', 'rules.open', 'local.setup', 'settings.open', 'voice.settings.open', 'session.new'] as const);
export type HostOpenId = (typeof HOST_OPEN_IDS)[number];

export type HostAction = { kind: 'copy'; command: string } | { kind: 'open'; id: HostOpenId; label: string };

export interface HostHint {
  /** the instruction as the reply put it (shown in the slip's tab as code), capped */
  said: string;
  /** what to do in Gnomon, in the GUI's words (from the table, never model text) */
  line: string;
  action: HostAction | null;
}

export const HOST_HINTS_MAX = 3;
const SAID_MAX = 80;
const ARG_MAX = 200;
/** A command argument the slip may put in a copied command: a plain token (owner/repo, a URL, name@marketplace). */
export const SAFE_ARG = /^[A-Za-z0-9][A-Za-z0-9._@/:+-]*$/;
const safeArg = (a: string | undefined): a is string => typeof a === 'string' && a.length <= ARG_MAX && SAFE_ARG.test(a);

export const NO_SLASH = "Slash commands don't run in Gnomon.";
const IN_TERMINAL = "Slash commands don't run in Gnomon. Run this in your terminal:";

const open = (id: HostOpenId, label: string): HostAction => ({ kind: 'open', id, label });
const copy = (command: string): HostAction => ({ kind: 'copy', command });

/** One rule: the words and the action for a slash command, given what follows it on its line (`rest`, trimmed). */
type SlashRule = (rest: string) => { line: string; action: HostAction | null; said?: string };

/** `/plugin …` → the `claude plugin …` CLI (it mirrors the slash subcommands); anything else → `claude plugin --help`. */
const PLUGIN_SUBS: ReadonlyArray<readonly [RegExp, (m: RegExpExecArray) => string | null]> = [
  [/^marketplace\s+(add|remove|rm|update)\s+(\S+)/i, (m) => (safeArg(m[2]) ? `claude plugin marketplace ${m[1]!.toLowerCase()} ${m[2]}` : null)],
  [/^marketplace\s+(list|update)\b/i, (m) => `claude plugin marketplace ${m[1]!.toLowerCase()}`],
  [/^(install|i|uninstall|remove|rm|enable|disable|update)\s+(\S+)/i, (m) => (safeArg(m[2]) ? `claude plugin ${m[1]!.toLowerCase() === 'i' ? 'install' : m[1]!.toLowerCase()} ${m[2]}` : null)],
];
function pluginRule(rest: string): ReturnType<SlashRule> {
  for (const [re, cmd] of PLUGIN_SUBS) {
    const m = re.exec(rest);
    if (!m) continue;
    const c = cmd(m);
    return { said: `/plugin ${m[0]}`, ...(c ? { line: IN_TERMINAL, action: copy(c) } : { line: `${NO_SLASH} Plugins are managed from your terminal, with claude plugin.`, action: null }) };
  }
  return { said: '/plugin', line: `${NO_SLASH} Plugins are managed from your terminal:`, action: copy('claude plugin --help') };
}

/**
 * THE MAPPING TABLE: Claude Code's built-in slash commands Gnomon has a way for. A built-in that is not here (BUILTINS)
 * gets the generic words; any other name gets them only after a verb or when namespaced.
 */
export const HOST_SLASH_TABLE: Readonly<Record<string, SlashRule>> = Object.freeze({
  plugin: pluginRule,
  plugins: pluginRule,
  mcp: () => ({ line: `${NO_SLASH} MCP servers are in Settings.`, action: open('mcp.open', 'Open MCP servers') }),
  config: () => ({ line: `${NO_SLASH} Gnomon's settings are in Settings.`, action: open('settings.open', 'Open Settings') }),
  settings: () => ({ line: `${NO_SLASH} Gnomon's settings are in Settings.`, action: open('settings.open', 'Open Settings') }),
  permissions: () => ({ line: `${NO_SLASH} What runs without asking is in Rules.`, action: open('rules.open', 'Open Rules') }),
  'allowed-tools': () => ({ line: `${NO_SLASH} What runs without asking is in Rules.`, action: open('rules.open', 'Open Rules') }),
  login: () => ({ line: `${NO_SLASH} Sign in from your terminal: run this, then type /login in it.`, action: copy('claude') }),
  logout: () => ({ line: `${NO_SLASH} Sign out from your terminal: run this, then type /logout in it.`, action: copy('claude') }),
  clear: () => ({ line: `${NO_SLASH} For a clean context, start a new session.`, action: open('session.new', 'New session…') }),
  new: () => ({ line: `${NO_SLASH} For a clean context, start a new session.`, action: open('session.new', 'New session…') }),
  reset: () => ({ line: `${NO_SLASH} For a clean context, start a new session.`, action: open('session.new', 'New session…') }),
  compact: () => ({ line: `${NO_SLASH} For a clean context, start a new session.`, action: open('session.new', 'New session…') }),
  resume: () => ({ line: `${NO_SLASH} Your sessions are in the sessions list: pick one to go back to it.`, action: null }),
  continue: () => ({ line: `${NO_SLASH} Your sessions are in the sessions list: pick one to go back to it.`, action: null }),
  model: () => ({ line: `${NO_SLASH} Pick the model in this chat's header.`, action: null }),
  doctor: () => ({ line: IN_TERMINAL, action: copy('claude doctor') }),
  voice: () => ({ line: `${NO_SLASH} Voice is in Voice settings.`, action: open('voice.settings.open', 'Open Voice settings') }),
  local: () => ({ line: `${NO_SLASH} The local model is in Settings.`, action: open('local.setup', 'Open Local model') }),
});

/** Claude Code's other built-ins: recognised in code spans and at a line start, with the generic words. */
export const BUILTINS: ReadonlySet<string> = new Set([
  'add-dir', 'agents', 'bashes', 'bug', 'context', 'cost', 'exit', 'export', 'help', 'hooks', 'ide', 'init', 'install-github-app',
  'memory', 'output-style', 'pr-comments', 'privacy-settings', 'quit', 'release-notes', 'review', 'rewind', 'sandbox',
  'security-review', 'status', 'statusline', 'terminal-setup', 'todos', 'upgrade', 'usage', 'vim',
]);

const VERB = /(?:^|[^A-Za-z])(?:run|type|use|enter|try|execute|invoke|issue|send)(?:\s+(?:the|this|a))?(?:\s+command)?[\s:]*["'“`]?$/i;
const HTTP_BEFORE = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*["'`]?$/;
const ROUTE_AFTER = /^["'`]?\s+(?:route|routes|endpoint|endpoints|page|pages|path|paths|folder|folders|directory|directories|dir|handler|handlers|url|api|view|screen)\b/i;

/** The slash commands of a reply, with their context (code span, line start, after a verb). */
interface SlashHit {
  name: string;
  /** what follows the name on its line (inside the span for a code span), trimmed */
  rest: string;
  how: 'code' | 'line' | 'verb';
  at: number;
}

function slashHits(text: string): SlashHit[] {
  const out: SlashHit[] = [];
  // the name: a letter, then letters, digits and dashes, optionally namespaced (plugin:command); never followed by
  // a path or a file name (/usr/bin, /api/users, /config.json)
  const re = /\/([a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)?)(?![a-z0-9/.\\-]|:[a-z0-9])/gi;
  for (const m of text.matchAll(re)) {
    const at = m.index!;
    const before = text.slice(Math.max(0, at - 40), at);
    const prev = before.slice(-1);
    // a slash inside a word or a path ("and/or", "src/mcp", "https://x/mcp") is never a command
    if (prev && !/[\s`"'“(\[]/.test(prev)) continue;
    const lineStart = text.lastIndexOf('\n', at - 1) + 1;
    const lineEnd = ((e) => (e < 0 ? text.length : e))(text.indexOf('\n', at));
    const lead = text.slice(lineStart, at);
    const after = text.slice(at + m[0].length, lineEnd);
    if (HTTP_BEFORE.test(before) || ROUTE_AFTER.test(after)) continue;
    const name = m[1]!.toLowerCase();
    // an inline code span that opens right before the slash: its content is the command
    const ticks = (lead.match(/`/g) ?? []).length;
    if (prev === '`' && ticks % 2 === 1) {
      const close = after.indexOf('`');
      if (close >= 0) {
        out.push({ name, rest: after.slice(0, close).trim(), how: 'code', at });
        continue;
      }
    }
    if (/^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:[$>]\s*)?["'“`]?$/.test(lead)) {
      out.push({ name, rest: after.replace(/[`"'”]+\s*$/, '').trim(), how: 'line', at });
      continue;
    }
    if (VERB.test(before)) {
      const quoted = /^["'“`]$/.test(prev);
      const rest = quoted ? after.slice(0, Math.max(0, after.search(/["'”`]/))).trim() : after.split(/[,;]|\.(?:\s|$)|\s(?:and|then|to|or)\s/)[0]!.trim();
      out.push({ name, rest: rest.replace(/[.,;:!?)]+$/, ''), how: 'verb', at });
    }
  }
  return out;
}

/** The hint for one slash hit, or null (an unknown name outside a verb or a namespace). */
function slashHint(hit: SlashHit): HostHint | null {
  const base = hit.name.split(':')[0]!;
  const rule = !hit.name.includes(':') && Object.hasOwn(HOST_SLASH_TABLE, base) ? HOST_SLASH_TABLE[base]! : null;
  if (rule) {
    const r = rule(hit.rest);
    return { said: capSaid(r.said ?? `/${hit.name}`), line: r.line, action: r.action };
  }
  if (BUILTINS.has(hit.name) || hit.how === 'verb' || hit.name.includes(':')) return { said: capSaid(`/${hit.name}`), line: NO_SLASH, action: null };
  return null;
}

const capSaid = (s: string): string => (s.length <= SAID_MAX ? s : `${s.slice(0, SAID_MAX - 1)}…`);

/** "restart the session", "restart Claude Code", "restart your claude session" */
const RESTART = /\brestart(?:ing)?\s+(?:the\s+|your\s+|this\s+)?(?:claude(?:\s+code)?(?:\s+session)?|session|conversation|cli)\b/i;
/** "run `claude …`", "start claude", or a code span / line that starts with `claude` */
const CLAUDE_VERB = /\b(?:run|type|start|launch|open|use)\s+(?:the\s+command\s+)?(`?)claude\b([^`\n]*)\1/gi;
const CLAUDE_LINE = /(^|\n)[ \t]*(?:[$>][ \t]*)?(`?)claude\b([^`\n]*)\2/g;
const CLAUDE_CODE = /`claude\b([^`\n]*)`/g;

/** The hint for a `claude …` command line the reply asks for, or null. */
function claudeHint(argsRaw: string): HostHint | null {
  const args = argsRaw.replace(/[.,;:!?)]+$/, '').trim();
  // "claude code" in prose is the product name, not a command
  if (/^code\b/i.test(args)) return null;
  const toks = args ? args.split(/\s+/) : [];
  const said = capSaid(`claude${args ? ` ${args}` : ''}`);
  if (toks[0] === 'plugin' || toks[0] === 'plugins') {
    const ok = toks.length <= 5 && toks.slice(1).every((t) => /^[a-z][a-z-]*$/i.test(t) || safeArg(t));
    return ok ? { said, line: 'This runs in your terminal, not in Gnomon:', action: copy(['claude', 'plugin', ...toks.slice(1)].join(' ')) } : { said, line: 'This runs in your terminal, not in Gnomon.', action: null };
  }
  if (toks[0] === 'mcp') return { said, line: 'In Gnomon, MCP servers are in Settings.', action: open('mcp.open', 'Open MCP servers') };
  if (toks[0] === 'doctor') return { said, line: 'This runs in your terminal, not in Gnomon:', action: copy('claude doctor') };
  if (!toks.length || /^(?:-c|--continue|-r|--resume)$/.test(toks[0]!)) return { said, line: 'Gnomon already runs Claude for you: this chat is the session. For a fresh one, start a new session.', action: open('session.new', 'New session…') };
  return { said, line: 'Gnomon already runs Claude for you; this runs in your own terminal, not here.', action: null };
}

/**
 * The host hints for one reply's text, in reading order, at most HOST_HINTS_MAX, one per instruction. Reads the text
 * only: the caller shows the text exactly as it came and draws each hint beside it.
 */
export function hostHintsOf(text: string): HostHint[] {
  if (!text || (!text.includes('/') && !/restart|claude/i.test(text))) return [];
  const found: Array<{ at: number; hint: HostHint }> = [];
  for (const hit of slashHits(text)) {
    const hint = slashHint(hit);
    if (hint) found.push({ at: hit.at, hint });
  }
  const r = RESTART.exec(text);
  if (r) found.push({ at: r.index, hint: { said: capSaid(r[0]), line: 'Gnomon has no restart: a new session starts fresh with the change; this one keeps its context.', action: open('session.new', 'New session…') } });
  const seenClaude = new Set<number>();
  const pushClaude = (at: number, args: string): void => {
    if (seenClaude.has(at)) return;
    seenClaude.add(at);
    const hint = claudeHint(args);
    if (hint) found.push({ at, hint });
  };
  for (const m of text.matchAll(CLAUDE_VERB)) pushClaude(m.index! + m[0].toLowerCase().lastIndexOf('claude'), m[2]!);
  for (const m of text.matchAll(CLAUDE_LINE)) pushClaude(m.index! + m[0].toLowerCase().indexOf('claude'), m[3]!);
  for (const m of text.matchAll(CLAUDE_CODE)) pushClaude(m.index! + 1, m[1]!);
  found.sort((a, b) => a.at - b.at);
  const out: HostHint[] = [];
  const seen = new Set<string>();
  for (const { hint } of found) {
    const k = `${hint.said}\u0000${hint.action?.kind === 'copy' ? hint.action.command : hint.action?.id ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(hint);
    if (out.length >= HOST_HINTS_MAX) break;
  }
  return out;
}

/** The text the slip's Copy key writes: the command exactly as the slip shows it (null for a hint with no command). */
export const copyTextOf = (h: HostHint): string | null => (h.action?.kind === 'copy' ? h.action.command : null);
