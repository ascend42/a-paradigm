/**
 * @symbol #gui-slash-menu
 *
 * #gui-slash-menu (8.0:local-lane slice C6'b2-1; Mika's design, TD-2026-10-28-956 and -969; spec G-GUI-19). PURE: the
 * "/" menu of the composer — its rows, its words, its args panel's fields and the requests a press sends. The DOM and
 * the press paths are ui/slash-menu.ts (SlashFlow, modelled on ToolsFlow); the run rows it starts are
 * core/slash-runs.ts (#gui-slash-runs); the kernel side is C6'a2 (request.session.tools.start / .run / .result,
 * request.session.skills.list / .skill.run; capabilities tools[].run, params, fullSchema, policy).
 *
 *   - A listbox anchored above the composer. Groups, in order: Skills · Gnomon commands · Tools by server. Each row is
 *     a name, a note (its cost tag: runs now · asks first · card with Touch ID · posts as your turn · opens a screen)
 *     and a why (the description, or the reason it cannot run).
 *   - A row that cannot run stays in the list, aria-disabled (focusable, quiet ink), its reason as the note: never a
 *     kernel code ("untrusted", "unchecked-schema") shown raw.
 *   - Tier 0 with servers not started: ONE row, "Start servers for /" (starts N servers; the model still gets no
 *     tools). Servers off at a tier above 0: one row "servers are off in this session" that opens Tools.
 *   - The args panel: one field per argument (text, number, a seg for an enum or a boolean, mono JSON for anything
 *     complex) and a Run key that names its cost ("Run · runs now" / "Run · asks first" / "Run · card with Touch ID").
 *   - Every server- and repo-written string passes displayText (render.ts) and is capped (tools-drawer.ts shown).
 */
import { CLASS_WORD, fitWords, shown, type Capabilities, type CapParam, type CapRun, type CapTool, type ToolClass } from './tools-drawer.js';

export const TOOLS_START_REQUEST = 'request.session.tools.start' as const;
export const TOOLS_RUN_REQUEST = 'request.session.tools.run' as const;
export const TOOLS_RESULT_REQUEST = 'request.session.tools.result' as const;
export const SKILLS_LIST_REQUEST = 'request.session.skills.list' as const;
export const SKILL_RUN_REQUEST = 'request.session.skill.run' as const;
/** The kernel's SKILL_ARGS_MAX_BYTES (skill-run.ts). */
export const SKILL_ARGS_MAX_BYTES = 4096;
/** The kernel's HUMAN_RUNS_PER_MINUTE (tool-broker.ts): "/" runs per session per minute. */
export const RUNS_PER_MINUTE = 10;

export type SlashGroup = 'skills' | 'commands' | 'tools';
export type SlashKind = 'skill' | 'command' | 'tool' | 'start' | 'see-tools';

/* ── copy (Mika) ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export const SLASH_COPY = Object.freeze({
  label: '/ menu',
  group: Object.freeze({ skills: 'Skills', commands: 'Gnomon commands', tools: 'Tools' }) as Readonly<Record<SlashGroup, string>>,
  reading: 'Reading this session’s skills and tools…',
  unreachable: 'Can’t reach the kernel: the list may be short · next: open / again once Gnomon is connected',
  noMatch: 'Nothing matches. Enter sends your text as a message.',
  start: 'Start servers for /',
  starting: 'starting…',
  startNote: (n: number): string => `starts ${n} server${n === 1 ? '' : 's'}; the model still gets no tools`,
  serversOff: 'servers are off in this session',
  seeTools: 'see Tools',
  opens: 'opens a screen',
  posts: 'posts as your turn',
  notLoaded: 'not available in this session',
  args: 'Arguments',
  argsHint: 'one line',
  needed: 'needed',
  /** a required field left empty (Mika C6'b2-1 #6: the marker says needed; the error says what to do) */
  neededErr: 'needed: fill this in',
  notNumber: 'a number',
  notWhole: 'a whole number',
  notJson: 'not valid JSON',
  unset: 'not set',
  close: 'Esc closes the menu',
  cost: Object.freeze({ read: 'runs now', mutate: 'asks first', destructive: 'card with Touch ID' }) as Readonly<Record<ToolClass, string>>,
});

/** The cost tag of a tool's class (the row's note, the Run key's second half). */
export const costWord = (cls: ToolClass): string => SLASH_COPY.cost[cls];

/** The Run key: "Run · runs now", "Run · asks first", "Run · card with Touch ID", "Run · posts as your turn". */
export function runKeyLabel(it: Pick<SlashItem, 'kind' | 'tool'>): string {
  if (it.kind === 'skill') return `Run · ${SLASH_COPY.posts}`;
  return `Run · ${costWord(it.tool?.class ?? 'read')}`;
}

/** Why a tool cannot run from "/", in words (capabilities tools[].run), never the code. */
export function whyWords(run: Pick<CapRun, 'why' | 'detail'>): string {
  switch (run.why) {
    case 'untrusted':
      return 'not trusted · next: trust it in Settings › MCP servers';
    case 'unchecked-schema':
      return `Gnomon can’t check its inputs: ${run.detail ?? 'its schema is not one Gnomon reads'}`;
    default:
      return 'Gnomon can’t run this one from /';
  }
}

/* ── the kernel's skills, shape-checked ──────────────────────────────────────────────────────────────────────────── */

export interface SkillListing {
  name: string;
  loaded: boolean;
  why: string;
  description: string;
  /** the args field's placeholder (one line) */
  argumentHint: string;
}
/** The kernel's skill name rule (contracts SKILL_NAME_PATTERN). */
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** request.session.skills.list's answer, cleaned; null when it is not one. A name outside the rule is never runnable. */
export function skillsOf(v: unknown, hsid: string): SkillListing[] | null {
  if (!isObj(v) || v.hsid !== hsid || !Array.isArray(v.skills)) return null;
  return v.skills
    .filter(isObj)
    .filter((s) => typeof s.name === 'string' && s.name.length > 0)
    .slice(0, 128)
    .map((s) => {
      const name = shown(s.name, 64);
      const ok = SKILL_NAME.test(name) && s.loaded === true;
      return { name, loaded: ok, why: ok ? '' : shown(s.why) || SLASH_COPY.notLoaded, description: shown(s.description), argumentHint: shown(s.argumentHint, 120).replace(/\s+/g, ' ') };
    });
}

/* ── the rows ────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** A Gnomon command the menu offers (a palette command id; pressing it opens a screen, nothing more). */
export interface SlashCommand {
  id: string;
  name: string;
  why: string;
}
/** The Gnomon commands of the menu (palette ids; each opens a screen). */
export const SLASH_COMMANDS: readonly SlashCommand[] = Object.freeze([
  { id: 'tools.open', name: 'tools', why: 'this session’s tools, servers, pins and memory' },
  { id: 'rules.open', name: 'rules', why: 'what runs without asking' },
  { id: 'mcp.open', name: 'mcp', why: 'MCP servers: trust and turn on' },
  { id: 'settings.open', name: 'settings', why: 'every setting' },
  { id: 'session.new', name: 'new', why: 'a new session, fresh context' },
]);

export interface SlashItem {
  /** stable per row: skill:<name> · cmd:<id> · tool:<capability id> · start · see-tools */
  key: string;
  /** the option's DOM id, stable across repaints (aria-activedescendant) */
  id: string;
  group: SlashGroup;
  /** the group heading: Skills · Gnomon commands · a server's label */
  groupLabel: string;
  kind: SlashKind;
  name: string;
  /** the cost tag, or the reason it cannot run */
  note: string;
  /** the description */
  why: string;
  /** aria-disabled: focusable, quiet, sends nothing */
  disabled: boolean;
  skill?: SkillListing;
  command?: string;
  tool?: CapTool;
}

/** A DOM id from a row key: stable, valid, short (FNV-1a over the key). */
export function slashOptionId(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `slash-o-${key.split(':')[0]!.replace(/[^a-z-]/g, '')}-${h.toString(36)}`;
}

export interface SlashSource {
  /** the session's capabilities (null: not a local session the human owns, or not read) */
  caps: Capabilities | null;
  skills: SkillListing[] | null;
  commands: readonly SlashCommand[];
  /** a tools.start in flight, and the last one's failure in words */
  starting?: boolean;
  startError?: string | null;
}

/** Every row of the menu, in group order: Skills · Gnomon commands · Tools by server. */
export function slashItemsOf(src: SlashSource): SlashItem[] {
  const out: SlashItem[] = [];
  const add = (it: Omit<SlashItem, 'id'>): void => void out.push({ ...it, id: slashOptionId(it.key) });
  for (const s of src.skills ?? [])
    add({ key: `skill:${s.name}`, group: 'skills', groupLabel: SLASH_COPY.group.skills, kind: 'skill', name: `/${s.name}`, note: s.loaded ? SLASH_COPY.posts : s.why, why: s.description, disabled: !s.loaded, skill: s });
  for (const c of src.commands) add({ key: `cmd:${c.id}`, group: 'commands', groupLabel: SLASH_COPY.group.commands, kind: 'command', name: `/${c.name}`, note: SLASH_COPY.opens, why: c.why, disabled: false, command: c.id });
  const c = src.caps;
  if (!c) return out;
  const tg = SLASH_COPY.group.tools;
  if (c.tier === 0 && c.tools.length === 0) {
    const n = c.servers.filter((s) => s.state === 'not-started').length;
    if (n > 0) {
      const err = src.startError ?? null;
      add({ key: 'start', group: 'tools', groupLabel: tg, kind: 'start', name: SLASH_COPY.start, note: src.starting ? SLASH_COPY.starting : SLASH_COPY.startNote(n), why: err ?? '', disabled: !!src.starting });
    }
    return out;
  }
  if (c.tools.length === 0 && c.servers.length > 0 && !c.servers.some((s) => s.state === 'running' || s.state === 'starting')) {
    add({ key: 'see-tools', group: 'tools', groupLabel: tg, kind: 'see-tools', name: SLASH_COPY.serversOff, note: SLASH_COPY.seeTools, why: '', disabled: false });
    return out;
  }
  // tools by server, in the order the kernel lists them
  const servers = [...new Set(c.tools.map((t) => t.server))];
  for (const sv of servers)
    for (const t of c.tools.filter((x) => x.server === sv))
      add({ key: `tool:${t.id}`, group: 'tools', groupLabel: sv, kind: 'tool', name: t.name, note: t.run.runnable ? costWord(t.class) : whyWords(t.run), why: t.description || CLASS_WORD[t.class], disabled: !t.run.runnable, tool: t });
  return out;
}

/** The typeahead: rows whose name, group or why hold the query; within a group, name prefixes first. Groups keep their order. */
export function filterSlash(items: readonly SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase().replace(/^\//, '');
  if (!q) return [...items];
  const rank = (it: SlashItem): number => {
    const n = it.name.toLowerCase().replace(/^\//, '');
    if (n.startsWith(q)) return 0;
    if (n.includes(q)) return 1;
    if (it.groupLabel.toLowerCase().includes(q) || it.why.toLowerCase().includes(q)) return 2;
    return -1;
  };
  const kept = items.map((it, i) => ({ it, i, r: rank(it) })).filter((x) => x.r >= 0);
  const groupAt = new Map<string, number>();
  for (const x of kept) if (!groupAt.has(`${x.it.group}\u0000${x.it.groupLabel}`)) groupAt.set(`${x.it.group}\u0000${x.it.groupLabel}`, x.i);
  return kept.sort((a, b) => groupAt.get(`${a.it.group}\u0000${a.it.groupLabel}`)! - groupAt.get(`${b.it.group}\u0000${b.it.groupLabel}`)! || a.r - b.r || a.i - b.i).map((x) => x.it);
}

/** The menu's query from the composer text: "/" then a word with no space and no newline; anything else: null. */
export function slashQueryOf(text: string): string | null {
  const m = /^\/([^\s/]{0,64})$/.exec(text);
  return m ? m[1]! : null;
}

/** Enter on a row: a tool with no arguments that runs now may run at once; every other row opens its args panel. */
export function runsOnEnter(it: SlashItem): boolean {
  return it.kind === 'tool' && !it.disabled && !!it.tool && it.tool.class === 'read' && it.tool.params.length === 0;
}

/* ── the args panel ──────────────────────────────────────────────────────────────────────────────────────────────── */

export type FieldKind = 'text' | 'number' | 'bool' | 'enum' | 'json';
export interface ArgField {
  name: string;
  /** the field's label (a tool's argument name; a skill's one line is Arguments) */
  label: string;
  required: boolean;
  kind: FieldKind;
  /** a seg's choices (enum, bool); the value of a seg field is the choice's index as a string */
  options: Array<{ label: string; value: string | number | boolean | null }>;
  integer: boolean;
  description: string;
  placeholder: string;
}

const typeKind = (p: CapParam): FieldKind => {
  if (p.enum) return 'enum';
  if (p.type === 'boolean') return 'bool';
  if (p.type === 'string') return 'text';
  if (p.type === 'number' || p.type === 'integer') return 'number';
  return 'json';
};

/** A tool's fields (one per argument), or a skill's one line. */
export function argFieldsOf(it: Pick<SlashItem, 'kind' | 'tool' | 'skill'>): ArgField[] {
  if (it.kind === 'skill') return [{ name: 'args', label: SLASH_COPY.args, required: false, kind: 'text', options: [], integer: false, description: '', placeholder: it.skill?.argumentHint || SLASH_COPY.argsHint }];
  return (it.tool?.params ?? []).map((p) => {
    const kind = typeKind(p);
    const options = kind === 'enum' ? p.enum!.map((v) => ({ label: v === null ? 'null' : String(v), value: v })) : kind === 'bool' ? [{ label: 'true', value: true }, { label: 'false', value: false }] : [];
    // Mika C6'b2-1 #4: no type word as a placeholder (text: none; a number says what it takes; JSON keeps its brackets)
    const placeholder = kind === 'json' ? (p.type === 'array' ? '[ … ]' : '{ … }') : kind === 'number' ? (p.type === 'integer' ? SLASH_COPY.notWhole : SLASH_COPY.notNumber) : '';
    return { name: p.name, label: p.name, required: p.required, kind, options, integer: p.type === 'integer', description: p.description, placeholder };
  });
}

/** The fields' values as the run's args, or each field's problem in words. An empty optional field is left out. */
export function argsOf(fields: readonly ArgField[], values: Readonly<Record<string, string>>): { args: Record<string, unknown> } | { errors: Record<string, string> } {
  const args: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const raw = values[f.name] ?? '';
    if (raw.trim() === '') {
      if (f.required) errors[f.name] = SLASH_COPY.neededErr;
      continue;
    }
    switch (f.kind) {
      case 'text':
        args[f.name] = raw;
        break;
      case 'number': {
        const n = Number(raw.trim());
        if (!Number.isFinite(n)) errors[f.name] = SLASH_COPY.notNumber;
        else if (f.integer && !Number.isInteger(n)) errors[f.name] = SLASH_COPY.notWhole;
        else args[f.name] = n;
        break;
      }
      case 'bool':
      case 'enum': {
        const o = f.options[Number(raw)];
        if (!o) errors[f.name] = SLASH_COPY.neededErr;
        else args[f.name] = o.value;
        break;
      }
      default:
        try {
          args[f.name] = JSON.parse(raw) as unknown;
        } catch {
          errors[f.name] = SLASH_COPY.notJson;
        }
    }
  }
  return Object.keys(errors).length ? { errors } : { args };
}

/* ── skills: arguments and refusals ──────────────────────────────────────────────────────────────────────────────── */

export const SKILL_COPY = Object.freeze({
  badArgs: 'arguments must be one line, under 4 KB, with no !`',
  notListed: 'this skill isn’t in this session any more',
  overBudget: (tokens: number | null, limit: number | null): string => `this skill is ${tokens === null ? '?' : tokens.toLocaleString('en-US')} tokens; this model takes at most ${limit === null ? '?' : limit.toLocaleString('en-US')} from one skill`,
  ran: (name: string, args: string): string => `you ran skill /${name}${args ? ` ${args}` : ''}`,
});

/** The page's own check of a skill's arguments before it sends (the kernel checks again): null when they may go. */
export function skillArgsProblem(args: string): string | null {
  if (/[\r\n]/.test(args) || args.includes('!`') || new TextEncoder().encode(args).length > SKILL_ARGS_MAX_BYTES) return SKILL_COPY.badArgs;
  return null;
}

/** A refused skill run (request.session.skill.run status refused) in words, never its code. */
export function skillRefusalWords(v: { why?: unknown; tokens?: unknown; limit?: unknown } | null): string {
  const nat = (x: unknown): number | null => (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : null);
  switch (v?.why) {
    case 'over-budget':
      return SKILL_COPY.overBudget(nat(v.tokens), nat(v.limit));
    case 'bad-args':
      return SKILL_COPY.badArgs;
    case 'not-listed':
      return SKILL_COPY.notListed;
    default:
      return 'Gnomon didn’t run this skill · next: open / again';
  }
}

/** A failed tools.start (a refusal's reason and data) in the drawer's words (fitWords): never the code. */
export function startFailWords(r: { reason: string | null; data: Record<string, unknown> | null } | null): string {
  if (r === null) return 'Not started: the connection dropped · next: try again once Gnomon is connected';
  const w = fitWords(typeof r.data?.fit === 'string' ? r.data.fit : null);
  return `Not started: ${w.text} · next: ${w.next}`;
}

/* ── requests ────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type SlashRequest = { kind: string; payload: Record<string, unknown> };
export const toolsStartRequest = (hsid: string): SlashRequest => ({ kind: TOOLS_START_REQUEST, payload: { hsid } });
/** A run: `full` for a human-only tool (its full schema), `narrow` otherwise. */
export const toolsRunRequest = (hsid: string, t: Pick<CapTool, 'id' | 'humanOnly'>, args: Record<string, unknown>): SlashRequest => ({ kind: TOOLS_RUN_REQUEST, payload: { hsid, id: t.id, args, form: t.humanOnly ? 'full' : 'narrow' } });
export const toolsResultRequest = (hsid: string, runId: string): SlashRequest => ({ kind: TOOLS_RESULT_REQUEST, payload: { hsid, runId } });
export const skillsListRequest = (hsid: string): SlashRequest => ({ kind: SKILLS_LIST_REQUEST, payload: { hsid } });
export const skillRunRequest = (hsid: string, name: string, args: string): SlashRequest => ({ kind: SKILL_RUN_REQUEST, payload: { hsid, name, args } });
