/**
 * @symbol #loop-check
 *
 * The check node's pass rule (docs/specs/gnomon-loops.md §2 `pass`): `{ exit }`, `{ parse: tap|junit|tsc, failed }`
 * or `{ json: "$.path", op, value }` turns a finished child into `pass` or `fail`. Anything the rule cannot judge
 * (no recognisable report, a missing JSON path, a type mismatch on an ordering op) is `error`, never a guess:
 * a check verdict is typed and deterministic (§3.4). Pure: no I/O.
 */
import type { CheckPass } from '../../loops/schema.js';

export interface ParsedCounts {
  passed?: number;
  failed: number;
  total?: number;
}

export type RuleOutcome =
  | { verdict: 'pass' | 'fail'; counts?: ParsedCounts; value?: unknown }
  | { verdict: 'error'; reason: 'unparseable'; detail: string };

const unparseable = (detail: string): RuleOutcome => ({ verdict: 'error', reason: 'unparseable', detail });

/**
 * TAP (12, 13, 14): `ok` / `not ok` test points; `# SKIP` and `# TODO` never fail. Only the outermost level is
 * counted when it has test points (TAP 14 subtests are indented and their parent reports them again).
 */
export function parseTap(text: string): ParsedCounts | null {
  const lines = text.split(/\r?\n/);
  const points = (indented: boolean): { passed: number; failed: number } | null => {
    let passed = 0;
    let failed = 0;
    for (const l of lines) {
      const m = /^(\s*)(not ok|ok)\b(.*)$/.exec(l);
      if (!m || (!indented && m[1]!.length > 0)) continue;
      const directive = /#\s*(skip|todo)\b/i.test(m[3]!);
      if (m[2] === 'ok' || directive) passed++;
      else failed++;
    }
    return passed + failed > 0 ? { passed, failed } : null;
  };
  const top = points(false) ?? points(true);
  if (top) return { ...top, total: top.passed + top.failed };
  if (/^\s*1\.\.0\b/m.test(text)) return { passed: 0, failed: 0, total: 0 }; // an empty plan is a valid report
  if (/^\s*Bail out!/m.test(text)) return { passed: 0, failed: 1, total: 1 };
  return null;
}

function attr(tag: string, name: string): number | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*["'](\\d+)["']`).exec(tag);
  return m ? Number(m[1]) : null;
}

/** JUnit XML: `<testsuites>` totals, else the sum of `<testsuite>` totals, else counted `<testcase>` elements. */
export function parseJunit(text: string): ParsedCounts | null {
  const totals = (tag: string): ParsedCounts | null => {
    const tests = attr(tag, 'tests');
    const failures = attr(tag, 'failures');
    const errors = attr(tag, 'errors');
    if (tests === null && failures === null && errors === null) return null;
    const failed = (failures ?? 0) + (errors ?? 0);
    return { failed, ...(tests !== null ? { total: tests, passed: Math.max(0, tests - failed - (attr(tag, 'skipped') ?? 0)) } : {}) };
  };
  const root = /<testsuites\b[^>]*>/.exec(text);
  const fromRoot = root ? totals(root[0]) : null;
  if (fromRoot) return fromRoot;
  const suites = [...text.matchAll(/<testsuite\b[^>]*>/g)].map((m) => totals(m[0]));
  if (suites.length && suites.every((s) => s !== null)) {
    return suites.reduce<ParsedCounts>((a, s) => ({ failed: a.failed + s!.failed, ...(a.total !== undefined && s!.total !== undefined ? { total: a.total + s!.total, passed: (a.passed ?? 0) + (s!.passed ?? 0) } : {}) }), { failed: 0, total: 0, passed: 0 });
  }
  const cases = [...text.matchAll(/<testcase\b[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)];
  if (!cases.length) return null;
  const failed = cases.filter((c) => /<(failure|error)\b/.test(c[2] ?? '')).length;
  return { failed, total: cases.length, passed: cases.length - failed };
}

/** tsc: one `error TSnnnn:` per diagnostic (pretty or plain); `Found N errors` is the summary when present. */
export function parseTsc(text: string, exitCode: number | null): ParsedCounts | null {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
  const diags = (plain.match(/\berror TS\d+:/g) ?? []).length;
  const found = /Found (\d+) errors?\b/.exec(plain);
  const failed = found ? Math.max(Number(found[1]), diags) : diags;
  if (failed === 0 && exitCode !== 0) return null; // a non-zero tsc with no diagnostic is a crash, not a pass
  return { failed };
}

/** `$`, `$.a.b`, `$[0]`, `$.a[2].b` (the validator's JSONPath subset). undefined when the path is absent. */
export function jsonPathGet(doc: unknown, p: string): unknown {
  if (!/^\$(\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\])*$/.test(p)) return undefined;
  let cur: unknown = doc;
  for (const m of p.slice(1).matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)|\[(\d+)\]/g)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (m[1] !== undefined) {
      if (Array.isArray(cur) || !Object.prototype.hasOwnProperty.call(cur, m[1])) return undefined;
      cur = (cur as Record<string, unknown>)[m[1]];
    } else {
      if (!Array.isArray(cur)) return undefined;
      const idx = Number(m[2]);
      if (idx >= cur.length) return undefined;
      cur = cur[idx];
    }
  }
  return cur;
}

/** The JSON comparison: == and != on any literal (strict); ordering ops only number-number or string-string. */
export function compareJson(actual: unknown, op: string, value: unknown): boolean | null {
  if (op === '==') return actual === value;
  if (op === '!=') return actual !== value;
  const bothNum = typeof actual === 'number' && typeof value === 'number';
  const bothStr = typeof actual === 'string' && typeof value === 'string';
  if (!bothNum && !bothStr) return null;
  const a = actual as number | string;
  const b = value as number | string;
  switch (op) {
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    default: return null;
  }
}

/** Apply a check's pass rule to a child that EXITED (exit code known; crashes and timeouts never reach here). */
export function applyPassRule(rule: CheckPass, out: { exitCode: number; stdout: string }): RuleOutcome {
  if ('exit' in rule) return { verdict: out.exitCode === rule.exit ? 'pass' : 'fail' };
  if ('parse' in rule) {
    const counts = rule.parse === 'tap' ? parseTap(out.stdout) : rule.parse === 'junit' ? parseJunit(out.stdout) : parseTsc(out.stdout, out.exitCode);
    if (!counts) return unparseable(`no ${rule.parse} report in the check's output`);
    return { verdict: counts.failed <= rule.failed ? 'pass' : 'fail', counts };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(out.stdout);
  } catch {
    return unparseable("the check's output is not JSON");
  }
  const actual = jsonPathGet(doc, rule.json);
  if (actual === undefined) return unparseable(`${rule.json} is absent from the check's JSON output`);
  const r = compareJson(actual, rule.op, rule.value);
  if (r === null) return unparseable(`${rule.json} (${typeof actual}) cannot be compared with ${rule.op} ${JSON.stringify(rule.value)}`);
  const counts = typeof (doc as { failed?: unknown })?.failed === 'number' ? { failed: (doc as { failed: number }).failed, ...(typeof (doc as { passed?: unknown }).passed === 'number' ? { passed: (doc as { passed: number }).passed } : {}) } : undefined;
  return { verdict: r ? 'pass' : 'fail', value: actual, ...(counts ? { counts } : {}) };
}
