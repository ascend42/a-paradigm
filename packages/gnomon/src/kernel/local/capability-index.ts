/**
 * @symbol #capability-index
 *
 * #capability-index (TD-2026-10-27-833 slice C2'): turns ANY MCP server's tools/list into NARROW tools a small local
 * model can call. One pure function, `narrow(list, server, {trust})`, the same for every server (founder: narrowing is
 * GLOBAL, never a hand-written per-server pack). Each tool becomes one or more CapabilityEntry:
 *
 *   SPLIT     a required string param with a string `enum` that its name (op | action | operation | command) or its
 *             description ("operation", "action", "command") marks as the operation — else the ONLY required enum —
 *             becomes one narrow tool per value, named `<tool>.<op>`. The op is FIXED by the kernel at reassembly; the
 *             narrow schema never holds it, so a model can never set or change it (G-LCL-16).
 *   FLATTEN   nested objects become dotted primitive params (`a.b`, `a.b.c`: at most two object levels under the top
 *             property); an array of primitives becomes ONE comma-separated string the kernel splits; an array of
 *             objects, oneOf/anyOf/allOf/not/$ref, a free-form or untyped value, a property name holding '.' or a
 *             character the broker refuses, are never offered: such a param that is REQUIRED makes the whole tool
 *             `humanOnly` (usable from "/" later, never offered to the model); an optional one is dropped.
 *   TRIM      every required param, plus at most MAX_OPTIONAL optional ones, ranked: named with `*` in the tool
 *             description's op segment (`create(blurb*, …)`), then mentioned there (or, for an unsplit tool, anywhere
 *             in the description), then carrying a default or an enum; ties keep schema order. An op whose segment
 *             the description holds keeps ONLY the optional params that segment names. The rest are listed in
 *             `dropped` (a card can name them).
 *   DESCRIBE  the description's first sentence plus the op label, at most DESCRIPTION_MAX chars.
 *   CLASS     read | mutate | destructive. MCP annotations count ONLY when the server's trust is `trusted` or
 *             `first-party` (readOnlyHint → read, destructiveHint → destructive, else mutate). A split op's class
 *             comes from per-op annotations, again only for a trusted server: first a resource the server advertises
 *             whose JSON has schema `io.gnomon/op-annotations:v1` ({tools: {<tool>: {<op>: annotations}}}, found
 *             generically by #local-mcp-client, size-bounded, shape-validated or ignored whole), else the tool's
 *             `_meta["io.gnomon/op-annotations"]` map; an op neither names is mutate (a destructive parent stays
 *             destructive: never weaker). Anything else (trust `enabled`, no annotations) is mutate.
 *   ID        `<server>/<tool>[.<op>]@<sha256(canonical original inputSchema)[:8]>`: a changed schema is a new id.
 *
 * The entry keeps the FULL original schema. `reassemble(entry, args)` rebuilds a call from narrow args: every key must
 * be one of the entry's narrow param names (anything else — the op param included — is refused), the fixed op is set,
 * comma strings are split, dotted params are put back as objects (own properties only: a path segment is a schema
 * property name, never model text, and `__proto__`/`constructor`/`prototype` are never flattened). The broker then
 * validates the result against the FULL schema (validateBrokeredArgs: its safe-regex gate covers server patterns)
 * before any target runs.
 */
import { createHash } from 'node:crypto';
import { canonicalJson, type ToolBrokerClass } from '@a-company/gnomon-contracts';

/** How much the kernel believes a server's own annotations (C5' adds the grant UI; config sets it today). */
export type ServerTrust = 'enabled' | 'trusted' | 'first-party';
export const SERVER_TRUSTS: readonly ServerTrust[] = Object.freeze(['enabled', 'trusted', 'first-party']);

/** One tool of a tools/list result (MCP 2025-06: name, description, inputSchema, annotations, _meta). */
export interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface NarrowParam {
  /** the narrow (dotted) name the model sees */
  name: string;
  /** the property path in the full schema (schema property names only) */
  path: readonly string[];
  /** scalar: passed as is; csv: a comma-separated string split into the array */
  kind: 'scalar' | 'csv';
  /** csv: the full schema's item type (number/integer items are converted) */
  itemType?: string;
  required: boolean;
}

export interface CapabilityEntry {
  /** `<server>/<tool>[.<op>]@<hash8>` */
  id: string;
  server: string;
  tool: string;
  op: string | null;
  /** the split param (the kernel sets it to `op`) */
  opParam: string | null;
  /** the model-facing name: `<tool>[.<op>]` */
  name: string;
  description: string;
  class: ToolBrokerClass;
  /** never offered to the model (a required param it cannot express, or a name it cannot carry) */
  humanOnly: boolean;
  humanOnlyWhy?: string;
  /** the narrow schema the model sees ({type:'object', properties, required, additionalProperties:false}) */
  parameters: Record<string, unknown>;
  params: readonly NarrowParam[];
  /** optional params not offered (trimmed or inexpressible): a card can list them */
  dropped: readonly string[];
  /** the FULL original inputSchema (calls are validated against it) */
  schema: Record<string, unknown>;
}

export const OP_PARAM_NAMES: readonly string[] = Object.freeze(['op', 'action', 'operation', 'command']);
/** At most this many optional params per narrow tool. */
export const MAX_OPTIONAL = 3;
export const DESCRIPTION_MAX = 100;
/** A split with more values than this is not split (the enum stays a param). */
export const MAX_OPS = 32;
/** Object levels a dotted param may cross under its top property (`a.b.c`). */
export const MAX_NEST = 2;
/** A narrow param's own description (full surface only; the compact surface drops it). */
export const PARAM_DESCRIPTION_MAX = 80;
const OP_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const PROP_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/;
const TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const COMPLEX_KEYWORDS = ['oneOf', 'anyOf', 'allOf', 'not', '$ref', 'if', 'patternProperties'];
const PRIMITIVES = new Set(['string', 'number', 'integer', 'boolean']);

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The single non-null type of a schema (`'string'`, `['string','null']` → 'string'); null when absent or a real union. */
function typeOf(s: Record<string, unknown>): string | null {
  if (typeof s.type === 'string') return s.type;
  if (Array.isArray(s.type)) {
    const t = s.type.filter((x) => x !== 'null');
    return t.length === 1 && typeof t[0] === 'string' ? t[0] : null;
  }
  // an enum of strings with no type reads as a string
  if (Array.isArray(s.enum) && s.enum.length && s.enum.every((e) => typeof e === 'string')) return 'string';
  return null;
}

const complex = (s: Record<string, unknown>): boolean => COMPLEX_KEYWORDS.some((k) => Object.hasOwn(s, k));

/** The text of `op`'s segment in a description like `Ops: create(a*, b), list(c).` (null when the op is not named). */
export function opSegment(description: string, op: string): string | null {
  const re = new RegExp(`(?:^|[^A-Za-z0-9_-])${op.replace(/[-]/g, '\\-')}\\(`);
  const m = re.exec(description);
  if (!m) return null;
  let depth = 1;
  const start = m.index + m[0].length;
  for (let i = start; i < description.length; i++) {
    const c = description[i];
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return description.slice(start, i);
  }
  return description.slice(start);
}

/** The first sentence of a description (or its first line). */
export function firstSentence(d: string): string {
  const line = d.trim().split('\n')[0]!.trim();
  const m = /^(.+?[.!?])(?:\s|$)/.exec(line);
  return (m ? m[1]! : line).trim();
}

function describe(d: string, op: string | null): string {
  const label = op ? ` (${op})` : '';
  const room = DESCRIPTION_MAX - label.length;
  let s = firstSentence(d) || 'MCP tool.';
  if (s.length > room) s = `${s.slice(0, room - 1).trimEnd()}…`;
  return `${s}${label}`;
}

/** The param the tool splits on, or null. */
export function splitParam(schema: Record<string, unknown>): string | null {
  const props = isObj(schema.properties) ? schema.properties : {};
  const req = Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === 'string') : [];
  const cands = req.filter((r) => {
    const p = props[r];
    if (!isObj(p) || complex(p) || typeOf(p) !== 'string' || !Array.isArray(p.enum)) return false;
    const e = p.enum;
    return e.length > 0 && e.length <= MAX_OPS && e.every((v) => typeof v === 'string' && OP_VALUE_RE.test(v)) && new Set(e).size === e.length;
  });
  const named = cands.find((c) => OP_PARAM_NAMES.includes(c.toLowerCase()));
  if (named) return named;
  const described = cands.find((c) => {
    const p = props[c] as Record<string, unknown>;
    return typeof p.description === 'string' && /\b(operation|action|command)\b/i.test(p.description);
  });
  if (described) return described;
  return cands.length === 1 ? cands[0]! : null;
}

interface Walked {
  params: Array<NarrowParam & { schema: Record<string, unknown> }>;
  /** optional names never offered (inexpressible) */
  dropped: string[];
  /** a required param the model cannot express */
  humanOnly: string | null;
}

/** Flatten one object schema's properties (minus `skip`) into narrow params. */
function walk(schema: Record<string, unknown>, skip: string | null): Walked {
  const out: Walked = { params: [], dropped: [], humanOnly: null };
  const visit = (s: Record<string, unknown>, prefix: string[], parentRequired: boolean, nest: number): void => {
    const props = isObj(s.properties) ? s.properties : {};
    const req = new Set(Array.isArray(s.required) ? s.required.filter((r): r is string => typeof r === 'string') : []);
    for (const [k, raw] of Object.entries(props)) {
      if (prefix.length === 0 && k === skip) continue;
      const path = [...prefix, k];
      const name = path.join('.');
      const required = parentRequired && req.has(k);
      const bad = (why: string): void => {
        if (required) out.humanOnly ??= `${name}: ${why}`;
        else out.dropped.push(name);
      };
      if (!PROP_NAME_RE.test(k) || FORBIDDEN_KEYS.has(k)) {
        bad('a property name the kernel cannot carry');
        continue;
      }
      if (!isObj(raw) || complex(raw)) {
        bad('a union or reference');
        continue;
      }
      const t = typeOf(raw);
      if (t && PRIMITIVES.has(t)) {
        out.params.push({ name, path, kind: 'scalar', required, schema: narrowScalar(raw, t) });
      } else if (t === 'array') {
        const items = raw.items;
        const it = items === undefined ? 'string' : isObj(items) && !complex(items) ? typeOf(items) : null;
        if (it && PRIMITIVES.has(it)) out.params.push({ name, path, kind: 'csv', itemType: it, required, schema: { type: 'string', description: `comma-separated ${it} list` } });
        else bad('an array of objects');
      } else if (t === 'object' && isObj(raw.properties) && Object.keys(raw.properties).length > 0 && nest < MAX_NEST) {
        visit(raw, path, required, nest + 1);
      } else bad(t === 'object' ? 'a free-form or too deeply nested object' : 'an untyped value');
    }
  };
  visit(schema, [], true, 0);
  return out;
}

function narrowScalar(s: Record<string, unknown>, t: string): Record<string, unknown> {
  const out: Record<string, unknown> = { type: t };
  if (typeof s.description === 'string' && s.description) out.description = s.description.split('\n')[0]!.slice(0, PARAM_DESCRIPTION_MAX);
  if (Array.isArray(s.enum) && s.enum.length <= 64 && s.enum.every((e) => typeof e === 'string' || typeof e === 'number' || typeof e === 'boolean')) out.enum = [...s.enum];
  return out;
}

function classOf(a: unknown, trust: ServerTrust): ToolBrokerClass {
  if (trust === 'enabled' || !isObj(a)) return 'mutate';
  if (a.destructiveHint === true) return 'destructive';
  if (a.readOnlyHint === true) return 'read';
  return 'mutate';
}

export interface NarrowOptions {
  trust?: ServerTrust;
  /**
   * The parsed JSON of a resource the server advertises with schema OP_ANNOTATIONS_SCHEMA (found generically by the
   * MCP client: resources/list, then a bounded resources/read). Used only when the trust is trusted or first-party.
   */
  opAnnotations?: unknown;
}

/** The per-op annotations a server can publish as a resource (`{schema, tools: {<tool>: {<op>: annotations}}}`). */
export const OP_ANNOTATIONS_SCHEMA = 'io.gnomon/op-annotations:v1';
/** The same map inside one tool's tools/list `_meta` (op → annotations). */
export const OP_ANNOTATIONS_META = 'io.gnomon/op-annotations';
/** The largest op-annotations resource the kernel reads (bytes). */
export const OP_ANNOTATIONS_MAX_BYTES = 256 * 1024;
const ANNOTATION_KEYS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];

/** One annotations object, or null when it is not `{<hint>: boolean}` with known hints only. */
function annotationsOf(v: unknown): Record<string, boolean> | null {
  if (!isObj(v)) return null;
  const out: Record<string, boolean> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!ANNOTATION_KEYS.includes(k) || typeof x !== 'boolean') return null;
    out[k] = x;
  }
  return out;
}

/**
 * An op-annotations resource → tool → op → annotations, or null when its shape is not exactly the schema's (a wrong
 * schema id, a non-object, an op entry that is not annotations: the WHOLE resource is ignored, fail closed to mutate).
 */
export function parseOpAnnotations(v: unknown): Map<string, Map<string, Record<string, boolean>>> | null {
  if (!isObj(v) || v.schema !== OP_ANNOTATIONS_SCHEMA || !isObj(v.tools)) return null;
  const out = new Map<string, Map<string, Record<string, boolean>>>();
  for (const [tool, ops] of Object.entries(v.tools)) {
    if (!isObj(ops)) return null;
    const m = new Map<string, Record<string, boolean>>();
    for (const [op, a] of Object.entries(ops)) {
      const ann = annotationsOf(a);
      if (!ann) return null;
      m.set(op, ann);
    }
    out.set(tool, m);
  }
  return out;
}

/**
 * A split op's class (trusted servers only): the resource's entry for the op, else the tool `_meta` map's; an op
 * neither names is mutate — never weaker than a destructive parent.
 */
function opClass(tool: string, op: string, parent: ToolBrokerClass, trust: ServerTrust, resource: Map<string, Map<string, Record<string, boolean>>> | null, meta: Record<string, unknown> | null): ToolBrokerClass {
  if (trust === 'enabled') return 'mutate';
  const fromResource = resource?.get(tool)?.get(op);
  const fromMeta = !fromResource && meta && Object.hasOwn(meta, op) ? annotationsOf(meta[op]) : null;
  const ann = fromResource ?? fromMeta;
  if (ann) return classOf(ann, trust);
  return parent === 'destructive' ? 'destructive' : 'mutate';
}

/**
 * Narrow one server's tools/list (`{tools}` or the array). Never throws: a malformed tool yields no entry. Order: the
 * list's order, a split tool's ops in enum order.
 */
export function narrow(list: { tools?: unknown } | readonly unknown[], server: string, o: NarrowOptions = {}): CapabilityEntry[] {
  const trust = o.trust ?? 'enabled';
  const resourceAnn = trust === 'enabled' ? null : parseOpAnnotations(o.opAnnotations);
  const tools = Array.isArray(list) ? list : isObj(list) && Array.isArray(list.tools) ? list.tools : [];
  const out: CapabilityEntry[] = [];
  for (const t of tools) {
    if (!isObj(t) || typeof t.name !== 'string' || !t.name) continue;
    const schema = isObj(t.inputSchema) ? t.inputSchema : { type: 'object' };
    const desc = typeof t.description === 'string' ? t.description : '';
    let hash: string;
    try {
      hash = createHash('sha256').update(canonicalJson(schema)).digest('hex').slice(0, 8);
    } catch {
      continue; // not plain JSON
    }
    const op = splitParam(schema);
    const ops: Array<string | null> = op ? ((schema.properties as Record<string, Record<string, unknown>>)[op]!.enum as string[]) : [null];
    const w = walk(schema, op);
    const metaAnn = isObj(t._meta) && isObj(t._meta[OP_ANNOTATIONS_META]) ? t._meta[OP_ANNOTATIONS_META] : null;
    for (const v of ops) {
      const name = v ? `${t.name}.${v}` : t.name;
      const context = v ? (opSegment(desc, v) ?? '') : desc;
      const rank = (p: NarrowParam): number => {
        const top = p.path[0]!;
        const esc = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const word = (x: string): RegExp => new RegExp(`(?:^|[^A-Za-z0-9_])${esc(x)}(?![A-Za-z0-9_])`);
        const starred = new RegExp(`(?:^|[^A-Za-z0-9_])${esc(top)}\\*`).test(context) || new RegExp(`(?:^|[^A-Za-z0-9_.])${esc(p.name)}\\*`).test(context);
        const mentioned = word(p.name).test(context) || word(top).test(context);
        const sc = w.params.find((x) => x.name === p.name)!.schema;
        const full = leaf(schema, p.path);
        const hinted = (isObj(full) && Object.hasOwn(full, 'default')) || Array.isArray(sc.enum);
        return (starred ? 4 : 0) + (mentioned ? 2 : 0) + (hinted ? 1 : 0);
      };
      const required = w.params.filter((p) => p.required);
      // an op the description lists (`create(a*, b)`) keeps only the optional params it names
      const segmented = v !== null && opSegment(desc, v) !== null;
      const optional = w.params.filter((p) => !p.required).map((p, i) => ({ p, i, r: rank(p) }));
      optional.sort((a, b) => b.r - a.r || a.i - b.i);
      const eligible = optional.filter((x) => !segmented || x.r >= 2);
      const kept = eligible.slice(0, MAX_OPTIONAL).sort((a, b) => a.i - b.i).map((x) => x.p);
      const params = [...required, ...kept];
      const dropped = [...optional.filter((x) => !kept.includes(x.p)).map((x) => x.p.name), ...w.dropped];
      const properties: Record<string, unknown> = {};
      for (const p of params) properties[p.name] = p.schema;
      const parameters = { type: 'object', properties, required: required.map((p) => p.name), additionalProperties: false };
      const cls = v === null ? classOf(t.annotations, trust) : opClass(t.name, v, classOf(t.annotations, trust), trust, resourceAnn, metaAnn);
      const humanOnly = w.humanOnly ?? (!TOOL_NAME_RE.test(name) ? 'the tool name does not fit a model tool name' : null);
      out.push({
        id: `${server}/${name}@${hash}`,
        server,
        tool: t.name,
        op: v,
        opParam: v ? op : null,
        name,
        description: describe(desc, v),
        class: cls,
        humanOnly: humanOnly !== null,
        ...(humanOnly !== null ? { humanOnlyWhy: humanOnly } : {}),
        parameters,
        params: params.map(({ schema: _s, ...p }) => Object.freeze({ ...p, path: Object.freeze([...p.path]) })),
        dropped,
        schema: structuredClone(schema),
      });
    }
  }
  return out;
}

function leaf(schema: Record<string, unknown>, path: readonly string[]): unknown {
  let s: unknown = schema;
  for (const k of path) s = isObj(s) && isObj(s.properties) && Object.hasOwn(s.properties, k) ? s.properties[k] : undefined;
  return s;
}

const define = (o: Record<string, unknown>, k: string, v: unknown): void => {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
};

/**
 * A call's narrow args → the full call (the fixed op set, comma strings split, dotted params nested). Returns why when
 * the narrow args are not this entry's: a key that is not a narrow param name (the op param included), or a comma
 * param that is not a string or an array. Validate the result against `entry.schema` before running anything.
 */
export function reassemble(entry: Pick<CapabilityEntry, 'params' | 'op' | 'opParam' | 'name'>, args: unknown): { args: Record<string, unknown> } | { error: string } {
  if (!isObj(args)) return { error: 'arguments must be a JSON object' };
  const byName = new Map(entry.params.map((p) => [p.name, p]));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(args)) {
    const p = byName.get(k);
    if (!p) return { error: `unknown parameter ${JSON.stringify(k.slice(0, 64))}` };
    let v = args[k];
    if (p.kind === 'csv') {
      if (typeof v === 'string') {
        const parts = v.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
        v = p.itemType === 'number' || p.itemType === 'integer' ? parts.map((x) => (/^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x)) : p.itemType === 'boolean' ? parts.map((x) => (x === 'true' ? true : x === 'false' ? false : x)) : parts;
      } else if (!Array.isArray(v)) return { error: `${k} must be a comma-separated string` };
    }
    let at = out;
    for (const seg of p.path.slice(0, -1)) {
      const next = Object.hasOwn(at, seg) ? at[seg] : undefined;
      if (next === undefined) {
        const o: Record<string, unknown> = {};
        define(at, seg, o);
        at = o;
      } else if (isObj(next)) at = next;
      else return { error: `${k} collides with another parameter` };
    }
    const last = p.path[p.path.length - 1]!;
    if (Object.hasOwn(at, last)) return { error: `${k} collides with another parameter` };
    define(at, last, v);
  }
  if (entry.opParam !== null && entry.op !== null) {
    if (Object.hasOwn(out, entry.opParam)) return { error: `${entry.opParam} is fixed by the kernel` };
    define(out, entry.opParam, entry.op);
  }
  return { args: out };
}

/** The compact surface of one narrow tool (gnomon-local compat.ts surfaceTools 'compact', kept in step by a test). */
export function compactSurface(e: Pick<CapabilityEntry, 'name' | 'description' | 'parameters'>): Record<string, unknown> {
  const props = (isObj(e.parameters.properties) ? e.parameters.properties : {}) as Record<string, { type?: unknown }>;
  const compact: Record<string, { type: string }> = {};
  for (const [k, v] of Object.entries(props)) compact[k] = { type: typeof v?.type === 'string' ? v.type : 'string' };
  return { name: e.name, description: e.description.split('\n')[0]!.slice(0, 120), parameters: { type: 'object', properties: compact, required: Array.isArray(e.parameters.required) ? e.parameters.required : [] } };
}

/** Compact-surface tokens of a set of tools: ceil(chars / 4), the child's own estimate (agent.ts). */
export function compactSurfaceTokens(tools: ReadonlyArray<Pick<CapabilityEntry, 'name' | 'description' | 'parameters'>>): number {
  return Math.ceil(JSON.stringify(tools.map(compactSurface)).length / 4);
}

/**
 * C2' offer rule (until C3' adds selection): the brokered tools' share of the context target. The kernel verbs come
 * first; narrow tools follow in INDEX ORDER (servers in compose order, Paradigm first; tools in list order) while their
 * compact-surface tokens fit TOOLS_SLOT_SHARE of the target (at most TOOLS_SLOT_MAX_TOKENS), and the whole set stays
 * under MAX_OFFERED. Human-only entries and names already taken are skipped.
 */
export const TOOLS_SLOT_SHARE = 0.15;
export const TOOLS_SLOT_MAX_TOKENS = 1500;
/** gnomon-local BROKER_LIMITS.tools (64) minus room for the memory tools. */
export const MAX_OFFERED = 48;

export function toolsSlotTokens(contextTarget: number): number {
  return Math.min(TOOLS_SLOT_MAX_TOKENS, Math.floor(Math.max(0, contextTarget) * TOOLS_SLOT_SHARE));
}

/** The entries the session is offered after `fixed` (the kernel verbs), by the rule above. */
export function offerWithin<T extends Pick<CapabilityEntry, 'name' | 'description' | 'parameters' | 'humanOnly'>>(fixed: ReadonlyArray<Pick<CapabilityEntry, 'name' | 'description' | 'parameters'>>, entries: readonly T[], o: { contextTarget: number; reserved?: readonly string[] }): T[] {
  const slot = toolsSlotTokens(o.contextTarget);
  const taken = new Set([...(o.reserved ?? []), ...fixed.map((f) => f.name)]);
  const chosen: T[] = [];
  let used = compactSurfaceTokens(fixed);
  for (const e of entries) {
    if (e.humanOnly || taken.has(e.name) || fixed.length + chosen.length >= MAX_OFFERED) continue;
    const cost = compactSurfaceTokens([e]);
    if (used + cost > slot) continue;
    used += cost;
    taken.add(e.name);
    chosen.push(e);
  }
  return chosen;
}
