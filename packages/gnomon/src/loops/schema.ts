/**
 * @symbol #loop-schema
 *
 * #loop-schema (docs/specs/gnomon-loops.md §2, §3.1, §3.4, §3.5; build plan step LP1) — the `loop:v2`
 * definition: TypeScript types, a validator that returns precise errors with paths, and the canonical
 * compile to JSON the kernel reads (`.paradigm/loops/<id>.loop.json`; the kernel never parses YAML).
 *
 * ZERO runtime dependencies, like the kernel (G-SEC-01): the input is an already-parsed value. The CLI and
 * the MCP family parse YAML with their own dependency, then call validateLoop / compileLoop.
 *
 * Rules (each refusal is a LoopIssue {path, code, message}):
 *   - closed shape: an unknown key anywhere is refused (UNKNOWN_KEY);
 *   - ids (the loop and every node, choices and judge classes) are kebab-case, ≤ 64 characters;
 *   - every edge target is a node id or a terminal (@goal, @stop, @pause); a missing edge compiles to @stop
 *     (a model's `unavailable` and a card's `timeout` compile to @pause);
 *   - LL2: `goal.node` names a check node, and a `run` goal check declares `goal.inputs`; only a check or a
 *     call node may take an edge to @goal (a model verdict alone never reaches the goal);
 *   - §3.1 argv: literal (no `{{`), argv0 is not a runner, shell or interpreter (the kernel's
 *     INTERPRETER_DENYLIST plus python*), and never a `.cmd` or `.bat`;
 *   - §3.4: judge and summarize nodes have no tools;
 *   - §3.5: `continuous` needs cooldown ≥ 60 s (MIN_AUTOMATION_PERIOD_MS), a goal or budgets.run.rounds, and
 *     budgets.day.runs or budgets.day.computeSec; an absent budget field compiles to the global default,
 *     never unbounded;
 *   - `call` is `id@hash8`; with the set of known loops the validator refuses call cycles and depth > 3;
 *   - 8.0 subset (founder scope 2026-10-22): `model.use: claude|any`, any `escalate` other than `never`,
 *     the `claude` opt-in block, `cron` triggers, `sentinel.incident.opened` events, `bash` tools and the
 *     envelope fields are refused with code LANDS_IN_8_1 ("lands in 8.1").
 *
 * Aegis LP1 review: an @goal edge comes only from goal.node or a call node, and any @goal edge needs a goal
 * block; a call pin must equal the callee's content hash (loopContentHash: sha256 of canonicalJson(parsed) —
 * the kernel hashes the PARSED definition, never the YAML or JSON file bytes) and a call that can reach @goal
 * needs a callee with a goal; argv0 is never a build tool or package manager (BUILD_TOOLS) except the direct
 * checkers in LOOP_ARGV0_CHECKER_ALLOW; land paths never touch node_modules; non-finite numbers are refused.
 * The compiled `protected` list is the union over the whole call chain of goal.inputs, the repo-relative argv
 * words of run checks and node_modules (the config closure joins it in LP2); the kernel denies act edits there.
 *
 * Compiled form: the normalized definition with every default filled, durations as integer SECONDS and token
 * counts as integers, edges expanded to every verdict of the node, and `flowPaths` when a flow index is given
 * (else the flows stay symbolic and a FLOWS_UNRESOLVED warning is returned). canonicalLoopJson is the stable
 * hashing form (sorted keys, no whitespace); loopFileJson is the same order, indented, for the file.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from '@a-company/gnomon-contracts';
import { BUILD_TOOLS, INTERPRETER_DENYLIST } from '../kernel/supervisor/prefix-policy.js';
import { MIN_AUTOMATION_PERIOD_MS } from '../kernel/scheduler/automation.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const LOOP_SCHEMA = 'loop:v2' as const;
export const LOOP_COMPILED_VERSION = 1 as const;
export const LOOP_TERMINALS = ['@goal', '@stop', '@pause'] as const;
export type LoopTerminal = (typeof LOOP_TERMINALS)[number];
export const LOOP_ID_MAX = 64;
export const LOOP_CALL_DEPTH_MAX = 3;
export const LOOP_CONTINUOUS_MIN_COOLDOWN_SEC = MIN_AUTOMATION_PERIOD_MS / 1000;
export const LANDS_IN_8_1 = 'LANDS_IN_8_1' as const;
/**
 * BUILD_TOOLS entries a `run` argv0 may still name: direct type checkers and test runners whose config is part
 * of the config closure (LP2). Every other build tool or package manager (npm, npm exec, make, cargo run …)
 * runs repo-controlled scripts and is refused as argv0.
 */
export const LOOP_ARGV0_CHECKER_ALLOW: ReadonlySet<string> = new Set(['tsc', 'vitest', 'jest']);
/** Always in a compiled loop's protected set: act nodes never edit installed dependencies. */
export const LOOP_ALWAYS_PROTECTED = ['node_modules/**', '**/node_modules/**'] as const;

export const LOOP_BUILTINS = [
  'paradigm.flow-check', 'paradigm.flow-affected', 'paradigm.ripple', 'paradigm.purpose-validate',
  'paradigm.drift', 'paradigm.reindex', 'git.clean',
] as const;
export type LoopBuiltin = (typeof LOOP_BUILTINS)[number];

export const LOOP_AUTONOMY = ['act', 'propose', 'observe'] as const;
export const LOOP_DECIDE = ['none', 'before-land', 'on-stop'] as const;
export const LOOP_NOTIFY_ON = ['goal', 'stop', 'fail', 'landed'] as const;
export const LOOP_NOTIFY_AS = ['toast', 'quiet'] as const;
export const LOOP_EVENT_KINDS = ['file.changed', 'commit.landed', 'session.ended', 'card.decided'] as const;
export const LOOP_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const LOOP_PARSERS = ['tap', 'junit', 'tsc'] as const;
export const LOOP_JSON_OPS = ['==', '!=', '<', '<=', '>', '>='] as const;
export const LOOP_MODEL_ROLES = ['judge', 'summarize', 'act'] as const;
export const LOOP_PARADIGM_TOOLS = ['ripple', 'flow.check', 'flow.affected', 'purpose.validate', 'drift'] as const;
/** Input-reference roots that are not node ids (§2 `inputs`, `attach`). */
export const LOOP_INPUT_ROOTS = ['trigger', 'last', 'day', 'loop', 'failed', 'run'] as const;

/** Verdicts per node type (the edge keys a node may name, besides `any`). */
export const CHECK_VERDICTS = ['pass', 'fail', 'error'] as const;
export const MODEL_VERDICTS = ['pass', 'fail', 'unsure', 'unavailable', 'error'] as const;
export const CALL_VERDICTS = ['pass', 'fail', 'unsure', 'error'] as const;
export const TOAST_VERDICTS = ['pass'] as const;

/**
 * Global budget defaults, used for any field a definition leaves out (LL3: never unbounded). The live values
 * come from root-signed `~/.gnomon/config.yaml` `loops:` once LP3 reads it; compileLoop takes them as an option.
 * Escalations default to 0: loops are local only in 8.0 (D4).
 */
export interface LoopBudgets {
  run: { rounds: number; wallMin: number; tokens: number; computeSec: number };
  day: { runs: number; tokens: number; computeSec: number };
  escalations: { perRun: number; perDay: number };
}
export const LOOP_BUDGET_DEFAULTS: Readonly<LoopBudgets> = Object.freeze({
  run: Object.freeze({ rounds: 8, wallMin: 60, tokens: 400_000, computeSec: 1800 }),
  day: Object.freeze({ runs: 24, tokens: 2_000_000, computeSec: 7200 }),
  escalations: Object.freeze({ perRun: 0, perDay: 0 }),
}) as Readonly<LoopBudgets>;

export const LOOP_DEFAULTS = Object.freeze({
  autonomy: 'act',
  decide: 'none',
  notify: Object.freeze({ on: Object.freeze(['fail']), as: 'toast' }),
  catchUp: 'skip',
  debounceSec: 0,
  effect: 'read',
  timeoutSec: 600,
  landMaxWaitMin: 120,
  modelLimits: Object.freeze({ turns: 20, tokens: 80_000 }),
  minConfidence: 0.7,
});

// ── Types: the authored definition (after YAML parse) ────────────────────────

export type Duration = number | string;
export type Count = number | string;
export type EdgeMap = Record<string, string>;

export type LoopSchedule =
  | { every: Duration }
  | { daily: string }
  | { weekly: { day: (typeof LOOP_WEEKDAYS)[number]; at: string } };

export type LoopTrigger =
  | { schedule: LoopSchedule; catchUp?: 'skip' | 'once' }
  | {
      event:
        | { kind: 'file.changed'; flow: string }
        | { kind: 'commit.landed' }
        | { kind: 'session.ended' }
        | { kind: 'card.decided'; loop: string; node: string };
      debounce?: Duration;
    }
  | { continuous: { cooldown: Duration } };

export type CheckPass =
  | { exit: number }
  | { parse: (typeof LOOP_PARSERS)[number]; failed: number }
  | { json: string; op: (typeof LOOP_JSON_OPS)[number]; value: string | number | boolean | null };

export interface NodeExit { maxVisits?: number; maxFailStreak?: number }

export interface CheckNode {
  id: string;
  type: 'check';
  run?: string[];
  builtin?: LoopBuiltin;
  args?: Record<string, unknown>;
  effect?: 'read' | 'write';
  pass?: CheckPass;
  timeoutSec?: number;
  exit?: NodeExit;
  on?: EdgeMap;
}

export type ModelTool = 'read' | 'edit' | { paradigm: string[] };
export interface ModelNode {
  id: string;
  type: 'model';
  role: (typeof LOOP_MODEL_ROLES)[number];
  model?: { use?: 'local'; profile?: string; escalate?: 'never'; minConfidence?: number };
  prompt?: string;
  inputs?: string[];
  tools?: 'none' | ModelTool[];
  verdict?: { classes: string[] };
  limits?: { turns?: number; tokens?: Count };
  exit?: NodeExit;
  on?: EdgeMap;
}

export interface NotifyNode {
  id: string;
  type: 'notify';
  as: 'toast' | 'card';
  text?: string;
  attach?: string[];
  choices?: string[];
  exit?: NodeExit;
  on?: EdgeMap;
}

export interface CallNode {
  id: string;
  type: 'call';
  loop: string;
  exit?: NodeExit;
  on?: EdgeMap;
}

export type LoopNode = CheckNode | ModelNode | NotifyNode | CallNode;

export interface LoopDefinition {
  schema: typeof LOOP_SCHEMA;
  id: string;
  title?: string;
  repo?: string;
  flows?: string[];
  triggers?: LoopTrigger[];
  autonomy?: (typeof LOOP_AUTONOMY)[number];
  notify?: { on?: (typeof LOOP_NOTIFY_ON)[number][]; as?: (typeof LOOP_NOTIFY_AS)[number] };
  decide?: (typeof LOOP_DECIDE)[number];
  budgets?: {
    run?: { rounds?: number; wallMin?: number; tokens?: Count; computeSec?: number };
    day?: { runs?: number; tokens?: Count; computeSec?: number };
    escalations?: { perRun?: number; perDay?: number };
  };
  goal?: { node: string; verdict?: 'pass'; inputs?: string[] };
  land?: { paths: string[]; message: string; maxWaitMin?: number };
  start: string;
  nodes: LoopNode[];
}

// ── Types: the compiled form (what the kernel reads) ─────────────────────────

export type CompiledTrigger =
  | { type: 'schedule'; every?: number; daily?: string; weekly?: { day: string; at: string }; catchUp: 'skip' | 'once' }
  | { type: 'event'; kind: string; flow?: string; paths?: string[]; loop?: string; node?: string; debounceSec: number }
  | { type: 'continuous'; cooldownSec: number };

export type CompiledNode =
  | { id: string; type: 'check'; run?: string[]; argv0Interpreter?: string; builtin?: string; args?: Record<string, unknown>; effect: 'read' | 'write'; pass: CheckPass; timeoutSec: number; exit?: NodeExit; on: Record<string, string> }
  | { id: string; type: 'model'; role: string; model: { use: 'local'; profile?: string; escalate: 'never'; minConfidence: number }; prompt?: string; inputs: string[]; tools: ModelTool[]; verdict?: { classes: string[] }; limits: { turns: number; tokens: number }; exit?: NodeExit; on: Record<string, string> }
  | { id: string; type: 'notify'; as: 'toast' | 'card'; text?: string; attach: string[]; choices?: string[]; exit?: NodeExit; on: Record<string, string> }
  | { id: string; type: 'call'; loop: string; callee: string; hash8: string; exit?: NodeExit; on: Record<string, string> };

export interface CompiledLoop {
  schema: typeof LOOP_SCHEMA;
  /**
   * `sourceHash` (LP2): loopContentHash of the PARSED source definition (the YAML), the hash a caller's `id@hash8`
   * pin names. The kernel never sees the YAML, so it resolves a pin against the TRUSTED callee's sourceHash.
   */
  compiled: { version: typeof LOOP_COMPILED_VERSION; flowsResolved: boolean; callsResolved: boolean; sourceHash?: string };
  id: string;
  title?: string;
  scope: 'repo' | 'personal';
  repo?: string;
  flows: string[];
  flowPaths?: Record<string, string[]>;
  triggers: CompiledTrigger[];
  autonomy: string;
  notify: { on: string[]; as: string };
  decide: string;
  budgets: LoopBudgets;
  goal?: { node: string; verdict: 'pass'; inputs: string[] };
  land?: { paths: string[]; message: string; maxWaitMin: number };
  start: string;
  nodes: CompiledNode[];
  /**
   * Paths act nodes may not edit (the kernel enforces): node_modules, plus goal.inputs and the repo-relative
   * argv words of run checks across this loop and every loop it calls (transitively, when known).
   */
  protected: string[];
}

// ── Issues and options ───────────────────────────────────────────────────────

export interface LoopIssue {
  /** JSON-ish path into the definition: `nodes[2].run[0]`, `triggers[0].schedule.cron`, or `` for the root. */
  path: string;
  code: string;
  message: string;
}

export interface LoopValidateOptions {
  /** repo loops live in `.paradigm/loops/` and never name `repo`; personal loops (`~/.gnomon/loops`) must. Default repo. */
  scope?: 'repo' | 'personal';
  /**
   * Other loops in the same scope, by id (parsed definitions; only their `call` nodes are read). Given, the
   * validator refuses unknown callees, call cycles and call depth > 3. Absent, only a self-call is detected.
   */
  knownLoops?: ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>;
  /** Flow id → path globs (from the flow index). Given, flows resolve; an unknown flow is refused. */
  flowIndex?: Readonly<Record<string, readonly string[]>>;
}

export interface LoopCompileOptions extends LoopValidateOptions {
  /** Global budget defaults (the `loops:` block of ~/.gnomon/config.yaml); default LOOP_BUDGET_DEFAULTS. */
  budgetDefaults?: LoopBudgets;
  /**
   * The shebang line (without `#!`) of a run argv0 that is a script, or null. Given, compiled check nodes carry
   * `argv0Interpreter` so the trust card can show it (hashing the interpreter is LP2).
   */
  readShebang?: (argv0: string) => string | null;
}

export interface LoopValidation {
  ok: boolean;
  errors: LoopIssue[];
  warnings: LoopIssue[];
  /** The definition, typed, when ok. */
  loop?: LoopDefinition;
}

export interface LoopCompilation extends LoopValidation {
  compiled?: CompiledLoop;
}

// ── Small helpers ────────────────────────────────────────────────────────────

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const FLOW_ID = /^\$[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const CALL_REF = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)@([0-9a-f]{8})$/;
const INPUT_REF = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.([A-Za-z][A-Za-z0-9-]*)$/;
const DURATION = /^(\d+)\s*(s|m|h|d)?$/;
const COUNT = /^(\d+(?:\.\d+)?)\s*([kKmM])?$/;
const DURATION_UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
const TEN_YEARS_SEC = 10 * 366 * 86400;
const ANY = 'any';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: Obj, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
const join = (base: string, key: string | number): string =>
  typeof key === 'number' ? `${base}[${key}]` : base ? `${base}.${key}` : key;

/** Parse a duration (`30m`, `90s`, `2h`, `1d`, or integer seconds) to integer seconds; null when malformed. */
export function parseDurationSec(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
  if (typeof v !== 'string') return null;
  const m = DURATION.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * DURATION_UNIT[m[2] ?? 's']!;
}

/** Parse a count (`400k`, `2M`, or an integer) to a positive integer; null when malformed. */
export function parseCount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null;
  if (typeof v !== 'string') return null;
  const m = COUNT.exec(v.trim());
  if (!m) return null;
  const mult = m[2] === undefined ? 1 : m[2].toLowerCase() === 'k' ? 1_000 : 1_000_000;
  const n = Math.round(Number(m[1]) * mult);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** argv0's basename, lower-cased, without trailing dots or spaces (Windows drops them). */
function baseName(argv0: string): string {
  const base = argv0.split(/[\\/]/).pop() ?? argv0;
  return base.toLowerCase().replace(/[. ]+$/, '');
}

/** The program argv0 names: its basename without trailing dots, spaces, `.exe` or `.com` (the denylists name programs). */
export function programName(argv0: string): string {
  let name = baseName(argv0);
  for (let prev = ''; prev !== name; ) {
    prev = name;
    name = name.replace(/\.(exe|com)$/, '').replace(/[. ]+$/, '');
  }
  return name;
}

/** The §3.1 issues of a `run` argv (empty when it passes); paths are rooted at `path`. */
export function argvIssues(argv: unknown, path: string): LoopIssue[] {
  const out: LoopIssue[] = [];
  if (!Array.isArray(argv) || argv.length === 0) {
    out.push({ path, code: 'ARGV_EMPTY', message: 'run must be a non-empty list of literal argv words' });
    return out;
  }
  argv.forEach((w, i) => {
    const p = join(path, i);
    if (typeof w !== 'string' || w.length === 0 || w.length > 4096 || w.includes('\0')) {
      out.push({ path: p, code: 'BAD_TYPE', message: 'each argv word is a non-empty string (≤ 4096 characters, no NUL)' });
    } else if (w.includes('{{')) {
      out.push({ path: p, code: 'ARGV_TEMPLATED', message: 'argv is literal: templates ({{…}}) are never expanded in run' });
    }
  });
  const a0 = argv[0];
  if (typeof a0 === 'string' && a0.length > 0) {
    const name = programName(a0);
    if (/\.(cmd|bat)$/.test(baseName(a0))) {
      out.push({ path: join(path, 0), code: 'ARGV0_BATCH', message: `${a0}: a .cmd or .bat runs through cmd.exe; name the binary directly` });
    } else if (name === '' || INTERPRETER_DENYLIST.has(name) || INTERPRETER_DENYLIST.has((a0.split(/[\\/]/).pop() ?? a0).toLowerCase()) || /^python/.test(name)) {
      out.push({ path: join(path, 0), code: 'ARGV0_INTERPRETER', message: `${a0}: argv0 must be a direct binary, not a runner, shell or interpreter` });
    } else if (BUILD_TOOLS.has(name) && !LOOP_ARGV0_CHECKER_ALLOW.has(name)) {
      out.push({ path: join(path, 0), code: 'ARGV0_BUILD_TOOL', message: `${a0}: a build tool or package manager runs repo-controlled scripts; name the checker binary directly` });
    }
  }
  return out;
}

/** The call targets (`id@hash8`) of an untyped definition, as callee ids. */
function callTargets(def: unknown): string[] {
  if (!isObj(def) || !Array.isArray(def.nodes)) return [];
  const out: string[] = [];
  for (const n of def.nodes) {
    if (isObj(n) && n.type === 'call' && typeof n.loop === 'string') {
      const m = CALL_REF.exec(n.loop);
      if (m) out.push(m[1]!);
    }
  }
  return out;
}

// ── The validator ────────────────────────────────────────────────────────────

class Checker {
  readonly errors: LoopIssue[] = [];
  readonly warnings: LoopIssue[] = [];

  err(path: string, code: string, message: string): void {
    this.errors.push({ path, code, message });
  }
  warn(path: string, code: string, message: string): void {
    this.warnings.push({ path, code, message });
  }
  later(path: string, what: string): void {
    this.err(path, LANDS_IN_8_1, `${what} lands in 8.1`);
  }

  /** Refuse keys outside `allowed` (closed shape); `deferred` keys get LANDS_IN_8_1 instead. */
  closed(o: Obj, path: string, allowed: readonly string[], deferred: Readonly<Record<string, string>> = {}): void {
    for (const k of Object.keys(o)) {
      if (allowed.includes(k)) continue;
      if (k in deferred) this.later(join(path, k), deferred[k]!);
      else this.err(join(path, k), 'UNKNOWN_KEY', `unknown key "${k}" (allowed: ${allowed.join(', ')})`);
    }
  }
  obj(v: unknown, path: string, what: string): v is Obj {
    if (isObj(v)) return true;
    this.err(path, 'BAD_TYPE', `${what} must be a mapping`);
    return false;
  }
  str(v: unknown, path: string, what: string, max = 4096): v is string {
    if (typeof v === 'string' && v.length > 0 && v.length <= max) return true;
    this.err(path, 'BAD_TYPE', `${what} must be a non-empty string (≤ ${max} characters)`);
    return false;
  }
  kebab(v: unknown, path: string, what: string): v is string {
    if (typeof v === 'string' && v.length <= LOOP_ID_MAX && KEBAB.test(v)) return true;
    this.err(path, 'BAD_ID', `${what} must be kebab-case, ≤ ${LOOP_ID_MAX} characters`);
    return false;
  }
  oneOf<T extends string>(v: unknown, path: string, what: string, allowed: readonly T[]): v is T {
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return true;
    this.err(path, 'BAD_ENUM', `${what} must be one of: ${allowed.join(', ')}`);
    return false;
  }
  posInt(v: unknown, path: string, what: string): v is number {
    if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return true;
    this.err(path, 'BAD_NUMBER', `${what} must be a positive integer`);
    return false;
  }
  strList(v: unknown, path: string, what: string, opts: { nonEmpty?: boolean } = {}): v is string[] {
    if (!Array.isArray(v) || (opts.nonEmpty && v.length === 0)) {
      this.err(path, 'BAD_TYPE', `${what} must be a ${opts.nonEmpty ? 'non-empty ' : ''}list of strings`);
      return false;
    }
    let ok = true;
    v.forEach((s, i) => { if (!this.str(s, join(path, i), `${what} entry`)) ok = false; });
    return ok;
  }
  glob(v: unknown, path: string): void {
    if (!this.str(v, path, 'a path glob', 512)) return;
    if (v.startsWith('/') || /^[A-Za-z]:[\\/]/.test(v) || v.startsWith('~') || v.includes('\\') || v.split('/').includes('..')) {
      this.err(path, 'BAD_GLOB', 'a path glob is repo-relative (no absolute path, ~, \\ or .. segment)');
    }
  }
  duration(v: unknown, path: string, what: string): number | null {
    const sec = parseDurationSec(v);
    if (sec === null || sec > TEN_YEARS_SEC) {
      this.err(path, 'BAD_DURATION', `${what} must be a duration like 90s, 30m, 2h, 1d or integer seconds`);
      return null;
    }
    return sec;
  }
  count(v: unknown, path: string, what: string): number | null {
    const n = parseCount(v);
    if (n === null) this.err(path, 'BAD_BUDGET', `${what} must be a positive count like 80000, 400k or 2M`);
    return n;
  }
  literalArgs(v: unknown, path: string): void {
    if (typeof v === 'string') {
      if (v.includes('{{')) this.err(path, 'ARGV_TEMPLATED', 'builtin args are literal: templates ({{…}}) are never expanded');
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => this.literalArgs(x, join(path, i)));
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) this.literalArgs(x, join(path, k));
    } else if (!(v === null || typeof v === 'number' || typeof v === 'boolean')) {
      this.err(path, 'BAD_TYPE', 'builtin args hold JSON values only');
    }
  }
}

interface Graph {
  nodeTypes: Map<string, string>;
  nodeIndex: Map<string, number>;
  nodeHasRun: Set<string>;
  callees: Array<{ path: string; callee: string; hash8: string; from: string }>;
}

/** sha256 hex of canonicalJson(parsed definition): the content hash a call pin (`id@hash8`) names. */
export function loopContentHash(parsed: unknown): string {
  return createHash('sha256').update(canonicalJson(parsed)).digest('hex');
}

/** Repo-relative path words of an argv (`--opt=value` values too); absolute, `~`, `\\` and `..` words are not repo paths. */
export function argvPathWords(argv: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const w of argv) {
    if (typeof w !== 'string') continue;
    const v = w.startsWith('-') ? (w.includes('=') ? w.slice(w.indexOf('=') + 1) : '') : w;
    if (!v || v.startsWith('-') || v.startsWith('/') || v.startsWith('~') || v.includes('\\') || /^[A-Za-z]:/.test(v)) continue;
    if (v.split('/').includes('..')) continue;
    if (v.includes('/') || /\.[A-Za-z0-9]+$/.test(v)) out.push(v.replace(/^(\.\/)+/, ''));
  }
  return out;
}

/** One loop's own protected paths: goal.inputs plus the path words of its run checks (untyped input). */
function ownProtected(def: unknown): string[] {
  if (!isObj(def)) return [];
  const out: string[] = [];
  if (isObj(def.goal) && Array.isArray(def.goal.inputs)) for (const x of def.goal.inputs) if (typeof x === 'string') out.push(x);
  if (Array.isArray(def.nodes)) for (const n of def.nodes) if (isObj(n) && n.type === 'check' && Array.isArray(n.run)) out.push(...argvPathWords(n.run));
  return out;
}

const knownMap = (k: LoopValidateOptions['knownLoops']): Map<string, unknown> | undefined =>
  k ? (k instanceof Map ? new Map(k) : new Map(Object.entries(k))) : undefined;

/** Recursively refuse NaN and ±Infinity (YAML `.nan`, `.inf`). */
function nonFinite(c: Checker, v: unknown, path: string, depth = 0): void {
  if (depth > 64) return;
  if (typeof v === 'number' && !Number.isFinite(v)) c.err(path, 'NON_FINITE', 'numbers are finite (no .nan or .inf)');
  else if (Array.isArray(v)) v.forEach((x, i) => nonFinite(c, x, join(path, i), depth + 1));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) nonFinite(c, x, join(path, k), depth + 1);
}

function validateInto(c: Checker, input: unknown, opts: LoopValidateOptions): void {
  if (!c.obj(input, '', 'a loop definition')) return;
  const d = input;
  nonFinite(c, d, '');
  const scope = opts.scope ?? 'repo';
  c.closed(d, '', ['schema', 'id', 'title', 'repo', 'flows', 'triggers', 'autonomy', 'notify', 'decide', 'budgets', 'goal', 'land', 'start', 'nodes'], {
    claude: 'the Claude subscription opt-in (claude:)',
    envelope: 'the loop envelope',
    envelopeId: 'the loop envelope',
  });

  if (d.schema !== LOOP_SCHEMA) c.err('schema', 'BAD_SCHEMA', `schema must be "${LOOP_SCHEMA}"`);
  if (!has(d, 'id')) c.err('id', 'REQUIRED', 'id is required');
  else c.kebab(d.id, 'id', 'id');
  if (has(d, 'title')) c.str(d.title, 'title', 'title', 200);

  if (scope === 'repo' && has(d, 'repo')) c.err('repo', 'REPO_SCOPE', 'repo is for personal loops only; a repo loop runs in its own repo');
  if (scope === 'personal') {
    if (!has(d, 'repo')) c.err('repo', 'REQUIRED', 'a personal loop names its repo (an absolute path)');
    else if (c.str(d.repo, 'repo', 'repo') && !(d.repo.startsWith('/') || /^[A-Za-z]:[\\/]/.test(d.repo))) {
      c.err('repo', 'BAD_PATH', 'repo must be an absolute path');
    }
  }

  const flowRefs: Array<{ path: string; flow: string }> = [];
  if (has(d, 'flows') && c.strList(d.flows, 'flows', 'flows')) {
    d.flows.forEach((f, i) => {
      if (!FLOW_ID.test(f)) c.err(join('flows', i), 'BAD_ID', 'a flow is a $kebab-id');
      else flowRefs.push({ path: join('flows', i), flow: f });
    });
  }

  if (has(d, 'autonomy')) c.oneOf(d.autonomy, 'autonomy', 'autonomy', LOOP_AUTONOMY);
  if (has(d, 'decide')) c.oneOf(d.decide, 'decide', 'decide', LOOP_DECIDE);
  if (has(d, 'notify') && c.obj(d.notify, 'notify', 'notify')) {
    c.closed(d.notify, 'notify', ['on', 'as']);
    if (has(d.notify, 'on')) {
      if (!Array.isArray(d.notify.on)) c.err('notify.on', 'BAD_TYPE', 'notify.on must be a list');
      else d.notify.on.forEach((x, i) => c.oneOf(x, join('notify.on', i), 'notify.on entry', LOOP_NOTIFY_ON));
    }
    if (has(d.notify, 'as')) c.oneOf(d.notify.as, 'notify.as', 'notify.as', LOOP_NOTIFY_AS);
  }

  // budgets (§3.5)
  const budgets = has(d, 'budgets') && c.obj(d.budgets, 'budgets', 'budgets') ? d.budgets : undefined;
  if (budgets) {
    c.closed(budgets, 'budgets', ['run', 'day', 'escalations']);
    const block = (k: string, ints: string[], counts: string[]): void => {
      if (!has(budgets, k) || !c.obj(budgets[k], join('budgets', k), `budgets.${k}`)) return;
      const b = budgets[k] as Obj;
      c.closed(b, join('budgets', k), [...ints, ...counts]);
      for (const f of ints) if (has(b, f)) c.posInt(b[f], `budgets.${k}.${f}`, `budgets.${k}.${f}`);
      for (const f of counts) if (has(b, f)) c.count(b[f], `budgets.${k}.${f}`, `budgets.${k}.${f}`);
    };
    block('run', ['rounds', 'wallMin', 'computeSec'], ['tokens']);
    block('day', ['runs', 'computeSec'], ['tokens']);
    if (has(budgets, 'escalations') && c.obj(budgets.escalations, 'budgets.escalations', 'budgets.escalations')) {
      const e = budgets.escalations;
      c.closed(e, 'budgets.escalations', ['perRun', 'perDay']);
      for (const f of ['perRun', 'perDay']) {
        if (has(e, f) && !(typeof e[f] === 'number' && Number.isSafeInteger(e[f]) && (e[f] as number) >= 0)) {
          c.err(`budgets.escalations.${f}`, 'BAD_NUMBER', `budgets.escalations.${f} must be a non-negative integer`);
        }
      }
    }
  }
  const runB = budgets && isObj(budgets.run) ? budgets.run : undefined;
  const dayB = budgets && isObj(budgets.day) ? budgets.day : undefined;

  // nodes first (edges, goal and triggers refer to them)
  const g: Graph = { nodeTypes: new Map(), nodeIndex: new Map(), nodeHasRun: new Set(), callees: [] };
  const edges: Array<{ path: string; from: string; fromType: string; target: unknown }> = [];
  if (!has(d, 'nodes')) c.err('nodes', 'REQUIRED', 'nodes is required');
  else if (!Array.isArray(d.nodes) || d.nodes.length === 0) c.err('nodes', 'BAD_TYPE', 'nodes must be a non-empty list');
  else {
    d.nodes.forEach((n, i) => {
      if (isObj(n) && typeof n.id === 'string' && KEBAB.test(n.id)) {
        if (g.nodeTypes.has(n.id)) c.err(join(join('nodes', i), 'id'), 'DUPLICATE_ID', `node id "${n.id}" is used twice`);
        else {
          g.nodeTypes.set(n.id, typeof n.type === 'string' ? n.type : '?');
          g.nodeIndex.set(n.id, i);
        }
      }
    });
    d.nodes.forEach((n, i) => validateNode(c, n, join('nodes', i), g, edges));
  }

  // edges
  const goalEdges: typeof edges = [];
  for (const e of edges) {
    if (typeof e.target !== 'string') {
      c.err(e.path, 'BAD_TYPE', 'an edge target is a node id or a terminal (@goal, @stop, @pause)');
      continue;
    }
    if (e.target.startsWith('@')) {
      if (!(LOOP_TERMINALS as readonly string[]).includes(e.target)) c.err(e.path, 'UNKNOWN_TARGET', `${e.target} is not a terminal (@goal, @stop, @pause)`);
      else if (e.target === '@goal') goalEdges.push(e);
    } else if (!g.nodeTypes.has(e.target)) {
      c.err(e.path, 'UNKNOWN_TARGET', `edge target "${e.target}" is not a node id or a terminal`);
    }
  }

  // start
  if (!has(d, 'start')) c.err('start', 'REQUIRED', 'start is required');
  else if (typeof d.start !== 'string' || !g.nodeTypes.has(d.start)) c.err('start', 'UNKNOWN_TARGET', 'start must name a node');

  // goal (§3.4)
  const goal = has(d, 'goal') && c.obj(d.goal, 'goal', 'goal') ? d.goal : undefined;
  if (goal) {
    c.closed(goal, 'goal', ['node', 'verdict', 'inputs']);
    if (!has(goal, 'node')) c.err('goal.node', 'REQUIRED', 'goal.node is required');
    else if (typeof goal.node !== 'string' || !g.nodeTypes.has(goal.node)) c.err('goal.node', 'UNKNOWN_TARGET', 'goal.node must name a node');
    else if (g.nodeTypes.get(goal.node) !== 'check') c.err('goal.node', 'GOAL_NOT_CHECK', 'goal.node must name a check node: progress rests on something that cannot lie (LL2)');
    else if (g.nodeHasRun.has(goal.node) && !(Array.isArray(goal.inputs) && goal.inputs.length > 0)) {
      c.err('goal.inputs', 'GOAL_INPUTS_REQUIRED', 'a goal on a run check declares goal.inputs (the globs act nodes may not edit)');
    }
    if (has(goal, 'verdict')) c.oneOf(goal.verdict, 'goal.verdict', 'goal.verdict', ['pass'] as const);
    if (has(goal, 'inputs') && c.strList(goal.inputs, 'goal.inputs', 'goal.inputs', { nonEmpty: true })) {
      goal.inputs.forEach((x, i) => c.glob(x, join('goal.inputs', i)));
    }
  }

  // @goal edges (LL2, Aegis LP1 #1): only from goal.node or a call node, and only with a goal block
  if (goalEdges.length && !goal) c.err('goal', 'GOAL_REQUIRED', 'an edge reaches @goal, so the loop declares goal: { node: <check> }');
  for (const e of goalEdges) {
    if (e.fromType === 'call') continue;
    if (e.fromType !== 'check') c.err(e.path, 'GOAL_VIA_MODEL', 'only the goal check (or a call) may reach @goal: a model or notify verdict alone never meets a goal (LL2)');
    else if (goal && goal.node !== e.from) c.err(e.path, 'GOAL_EDGE_NOT_GOAL_NODE', `only goal.node may reach @goal (this is "${e.from}", the goal names "${String(goal.node)}")`);
  }

  // land
  if (has(d, 'land') && c.obj(d.land, 'land', 'land')) {
    const l = d.land;
    c.closed(l, 'land', ['paths', 'message', 'maxWaitMin']);
    if (!has(l, 'paths')) c.err('land.paths', 'REQUIRED', 'land.paths is required');
    else if (c.strList(l.paths, 'land.paths', 'land.paths', { nonEmpty: true })) {
      l.paths.forEach((x, i) => {
        c.glob(x, join('land.paths', i));
        if (x.split('/').includes('node_modules')) c.err(join('land.paths', i), 'PROTECTED_PATH', 'a loop never lands under node_modules');
      });
    }
    if (!has(l, 'message')) c.err('land.message', 'REQUIRED', 'land.message is required');
    else c.str(l.message, 'land.message', 'land.message', 2000);
    if (has(l, 'maxWaitMin')) c.posInt(l.maxWaitMin, 'land.maxWaitMin', 'land.maxWaitMin');
  }

  // triggers
  let continuous = false;
  if (has(d, 'triggers')) {
    if (!Array.isArray(d.triggers)) c.err('triggers', 'BAD_TYPE', 'triggers must be a list');
    else d.triggers.forEach((t, i) => {
      const p = join('triggers', i);
      const r = validateTrigger(c, t, p, flowRefs);
      if (r === 'continuous') continuous = true;
    });
  }
  if (continuous) {
    if (!goal && !(runB && has(runB, 'rounds'))) {
      c.err('triggers', 'CONTINUOUS_NEEDS_GOAL', 'a continuous loop needs a goal or budgets.run.rounds');
    }
    if (!(dayB && (has(dayB, 'runs') || has(dayB, 'computeSec')))) {
      c.err('budgets.day', 'CONTINUOUS_NEEDS_DAY_CAP', 'a continuous loop sets budgets.day.runs or budgets.day.computeSec');
    }
  }

  // flows
  if (flowRefs.length) {
    if (!opts.flowIndex) {
      c.warn('flows', 'FLOWS_UNRESOLVED', 'no flow index was given: flows stay symbolic until the next validate with an index');
    } else {
      for (const r of flowRefs) {
        const globs = opts.flowIndex[r.flow];
        if (!globs) c.err(r.path, 'UNKNOWN_FLOW', `${r.flow} is not in the flow index`);
        else if (globs.length === 0) c.warn(r.path, 'FLOW_NO_PATHS', `${r.flow} resolves to no paths`);
      }
    }
  }

  // calls: self-call, unknown callee, cycles, depth
  validateCalls(c, typeof d.id === 'string' ? d.id : '', g, opts, new Set(goalEdges.filter((e) => e.fromType === 'call').map((e) => e.from)));

  // reachability (warning)
  if (typeof d.start === 'string' && g.nodeTypes.has(d.start)) {
    const adj = new Map<string, string[]>();
    for (const e of edges) if (typeof e.target === 'string') adj.set(e.from, [...(adj.get(e.from) ?? []), e.target]);
    const seen = new Set<string>([d.start]);
    const todo = [d.start];
    while (todo.length) for (const t of adj.get(todo.pop()!) ?? []) if (g.nodeTypes.has(t) && !seen.has(t)) { seen.add(t); todo.push(t); }
    for (const [id, i] of g.nodeIndex) {
      if (!seen.has(id)) c.warn(join(join('nodes', i), 'id'), 'UNREACHABLE_NODE', `node "${id}" is never reached from start`);
    }
  }
}

function validateCalls(c: Checker, selfId: string, g: Graph, opts: LoopValidateOptions, callsToGoal: ReadonlySet<string>): void {
  const known = knownMap(opts.knownLoops);
  for (const { path, callee, hash8, from } of g.callees) {
    if (callee === selfId) {
      c.err(path, 'CALL_CYCLE', `a loop cannot call itself (${selfId} → ${selfId})`);
      continue;
    }
    if (!known) continue;
    if (!known.has(callee)) {
      c.err(path, 'UNKNOWN_CALLEE', `no loop "${callee}" in this scope`);
      continue;
    }
    const calleeDef = known.get(callee);
    let actual: string | null = null;
    try { actual = loopContentHash(calleeDef); } catch { actual = null; }
    if (actual === null) c.err(path, 'CALL_PIN_MISMATCH', `the callee "${callee}" cannot be hashed (not a JSON definition)`);
    else if (actual.slice(0, 8) !== hash8) c.err(path, 'CALL_PIN_MISMATCH', `the pin ${callee}@${hash8} is not the callee's content hash (${callee}@${actual.slice(0, 8)})`);
    if (callsToGoal.has(from) && !(isObj(calleeDef) && isObj(calleeDef.goal))) {
      c.err(path, 'CALL_GOAL_REQUIRED', `this call reaches @goal, so "${callee}" must declare a goal`);
    }
    // DFS from the callee; a chain [self, a, b] has depth 2 (call edges).
    const st: { cycle: string[] | null; deepest: string[] } = { cycle: null, deepest: [selfId, callee] };
    const walk = (id: string, chain: string[]): void => {
      if (st.cycle) return;
      if (chain.length > st.deepest.length) st.deepest = chain;
      if (chain.length - 1 > LOOP_CALL_DEPTH_MAX) return;
      for (const next of callTargets(known.get(id))) {
        if (chain.includes(next)) {
          st.cycle = [...chain, next];
          return;
        }
        if (known.has(next)) walk(next, [...chain, next]);
      }
    };
    walk(callee, [selfId, callee]);
    if (st.cycle) c.err(path, 'CALL_CYCLE', `call cycle: ${st.cycle.join(' → ')}`);
    else if (st.deepest.length - 1 > LOOP_CALL_DEPTH_MAX) {
      c.err(path, 'CALL_DEPTH', `call depth ${st.deepest.length - 1} exceeds ${LOOP_CALL_DEPTH_MAX}: ${st.deepest.join(' → ')}`);
    }
  }
}

function validateTrigger(
  c: Checker,
  t: unknown,
  p: string,
  flowRefs: Array<{ path: string; flow: string }>,
): 'schedule' | 'event' | 'continuous' | null {
  if (!c.obj(t, p, 'a trigger')) return null;
  const kinds = ['schedule', 'event', 'continuous'].filter((k) => has(t, k));
  if (kinds.length !== 1) {
    // still report unknown keys so a typo is named
    c.closed(t, p, ['schedule', 'catchUp', 'event', 'debounce', 'continuous']);
    c.err(p, 'BAD_TRIGGER', 'a trigger has exactly one of schedule, event or continuous');
    return null;
  }
  const kind = kinds[0] as 'schedule' | 'event' | 'continuous';
  if (kind === 'schedule') {
    c.closed(t, p, ['schedule', 'catchUp']);
    if (has(t, 'catchUp')) c.oneOf(t.catchUp, join(p, 'catchUp'), 'catchUp', ['skip', 'once'] as const);
    const sp = join(p, 'schedule');
    if (!c.obj(t.schedule, sp, 'schedule')) return kind;
    const s = t.schedule;
    if (has(s, 'cron')) {
      c.later(join(sp, 'cron'), 'the cron trigger');
      return kind;
    }
    const forms = ['every', 'daily', 'weekly'].filter((k) => has(s, k));
    c.closed(s, sp, ['every', 'daily', 'weekly']);
    if (forms.length !== 1) {
      c.err(sp, 'BAD_TRIGGER', 'a schedule has exactly one of every, daily or weekly');
      return kind;
    }
    if (forms[0] === 'every') {
      const sec = c.duration(s.every, join(sp, 'every'), 'schedule.every');
      if (sec !== null && sec < LOOP_CONTINUOUS_MIN_COOLDOWN_SEC) c.err(join(sp, 'every'), 'BAD_DURATION', `schedule.every is at least ${LOOP_CONTINUOUS_MIN_COOLDOWN_SEC}s`);
    } else if (forms[0] === 'daily') {
      if (typeof s.daily !== 'string' || !HHMM.test(s.daily)) c.err(join(sp, 'daily'), 'BAD_TIME', 'daily is a quoted "HH:MM" (24-hour)');
    } else if (c.obj(s.weekly, join(sp, 'weekly'), 'weekly')) {
      const w = s.weekly;
      c.closed(w, join(sp, 'weekly'), ['day', 'at']);
      c.oneOf(w.day, join(sp, 'weekly.day'), 'weekly.day', LOOP_WEEKDAYS);
      if (typeof w.at !== 'string' || !HHMM.test(w.at)) c.err(join(sp, 'weekly.at'), 'BAD_TIME', 'weekly.at is a quoted "HH:MM" (24-hour)');
    }
    return kind;
  }
  if (kind === 'event') {
    c.closed(t, p, ['event', 'debounce']);
    if (has(t, 'debounce')) c.duration(t.debounce, join(p, 'debounce'), 'debounce');
    const ep = join(p, 'event');
    if (!c.obj(t.event, ep, 'event')) return kind;
    const e = t.event;
    if (e.kind === 'sentinel.incident.opened') {
      c.later(join(ep, 'kind'), 'the sentinel.incident.opened trigger');
      return kind;
    }
    if (!c.oneOf(e.kind, join(ep, 'kind'), 'event.kind', LOOP_EVENT_KINDS)) return kind;
    if (e.kind === 'file.changed') {
      c.closed(e, ep, ['kind', 'flow']);
      if (!has(e, 'flow')) c.err(join(ep, 'flow'), 'REQUIRED', 'a file.changed trigger names its flow');
      else if (typeof e.flow !== 'string' || !FLOW_ID.test(e.flow)) c.err(join(ep, 'flow'), 'BAD_ID', 'a flow is a $kebab-id');
      else flowRefs.push({ path: join(ep, 'flow'), flow: e.flow });
    } else if (e.kind === 'card.decided') {
      c.closed(e, ep, ['kind', 'loop', 'node']);
      c.kebab(e.loop, join(ep, 'loop'), 'event.loop');
      c.kebab(e.node, join(ep, 'node'), 'event.node');
    } else {
      c.closed(e, ep, ['kind']);
    }
    return kind;
  }
  c.closed(t, p, ['continuous']);
  const cp = join(p, 'continuous');
  if (!c.obj(t.continuous, cp, 'continuous')) return kind;
  c.closed(t.continuous, cp, ['cooldown']);
  if (!has(t.continuous, 'cooldown')) c.err(join(cp, 'cooldown'), 'CONTINUOUS_COOLDOWN', `a continuous trigger sets cooldown ≥ ${LOOP_CONTINUOUS_MIN_COOLDOWN_SEC}s`);
  else {
    const sec = c.duration(t.continuous.cooldown, join(cp, 'cooldown'), 'cooldown');
    if (sec !== null && sec < LOOP_CONTINUOUS_MIN_COOLDOWN_SEC) {
      c.err(join(cp, 'cooldown'), 'CONTINUOUS_COOLDOWN', `cooldown is at least ${LOOP_CONTINUOUS_MIN_COOLDOWN_SEC}s`);
    }
  }
  return kind;
}

function validateExit(c: Checker, n: Obj, p: string): void {
  if (!has(n, 'exit') || !c.obj(n.exit, join(p, 'exit'), 'exit')) return;
  c.closed(n.exit, join(p, 'exit'), ['maxVisits', 'maxFailStreak']);
  for (const f of ['maxVisits', 'maxFailStreak']) if (has(n.exit, f)) c.posInt(n.exit[f], join(p, `exit.${f}`), `exit.${f}`);
}

function validateEdges(
  c: Checker,
  n: Obj,
  p: string,
  keys: readonly string[],
  edges: Array<{ path: string; from: string; fromType: string; target: unknown }>,
  from: string,
  type: string,
): void {
  if (!has(n, 'on')) return;
  if (!c.obj(n.on, join(p, 'on'), 'on')) return;
  for (const [k, target] of Object.entries(n.on)) {
    const ep = join(join(p, 'on'), k);
    if (k !== ANY && !keys.includes(k)) {
      c.err(ep, 'BAD_EDGE_KEY', `"${k}" is not a verdict of this node (${[...keys, ANY].join(', ')})`);
      continue;
    }
    edges.push({ path: ep, from, fromType: type, target });
  }
}

function validateInputRefs(c: Checker, v: unknown, p: string, what: string, g: Graph): void {
  if (!c.strList(v, p, what)) return;
  v.forEach((ref, i) => {
    const m = INPUT_REF.exec(ref);
    if (!m) c.err(join(p, i), 'BAD_INPUT_REF', `${what} entries are <node-or-source>.<field> (like tsc.evidence or trigger.payload)`);
    else if (!(LOOP_INPUT_ROOTS as readonly string[]).includes(m[1]!) && !g.nodeTypes.has(m[1]!)) {
      c.err(join(p, i), 'BAD_INPUT_REF', `"${m[1]}" is not a node id or one of ${LOOP_INPUT_ROOTS.join(', ')}`);
    }
  });
}

function validateNode(
  c: Checker,
  n: unknown,
  p: string,
  g: Graph,
  edges: Array<{ path: string; from: string; fromType: string; target: unknown }>,
): void {
  if (!c.obj(n, p, 'a node')) return;
  if (!has(n, 'id')) c.err(join(p, 'id'), 'REQUIRED', 'a node has an id');
  else c.kebab(n.id, join(p, 'id'), 'node id');
  const id = typeof n.id === 'string' ? n.id : '';
  if (!c.oneOf(n.type, join(p, 'type'), 'node type', ['check', 'model', 'notify', 'call'] as const)) return;
  validateExit(c, n, p);

  if (n.type === 'check') {
    c.closed(n, p, ['id', 'type', 'run', 'builtin', 'args', 'effect', 'pass', 'timeoutSec', 'exit', 'on']);
    const hasRun = has(n, 'run');
    const hasBuiltin = has(n, 'builtin');
    if (hasRun === hasBuiltin) c.err(p, 'CHECK_RUN_XOR_BUILTIN', 'a check has exactly one of run or builtin');
    if (hasRun) {
      g.nodeHasRun.add(id);
      for (const issue of argvIssues(n.run, join(p, 'run'))) c.errors.push(issue);
      if (has(n, 'args')) c.err(join(p, 'args'), 'UNKNOWN_KEY', 'args is for builtin checks; a run check puts its arguments in run');
    }
    if (hasBuiltin) {
      c.oneOf(n.builtin, join(p, 'builtin'), 'builtin', LOOP_BUILTINS);
      if (has(n, 'args') && c.obj(n.args, join(p, 'args'), 'args')) c.literalArgs(n.args, join(p, 'args'));
    }
    if (has(n, 'effect')) c.oneOf(n.effect, join(p, 'effect'), 'effect', ['read', 'write'] as const);
    if (has(n, 'timeoutSec')) c.posInt(n.timeoutSec, join(p, 'timeoutSec'), 'timeoutSec');
    if (has(n, 'pass') && c.obj(n.pass, join(p, 'pass'), 'pass')) {
      const pp = join(p, 'pass');
      const ps = n.pass;
      if (has(ps, 'exit')) {
        c.closed(ps, pp, ['exit']);
        if (!(typeof ps.exit === 'number' && Number.isInteger(ps.exit) && ps.exit >= 0 && ps.exit <= 255)) c.err(join(pp, 'exit'), 'BAD_NUMBER', 'pass.exit is an exit code 0–255');
      } else if (has(ps, 'parse')) {
        c.closed(ps, pp, ['parse', 'failed']);
        c.oneOf(ps.parse, join(pp, 'parse'), 'pass.parse', LOOP_PARSERS);
        if (!(typeof ps.failed === 'number' && Number.isInteger(ps.failed) && ps.failed >= 0)) c.err(join(pp, 'failed'), 'BAD_NUMBER', 'pass.failed is a non-negative integer');
      } else if (has(ps, 'json')) {
        c.closed(ps, pp, ['json', 'op', 'value']);
        if (typeof ps.json !== 'string' || !/^\$(\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\])*$/.test(ps.json)) c.err(join(pp, 'json'), 'BAD_JSONPATH', 'pass.json is a simple JSONPath like $.summary.failed');
        c.oneOf(ps.op, join(pp, 'op'), 'pass.op', LOOP_JSON_OPS);
        const v = ps.value;
        if (!(v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')) c.err(join(pp, 'value'), 'BAD_TYPE', 'pass.value is a literal (number, string, boolean or null)');
      } else {
        c.err(pp, 'BAD_PASS', 'pass is one of { exit }, { parse, failed } or { json, op, value }');
      }
    }
    validateEdges(c, n, p, CHECK_VERDICTS, edges, id, 'check');
    return;
  }

  if (n.type === 'model') {
    c.closed(n, p, ['id', 'type', 'role', 'model', 'prompt', 'inputs', 'tools', 'verdict', 'limits', 'exit', 'on']);
    const role = c.oneOf(n.role, join(p, 'role'), 'role', LOOP_MODEL_ROLES) ? n.role : undefined;
    if (has(n, 'model') && c.obj(n.model, join(p, 'model'), 'model')) {
      const m = n.model;
      const mp = join(p, 'model');
      c.closed(m, mp, ['use', 'profile', 'escalate', 'minConfidence']);
      if (has(m, 'use')) {
        if (m.use === 'claude' || m.use === 'any') c.later(join(mp, 'use'), `model.use: ${m.use} (Claude in loops)`);
        else c.oneOf(m.use, join(mp, 'use'), 'model.use', ['local'] as const);
      }
      if (has(m, 'escalate')) {
        if (['on-unsure', 'on-unavailable', 'both'].includes(m.escalate as string)) c.later(join(mp, 'escalate'), `escalate: ${m.escalate as string} (Claude escalation)`);
        else c.oneOf(m.escalate, join(mp, 'escalate'), 'model.escalate', ['never'] as const);
      }
      if (has(m, 'profile')) c.kebab(m.profile, join(mp, 'profile'), 'model.profile');
      if (has(m, 'minConfidence') && !(typeof m.minConfidence === 'number' && m.minConfidence >= 0 && m.minConfidence <= 1)) {
        c.err(join(mp, 'minConfidence'), 'BAD_NUMBER', 'model.minConfidence is a number in [0, 1]');
      }
    }
    if (has(n, 'prompt')) c.str(n.prompt, join(p, 'prompt'), 'prompt', 20_000);
    if (has(n, 'inputs')) validateInputRefs(c, n.inputs, join(p, 'inputs'), 'inputs', g);
    if (has(n, 'tools')) {
      const tp = join(p, 'tools');
      const none = n.tools === 'none' || (Array.isArray(n.tools) && n.tools.length === 0);
      if (!none && (role === 'judge' || role === 'summarize')) {
        c.err(tp, 'TOOLS_NOT_ALLOWED', `a ${role} node has no tools (§3.4); only act nodes get the tools they declare`);
      } else if (!none) {
        if (!Array.isArray(n.tools)) c.err(tp, 'BAD_TYPE', 'tools is none or a list (read, edit, { paradigm: [...] })');
        else n.tools.forEach((tool, i) => {
          const ip = join(tp, i);
          if (tool === 'read' || tool === 'edit') return;
          if (isObj(tool) && has(tool, 'bash')) { c.later(join(ip, 'bash'), 'the bash tool in loops'); return; }
          if (isObj(tool) && has(tool, 'paradigm')) {
            c.closed(tool, ip, ['paradigm']);
            if (Array.isArray(tool.paradigm)) tool.paradigm.forEach((x, j) => c.oneOf(x, join(join(ip, 'paradigm'), j), 'paradigm tool', LOOP_PARADIGM_TOOLS));
            else c.err(join(ip, 'paradigm'), 'BAD_TYPE', 'paradigm tools are a list');
            return;
          }
          c.err(ip, 'BAD_TOOL', 'a tool is read, edit or { paradigm: [...] }');
        });
      }
    }
    if (has(n, 'verdict')) {
      const vp = join(p, 'verdict');
      if (role !== 'judge') c.err(vp, 'UNKNOWN_KEY', 'verdict classes are for judge nodes');
      else if (c.obj(n.verdict, vp, 'verdict')) {
        c.closed(n.verdict, vp, ['classes']);
        if (c.strList(n.verdict.classes, join(vp, 'classes'), 'verdict.classes', { nonEmpty: true })) {
          n.verdict.classes.forEach((k, i) => c.kebab(k, join(join(vp, 'classes'), i), 'a verdict class'));
        }
      }
    }
    if (has(n, 'limits') && c.obj(n.limits, join(p, 'limits'), 'limits')) {
      c.closed(n.limits, join(p, 'limits'), ['turns', 'tokens']);
      if (has(n.limits, 'turns')) c.posInt(n.limits.turns, join(p, 'limits.turns'), 'limits.turns');
      if (has(n.limits, 'tokens')) c.count(n.limits.tokens, join(p, 'limits.tokens'), 'limits.tokens');
    }
    validateEdges(c, n, p, MODEL_VERDICTS, edges, id, 'model');
    return;
  }

  if (n.type === 'notify') {
    c.closed(n, p, ['id', 'type', 'as', 'text', 'attach', 'choices', 'exit', 'on']);
    const as = c.oneOf(n.as, join(p, 'as'), 'notify as', ['toast', 'card'] as const) ? n.as : undefined;
    if (has(n, 'text')) c.str(n.text, join(p, 'text'), 'text', 2000);
    if (has(n, 'attach')) validateInputRefs(c, n.attach, join(p, 'attach'), 'attach', g);
    let keys: readonly string[] = TOAST_VERDICTS;
    if (as === 'card') {
      if (!has(n, 'choices')) c.err(join(p, 'choices'), 'REQUIRED', 'a card lists its choices');
      else if (c.strList(n.choices, join(p, 'choices'), 'choices', { nonEmpty: true })) {
        const seen = new Set<string>();
        n.choices.forEach((ch, i) => {
          const cp = join(join(p, 'choices'), i);
          if (!c.kebab(ch, cp, 'a choice')) return;
          if (ch === 'timeout' || ch === ANY) c.err(cp, 'BAD_ID', `"${ch}" is reserved`);
          if (seen.has(ch)) c.err(cp, 'DUPLICATE_ID', `choice "${ch}" is listed twice`);
          seen.add(ch);
        });
        keys = [...n.choices, 'timeout'];
      }
    } else if (as === 'toast' && has(n, 'choices')) {
      c.err(join(p, 'choices'), 'UNKNOWN_KEY', 'choices are for cards (as: card)');
    }
    validateEdges(c, n, p, keys, edges, id, 'notify');
    if (as === 'card' && isObj(n.on)) {
      // Aegis step 5 #3: an unanswered card pauses (a kernel pause the human resumes), and `stop` ends the run: the
      // author cannot route either to a node (the expanded edge, any included, is checked)
      const on = n.on as Record<string, unknown>;
      const eff = (k: string): unknown => on[k] ?? on[ANY];
      const t = eff('timeout');
      if (t !== undefined && t !== '@pause') c.err(join(join(p, 'on'), 'timeout'), 'CARD_EDGE', 'a card\'s timeout goes to @pause (an unanswered card pauses the loop)');
      const st = eff('stop');
      if (Array.isArray(n.choices) && n.choices.includes('stop') && st !== undefined && st !== '@stop' && st !== '@pause') c.err(join(join(p, 'on'), 'stop'), 'CARD_EDGE', 'a card\'s stop goes to @stop or @pause (stop never continues the loop)');
    }
    return;
  }

  // call
  c.closed(n, p, ['id', 'type', 'loop', 'exit', 'on']);
  if (!has(n, 'loop')) c.err(join(p, 'loop'), 'REQUIRED', 'a call names its loop as id@hash8');
  else if (typeof n.loop !== 'string' || !CALL_REF.exec(n.loop)) c.err(join(p, 'loop'), 'BAD_CALL', 'a call is pinned: <loop-id>@<hash8> (8 lowercase hex)');
  else {
    const m = CALL_REF.exec(n.loop)!;
    g.callees.push({ path: join(p, 'loop'), callee: m[1]!, hash8: m[2]!, from: id });
  }
  validateEdges(c, n, p, CALL_VERDICTS, edges, id, 'call');
}

/** Validate a parsed `loop:v2` definition. Pure: never reads the filesystem. */
export function validateLoop(input: unknown, opts: LoopValidateOptions = {}): LoopValidation {
  const c = new Checker();
  validateInto(c, input, opts);
  const ok = c.errors.length === 0;
  return { ok, errors: c.errors, warnings: c.warnings, ...(ok ? { loop: input as LoopDefinition } : {}) };
}

// ── The compile ──────────────────────────────────────────────────────────────

function expandEdges(on: EdgeMap | undefined, keys: readonly string[], fallback: (k: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = on?.[k] ?? on?.[ANY] ?? fallback(k);
  return out;
}

const definedExit = (e: NodeExit | undefined): NodeExit | undefined =>
  e ? { ...(e.maxVisits !== undefined ? { maxVisits: e.maxVisits } : {}), ...(e.maxFailStreak !== undefined ? { maxFailStreak: e.maxFailStreak } : {}) } : undefined;

function compileNode(n: LoopNode, readShebang?: LoopCompileOptions['readShebang']): CompiledNode {
  const exit = definedExit(n.exit);
  switch (n.type) {
    case 'check': {
      const interp = n.run && readShebang ? readShebang(n.run[0]!) : null;
      return {
        id: n.id, type: 'check',
        ...(n.run ? { run: [...n.run] } : {}),
        ...(interp ? { argv0Interpreter: interp } : {}),
        ...(n.builtin ? { builtin: n.builtin, args: structuredClone(n.args ?? {}) } : {}),
        effect: n.effect ?? (LOOP_DEFAULTS.effect as 'read'),
        pass: structuredClone(n.pass ?? { exit: 0 }),
        timeoutSec: n.timeoutSec ?? LOOP_DEFAULTS.timeoutSec,
        ...(exit ? { exit } : {}),
        on: expandEdges(n.on, CHECK_VERDICTS, () => '@stop'),
      };
    }
    case 'model': {
      const tools = n.tools === undefined || n.tools === 'none' ? [] : structuredClone(n.tools);
      return {
        id: n.id, type: 'model', role: n.role,
        model: {
          use: 'local', escalate: 'never',
          ...(n.model?.profile ? { profile: n.model.profile } : {}),
          minConfidence: n.model?.minConfidence ?? LOOP_DEFAULTS.minConfidence,
        },
        ...(n.prompt !== undefined ? { prompt: n.prompt } : {}),
        inputs: [...(n.inputs ?? [])],
        tools,
        ...(n.verdict ? { verdict: { classes: [...n.verdict.classes] } } : {}),
        limits: {
          turns: n.limits?.turns ?? LOOP_DEFAULTS.modelLimits.turns,
          tokens: n.limits?.tokens !== undefined ? parseCount(n.limits.tokens)! : LOOP_DEFAULTS.modelLimits.tokens,
        },
        ...(exit ? { exit } : {}),
        on: expandEdges(n.on, MODEL_VERDICTS, (k) => (k === 'unavailable' ? '@pause' : '@stop')),
      };
    }
    case 'notify': {
      const keys = n.as === 'card' ? [...(n.choices ?? []), 'timeout'] : TOAST_VERDICTS;
      return {
        id: n.id, type: 'notify', as: n.as,
        ...(n.text !== undefined ? { text: n.text } : {}),
        attach: [...(n.attach ?? [])],
        ...(n.as === 'card' ? { choices: [...(n.choices ?? [])] } : {}),
        ...(exit ? { exit } : {}),
        on: expandEdges(n.on, keys, (k) => (k === 'timeout' ? '@pause' : '@stop')),
      };
    }
    case 'call': {
      const m = CALL_REF.exec(n.loop)!;
      return {
        id: n.id, type: 'call', loop: n.loop, callee: m[1]!, hash8: m[2]!,
        ...(exit ? { exit } : {}),
        on: expandEdges(n.on, CALL_VERDICTS, () => '@stop'),
      };
    }
  }
}

function compileTrigger(t: LoopTrigger, flowIndex: LoopValidateOptions['flowIndex']): CompiledTrigger {
  if ('schedule' in t) {
    const s = t.schedule;
    return {
      type: 'schedule',
      ...('every' in s ? { every: parseDurationSec(s.every)! } : {}),
      ...('daily' in s ? { daily: s.daily } : {}),
      ...('weekly' in s ? { weekly: { day: s.weekly.day, at: s.weekly.at } } : {}),
      catchUp: t.catchUp ?? (LOOP_DEFAULTS.catchUp as 'skip'),
    };
  }
  if ('event' in t) {
    const e = t.event;
    const debounceSec = t.debounce !== undefined ? parseDurationSec(t.debounce)! : LOOP_DEFAULTS.debounceSec;
    if (e.kind === 'file.changed') {
      const paths = flowIndex?.[e.flow];
      return { type: 'event', kind: e.kind, flow: e.flow, ...(paths ? { paths: [...paths] } : {}), debounceSec };
    }
    if (e.kind === 'card.decided') return { type: 'event', kind: e.kind, loop: e.loop, node: e.node, debounceSec };
    return { type: 'event', kind: e.kind, debounceSec };
  }
  return { type: 'continuous', cooldownSec: parseDurationSec(t.continuous.cooldown)! };
}

/**
 * Validate, then compile to the kernel's form: every default filled (an absent budget field is the global
 * default), durations in seconds, edges expanded, flows resolved when a flow index is given.
 */
export function compileLoop(input: unknown, opts: LoopCompileOptions = {}): LoopCompilation {
  const v = validateLoop(input, opts);
  if (!v.ok || !v.loop) return v;
  const d = v.loop;
  const bd = opts.budgetDefaults ?? LOOP_BUDGET_DEFAULTS;
  const br = d.budgets?.run;
  const bday = d.budgets?.day;
  const be = d.budgets?.escalations;
  const flows = [...(d.flows ?? [])];
  const referenced = new Set<string>(flows);
  for (const t of d.triggers ?? []) if ('event' in t && t.event.kind === 'file.changed') referenced.add(t.event.flow);
  const flowsResolved = !!opts.flowIndex || referenced.size === 0;
  const flowPaths: Record<string, string[]> | undefined = opts.flowIndex && referenced.size
    ? Object.fromEntries([...referenced].sort().map((f) => [f, [...(opts.flowIndex![f] ?? [])]]))
    : undefined;
  // protected set: own + every callee reachable through known loops (cycles were refused by validation)
  const known = knownMap(opts.knownLoops);
  const prot = new Set<string>([...LOOP_ALWAYS_PROTECTED, ...ownProtected(d)]);
  const seenCallees = new Set<string>();
  const todo = callTargets(d);
  while (todo.length) {
    const id = todo.pop()!;
    if (seenCallees.has(id) || !known?.has(id)) continue;
    seenCallees.add(id);
    for (const x of ownProtected(known.get(id))) prot.add(x);
    todo.push(...callTargets(known.get(id)));
  }
  const callsResolved = callTargets(d).length === 0 || !!known;
  const compiled: CompiledLoop = {
    schema: LOOP_SCHEMA,
    compiled: { version: LOOP_COMPILED_VERSION, flowsResolved, callsResolved, sourceHash: loopContentHash(input) },
    id: d.id,
    ...(d.title !== undefined ? { title: d.title } : {}),
    scope: opts.scope ?? 'repo',
    ...(d.repo !== undefined ? { repo: d.repo } : {}),
    flows,
    ...(flowPaths ? { flowPaths } : {}),
    triggers: (d.triggers ?? []).map((t) => compileTrigger(t, opts.flowIndex)),
    autonomy: d.autonomy ?? LOOP_DEFAULTS.autonomy,
    notify: { on: [...(d.notify?.on ?? LOOP_DEFAULTS.notify.on)], as: d.notify?.as ?? LOOP_DEFAULTS.notify.as },
    decide: d.decide ?? LOOP_DEFAULTS.decide,
    budgets: {
      run: {
        rounds: br?.rounds ?? bd.run.rounds,
        wallMin: br?.wallMin ?? bd.run.wallMin,
        tokens: br?.tokens !== undefined ? parseCount(br.tokens)! : bd.run.tokens,
        computeSec: br?.computeSec ?? bd.run.computeSec,
      },
      day: {
        runs: bday?.runs ?? bd.day.runs,
        tokens: bday?.tokens !== undefined ? parseCount(bday.tokens)! : bd.day.tokens,
        computeSec: bday?.computeSec ?? bd.day.computeSec,
      },
      escalations: { perRun: be?.perRun ?? bd.escalations.perRun, perDay: be?.perDay ?? bd.escalations.perDay },
    },
    ...(d.goal ? { goal: { node: d.goal.node, verdict: 'pass' as const, inputs: [...(d.goal.inputs ?? [])] } } : {}),
    ...(d.land ? { land: { paths: [...d.land.paths], message: d.land.message, maxWaitMin: d.land.maxWaitMin ?? LOOP_DEFAULTS.landMaxWaitMin } } : {}),
    start: d.start,
    nodes: d.nodes.map((n) => compileNode(n, opts.readShebang)),
    protected: [...prot].sort(),
  };
  return { ...v, compiled };
}

/** The stable hashing form of a compiled loop: sorted keys, no whitespace (gnomon-contracts canonicalJson). */
export function canonicalLoopJson(compiled: CompiledLoop): string {
  return canonicalJson(compiled);
}

/** The file form (`<id>.loop.json`): the canonical key order, indented, with a trailing newline. */
export function loopFileJson(compiled: CompiledLoop): string {
  return `${JSON.stringify(JSON.parse(canonicalLoopJson(compiled)), null, 2)}\n`;
}

/** One-line rendering of an issue for CLI and MCP output. */
export function formatLoopIssue(i: LoopIssue): string {
  return `${i.path || '(root)'}: ${i.code}: ${i.message}`;
}
