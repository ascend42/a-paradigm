#!/usr/bin/env node
// Warpline Move-3 FULL RUN — deterministic manifest + catalog generator
// (T-2026-07-15-007; harness-spec.md §1.4/§4.1, pilot-results.md §7 scaling plan).
//
// Generates, from a FIXED PRNG seed (replayable):
//   - seed-catalog-full.jsonl  (via seeds.mjs genFullSeeds — pilot catalog untouched)
//   - the `full` block ADDED to run-manifest.json (pilot manifest preserved verbatim)
//
// DESIGN (pre-registered before the run; see run-results-full.md §design):
//   12 sessions × 4 batches = 48 batches, k=4 agents/batch → 192 admissions,
//   48 fast (excluded) + 144 scored concurrent rows.
//
//   Batch shapes:
//     non-churn (28): [X.A fast][X.B scored: stratum(X)][Y.A scored: IND-single][Y.B scored: stratum(Y)]
//     churn     (20): [churn fast][X.A scored: IND-single][X.B scored: stratum(X)][F.A scored: IND-single]
//   Slots 3/4 admit onto merge strands whenever slot 2/3 sealed CLEAN → H1-relax coverage.
//
//   Pair-event allocation (76 slots): IND-pair 12, LINKED-CLEAN 21, ARW-linked 10,
//   ARW-indep 10, TI-ripple 12, TI-direct 5, NEGCTRL 3, NEGCTRL-RIPPLE 3.
//   Expected scored composition (144): INDEPENDENT 80 (55.6% — §1.1 share),
//   linked CLEANs 31 (power floor §4.1 ≥30), independent CLEANs ≈93,
//   TI 17, negative controls 6 (NC 3 + NCR 3).
//
//   CHURN MODEL (K3 pre-registration): prior-BLIND uniform retirement. Each churn
//   slot retires one module chosen uniformly at random (fixed-seed PRNG) from
//   modules admitted ≥2 batches earlier and not already churned — the choice NEVER
//   conditions on the module's prior class (linked/independent/fast). Under this
//   null-fair model the EXPECTED linked-vs-independent survival gap is ~0; K3 as
//   pre-registered can therefore fire structurally (see run-results-full.md for
//   the construct-validity pre-declaration). The alternative — churn conditioned
//   on prior class — would author K3's outcome, which is worse than measuring it.
//
// Run: node gen-manifest-full.mjs

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { genFullSeeds } from './seeds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// ── Deterministic PRNG (mulberry32) ───────────────────────────────────────────
const PRNG_SEED = 20260715;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(PRNG_SEED);
const shuffle = (arr) => { // Fisher-Yates, PRNG-driven
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pickIndex = (n) => Math.floor(rand() * n);

// ── Plan constants ────────────────────────────────────────────────────────────
const SESSIONS = 12;
const BATCHES_PER_SESSION = 4;
const AGENTS = ['alice', 'bob', 'carol', 'dave'];

// 76 pair-event slots (28 non-churn × 2 + 20 churn × 1), pre-registered mix:
const PAIR_ALLOCATION = [
  ...Array(12).fill('INDEPENDENT'),
  ...Array(21).fill('LINKED-CLEAN'),
  ...Array(10).fill('AUTO-RESOLVE-WIN-linked'),
  ...Array(10).fill('AUTO-RESOLVE-WIN-indep'),
  ...Array(12).fill('TRUE-INTERFERENCE-ripple'),
  ...Array(5).fill('TRUE-INTERFERENCE-direct'),
  ...Array(3).fill('NEGATIVE-CONTROL'),
  ...Array(3).fill('NEGCTRL-RIPPLE'),
];
if (PAIR_ALLOCATION.length !== 76) throw new Error(`pair allocation ${PAIR_ALLOCATION.length} != 76`);

// Churn batches: none in sessions 1-2 (eligibility needs history); in sessions
// 3-12, batches 1 and 3 of each session are churn batches (20 total).
const isChurnBatch = (sessionIdx, batchIdx) => sessionIdx >= 2 && (batchIdx === 0 || batchIdx === 2);

// ── Build the batch plan, consuming strata in shuffled order ──────────────────
const pairStrata = shuffle(PAIR_ALLOCATION);
let pairCursor = 0;
const seedPlan = []; // stratum names in catalog order (drives genFullSeeds ids)
const planRefs = []; // per-batch structural refs into seedPlan indices

for (let s = 0; s < SESSIONS; s++) {
  for (let b = 0; b < BATCHES_PER_SESSION; b++) {
    if (isChurnBatch(s, b)) {
      const x = seedPlan.push(pairStrata[pairCursor++]) - 1;
      const f = seedPlan.push('INDEPENDENT') - 1; // dedicated filler
      planRefs.push({ session: s, batch: b, churn: true, X: x, F: f });
    } else {
      const x = seedPlan.push(pairStrata[pairCursor++]) - 1;
      const y = seedPlan.push(pairStrata[pairCursor++]) - 1;
      planRefs.push({ session: s, batch: b, churn: false, X: x, Y: y });
    }
  }
}
if (pairCursor !== 76) throw new Error(`consumed ${pairCursor} pair slots != 76`);

// Materialize the catalog (deterministic ids f100..).
const seeds = genFullSeeds(seedPlan);
fs.writeFileSync(path.join(here, 'seed-catalog-full.jsonl'), seeds.map((x) => JSON.stringify(x)).join('\n') + '\n');

// ── Assemble sessions with agent rotation + churn target selection ────────────
// Modules become churn-eligible 2 batches after the batch that admitted them.
const admittedByBatch = []; // globalBatchIdx -> seedIds landed in that batch
const churned = new Set();
let churnIndex = 0;
const sessions = [];
let globalBatch = 0;

for (let s = 0; s < SESSIONS; s++) {
  const batches = [];
  for (let b = 0; b < BATCHES_PER_SESSION; b++) {
    const ref = planRefs[globalBatch];
    const rot = globalBatch % AGENTS.length;
    const agent = (i) => AGENTS[(rot + i) % AGENTS.length];
    const admits = [];
    const landed = [];

    if (ref.churn) {
      // Eligible: seeds admitted in batches <= globalBatch-2, not already churned.
      const eligible = [];
      for (let gb = 0; gb <= globalBatch - 2; gb++) {
        for (const sid of admittedByBatch[gb] ?? []) if (!churned.has(sid)) eligible.push(sid);
      }
      if (eligible.length === 0) throw new Error(`no churn-eligible module at batch ${globalBatch}`);
      const target = eligible[pickIndex(eligible.length)]; // PRIOR-BLIND uniform draw
      churned.add(target);
      churnIndex++;
      const X = seeds[ref.X];
      const F = seeds[ref.F];
      admits.push({ agent: agent(0), churnTarget: target, churnIndex, role: 'churn-fast' });
      admits.push({ agent: agent(1), seed: X.id, side: 'A', role: 'concurrent', stratumRow: 'INDEPENDENT', rowTruth: 'independent', expect: 'CLEAN/independent (single-sided vs churn)' });
      admits.push({ agent: agent(2), seed: X.id, side: 'B', role: 'concurrent', stratumRow: X.stratum, rowTruth: X.truth, expect: X.expectWarpline });
      admits.push({ agent: agent(3), seed: F.id, side: 'A', role: 'concurrent', stratumRow: 'INDEPENDENT', rowTruth: 'independent', expect: 'CLEAN/independent (filler)' });
      landed.push(X.id, F.id);
    } else {
      const X = seeds[ref.X];
      const Y = seeds[ref.Y];
      admits.push({ agent: agent(0), seed: X.id, side: 'A', role: 'fast' });
      admits.push({ agent: agent(1), seed: X.id, side: 'B', role: 'concurrent', stratumRow: X.stratum, rowTruth: X.truth, expect: X.expectWarpline });
      admits.push({ agent: agent(2), seed: Y.id, side: 'A', role: 'concurrent', stratumRow: 'INDEPENDENT', rowTruth: 'independent', expect: 'CLEAN/independent (single-sided pair A)' });
      admits.push({ agent: agent(3), seed: Y.id, side: 'B', role: 'concurrent', stratumRow: Y.stratum, rowTruth: Y.truth, expect: Y.expectWarpline });
      landed.push(X.id, Y.id);
    }
    admittedByBatch[globalBatch] = landed;
    batches.push({ batchId: `F-B${String(globalBatch + 1).padStart(2, '0')}`, admits });
    globalBatch++;
  }
  sessions.push({ sessionId: `F-S${s + 1}`, batches });
}

// ── Write the `full` block additively into run-manifest.json ──────────────────
const manifestPath = path.join(here, 'run-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const liveHead = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: path.resolve(here, '../../..'), encoding: 'utf8',
}).trim();

const stratumCounts = {};
for (const st of seedPlan) stratumCounts[st] = (stratumCounts[st] || 0) + 1;

manifest.full = {
  mode: 'FULL',
  note: 'Move-3 ≥100-admission statistical run (T-2026-07-15-007). Monorepo-clone throwaway tree (git archive of liveHead, .warpline stripped + fully ignored), seeds under src-dogfood/. 12 sessions × 4 batches, k=4 → 192 admissions, 144 scored concurrent. Churn model: prior-blind uniform retirement (see gen-manifest-full.mjs header). Pilot block above is untouched and reproducible.',
  generated: new Date().toISOString(),
  prngSeed: PRNG_SEED,
  catalog: 'seed-catalog-full.jsonl',
  liveHeadAtGeneration: liveHead,
  cli: manifest.cli,
  agents: AGENTS,
  planSummary: {
    sessions: SESSIONS,
    batches: SESSIONS * BATCHES_PER_SESSION,
    admissionsTotal: SESSIONS * BATCHES_PER_SESSION * 4,
    scoredConcurrent: SESSIONS * BATCHES_PER_SESSION * 3,
    churnBatches: churnIndex,
    seedCount: seeds.length,
    pairEventAllocation: {
      'INDEPENDENT': 12, 'LINKED-CLEAN': 21, 'AUTO-RESOLVE-WIN-linked': 10,
      'AUTO-RESOLVE-WIN-indep': 10, 'TRUE-INTERFERENCE-ripple': 12,
      'TRUE-INTERFERENCE-direct': 5, 'NEGATIVE-CONTROL': 3, 'NEGCTRL-RIPPLE': 3,
    },
    catalogStratumCounts: stratumCounts,
  },
  sessions,
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`wrote ${seeds.length} seeds -> seed-catalog-full.jsonl`);
console.log(`manifest.full: ${SESSIONS} sessions, ${globalBatch} batches, ${churnIndex} churn slots, liveHead ${liveHead.slice(0, 12)}`);
