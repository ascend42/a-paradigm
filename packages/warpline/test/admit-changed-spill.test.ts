/**
 * `warpline admit`'s changed-symbol rendering must not dump an unbounded array
 * onto the default surface. A worktree admit computed a 4.4 MB `agentChanged`
 * set in the field (T-2026-07-17-009). The report now caps the inline list at a
 * top-N sample + total, and — when a spill dir is available — spills the FULL
 * set to `.paradigm/spill/` and prints a `paradigm_retrieve` handle (#spill).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { admitReportLines } from '../src/cli.js';
import type { AdmitDecision, AdmitResult } from '../src/fabric/admit.js';
import { retrieveSpilled, spillDirFor } from '@a-company/premise-core';

const BIG_N = 2000;

function cleanResult(agentChanged: string[]): AdmitResult {
  const decision: AdmitDecision = {
    status: 'CLEAN',
    knots: [],
    dangling: [],
    confidence: 'linked',
    rebasedOnto: null,
    agentChanged,
    otherChanged: [],
  };
  return {
    schemaVersion: 'admitResult:v1',
    decision,
    sealed: false,
    proposedStateId: 'state:p',
  } as AdmitResult;
}

describe('warpline admit — changed-set spill (#spill, T-2026-07-17-009)', () => {
  let root: string;
  const big = Array.from({ length: BIG_N }, (_, i) => `#symbol-${i}-with-a-realistically-long-identifier-name`);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-admit-spill-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('does NOT dump the full array; caps at a top-N sample + total', () => {
    const lines = admitReportLines('agent-x', cleanResult(big));
    const text = lines.join('\n');

    // The last few symbols must NOT appear — the array was not dumped whole.
    expect(text).not.toContain(`#symbol-${BIG_N - 1}-with-a-realistically-long-identifier-name`);
    // The cap sample and the total are both surfaced.
    expect(text).toContain('#symbol-0-with-a-realistically-long-identifier-name');
    expect(text).toMatch(/more of 2000/);
  });

  it('with a spill dir, writes the FULL set to disk and prints a retrievable handle', () => {
    const lines = admitReportLines('agent-x', cleanResult(big), { spillDir: spillDirFor(root) });
    const text = lines.join('\n');

    // A handle is advertised.
    const m = text.match(/handle (admit-agent-changed-[A-Za-z0-9._-]+)/);
    expect(m, 'admit output should advertise a spill handle').toBeTruthy();
    const handle = m![1];

    // The full set rehydrates EXACTLY via paradigm_retrieve's core.
    const back = retrieveSpilled(handle, { dir: spillDirFor(root) });
    expect(back.found).toBe(true);
    expect(back.total).toBe(BIG_N);
    expect(back.payload).toEqual(big);
  });

  it('small changed sets still render inline in full (no spill)', () => {
    const small = ['#a', '#b', '#c'];
    const lines = admitReportLines('agent-x', cleanResult(small), { spillDir: spillDirFor(root) });
    const text = lines.join('\n');
    expect(text).toContain('#a, #b, #c');
    expect(text).not.toMatch(/handle admit-/);
    // Nothing was spilled.
    expect(fs.existsSync(spillDirFor(root))).toBe(false);
  });
});
