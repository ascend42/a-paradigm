/**
 * Voice allowlist (spec §14.7 "The allowlist", D58, D61, D62, D66; TD-2026-10-19-194, T-2026-10-19-026).
 *
 * Oracle: EXPECTED below is written out by hand from the spec, independently of src/voice-allowlist.ts, and the
 * table test walks EVERY CardKind × EVERY CardDecision (+ withdraw, + an unknown decision) × EVERY voice class.
 * A new CardKind with no row in VOICE_ALLOWLIST or in EXPECTED fails the coverage test.
 */
import { describe, expect, it } from 'vitest';
import {
  CARD_DECISIONS,
  CARD_FLAGS,
  CARD_KINDS,
  VOICE_ALLOWLIST,
  VOICE_CLASSES,
  VOICE_ELIGIBILITY,
  VOICE_REFUSAL_REASONS,
  voiceAllowlistCoversCardKinds,
  voiceApprovingDecisions,
  voiceDecisionCheck,
  voiceMayDecide,
} from '../src/index.js';

type Cls = 'reversible' | 'gate' | 'judgment';

/** Per kind and class: the decisions voice may take. Everything else is refused. */
const EXPECTED: Record<string, Record<Cls, string[]>> = {
  // toggle 1 (D58): permission allow/deny, ask-user answer, plan approve-plan; plan reject via D66
  permission: { reversible: ['allow', 'deny', 'withdraw'], gate: ['allow', 'deny', 'withdraw'], judgment: ['allow', 'deny', 'withdraw'] },
  'ask-user': { reversible: ['answer', 'withdraw'], gate: ['answer', 'withdraw'], judgment: ['answer', 'withdraw'] },
  plan: { reversible: ['approve-plan', 'reject', 'withdraw'], gate: ['approve-plan', 'reject', 'withdraw'], judgment: ['approve-plan', 'reject', 'withdraw'] },
  // toggle 2 (D58): gate-class, fallback-cloud, resume; deny under toggle 1 (D66)
  'gate-class': { reversible: ['deny', 'withdraw'], gate: ['allow', 'deny', 'withdraw'], judgment: ['allow', 'deny', 'withdraw'] },
  fallback: { reversible: ['deny', 'withdraw'], gate: ['fallback-cloud', 'deny', 'withdraw'], judgment: ['fallback-cloud', 'deny', 'withdraw'] },
  budget: { reversible: ['deny', 'withdraw'], gate: ['resume', 'deny', 'withdraw'], judgment: ['resume', 'deny', 'withdraw'] },
  // judgment (D61): KNOT resolve, verdict accept|reject
  knot: { reversible: ['deny', 'withdraw'], gate: ['deny', 'withdraw'], judgment: ['resolve', 'deny', 'withdraw'] },
  verdict: { reversible: ['reject', 'withdraw'], gate: ['reject', 'withdraw'], judgment: ['accept', 'reject', 'withdraw'] },
  // hand-only for approving; D66 deny-direction only
  tend: { reversible: ['reject'], gate: ['reject'], judgment: ['reject'] },
  'merge-conflict': { reversible: ['deny'], gate: ['deny'], judgment: ['deny'] },
  install: { reversible: ['deny'], gate: ['deny'], judgment: ['deny'] },
  'api-token': { reversible: ['deny'], gate: ['deny'], judgment: ['deny'] },
  'voice-share': { reversible: ['deny'], gate: ['deny'], judgment: ['deny'] },
  'voice-arm': { reversible: ['deny'], gate: ['deny'], judgment: ['deny'] },
  grant: { reversible: ['deny'], gate: ['deny'], judgment: ['deny'] },
  handoff: { reversible: ['reject'], gate: ['reject'], judgment: ['reject'] },
  declassify: { reversible: ['reject'], gate: ['reject'], judgment: ['reject'] },
  'peer-pair': { reversible: ['reject'], gate: ['reject'], judgment: ['reject'] },
  reconsider: { reversible: ['reject'], gate: ['reject'], judgment: ['reject'] },
  strictness: { reversible: ['deny'], gate: ['deny'], judgment: ['deny'] },
  // founder ruling (TD-2026-10-19-194): fully hand-only, deny included
  incident: { reversible: [], gate: [], judgment: [] },
  'daemon-stop': { reversible: [], gate: [], judgment: [] },
};

/** Approving decisions take the hold; deny-direction and withdraw do not (§14.7 Hold, echo, undo; D66). */
const HELD: Record<string, string[]> = {
  permission: ['allow'],
  'ask-user': ['answer'],
  plan: ['approve-plan'],
  'gate-class': ['allow'],
  fallback: ['fallback-cloud'],
  budget: ['resume'],
  knot: ['resolve'],
  verdict: ['accept'],
};

/** (kind, decision) pairs that a higher class admits — refused `voice-class` below it. */
const NEEDS: Record<string, Record<string, Cls>> = {
  'gate-class': { allow: 'gate' },
  fallback: { 'fallback-cloud': 'gate' },
  budget: { resume: 'gate' },
  knot: { resolve: 'judgment' },
  verdict: { accept: 'judgment' },
};
const RANK: Record<Cls, number> = { reversible: 0, gate: 1, judgment: 2 };

const sorted = (a: readonly string[]) => [...a].sort();
const DECISIONS = [...CARD_DECISIONS, 'not-a-decision'];

describe('voice allowlist — coverage (§14.7, TD-2026-10-19-194)', () => {
  it('VOICE_ALLOWLIST and the test oracle each have exactly one row per CardKind (a new kind without a row fails)', () => {
    expect(sorted(Object.keys(VOICE_ALLOWLIST))).toEqual(sorted(CARD_KINDS));
    expect(sorted(Object.keys(EXPECTED))).toEqual(sorted(CARD_KINDS));
    expect(voiceAllowlistCoversCardKinds()).toBe(true);
  });

  it('voice classes are the cumulative grant sets (D62) and match VOICE_ELIGIBILITY minus none', () => {
    expect([...VOICE_CLASSES]).toEqual(['reversible', 'gate', 'judgment']);
    expect(VOICE_ELIGIBILITY.filter((e) => e !== 'none')).toEqual([...VOICE_CLASSES]);
  });

  it('every row names only known CardDecisions, and every refusal reason it can return is reserved', () => {
    for (const [kind, r] of Object.entries(VOICE_ALLOWLIST)) {
      for (const d of [...Object.values(r.approve).flat(), ...r.deny]) expect(CARD_DECISIONS, `${kind}:${d}`).toContain(d);
      for (const d of r.deny) expect(['deny', 'reject'], `${kind}:${d}`).toContain(d);
      expect(Object.isFrozen(r) && Object.isFrozen(r.deny) && Object.isFrozen(r.approve)).toBe(true);
    }
    expect(Object.isFrozen(VOICE_ALLOWLIST)).toBe(true);
    for (const r of ['voice-off', 'voice-class', 'voice-hand-only', 'voice-ineligible']) expect(VOICE_REFUSAL_REASONS).toContain(r);
  });
});

describe('voice allowlist — table: every CardKind × decision × class', () => {
  for (const kind of CARD_KINDS) {
    for (const cls of VOICE_CLASSES) {
      it(`${kind} under ${cls}`, () => {
        for (const decision of DECISIONS) {
          const want = EXPECTED[kind]![cls].includes(decision);
          const got = voiceDecisionCheck(cls, kind, decision, []);
          expect(got.ok, `${cls} ${kind} ${decision}`).toBe(want);
          expect(voiceMayDecide(cls, kind, decision, [])).toBe(want);
          if (got.ok) {
            expect(got.hold, `hold ${cls} ${kind} ${decision}`).toBe((HELD[kind] ?? []).includes(decision));
          } else {
            const needs = NEEDS[kind]?.[decision];
            const reason = needs !== undefined && RANK[needs] > RANK[cls] ? 'voice-class' : 'voice-hand-only';
            expect(got.reason, `reason ${cls} ${kind} ${decision}`).toBe(reason);
          }
        }
      });
    }
  }
});

describe('voice allowlist — flags, unknowns, never-list (§14.7 Never by voice)', () => {
  it('any flag (every CARD_FLAG and an unknown one) makes every decision but withdraw voice-ineligible, deny included; withdraw is never blocked by flags', () => {
    for (const flag of [...CARD_FLAGS, 'some-future-flag']) {
      for (const kind of CARD_KINDS) {
        for (const cls of VOICE_CLASSES) {
          expect(voiceDecisionCheck(cls, kind, 'withdraw', [flag])).toEqual(voiceDecisionCheck(cls, kind, 'withdraw', []));
          for (const decision of DECISIONS.filter((d) => d !== 'withdraw')) {
            expect(voiceDecisionCheck(cls, kind, decision, [flag])).toEqual({ ok: false, reason: 'voice-ineligible' });
          }
        }
      }
    }
  });

  it('an unknown class (no toggle, `none`, anything else) refuses voice-off', () => {
    for (const cls of ['none', '', 'admin', 'REVERSIBLE']) {
      expect(voiceDecisionCheck(cls, 'permission', 'deny', [])).toEqual({ ok: false, reason: 'voice-off' });
      expect(voiceApprovingDecisions(cls, 'permission')).toEqual([]);
    }
  });

  it('an unknown card kind is hand-only for every decision under every class (default deny)', () => {
    for (const cls of VOICE_CLASSES) for (const d of DECISIONS) expect(voiceDecisionCheck(cls, 'future-kind', d, [])).toEqual({ ok: false, reason: 'voice-hand-only' });
  });

  it('never by voice, with every toggle on: always, install, use-api-token, voice-arm/grant/voice-share allow, strictness allow, reconsider extend|restart, incident accept, daemon-stop accept', () => {
    const never: Array<[string, string]> = [
      ['permission', 'always'],
      ['install', 'install'],
      ['api-token', 'use-api-token'],
      ['voice-arm', 'allow'],
      ['grant', 'allow'],
      ['voice-share', 'allow'],
      ['strictness', 'allow'],
      ['reconsider', 'extend'],
      ['reconsider', 'restart'],
      ['incident', 'accept'],
      ['daemon-stop', 'accept'],
      ['peer-pair', 'accept'],
      ['merge-conflict', 'resolve'],
      ['tend', 'accept'],
    ];
    for (const [k, d] of never) expect(voiceDecisionCheck('judgment', k, d, []), `${k}:${d}`).toEqual({ ok: false, reason: 'voice-hand-only' });
  });

  it('founder ruling: incident and daemon-stop take no voice decision at all, deny/reject included', () => {
    for (const kind of ['incident', 'daemon-stop'] as const) {
      expect(VOICE_ALLOWLIST[kind].deny).toEqual([]);
      for (const cls of VOICE_CLASSES) for (const d of DECISIONS) expect(voiceMayDecide(cls, kind, d, []), `${cls} ${kind} ${d}`).toBe(false);
    }
  });

  it('D66: deny/reject on every kind is accepted under toggle 1 with no hold', () => {
    for (const kind of CARD_KINDS) {
      for (const d of VOICE_ALLOWLIST[kind].deny) expect(voiceDecisionCheck('reversible', kind, d, [])).toEqual({ ok: true, hold: false, via: 'deny' });
    }
  });

  it('classes are cumulative: approving decisions at judgment ⊇ gate ⊇ reversible for every kind', () => {
    for (const kind of CARD_KINDS) {
      const r = voiceApprovingDecisions('reversible', kind);
      const g = voiceApprovingDecisions('gate', kind);
      const j = voiceApprovingDecisions('judgment', kind);
      for (const d of r) expect(g).toContain(d);
      for (const d of g) expect(j).toContain(d);
    }
  });
});
