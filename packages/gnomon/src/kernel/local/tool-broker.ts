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
 * GAPS left for C2'/C5' (documented in .purpose): no capability index or
 * narrowing beyond the worktree drop and manual mode; no Always/standing
 * grants for brokered tools; no per-server trust tiers (mcp:<server> is
 * plumbed, no MCP target yet); the suspension notice is the tool.brokered row
 * (no GUI notice yet); control characters are refused outright (no newline in
 * brokered args).
 */
import type { ToolBrokerClass, ToolBrokeredDecision } from '@a-company/gnomon-contracts';
import type { ApprovalBroker } from '../broker/broker.js';
import type { GitVerbs, VerbSession } from '../git/kernel-verbs.js';
import { KERNEL_MCP_SERVER } from '../git/verbs.js';
import { kernelMcpAnswer } from '../supervisor/kernel-mcp.js';
import { composePermission, inputHash } from '../supervisor/permission.js';

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
/** The full-schema bounds (step 2). */
export const ARG_LIMITS = Object.freeze({ bytes: 16 * 1024, string: 4096, array: 64, depth: 6, keys: 64 });
/** The most chars of a result sent back (the child caps again under its own budget). */
export const RESULT_MAX_CHARS = 64 * 1024;

export interface BrokeredTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  class: ToolBrokerClass;
}

export interface TargetCall {
  signal: AbortSignal;
  /** epoch ms */
  deadline: number;
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
  call(name: string, args: Record<string, unknown>, o: TargetCall): Promise<{ text: string; isError: boolean; why?: string }>;
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
        return v ? { ...v, local: true, signal: o.signal, deadline: o.deadline } : null;
      };
      const r = await rpc('tools/call', { name, arguments: args }, s);
      if (isObj(r.error)) return { text: typeof r.error.message === 'string' ? r.error.message : 'the kernel tool call failed', isError: true };
      const res = isObj(r.result) ? r.result : {};
      const text = Array.isArray(res.content) ? res.content.filter(isObj).map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n') : '';
      const meta = isObj(res._meta) ? res._meta : {};
      return { text, isError: res.isError === true, ...(typeof meta['gnomon/why'] === 'string' ? { why: meta['gnomon/why'] } : {}) };
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
}

type Broker = Pick<ApprovalBroker, 'raise'> & Partial<Pick<ApprovalBroker, 'decisionOf' | 'expire'>>;

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
}

/** Why a call's controller was aborted. */
type StopWhy = 'cancel' | 'deadline';

/** The namespaced name a brokered card shows (Aegis L6): never a Claude tool name composePermission special-cases. */
export const brokeredToolName = (target: Pick<BrokerTarget, 'provenance' | 'server'>, tool: string): string => (target.provenance === 'kernel' ? `kernel:${tool}` : `mcp:${target.server}/${tool}`);

export class LocalToolBroker {
  readonly #o: LocalToolBrokerOptions;
  readonly #tools: readonly BrokeredTool[];
  readonly #inflight = new Map<string, { ctl: AbortController; carded: boolean }>();
  /** Aegis M4: `${tool}\0${argsHash}` → until (epoch ms) */
  readonly #cooldown = new Map<string, number>();
  readonly #denies: number[] = [];
  #suspended = false;

  constructor(o: LocalToolBrokerOptions) {
    this.#o = o;
    // ^loop-origin-clamp: a loop session gets no brokered tools at all
    this.#tools = o.loop ? [] : o.tools.map((t) => ({ ...t, parameters: structuredClone(t.parameters) }));
  }

  /** What tools_set offers (empty for a loop session). */
  get offered(): readonly BrokeredTool[] {
    return this.#tools;
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
    for (const { ctl } of this.#inflight.values()) ctl.abort('cancel' satisfies StopWhy);
  }

  /** Aegis M1: the child's tool_cancel{id} (its timeout or abort). Only removes privilege. */
  cancel(id: string): boolean {
    const c = this.#inflight.get(id);
    c?.ctl.abort('cancel' satisfies StopWhy);
    return c !== undefined;
  }

  #denied(key: string): void {
    const now = this.#now();
    this.#cooldown.set(key, now + DENY_COOLDOWN_MS);
    if (this.#cooldown.size > 256) this.#cooldown.delete(this.#cooldown.keys().next().value as string);
    this.#denies.push(now);
    while (this.#denies.length && this.#denies[0]! < now - SUSPEND_WINDOW_MS) this.#denies.shift();
    if (this.#denies.length >= SUSPEND_AFTER_DENIES) this.#suspended = true;
  }

  /** $local-brokered-call: one tool_request → its tool_response (never throws; every path logs one row). */
  async handle(req: ToolRequestIn): Promise<ToolResponseOut> {
    const o = this.#o;
    const argsHash = inputHash(req.args ?? null);
    const tool = req.name !== null ? this.#tools.find((t) => t.name === req.name) : undefined;
    const done = async (decision: ToolBrokeredDecision, content: string, isError: boolean, cardId?: string): Promise<ToolResponseOut> => {
      await o.log('tool.brokered', { hsid: o.hsid, server: o.target.server, ...(tool ? { tool: tool.name, class: tool.class } : {}), argsHash, decision, bytes: Buffer.byteLength(content, 'utf8'), isError, ...(cardId ? { cardId } : {}) }, { session: o.hsid }).catch(() => undefined);
      return { id: req.id, content, isError, provenance: o.target.provenance };
    };
    if (o.loop) return done('loop-session', 'Loop sessions never run brokered tools.', true);
    if (this.#inflight.has(req.id)) return done('bad-args', `request ${req.id} is already in flight`, true);
    if (!tool) return done('unknown-tool', `unknown tool ${String(req.name ?? '').slice(0, 64)}`, true);
    if (req.error !== null || req.args === null) return done('bad-args', `${tool.name}: ${req.error ?? 'arguments must be a JSON object'}`, true);
    if (!o.running()) return done('not-running', 'The session is not running.', true);
    if (this.#suspended) return done('suspended', 'Brokered tools are suspended for this session after repeated denies.', true);
    const bad = validateBrokeredArgs(tool.parameters, req.args);
    if (bad) return done('bad-args', `${tool.name}: ${bad}`, true);
    const key = `${tool.name}\u0000${argsHash}`;
    if ((this.#cooldown.get(key) ?? 0) > this.#now()) return done('cooldown', `${tool.name} with these arguments was just denied: ask the human differently or wait.`, true);
    const carded = tool.class !== 'read';
    if (this.#inflight.size >= MAX_BROKERED_IN_FLIGHT || (carded && [...this.#inflight.values()].filter((x) => x.carded).length >= MAX_CARDED_IN_FLIGHT)) return done('busy', carded ? 'Another call that needs the human is already waiting: wait for it.' : `This session already has ${this.#inflight.size} brokered calls in flight: wait for them.`, true);
    const ctl = new AbortController();
    const ms = carded ? (o.cardTimeoutMs ?? CARD_TIMEOUT_MS) : (o.toolTimeoutMs ?? TOOL_TIMEOUT_MS);
    // Aegis M1: counted from the line's receipt, ending before the child's own timer
    const deadline = (req.receivedAt ?? this.#now()) + ms - Math.min(DEADLINE_MARGIN_MS, Math.floor(ms / 2));
    const timer = setTimeout(() => ctl.abort('deadline' satisfies StopWhy), Math.max(0, deadline - this.#now()));
    timer.unref?.();
    this.#inflight.set(req.id, { ctl, carded });
    const stopped = (cardAllowed: boolean, cardId?: string): Promise<ToolResponseOut> =>
      done(cardAllowed ? 'allowed-cancelled' : ctl.signal.reason === 'deadline' ? 'expired' : 'cancelled', ctl.signal.reason === 'deadline' ? 'expired: the call passed its deadline before it ran' : 'cancelled: the call was aborted before it ran', true, cardId);
    try {
      let cardId: string | undefined;
      let allowed = false;
      if (carded && !o.target.ownsGate) {
        const d = await this.#card(tool, req, deadline, ctl.signal);
        cardId = d.cardId ?? undefined;
        if (d.decision === 'none') return done('no-approval-surface', 'No approval surface could take the card: not run.', true, cardId);
        if (d.decision === 'stopped') return stopped(false, cardId);
        if (d.decision === 'too-large') return done('bad-args', `${tool.name}: the request is too large to show in full on a card`, true);
        if (d.decision !== 'allow') {
          this.#denied(key);
          return done('denied', 'The human did not approve this call.', true, cardId);
        }
        allowed = true;
      }
      if (ctl.signal.aborted) return stopped(allowed, cardId);
      let r: { text: string; isError: boolean; why?: string };
      try {
        r = await o.target.call(tool.name, req.args, { signal: ctl.signal, deadline });
      } catch (err) {
        r = { text: `the ${tool.name} call failed: ${(err as Error).message.slice(0, 200)}`, isError: true };
      }
      if (r.why === 'cancelled') return stopped(false, cardId);
      if (r.why === 'denied' || r.why === 'secret-in-push') {
        this.#denied(key);
        return done('denied', shapeBrokeredResult(r.text), true, cardId);
      }
      return done(carded ? 'approved' : 'ran', shapeBrokeredResult(r.text), r.isError, cardId);
    } finally {
      clearTimeout(timer);
      this.#inflight.delete(req.id);
    }
  }

  /** Step 3 (a target with no gate of its own): the card, every argument shown, allow | deny, expired on stop. */
  async #card(tool: BrokeredTool, req: ToolRequestIn, deadline: number, signal: AbortSignal): Promise<{ decision: string; cardId: string | null }> {
    const o = this.#o;
    const b = o.broker;
    if (!b || typeof b.decisionOf !== 'function') return { decision: 'none', cardId: null };
    const name = brokeredToolName(o.target, tool.name);
    const plan = composePermission({ requestId: req.id, toolName: name, toolUseId: req.toolCallId, input: req.args! }, { repo: o.repo, denyWrite: [] });
    if (plan.kind !== 'card') return { decision: 'too-large', cardId: null };
    const lines = [...plan.lines, `class: ${tool.class} · a brokered call from this local session to ${o.target.server}`];
    const detail = { ...plan.detail, brokered: { server: o.target.server, tool: tool.name, class: tool.class, argsHash: inputHash(req.args) } };
    let cardId: string;
    try {
      // the broker's own timeout falls after the deadline, so the kernel's deadline (expired) always wins the race
      const c = await b.raise({ kind: 'permission', requestedBy: o.principalId, hsid: o.hsid, attended: true, detail, lines, toolInput: req.args!, tool: name, decisions: ['allow', 'deny'], timeoutMs: Math.max(1000, deadline - this.#now() + 5_000) });
      cardId = c.cardId;
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
