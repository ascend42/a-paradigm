/**
 * forecast-hazard.test — the CLEAN-hazard ADVISORY on the FORECAST surfaces
 * (T-2026-08-11-016). The advisory (#hazard) was wired ONLY into `fabric/admit`,
 * so the `oracle` and `weave --preview` forecasts were hazard-BLIND for the very
 * case the advisory CAN catch: a jointly-wrong (config × code) pair previewed as
 * an unqualified CLEAN, while the SAME merge through admit surfaced the coupling.
 * A preview must never be MORE optimistic than the act it forecasts.
 *
 * This pins the shared core BOTH forecast surfaces call (`oracle.forecastHazards`):
 * it fires on the config×code class an Expo app produces by construction, stays
 * silent on the canonical no-shared-token invariant case (the honest blind spot),
 * and — because it is ADVISORY-ONLY — never rides anything but a meaning-CLEAN
 * forecast and honours the project's `hazard: off` switch.
 *
 * Setup mirrors test/hazard-advisory.test.ts (in-memory ts + cfg lift).
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildSymbolIndex,
  type AggregationResult,
} from '@a-company/premise-core';
import { TsLens } from '../src/lens/ts-lens.js';
import { CfgLens } from '../src/lens/cfg-lens.js';
import { injectCodeUnits } from '../src/lens/lift-code-units.js';
import { buildWarpState, type WarpState } from '../src/warp/warp-state.js';
import { forecastHazards } from '../src/oracle.js';

/** Write an in-memory tree and lift it the way `absorb` does (ts + cfg lenses). */
async function stateOf(ref: string, files: Record<string, string>): Promise<WarpState> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-fc-hazard-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, 'utf8');
    }
    const empty: AggregationResult = {
      symbols: [], purposeFiles: [], portalFiles: [], errors: [], timestamp: 0,
    };
    const index = buildSymbolIndex(empty);
    injectCodeUnits(index, [
      ...(await new TsLens().lift(dir)),
      ...(await new CfgLens().lift(dir)),
    ]);
    return buildWarpState(index, { ref, treeSha: null, rootDir: dir });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** The config × code jointly-wrong pair — cfg nodes are graph islands, so this is
 *  a symbol-disjoint CLEAN that auto-weaves with zero review by construction. */
async function configXCode(): Promise<{ base: WarpState; ours: WarpState; theirs: WarpState }> {
  const base = await stateOf('base', {
    'app.json': `{"expo":{"name":"app","apiTimeoutMs":3000}}`,
    'src/net.ts': `export function timeout(): number { return 3000; }\n`,
  });
  const ours = await stateOf('ours', {
    'app.json': `{"expo":{"name":"app","apiTimeoutMs":8500}}`,
    'src/net.ts': `export function timeout(): number { return 3000; }\n`,
  });
  const theirs = await stateOf('theirs', {
    'app.json': `{"expo":{"name":"app","apiTimeoutMs":3000}}`,
    'src/net.ts': `export function timeout(): number { return 8500; }\n`,
  });
  return { base, ours, theirs };
}

describe('#hazard on the FORECAST surface — oracle/weave preview is no longer hazard-blind', () => {
  it('CONFIG × CODE jointly-wrong — the forecast SURFACES the coupling admit would', async () => {
    // The audit reproduced this exact silence: `warpline oracle <config> <code>` on a
    // jointly-wrong rateLimit pair printed MERGE CLEAN ✓ with no advisory. The forecast
    // core must now fire on it, matching what admit surfaces.
    const { base, ours, theirs } = await configXCode();
    const hazards = forecastHazards(base, ours, theirs, /* meaningClean */ true);
    expect(hazards.length, 'a shared rare literal across a graph island must flag on the preview').toBeGreaterThan(0);
    const h = hazards.find((x) => x.token.includes('8500'))!;
    expect(h, 'the shared 8500 literal is the coupling').toBeTruthy();
    expect(h.oursSymbols.length).toBeGreaterThan(0);
    expect(h.theirsSymbols.length).toBeGreaterThan(0);
  }, 120_000);

  it('rides ONLY a meaning-CLEAN forecast — a DECISIONS forecast surfaces none', async () => {
    // Advisory parity with admit: the hazard rides a CLEAN verdict only. When the
    // forecast is not meaning-clean (knots/dangling present), the surface passes
    // meaningClean=false and the advisory is silent — it can never qualify a
    // contested forecast into looking noisier than its verdict.
    const { base, ours, theirs } = await configXCode();
    expect(
      forecastHazards(base, ours, theirs, /* meaningClean */ false),
      'a non-clean forecast must carry no advisory',
    ).toEqual([]);
  }, 120_000);

  it('honours `hazard: off` — the switch that silences the advisory silences the preview too', async () => {
    const { base, ours, theirs } = await configXCode();
    expect(forecastHazards(base, ours, theirs, true, { off: true })).toEqual([]);
    // and the same inputs DO fire when not switched off — proving `off` is what quieted it.
    expect(forecastHazards(base, ours, theirs, true, { off: false }).length).toBeGreaterThan(0);
  }, 120_000);

  it('THE HONEST LIMIT — the canonical no-shared-token case does NOT flag on the preview', async () => {
    // A lowers a limit; B adds a retry loop assuming the old one. Jointly wrong, zero
    // shared literals. The preview is blind to it exactly as admit is — an empty list
    // is NOT an all-clear, and the preview must not pretend otherwise.
    const base = await stateOf('base', {
      'src/limit.ts': `export function rateLimit(): number { return 100; }\n`,
      'src/retry.ts': `export function attempts(): number { return 1; }\n`,
    });
    const ours = await stateOf('ours', {
      'src/limit.ts': `export function rateLimit(): number { return 50; }\n`,
      'src/retry.ts': `export function attempts(): number { return 1; }\n`,
    });
    const theirs = await stateOf('theirs', {
      'src/limit.ts': `export function rateLimit(): number { return 100; }\n`,
      'src/retry.ts': `export function attempts(): number { return 7; }\n`,
    });
    expect(forecastHazards(base, ours, theirs, true)).toEqual([]);
  }, 120_000);
});
