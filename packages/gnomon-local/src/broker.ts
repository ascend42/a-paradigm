/**
 * @symbol #gnomon-local
 * @symbol #local-tool-broker
 *
 * Slice S1 + C1 (TD-2026-10-27-833): the child's half of the TWO-WAY protocol
 * and the BROKERED tool kind. Until S1 the kernel only sent commands and the
 * child only emitted events; now the child can ask the kernel to run a tool.
 *
 *   child → kernel  tool_request{id, toolCallId, name, args}
 *                   (context_report is slice B1's, unchanged)
 *   kernel → child  tool_response{id, content, isError, provenance}
 *                   tools_set{tools:[{name, description, parameters, class}]}
 *                     replaces the offered brokered set from the NEXT step on
 *                   memory_set{text} / compact{} / set_context{contextTarget}
 *                     RESERVED for slice B2: validated and parsed, answered
 *                     {applied:false} (no-ops until B2)
 *
 * Every field is bounded and validated (the runner.ts style: closed key sets
 * on these new commands, length caps, patterns). A brokered call:
 *   1. the name must be in the CURRENT offered set (else "unknown tool", the
 *      allowTools rule);
 *   2. its args are validated against the OFFERED schema (unknown keys are
 *      always refused; types, required, enum, maxLength; size and depth caps);
 *   3. tool_request is emitted and the call waits for tool_response under a
 *      timeout: TOOL_TIMEOUT_MS (30 s) for a read-class tool, CARD_TIMEOUT_MS
 *      (5 min) for mutate/destructive (a human answers a card); both from the
 *      session config when set. A timeout, or the run's abort (G-LCL-15),
 *      resolves the call as an ERROR result — never a hang; a late response
 *      for a settled id is refused "no outstanding request";
 *   4. the result is labelled by its provenance (`kernel` or `mcp:<server>`):
 *      the agent shapes it (shape.ts) as <tool-data source="…"
 *      trust="data-not-instructions">, an error result too (Aegis M5: a
 *      failed push carries the remote's stderr) with error="true".
 * Aegis M1: when the child gives up on a call (its timeout, the run's abort)
 * it tells the kernel with `tool_cancel{id}`, so a pending card expires and
 * the target never runs late. Aegis L5: a model call id outside
 * [A-Za-z0-9_.:-]{1,128} is replaced by `call-<id>` before it leaves.
 */
import type { ResultSource, ToolResult } from './confine.js';
import type { ToolSpec } from './compat.js';

export type ToolClass = 'read' | 'mutate' | 'destructive';
export const TOOL_CLASSES: readonly ToolClass[] = Object.freeze(['read', 'mutate', 'destructive']);

export interface BrokeredToolSpec extends ToolSpec {
  class: ToolClass;
}

/** A read-class request waits this long for its tool_response (spec: "every request has a timeout, default 30 s"). */
export const TOOL_TIMEOUT_MS = 30_000;
/** A mutate/destructive request may wait on a human card: this long. */
export const CARD_TIMEOUT_MS = 5 * 60_000;
/** Aegis N4: once the kernel says the call's effect is running (tool_progress), the child waits this much longer. */
export const RUN_TIMEOUT_MS = 10 * 60_000;
/** Bounds of every field (both directions). */
export const BROKER_LIMITS = Object.freeze({
  tools: 64,
  name: 64,
  description: 1024,
  parametersBytes: 16 * 1024,
  argsBytes: 64 * 1024,
  argsDepth: 6,
  content: 256 * 1024,
  memory: 16 * 1024,
  toolCallId: 128,
  outstanding: 64,
});

export const TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
export const REQUEST_ID_RE = /^tr-[1-9]\d{0,9}$/;
/** provenance of a brokered result: the kernel itself, or a named MCP server it fronts */
export const PROVENANCE_RE = /^(?:kernel|mcp:[a-z0-9][a-z0-9_-]{0,63})$/;
/** Aegis L5: a toolCallId the kernel accepts. */
export const TOOL_CALL_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v) ?? '', 'utf8');

/** Refuse any key outside `keys` (the new commands are closed). */
function closed(cmd: Record<string, unknown>, keys: readonly string[]): string | null {
  const extra = Object.keys(cmd).find((k) => !keys.includes(k));
  return extra === undefined ? null : `unknown field ${extra.slice(0, 32)}`;
}

/** tools_set → the new offered set, or why it is refused. Names must be unique and outside `reserved` (the native tools). */
export function parseToolsSet(cmd: Record<string, unknown>, reserved: readonly string[]): { tools: BrokeredToolSpec[] } | { error: string } {
  const c = closed(cmd, ['id', 'type', 'tools']);
  if (c) return { error: c };
  if (!Array.isArray(cmd.tools) || cmd.tools.length > BROKER_LIMITS.tools) return { error: `tools must be a list of at most ${BROKER_LIMITS.tools}` };
  const out: BrokeredToolSpec[] = [];
  for (const [i, t] of cmd.tools.entries()) {
    if (!isObj(t)) return { error: `tools[${i}] is not an object` };
    const k = closed(t, ['name', 'description', 'parameters', 'class']);
    if (k) return { error: `tools[${i}]: ${k}` };
    if (typeof t.name !== 'string' || !TOOL_NAME_RE.test(t.name)) return { error: `tools[${i}].name is not a tool name` };
    if (reserved.includes(t.name) || out.some((o) => o.name === t.name)) return { error: `tools[${i}].name ${t.name} is taken` };
    if (typeof t.description !== 'string' || t.description.length > BROKER_LIMITS.description) return { error: `tools[${i}].description must be text of at most ${BROKER_LIMITS.description} chars` };
    if (!isObj(t.parameters) || t.parameters.type !== 'object' || bytes(t.parameters) > BROKER_LIMITS.parametersBytes) return { error: `tools[${i}].parameters must be an object schema of at most ${BROKER_LIMITS.parametersBytes} bytes` };
    if (typeof t.class !== 'string' || !(TOOL_CLASSES as readonly string[]).includes(t.class)) return { error: `tools[${i}].class must be read, mutate or destructive` };
    out.push({ name: t.name, description: t.description, parameters: structuredClone(t.parameters), class: t.class as ToolClass });
  }
  return { tools: out };
}

export interface ToolResponse {
  id: string;
  content: string;
  isError: boolean;
  provenance: string;
}

export function parseToolResponse(cmd: Record<string, unknown>): ToolResponse | { error: string } {
  const c = closed(cmd, ['type', 'id', 'content', 'isError', 'provenance']);
  if (c) return { error: c };
  if (typeof cmd.id !== 'string' || !REQUEST_ID_RE.test(cmd.id)) return { error: 'id is not a tool request id' };
  if (typeof cmd.content !== 'string' || cmd.content.length > BROKER_LIMITS.content) return { error: `content must be text of at most ${BROKER_LIMITS.content} chars` };
  if (typeof cmd.isError !== 'boolean') return { error: 'isError must be a boolean' };
  if (typeof cmd.provenance !== 'string' || !PROVENANCE_RE.test(cmd.provenance)) return { error: 'provenance must be kernel or mcp:<server>' };
  return { id: cmd.id, content: cmd.content, isError: cmd.isError, provenance: cmd.provenance };
}

/** Aegis N4: tool_progress{id, state:'running'} from the kernel. */
export function parseToolProgress(cmd: Record<string, unknown>): { id: string } | { error: string } {
  const c = closed(cmd, ['type', 'id', 'state']);
  if (c) return { error: c };
  if (typeof cmd.id !== 'string' || !REQUEST_ID_RE.test(cmd.id)) return { error: 'id is not a tool request id' };
  if (cmd.state !== 'running') return { error: 'state must be running' };
  return { id: cmd.id };
}

/** The reserved B2 commands: validated and parsed (no-ops until B2). */
export function parseReserved(cmd: Record<string, unknown>): { op: 'memory_set'; text: string } | { op: 'compact' } | { op: 'set_context'; contextTarget: number } | { error: string } {
  switch (cmd.type) {
    case 'memory_set': {
      const c = closed(cmd, ['id', 'type', 'text']);
      if (c) return { error: c };
      if (typeof cmd.text !== 'string' || cmd.text.length > BROKER_LIMITS.memory) return { error: `text must be text of at most ${BROKER_LIMITS.memory} chars` };
      return { op: 'memory_set', text: cmd.text };
    }
    case 'compact': {
      const c = closed(cmd, ['id', 'type']);
      return c ? { error: c } : { op: 'compact' };
    }
    case 'set_context': {
      const c = closed(cmd, ['id', 'type', 'contextTarget']);
      if (c) return { error: c };
      const n = cmd.contextTarget;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1024 || n > 131072) return { error: 'contextTarget must be an integer in 1024..131072' };
      return { op: 'set_context', contextTarget: n };
    }
    default:
      return { error: 'not a reserved command' };
  }
}

const TYPE_OK: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  integer: (v) => typeof v === 'number' && Number.isInteger(v),
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => isObj(v),
  null: (v) => v === null,
};

/**
 * `args` against an offered JSON schema (the subset tool schemas use): type, properties, required, enum, maxLength,
 * items. Unknown keys are ALWAYS refused (whatever additionalProperties says). Returns why, or null when valid.
 */
export function validateArgs(schema: Record<string, unknown>, args: unknown): string | null {
  if (!isObj(args)) return 'arguments must be a JSON object';
  if (bytes(args) > BROKER_LIMITS.argsBytes) return `arguments are over ${BROKER_LIMITS.argsBytes} bytes`;
  return check(schema, args, 'arguments', 0);
}

function check(schema: unknown, v: unknown, at: string, depth: number): string | null {
  if (depth > BROKER_LIMITS.argsDepth) return `${at} is nested too deeply`;
  if (!isObj(schema)) return null;
  const type = schema.type;
  if (typeof type === 'string' && TYPE_OK[type] && !TYPE_OK[type]!(v)) return `${at} must be ${type === 'integer' ? 'an integer' : `a ${type}`}`;
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === v)) return `${at} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ').slice(0, 200)}`;
  if (typeof v === 'string' && typeof schema.maxLength === 'number' && v.length > schema.maxLength) return `${at} is longer than ${schema.maxLength}`;
  if (Array.isArray(v)) {
    if (typeof schema.maxItems === 'number' && v.length > schema.maxItems) return `${at} has more than ${schema.maxItems} items`;
    for (const [i, x] of v.entries()) {
      const e = check(schema.items, x, `${at}[${i}]`, depth + 1);
      if (e) return e;
    }
  }
  if (isObj(v) && (type === 'object' || isObj(schema.properties))) {
    const props = isObj(schema.properties) ? schema.properties : {};
    for (const k of Object.keys(v)) if (!Object.hasOwn(props, k)) return `${at} has an unknown key ${JSON.stringify(k.slice(0, 64))}`;
    const req = Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === 'string') : [];
    for (const r of req) if (!Object.hasOwn(v, r)) return `${at}.${r} is required`;
    for (const [k, x] of Object.entries(v)) {
      const e = check(props[k], x, `${at}.${k}`, depth + 1);
      if (e) return e;
    }
  }
  return null;
}

interface Pending {
  resolve: (r: ToolResult) => void;
  timer: NodeJS.Timeout;
  cleanup: () => void;
  /** Aegis N4: re-arm the wait (tool_progress) */
  extend: (ms: number) => void;
  running: boolean;
}

export interface KernelBrokerOptions {
  emit: (ev: Record<string, unknown>) => void;
  toolTimeoutMs?: number;
  cardTimeoutMs?: number;
  runTimeoutMs?: number;
}

/** The child's brokered-call port: tool_request out, tool_response in, timeouts and abort. */
export class KernelToolBroker {
  readonly #o: KernelBrokerOptions;
  readonly #pending = new Map<string, Pending>();
  #n = 0;

  constructor(o: KernelBrokerOptions) {
    this.#o = o;
  }

  get outstanding(): number {
    return this.#pending.size;
  }

  /** Ask the kernel to run `tool` (already validated); resolves with its result or an error result (timeout, abort). */
  request(tool: BrokeredToolSpec, toolCallId: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) return Promise.resolve({ content: 'cancelled: the run was aborted', isError: true });
    if (this.#pending.size >= BROKER_LIMITS.outstanding) return Promise.resolve({ content: `too many brokered calls in flight (cap ${BROKER_LIMITS.outstanding})`, isError: true });
    const id = `tr-${++this.#n}`;
    const ms = tool.class === 'read' ? (this.#o.toolTimeoutMs ?? TOOL_TIMEOUT_MS) : (this.#o.cardTimeoutMs ?? CARD_TIMEOUT_MS);
    return new Promise<ToolResult>((resolve) => {
      const settle = (r: ToolResult): void => {
        const p = this.#pending.get(id);
        if (!p) return;
        this.#pending.delete(id);
        clearTimeout(p.timer);
        p.cleanup();
        // Aegis M1: the kernel stops the call too (it only ever removes privilege)
        this.#o.emit({ type: 'tool_cancel', id });
        resolve(r);
      };
      const onAbort = (): void => settle({ content: 'cancelled: the run was aborted', isError: true });
      signal?.addEventListener('abort', onAbort, { once: true });
      const arm = (wait: number): NodeJS.Timeout => {
        const t = setTimeout(() => settle({ content: `timed out: the kernel did not answer ${tool.name} within ${Math.round(wait / 1000)} s`, isError: true }), wait);
        t.unref?.();
        return t;
      };
      const entry: Pending = {
        resolve,
        timer: arm(ms),
        cleanup: () => signal?.removeEventListener('abort', onAbort),
        running: false,
        extend: (wait) => {
          clearTimeout(entry.timer);
          entry.timer = arm(wait);
        },
      };
      this.#pending.set(id, entry);
      this.#o.emit({ type: 'tool_request', id, toolCallId: TOOL_CALL_ID_RE.test(toolCallId) ? toolCallId : `call-${id}`, name: tool.name, args });
    });
  }

  /** A tool_response: settles its request (false when no request with that id is outstanding). */
  respond(r: ToolResponse): boolean {
    const p = this.#pending.get(r.id);
    if (!p) return false;
    this.#pending.delete(r.id);
    clearTimeout(p.timer);
    p.cleanup();
    // Aegis M5: a brokered result keeps its provenance, error or not (shape.ts frames brokered errors with error="true")
    p.resolve({ content: r.content, isError: r.isError, source: r.provenance as ResultSource });
    return true;
  }

  /** Aegis N4: the kernel's tool_progress{id, state:'running'}: the effect started, wait RUN_TIMEOUT_MS more (once). */
  progress(id: string): boolean {
    const p = this.#pending.get(id);
    if (!p || p.running) return false;
    p.running = true;
    p.extend(this.#o.runTimeoutMs ?? RUN_TIMEOUT_MS);
    return true;
  }

  /** Every outstanding request ends as an error result (the run was aborted). */
  cancelAll(why = 'cancelled: the run was aborted'): void {
    for (const [id, p] of [...this.#pending]) {
      this.#pending.delete(id);
      clearTimeout(p.timer);
      p.cleanup();
      this.#o.emit({ type: 'tool_cancel', id });
      p.resolve({ content: why, isError: true });
    }
  }
}
