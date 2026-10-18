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
 *   G-HON-07  docs: a MEASURED latency (a p50/p95/p99/median/measured number
 *             in ms/µs not preceded by a comparator, i.e. not a budget) names
 *             its method and machine on the same line. Scope: the Gnomon
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

const LATENCY = /(?<pre>[<>≤≥~]|\bunder|\bbudget|\bwithin|\bbelow|\babove|\bover)?\s*(?:\b(?:p50|p90|p95|p99|median|measured)\b[^\n|]{0,40}?)\b\d+(?:\.\d+)?\s?(?:ms|µs)\b/gi;
const MACHINE = /\b(Mac|macOS|Apple|M[1-5]|Linux|Ubuntu|Windows|runner|x64|arm64|SSD|host)\b/i;
const METHOD = /\b(measured|probe|bench\w*|over \d+|n ?= ?\d+|runs?|samples?|events|arm [A-Z]\d?|hrtime|vitest|test:perf)\b/i;

/** G-HON-07 docs half: a measured latency line names its method and machine. */
export function scanLatencyDocs(files: readonly SourceText[]): HonestyFinding[] {
  const out: HonestyFinding[] = [];
  for (const f of files) {
    f.text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(LATENCY)) {
        if (m.groups?.pre || /[<>≤≥]\s*$/.test(line.slice(0, m.index)) || /[<>≤≥]|\b(under|below|within|budget)\b/i.test(m[0])) continue; // a budget, not a measurement
        if (!MACHINE.test(line) || !METHOD.test(line)) out.push({ rule: 'G-HON-07', file: f.file, line: i + 1, detail: `a latency number without its method and machine: ${m[0].trim()}` });
      }
    });
  }
  return out;
}
