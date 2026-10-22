/**
 * @symbol #loop-schema
 *
 * #loop-schema, the compiled form's check (docs/specs/gnomon-loops.md §4 #loop-registry; build plan LP2). The kernel
 * reads only `<id>.loop.json` and NEVER trusts it: validateCompiledLoop lifts the compiled form back to a `loop:v2`
 * definition (decompile), runs the full validator on it (closed shape, argv rules, goals, the 8.0 subset), compiles
 * it again with the file's own resolved inputs (its budgets as the defaults, its flowPaths as the flow index, its
 * argv0Interpreter fields as the shebang reader) and requires the two canonical forms to be byte-identical. A field
 * the validator does not know, a value the compile would not produce or a hand-edited default is therefore refused.
 *
 * Not compared (the kernel recomputes them): `protected` (the registry rebuilds it from the call chain and the
 * config closure) and `compiled.callsResolved`. `compiled.sourceHash` is carried as a label only: it is inside the
 * content hash the human trusts, and a call pin resolves against the TRUSTED callee's value (registry.ts).
 *
 * Pure: never reads the filesystem. Call pins and the cross-loop call graph are the registry's to check (the
 * validator's pin check compares against source YAML the kernel never sees).
 */
import { canonicalJson } from '@a-company/gnomon-contracts';
import {
  compileLoop,
  LOOP_COMPILED_VERSION,
  LOOP_SCHEMA,
  type CompiledLoop,
  type LoopBudgets,
  type LoopIssue,
} from './schema.js';

export interface CompiledValidation {
  ok: boolean;
  errors: LoopIssue[];
  /** The normalized compiled loop (the re-compile), when ok. Its `protected` is the loop's OWN set (no callees). */
  compiled?: CompiledLoop;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const SHA_HEX = /^[0-9a-f]{64}$/;
const COMPILED_KEYS = ['schema', 'compiled', 'id', 'title', 'scope', 'repo', 'flows', 'flowPaths', 'triggers', 'autonomy', 'notify', 'decide', 'budgets', 'goal', 'land', 'start', 'nodes', 'protected'];

const fail = (path: string, code: string, message: string): CompiledValidation => ({ ok: false, errors: [{ path, code, message }] });

/** The compiled form back to a loop:v2 definition (defaults kept explicit, where the validator accepts them). */
function decompile(c: Obj): Obj {
  const d: Obj = { schema: c.schema, id: c.id };
  if (c.title !== undefined) d.title = c.title;
  if (c.repo !== undefined) d.repo = c.repo;
  if (Array.isArray(c.flows) && c.flows.length) d.flows = c.flows;
  if (Array.isArray(c.triggers)) {
    d.triggers = c.triggers.map((t: unknown) => {
      if (!isObj(t)) return t;
      if (t.type === 'schedule') {
        const s: Obj = {};
        for (const k of ['every', 'daily', 'weekly']) if (t[k] !== undefined) s[k] = t[k];
        return { schedule: s, catchUp: t.catchUp };
      }
      if (t.type === 'event') {
        const e: Obj = { kind: t.kind };
        for (const k of ['flow', 'loop', 'node']) if (t[k] !== undefined) e[k] = t[k];
        return { event: e, debounce: t.debounceSec };
      }
      if (t.type === 'continuous') return { continuous: { cooldown: t.cooldownSec } };
      return t;
    });
  }
  for (const k of ['autonomy', 'notify', 'decide', 'budgets', 'land', 'start']) if (c[k] !== undefined) d[k] = c[k];
  if (isObj(c.goal)) {
    const g: Obj = { node: c.goal.node, verdict: c.goal.verdict };
    if (!(Array.isArray(c.goal.inputs) && c.goal.inputs.length === 0)) g.inputs = c.goal.inputs;
    d.goal = g;
  } else if (c.goal !== undefined) d.goal = c.goal;
  if (Array.isArray(c.nodes)) {
    d.nodes = c.nodes.map((n: unknown) => {
      if (!isObj(n)) return n;
      const out: Obj = { ...n };
      if (n.type === 'check') delete out.argv0Interpreter;
      if (n.type === 'call') {
        delete out.callee;
        delete out.hash8;
      }
      return out;
    });
  } else d.nodes = c.nodes;
  return d;
}

/** The parts of a compiled loop the compare covers (`protected` and the compile meta are the kernel's own). */
function comparable(c: Obj): string {
  const o: Obj = { ...c };
  delete o.protected;
  const meta = isObj(c.compiled) ? { version: c.compiled.version, flowsResolved: c.compiled.flowsResolved } : c.compiled;
  o.compiled = meta;
  return canonicalJson(o);
}

/**
 * Re-validate a parsed `<id>.loop.json` (see the header). `scope` is where the registry found it; `fileId` the file
 * name's id (they must agree with the content).
 */
export function validateCompiledLoop(value: unknown, opts: { scope: 'repo' | 'personal'; fileId?: string }): CompiledValidation {
  if (!isObj(value)) return fail('', 'BAD_TYPE', 'a compiled loop is a JSON object');
  for (const k of Object.keys(value)) if (!COMPILED_KEYS.includes(k)) return fail(k, 'UNKNOWN_KEY', `unknown key "${k}" in a compiled loop`);
  if (value.schema !== LOOP_SCHEMA) return fail('schema', 'BAD_SCHEMA', `schema must be "${LOOP_SCHEMA}"`);
  const meta = value.compiled;
  if (!isObj(meta) || meta.version !== LOOP_COMPILED_VERSION || typeof meta.flowsResolved !== 'boolean' || typeof meta.callsResolved !== 'boolean') {
    return fail('compiled', 'BAD_COMPILED', `compiled is {version: ${LOOP_COMPILED_VERSION}, flowsResolved, callsResolved, sourceHash?}`);
  }
  for (const k of Object.keys(meta)) if (!['version', 'flowsResolved', 'callsResolved', 'sourceHash'].includes(k)) return fail(`compiled.${k}`, 'UNKNOWN_KEY', `unknown key "${k}" in compiled`);
  if (meta.sourceHash !== undefined && (typeof meta.sourceHash !== 'string' || !SHA_HEX.test(meta.sourceHash))) return fail('compiled.sourceHash', 'BAD_HASH', 'compiled.sourceHash is 64 lowercase hex');
  if (value.scope !== opts.scope) return fail('scope', 'BAD_SCOPE', `this loop was found in ${opts.scope} scope but says ${String(value.scope)}`);
  if (opts.fileId !== undefined && value.id !== opts.fileId) return fail('id', 'FILE_ID_MISMATCH', `id "${String(value.id)}" must match the file name (${opts.fileId}.loop.json)`);
  if (!Array.isArray(value.protected) || value.protected.some((p) => typeof p !== 'string')) return fail('protected', 'BAD_TYPE', 'protected is a list of path globs');
  if (!isObj(value.budgets)) return fail('budgets', 'BAD_TYPE', 'budgets is filled in a compiled loop');
  if (value.flowPaths !== undefined) {
    if (!isObj(value.flowPaths) || Object.values(value.flowPaths).some((g) => !Array.isArray(g) || g.some((x) => typeof x !== 'string'))) {
      return fail('flowPaths', 'BAD_TYPE', 'flowPaths maps each flow to a list of path globs');
    }
  }
  const interps = new Map<string, string>();
  if (Array.isArray(value.nodes)) {
    for (const n of value.nodes) {
      if (isObj(n) && n.type === 'check' && Array.isArray(n.run) && typeof n.run[0] === 'string' && typeof n.argv0Interpreter === 'string') {
        if (!interps.has(n.run[0])) interps.set(n.run[0], n.argv0Interpreter);
      }
    }
  }
  const def = decompile(value);
  const r = compileLoop(def, {
    scope: opts.scope,
    budgetDefaults: value.budgets as unknown as LoopBudgets,
    ...(value.flowPaths !== undefined ? { flowIndex: value.flowPaths as Record<string, string[]> } : {}),
    readShebang: (a0) => interps.get(a0) ?? null,
  });
  if (!r.ok || !r.compiled) return { ok: false, errors: r.errors.length ? r.errors : [{ path: '', code: 'BAD_COMPILED', message: 'the compiled loop does not compile again' }] };
  const again: CompiledLoop = { ...r.compiled, compiled: { ...r.compiled.compiled, ...(meta.sourceHash !== undefined ? { sourceHash: meta.sourceHash as string } : {}) } };
  if (meta.sourceHash === undefined) delete (again.compiled as { sourceHash?: string }).sourceHash;
  if (comparable(again as unknown as Obj) !== comparable(value)) {
    return fail('', 'NOT_CANONICAL', 'the compiled loop is not what its definition compiles to (hand-edited or from another compiler): run paradigm loop validate');
  }
  return { ok: true, errors: [], compiled: again };
}
