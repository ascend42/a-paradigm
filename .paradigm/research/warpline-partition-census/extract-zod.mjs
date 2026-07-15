#!/usr/bin/env node
// Partition Trial Phase 0 — Source B extractor (zod PR stream).
// Read-only on the scratchpad clone; `warpline diff` is a read-only verb.
// Method: methodology.md §1-B, §2, §2.2. Seeded LCG sample, seed=42.
// Usage: node extract-zod.mjs <zodCloneDir> [sampleN]
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const CLI = '/Users/ascend/Documents/GitHub/a-paradigm/packages/warpline/dist/cli.js';
const repoDir = path.resolve(process.argv[2]);
const SAMPLE_N = Number(process.argv[3] ?? 70);
const WINDOW_DAYS = 3;
const SEED = 42;
const MAX_COMMITS = 400; // most recent PR-commits considered

const git = (args) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// --- 1. collect PR-shaped source commits ---
const RS = '\x1e', US = '\x1f';
const raw = git(['log', '--no-merges', `--format=${RS}%H${US}%cs${US}%s`, '--name-only', '--', 'packages/zod/src/']);
const commits = [];
for (const block of raw.split(RS).slice(1)) {
  const [sha, date, restRaw] = [block.split(US)[0], block.split(US)[1], block.split(US)[2] ?? ''];
  const lines = restRaw.split('\n');
  const subject = lines[0];
  if (!/\(#\d+\)/.test(subject)) continue;               // PR-linked only
  if (/^(chore\(release\)|v?\d+\.\d+\.\d+$)/.test(subject.trim())) continue;
  const files = lines.slice(1).filter((l) => l && /[/.]/.test(l));
  const changedPaths = files.filter((p) => p.startsWith('packages/zod/src/'));
  if (changedPaths.length === 0) continue;
  commits.push({ sha, date, subject, changedPaths });
  if (commits.length >= MAX_COMMITS) break;
}

// --- 2. candidate pairs: landed within WINDOW_DAYS ---
const day = (d) => Math.floor(Date.parse(d) / 86400000);
const byTime = [...commits].sort((a, b) => a.date < b.date ? -1 : 1);
const cand = [];
for (let i = 0; i < byTime.length; i++) {
  for (let j = i + 1; j < byTime.length; j++) {
    const gap = Math.abs(day(byTime[j].date) - day(byTime[i].date));
    if (gap > WINDOW_DAYS) break;
    cand.push({ a: byTime[i], b: byTime[j], gap });
  }
}

// --- 3. seeded sample ---
let state = SEED;
const rand = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
const sample = cand.slice(0, SAMPLE_N);

// --- 4. lens extraction (memoized per unique commit) ---
const uniq = new Map();
for (const { a, b } of sample) { uniq.set(a.sha, a); uniq.set(b.sha, b); }
console.error(`[zod] PR commits=${commits.length} candidate pairs=${cand.length} sampled=${sample.length} unique commits to lens=${uniq.size}`);

const symCache = new Map();
let done = 0;
for (const [sha] of uniq) {
  try {
    const out = execFileSync('node', [CLI, 'diff', `${sha}^`, sha, '--json'], {
      cwd: repoDir, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 120_000,
    });
    const d = JSON.parse(out);
    const ids = new Set();
    for (const k of ['born', 'retired', 'contractChanged']) {
      for (const u of d[k] ?? []) ids.add(typeof u === 'string' ? u : (u.symbol ?? u.id ?? JSON.stringify(u)));
    }
    symCache.set(sha, [...ids].sort());
  } catch (e) {
    symCache.set(sha, null); // lens failure — recorded, pair flagged
    console.error(`[zod] lens FAIL ${sha}: ${String(e.message).slice(0, 120)}`);
  }
  if (++done % 10 === 0) console.error(`[zod] lensed ${done}/${uniq.size}`);
}

// --- 5. emit ---
let n = 0;
const task = (c) => ({ ref: c.sha, date: c.date, title: c.subject, changedPaths: c.changedPaths, symbols: symCache.get(c.sha) ?? [], lensFailed: symCache.get(c.sha) === null });
for (const { a, b, gap } of sample) {
  const A = task(a), B = task(b);
  console.log(JSON.stringify({
    pairId: `ZD-${String(++n).padStart(4, '0')}`,
    source: 'zod', windowDays: WINDOW_DAYS, gapDays: gap,
    taskA: A, taskB: B,
    emptySymbols: A.symbols.length === 0 || B.symbols.length === 0,
  }));
}
