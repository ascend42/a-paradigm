#!/usr/bin/env node
// Warpline Move-3 dogfood — AGGREGATE (harness-spec.md §3 + §3.7 KILL). Joins
// results-swarm{-full}.jsonl + adjudication{-full}.jsonl + grade{-full}.json →
// the §3 metrics, the KILL evaluation, and a markdown summary.
//
// PILOT mode (default): metrics reported, statistical KILL gates marked
// "not-powered" (n < power floor) — the pilot proves machinery, not statistics.
// FULL mode (--full): the ≥100-admission statistical run — K1/K3 evaluated for
// real, incl. the §3.2 two-proportion z-test on linked-vs-independent survival.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FULL = process.argv.includes('--full');
const SUFFIX = FULL ? '-full' : '';
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8');
const readJsonl = (f) => read(f).split('\n').filter(Boolean).map((l) => JSON.parse(l));

const swarm = readJsonl(`results-swarm${SUFFIX}.jsonl`);
const adj = readJsonl(`adjudication${SUFFIX}.jsonl`);
const grade = JSON.parse(read(`grade${SUFFIX}.json`));

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

// ── moat (§3.2): survival by prior class + two-proportion z-test ───────────────
const moat = grade.moat || {};
const gradedOf = (b) => (b ? b.survived + b.overturned : 0);
const surv = (b) => (b && gradedOf(b) > 0) ? b.survived / gradedOf(b) : null;
const linkedSurv = surv(moat.linked);
const indepSurv = surv(moat.independent);
const priorGap = (linkedSurv != null && indepSurv != null) ? (linkedSurv - indepSurv) * 100 : null;
const nLinked = gradedOf(moat.linked);
const nIndep = gradedOf(moat.independent);

/** Two-proportion z-test (pooled), two-tailed p via erfc approximation. */
function twoProportionZ(x1, n1, x2, n2) {
  if (!n1 || !n2) return { z: null, p: null };
  const p1 = x1 / n1, p2 = x2 / n2, p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, p: 1 };
  const z = (p1 - p2) / se;
  // two-tailed p = erfc(|z|/√2); Abramowitz-Stegun 7.1.26 erf approximation
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return { z: Math.round(z * 1000) / 1000, p: Math.round((1 - erf) * 10000) / 10000 };
}
const zTest = twoProportionZ(moat.linked?.survived ?? 0, nLinked, moat.independent?.survived ?? 0, nIndep);

// ── KILL evaluation (§3.7) ─────────────────────────────────────────────────────
const POWERED = denom >= 100; // full-run power floor (K1)
const K3_POWERED = nLinked >= 30 && nIndep >= 30; // §4.1 graded-class power floor
const kill = {
  k1_meaning_decisive_lt_2pct: POWERED ? (meaningDecisiveRate < 0.02) : 'not-powered',
  k2_false_knot_gt_meaning_decisive: falseKnot > meaningDecisive,
  k3_prior_indistinguishable: K3_POWERED
    ? (priorGap == null || priorGap < 15 || zTest.p == null || zTest.p >= 0.05)
    : 'not-powered',
  hard_stop_false_clean: falseClean > 0,
};

// ── per-stratum table (FULL analytics; harmless for pilot) ─────────────────────
const strata = {};
for (const r of adj) {
  const st = (strata[r.stratum] ??= { n: 0, labels: {}, statuses: {}, confidences: {} });
  st.n++;
  st.labels[r.label] = (st.labels[r.label] || 0) + 1;
  st.statuses[r.warplineStatus] = (st.statuses[r.warplineStatus] || 0) + 1;
  if (r.confidence) st.confidences[r.confidence] = (st.confidences[r.confidence] || 0) + 1;
}

// Classification fidelity (supplementary, NOT a pre-registered gate): did the
// engine route strata into the expected confidence classes?
const EXPECT_CONF = {
  'LINKED-CLEAN': 'linked', 'AUTO-RESOLVE-WIN-linked': 'linked',
  'AUTO-RESOLVE-WIN-indep': 'independent', 'INDEPENDENT': 'independent', 'NEGATIVE-CONTROL': 'independent',
};
const fidelity = {};
for (const [stratum, expect] of Object.entries(EXPECT_CONF)) {
  const rows = adj.filter((r) => r.stratum === stratum && r.warplineStatus === 'CLEAN');
  if (!rows.length) continue;
  const okN = rows.filter((r) => r.confidence === expect).length;
  fidelity[stratum] = { expect, n: rows.length, asExpected: okN, pct: Math.round((okN / rows.length) * 1000) / 10 };
}

// Churn / overturn accounting (FULL): outcome × prior class from grade.grades.
const gradeRows = grade.grades || [];
const outcomes = {};
for (const g of gradeRows) {
  if (g.outcome === 'baseline') continue;
  (outcomes[g.priorClass] ??= { survived: 0, overturned: 0, pending: 0 })[g.outcome]++;
}

const sessions = new Set(swarm.map((r) => r.sessionId)).size;
const machineryChecks = {
  admit_json_shape_ok: swarm.every((r) => r.status !== undefined),
  no_admit_errors: swarm.every((r) => !r.error),
  fast_admit_seen: swarm.some((r) => r.status === 'FAST_ADMIT'),
  clean_linked_seen: concurrent.some((r) => r.status === 'CLEAN' && r.confidence === 'linked'),
  clean_independent_seen: concurrent.some((r) => r.status === 'CLEAN' && r.confidence === 'independent'),
  knot_seen: concurrent.some((r) => r.status === 'KNOT'),
  h1_relaxation_merge_onto_merge: concurrent.some((r) => r.status === 'CLEAN' && r.sealed && r.rebasedOnto &&
    swarm.some((s) => s.isMerge && s.strandSeq != null)),
  meaning_decisive_fired: meaningDecisive > 0,
  silent_mismerge_caught: silentMismerge > 0,
  negctrl_not_false_knot: adj.filter((r) => r.stratum === 'NEGATIVE-CONTROL').every((r) => r.label === 'agree-clean'),
  no_false_clean: falseClean === 0,
};

const summary = {
  mode: FULL ? 'FULL' : 'PILOT',
  denom_symbol_bearing_concurrent: denom,
  concurrent_total: concurrent.length,
  admissions_total: swarm.length,
  sessions,
  labels,
  meaning_decisive: { total: meaningDecisive, auto_resolve: autoResolve, silent_mismerge: silentMismerge, rate: meaningDecisiveRate },
  guardrails: { false_knot: falseKnot, false_clean: falseClean, false_knot_le_meaning_decisive: falseKnot <= meaningDecisive },
  h1_wall_rate: h1WallRate,
  byte_fallback_rate: byteFallbackRate,
  moat: {
    linked: moat.linked, independent: moat.independent, fastAdmit: moat['fast-admit'],
    linkedSurvivalPct: linkedSurv != null ? Math.round(linkedSurv * 1000) / 10 : null,
    indepSurvivalPct: indepSurv != null ? Math.round(indepSurv * 1000) / 10 : null,
    priorGapPts: priorGap != null ? Math.round(priorGap * 10) / 10 : null,
    nLinkedGraded: nLinked, nIndepGraded: nIndep,
    zTest, k3Powered: K3_POWERED,
  },
  kill,
  strata,
  classificationFidelity: fidelity,
  gradeOutcomesByPrior: outcomes,
  machineryChecks,
};
fs.writeFileSync(path.join(here, `aggregate${FULL ? '-full' : '-dogfood'}.json`), JSON.stringify(summary, null, 2));

// ── Markdown ─────────────────────────────────────────────────────────────────
const md = [];
md.push(`## Aggregate — Warpline Move-3 dogfood (${summary.mode})\n`);
md.push(`Symbol-bearing concurrent admissions (denominator): **${denom}**  ·  total concurrent: ${concurrent.length}  ·  total admissions: ${swarm.length}  ·  sessions: ${sessions}\n`);
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
md.push(`| H1-wall rate (CLEAN unsealed / CLEAN) | ${(h1WallRate * 100).toFixed(1)}% (${cleanUnsealed}/${cleanAdmits.length}) |`);
md.push(`| byte-fallback rate | ${(byteFallbackRate * 100).toFixed(1)}% |`);
md.push(`| moat: linked survival | ${linkedSurv != null ? (linkedSurv * 100).toFixed(1) + '%' : 'n/a'} (graded n=${nLinked}) |`);
md.push(`| moat: independent survival | ${indepSurv != null ? (indepSurv * 100).toFixed(1) + '%' : 'n/a'} (graded n=${nIndep}) |`);
md.push(`| moat: prior gap (linked − indep) | ${priorGap != null ? priorGap.toFixed(1) + ' pts' : 'n/a (insufficient graded classes)'} |`);
md.push(`| moat: two-proportion z-test | z=${zTest.z ?? 'n/a'}, p=${zTest.p ?? 'n/a'} ${K3_POWERED ? '' : '(NOT powered: needs ≥30 graded per class)'} |`);
md.push('');
md.push('### §3.7 KILL evaluation');
md.push('| gate | result |');
md.push('|---|---|');
md.push(`| K1 meaning-decisive < 2% | ${kill.k1_meaning_decisive_lt_2pct} |`);
md.push(`| K2 false-KNOT > meaning-decisive | ${kill.k2_false_knot_gt_meaning_decisive} |`);
md.push(`| K3 prior indistinguishable (gap<15pts OR p≥0.05) | ${kill.k3_prior_indistinguishable} |`);
md.push(`| hard-stop FALSE-CLEAN | ${kill.hard_stop_false_clean} |`);
md.push('');
md.push('### Per-stratum outcomes');
md.push('| stratum | n | warpline statuses | labels |');
md.push('|---|---|---|---|');
const fmtCounts = (o) => Object.entries(o).sort().map(([k, v]) => `${k}:${v}`).join(', ');
for (const [k, v] of Object.entries(strata).sort()) md.push(`| ${k} | ${v.n} | ${fmtCounts(v.statuses)} | ${fmtCounts(v.labels)} |`);
md.push('');
if (Object.keys(fidelity).length) {
  md.push('### Classification fidelity (supplementary — not a pre-registered gate)');
  md.push('| stratum | expected confidence | as-expected | n |');
  md.push('|---|---|---|---|');
  for (const [k, v] of Object.entries(fidelity)) md.push(`| ${k} | ${v.expect} | ${v.pct}% | ${v.asExpected}/${v.n} |`);
  md.push('');
}
if (Object.keys(outcomes).length) {
  md.push('### Graded outcomes by prior class (grade.json)');
  md.push('| prior class | survived | overturned | pending |');
  md.push('|---|---|---|---|');
  for (const [k, v] of Object.entries(outcomes).sort()) md.push(`| ${k} | ${v.survived} | ${v.overturned} | ${v.pending} |`);
  md.push('');
}
md.push(`### Machinery checks (${summary.mode === 'PILOT' ? 'the PILOT gate' : 'full-run sanity'})`);
md.push('| check | pass |');
md.push('|---|---|');
for (const [k, v] of Object.entries(machineryChecks)) md.push(`| ${k} | ${v ? '✓' : '✗'} |`);
md.push('');
const allMachinery = Object.values(machineryChecks).every(Boolean);
md.push(`**Machinery verdict: ${allMachinery ? 'WORKS ✓' : 'INCOMPLETE ✗'}**`);
fs.writeFileSync(path.join(here, `aggregate${FULL ? '-full' : '-dogfood'}.md`), md.join('\n') + '\n');

console.log(md.join('\n'));
console.log(`\n-> aggregate${FULL ? '-full' : '-dogfood'}.json + .md`);
