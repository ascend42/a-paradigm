/**
 * #gnomon-probes P12 (probes/p12-excalidraw-csp/harness.mjs): how an engine's runs are counted, on fabricated run
 * records (T-2026-11-25-002). Every run is two pages, the pinned bytes and the probe build.
 *  - a run is mounted only if BOTH its pages mounted;
 *  - every page that sent no report is listed in nonReportingRuns, the pinned page included, with its wall time,
 *    why it missed and the launcher's last lines;
 *  - a missed report or a timeout is never clean, and a late report's CSP row is a violation;
 *  - only a page that sent no report may be retried, never one that reported and never a late CSP row.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs probe harness (no types)
import { engineProblems, MISS, missRow, NO_REPORT, retryable, runAccounting, runMounted } from '../probes/p12-excalidraw-csp/harness.mjs';

const KNOWN = new Set(['/index.html', '/pinned.html', '/harness.js', '/harness.css', '/board/board.js', '/board/board.css']);
const PASTE = { via: 'synthetic', carried: 'text', types: ['text/plain'], stopped: true, added: 0, said: [], heard: 0, literal: false, engine: 0, nodes: [], violations: 0 };
// a contained pinned page (the shapes of test/p12-paste-judge.test.ts)
const CONTAINED = { paste: PASTE, hostile: PASTE, svg: PASTE, filePaste: { carried: 'file', types: ['Files'], added: 0, said: ['image'], stopped: true, engine: 0 }, copy: { stopped: true, types: ['text/plain'], added: 0, engine: 0 }, pwn: null };
const base = { stage: 'done', mounted: true, violationCount: 0, violations: [], afterAdd: 3, afterAddSettled: 3, alive: true, aliveAfterUnmount: false, deadHandle: 'refused', png: { ok: true }, errors: [], rejections: [], requests: [{ path: '/board/board.js' }] };
const pinnedOk = { ...base, mode: 'pinned', wallMs: 9000, fix: CONTAINED, syntheticDraw: { added: 0, edits: 0 } };
const probeOk = { ...base, mode: 'probe', wallMs: 40000, ms: { module: 100, mounted: 200 } };
const miss = (mode: string, extra: Record<string, unknown> = {}) => missRow(mode, { wallMs: 90_000, launcherTail: 'last lines', miss: 'no-report', exit: null, pageRequestedMs: 800, ...extra }, [{ method: 'GET', path: '/pinned.html' }]);
// the probe page's own checks (the reskin walk) are other tests' business: these look at the pinned page's rows,
// and at the probe page's miss
const pinnedOf = (ps: string[]) => ps.filter((p) => p.startsWith('run 1 (pinned bytes)') || p === 'run 1: the pinned bytes were not run');
const run = (probe: Record<string, unknown>, pinned: Record<string, unknown> | null) => ({ ...probe, pinned });

describe('P12 run accounting: both pages count', () => {
  it('a run whose two pages mounted is mounted; a missed pinned page makes the run not mounted (the CI rows said 3 of 3)', () => {
    const rows = [run(probeOk, pinnedOk), run(probeOk, miss('pinned')), run(probeOk, pinnedOk)];
    expect(runMounted(rows[0])).toBe(true);
    expect(runMounted(rows[1])).toBe(false);
    expect(runAccounting(rows).mountedRuns).toBe(2);
    expect(runAccounting(rows).runs).toBe(3);
  });

  it('a missed probe page, a pinned page that did not mount, or no pinned row at all: not mounted', () => {
    expect(runMounted(run(miss('probe'), pinnedOk))).toBe(false);
    expect(runMounted(run(probeOk, { ...pinnedOk, mounted: false, stage: 'driver-error' }))).toBe(false);
    expect(runMounted(run(probeOk, null))).toBe(false);
  });

  it('nonReportingRuns lists a pinned-page miss with its wall time, its cause and the launcher tail', () => {
    const rows = [run(probeOk, pinnedOk), run(probeOk, miss('pinned', { miss: 'exited', exit: { code: 0, signal: null, atMs: 2100 }, wallMs: 3600 }))];
    expect(runAccounting(rows).nonReportingRuns).toEqual([{ run: 2, page: 'pinned', wallMs: 3600, miss: 'exited', exit: { code: 0, signal: null, atMs: 2100 }, pageRequestedMs: 800, launcherTail: 'last lines' }]);
  });

  it('nonReportingRuns lists both pages of a run when both missed, and a probe-page miss as such', () => {
    const got = runAccounting([run(miss('probe', { miss: 'never-requested', pageRequestedMs: null, wallMs: 30_000 }), miss('pinned'))]).nonReportingRuns;
    expect(got.map((x: { run: number; page: string; miss: string }) => [x.run, x.page, x.miss])).toEqual([[1, 'probe', 'never-requested'], [1, 'pinned', 'no-report']]);
    expect(got.every((x: { launcherTail: string }) => x.launcherTail === 'last lines')).toBe(true);
  });

  it('violations are counted on both pages, and on a report that came after the timeout', () => {
    const v = [{ directive: 'img-src', blocked: 'data', phase: 'tools', count: 1 }];
    const rows = [run({ ...probeOk, violationCount: 1, violations: v }, { ...pinnedOk, violationCount: 2, violations: [{ directive: 'style-src-attr', blocked: 'inline', phase: 'pinned', count: 2 }] })];
    const late = miss('pinned', { lateReport: { stage: 'watchdog', violations: [{ directive: 'script-src', blockedURI: 'eval' }] } });
    rows.push(run(probeOk, late));
    const acc = runAccounting(rows);
    expect(acc.violationCount).toBe(4);
    expect(acc.violatedDirectives.sort()).toEqual(['img-src', 'script-src', 'style-src-attr']);
  });
});

describe('P12: a timeout or a missed report is never clean', () => {
  it('a missed pinned page or probe page is a problem, and says why', () => {
    expect(pinnedOf(engineProblems([run(probeOk, pinnedOk)], KNOWN))).toEqual([]);
    expect(pinnedOf(engineProblems([run(probeOk, miss('pinned'))], KNOWN))).toEqual([`run 1 (pinned bytes): ${NO_REPORT} (${MISS['no-report']})`]);
    expect(engineProblems([run(miss('probe', { miss: 'exited' }), pinnedOk)], KNOWN)).toEqual([`run 1 (probe build): ${NO_REPORT} (${MISS.exited})`]);
    expect(pinnedOf(engineProblems([run(probeOk, null)], KNOWN))).toEqual(['run 1: the pinned bytes were not run']);
  });

  it('a page cut off by its watchdog is a problem (the Chrome rows on CI: stage watchdog, no PNG)', () => {
    expect(engineProblems([run({ ...probeOk, stage: 'watchdog', png: undefined }, pinnedOk)], KNOWN).join(' | ')).toMatch(/PNG export failed: undefined.*stage watchdog/);
  });

  it('a late report does not make a miss clean, and its CSP row is reported as a violation', () => {
    const late = miss('pinned', { lateReport: { stage: 'done', violations: [] } });
    expect(pinnedOf(engineProblems([run(probeOk, late)], KNOWN))).toEqual([`run 1 (pinned bytes): ${NO_REPORT} (${MISS['no-report']})`]);
    const bad = miss('pinned', { lateReport: { stage: 'done', violations: [{ directive: 'img-src', blockedURI: 'data' }] } });
    expect(pinnedOf(engineProblems([run(probeOk, bad)], KNOWN)).join(' | ')).toMatch(/1 CSP violation\(s\) in a report that came after the timeout: img-src data/);
  });
});

describe('P12 retry: only a page that sent no report', () => {
  it('a missed page may be retried, whatever the miss', () => {
    for (const why of Object.keys(MISS)) expect(retryable(miss('pinned', { miss: why }))).toBe(true);
  });
  it('a page that reported is never retried, clean or not; a CSP violation above all', () => {
    expect(retryable(pinnedOk)).toBe(false);
    expect(retryable({ ...pinnedOk, violationCount: 1, violations: [{ directive: 'img-src', blocked: 'data', phase: 'pinned', count: 1 }] })).toBe(false);
    expect(retryable({ ...probeOk, stage: 'watchdog' })).toBe(false);
    expect(retryable({ ...probeOk, mounted: false })).toBe(false);
  });
  it('a miss whose late report carries a CSP row is never retried', () => {
    expect(retryable(miss('pinned', { lateReport: { stage: 'watchdog', violations: [{ directive: 'img-src', blockedURI: 'data' }] } }))).toBe(false);
  });
});
