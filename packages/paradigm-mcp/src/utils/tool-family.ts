/**
 * Tool families — the 7.13 MCP surface cut (#tool-family).
 *
 * A family collapses N legacy `paradigm_<family>_<op>` tools into ONE listed tool
 * `paradigm_<family>({ op, ...params })`. The family never re-implements a
 * handler: it resolves `op` → the canonical LEGACY name and re-dispatches to the
 * existing handler with `op` stripped. The canonical legacy name is what lands in
 * breadcrumbs and `toolsCalled`, so every name-coupled consumer (habits, pm
 * postflight, nomination events) keeps working unchanged.
 *
 * Source of truth for the mapping: tools/legacy-tool-map.ts.
 */

import type { ToolDefinition } from './tool-registry.js';
import { LEGACY_TOOL_MAP, type LegacyToolTarget } from '../tools/legacy-tool-map.js';

/**
 * Property descriptions in family union schemas are trimmed to this many chars.
 * 0 = omitted: measured on this repo, even 15-char descriptions push the default
 * surface past the 8000-token budget (21 unions ≈ 300 properties). Per-op
 * required params are carried in the family description (`record(title,…)`)
 * and echoed by per-op validation errors instead.
 */
export const FAMILY_PROP_DESC_MAX = 0;
/** Anchor listing: description / property-description trim lengths. */
export const ANCHOR_DESC_MAX = 400;
export const ANCHOR_PROP_DESC_MAX = 80;

export interface FamilySpec {
  /** Listed tool name, e.g. 'paradigm_lore' */
  name: string;
  /** One-line family description (ops list is appended automatically) */
  description: string;
  /** op → canonical legacy tool name */
  ops: Record<string, string>;
  /** op used when the caller omits `op` (needed when family name == a legacy name) */
  defaultOp?: string;
  /** Override the property-description trim length (budget tuning) */
  propDescMax?: number;
  /**
   * Op signature detail in the family description:
   *   'full'     — every param, required marked `*`, nested shapes inline (default)
   *   'required' — only required params (budget fallback for low-traffic families)
   */
  signatures?: 'full' | 'required';
}

export interface ResolvedFamilyCall {
  legacy: string;
  args: Record<string, unknown>;
}

export interface ToolFamily {
  name: string;
  spec: FamilySpec;
  definition: ToolDefinition;
  /**
   * op -> the MCP hints that op's legacy definition DECLARES (ops declaring
   * none are absent). Served via the paradigm://tool-annotations resource,
   * never in tools/list.
   */
  opAnnotations: Record<string, OpAnnotations>;
  /** Resolve a family call to its legacy tool; returns `{ error }` on bad op / missing params. */
  resolve(args: Record<string, unknown>): ResolvedFamilyCall | { error: string };
}

type JsonSchemaProp = Record<string, unknown>;

function trim(text: unknown, max: number): string | undefined {
  if (typeof text !== 'string' || text.length === 0) return undefined;
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function propsOf(def: ToolDefinition | undefined): Record<string, JsonSchemaProp> {
  const schema = (def?.inputSchema ?? {}) as { properties?: Record<string, JsonSchemaProp> };
  return schema.properties ?? {};
}

function requiredOf(def: ToolDefinition | undefined): string[] {
  const schema = (def?.inputSchema ?? {}) as { required?: string[] };
  const req = Array.isArray(schema.required) ? schema.required : [];
  const defaulted = HANDLER_DEFAULTED[def?.name ?? ''];
  return defaulted ? req.filter(p => !defaulted.includes(p)) : req;
}

/**
 * Params a legacy schema lists as `required` but whose HANDLER supplies a
 * default when absent. Family validation must not reject these — the legacy
 * direct call never did (the MCP SDK does not enforce `required`). Audited
 * against the handlers for lore, purpose, task, decision, journal, protocol and
 * session tools (7.13.0); the only clear defaults found are protocol_record's
 * `(args.x || [])` fallbacks. Every other `required` param is left enforced:
 * its handler either has no fallback (writes `undefined` / throws) or returns
 * its own guidance error (lore_delete `confirm`, purpose_add_aspect `anchors`).
 */
export const HANDLER_DEFAULTED: Record<string, readonly string[]> = {
  paradigm_protocol_record: ['trigger', 'tags', 'steps'],
};

/**
 * Compact a property schema for a listed union. Every level keeps enum;
 * nested `items` / `properties` keep their SHAPE (property names + nested
 * `required`) with no descriptions, so a caller can build an array-of-objects
 * argument correctly. Only the top level carries a description, trimmed to
 * `max` chars (0 = none). Budget elisions (handlers still validate the full
 * shape): primitive leaf types inside nested objects, and `items` of plain
 * string arrays.
 */
function trimProp(prop: JsonSchemaProp, max: number, depth = 0, inObject = false): JsonSchemaProp {
  const out: JsonSchemaProp = {};
  const primitive = prop.type === 'string' || prop.type === 'number' || prop.type === 'boolean' || prop.type === 'integer';
  // Leaf fields of a nested object keep only name (+enum): the shape is what
  // matters and the budget can't carry per-leaf types. Handlers validate.
  if (prop.type !== undefined && !(inObject && primitive)) out.type = prop.type;
  if (Array.isArray(prop.enum)) out.enum = prop.enum;
  if (depth === 0) {
    const d = max > 0 ? trim(prop.description, max) : undefined;
    if (d) out.description = d;
  }
  if (prop.items && typeof prop.items === 'object' && !Array.isArray(prop.items)) {
    const items = prop.items as JsonSchemaProp;
    // Plain string arrays (~65 on the default surface) list as `{type:'array'}`:
    // string is the default element type and `items:{type:'string'}` alone costs
    // ~430 tokens. Object / enum / nested-array items keep their shape.
    const plainString = items.type === 'string' && !Array.isArray(items.enum);
    if (!plainString) out.items = trimProp(items, 0, depth + 1);
  }
  if (prop.properties && typeof prop.properties === 'object') {
    const nested: Record<string, JsonSchemaProp> = {};
    for (const [k, v] of Object.entries(prop.properties as Record<string, JsonSchemaProp>)) {
      nested[k] = trimProp(v, 0, depth + 1, true);
    }
    out.properties = nested;
    if (Array.isArray(prop.required) && prop.required.length > 0) out.required = prop.required;
  }
  return out;
}

/**
 * Compact param signature for one schema property: `name`, `name*` (required),
 * `name[{a*,b}]` (array of objects), `name{a*,b}` (object).
 */
function paramSig(name: string, prop: JsonSchemaProp, required: boolean): string {
  return `${name}${required ? '*' : ''}${shapeSig(prop)}`;
}

function shapeSig(prop: JsonSchemaProp): string {
  const items = prop.items as JsonSchemaProp | undefined;
  if (items && typeof items === 'object' && items.properties) return `[${objectSig(items)}]`;
  if (prop.properties) return objectSig(prop);
  return '';
}

function objectSig(prop: JsonSchemaProp): string {
  const req = new Set(Array.isArray(prop.required) ? (prop.required as string[]) : []);
  const inner = Object.entries((prop.properties ?? {}) as Record<string, JsonSchemaProp>)
    .map(([k, v]) => paramSig(k, v, req.has(k)));
  return `{${inner.join(',')}}`;
}

/**
 * Compact an anchor (single-tool) definition for listing: description trimmed
 * to `descMax`, property schemas compacted like family unions. Name, required
 * and annotations are untouched.
 */
export function compactDefinition(def: ToolDefinition, descMax: number, propDescMax: number): ToolDefinition {
  const schema = (def.inputSchema ?? {}) as { properties?: Record<string, JsonSchemaProp> };
  const properties: Record<string, JsonSchemaProp> = {};
  for (const [k, v] of Object.entries(schema.properties ?? {})) properties[k] = trimProp(v, propDescMax);
  const { aliases: _aliases, ...rest } = def;
  return {
    ...rest,
    description: trim(def.description, descMax) ?? def.description,
    inputSchema: { ...def.inputSchema, properties },
  };
}

/** Merge a second definition of the same property name into the union. */
function mergeProp(a: JsonSchemaProp, b: JsonSchemaProp): JsonSchemaProp {
  const out = { ...a };
  if (a.type !== b.type) {
    delete out.type;
    delete out.enum;
    delete out.items;
    return out;
  }
  if (Array.isArray(a.enum) || Array.isArray(b.enum)) {
    if (Array.isArray(a.enum) && Array.isArray(b.enum)) {
      out.enum = [...new Set([...(a.enum as unknown[]), ...(b.enum as unknown[])])];
    } else {
      delete out.enum;
    }
  }
  return out;
}

/**
 * Schema id of the per-op annotations document served at
 * OP_ANNOTATIONS_RESOURCE_URI. Generic (not Paradigm-specific): a client that
 * splits a family into one tool per op (Gnomon's kernel narrowing) reads it to
 * classify each op. Consumers treat an op MISSING from the map as a mutating op.
 * Kept out of tools/list so it costs model-facing listings nothing.
 */
export const OP_ANNOTATIONS_SCHEMA = 'io.gnomon/op-annotations:v1';
export const OP_ANNOTATIONS_RESOURCE_URI = 'paradigm://tool-annotations';

/** Document served at OP_ANNOTATIONS_RESOURCE_URI: family tool -> op -> declared hints. */
export interface OpAnnotationsDocument {
  schema: typeof OP_ANNOTATIONS_SCHEMA;
  tools: Record<string, Record<string, OpAnnotations>>;
}

/** The MCP tool-annotation hints carried per op (`title` is not a hint). */
export const OP_HINT_KEYS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const;
export type OpHintKey = typeof OP_HINT_KEYS[number];
export type OpAnnotations = Partial<Record<OpHintKey, boolean>>;

/** The boolean hints a legacy definition DECLARES; undefined when it declares none. */
export function declaredOpHints(def: ToolDefinition | undefined): OpAnnotations | undefined {
  const ann = (def?.annotations ?? {}) as Record<string, unknown>;
  const out: OpAnnotations = {};
  for (const k of OP_HINT_KEYS) if (typeof ann[k] === 'boolean') out[k] = ann[k] as boolean;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Family-level annotations that hold for EVERY op (conservative):
 *   readOnlyHint    true only if every op declares readOnlyHint: true;
 *   destructiveHint false only if every op declares destructiveHint: false or
 *                   is read-only (and not declared destructive) — an op that declares nothing gets
 *                   the MCP default (destructive), so it makes the family destructive;
 *   idempotentHint  published (true) only if every op declares it true;
 *   openWorldHint   true if any op declares it true, false only if every op
 *                   declares it false, otherwise omitted (MCP default applies).
 */
export function familyAnnotations(perOp: Array<OpAnnotations | undefined>): Record<string, boolean> {
  const all = (p: (a: OpAnnotations) => boolean) => perOp.every(a => a !== undefined && p(a));
  const out: Record<string, boolean> = {
    readOnlyHint: all(a => a.readOnlyHint === true),
    destructiveHint: !all(a => a.destructiveHint === false || (a.readOnlyHint === true && a.destructiveHint !== true)),
  };
  if (perOp.length > 0 && all(a => a.idempotentHint === true)) out.idempotentHint = true;
  if (perOp.some(a => a?.openWorldHint === true)) out.openWorldHint = true;
  else if (perOp.length > 0 && all(a => a.openWorldHint === false)) out.openWorldHint = false;
  return out;
}

/** `op(req*,opt,nested[{a*,b}])` — required params first; `op` alone when paramless. */
function opSignature(op: string, def: ToolDefinition | undefined, required: string[], detail: 'full' | 'required'): string {
  const props = propsOf(def);
  const req = new Set(required);
  const names = Object.keys(props);
  const ordered = [...names.filter(n => req.has(n)), ...(detail === 'full' ? names.filter(n => !req.has(n)) : [])];
  // Required params the schema lists but does not describe still show up.
  for (const r of required) if (!(r in props)) ordered.unshift(r);
  const sigs = ordered.map(n => paramSig(n, props[n] ?? {}, req.has(n)));
  return sigs.length ? `${op}(${sigs.join(',')})` : op;
}

/**
 * Build a family: listed definition (op enum + union of legacy properties) and
 * a resolver with per-op `required` validation.
 */
export function defineFamily(spec: FamilySpec, legacyDefs: Map<string, ToolDefinition>): ToolFamily {
  const max = spec.propDescMax ?? FAMILY_PROP_DESC_MAX;
  const opNames = Object.keys(spec.ops);
  const properties: Record<string, JsonSchemaProp> = {
    op: { type: 'string', enum: opNames },
  };
  const opSummaries: string[] = [];
  const perOp: Array<OpAnnotations | undefined> = [];
  const opAnnotations: Record<string, OpAnnotations> = {};

  for (const op of opNames) {
    const legacy = spec.ops[op];
    const def = legacyDefs.get(legacy);
    const req = requiredOf(def);
    opSummaries.push(opSignature(op, def, req, spec.signatures ?? 'full'));
    for (const [pname, pschema] of Object.entries(propsOf(def))) {
      if (pname === 'op') {
        throw new Error(`defineFamily(${spec.name}): legacy tool ${legacy} already declares an "op" property`);
      }
      const trimmed = trimProp(pschema, max);
      properties[pname] = properties[pname] ? mergeProp(properties[pname], trimmed) : trimmed;
    }
    // Only what the op itself declares; an op with no hints stays out of the map.
    const hints = declaredOpHints(def);
    perOp.push(hints);
    if (hints) opAnnotations[op] = hints;
  }

  const definition: ToolDefinition = {
    name: spec.name,
    description: `${spec.description} Ops${(spec.signatures ?? 'full') === 'full' ? ' (*=required)' : ''}: ${opSummaries.join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties,
      ...(spec.defaultOp ? {} : { required: ['op'] }),
    },
    annotations: familyAnnotations(perOp),
  };

  const describeOpParams = (op: string): string => {
    const def = legacyDefs.get(spec.ops[op]);
    const req = new Set(requiredOf(def));
    const params = Object.entries(propsOf(def)).map(([p, s]) => `${paramSig(p, s, req.has(p))} (${(s.type as string) ?? 'any'})`);
    return params.length ? params.join(', ') : '(no params)';
  };

  const resolve = (args: Record<string, unknown>): ResolvedFamilyCall | { error: string } => {
    const { op: rawOp, ...rest } = args ?? {};
    const op = (typeof rawOp === 'string' && rawOp) ? rawOp : spec.defaultOp;
    if (!op || !(op in spec.ops)) {
      return {
        error: `${spec.name}: ${op ? `unknown op '${op}'` : "missing required 'op'"}. Valid ops: ${opNames.join(', ')}.`,
      };
    }
    const legacy = spec.ops[op];
    const missing = requiredOf(legacyDefs.get(legacy)).filter(p => rest[p] === undefined || rest[p] === null);
    if (missing.length > 0) {
      return {
        error: `${spec.name} op '${op}' missing required: ${missing.join(', ')}. Params for '${op}': ${describeOpParams(op)} (* = required).`,
      };
    }
    return { legacy, args: rest };
  };

  return { name: spec.name, spec, definition, opAnnotations, resolve };
}

// ────────────────────────────────────────────────────────
// Map-derived helpers
// ────────────────────────────────────────────────────────

/** Group LEGACY_TOOL_MAP op entries by family tool name → { op: legacyName }. */
export function familyOpsFromMap(map: Record<string, LegacyToolTarget> = LEGACY_TOOL_MAP): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const [legacy, target] of Object.entries(map)) {
    if (!target.op) continue;
    const ops = out.get(target.tool) ?? {};
    ops[target.op] = legacy;
    out.set(target.tool, ops);
  }
  return out;
}

/** True when `name` is a legacy name that is NOT itself a current anchor/family name. */
export function isDeprecatedAlias(name: string): boolean {
  const target = LEGACY_TOOL_MAP[name];
  if (!target) return false;
  return target.tool !== name;
}

/**
 * Canonicalize a tool REFERENCE (habit `tools:` entries, allowlists…) to the
 * set of canonical legacy names it covers. Accepts:
 *   - legacy name              'paradigm_lore_record'        → ['paradigm_lore_record']
 *   - family+op                'paradigm_lore.record' | 'paradigm_lore:record'
 *                              | "paradigm_lore({op:'record'})"
 *   - bare family              'paradigm_lore'               → every legacy op of the family
 *   - anything else            returned as-is
 */
export function canonicalizeToolRef(ref: string): string[] {
  const s = ref.trim();
  if (LEGACY_TOOL_MAP[s] && !LEGACY_TOOL_MAP[s].op) return [s];
  const callForm = s.match(/^(paradigm_[a-z0-9_]+)\s*\(\s*\{\s*op\s*:\s*['"]([a-z0-9_]+)['"]/);
  const sepForm = s.match(/^(paradigm_[a-z0-9_]+)[.:]([a-z0-9_]+)$/);
  const m = callForm ?? sepForm;
  const families = familyOpsFromMap();
  if (m) {
    const legacy = families.get(m[1])?.[m[2]];
    if (legacy) return [legacy];
  }
  const fam = families.get(s);
  if (fam) {
    // A bare family name that is also a legacy name (paradigm_tags) keeps its legacy meaning too.
    const all = Object.values(fam);
    return LEGACY_TOOL_MAP[s] ? [...new Set([s, ...all])] : all;
  }
  return [s];
}
