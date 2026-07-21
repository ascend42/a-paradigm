/**
 * refusal.test — `refusal:v1`, the MACHINE-READABLE REFUSAL (SP0/SP1, founder
 * constraint TD-2026-07-21-766; pre-registered falsifier F4 "cold-agent
 * legibility").
 *
 * What these tests actually defend: an agent with no Warpline in its weights and
 * no Warpline docs in context must recover from a refusal using ONLY the
 * returned object. So the invariants under test are not "the code runs" — they
 * are the properties a cold model's recovery DEPENDS on:
 *
 *   - exitCodeFor is TOTAL over RefusalCode, and never returns 0 (a refusal that
 *     exits success is a silent wrong-merge at the shell layer).
 *   - a truncated `contested` always carries the true `contestedTotal` — a
 *     truncated list without a total is a lie.
 *   - truncation keeps the DIRECT-contested units (ground truth says the ripple
 *     avalanche is the noise), so the cap never discards the signal.
 *   - `refuse` is deterministic: same input ⇒ byte-identical output.
 *   - pointers never carry empty/undefined keys (every pointer must dereference).
 */

import { describe, it, expect } from 'vitest';
import {
  refuse,
  contestedOf,
  exitCodeFor,
  gateFor,
  retriabilityFor,
  REFUSAL_SCHEMA,
  MAX_CONTESTED,
  type RefusalCode,
  type RefusalContested,
  type RefusalGate,
  type Retriability,
} from '../src/fabric/refusal.js';
import type { Knot, Dangle } from '../src/predict.js';

/**
 * EVERY RefusalCode, enumerated. `satisfies Record<RefusalCode, …>` is the
 * exhaustiveness gate: adding a code to the union without adding it here fails
 * to COMPILE, so "total" below means total, not "total over what we remembered".
 */
const ALL_CODES = {
  GATE_REFUSED: 1,
  CLAIM_BREACH: 3,
  TRUST_HELD: 4,
  STALE_BASE: 5,
  INTEGRITY_BROKEN: 1,
  AUTH: 2,
  FORBIDDEN: 2,
  BAD_REQUEST: 2,
  UNKNOWN_VERB: 2,
  NOT_FOUND: 2,
  UNSUPPORTED: 2,
  ENGINE: 1,
} satisfies Record<RefusalCode, number>;

const CODES = Object.keys(ALL_CODES) as RefusalCode[];

const contested = (stableKey: string, rank: 'direct' | 'ripple'): RefusalContested => ({
  stableKey,
  symbol: `sym-${stableKey}`,
  rule: 'conflicting-slot',
  conflictingSlots: ['body'],
  rank,
});

// ===========================================================================
// 1. exitCodeFor — TOTALITY + the documented contract table.
// ===========================================================================
describe('exitCodeFor — total over RefusalCode', () => {
  it('maps every code to the exit contract, exactly', () => {
    for (const code of CODES) {
      expect(exitCodeFor(code), `exit code for ${code}`).toBe(ALL_CODES[code]);
    }
  });

  it('never returns 0 — a refusal must never exit success', () => {
    for (const code of CODES) expect(exitCodeFor(code)).not.toBe(0);
  });

  it('only ever returns a code in the published 1..5 band', () => {
    for (const code of CODES) expect([1, 2, 3, 4, 5]).toContain(exitCodeFor(code));
  });

  it('fails CLOSED (1 = Warpline refuses) on an unmapped code', () => {
    // A code added to the union but not to the table would be a compile error
    // upstream; this pins the RUNTIME posture for a value that arrives across a
    // wire from a newer peer — refuse, never leak a success exit.
    expect(exitCodeFor('NOT_A_REAL_CODE' as RefusalCode)).toBe(1);
  });

  it('gives claim / trust / stale-base their own codes (distinct recoveries)', () => {
    // These three are separated precisely because the RECOVERY differs; if they
    // ever collapse, a shell-only agent loses the ability to branch.
    const distinct = new Set([exitCodeFor('CLAIM_BREACH'), exitCodeFor('TRUST_HELD'), exitCodeFor('STALE_BASE')]);
    expect(distinct.size).toBe(3);
  });
});

describe('gateFor / retriabilityFor — total over RefusalCode', () => {
  const GATES: RefusalGate[] = ['meaning', 'claim', 'trust', 'pick', 'transport', 'usage'];
  const RETRY: Retriability[] = [
    'retry-identical',
    'retry-after-rebase',
    'retry-after-resolve',
    'retry-with-override',
    'never',
  ];

  it('returns a legal gate for every code', () => {
    for (const code of CODES) expect(GATES).toContain(gateFor(code));
  });

  it('returns a legal retriability for every code', () => {
    for (const code of CODES) expect(RETRY).toContain(retriabilityFor(code));
  });

  it('routes the fail-SAFE holds to their override doors', () => {
    expect(retriabilityFor('CLAIM_BREACH')).toBe('retry-with-override');
    expect(retriabilityFor('TRUST_HELD')).toBe('retry-with-override');
    expect(gateFor('CLAIM_BREACH')).toBe('claim');
    expect(gateFor('TRUST_HELD')).toBe('trust');
  });

  it('fails closed on an unknown code (never a retry, never a meaning gate)', () => {
    expect(retriabilityFor('NOPE' as RefusalCode)).toBe('never');
    expect(gateFor('NOPE' as RefusalCode)).toBe('usage');
  });
});

// ===========================================================================
// 2. refuse() — the single constructor.
// ===========================================================================
describe('refuse — the single constructor', () => {
  it('stamps the schema and derives gate/retriable from the code', () => {
    const r = refuse({ code: 'CLAIM_BREACH', verdict: 'CLAIM-BREACH' });
    expect(r.schemaVersion).toBe(REFUSAL_SCHEMA);
    expect(r.code).toBe('CLAIM_BREACH');
    expect(r.verdict).toBe('CLAIM-BREACH');
    expect(r.gate).toBe('claim');
    expect(r.retriable).toBe('retry-with-override');
  });

  it('defaults verdict to null (transport/usage refusals carry no verdict)', () => {
    expect(refuse({ code: 'BAD_REQUEST' }).verdict).toBeNull();
  });

  it('lets a call site override gate and retriability', () => {
    // The R2 pick gate raises GATE_REFUSED at gate:'pick', not gate:'meaning' —
    // one code, two gates, which is exactly why these are overridable.
    const r = refuse({ code: 'GATE_REFUSED', gate: 'pick', retriable: 'retry-with-override' });
    expect(r.gate).toBe('pick');
    expect(r.retriable).toBe('retry-with-override');
  });

  it('defaults contested/next/pointers to empty rather than undefined', () => {
    const r = refuse({ code: 'ENGINE' });
    expect(r.contested).toEqual([]);
    expect(r.contestedTotal).toBe(0);
    expect(r.next).toEqual([]);
    expect(r.pointers).toEqual({});
  });

  it('omits `override` entirely when no override door exists', () => {
    expect('override' in refuse({ code: 'ENGINE' })).toBe(false);
    expect(refuse({ code: 'TRUST_HELD', override: { flag: 'acceptRisk', principal: 'human' } }).override)
      .toEqual({ flag: 'acceptRisk', principal: 'human' });
  });

  // ── the truncation contract ──────────────────────────────────────────────
  it('caps contested at MAX_CONTESTED but reports the TRUE total', () => {
    const many = Array.from({ length: MAX_CONTESTED + 25 }, (_, i) =>
      contested(`k${String(i).padStart(3, '0')}`, 'direct'),
    );
    const r = refuse({ code: 'GATE_REFUSED', contested: many });
    expect(r.contested).toHaveLength(MAX_CONTESTED);
    // A truncated list without a total is a lie.
    expect(r.contestedTotal).toBe(MAX_CONTESTED + 25);
  });

  it('keeps the DIRECT units when it truncates — the cap never eats the signal', () => {
    // The avalanche shape from ground truth: a handful of genuinely contested
    // units buried under a large ripple set. Feed the ripple FIRST so only
    // ranking (not input order) can save the direct ones.
    const ripple = Array.from({ length: MAX_CONTESTED + 40 }, (_, i) => contested(`r${i}`, 'ripple'));
    const direct = Array.from({ length: 5 }, (_, i) => contested(`d${i}`, 'direct'));
    const r = refuse({ code: 'GATE_REFUSED', contested: [...ripple, ...direct] });

    expect(r.contested).toHaveLength(MAX_CONTESTED);
    expect(r.contested.filter((c) => c.rank === 'direct')).toHaveLength(5);
    // …and they lead, so `contested[0]` is the unit worth a human's attention.
    expect(r.contested.slice(0, 5).every((c) => c.rank === 'direct')).toBe(true);
    expect(r.contestedTotal).toBe(MAX_CONTESTED + 45);
  });

  it('orders direct-before-ripple, then by stableKey (stable truncation)', () => {
    const r = refuse({
      code: 'GATE_REFUSED',
      contested: [contested('z', 'ripple'), contested('b', 'direct'), contested('a', 'ripple'), contested('a2', 'direct')],
    });
    expect(r.contested.map((c) => c.stableKey)).toEqual(['a2', 'b', 'a', 'z']);
  });

  it('honors an explicit contestedTotal when the caller’s array is itself partial', () => {
    const r = refuse({ code: 'GATE_REFUSED', contested: [contested('a', 'direct')], contestedTotal: 97 });
    expect(r.contested).toHaveLength(1);
    expect(r.contestedTotal).toBe(97);
  });

  it('does not mutate the caller’s contested array', () => {
    const input = [contested('z', 'ripple'), contested('a', 'direct')];
    refuse({ code: 'GATE_REFUSED', contested: input });
    expect(input.map((c) => c.stableKey)).toEqual(['z', 'a']);
  });

  // ── pointers ─────────────────────────────────────────────────────────────
  it('prunes empty/undefined pointer keys — every pointer must dereference', () => {
    const r = refuse({
      code: 'GATE_REFUSED',
      pointers: {
        knotPayloadId: undefined,
        proposedStateId: 'state:v0:abc',
        rebasedOnto: '',
        claimId: undefined,
        symbols: [],
      },
    });
    expect(r.pointers).toEqual({ proposedStateId: 'state:v0:abc' });
    expect('knotPayloadId' in r.pointers).toBe(false);
    expect('symbols' in r.pointers).toBe(false);
  });

  it('copies the symbols array rather than aliasing the caller’s', () => {
    const symbols = ['#a', '#b'];
    const r = refuse({ code: 'CLAIM_BREACH', pointers: { symbols } });
    symbols.push('#c');
    expect(r.pointers.symbols).toEqual(['#a', '#b']);
  });

  // ── determinism (the #knot-payload discipline) ───────────────────────────
  it('is deterministic: same input ⇒ byte-identical output', () => {
    const input = {
      code: 'GATE_REFUSED' as const,
      verdict: 'KNOT' as const,
      contested: [contested('b', 'ripple'), contested('a', 'direct')],
      pointers: { proposedStateId: 'state:v0:1', rebasedOnto: 'state:v0:2' },
      next: [{ verb: 'resolve', params: {}, requires: ['resolvedRef'], principal: 'human' as const }],
    };
    expect(JSON.stringify(refuse(input))).toBe(JSON.stringify(refuse(input)));
  });

  // ── the F4 field ─────────────────────────────────────────────────────────
  it('carries `next` verbatim — the load-bearing recovery ladder', () => {
    const r = refuse({
      code: 'GATE_REFUSED',
      next: [
        { verb: 'knot.show', params: { selector: 'knotPayload:v1:ff' }, requires: [], principal: 'agent' },
        { verb: 'resolve', params: {}, requires: ['resolvedRef', 'reason', 'decidedBy'], principal: 'human' },
      ],
    });
    expect(r.next).toHaveLength(2);
    expect(r.next[0].verb).toBe('knot.show');
    // principal:'human' is how an agent learns to ESCALATE instead of attempt.
    expect(r.next[1].principal).toBe('human');
    expect(r.next[1].requires).toEqual(['resolvedRef', 'reason', 'decidedBy']);
  });

  it('emits no free prose — every string is an id, an enum, or a pointer', () => {
    // The binding rule: no human sentences in a verdict, ever. A sentence is
    // detectable as a run of words containing a space AND ending in punctuation;
    // ids/enums/kebab-symbols never look like that.
    const r = refuse({
      code: 'GATE_REFUSED',
      verdict: 'KNOT',
      contested: [contested('a', 'direct')],
      pointers: { proposedStateId: 'state:v0:1', symbols: ['#payment-form'] },
      next: [{ verb: 'resolve', params: {}, requires: ['resolvedRef'], principal: 'human' }],
    });
    const strings: string[] = [];
    JSON.stringify(r, (_k, v) => (typeof v === 'string' ? (strings.push(v), v) : v));
    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) expect(s, `prose leaked: ${JSON.stringify(s)}`).not.toMatch(/\s\w+\s.*[.!?]$/);
  });
});

// ===========================================================================
// 3. contestedOf — the ONE projection from #predict shapes onto the index.
// ===========================================================================
describe('contestedOf — knots + dangles onto the contested index', () => {
  const knot = (over: Partial<Knot> = {}): Knot => ({
    stableKey: 'k1',
    symbol: '#alpha',
    conflictingSlots: ['body'],
    direct: true,
    rule: 'conflicting-slot',
    ...over,
  });
  const dangle = (over: Partial<Dangle> = {}): Dangle => ({
    fromKey: 'd1',
    fromSymbol: '#beta',
    edgeKind: 'calls',
    danglingTargetSymbol: '#gone',
    retiredBy: 'A',
    direct: true,
    rule: 'dangle-retire',
    ...over,
  });

  it('projects a knot with its rule, slots and rank', () => {
    expect(contestedOf([knot()], [])).toEqual([
      { stableKey: 'k1', symbol: '#alpha', rule: 'conflicting-slot', conflictingSlots: ['body'], rank: 'direct' },
    ]);
  });

  it('projects a dangle from fromKey/fromSymbol with NO conflicting slots', () => {
    // A dangle is a broken REFERENCE, not a slot disagreement.
    expect(contestedOf([], [dangle()])).toEqual([
      { stableKey: 'd1', symbol: '#beta', rule: 'dangle-retire', conflictingSlots: [], rank: 'direct' },
    ]);
  });

  it('ranks ripple-only units as ripple', () => {
    expect(contestedOf([knot({ direct: false })], [])[0].rank).toBe('ripple');
  });

  it('treats an ABSENT direct flag as direct — unknown is surfaced, not collapsed', () => {
    expect(contestedOf([knot({ direct: undefined })], [])[0].rank).toBe('direct');
  });

  it('reports an unlabelled rule as null rather than guessing one', () => {
    // Hand-built Prediction fixtures and pre-`rule` persisted shapes have no
    // rule; an explicit unknown beats a fabricated label.
    expect(contestedOf([knot({ rule: undefined })], [])[0].rule).toBeNull();
    expect(contestedOf([], [dangle({ rule: undefined })])[0].rule).toBeNull();
  });

  it('does not alias the source conflictingSlots array', () => {
    const slots = ['body'];
    const out = contestedOf([knot({ conflictingSlots: slots })], []);
    slots.push('gates');
    expect(out[0].conflictingSlots).toEqual(['body']);
  });
});
