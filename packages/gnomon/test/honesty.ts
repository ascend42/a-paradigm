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
 */

export interface HonestyFinding {
  rule: 'G-HON-02' | 'G-HON-05' | 'G-HON-06' | 'G-HON-07';
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
