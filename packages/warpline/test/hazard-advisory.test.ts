/**
 * hazard-advisory.test — the CLEAN-hazard ADVISORY (T-2026-06-24-015).
 *
 * WHAT THIS DEFENDS, and it is two opposite things at once.
 *
 * (1) THAT THE ADVISORY CHANGES NO VERDICT. The founder deliberately declined
 *     the over-block fix in favour of measuring the real false-KNOT rate in the
 *     field (TD-2026-08-11-663), which makes the contested denominator the
 *     headline instrument of the whole field test. A feature that could add to
 *     `knots`/`dangling` — or flip `status`/`sealed` — would corrupt the number
 *     the entire value-prop proof rests on. The invariance test below is the
 *     single assertion standing between this advisory and that denominator.
 *
 * (2) THAT IT DOES NOT CATCH THE THING ITS NAME SUGGESTS. The recorded defect's
 *     canonical example — A changes a limit 100→50, B writes an unrelated retry
 *     loop assuming the old one — shares NO token, so this advisory is silent on
 *     it. That limit is pinned here as an executable assertion rather than left
 *     in a docstring, because a clean hazard list read as "no invariant conflict
 *     here" is worse than no advisory at all. Nothing may license the sentence
 *     "Warpline catches invariant conflicts."
 *
 * The real defect this DOES catch is narrower and, for an Expo app, guaranteed:
 * `cfg-lens` emits `references: []` on every config node, so config nodes are
 * permanent graph islands and any (config-value × code) pair is necessarily a
 * symbol-disjoint CLEAN that auto-weaves with zero review — with no trust floor
 * underneath it, since `K_MIN_GRADED = 3` cannot be met on a fresh repo.
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
import { evaluateHazards, rarityIndex, type CleanHazard } from '../src/fabric/hazard.js';
import { admitDecision, type AdmitDecision, type AdmitResult } from '../src/fabric/admit.js';
import { admitReportLines } from '../src/cli.js';

/** Write an in-memory tree and lift it the way `absorb` does (ts + cfg lenses). */
async function stateOf(ref: string, files: Record<string, string>): Promise<WarpState> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-hazard-'));
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

const CLEAN = { status: 'CLEAN' as const };

describe('#hazard — the CLEAN advisory catches lexical coupling the graph missed', () => {
  it('CONFIG × CODE flags — the class an Expo app produces by construction', async () => {
    // cfg nodes carry `references: []`, so a config value and the code reading it
    // are ALWAYS disjoint in the graph, no matter how tightly coupled they are in
    // fact. That disjointness is what makes this a guaranteed class, not a risk.
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

    const hazards = evaluateHazards(base, ours, theirs, CLEAN);
    expect(hazards.length, 'a shared rare literal across a graph island must flag').toBeGreaterThan(0);
    const tokens = hazards.map((h) => h.token).join(' ');
    expect(tokens).toContain('8500');
    // Both sides named, so the advisory is actionable rather than a bare alarm.
    const h = hazards.find((x) => x.token.includes('8500'))!;
    expect(h.oursSymbols.length).toBeGreaterThan(0);
    expect(h.theirsSymbols.length).toBeGreaterThan(0);
  }, 120_000);

  it('THE HONEST LIMIT — the canonical invariant case does NOT flag (no shared token)', async () => {
    // The recorded defect, exactly as written: A lowers a limit; B adds a retry
    // loop that assumes the old one. Jointly wrong, zero shared literals. This
    // MUST come back empty — and anyone reading an empty list as safety has been
    // misled, which is why the limit is executable and not merely documented.
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

    expect(
      evaluateHazards(base, ours, theirs, CLEAN),
      'the canonical case shares no token — this advisory is structurally blind to it',
    ).toEqual([]);
  }, 120_000);

  it('a HIGH-FREQUENCY token does not flag — rarity is the whole noise control', async () => {
    // `0` appears everywhere; two agents both touching it is coincidence, not
    // coupling. Without the rarity weighting this advisory would fire constantly
    // and be ignored, which is the failure mode that makes advisories worthless.
    const common = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`src/c${i}.ts`, `export function c${i}(): number { return 0; }\n`]),
    );
    const base = await stateOf('base', {
      ...common,
      'src/a.ts': `export function a(): number { return 1; }\n`,
      'src/b.ts': `export function b(): number { return 2; }\n`,
    });
    const ours = await stateOf('ours', {
      ...common,
      'src/a.ts': `export function a(): number { return 0; }\n`,
      'src/b.ts': `export function b(): number { return 2; }\n`,
    });
    const theirs = await stateOf('theirs', {
      ...common,
      'src/a.ts': `export function a(): number { return 1; }\n`,
      'src/b.ts': `export function b(): number { return 0; }\n`,
    });

    const hazards = evaluateHazards(base, ours, theirs, CLEAN);
    expect(hazards.some((h) => /(^|:)0$/.test(h.token)), 'num:0 is ubiquitous — must not flag').toBe(false);
  }, 120_000);

  it('returns [] for every non-CLEAN status — it cannot ride a contested verdict', async () => {
    const base = await stateOf('base', { 'src/m.ts': `export function m(): number { return 4242; }\n` });
    const ours = await stateOf('ours', { 'src/m.ts': `export function m(): number { return 9191; }\n` });
    const theirs = await stateOf('theirs', { 'src/m.ts': `export function m(): number { return 7373; }\n` });
    for (const status of ['KNOT', 'DANGLE', 'FAST_ADMIT', 'NOOP', 'HELD'] as const) {
      expect(evaluateHazards(base, ours, theirs, { status }), `${status} must yield no advisory`).toEqual([]);
    }
  }, 120_000);

  /**
   * THE INVARIANCE TEST. The one assertion protecting the field-test denominator.
   * Whatever the advisory computes, the VERDICT is a pure function of structural
   * inputs and must be byte-identical whether hazards fire or not.
   */
  it('INVARIANCE — the verdict is byte-identical with hazards firing and not firing', async () => {
    // Two trees that differ ONLY in whether a rare literal is shared across the
    // two sides. Same shape, same symbols, same disjointness — so any difference
    // in the decision would have to come from the advisory itself.
    const mk = async (oursLit: string, theirsLit: string) => {
      const base = await stateOf('base', {
        'app.json': `{"k":1234}`,
        'src/x.ts': `export function x(): number { return 1234; }\n`,
      });
      const ours = await stateOf('ours', {
        'app.json': `{"k":${oursLit}}`,
        'src/x.ts': `export function x(): number { return 1234; }\n`,
      });
      const theirs = await stateOf('theirs', {
        'app.json': `{"k":1234}`,
        'src/x.ts': `export function x(): number { return ${theirsLit}; }\n`,
      });
      return { base, ours, theirs };
    };

    const shared = await mk('55501', '55501'); // same rare literal → hazard fires
    const apart = await mk('55501', '77702'); // different literals → nothing shared

    const firing = evaluateHazards(shared.base, shared.ours, shared.theirs, CLEAN);
    const quiet = evaluateHazards(apart.base, apart.ours, apart.theirs, CLEAN);
    expect(firing.length, 'the shared-literal arm must actually fire, or this proves nothing').toBeGreaterThan(0);
    expect(quiet).toEqual([]);

    // THE POINT: the real decision engine never sees the advisory. Same inputs
    // through admitDecision, with and without a hazard present, and the verdict
    // serializes identically in both arms of each pair.
    for (const t of [shared, apart]) {
      const before = JSON.stringify(admitDecision(t.base, t.ours, t.theirs));
      evaluateHazards(t.base, t.ours, t.theirs, CLEAN); // computing it must not mutate state
      const after = JSON.stringify(admitDecision(t.base, t.ours, t.theirs));
      expect(after, 'evaluating hazards perturbed the decision').toBe(before);
      const decoded = JSON.parse(before) as { knots: unknown[]; dangling: unknown[] };
      expect(decoded.knots, 'an advisory must never add a knot').toEqual([]);
      expect(decoded.dangling, 'an advisory must never add a dangle').toEqual([]);
    }
  }, 180_000);

  it('is PURE — same inputs, same output, no ordering or clock drift', async () => {
    const base = await stateOf('base', {
      'app.json': `{"k":31337}`,
      'src/y.ts': `export function y(): number { return 1; }\n`,
    });
    const ours = await stateOf('ours', {
      'app.json': `{"k":31337}`,
      'src/y.ts': `export function y(): number { return 31337; }\n`,
    });
    const theirs = await stateOf('theirs', {
      'app.json': `{"k":31337}`,
      'src/y.ts': `export function y(): number { return 31337; }\n`,
    });
    const rarity = rarityIndex(base);
    const a = JSON.stringify(evaluateHazards(base, ours, theirs, CLEAN, { rarity }));
    const b = JSON.stringify(evaluateHazards(base, ours, theirs, CLEAN, { rarity }));
    const c = JSON.stringify(evaluateHazards(base, ours, theirs, CLEAN)); // rarity recomputed
    expect(b).toBe(a);
    expect(c).toBe(a);
  }, 120_000);
});

/**
 * FIX A — the SURFACE-AND-SAMPLE posture (T-2026-06-24-015, TD-2026-08-12-831).
 *
 * The engine tests above pin what the advisory computes. These pin what the CLI
 * SAYS — the two honest surface strings — and, most importantly, that saying
 * them changes no verdict field. Protocol §8 (line 711) requires the CLI to
 * "say so in the same breath": an independent-CLEAN sealed BECAUSE the two
 * changed sets are symbol-disjoint, which is exactly the case that carries no
 * cross-symbol invariant guarantee, so it must announce that on EVERY such
 * admit — not only when the LEXICAL advisory happens to fire.
 */
const DISCLAIMER_SIG = 'independent-CLEAN: the two changed sets are SYMBOL-DISJOINT';
const ADVISORY_SIG = 'LEXICAL coupling advisor';

function cleanDecision(confidence: 'linked' | 'independent'): AdmitDecision {
  return {
    status: 'CLEAN',
    knots: [],
    dangling: [],
    confidence,
    rebasedOnto: 'selvage-tip-000',
    agentChanged: ['#net'],
    otherChanged: ['#cfg:app.json'],
  };
}

/** A minimal CLEAN AdmitResult — only the fields the printer reads. */
function cleanResult(opts: {
  confidence: 'linked' | 'independent';
  sealed: boolean;
  hazards?: CleanHazard[];
}): AdmitResult {
  return {
    decision: cleanDecision(opts.confidence),
    sealed: opts.sealed,
    proposedStateId: 'proposed-000',
    ...(opts.sealed ? { strand: { pickId: 'pick0000', stateId: 'state000', seq: 1 } } : {}),
    ...(opts.hazards ? { hazards: opts.hazards } : {}),
  } as unknown as AdmitResult;
}

const SAMPLE_HAZARD: CleanHazard = {
  kind: 'cfg-island',
  token: 'num:8500',
  oursSymbols: ['#net'],
  theirsSymbols: ['#cfg:app.json'],
  rarity: 1,
  score: 1,
  dangerFlags: [],
};

describe('#hazard FIX A — the honest surface strings, and their invariance', () => {
  it('the STANDING DISCLAIMER fires on an independent-CLEAN sealed admit', () => {
    const out = admitReportLines('agent-x', cleanResult({ confidence: 'independent', sealed: true })).join('\n');
    expect(out, 'protocol §8 L711: the CLI must say so in the same breath').toContain(DISCLAIMER_SIG);
    expect(out).toContain('NO cross-symbol invariant guarantee');
  });

  it('the disclaimer fires EVEN WITH NO hazards — an empty list is the dangerous read', () => {
    // The whole point: a clean (empty) hazard list must not read as an all-clear.
    const noHaz = cleanResult({ confidence: 'independent', sealed: true });
    expect(noHaz.hazards, 'this arm carries no advisory at all').toBeUndefined();
    expect(admitReportLines('agent-x', noHaz).join('\n')).toContain(DISCLAIMER_SIG);
  });

  it('the disclaimer is SCOPED — a linked CLEAN does not carry it', () => {
    const out = admitReportLines('agent-x', cleanResult({ confidence: 'linked', sealed: true })).join('\n');
    expect(out).not.toContain(DISCLAIMER_SIG);
  });

  it('INVARIANCE — neither the disclaimer nor the advisory alters status / sealed / the contested count', () => {
    const withHaz = cleanResult({ confidence: 'independent', sealed: true, hazards: [SAMPLE_HAZARD] });
    const withoutHaz = cleanResult({ confidence: 'independent', sealed: true });

    // Rendering is a pure read: it must not mutate the verdict it is describing.
    const snapWith = JSON.stringify(withHaz.decision);
    const snapWithout = JSON.stringify(withoutHaz.decision);
    const linesWith = admitReportLines('a', withHaz).join('\n');
    const linesWithout = admitReportLines('a', withoutHaz).join('\n');
    expect(JSON.stringify(withHaz.decision), 'printing perturbed the decision').toBe(snapWith);
    expect(JSON.stringify(withoutHaz.decision)).toBe(snapWithout);

    // The verdict fields are BYTE-IDENTICAL across the hazard / no-hazard arms —
    // the advisory rides on top of the verdict, it never becomes part of it.
    expect(withHaz.decision.status).toBe(withoutHaz.decision.status);
    expect(withHaz.decision.status).toBe('CLEAN');
    expect(withHaz.sealed).toBe(withoutHaz.sealed);
    expect(withHaz.sealed).toBe(true);
    // The contested denominator (knots || dangling) is empty in BOTH — an
    // advisory can never move it (the field-test instrument stays intact).
    expect(withHaz.decision.knots).toEqual([]);
    expect(withHaz.decision.dangling).toEqual([]);
    expect(withoutHaz.decision.knots).toEqual([]);
    expect(withoutHaz.decision.dangling).toEqual([]);

    // The disclaimer is present in BOTH arms (independent of hazards firing);
    // the LEXICAL advisory block appears ONLY when a hazard is present.
    expect(linesWith).toContain(DISCLAIMER_SIG);
    expect(linesWithout).toContain(DISCLAIMER_SIG);
    expect(linesWith).toContain(ADVISORY_SIG);
    expect(linesWithout).not.toContain(ADVISORY_SIG);
  });
});
