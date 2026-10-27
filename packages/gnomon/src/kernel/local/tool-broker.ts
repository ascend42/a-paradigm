/**
 * @symbol #local-tool-broker
 * @symbol $local-brokered-call
 *
 * #local-tool-broker (TD-2026-10-27-833 slice C1; T-2026-10-26-003): the
 * kernel half of a local session's BROKERED tools. The child (gnomon-local
 * broker.ts) emits `tool_request{id, toolCallId, name, args}`; LocalLane hands
 * it here and writes the `tool_response{id, content, isError, provenance}`
 * this returns. $local-brokered-call, one call:
 *   1. resolve the name in the session's OFFERED set (else unknown-tool);
 *      a loop session is offered nothing and refused loop-session;
 *   2. validate the args against the FULL schema (validateBrokeredArgs):
 *      unknown keys refused whatever the schema says, types / required /
 *      enum, strings <= min(maxLength, ARG_STRING_MAX), arrays <=
 *      min(maxItems, ARG_ARRAY_MAX), depth and total size capped, and no C0/C1
 *      control or bidi character in any key or string (G-LCL-15: refused args
 *      never reach the target);
 *   3. the grant class (C1, minimal; Aegis owns the full design in C5'):
 *      `read` runs; `mutate` and `destructive` raise a `permission` card
 *      through broker.raise with composePermission's lines (every argument
 *      shown, fenced) and allow | deny only (no Always); no broker or no
 *      decisionOf ⇒ no-approval-surface;
 *   4. call the target — C1's only target is the kernel's own SDK server
 *      (kernelSdkTarget → kernelMcpAnswer, provenance `kernel`). A call
 *      cancelled (the session's abort, its exit) or past its deadline
 *      (TOOL_TIMEOUT_MS read / CARD_TIMEOUT_MS card, the same numbers the
 *      child waits) before the target runs never runs it; a pending card is
 *      expired;
 *   5. shape the result: NULs dropped, capped at RESULT_MAX_CHARS with a
 *      note (the child shapes again under its own cap and labels it);
 *   6. log ONE hash-only `tool.brokered{hsid, server, tool?, class?, argsHash,
 *      decision, bytes, isError, cardId?}` row (contracts 8.0:local-lane) and
 *      reply.
 * GAPS left for C2'/C5' (documented in .purpose): no capability index or
 * narrowing beyond dropping tools a local session can never run; the kernel
 * verbs keep their own gate, so a mutate/destructive kernel verb shows the
 * brokered card AND the verb's card (git.push always raises one); no
 * Always/standing grants for brokered tools; no per-class trust labels in the
 * row; a call whose card is approved just before the child's deadline may
 * still run after the child gave up.
 */
import { createHash } from 'node:crypto';
import type { ToolBrokerClass, ToolBrokeredDecision } from '@a-company/gnomon-contracts';
import type { ApprovalBroker } from '../broker/broker.js';
import type { GitVerbs, VerbSession } from '../git/kernel-verbs.js';
import { KERNEL_MCP_SERVER } from '../git/verbs.js';
import { kernelMcpAnswer } from '../supervisor/kernel-mcp.js';
import { composePermission, inputHash } from '../supervisor/permission.js';

/** The same deadlines the child waits (gnomon-local broker.ts TOOL_TIMEOUT_MS / CARD_TIMEOUT_MS). */
export const TOOL_TIMEOUT_MS = 30_000;
export const CARD_TIMEOUT_MS = 5 * 60_000;
/** Brokered calls one session may have in flight; past it, refused busy. */
export const MAX_BROKERED_IN_FLIGHT = 16;
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

/** A target the broker calls: one MCP server (C1: the kernel's own). */
export interface BrokerTarget {
  /** the MCP server name (`gnomon` for the kernel's own) */
  server: string;
  /** how the child labels the result: `kernel`, or `mcp:<server>` */
  provenance: string;
  list(): Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>>;
  call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** C1's target: the kernel's own SDK server, through the same kernelMcpAnswer a Claude session reaches (kernel-mcp.ts). */
export function kernelSdkTarget(verbs: Pick<GitVerbs, 'tools' | 'call'>, session: () => VerbSession | null): BrokerTarget {
  let n = 0;
  const rpc = async (method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> => kernelMcpAnswer({ jsonrpc: '2.0', id: ++n, method, ...(params ? { params } : {}) }, verbs, session);
  return {
    server: KERNEL_MCP_SERVER,
    provenance: 'kernel',
    async list() {
      const r = await rpc('tools/list');
      const tools = isObj(r.result) && Array.isArray(r.result.tools) ? r.result.tools : [];
      return tools.filter(isObj).map((t) => ({ name: String(t.name), description: typeof t.description === 'string' ? t.description : '', inputSchema: isObj(t.inputSchema) ? t.inputSchema : {} }));
    },
    async call(name, args) {
      const r = await rpc('tools/call', { name, arguments: args });
      if (isObj(r.error)) return { text: typeof r.error.message === 'string' ? r.error.message : 'the kernel tool call failed', isError: true };
      const res = isObj(r.result) ? r.result : {};
      const text = Array.isArray(res.content) ? res.content.filter(isObj).map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n') : '';
      return { text, isError: res.isError === true };
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

/** The kernel SDK tools offered to a local session (tools_set at open): classed, served, and well-formed. */
export async function offeredKernelTools(target: BrokerTarget, classes: Readonly<Record<string, ToolBrokerClass>> = KERNEL_TOOL_CLASSES): Promise<BrokeredTool[]> {
  const out: BrokeredTool[] = [];
  for (const t of await target.list()) {
    const cls = Object.hasOwn(classes, t.name) ? classes[t.name] : undefined;
    if (!cls || LOCAL_UNSERVED_KERNEL_TOOLS.includes(t.name) || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(t.name) || t.inputSchema.type !== 'object') continue;
    out.push({ name: t.name, description: t.description.slice(0, 1024), parameters: structuredClone(t.inputSchema), class: cls });
  }
  return out;
}

/** C0/C1 controls (tab and newline included) and the bidi formatting characters (Trojan Source). */
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/;

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

function check(schema: unknown, v: unknown, at: string, depth: number): string | null {
  if (depth > ARG_LIMITS.depth) return `${at} is nested too deeply`;
  const sc = isObj(schema) ? schema : {};
  const type = sc.type;
  if (typeof type === 'string' && TYPE_OK[type] && !TYPE_OK[type]!(v)) return `${at} must be ${type === 'integer' ? 'an integer' : `a ${type}`}`;
  if (Array.isArray(sc.enum) && !sc.enum.some((e) => e === v)) return `${at} is not one of the allowed values`;
  if (typeof v === 'number' && !Number.isFinite(v)) return `${at} must be a finite number`;
  if (typeof v === 'string') {
    const max = Math.min(typeof sc.maxLength === 'number' ? sc.maxLength : ARG_LIMITS.string, ARG_LIMITS.string);
    if (v.length > max) return `${at} is longer than ${max} chars`;
    if (CONTROL_OR_BIDI.test(v)) return `${at} holds a control or bidi character`;
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
      if (CONTROL_OR_BIDI.test(k)) return `${at} has a key with a control or bidi character`;
      if (!Object.hasOwn(props, k)) return `${at} has an unknown key ${JSON.stringify(k.slice(0, 64))}`;
    }
    const req = Array.isArray(sc.required) ? sc.required.filter((r): r is string => typeof r === 'string') : [];
    for (const r of req) if (!Object.hasOwn(v, r)) return `${at}.${r} is required`;
    for (const k of keys) {
      const e = check(props[k], v[k], `${at}.${k}`, depth + 1);
      if (e) return e;
    }
  } else if (type === undefined && isObj(sc.properties)) return `${at} must be an object`;
  return null;
}

/** Step 5: what the child receives — NULs dropped, at most RESULT_MAX_CHARS, a note when cut. */
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
}

const sha = (s: string): string => `sha256:${createHash('sha256').update(s).digest('hex')}`;

export class LocalToolBroker {
  readonly #o: LocalToolBrokerOptions;
  readonly #tools: readonly BrokeredTool[];
  readonly #inflight = new Set<AbortController>();

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

  /** The session aborted or exited: every call in flight is cancelled (a pending card expires; the target never runs). */
  cancelAll(): void {
    for (const c of [...this.#inflight]) c.abort();
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
    if (!tool) return done('unknown-tool', `unknown tool ${String(req.name ?? '').slice(0, 64)}`, true);
    if (req.error !== null || req.args === null) return done('bad-args', `${tool.name}: ${req.error ?? 'arguments must be a JSON object'}`, true);
    if (!o.running()) return done('not-running', 'The session is not running.', true);
    const bad = validateBrokeredArgs(tool.parameters, req.args);
    if (bad) return done('bad-args', `${tool.name}: ${bad}`, true);
    if (this.#inflight.size >= MAX_BROKERED_IN_FLIGHT) return done('busy', `This session already has ${this.#inflight.size} brokered calls in flight: wait for them.`, true);
    const ctl = new AbortController();
    const ms = tool.class === 'read' ? (o.toolTimeoutMs ?? TOOL_TIMEOUT_MS) : (o.cardTimeoutMs ?? CARD_TIMEOUT_MS);
    const deadline = Date.now() + ms;
    const timer = setTimeout(() => ctl.abort(), ms);
    timer.unref?.();
    this.#inflight.add(ctl);
    try {
      let cardId: string | undefined;
      if (tool.class !== 'read') {
        const d = await this.#card(tool, req, deadline, ctl.signal);
        cardId = d.cardId ?? undefined;
        if (d.decision === 'none') return done('no-approval-surface', 'No approval surface could take the card: not run.', true, cardId);
        if (d.decision === 'cancelled') return done('cancelled', 'cancelled: the call was aborted or timed out before it ran', true, cardId);
        if (d.decision === 'too-large') return done('bad-args', `${tool.name}: the request is too large to show in full on a card`, true);
        if (d.decision !== 'allow') return done('denied', 'The human did not approve this call.', true, cardId);
      }
      if (ctl.signal.aborted) return done('cancelled', 'cancelled: the call was aborted or timed out before it ran', true, cardId);
      let r: { text: string; isError: boolean };
      try {
        r = await o.target.call(tool.name, req.args);
      } catch (err) {
        r = { text: `the ${tool.name} call failed: ${(err as Error).message.slice(0, 200)}`, isError: true };
      }
      return done(tool.class === 'read' ? 'ran' : 'approved', shapeBrokeredResult(r.text), r.isError, cardId);
    } finally {
      clearTimeout(timer);
      this.#inflight.delete(ctl);
    }
  }

  /** Step 3: the minimal C1 card (every argument shown by composePermission), allow | deny, expired on cancel. */
  async #card(tool: BrokeredTool, req: ToolRequestIn, deadline: number, signal: AbortSignal): Promise<{ decision: string; cardId: string | null }> {
    const o = this.#o;
    const b = o.broker;
    if (!b || typeof b.decisionOf !== 'function') return { decision: 'none', cardId: null };
    const plan = composePermission({ requestId: req.id, toolName: tool.name, toolUseId: req.toolCallId, input: req.args! }, { repo: o.repo, denyWrite: [] });
    if (plan.kind !== 'card') return { decision: 'too-large', cardId: null };
    const lines = [...plan.lines, `class: ${tool.class} · a brokered call from this local session to ${o.target.server}`];
    const detail = { ...plan.detail, brokered: { server: o.target.server, class: tool.class, argsHash: sha(JSON.stringify(req.args)) } };
    let cardId: string;
    try {
      const c = await b.raise({ kind: 'permission', requestedBy: o.principalId, hsid: o.hsid, attended: true, detail, lines, toolInput: req.args!, tool: tool.name, decisions: ['allow', 'deny'], timeoutMs: Math.max(1000, deadline - Date.now()) });
      cardId = c.cardId;
    } catch {
      return { decision: 'none', cardId: null };
    }
    if (signal.aborted) {
      await b.expire?.(cardId, 'cancelled').catch(() => false);
      return { decision: 'cancelled', cardId };
    }
    const cancelled = new Promise<string>((resolve) => signal.addEventListener('abort', () => resolve('cancelled'), { once: true }));
    let decision: string;
    try {
      decision = await Promise.race([b.decisionOf(cardId), cancelled]);
    } catch {
      decision = 'deny';
    }
    if (decision === 'cancelled') await b.expire?.(cardId, 'cancelled').catch(() => false);
    return { decision, cardId };
  }
}
