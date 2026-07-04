#!/usr/bin/env node
// Warpline Move-3 dogfood — AGGREGATE (harness-spec.md §3 + §3.7 KILL). Joins
// results-swarm.jsonl + adjudication.jsonl + grade.json → the §3 metrics, the KILL
// evaluation, and a markdown summary (base-rate/render.mjs style). For the PILOT
// the metrics are reported but the statistical KILL gates are marked
// "not-powered" (n<power floor) — the pilot proves the machinery + that the
// scoring table fires, not statistical significance.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8');
const readJsonl = (f) => read(f).split('\n').filter(Boolean).map((l) => JSON.parse(l));

const swarm = readJsonl('results-swarm.jsonl');
const adj = readJsonl('adjudication.jsonl');
const grade = JSON.parse(read('grade.json'));

const concurrent = swarm.filter((r) => r.concurrent);
const symbolBearing = concurrent.filter((r) => r.symbolBearing);
const denom = symbolBearing.length;

const labels = {};
for (const r of adj) labels[r.label] = (labels[r.label] || 0) + 1;
const autoResolve = labels['MEANING-DECISIVE:auto-resolve'] || 0;
const silentMismerge = labels['MEANING-DECISIVE:silent-mismerge'] || 0;
const meaningDecisive = autoResolve + silentMismerge;
const falseKnot = labels['FALSE-KNOT'] || 0;
const falseClean = labels['FALSE-CLEAN'] || 0;
const agreeClean = labels['agree-clean'] || 0;
const agreeConflict = labels['agree-conflict'] || 0;

const meaningDecisiveRate = denom ? meaningDecisive / denom : 0;

// H1-wall (§3.4): CLEAN-but-unsealed / all CLEAN.
const cleanAdmits = concurrent.filter((r) => r.status === 'CLEAN');
const cleanUnsealed = cleanAdmits.filter((r) => !r.sealed).length;
const h1WallRate = cleanAdmits.length ? cleanUnsealed / cleanAdmits.length : 0;

// byte-fallback (§3.6): opaque/no-symbol admits / ALL admits.
const byteFallback = concurrent.filter((r) => !r.symbolBearing).length;
const byteFallbackRate = concurrent.length ? byteFallback / concurrent.length : 0;

// moat (§3.2): survival by prior class (from grade.json).
const moat = grade.moat || {};
const surv = (b) => (b && (b.survived + b.overturned) > 0) ? b.survived / (b.survived + b.overturned) : null;
const linkedSurv = surv(moat.linked);
const indepSurv = surv(moat.independent);
const priorGap = (linkedSurv != null && indepSurv != null) ? (linkedSurv - indepSurv) * 100 : null;

// KILL evaluation (§3.7). PILOT: statistical gates are "not-powered" (n small).
const POWERED = denom >= 100; // full-run power floor
const kill = {
  k1_meaning_decisive_lt_2pct: POWERED ? (meaningDecisiveRate < 0.02) : 'not-powered',
  k2_false_knot_gt_meaning_decisive: falseKnot > meaningDecisive,
  k3_prior_indistinguishable: POWERED ? (priorGap == null || priorGap < 15) : 'not-powered',
  hard_stop_false_clean: falseClean > 0,
};

const machineryChecks = {
  admit_json_shape_ok: swarm.every((r) => r.status !== undefined),
  fast_admit_seen: swarm.some((r) => r.status === 'FAST_ADMIT'),
  clean_linked_seen: concurrent.some((r) => r.status === 'CLEAN' && r.confidence === 'linked'),
  clean_independent_seen: concurrent.some((r) => r.status === 'CLEAN' && r.confidence === 'independent'),
  knot_seen: concurrent.some((r) => r.status === 'KNOT'),
  h1_relaxation_merge_onto_merge: concurrent.some((r) => r.status === 'CLEAN' && r.sealed && r.rebasedOnto &&
    swarm.some((s) => s.isMerge && s.strandSeq != null)), // a merge existed to admit onto
  meaning_decisive_fired: meaningDecisive > 0,
  silent_mismerge_caught: silentMismerge > 0,
  negctrl_not_false_knot: adj.filter((r) => r.stratum === 'NEGATIVE-CONTROL').every((r) => r.label === 'agree-clean'),
  no_false_clean: falseClean === 0,
};

const summary = {
  denom_symbol_bearing_concurrent: denom,
  concurrent_total: concurrent.length,
  admissions_total: swarm.length,
  labels,
  meaning_decisive: { total: meaningDecisive, auto_resolve: autoResolve, silent_mismerge: silentMismerge, rate: meaningDecisiveRate },
  guardrails: { false_knot: falseKnot, false_clean: falseClean, false_knot_le_meaning_decisive: falseKnot <= meaningDecisive },
  h1_wall_rate: h1WallRate,
  byte_fallback_rate: byteFallbackRate,
  moat: { linked: moat.linked, independent: moat.independent, fastAdmit: moat['fast-admit'], linkedSurvivalPct: linkedSurv != null ? Math.round(linkedSurv * 100) : null, indepSurvivalPct: indepSurv != null ? Math.round(indepSurv * 100) : null, priorGapPts: priorGap },
  kill,
  machineryChecks,
};
fs.writeFileSync(path.join(here, 'aggregate-dogfood.json'), JSON.stringify(summary, null, 2));

// ── Markdown ─────────────────────────────────────────────────────────────────
const md = [];
md.push('## Aggregate — Warpline Move-3 dogfood (PILOT)\n');
md.push(`Symbol-bearing concurrent admissions (denominator): **${denom}**  ·  total concurrent: ${concurrent.length}  ·  total admissions: ${swarm.length}\n`);
md.push('### Scoring labels');
md.push('| label | count |');
md.push('|---|---|');
for (const [k, v] of Object.entries(labels).sort()) md.push(`| ${k} | ${v} |`);
md.push('');
md.push('### §3 metrics');
md.push('| metric | value |');
md.push('|---|---|');
md.push(`| meaning-decisive rate | ${(meaningDecisiveRate * 100).toFixed(1)}% (${meaningDecisive}/${denom}) |`);
md.push(`| — auto-resolve wins | ${autoResolve} |`);
md.push(`| — silent-mismerge catches | ${silentMismerge} |`);
md.push(`| false-KNOT count | ${falseKnot} (guardrail: ≤ meaning-decisive ${meaningDecisive} → ${falseKnot <= meaningDecisive ? 'OK' : 'VIOLATED'}) |`);
md.push(`| FALSE-CLEAN (wrong-merge) | ${falseClean} (must be 0 → ${falseClean === 0 ? 'OK' : 'HARD STOP'}) |`);
md.push(`| H1-wall rate (CLEAN unsealed / CLEAN) | ${(h1WallRate * 100).toFixed(1)}% |`);
md.push(`| byte-fallback rate | ${(byteFallbackRate * 100).toFixed(1)}% |`);
md.push(`| moat: linked survival | ${linkedSurv != null ? Math.round(linkedSurv * 100) + '%' : 'n/a'} |`);
md.push(`| moat: independent survival | ${indepSurv != null ? Math.round(indepSurv * 100) + '%' : 'n/a'} |`);
md.push(`| moat: prior gap (linked − indep) | ${priorGap != null ? priorGap.toFixed(0) + ' pts' : 'n/a (insufficient graded classes)'} |`);
md.push('');
md.push('### §3.7 KILL evaluation');
md.push('| gate | result |');
md.push('|---|---|');
md.push(`| K1 meaning-decisive < 2% | ${kill.k1_meaning_decisive_lt_2pct} |`);
md.push(`| K2 false-KNOT > meaning-decisive | ${kill.k2_false_knot_gt_meaning_decisive} |`);
md.push(`| K3 prior indistinguishable | ${kill.k3_prior_indistinguishable} |`);
md.push(`| hard-stop FALSE-CLEAN | ${kill.hard_stop_false_clean} |`);
md.push('');
md.push('### Machinery checks (the PILOT gate)');
md.push('| check | pass |');
md.push('|---|---|');
for (const [k, v] of Object.entries(machineryChecks)) md.push(`| ${k} | ${v ? '✓' : '✗'} |`);
md.push('');
const allMachinery = Object.values(machineryChecks).every(Boolean);
md.push(`**Machinery verdict: ${allMachinery ? 'WORKS ✓' : 'INCOMPLETE ✗'}**`);
fs.writeFileSync(path.join(here, 'aggregate-dogfood.md'), md.join('\n') + '\n');

console.log(md.join('\n'));
console.log(`\n-> aggregate-dogfood.json + .md`);
