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
 *             comes from per-op annotations, again only for a trusted server: first (FIRST-PARTY only, slice C5'a1) a resource the server advertises
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
 *
 * FULL FORM (slice C4'a, #local-tool-tier tier 3): an unsplit tool offered with its original inputSchema, a split
 * `<tool>.<op>` with that schema MINUS its op param (same name, same id) — fullParameters. Only when fullOfferable
 * (fullRefusal: every keyword at every depth is one the validator checks, depth <= 6, no proto keys, a model tool name,
 * <= BROKER_PARAMETERS_BYTES and <= FULL_TOOL_MAX_TOKENS, every description/title/enum/default string unchanged by
 * cleanServerText); otherwise the narrow form, or nothing for a human-only entry. A full-form call goes through
 * reassembleFull (an op-param key refused, the op set, validated against the full schema). BM25 still scores the narrow
 * document, so a tier change never reorders the ranking.
 */
import { createHash } from 'node:crypto';
import { canonicalJson, type ToolBrokerClass } from '@a-company/gnomon-contracts';
import { SCHEMA_KEYWORDS, unsafePattern, validateBrokeredArgs } from './tool-broker.js';
import { neutraliseKernelText } from './working-memory.js';

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

/** Aegis M1: characters never let into a tool definition (the broker's FORBIDDEN_CHARS set). */
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Default_Ignorable_Code_Point}]/gu;
/** The same set, non-global (a test with no lastIndex state). */
const UNSAFE_CHAR = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Default_Ignorable_Code_Point}]/u;

/**
 * Aegis M1: server text that reaches the model's TOOL LIST (descriptions) is data from a third party: controls,
 * format and ignorable characters become spaces, chat-template special tokens and the kernel's delimiters are
 * neutralised (neutraliseKernelText, as tool results are), runs of space fold to one.
 */
export function cleanServerText(t: string): string {
  return neutraliseKernelText(t.normalize('NFC').replace(UNSAFE_CHARS, ' ')).replace(/\s+/g, ' ').trim();
}

/** Aegis M1: an enum value safe to show the model as-is (else the enum stays in the full schema only). */
const SAFE_ENUM_VALUE = /^[A-Za-z0-9 _.:/@+-]{0,64}$/;

/**
 * Aegis C4'a M1 (+ the sign-off low): chat-template and kernel-delimiter SHAPES server text may never carry to the model
 * (the child does not clean tool `parameters`, and descriptions reach the tool list at every tier). Tested on the NFKC
 * form, so fullwidth ＜| |＞ ＜｜ are caught. Case-insensitive: `<|` `|>` `<｜` `｜>`, any closing tag `</`, `<tool…`,
 * `<function…`, `<think`, `<s>`, `…_of_turn>`, `<working-memory`, `<<` and `>>`. Case-SENSITIVE: a bracketed upper-case
 * token `[NAME]` / `[/NAME]` (Mistral [INST], [TOOL_CALLS], tekken [TOOL_CONTENT], [ARGS], [CALL_ID], [THINK], [IMG]…),
 * so ordinary bracketed words like `[optional]` stay.
 *
 * Not shared with working-memory's SPECIAL_TOKEN / gnomon-local shape.ts: those NEUTRALISE text the model must still
 * read (tool results, memory; parity-tested across the two packages) by inserting a word joiner after the opening
 * character, and stay narrow so code in tool output (`</div>`, `a << 2`, `[TODO]`) is untouched. This is a REFUSAL
 * predicate for third-party schema and description text, deliberately broader.
 */
const TOKEN_SHAPE_CI = /<\||\|>|<｜|｜>|<\/|<tool|<function|<think|<\/?s>|_of_turn>|<working-memory|<<|>>/i;
const TOKEN_SHAPE_UPPER = /\[\/?[A-Z][A-Z_]{1,31}\]/;
export function tokenShape(t: string): boolean {
  const n = t.normalize('NFKC');
  return TOKEN_SHAPE_CI.test(n) || TOKEN_SHAPE_UPPER.test(n);
}

function describe(d: string, op: string | null): string {
  const label = op ? ` (${op})` : '';
  const room = DESCRIPTION_MAX - label.length;
  // Aegis C4'a sign-off: a description holding a template-token shape is replaced whole (every tier)
  // (tested on the raw sentence too: cleanServerText's neutraliser would hide `<|` and `[INST]` behind a word joiner)
  const raw = firstSentence(d);
  const first = cleanServerText(raw);
  let s = first && !tokenShape(raw) && !tokenShape(first) ? first : 'MCP tool.';
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
  // Aegis L6: the op param's own name must be one the kernel can set as an own property
  cands.splice(0, cands.length, ...cands.filter((c) => PROP_NAME_RE.test(c) && !FORBIDDEN_KEYS.has(c)));
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
      // a keyword the kernel validator does not check (minimum, format, minItems…) would refuse every call that sets
      // this param: never offered (required → human-only)
      const unknownKw = unchecked(raw);
      if (unknownKw) {
        bad(`uses ${unknownKw}, which the kernel validator does not check`);
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

/** The first schema keyword (this level, or a primitive array's items) the kernel validator does not check, or null. */
function unchecked(s: Record<string, unknown>): string | null {
  const own = Object.keys(s).find((k) => !SCHEMA_KEYWORDS.includes(k));
  if (own !== undefined) return own;
  if (isObj(s.items)) return Object.keys(s.items).find((k) => !SCHEMA_KEYWORDS.includes(k)) ?? null;
  return null;
}

function narrowScalar(s: Record<string, unknown>, t: string): Record<string, unknown> {
  const out: Record<string, unknown> = { type: t };
  const desc = typeof s.description === 'string' ? cleanServerText(s.description.split('\n')[0]!).slice(0, PARAM_DESCRIPTION_MAX) : '';
  if (desc) out.description = desc;
  // Aegis M1: an enum with any value the model should not read verbatim is left out of the narrow schema (the full
  // schema still enforces it at validation)
  if (Array.isArray(s.enum) && s.enum.length <= 64 && s.enum.every((e) => (typeof e === 'string' && SAFE_ENUM_VALUE.test(e)) || (typeof e === 'number' && Number.isFinite(e)) || typeof e === 'boolean')) out.enum = [...s.enum];
  return out;
}

/**
 * Aegis M2: read ONLY when readOnlyHint is true AND openWorldHint is false (a read of the outside world is not a local
 * read); a read-only tool that may reach the open world is mutate; otherwise a missing destructiveHint counts as
 * destructive (MCP's own default), destructiveHint false is mutate. Trust `enabled` (or no annotations) is mutate.
 */
function classOf(a: unknown, trust: ServerTrust): ToolBrokerClass {
  if (trust === 'enabled' || !isObj(a)) return 'mutate';
  if (a.readOnlyHint === true) return a.openWorldHint === false ? 'read' : 'mutate';
  return a.destructiveHint === false ? 'mutate' : 'destructive';
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
  // Aegis L4: per-op annotations may make an op of a destructive parent weaker (mutate, even read) ONLY for a
  // first-party server; a merely trusted server's op of a destructive tool stays destructive
  if (ann) return parent === 'destructive' && trust !== 'first-party' ? 'destructive' : classOf(ann, trust);
  return parent === 'destructive' ? 'destructive' : 'mutate';
}

/**
 * Narrow one server's tools/list (`{tools}` or the array). Never throws: a malformed tool yields no entry. Order: the
 * list's order, a split tool's ops in enum order.
 */
export function narrow(list: { tools?: unknown } | readonly unknown[], server: string, o: NarrowOptions = {}): CapabilityEntry[] {
  const trust = o.trust ?? 'enabled';
  // slice C5'a1 (trap: trust flapping): an op-annotations RESOURCE counts for the first-party server only; a trusted
  // server's per-op classes come from its tools/list _meta map alone
  const resourceAnn = trust === 'first-party' ? parseOpAnnotations(o.opAnnotations) : null;
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
    const rootKw = Object.keys(schema).find((k) => !SCHEMA_KEYWORDS.includes(k));
    if (rootKw !== undefined) w.humanOnly ??= `the schema uses ${rootKw}, which the kernel validator does not check`;
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
 * C2' offer rule (slice C3' replaced it in LocalLane with #tool-selector, which keeps this slot): the brokered tools' share of the context target. The kernel verbs come
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
    // Aegis L3: a server tool never takes a kernel verb's name or the gnomon_ prefix
    if (e.humanOnly || taken.has(e.name) || /^gnomon_/i.test(e.name) || fixed.length + chosen.length >= MAX_OFFERED) continue;
    const cost = compactSurfaceTokens([e]);
    if (used + cost > slot) continue;
    used += cost;
    taken.add(e.name);
    chosen.push(e);
  }
  return chosen;
}

// ── slice C4'a (#local-tool-tier): the FULL form of a capability entry (tier 3) ────────────────────────────────────

/**
 * gnomon-local BROKER_LIMITS.parametersBytes (the child refuses a tools_set whose parameters are larger), duplicated
 * here; a parity test keeps them equal.
 */
export const BROKER_PARAMETERS_BYTES = 16 * 1024;
/** A full-form tool's surface may take at most this many tokens. */
export const FULL_TOOL_MAX_TOKENS = 800;
/** Schema nesting a full-form tool may have. */
export const FULL_SCHEMA_MAX_DEPTH = 6;

export type ToolForm = 'narrow' | 'full';

/**
 * The FULL parameters of an entry: an unsplit tool's original inputSchema; a split `<tool>.<op>`'s original schema
 * MINUS its op param (the op stays kernel-fixed). A copy: the entry is never changed.
 */
export function fullParameters(e: Pick<CapabilityEntry, 'schema' | 'opParam'>): Record<string, unknown> {
  const s = structuredClone(e.schema);
  if (e.opParam !== null) {
    if (isObj(s.properties)) {
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(s.properties)) if (k !== e.opParam) props[k] = v;
      s.properties = props;
    }
    if (Array.isArray(s.required)) s.required = s.required.filter((r) => r !== e.opParam);
  }
  return s;
}

const SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']);
/** Text a full schema may carry: bounded, unchanged by cleanServerText, and no template-token shape. */
const clean = (t: unknown): boolean => typeof t === 'string' && t.length <= 2048 && cleanServerText(t) === t && !tokenShape(t);
const cleanValue = (v: unknown): boolean => v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 256 && clean(v));

/** Why a schema node cannot be offered in full, or null (every keyword the validator checks, clean text, bounded depth). */
function fullSchemaRefusal(s: unknown, depth: number, at: string): string | null {
  if (!isObj(s)) return `${at} is not a schema object`;
  if (depth > FULL_SCHEMA_MAX_DEPTH) return `${at} is nested deeper than ${FULL_SCHEMA_MAX_DEPTH}`;
  const kw = Object.keys(s).find((k) => !SCHEMA_KEYWORDS.includes(k));
  if (kw !== undefined) return `${at} uses ${kw.slice(0, 32)}, which the kernel validator does not check`;
  for (const k of ['description', 'title', '$schema']) if (Object.hasOwn(s, k) && !clean(s[k])) return `${at}.${k} is text the kernel would rewrite`;
  if (Object.hasOwn(s, 'type')) {
    const ts = typeof s.type === 'string' ? [s.type] : Array.isArray(s.type) ? s.type : null;
    if (!ts || !ts.length || ts.some((t) => typeof t !== 'string' || !SCHEMA_TYPES.has(t))) return `${at}.type is not a known type`;
  }
  if (Object.hasOwn(s, 'enum') && (!Array.isArray(s.enum) || s.enum.length > 64 || !s.enum.every(cleanValue))) return `${at}.enum holds a value the model should not read verbatim`;
  if (Object.hasOwn(s, 'default') && !cleanValue(s.default)) return `${at}.default is not a clean primitive`;
  if (Object.hasOwn(s, 'pattern')) {
    // Aegis C4'a M1: the pattern reaches the model verbatim: clean text, no template token
    if (typeof s.pattern !== 'string' || UNSAFE_CHAR.test(s.pattern) || !clean(s.pattern)) return `${at}.pattern is not plain text`;
    if (unsafePattern(s.pattern)) return `${at}.pattern is unsafe`;
  }
  // Aegis C4'a M1: each required name is a carriable property name of THIS node's properties (never free text)
  if (Object.hasOwn(s, 'required')) {
    const props = isObj(s.properties) ? s.properties : {};
    if (!Array.isArray(s.required) || !s.required.every((r) => typeof r === 'string' && PROP_NAME_RE.test(r) && !FORBIDDEN_KEYS.has(r) && Object.hasOwn(props, r))) return `${at}.required is not a list of this object's property names`;
  }
  for (const k of ['minLength', 'maxLength', 'maxItems']) if (Object.hasOwn(s, k) && !(Number.isSafeInteger(s[k]) && (s[k] as number) >= 0)) return `${at}.${k} is not a count`;
  if (Object.hasOwn(s, 'properties')) {
    if (!isObj(s.properties)) return `${at}.properties is not an object`;
    for (const [k, v] of Object.entries(s.properties)) {
      if (!PROP_NAME_RE.test(k) || FORBIDDEN_KEYS.has(k)) return `${at} has a property name the kernel cannot carry`;
      const r = fullSchemaRefusal(v, depth + 1, `${at}.${k}`);
      if (r) return r;
    }
  }
  if (Object.hasOwn(s, 'items')) {
    const r = fullSchemaRefusal(s.items, depth + 1, `${at}[]`);
    if (r) return r;
  }
  if (Object.hasOwn(s, 'additionalProperties') && typeof s.additionalProperties !== 'boolean') {
    const r = fullSchemaRefusal(s.additionalProperties, depth + 1, `${at}.*`);
    if (r) return r;
  }
  return null;
}

/** The full-form surface of one entry (what the child shows under surface 'full'). */
export function fullSurface(e: Pick<CapabilityEntry, 'name' | 'description' | 'schema' | 'opParam'>): { name: string; description: string; parameters: Record<string, unknown> } {
  return { name: e.name, description: e.description, parameters: fullParameters(e) };
}

const fullWhy = new WeakMap<object, string | null>();
// Aegis C4'a M1 sweep: every string a full schema carries is one of description / title / $schema / pattern (clean()),
// enum and default primitives (cleanValue, at every depth), type names (SCHEMA_TYPES), property and required names
// (PROP_NAME_RE); any other keyword (format, const, examples…) is outside SCHEMA_KEYWORDS and refuses the full form.

/**
 * Why an entry cannot be offered in its FULL form, or null when it can (fullOfferable): every keyword at every depth is
 * one validateBrokeredArgs checks (no $ref/oneOf/anyOf/allOf/not/if/patternProperties…), depth at most
 * FULL_SCHEMA_MAX_DEPTH, no __proto__/constructor/prototype (or otherwise uncarriable) property name, the name a model
 * tool name, the parameters at most BROKER_PARAMETERS_BYTES and the surface at most FULL_TOOL_MAX_TOKENS, and EVERY
 * description, title, enum and default string unchanged by cleanServerText. Memoised per entry object.
 */
export function fullRefusal(e: Pick<CapabilityEntry, 'name' | 'description' | 'schema' | 'opParam'>): string | null {
  if (fullWhy.has(e)) return fullWhy.get(e)!;
  const why = ((): string | null => {
    if (!TOOL_NAME_RE.test(e.name)) return 'the tool name does not fit a model tool name';
    if (!isObj(e.schema) || e.schema.type !== 'object') return 'the schema is not an object schema';
    const p = fullParameters(e);
    const r = fullSchemaRefusal(p, 0, 'arguments');
    if (r) return r;
    let bytes: number;
    try {
      bytes = Buffer.byteLength(JSON.stringify(p), 'utf8');
    } catch {
      return 'the schema is not plain JSON';
    }
    if (bytes > BROKER_PARAMETERS_BYTES) return `the schema is over ${BROKER_PARAMETERS_BYTES} bytes`;
    if (surfaceTokens([{ name: e.name, description: e.description, parameters: p }], 'full') > FULL_TOOL_MAX_TOKENS) return `the full tool is over ${FULL_TOOL_MAX_TOKENS} tokens`;
    return null;
  })();
  fullWhy.set(e, why);
  return why;
}

export const fullOfferable = (e: Pick<CapabilityEntry, 'name' | 'description' | 'schema' | 'opParam'>): boolean => fullRefusal(e) === null;

/**
 * The form an entry is offered in: 'full' when the session takes full forms (tier 3, surface full) and the entry is
 * fullOfferable; else its narrow form; null when it has none (a human-only entry that is not fullOfferable at tier 3,
 * or any human-only entry below it).
 */
export function offeredForm(e: Pick<CapabilityEntry, 'name' | 'description' | 'schema' | 'opParam' | 'humanOnly'>, full: boolean): ToolForm | null {
  if (full && fullOfferable(e)) return 'full';
  return e.humanOnly ? null : 'narrow';
}

/** An entry's parameters in a form. */
export const parametersIn = (e: Pick<CapabilityEntry, 'parameters' | 'schema' | 'opParam'>, form: ToolForm): Record<string, unknown> => (form === 'full' ? fullParameters(e) : e.parameters);

/**
 * Surface tokens of a set of tools under the child's surface ('compact': names, one-line descriptions, property types;
 * 'full': name, description and parameters as given): ceil(chars / 4), the child's estimate (agent.ts).
 */
export function surfaceTokens(tools: ReadonlyArray<Pick<CapabilityEntry, 'name' | 'description' | 'parameters'>>, form: 'compact' | 'full'): number {
  if (form === 'compact') return compactSurfaceTokens(tools);
  return Math.ceil(JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))).length / 4);
}

/**
 * A FULL-form call's args → the call: an op-param key is refused (the op is kernel-fixed), the op is set, and the result
 * is validated against the FULL schema (validateBrokeredArgs, its safe-regex gate included). Own properties only.
 */
export function reassembleFull(entry: Pick<CapabilityEntry, 'op' | 'opParam' | 'schema' | 'name'>, args: unknown): { args: Record<string, unknown> } | { error: string } {
  if (!isObj(args)) return { error: 'arguments must be a JSON object' };
  if (entry.opParam !== null && Object.hasOwn(args, entry.opParam)) return { error: `${entry.opParam} is fixed by the kernel` };
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(args)) define(out, k, args[k]);
  if (entry.opParam !== null && entry.op !== null) define(out, entry.opParam, entry.op);
  const bad = validateBrokeredArgs(entry.schema, out);
  if (bad) return { error: bad };
  return { args: out };
}

/**
 * The names a local session already holds (gnomon-local compat.ts TOOL_ORDER natives + the memory tools + find_tool): a narrow
 * tool by one of these names is never offered (the child refuses a tools_set naming one). Kept in step by a test.
 */
export const LOCAL_RESERVED_TOOL_NAMES: readonly string[] = Object.freeze(['list_dir', 'read_file', 'read_section', 'grep', 'outline', 'edit', 'write_file', 'note', 'forget', 'find_tool']);
