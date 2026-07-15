#!/usr/bin/env node
// Partition Trial Phase 0 — Source A extractor (a-paradigm internal history).
// Read-only on git. Emits a-paradigm pairs to stdout as JSONL.
// Method: methodology.md §1-A, §2, §2.1. Seeded LCG sample, seed=42.
import { execFileSync } from 'node:child_process';

const REPO = '/Users/ascend/Documents/GitHub/a-paradigm';
const WINDOW_DAYS = 3;
const SAMPLE_N = 80;
const SEED = 42;

const EXCLUDE = [
  /^\.paradigm\//, /^CHANGELOG\.md$/, /^package-lock\.json$/,
  /^plugins\/paradigm\/\.claude-plugin\/plugin\.json$/, /^\.claude\//,
];
const excluded = (p) => EXCLUDE.some((re) => re.test(p));

const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// --- 1. collect trailer commits with changed paths ---
const RS = '\x1e', US = '\x1f';
const raw = git(['log', '--grep=^Symbols:', `--format=${RS}%H${US}%ad${US}%s${US}%B`, '--date=short', '--name-only']);
const commits = [];
for (const block of raw.split(RS).slice(1)) {
  const [sha, date, subject, rest] = block.split(US);
  if (!rest) continue;
  // body ends at the first blank-line-then-filenames boundary; files are the trailing name-only lines
  const lines = rest.split('\n');
  // Symbols: trailer
  const trailerLine = lines.find((l) => /^Symbols:\s*/.test(l));
  if (!trailerLine) continue;
  const symbols = trailerLine.replace(/^Symbols:\s*/, '')
    .split(/[,\s]+/).map((s) => s.trim().replace(/[.,;]+$/, '').toLowerCase())
    .filter((s) => /^[#$^!~][a-z0-9][a-z0-9-]*$/.test(s));
  // subject symbols: type(#a,#b): ...
  const m = subject.match(/^\w+\(([^)]+)\)/);
  const subjSyms = m ? m[1].split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[#$^!~]/.test(s)) : [];
  for (const s of subjSyms) if (!symbols.includes(s)) symbols.push(s);
  // name-only files: lines after the last trailer-ish body line that look like paths.
  // git puts a blank line between body and file list; take trailing non-empty lines that
  // don't contain ': ' and do contain '/' or '.', after the final blank separator.
  const trimmed = [...lines];
  while (trimmed.length && trimmed[trimmed.length - 1].trim() === '') trimmed.pop();
  const lastBlank = trimmed.lastIndexOf('');
  const tail = trimmed.slice(lastBlank + 1).filter(Boolean);
  const files = tail.filter((l) => !/^\w[\w-]*: /.test(l) && /[/.]/.test(l));
  const changedPaths = files.filter((p) => !excluded(p));
  const primary = subjSyms[0] || symbols[0] || null;
  if (!primary) continue;
  commits.push({ sha, date, subject, symbols, changedPaths, primary });
}

// --- 2. cluster: (primary symbol, day) ---
const clusters = new Map();
for (const c of commits) {
  const key = `${c.primary}@${c.date}`;
  if (!clusters.has(key)) clusters.set(key, { key, date: c.date, primary: c.primary, shas: [], titles: [], symbols: new Set(), changedPaths: new Set() });
  const cl = clusters.get(key);
  cl.shas.push(c.sha);
  cl.titles.push(c.subject);
  c.symbols.forEach((s) => cl.symbols.add(s));
  c.changedPaths.forEach((p) => cl.changedPaths.add(p));
}
const units = [...clusters.values()].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1);

// --- 3. enumerate cross-cluster pairs within window ---
const day = (d) => Math.floor(Date.parse(d) / 86400000);
const cand = [];
for (let i = 0; i < units.length; i++) {
  for (let j = i + 1; j < units.length; j++) {
    const gap = Math.abs(day(units[i].date) - day(units[j].date));
    if (gap > WINDOW_DAYS) { if (day(units[j].date) - day(units[i].date) > WINDOW_DAYS) break; else continue; }
    if (units[i].primary === units[j].primary) continue; // same task resumed across days ≠ two concurrent tasks
    cand.push({ a: units[i], b: units[j], gap });
  }
}

// --- 4. seeded LCG sample ---
let state = SEED;
const rand = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
const sample = cand.slice(0, SAMPLE_N);

console.error(`[a-paradigm] trailer commits=${commits.length} clusters=${units.length} candidate pairs=${cand.length} sampled=${sample.length}`);

let n = 0;
const task = (u) => ({ ref: u.key, shas: u.shas, date: u.date, title: u.titles[0], changedPaths: [...u.changedPaths].sort(), symbols: [...u.symbols].sort() });
for (const { a, b, gap } of sample) {
  const rec = {
    pairId: `AP-${String(++n).padStart(4, '0')}`,
    source: 'a-paradigm', windowDays: WINDOW_DAYS, gapDays: gap,
    taskA: task(a), taskB: task(b),
    emptySymbols: a.symbols.size === 0 || b.symbols.size === 0,
  };
  console.log(JSON.stringify(rec));
}
