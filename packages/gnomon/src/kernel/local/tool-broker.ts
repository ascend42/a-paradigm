/**
 * @symbol #local-tool-broker
 * @symbol $local-brokered-call
 *
 * #local-tool-broker (TD-2026-10-27-833 slice C1; T-2026-10-26-003): the
 * kernel half of a local session's BROKERED tools. The child (gnomon-local
 * broker.ts) emits `tool_request{id, toolCallId, name, args}`; LocalLane hands
 * it here and writes the `tool_response{id, content, isError, provenance}`
 * this returns. $local-brokered-call, one call:
 *   1. resolve the name in the session's OFFERED set (else unknown-tool); a
 *      loop session is offered nothing and refused loop-session; a request id
 *      already in flight is refused bad-args (Aegis L5);
 *   2. validate the args against the FULL schema (validateBrokeredArgs, fail
 *      closed: a schema keyword it does not know refuses the call): unknown
 *      keys refused whatever the schema says, type (unions with null too) /
 *      required / enum / min-maxLength / pattern / maxItems, strings NFC, no
 *      control, format (Cf), private-use, unassigned or default-ignorable
 *      character in any key or string, depth and total size capped
 *      (G-LCL-15: refused args never reach the target);
 *   3. ONE gate per call (Aegis H1): a target that owns its gate (the kernel
 *      verbs: their card shows the URL, host, sha and secret scan) gets no
 *      broker card — the verb's own card is the gate, and for a local session
 *      it never takes an Always rule or an auto pass (VerbSession.local); a
 *      target with no gate: `read` runs, `mutate`/`destructive` raise a
 *      `permission` card (brokerCard: the namespaced name `kernel:<tool>` /
 *      `mcp:<server>/<tool>`, so composePermission's special cases never
 *      apply; every argument shown, fenced; allow | deny);
 *   4. card hygiene (Aegis M4): at most ONE mutate/destructive call in flight
 *      per session (else busy); the same tool + args denied within
 *      DENY_COOLDOWN_MS is refused cooldown; SUSPEND_AFTER_DENIES denies in
 *      SUSPEND_WINDOW_MS suspend the session's brokered calls (suspended);
 *   5. call the target WITH the call's AbortSignal and deadline (Aegis H1):
 *      the kernel verbs honour both in their queue wait, their card (it
 *      expires at the deadline or on abort) and right before the effect;
 *   6. shape the result (NULs dropped, <= RESULT_MAX_CHARS) and log ONE
 *      hash-only `tool.brokered{hsid, server, tool?, class?, argsHash,
 *      decision, bytes, isError, cardId?}` row; reply.
 * Deadlines (Aegis M1): the kernel's deadline is the child's (TOOL_TIMEOUT_MS
 * 30 s read, CARD_TIMEOUT_MS 5 min otherwise) counted from the moment the line
 * was RECEIVED (stamped in LocalLane's stdout handler) minus DEADLINE_MARGIN_MS,
 * so the kernel always answers `expired` before the child gives up; the
 * child's timer is the safety net. The child's `tool_cancel{id}` (its timeout
 * or abort) cancels the call here — it only ever removes privilege.
 * Aegis re-check (N1-N6): a carded call the child cancels counts toward the
 * suspension, and carded requests are rate-limited (CARDED_PER_MINUTE); the
 * row's decision follows the target's closed `why` (refused for the rest;
 * approved only when the call succeeded) and carries the target's cardId; a
 * request received at or before the session's last interrupt is cancelled;
 * once the effect starts the kernel sends tool_progress{id, state:'running'}
 * (the child extends its wait, the kernel's deadline stops); a schema
 * `pattern` must pass a safe-regex check (length, no nested quantifier, no
 * backreference or lookaround).
 * Slice C2': a NARROW tool (#capability-index entry, its own target: one MCP
 * server of the session's #local-mcp-client pool, ownsGate false) is
 * reassembled (the op fixed by the kernel), validated against the FULL schema,
 * class-gated as above, and its card shows `mcp:<server>/<tool>` with the
 * reassembled call; setTools() replaces the set on a server's list_changed.
 * Slice C4'a (#local-tool-tier): each offered narrow tool carries the FORM it
 * was offered in; a 'full' one goes through reassembleFull (an op key refused,
 * the op set, the full schema), a 'narrow' one through reassemble. A tier
 * change that re-offers the same entry in another form keeps the previous
 * form callable (and winning its name) until the child's tools_applied.
 * Slice C5'a1 (#mcp-servers trust): a narrow tool's `read` class is believed
 * only while trustLive(server) answers trusted or first-party, checked on the
 * RESOLVED tool (grace entries included) at call time; otherwise it takes a
 * card like a mutate tool (logged with that class), and a trusted read the
 * target finds untrusted by the time it runs is refused (why trust-dropped).
 * Every brokered MCP card names the server's trust level.
 * Slice C5'a2 (^local-tool-grant): a `mutate` narrow tool of a server trusted
 * NOW (trusted or first-party) is RULEABLE: its bindHash (toolBindHash: the
 * entry id, the sha256 of its FULL schema, its class and the server's live
 * trust binding; the entry, never its form) is matched against the repo's
 * #always-rules tool rules AFTER the manual check and BEFORE the carded rate
 * limit. A match runs with no card: it writes approval.auto{tool, inputHash,
 * modeRef:'rule:<id>'} first (no row, no run), counts as carded for
 * MAX_CARDED_IN_FLIGHT, takes RULED_PER_MINUTE (not CARDED_PER_MINUTE) and the
 * tool timeout, tells the target it runs on trust (a trust drop before it
 * runs refuses it) and logs `approved` with no cardId. No match: the card
 * offers allow | deny | always with a ruleScope, detail.toolScopes ['tool']
 * and detail.brokered.bindHash (inside the contentHash); `always` counts as
 * allow. Destructive tools, read tools, untrusted servers, kernel verbs,
 * manual mode and loop sessions never match a rule and never offer Always.
 * Slice C5'a3: every brokered card's block carries a {type:'tool-scope',
 * detail} node holding the card's full detail (the one the contentHash covers:
 * toolScopes, the tool, its server, the trust level and bindHash), so the GUI
 * can verify what the kernel offered.
 * GAPS left for C5'b (documented in .purpose): no selection beyond the
 * C2' slot rule; no grant UI for per-server trust or the tool scope; the
 * Rules view does not mark a dormant tool rule stale yet; the suspension
 * notice is the tool.brokered row (no GUI notice yet); control characters are
 * refused outright (no newline in brokered args).
 */
import { canonicalJson, sha256Tagged, TOOL_BROKER_TOOL_PATTERN, type ToolBrokerClass, type ToolBrokeredDecision } from '@a-company/gnomon-contracts';
import type { ApprovalBroker } from '../broker/broker.js';
import { blockOf } from '../broker/card.js';
import type { GitVerbs, VerbSession } from '../git/kernel-verbs.js';
import { KERNEL_MCP_SERVER } from '../git/verbs.js';
import { kernelMcpAnswer } from '../supervisor/kernel-mcp.js';
import { composePermission, inputHash } from '../supervisor/permission.js';
import { narrow, reassemble, reassembleFull, type CapabilityEntry, type ServerTrust, type ToolForm } from './capability-index.js';
import type { ListedIndex } from './mcp-client.js';
import { bindingOf } from './trust-book.js';

/** The same deadlines the child waits (gnomon-local broker.ts TOOL_TIMEOUT_MS / CARD_TIMEOUT_MS). */
export const TOOL_TIMEOUT_MS = 30_000;
export const CARD_TIMEOUT_MS = 5 * 60_000;
/** The kernel answers this long before the child's own timer fires (at most half the timeout). */
export const DEADLINE_MARGIN_MS = 2_000;
/** Brokered calls one session may have in flight; past it, refused busy. */
export const MAX_BROKERED_IN_FLIGHT = 16;
/** Aegis M4: mutate/destructive calls one session may have in flight (one card at a time). */
export const MAX_CARDED_IN_FLIGHT = 1;
/** Aegis M4: the same tool + args denied this recently is refused without a card. */
export const DENY_COOLDOWN_MS = 60_000;
/** Aegis M4: this many denies inside SUSPEND_WINDOW_MS suspend the session's brokered calls. */
export const SUSPEND_AFTER_DENIES = 3;
export const SUSPEND_WINDOW_MS = 10 * 60_000;
/** Aegis N1: at most this many mutate/destructive requests per session per minute (past it, busy). */
export const CARDED_PER_MINUTE = 6;
/** Slice C5'a2: at most this many calls an Always rule passes per session per minute (past it, busy). */
export const RULED_PER_MINUTE = 20;
/** Slice C6'a2-1: at most this many "/" runs the human starts per session per minute (their own bucket; past it, busy). */
export const HUMAN_RUNS_PER_MINUTE = 10;
/** Slice C6'a2-1 (founder): a destructive Always rule passes at most this many calls per session per minute… */
export const DESTRUCTIVE_RULED_PER_SESSION_MINUTE = 3;
/** …and at most this many per rule per day (kernel clock, across the daemon's sessions); past either, the call is carded. */
export const DESTRUCTIVE_RULED_PER_RULE_DAY = 30;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Slice C6'a2-1 (founder, TD-2026-10-28-969): the destructive-rule pass limits — DESTRUCTIVE_RULED_PER_SESSION_MINUTE per
 * session per minute and DESTRUCTIVE_RULED_PER_RULE_DAY per rule per rolling day. LocalLane holds ONE for the daemon
 * (the per-rule count spans sessions); held in memory (a daemon restart starts it over). take() records the pass only
 * when both allow it.
 */
export class DestructiveRuleBudget {
  readonly #session = new Map<string, number[]>();
  readonly #rule = new Map<string, number[]>();

  take(hsid: string, ruleId: string, now: number): boolean {
    const prune = (m: Map<string, number[]>, k: string, win: number): number[] => {
      const a = (m.get(k) ?? []).filter((t) => t > now - win);
      m.delete(k);
      m.set(k, a);
      return a;
    };
    const s = prune(this.#session, hsid, 60_000);
    const r = prune(this.#rule, ruleId, DAY_MS);
    if (s.length >= DESTRUCTIVE_RULED_PER_SESSION_MINUTE || r.length >= DESTRUCTIVE_RULED_PER_RULE_DAY) return false;
    s.push(now);
    r.push(now);
    // bounded: the least recently used keys go first
    for (const m of [this.#session, this.#rule]) while (m.size > 1024) m.delete(m.keys().next().value as string);
    return true;
  }
}
/** Aegis N6: the longest schema pattern run. */
export const PATTERN_MAX_CHARS = 256;
/** The full-schema bounds (step 2). */
export const ARG_LIMITS = Object.freeze({ bytes: 16 * 1024, string: 4096, array: 64, depth: 6, keys: 64 });
/** The most chars of a result sent back (the child caps again under its own budget). */
export const RESULT_MAX_CHARS = 64 * 1024;

export interface BrokeredTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  class: ToolBrokerClass;
  /**
   * slice C2': a NARROW tool (#capability-index): the narrow args are reassembled (fixed op, split commas, nested
   * dotted params) and validated against `entry.schema` (the FULL schema) before the target sees them
   */
  entry?: CapabilityEntry;
  /**
   * slice C4'a (#local-tool-tier): the form a narrow tool was OFFERED in — 'full' (tier 3: its full schema, the call
   * goes through reassembleFull) or 'narrow' (default: reassemble). A call routes by the form it was offered in.
   */
  form?: ToolForm;
  /** slice C2': the target this tool goes to (an MCP server of the session's pool); default the broker's own */
  target?: BrokerTarget;
}

export interface TargetCall {
  signal: AbortSignal;
  /** epoch ms */
  deadline: number;
  /** Aegis N4: the target calls this once, right before its effect starts */
  onRunning?: () => void;
  /**
   * slice C5'a1: this call runs with NO card only because the server's labels are believed (a read tool of a trusted
   * server; slice C5'a2: or a call an Always rule passed, which needs that trust too): the target refuses it (why
   * 'trust-dropped') if that trust has ended by the time it would run
   */
  trustedRead?: boolean;
}

/** A target the broker calls: one MCP server (C1: the kernel's own). */
export interface BrokerTarget {
  /** the MCP server name (`gnomon` for the kernel's own) */
  server: string;
  /** how the child labels the result: `kernel`, or `mcp:<server>` */
  provenance: string;
  /** Aegis H1: the target raises its own card for mutate/destructive calls (the broker raises none) */
  ownsGate: boolean;
  list(): Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>>;
  /** `why` is the target's closed reason when it refused (e.g. git.verb's `denied`, `cancelled`) */
  call(name: string, args: Record<string, unknown>, o: TargetCall): Promise<{ text: string; isError: boolean; why?: string; cardId?: string }>;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * C1's target: the kernel's own SDK server, through the same kernelMcpAnswer a Claude session reaches (kernel-mcp.ts).
 * Every call's VerbSession is marked `local` and carries the call's signal and deadline (Aegis H1).
 */
export function kernelSdkTarget(verbs: Pick<GitVerbs, 'tools' | 'call'>, session: () => VerbSession | null): BrokerTarget {
  let n = 0;
  const rpc = async (method: string, params: Record<string, unknown> | undefined, s: () => VerbSession | null): Promise<Record<string, unknown>> => kernelMcpAnswer({ jsonrpc: '2.0', id: ++n, method, ...(params ? { params } : {}) }, verbs, s);
  return {
    server: KERNEL_MCP_SERVER,
    provenance: 'kernel',
    ownsGate: true,
    async list() {
      const r = await rpc('tools/list', undefined, session);
      const tools = isObj(r.result) && Array.isArray(r.result.tools) ? r.result.tools : [];
      return tools.filter(isObj).map((t) => ({ name: String(t.name), description: typeof t.description === 'string' ? t.description : '', inputSchema: isObj(t.inputSchema) ? t.inputSchema : {} }));
    },
    async call(name, args, o) {
      const s = (): VerbSession | null => {
        const v = session();
        return v ? { ...v, local: true, signal: o.signal, deadline: o.deadline, ...(o.onRunning ? { onEffect: o.onRunning } : {}) } : null;
      };
      const r = await rpc('tools/call', { name, arguments: args }, s);
      if (isObj(r.error)) return { text: typeof r.error.message === 'string' ? r.error.message : 'the kernel tool call failed', isError: true };
      const res = isObj(r.result) ? r.result : {};
      const text = Array.isArray(res.content) ? res.content.filter(isObj).map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n') : '';
      const meta = isObj(res._meta) ? res._meta : {};
      return { text, isError: res.isError === true, ...(typeof meta['gnomon/why'] === 'string' ? { why: meta['gnomon/why'] } : {}), ...(typeof meta['gnomon/cardId'] === 'string' ? { cardId: meta['gnomon/cardId'] } : {}) };
    },
  };
}

/**
 * The grant class of each kernel SDK tool (C1; Aegis reviews the table in C5'). A tool missing here is never offered
 * (fail closed).
 */
export const KERNEL_TOOL_CLASSES: Readonly<Record<string, ToolBrokerClass>> = Object.freeze({
  gnomon_git_init: 'mutate',
  gnomon_git_push: 'destructive',
  gnomon_repo_create: 'destructive',
  gnomon_worktree_add: 'mutate',
  gnomon_worktree_remove: 'destructive',
});

/**
 * C1 narrowing: kernel tools a local session can never run. The worktree verbs need the kernel-worktree denies in
 * the session profile (VerbSession.worktreesGuarded); a local session's profile has none, so they would always refuse.
 */
export const LOCAL_UNSERVED_KERNEL_TOOLS: readonly string[] = Object.freeze(['gnomon_worktree_add', 'gnomon_worktree_remove']);

/**
 * The kernel SDK tools offered to a local session (tools_set at open): classed, served, well-formed and (Aegis M3)
 * read-class only when the session's run mode is manual.
 */
export async function offeredKernelTools(target: BrokerTarget, o: { classes?: Readonly<Record<string, ToolBrokerClass>>; manual?: boolean } = {}): Promise<BrokeredTool[]> {
  const classes = o.classes ?? KERNEL_TOOL_CLASSES;
  const out: BrokeredTool[] = [];
  for (const t of await target.list()) {
    const cls = Object.hasOwn(classes, t.name) ? classes[t.name] : undefined;
    if (!cls || LOCAL_UNSERVED_KERNEL_TOOLS.includes(t.name) || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(t.name) || t.inputSchema.type !== 'object') continue;
    if (o.manual && cls !== 'read') continue;
    out.push({ name: t.name, description: t.description.slice(0, 1024), parameters: structuredClone(t.inputSchema), class: cls });
  }
  return out;
}

/**
 * Aegis L1: characters no brokered string or key may hold — C0/C1 controls (tab and newline included), format
 * characters (bidi overrides, zero-width joiners: Cf), private use (Co), unassigned (Cn) and default-ignorable
 * code points (variation selectors, Hangul fillers…).
 */
const FORBIDDEN_CHARS = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Default_Ignorable_Code_Point}]/u;

/** The schema keywords validateBrokeredArgs understands; any other keyword refuses the call (fail closed). */
export const SCHEMA_KEYWORDS: readonly string[] = Object.freeze(['type', 'properties', 'required', 'additionalProperties', 'enum', 'minLength', 'maxLength', 'pattern', 'items', 'maxItems', 'description', 'title', 'default', '$schema']);

const TYPE_OK: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  integer: (v) => typeof v === 'number' && Number.isSafeInteger(v),
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => isObj(v),
  null: (v) => v === null,
};

/** Step 2: `args` against the tool's FULL schema plus the kernel's own bounds. Returns why, or null when valid. */
export function validateBrokeredArgs(schema: Record<string, unknown>, args: unknown): string | null {
  if (!isObj(args)) return 'arguments must be a JSON object';
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(args), 'utf8');
  } catch {
    return 'arguments are not plain JSON';
  }
  if (size > ARG_LIMITS.bytes) return `arguments are over ${ARG_LIMITS.bytes} bytes`;
  return check(schema, args, 'arguments', 0);
}

const badText = (t: string): string | null => (FORBIDDEN_CHARS.test(t) ? 'holds a control, format, private-use, unassigned or ignorable character' : t.normalize('NFC') !== t ? 'is not in Unicode NFC' : null);

function check(schema: unknown, v: unknown, at: string, depth: number): string | null {
  if (depth > ARG_LIMITS.depth) return `${at} is nested too deeply`;
  const sc = isObj(schema) ? schema : {};
  const unknownKw = Object.keys(sc).find((k) => !SCHEMA_KEYWORDS.includes(k));
  if (unknownKw !== undefined) return `the schema of ${at} uses ${JSON.stringify(unknownKw.slice(0, 32))}, which the kernel does not check: refused`;
  const types = typeof sc.type === 'string' ? [sc.type] : Array.isArray(sc.type) ? sc.type.filter((t): t is string => typeof t === 'string') : null;
  if (types && types.some((t) => !TYPE_OK[t])) return `the schema of ${at} names an unknown type: refused`;
  if (types && !types.some((t) => TYPE_OK[t]!(v))) return `${at} must be ${types.map((t) => (t === 'integer' ? 'an integer' : t === 'null' ? 'null' : `a ${t}`)).join(' or ')}`;
  if (Array.isArray(sc.enum) && !sc.enum.some((e) => e === v)) return `${at} is not one of the allowed values`;
  if (typeof v === 'number' && !Number.isFinite(v)) return `${at} must be a finite number`;
  if (typeof v === 'string') {
    const max = Math.min(typeof sc.maxLength === 'number' ? sc.maxLength : ARG_LIMITS.string, ARG_LIMITS.string);
    if (v.length > max) return `${at} is longer than ${max} chars`;
    if (typeof sc.minLength === 'number' && v.length < sc.minLength) return `${at} is shorter than ${sc.minLength} chars`;
    const bt = badText(v);
    if (bt) return `${at} ${bt}`;
    if (typeof sc.pattern === 'string') {
      const unsafe = unsafePattern(sc.pattern);
      if (unsafe) return `the schema of ${at} has an unsafe pattern (${unsafe}): refused`;
      let re: RegExp;
      try {
        re = new RegExp(sc.pattern, 'u');
      } catch {
        return `the schema of ${at} has a pattern that does not compile: refused`;
      }
      if (!re.test(v)) return `${at} does not match its pattern`;
    }
  }
  if (Array.isArray(v)) {
    const max = Math.min(typeof sc.maxItems === 'number' ? sc.maxItems : ARG_LIMITS.array, ARG_LIMITS.array);
    if (v.length > max) return `${at} has more than ${max} items`;
    for (const [i, x] of v.entries()) {
      const e = check(sc.items, x, `${at}[${i}]`, depth + 1);
      if (e) return e;
    }
  }
  if (isObj(v)) {
    const props = isObj(sc.properties) ? sc.properties : {};
    const keys = Object.keys(v);
    if (keys.length > ARG_LIMITS.keys) return `${at} has more than ${ARG_LIMITS.keys} keys`;
    for (const k of keys) {
      if (badText(k)) return `${at} has a key that ${badText(k)}`;
      if (!Object.hasOwn(props, k)) return `${at} has an unknown key ${JSON.stringify(k.slice(0, 64))}`;
    }
    const req = Array.isArray(sc.required) ? sc.required.filter((r): r is string => typeof r === 'string') : [];
    for (const r of req) if (!Object.hasOwn(v, r)) return `${at}.${r} is required`;
    for (const k of keys) {
      const e = check(props[k], v[k], `${at}.${k}`, depth + 1);
      if (e) return e;
    }
  } else if (types === null && isObj(sc.properties)) return `${at} must be an object`;
  return null;
}

/**
 * Slice C6'a2-1: why a tool's FULL schema would refuse EVERY call before any argument is read (a keyword the validator
 * does not check, an unknown type, an unsafe or broken pattern anywhere under properties or items), or null. The "/"
 * menu shows such a tool as not runnable, with this reason (request.session.capabilities tools[].run).
 */
export function schemaRefusal(schema: unknown, at = 'arguments', depth = 0): string | null {
  if (depth > ARG_LIMITS.depth) return null;
  const sc = isObj(schema) ? schema : {};
  const unknownKw = Object.keys(sc).find((k) => !SCHEMA_KEYWORDS.includes(k));
  if (unknownKw !== undefined) return `the schema of ${at} uses ${JSON.stringify(unknownKw.slice(0, 32))}, which the kernel does not check`;
  const types = typeof sc.type === 'string' ? [sc.type] : Array.isArray(sc.type) ? sc.type.filter((t): t is string => typeof t === 'string') : null;
  if (types && types.some((t) => !TYPE_OK[t])) return `the schema of ${at} names an unknown type`;
  if (typeof sc.pattern === 'string') {
    const unsafe = unsafePattern(sc.pattern);
    if (unsafe) return `the schema of ${at} has an unsafe pattern (${unsafe})`;
    try {
      new RegExp(sc.pattern, 'u');
    } catch {
      return `the schema of ${at} has a pattern that does not compile`;
    }
  }
  if (sc.items !== undefined) {
    const e = schemaRefusal(sc.items, `${at}[]`, depth + 1);
    if (e) return e;
  }
  if (isObj(sc.properties)) {
    for (const [k, v] of Object.entries(sc.properties)) {
      const e = schemaRefusal(v, `${at}.${k.slice(0, 64)}`, depth + 1);
      if (e) return e;
    }
  }
  return null;
}

/**
 * Aegis N6: a schema pattern the kernel will run (it bounds the input at ARG_LIMITS.string already): at most
 * PATTERN_MAX_CHARS, no backreference or lookaround, no quantified group that itself holds a quantifier (the classic
 * catastrophic shapes `(a+)+`, `(a|a*)*`, `(.*){2,}`). Returns why it is unsafe, or null.
 */
export function unsafePattern(p: string): string | null {
  if (p.length > PATTERN_MAX_CHARS) return `longer than ${PATTERN_MAX_CHARS} chars`;
  if (/\\[1-9]|\\k</.test(p)) return 'a backreference';
  if (/\(\?<?[=!]/.test(p)) return 'a lookaround';
  // a group whose body holds a quantifier, itself followed by a quantifier
  const stack: Array<{ quant: boolean }> = [];
  let inClass = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '\\') { i++; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '(') { stack.push({ quant: false }); continue; }
    if (c === ')') {
      const g = stack.pop();
      const next = p[i + 1];
      if (g?.quant && (next === '*' || next === '+' || next === '{' || next === '?')) return 'a nested quantifier';
      if (g?.quant && stack.length) stack[stack.length - 1]!.quant = true;
      continue;
    }
    if ((c === '*' || c === '+' || c === '{') && stack.length) stack[stack.length - 1]!.quant = true;
  }
  return null;
}

/** Step 6: what the child receives — NULs dropped, at most RESULT_MAX_CHARS, a note when cut. */
export function shapeBrokeredResult(text: string): string {
  const clean = text.replace(/\u0000/g, '');
  if (clean.length <= RESULT_MAX_CHARS) return clean;
  const note = `\n[cut by the kernel: ${clean.length} chars, the first ${RESULT_MAX_CHARS - 200} shown]`;
  return clean.slice(0, RESULT_MAX_CHARS - 200) + note;
}

export interface ToolRequestIn {
  id: string;
  toolCallId: string | null;
  name: string | null;
  args: Record<string, unknown> | null;
  /** runner.ts: why the line was malformed (the call is answered as bad-args) */
  error: string | null;
  /** Aegis M1: when LocalLane's stdout handler received the line (epoch ms; default now) */
  receivedAt?: number;
}

export interface ToolResponseOut {
  id: string;
  content: string;
  isError: boolean;
  provenance: string;
  /** slice C3' (Aegis L2): the row's decision (sticky credit only for `ran`); never sent to the child */
  decision?: ToolBrokeredDecision;
  /** slice C6'a2-1: the card the call took (a "/" run reports it); never sent to the child */
  cardId?: string;
}

/** Slice C6'a2-1: one "/" run the human started (request.session.tools.run, resolved by LocalLane). */
export interface HumanRunIn {
  runId: string;
  entry: CapabilityEntry;
  target: BrokerTarget;
  /** 'narrow' (reassemble) only for an entry that is not humanOnly; 'full' (reassembleFull) otherwise */
  form: ToolForm;
  args: Record<string, unknown>;
  /** told the card's id as soon as it is raised */
  onCarded?: (cardId: string) => void;
}

type Broker = Pick<ApprovalBroker, 'raise'> & Partial<Pick<ApprovalBroker, 'decisionOf' | 'expire' | 'auto' | 'rootTableReady'>>;

/** Slice C5'a2: the repo's #always-rules tool-rule match (RuleBook.match through the supervisor's alwaysRule seam). */
export interface BrokeredRuleSource {
  /**
   * the live tool rule for (repoKey, `mcp:<server>/<tool>`, bindHash) of the call's class (slice C6'a2-1: a destructive
   * call matches only a destructive rule), or null (none, off, dormant, manual mode)
   */
  match(repoKey: string, tool: string, bindHash: string, cls: 'mutate' | 'destructive'): { ruleId: string } | null;
}

/**
 * Slice C5'a2 (^local-tool-grant): what a tool rule binds — the capability ENTRY (its id names the server, the tool and
 * the op), the sha256 of its FULL schema (not the 8-hex id), its class and the server's live trust binding. Never the
 * form it was offered in (a tier change keeps rules live).
 */
export function toolBindHash(entry: Pick<CapabilityEntry, 'id' | 'schema'>, cls: ToolBrokerClass, trustBinding: string): string {
  return sha256Tagged(canonicalJson({ entryId: entry.id, schemaSha256: sha256Tagged(canonicalJson(entry.schema)), class: cls, trust: trustBinding }));
}

/** Slice C5'a3: why a tool rule would not match now (status.rules[].paused; display only). */
export type ToolRulePause = 'untrusted' | 'changed' | 'server-off';

/** What toolRulePaused reads: the daemon's McpListCache, TrustBook and #mcp-servers enabled set. */
export interface ToolRulePauseSource {
  /** every listing in this daemon run under this label (McpListCache.listingsByLabel); null: not knowable */
  listed(label: string): ReadonlyArray<ListedIndex & { tools: Array<Record<string, unknown>> | null }> | null;
  /** the server's live trust (McpTrust.of): its binding, or null when it is not trusted */
  trust(id: string): { binding: string } | null;
  /** the server is on now (#mcp-servers enabled); null: not known */
  on(id: string): boolean | null;
}

/**
 * Slice C5'a3 (status.rules[].paused, display only: matching never reads it): why a tool rule would not match now.
 * Aegis L1: EVERY listing under the rule's label is judged (several ids sharing a label, the per-repo listings of one
 * server), each as: server-off (the server is not on), untrusted (no TrustBook entry, or its binding is not the
 * listing's), changed (no mutate or, slice C6'a2-1, destructive entry of the rule's tool in that listing has the
 * rule's bindHash under the live binding), match, or unknown (its on-state or its tools not known). A reason is reported only when EVERY listing
 * gives that same reason; any match, any unknown, mixed reasons, no listing, or a label whose listings are not all
 * known answer null (the field is omitted): never a guess.
 */
export function toolRulePaused(r: { match?: string; tool: string; bindHash?: string }, src: ToolRulePauseSource): ToolRulePause | null {
  if (r.match !== 'tool' || typeof r.bindHash !== 'string') return null;
  const m = /^mcp:([^/]+)\/(.+)$/.exec(r.tool);
  if (!m) return null;
  const [, label, toolName] = m as unknown as [string, string, string];
  const ls = src.listed(label);
  if (!ls || ls.length === 0) return null;
  const verdict = (l: ListedIndex & { tools: Array<Record<string, unknown>> | null }): ToolRulePause | 'match' | 'unknown' => {
    const on = src.on(l.id);
    if (on === null) return 'unknown';
    if (on === false) return 'server-off';
    const t = src.trust(l.id);
    if (!t || t.binding !== bindingOf({ id: l.id, launchHash: l.launchHash, pluginVersion: l.pluginVersion, toolsHash: l.toolsHash })) return 'untrusted';
    if (!l.tools) return 'unknown';
    // slice C6'a2-1: a destructive tool rule is judged the same way (its class is inside the bindHash)
    const now = narrow(l.tools, label, { trust: 'trusted' }).filter((e) => e.tool === toolName && (e.class === 'mutate' || e.class === 'destructive')).map((e) => toolBindHash(e, e.class, t.binding));
    return now.includes(r.bindHash!) ? 'match' : 'changed';
  };
  const all = new Set(ls.map(verdict));
  if (all.size !== 1) return null;
  const only = [...all][0]!;
  return only === 'match' || only === 'unknown' ? null : only;
}

export interface LocalToolBrokerOptions {
  hsid: string;
  /** the session principal (the card's requestedBy) */
  principalId: string;
  /** the session root composePermission shows (worktree, else cwd) */
  repo: string;
  /** a loop session: offered nothing, every call refused */
  loop: boolean;
  log: (kind: string, payload: Record<string, unknown>, ids?: { session?: string }) => Promise<void>;
  broker?: Broker;
  target: BrokerTarget;
  /** the offered set (offeredKernelTools); ignored for a loop session */
  tools: readonly BrokeredTool[];
  /** is the session still running (else not-running) */
  running: () => boolean;
  toolTimeoutMs?: number;
  cardTimeoutMs?: number;
  /** TEST SEAM: the clock */
  now?: () => number;
  /** Aegis N4: tell the child the call's effect started (LocalLane writes tool_progress{id, state:'running'}) */
  progress?: (id: string) => void;
  /** Aegis L2 (slice C2'): the session's run mode NOW is manual (a carded call to a target with no gate is refused) */
  manual?: () => boolean;
  /**
   * slice C5'a1: how much the kernel believes an MCP server's labels NOW (#local-mcp-client trustLive). A `read` narrow
   * tool (grace entries included) runs with no card ONLY while this answers trusted or first-party; otherwise it takes
   * a card like a mutate tool. Absent: no narrow tool is believed (fail closed).
   */
  trustLive?: (server: string) => ServerTrust;
  /** slice C5'a2: the repo's tool rules (absent: no rule matches and no card offers Always) */
  rules?: BrokeredRuleSource;
  /** slice C5'a2: the session's repo key (the rule scope; absent: no rule matches and no card offers Always) */
  repoKey?: string;
  /**
   * slice C5'a2: the server's live trust binding (#local-mcp-client trustBindingOf: the TrustBook binding of a trusted
   * server, a first-party marker for the staged pin, null otherwise). Absent or null: not ruleable.
   */
  trustBinding?: (server: string) => string | null;
  /**
   * slice C6'a2-1 (INJECTION PAUSE, founder): the session's current turn took in sent tool results or skill text. While
   * true, a destructive rule never passes a MODEL call (it takes the card); "/" runs are unaffected. Absent: never.
   */
  tainted?: () => boolean;
  /** slice C6'a2-1: the daemon's destructive-rule pass limits (absent: this broker's own) */
  destructiveBudget?: DestructiveRuleBudget;
}

/** Why a call's controller was aborted. */
type StopWhy = 'cancel' | 'deadline';

/** Aegis L1: the card's "not offered" line: plain names only (each ≤ 64 chars, at most 12), plus a count of the rest. */
export function droppedLine(dropped: readonly string[]): string[] {
  if (!dropped.length) return [];
  const plain = dropped.filter((d) => /^[A-Za-z_$][A-Za-z0-9_$.-]{0,63}$/.test(d)).slice(0, 12);
  const rest = dropped.length - plain.length;
  return [`not offered to the model: ${plain.join(', ')}${rest ? `${plain.length ? ' ' : ''}(+${rest} more)` : ''}`];
}

/** Slice C5'a1: the brokered MCP card's server line, one per trust level. */
export const TRUST_CARD_LINE: Readonly<Record<ServerTrust, string>> = Object.freeze({
  enabled: 'server: untrusted · Gnomon ignores its tool labels',
  trusted: 'server: trusted · Gnomon believes its tool labels; this call still asks',
  'first-party': "server: first-party · Gnomon's staged Paradigm server; this call still asks",
});

/** Slice C5'a2: the card line of a ruleable call (the scope an `always` on it takes). */
export const alwaysLine = (name: string): string => `Always: any call of ${name} in this repo, any arguments · paused if the tool or its server changes`;

/**
 * Slice C6'a2-1 (TD-2026-10-28-969): the card line of a destructive tool's Always (root class; no expiry). The names are
 * the kernel's (the entry's tool and the server label).
 */
export const destructiveAlwaysLine = (tool: string, server: string): string => `Always: any call of ${tool} on server ${server} in this repo, any arguments, by you from / AND by the model without asking. It can delete or overwrite. Paused if the tool or server changes.`;

/** Slice C4'a: `a` is the same capability entry as `b`, offered in another form. */
const formShadow = (a: BrokeredTool, b: BrokeredTool): boolean => a.entry !== undefined && b.entry !== undefined && a.entry.id === b.entry.id && (a.form ?? 'narrow') !== (b.form ?? 'narrow');

/** The namespaced name a brokered card shows (Aegis L6): never a Claude tool name composePermission special-cases. */
export const brokeredToolName = (target: Pick<BrokerTarget, 'provenance' | 'server'>, tool: string): string => (target.provenance === 'kernel' ? `kernel:${tool}` : `mcp:${target.server}/${tool}`);

export class LocalToolBroker {
  readonly #o: LocalToolBrokerOptions;
  #tools: readonly BrokeredTool[];
  /** slice C3' (Aegis M3): the previous offered set, callable until the child acknowledges tools_set #graceAck */
  #grace: readonly BrokeredTool[] = [];
  #graceAck: string | null = null;
  readonly #inflight = new Map<string, { ctl: AbortController; carded: boolean; ruled?: boolean; human?: boolean }>();
  /** Slice C6'a2-1: when the session's recent "/" runs arrived (HUMAN_RUNS_PER_MINUTE) */
  readonly #humanRuns: number[] = [];
  readonly #destructiveBudget: DestructiveRuleBudget;
  /** Slice C5'a2: when the session's recent rule-passed calls arrived */
  readonly #ruled: number[] = [];
  /** Aegis M4: `${tool}\0${argsHash}` → until (epoch ms) */
  readonly #cooldown = new Map<string, number>();
  readonly #denies: number[] = [];
  #suspended = false;
  /** Aegis N1: when the session's recent carded requests arrived */
  readonly #carded: number[] = [];
  /** Aegis N3: the last interrupt (cancelAll); a request received at or before it is cancelled */
  #interruptedAt = -Infinity;

  constructor(o: LocalToolBrokerOptions) {
    this.#o = o;
    this.#destructiveBudget = o.destructiveBudget ?? new DestructiveRuleBudget();
    // ^loop-origin-clamp: a loop session gets no brokered tools at all
    this.#tools = o.loop ? [] : o.tools.map((t) => ({ ...t, parameters: structuredClone(t.parameters) }));
  }

  /**
   * slice C2': replace the offered set (a server's notifications/tools/list_changed). A loop session stays empty. A
   * call already in flight keeps the tool it resolved.
   */
  setTools(tools: readonly BrokeredTool[], o: { ackId?: string } = {}): void {
    if (this.#o.loop) return;
    const next = tools.map((t) => ({ ...t, parameters: structuredClone(t.parameters) }));
    if (o.ackId !== undefined) {
      // slice C3' (Aegis M3): the child applies a tools_set from its next step and says so with tools_applied{id}; until
      // then its current step still offers the set the kernel offered before. Those tools stay callable (union) until
      // the ack, never a name the new set holds (the new entry wins), and every call still runs the full validation,
      // class gate and manual check
      // slice C4'a: a tier change can re-offer the SAME entry in another form; until the ack the child still offers the
      // previous form, so that grace entry stays (formShadow) and wins its name while the ack is pending
      this.#grace = [...this.#tools, ...this.#grace].filter((t, i, a) => a.findIndex((x) => x.name === t.name) === i && !next.some((n) => n.name === t.name && !formShadow(t, n)));
      this.#graceAck = o.ackId;
    } else this.clearGrace();
    this.#tools = next;
  }

  /** Slice C3' (Aegis M3): the child applied tools_set `id`: the previous set's grace ends (only for the latest id). */
  ackTools(id: string): void {
    if (id === this.#graceAck) this.clearGrace();
  }

  /** Slice C3' (Aegis M3): no previous set is callable any more (agent_start, an ack, a list_changed reset). */
  clearGrace(): void {
    this.#grace = [];
    this.#graceAck = null;
  }

  /** Slice C3' (Aegis M3): drop grace tools a list_changed removed or changed, or whose server is gone. */
  pruneGrace(keep: (t: BrokeredTool) => boolean): void {
    this.#grace = this.#grace.filter(keep);
  }

  /**
   * The tool a request names: the current set's, else the previous set's (until the ack); slice C4'a: while the ack is
   * pending, a previous-set entry that is the same capability in another form wins (the child still offers that form).
   */
  #resolve(name: string): BrokeredTool | undefined {
    const cur = this.#tools.find((t) => t.name === name);
    const prev = this.#grace.find((t) => t.name === name);
    if (cur && prev && this.#graceAck !== null && formShadow(prev, cur)) return prev;
    return cur ?? prev;
  }

  /** What tools_set offers (empty for a loop session). */
  get offered(): readonly BrokeredTool[] {
    return this.#tools;
  }

  /** Slice C3': the previous set still callable until the child's ack (tests, hash-only logging). */
  get grace(): readonly BrokeredTool[] {
    return this.#grace;
  }

  get inflight(): number {
    return this.#inflight.size;
  }

  get suspended(): boolean {
    return this.#suspended;
  }

  #now(): number {
    return this.#o.now?.() ?? Date.now();
  }

  /** The session aborted, stopped or exited: every call in flight is cancelled (its card expires, the target never runs). */
  cancelAll(): void {
    this.#interruptedAt = this.#now();
    for (const { ctl } of this.#inflight.values()) ctl.abort('cancel' satisfies StopWhy);
  }

  /** Aegis M1: the child's tool_cancel{id} (its timeout or abort). Only removes privilege. */
  cancel(id: string): boolean {
    const c = this.#inflight.get(id);
    // slice C6'a2-1: the child never cancels the human's "/" run (its id is not the child's)
    if (c?.human) return false;
    if (c && !c.ctl.signal.aborted) {
      c.ctl.abort('cancel' satisfies StopWhy);
      // Aegis N1: a carded call the child walks away from counts toward the suspension (a request/cancel loop); a call an
      // Always rule passed raised no card
      if (c.carded && !c.ruled) this.#strike();
    }
    return c !== undefined;
  }

  #denied(key: string): void {
    const now = this.#now();
    this.#cooldown.set(key, now + DENY_COOLDOWN_MS);
    if (this.#cooldown.size > 256) this.#cooldown.delete(this.#cooldown.keys().next().value as string);
    this.#strike();
  }

  /** One deny (or a cancelled card) inside the window; SUSPEND_AFTER_DENIES of them suspend the session. */
  #strike(): void {
    const now = this.#now();
    this.#denies.push(now);
    while (this.#denies.length && this.#denies[0]! < now - SUSPEND_WINDOW_MS) this.#denies.shift();
    if (this.#denies.length >= SUSPEND_AFTER_DENIES) this.#suspended = true;
  }

  /** $local-brokered-call: one tool_request → its tool_response (never throws; every path logs one row). */
  handle(req: ToolRequestIn): Promise<ToolResponseOut> {
    return this.#call(req, { author: 'model' });
  }

  /**
   * Slice C6'a2-1 ("/" runs): the HUMAN runs one capability entry of the session's index from "/" (LocalLane's
   * request.session.tools.run, which resolved the entry, its target and the form). The same validation, class gate,
   * trust, rules and log row as a model call (author 'human'), except: no cooldown, suspension or deny strike from it
   * (the human's denies never count against the model), its own HUMAN_RUNS_PER_MINUTE bucket, never refused for manual
   * mode (it is the human's own run; its card still asks), and never paused by a tainted turn. `onCarded` hears the
   * card's id as soon as it is raised (the request answers `carded` and the result is read later).
   */
  runHuman(r: HumanRunIn): Promise<ToolResponseOut> {
    const tool: BrokeredTool = { name: r.entry.name, description: r.entry.description, parameters: r.entry.parameters, class: r.entry.class, entry: r.entry, target: r.target, form: r.form };
    return this.#call({ id: `run:${r.runId}`, toolCallId: null, name: r.entry.name, args: r.args, error: null }, { author: 'human', tool, ...(r.onCarded ? { onCarded: r.onCarded } : {}) });
  }

  async #call(req: ToolRequestIn, how: { author: 'model' | 'human'; tool?: BrokeredTool; onCarded?: (cardId: string) => void }): Promise<ToolResponseOut> {
    const o = this.#o;
    const human = how.author === 'human';
    const argsHash = inputHash(req.args ?? null);
    const tool = human ? how.tool : req.name !== null ? this.#resolve(req.name) : undefined;
    const target = tool?.target ?? o.target;
    // slice C5'a1: the class the kernel treats the call as (a read narrow tool of a server no longer believed: mutate)
    let cls: ToolBrokerClass | undefined = tool?.class;
    const done = async (decision: ToolBrokeredDecision, content: string, isError: boolean, cardId?: string): Promise<ToolResponseOut> => {
      // a human-only entry's name may not fit the row's tool pattern: then the row names no tool (and no class)
      const named = tool !== undefined && TOOL_BROKER_TOOL_PATTERN.test(tool.name);
      await o.log('tool.brokered', { hsid: o.hsid, server: target.server, ...(tool && named ? { tool: tool.name, class: cls ?? tool.class } : {}), argsHash, decision, bytes: Buffer.byteLength(content, 'utf8'), isError, ...(cardId ? { cardId } : {}), ...(human ? { author: 'human' } : {}) }, { session: o.hsid }).catch(() => undefined);
      return { id: req.id, content, isError, provenance: target.provenance, decision, ...(cardId ? { cardId } : {}) };
    };
    if (o.loop) return done('loop-session', 'Loop sessions never run brokered tools.', true);
    if (this.#inflight.has(req.id)) return done('bad-args', `request ${req.id} is already in flight`, true);
    if (!tool) return done('unknown-tool', `unknown tool ${String(req.name ?? '').slice(0, 64)}`, true);
    if (req.error !== null || req.args === null) return done('bad-args', `${tool.name}: ${req.error ?? 'arguments must be a JSON object'}`, true);
    if (!o.running()) return done('not-running', 'The session is not running.', true);
    if (!human && req.receivedAt !== undefined && req.receivedAt <= this.#interruptedAt) return done('cancelled', 'cancelled: the session was interrupted after this call was sent', true);
    if (!human && this.#suspended) return done('suspended', 'Brokered tools are suspended for this session after repeated denies.', true);
    // slice C2' (G-LCL-16): a narrow tool's args are reassembled (the op fixed by the kernel, never the model's) and the
    // RESULT is validated against the FULL schema (its patterns through the safe-regex gate); a refusal never runs
    let callArgs: Record<string, unknown> = req.args;
    if (tool.entry) {
      // slice C4'a: the form it was offered in decides how its args are read (a full-form call: an op key refused, the
      // op set, the full schema)
      const r = tool.form === 'full' ? reassembleFull(tool.entry, req.args) : reassemble(tool.entry, req.args);
      if ('error' in r) return done('bad-args', `${tool.name}: ${r.error}`, true);
      callArgs = r.args;
    }
    const bad = validateBrokeredArgs(tool.entry ? tool.entry.schema : tool.parameters, callArgs);
    if (bad) return done('bad-args', `${tool.name}: ${bad}`, true);
    const key = `${tool.name}\u0000${argsHash}`;
    if (!human && (this.#cooldown.get(key) ?? 0) > this.#now()) return done('cooldown', `${tool.name} with these arguments was just denied: ask the human differently or wait.`, true);
    // slice C5'a1 (Arky 4): a narrow tool's class came from the server's own labels only if the server was trusted when
    // it was narrowed; it is believed NOW only while trustLive says so (the resolved tool, grace entries included)
    const level: ServerTrust | null = tool.entry && !target.ownsGate ? (o.trustLive?.(target.server) ?? 'enabled') : null;
    if (tool.class === 'read' && level === 'enabled') cls = 'mutate';
    const carded = cls !== 'read';
    const trustedRead = !carded && level !== null;
    const manualNow = o.manual?.() === true;
    // Aegis L2: manual mode is read at call time too (the human may have switched since open); a "/" run is the human's
    if (!human && carded && !target.ownsGate && manualNow) return done('refused', `${tool.name}: this session is in manual mode, so calls that need the human are off.`, true);
    // slice C5'a2 (^local-tool-grant): a mutate narrow tool of a server trusted NOW is ruleable; slice C6'a2-1: a
    // destructive one too (never read, a kernel verb, an untrusted server, manual mode or a loop session)
    const ruleName = tool.entry ? brokeredToolName(target, tool.entry.tool) : null;
    const ruleClass: 'mutate' | 'destructive' | null = cls === 'mutate' || cls === 'destructive' ? cls : null;
    const trustBinding = carded && ruleClass !== null && tool.entry && !target.ownsGate && !manualNow && (level === 'trusted' || level === 'first-party') && o.rules && typeof o.repoKey === 'string' ? (o.trustBinding?.(target.server) ?? null) : null;
    const bound = trustBinding !== null && tool.entry && ruleClass !== null ? { bindHash: toolBindHash(tool.entry, ruleClass, trustBinding), repoKey: o.repoKey! } : null;
    // slice C6'a2-1 (TD-2026-10-28-969): an Always on a destructive tool is root class, whose `permission` row table needs
    // helper 1.10.0: asked FIRST, so an older helper is offered allow | deny only (the raise never refuses the card)
    let offerAlways = bound !== null && ruleName !== null;
    if (offerAlways && ruleClass === 'destructive') offerAlways = typeof o.broker?.rootTableReady === 'function' && (await o.broker.rootTableReady('permission', {}).catch(() => false));
    let ruleId: string | null = null;
    // INJECTION PAUSE (founder, TD-2026-10-28-969): in a turn that took in sent tool results or skill text, a destructive
    // rule never passes a MODEL call (it takes the card); the human's "/" runs are unaffected
    const paused = ruleClass === 'destructive' && !human && o.tainted?.() === true;
    if (bound && ruleName && ruleClass && !paused && typeof o.broker?.auto === 'function') {
      try {
        ruleId = o.rules!.match(bound.repoKey, ruleName, bound.bindHash, ruleClass)?.ruleId ?? null;
      } catch {
        ruleId = null; // an unreadable rule source never allows
      }
    }
    // slice C6'a2-1 (founder): a destructive rule passes at most DESTRUCTIVE_RULED_PER_SESSION_MINUTE calls per session
    // per minute and DESTRUCTIVE_RULED_PER_RULE_DAY per rule per day; past either, the call takes its card
    if (ruleId !== null && ruleClass === 'destructive' && !this.#destructiveBudget.take(o.hsid, ruleId, this.#now())) ruleId = null;
    {
      const now = this.#now();
      const bucket = human ? this.#humanRuns : ruleId !== null ? this.#ruled : carded ? this.#carded : null;
      const cap = human ? HUMAN_RUNS_PER_MINUTE : ruleId !== null ? RULED_PER_MINUTE : CARDED_PER_MINUTE;
      if (bucket) {
        while (bucket.length && bucket[0]! <= now - 60_000) bucket.shift();
        if (bucket.length >= cap) return done('busy', human ? `At most ${HUMAN_RUNS_PER_MINUTE} "/" runs per minute: wait a moment.` : ruleId !== null ? `At most ${RULED_PER_MINUTE} calls an Always rule passes per minute: wait a moment.` : `At most ${CARDED_PER_MINUTE} calls that need the human per minute: wait a moment.`, true);
        bucket.push(now);
      }
    }
    if (this.#inflight.size >= MAX_BROKERED_IN_FLIGHT || (carded && [...this.#inflight.values()].filter((x) => x.carded).length >= MAX_CARDED_IN_FLIGHT)) return done('busy', carded ? 'Another call that needs the human is already waiting: wait for it.' : `This session already has ${this.#inflight.size} brokered calls in flight: wait for them.`, true);
    const ctl = new AbortController();
    // slice C5'a2: a call an Always rule passes waits for no human: the tool timeout
    const ms = carded && ruleId === null ? (o.cardTimeoutMs ?? CARD_TIMEOUT_MS) : (o.toolTimeoutMs ?? TOOL_TIMEOUT_MS);
    // Aegis M1: counted from the line's receipt, ending before the child's own timer
    const deadline = (req.receivedAt ?? this.#now()) + ms - Math.min(DEADLINE_MARGIN_MS, Math.floor(ms / 2));
    const timer = setTimeout(() => ctl.abort('deadline' satisfies StopWhy), Math.max(0, deadline - this.#now()));
    timer.unref?.();
    this.#inflight.set(req.id, { ctl, carded, ...(ruleId !== null ? { ruled: true } : {}), ...(human ? { human: true } : {}) });
    const stopped = (cardAllowed: boolean, cardId?: string): Promise<ToolResponseOut> =>
      done(cardAllowed ? 'allowed-cancelled' : ctl.signal.reason === 'deadline' ? 'expired' : 'cancelled', ctl.signal.reason === 'deadline' ? 'expired: the call passed its deadline before it ran' : 'cancelled: the call was aborted before it ran', true, cardId);
    try {
      let cardId: string | undefined;
      let allowed = false;
      if (ruleId !== null) {
        // slice C5'a2: log-before-effect: no approval.auto row, no run (the call is refused, never left unanswered)
        try {
          await o.broker!.auto!({ hsid: o.hsid, tool: ruleName!, inputHash: inputHash(callArgs), modeRef: `rule:${ruleId}` });
        } catch {
          return done('refused', `${tool.name}: not run: the kernel could not record the Always rule that would pass it.`, true);
        }
        allowed = true;
      } else if (carded && !target.ownsGate) {
        const d = await this.#card(tool, target, req, callArgs, deadline, ctl.signal, cls ?? tool.class, level, offerAlways ? bound : null, { author: how.author, ...(how.onCarded ? { onRaised: how.onCarded } : {}) });
        cardId = d.cardId ?? undefined;
        if (d.decision === 'none') return done('no-approval-surface', 'No approval surface could take the card: not run.', true, cardId);
        if (d.decision === 'stopped') return stopped(false, cardId);
        if (d.decision === 'too-large') return done('bad-args', `${tool.name}: the request is too large to show in full on a card`, true);
        // Arky 1 (C5'a2): `always` allows this call too (and learned the rule); anything else is a deny
        if (d.decision !== 'allow' && d.decision !== 'always') {
          // slice C6'a2-1: the human's own denies never count toward the model's cooldown or suspension
          if (!human) this.#denied(key);
          return done('denied', 'The human did not approve this call.', true, cardId);
        }
        allowed = true;
      }
      if (ctl.signal.aborted) return stopped(allowed, cardId);
      let running = false;
      const onRunning = (): void => {
        if (running) return;
        running = true;
        // Aegis N4: the effect started: the kernel deadline no longer applies, and the child extends its wait
        clearTimeout(timer);
        if (!human) o.progress?.(req.id);
      };
      if (!target.ownsGate) onRunning();
      let r: { text: string; isError: boolean; why?: string; cardId?: string };
      try {
        r = await target.call(tool.entry ? tool.entry.tool : tool.name, callArgs, { signal: ctl.signal, deadline, onRunning, ...(trustedRead || ruleId !== null ? { trustedRead: true } : {}) });
      } catch (err) {
        r = { text: `the ${tool.name} call failed: ${(err as Error).message.slice(0, 200)}`, isError: true };
      }
      cardId = cardId ?? r.cardId;
      const text = shapeBrokeredResult(r.text);
      // Aegis N2: the decision follows the target's closed reason; `approved` only for a call that succeeded
      if (r.why === 'cancelled') return stopped(false, cardId);
      if (r.why === 'denied' || r.why === 'secret-in-push') {
        if (!human) this.#denied(key);
        return done('denied', text, true, cardId);
      }
      const mapped: Record<string, ToolBrokeredDecision> = { 'no-approval-surface': 'no-approval-surface', busy: 'busy', 'bad-input': 'bad-args', 'loop-session': 'loop-session', 'trust-dropped': 'refused' };
      if (r.why !== undefined && Object.hasOwn(mapped, r.why)) return done(mapped[r.why]!, text, true, cardId);
      if (r.isError && (carded || target.ownsGate)) return done('refused', text, true, cardId);
      return done(carded ? 'approved' : 'ran', text, r.isError, cardId);
    } finally {
      clearTimeout(timer);
      this.#inflight.delete(req.id);
    }
  }

  /**
   * Step 3 (a target with no gate of its own): the card, every argument shown, allow | deny, expired on stop. Slice
   * C5'a2: a ruleable call's card also offers always (scope {kind:'tool'}): a ruleScope, detail.toolScopes and
   * detail.brokered.bindHash, inside the contentHash.
   */
  async #card(tool: BrokeredTool, target: BrokerTarget, req: ToolRequestIn, callArgs: Record<string, unknown>, deadline: number, signal: AbortSignal, cls: ToolBrokerClass, level: ServerTrust | null, always: { bindHash: string; repoKey: string } | null, ctx: { author: 'model' | 'human'; onRaised?: (cardId: string) => void }): Promise<{ decision: string; cardId: string | null }> {
    const o = this.#o;
    const b = o.broker;
    if (!b || typeof b.decisionOf !== 'function') return { decision: 'none', cardId: null };
    // slice C2': a narrow tool's card names the server's own tool (mcp:<server>/<tool>) and shows the REASSEMBLED call
    // (the op the kernel fixed included): exactly what will run
    const name = brokeredToolName(target, tool.entry ? tool.entry.tool : tool.name);
    const plan = composePermission({ requestId: req.id, toolName: name, toolUseId: req.toolCallId, input: callArgs }, { repo: o.repo, denyWrite: [] });
    if (plan.kind !== 'card') return { decision: 'too-large', cardId: null };
    const destructive = cls === 'destructive';
    const human = ctx.author === 'human';
    const who = human ? `a "/" run you started in this local session, to ${target.server}` : `a brokered call from this local session to ${target.server}`;
    const lines = [...plan.lines, `class: ${cls} · ${who}`, ...(level ? [TRUST_CARD_LINE[level]] : []), ...droppedLine(tool.entry?.dropped ?? []), ...(always ? [destructive ? destructiveAlwaysLine(tool.entry ? tool.entry.tool : tool.name, target.server) : alwaysLine(name)] : [])];
    // slice C6'a2-1: detail.brokered.author marks a "/" run (free detail, inside the contentHash)
    const detail = { ...plan.detail, brokered: { server: target.server, tool: tool.name, class: cls, argsHash: inputHash(callArgs), ...(tool.entry ? { id: tool.entry.id } : {}), ...(level ? { trust: level === 'enabled' ? 'untrusted' : level } : {}), ...(always ? { bindHash: always.bindHash } : {}), ...(human ? { author: 'human' } : {}) }, ...(always ? { toolScopes: ['tool'] } : {}) };
    // slice C5'a3: a {type:'tool-scope', detail} node (like permission.ts edit-scope) carries the card's FULL detail, the
    // one the contentHash covers: what the kernel offered (toolScopes, the tool, its server, the trust level, bindHash),
    // so the GUI can verify it. Display only: the block is not hashed, and the text lines are the same as before
    const shown = blockOf(lines).block;
    const block = { ...shown, children: [...((shown.children as unknown[]) ?? []), { type: 'tool-scope', detail: structuredClone(detail) }] };
    let cardId: string;
    try {
      // the broker's own timeout falls after the deadline, so the kernel's deadline (expired) always wins the race
      // slice C6'a2-1 (TD-2026-10-28-969): EVERY destructive brokered card is irreversible (allow takes fresh presence,
      // never a cached unlock or a standing grant), and its Always is root class (rootRows [], the `permission` table)
      const c = await b.raise({ kind: 'permission', requestedBy: o.principalId, hsid: o.hsid, attended: true, detail, lines, block, toolInput: callArgs, tool: name, decisions: always ? ['allow', 'deny', 'always'] : ['allow', 'deny'], ...(always ? { ruleScope: { repoKey: always.repoKey } } : {}), ...(destructive ? { flags: ['irreversible'] } : {}), ...(destructive && always ? { rootDecisions: ['always'] } : {}), timeoutMs: Math.max(1000, deadline - this.#now() + 5_000) });
      cardId = c.cardId;
      try {
        ctx.onRaised?.(cardId);
      } catch {
        /* a listener never breaks the card */
      }
    } catch {
      return { decision: 'none', cardId: null };
    }
    let onStop: (() => void) | undefined;
    const stop = new Promise<string>((resolve) => {
      onStop = () => resolve('stopped');
      if (signal.aborted) return onStop();
      signal.addEventListener('abort', onStop, { once: true });
    });
    let decision: string;
    try {
      decision = await Promise.race([b.decisionOf(cardId), stop]);
    } catch {
      decision = 'deny';
    } finally {
      if (onStop) signal.removeEventListener('abort', onStop);
    }
    if (decision === 'stopped') await b.expire?.(cardId, signal.reason === 'deadline' ? 'expired' : 'cancelled').catch(() => false);
    return { decision, cardId };
  }
}
