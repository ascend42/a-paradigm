/**
 * Honesty CI scanners (spec §9.7 law 2; M1.12 slice 3): G-HON-02, G-HON-05,
 * G-HON-06 and the docs half of G-HON-07, as pure functions over
 * {file, text} so test/honesty.test.ts can run them over the real tree (the
 * gate) AND over planted violations (the falsifier: the gate can fail).
 * G-HON-03 and the status half of G-HON-07 are checkStatusNumbers in
 * src/kernel/socket/status-numbers.ts. G-HON-01 is the compiler check
 * (symbols-drift); G-HON-04 is the fixed points (client-API doc, schemas,
 * display vectors, manifest packageHash).
 *
 * READINGS (where §9.7 leaves room, recorded in lore):
 *   G-HON-02  "no fabricated mechanisms": in shipped source (packages/gnomon*\/src,
 *             the mod-sdk example), `Math.random` outside an ids module; the
 *             words `simulated` / `simulation`; a `sleep(` or `delay(` (a fake
 *             wait — polling with setTimeout stays legal); a numeric literal
 *             assigned to a gain-like name (gain, speedup, uplift,
 *             improvement, savings, accuracy, successRate, winRate,
 *             confidence); and mechanism words the kernel does not have
 *             (neural, consensus, quantum, hive-mind, swarm intelligence,
 *             self-learning) — research 09/11: "no label implies a mechanism
 *             the code lacks".
 *   G-HON-05  "no Task-steering descriptions": a model-facing description
 *             (a `description:` / `title:` string in source, a manifest's
 *             `description` / `title`) never steers the model off its native
 *             tools or onto ours ("use this instead of Task", "always call",
 *             "prefer this tool", "Claude Code has no …") — research 09 #4.
 *   G-HON-06  "guard names state scope": a guard's name says WHAT it checks;
 *             an unscoped absolute (`isSafe`, `isSecure`, `isTrusted`,
 *             `isValid`, `assertSafe`, `checkSecurity`, …) is refused.
 *   G-HON-07  docs: EVERY number with a ms/µs unit — in prose, lists or
 *             Markdown table cells, keyword or not (round 2, B2) — is a latency
 *             claim unless it is a budget (a comparator or bound word right
 *             before it) or the line is about configured intervals (timeout,
 *             cadence, budget, TTL, …: the BUDGET EXEMPTION, a reading pending
 *             founder ratification). A claim names, on the same line or table
 *             row, a concrete machine (chip, versioned OS or arch — not "host")
 *             and a named method (hrtime, vitest/test:perf, a probe id or
 *             result file, n = …, over N runs). Scope: the Gnomon
 *             package docs (README, .purpose) and the generated client-API
 *             doc. The design spec docs/specs/gnomon.md is NOT scanned (stated
 *             residual: its measured lines cite probe arms and result files by
 *             prose, which a line rule cannot read).
 *   G-HON-08  (the `gnomon guide` check, spec §5 and §9.7; T-2026-10-19-015 —
 *             the spec assigns the id "when T-2026-10-19-015 builds it"; the
 *             spec text is not yet amended, so the id is named here): a guide
 *             topic that names a verb, flag or refusal reason the frozen
 *             descriptors lack fails. scanGuides reads the guide markup
 *             (src/cli/guide-topics.ts): every backtick span must classify —
 *             `verb`, `verb{param, param:value}` (each param declared by that
 *             verb), `CODE`, `CODE{reason}`, `gnomon guide <topic>`, or a
 *             term the descriptors name (a param, gate, retriability, card
 *             kind/state/decision/flag, additive-enum value, event kind,
 *             refusal key, schema id). A `--flag` anywhere is a finding (no
 *             frozen descriptor lists CLI flags). Outside backticks, a dotted
 *             identifier must be a verb, relay or event kind, and an all-caps
 *             token a refusal code. Durations go through scanLatencyDocs.
 */

import {
  ADDITIVE_ENUMS,
  CARD_DECISIONS,
  CARD_FLAGS,
  CARD_KINDS,
  CARD_STATES,
  CARD_V1,
  CLIENT_RELAYS,
  EVENT_KIND_NAMES,
  EVENT_V1,
  REFUSAL_CODES,
  REFUSAL_GATES,
  REFUSAL_POINTER_KEYS,
  REFUSAL_REASONS,
  REFUSAL_SCHEMA,
  REFUSAL_V1_KEYS,
  RESERVED_REASON_ROUTES,
  RETRIABILITIES,
  VERBS,
} from '@a-company/gnomon-contracts';

export interface HonestyFinding {
  rule: 'G-HON-02' | 'G-HON-05' | 'G-HON-06' | 'G-HON-07' | 'G-HON-08';
  file: string;
  line: number;
  detail: string;
}

export interface SourceText {
  file: string;
  text: string;
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

const FABRICATION: ReadonlyArray<{ re: RegExp; detail: string; skip?: (file: string) => boolean }> = [
  { re: /\bMath\.random\b/g, detail: 'Math.random outside an ids module (use node:crypto)', skip: (f) => /(^|\/)ids\.[cm]?[jt]s$/.test(f) },
  { re: /\bsimulat(ed|ion)\b/gi, detail: 'the word "simulated"/"simulation" in shipped source' },
  { re: /\b(sleep|delay)\s*\(/g, detail: 'a sleep()/delay() call: a fake wait' },
  { re: /\b(gain|speedup|uplift|improvement|savings|accuracy|successRate|winRate|confidence)\w*\s*[:=]\s*-?\d/gi, detail: 'a hardcoded gain-like number' },
  { re: /\b(neural|consensus|quantum|hive-?mind|swarm[ -]intelligence|self-learning)\b/gi, detail: 'a mechanism word the code does not implement' },
];

/** G-HON-02 over shipped source. */
export function scanFabrication(files: readonly SourceText[]): HonestyFinding[] {
  const out: HonestyFinding[] = [];
  for (const f of files) {
    for (const r of FABRICATION) {
      if (r.skip?.(f.file)) continue;
      for (const m of f.text.matchAll(r.re)) out.push({ rule: 'G-HON-02', file: f.file, line: lineOf(f.text, m.index), detail: `${r.detail}: ${m[0]}` });
    }
  }
  return out;
}

const STEERING: readonly RegExp[] = [
  /\b(instead of|rather than|replaces?|better than)\b[^.]{0,40}\b(Task|native|built-?in|Agent tool|subagent)\b/i,
  /\b(always|must|should)\s+(use|call|prefer|invoke)\b/i,
  /\bprefer (this|these|gnomon|it)\b/i,
  /\buse (this|me|it) (when|whenever|instead|first|before)\b/i,
  /\b(do not|don't|never) use (the )?(Task|native|built-?in|Agent)\b/i,
  /\bClaude Code (has no|lacks|cannot|can't)\b/i,
  /\bIMPORTANT:/,
];

/** Model-facing descriptions in a source or manifest text: `description`/`title` string values. */
export function descriptionsIn(f: SourceText): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  const re = /["']?(description|title)["']?\s*:\s*(["'`])((?:\\.|(?!\2).)*)\2/g;
  for (const m of f.text.matchAll(re)) out.push({ text: m[3]!, line: lineOf(f.text, m.index) });
  return out;
}

/** G-HON-05 over sources and manifests. */
export function scanSteering(files: readonly SourceText[]): HonestyFinding[] {
  const out: HonestyFinding[] = [];
  for (const f of files) {
    for (const d of descriptionsIn(f)) {
      const hit = STEERING.find((re) => re.test(d.text));
      if (hit) out.push({ rule: 'G-HON-05', file: f.file, line: d.line, detail: `a steering description: ${JSON.stringify(d.text.slice(0, 120))}` });
    }
  }
  return out;
}

const UNSCOPED_GUARD = /\b(?:function\s+|const\s+|let\s+|(?:async\s+)?)(is|assert|ensure|check|verify|require|guard)(Safe|Secure|Trusted|Valid|Allowed|Ok|OK|Authorized|Protected|Security|Everything|All)\s*[=(<]/g;

/** G-HON-06: a guard's name states its scope. */
export function scanGuardNames(files: readonly SourceText[]): HonestyFinding[] {
  const out: HonestyFinding[] = [];
  for (const f of files) {
    for (const m of f.text.matchAll(UNSCOPED_GUARD)) {
      out.push({ rule: 'G-HON-06', file: f.file, line: lineOf(f.text, m.index), detail: `the guard ${m[1]}${m[2]} does not say what it checks` });
    }
  }
  return out;
}

/** Any number with a millisecond / microsecond unit, anywhere on a line (prose, list or table cell). */
const LATENCY = /(?<![\w.])\d+(?:[.,]\d+)?\s?(?:ms|µs|us)\b/g;
/** A budget, bound or configured interval rather than a measurement: a comparator or bound word right before the number (BUDGET_BEFORE), or a config word within the 60 characters before it (CONFIG_LINE). */
const BUDGET_BEFORE = /(?:[<>≤≥]|\b(?:under|below|over|above|within|budget|target|max(?:imum)?|min(?:imum)?|at most|at least|up to|every|after|default)\b)\s*(?:[\w-]+\s+){0,2}$/i;
/** A config word right AFTER the number ("50 ms after the first", "500 ms debounce", "5 ms falsifier"). */
const CONFIG_AFTER = /^\s*(?:\/\w+\s+)?(after|before|debounce|timeout|cadence|interval|window|budget|falsifier|deadline|ttl|idle|grace|poll)/i;
const CONFIG_LINE = /\b(timeouts?|interval|cadence|deadline|budget|debounce|ttl|idle|cap|limit|falsifier|fails? if|threshold|window)\b/i;
/** A concrete machine: a chip, an OS with a version or an arch (round 2: "host" and bare "machine" no longer count). */
const MACHINE = /\b(Apple M[1-5](?: (?:Pro|Max|Ultra))?|M[1-5] (?:Pro|Max|Ultra)|Intel (?:Core|Xeon)\b|Ryzen|arm64|aarch64|x86_64|x64|macOS \d+|darwin-(?:arm64|x64)|Ubuntu \d+|Windows (?:10|11)|win32-(?:x64|arm64)|linux-(?:x64|arm64))\b/i;
/** A named method: a harness, a clock, a probe id or result file, or a sample count. */
const METHOD = /\b(hrtime|performance\.now|vitest|test:perf|probes\/results\/[\w.-]+|p\d{2}[a-z]?-[a-z0-9-]+|p-[a-z0-9-]+|arm [A-Z]\d?|n ?= ?\d+|over \d[\d,⁰¹²³⁴⁵⁶⁷⁸⁹×^]* (?:runs|events|appends|samples|calls|iterations|rows))\b/i;

/** G-HON-07 docs half: a measured latency line names its method and machine. */
/** Logical units of a doc: each Markdown table row on its own; otherwise a paragraph (wrapped lines joined), with its first line number. */
function docUnits(text: string): Array<{ text: string; line: number; row: boolean }> {
  const out: Array<{ text: string; line: number; row: boolean }> = [];
  let para: string[] = [];
  let start = 0;
  const flush = (): void => {
    if (para.length) out.push({ text: para.join(' '), line: start, row: false });
    para = [];
  };
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('|')) {
      flush();
      out.push({ text: line, line: i + 1, row: true });
    } else if (!line) flush();
    else {
      if (!para.length) start = i + 1;
      para.push(line);
    }
  });
  flush();
  return out;
}

/** The sentence of a paragraph holding index `at` (a table row is its own scope: row-wide). */
function scopeOf(u: { text: string; row: boolean }, at: number): string {
  if (u.row) return u.text;
  const ends = [...u.text.matchAll(/[.;!?]\s+(?=[A-Z(`*_[]|$)/g)].map((m) => m.index + 1);
  let from = 0;
  for (const e of ends) {
    if (e > at) return u.text.slice(from, e);
    from = e;
  }
  return u.text.slice(from);
}

export function scanLatencyDocs(files: readonly SourceText[]): HonestyFinding[] {
  const out: HonestyFinding[] = [];
  for (const f of files) {
    for (const u of docUnits(f.text)) {
      for (const m of u.text.matchAll(LATENCY)) {
        const before = u.text.slice(Math.max(0, m.index - 60), m.index);
        if (BUDGET_BEFORE.test(before) || CONFIG_LINE.test(before) || CONFIG_AFTER.test(u.text.slice(m.index + m[0].length))) continue; // a budget, bound or configured interval: the BUDGET EXEMPTION
        const scope = scopeOf(u, m.index);
        if (!MACHINE.test(scope) || !METHOD.test(scope)) out.push({ rule: 'G-HON-07', file: f.file, line: u.line, detail: `a latency number without a named method and a concrete machine: ${m[0]} in "${scope.slice(0, 100)}"` });
      }
    }
  }
  return out;
}

/* ── G-HON-08: the `gnomon guide` check ─────────────────────────────────── */

export interface GuideText {
  id: string;
  summary: string;
  body: string;
}

const stripOpt = (p: string): string => p.replace(/\?$/, '');
const GUIDE_PARAMS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ...VERBS.map((v) => [v.verb, new Set(v.params.map(stripOpt))] as const),
  ...CLIENT_RELAYS.map((r) => [r.relay, new Set(r.params.map(stripOpt))] as const),
]);
const GUIDE_CODES: ReadonlySet<string> = new Set(REFUSAL_CODES);
const GUIDE_REASONS: ReadonlySet<string> = new Set([...REFUSAL_REASONS, ...Object.keys(RESERVED_REASON_ROUTES)]);
const GUIDE_DOTTED: ReadonlySet<string> = new Set([...GUIDE_PARAMS.keys(), ...EVENT_KIND_NAMES]);
const GUIDE_TERMS: ReadonlySet<string> = new Set<string>([
  ...[...GUIDE_PARAMS.values()].flatMap((s) => [...s]),
  ...GUIDE_REASONS,
  ...REFUSAL_GATES,
  ...RETRIABILITIES,
  ...REFUSAL_V1_KEYS,
  ...REFUSAL_POINTER_KEYS,
  ...CARD_KINDS,
  ...CARD_STATES,
  ...CARD_DECISIONS,
  ...CARD_FLAGS,
  ...Object.values(ADDITIVE_ENUMS).flatMap((v) => [...(v as readonly string[])]),
  REFUSAL_SCHEMA,
  CARD_V1,
  EVENT_V1,
  ...VERBS.map((v) => v.result).filter((r) => /^[a-z-]+:v\d+$/.test(r)),
]);

/** Classify one backtick span; returns why it fails, or undefined when the descriptors name it. */
function guideSpanProblem(span: string, topicIds: ReadonlySet<string>): string | undefined {
  const s = span.trim();
  if (/(^|\s)--[a-z]/i.test(s)) return `a CLI flag no frozen descriptor lists: ${s}`;
  const cli = /^gnomon guide(?: (\S+))?$/.exec(s);
  if (cli) return cli[1] === undefined || cli[1] === '<topic>' || topicIds.has(cli[1]) ? undefined : `an unknown guide topic: ${s}`;
  if (/^gnomon\b/.test(s)) return `a CLI command the guide check cannot verify: ${s}`;
  const call = /^([A-Za-z_][\w.]*)\{(.*)\}$/.exec(s);
  if (call) {
    const [, head, inner] = call as unknown as [string, string, string];
    if (GUIDE_CODES.has(head)) {
      const reason = inner.trim().replace(/^reason\s*:\s*/, '').replace(/^['"]|['"]$/g, '');
      return GUIDE_REASONS.has(reason) ? undefined : `a refusal reason the descriptors lack: ${head}{${reason}}`;
    }
    const params = GUIDE_PARAMS.get(head);
    if (!params) return `a verb the descriptors lack: ${head}`;
    for (const part of inner.split(',').map((x) => x.trim()).filter(Boolean)) {
      const key = part.split(':')[0]!.trim();
      if (!params.has(key)) return `a param ${head} does not declare: ${key}`;
    }
    return undefined;
  }
  if (GUIDE_PARAMS.has(s)) return undefined; // a verb or relay by name
  if (/^[A-Z][A-Z_]+$/.test(s)) return GUIDE_CODES.has(s) ? undefined : `a refusal code the descriptors lack: ${s}`;
  if (/^[a-z][\w-]*(\.[a-z][\w-]*)+$/.test(s)) return GUIDE_DOTTED.has(s) ? undefined : `a verb or kind the descriptors lack: ${s}`;
  return GUIDE_TERMS.has(s) ? undefined : `a term the descriptors do not name: ${s}`;
}

/** G-HON-08 over guide topics (the compiled-in GUIDE_TOPICS, or a planted fixture). */
export function scanGuides(topics: readonly GuideText[]): HonestyFinding[] {
  const out: HonestyFinding[] = [];
  const ids = new Set(topics.map((t) => t.id));
  for (const t of topics) {
    const text = `${t.summary}\n${t.body}`;
    const file = `guide:${t.id}`;
    const at = (i: number): number => lineOf(text, i);
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const why = guideSpanProblem(m[1]!, ids);
      if (why) out.push({ rule: 'G-HON-08', file, line: at(m.index), detail: why });
    }
    const prose = text.replace(/`[^`\n]+`/g, (x) => ' '.repeat(x.length));
    for (const m of prose.matchAll(/(?<![\w-])--[a-z][\w-]*/gi)) out.push({ rule: 'G-HON-08', file, line: at(m.index), detail: `a CLI flag no frozen descriptor lists: ${m[0]}` });
    for (const m of prose.matchAll(/\b[a-z][a-zA-Z-]+(?:\.[a-z][a-zA-Z-]+)+\b/g)) {
      if (!GUIDE_DOTTED.has(m[0])) out.push({ rule: 'G-HON-08', file, line: at(m.index), detail: `a verb or kind the descriptors lack: ${m[0]}` });
    }
    for (const m of prose.matchAll(/\b[A-Z][A-Z_]{3,}\b/g)) {
      if (!GUIDE_CODES.has(m[0])) out.push({ rule: 'G-HON-08', file, line: at(m.index), detail: `a refusal code the descriptors lack: ${m[0]}` });
    }
  }
  return [...out, ...scanLatencyDocs(topics.map((t) => ({ file: `guide:${t.id}`, text: `${t.summary}\n${t.body}` })))];
}
