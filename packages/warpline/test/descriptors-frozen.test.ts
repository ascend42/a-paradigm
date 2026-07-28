/**
 * descriptors-frozen.test — the FG-3 freeze tripwire (mcp-skin-spec §7).
 *
 * The TEACHING SURFACE is the content-addressed artifact (Loid 3): T-005 pins
 * `descriptorsId` in its pre-registration before the first SCORED F4 batch, and
 * ANY change — wording included — resets the ≥10-run denominator. This snapshot
 * makes a change IMPOSSIBLE TO MISS: editing the surface fails this test until
 * the pinned id here is updated, which is the reviewer's cue to apply the
 * denominator-reset rule (and, once FG-3 is ratified and a scored batch is
 * running, to STOP — you don't move the instrument mid-measurement).
 *
 * SCOPE WIDENED by the FG-3 review (2026-07-28): the id covered the verb table
 * ALONE, which left the load-bearing carrier outside the freeze — PW-6 moved
 * the F4 teaching from descriptions INTO the status result because hosts
 * truncate descriptions, so pinning only descriptions pinned the wrong
 * artifact. The next-verb rule and the tool-name law are now hashed too.
 *
 * Updating the literal below is the deliberate act; there is no other way
 * through.
 */

import { describe, it, expect } from 'vitest';
import {
  descriptorsId,
  VERB_DESCRIPTORS,
  agentSurfaceVerbs,
  UNTRUSTED_CONTENT_SENTENCE,
  NEXT_LEGAL_VERBS,
  nextLegalVerbsFor,
  toolNameOf,
} from '../src/daemon/descriptors.js';
import { DAEMON_VERBS } from '../src/daemon/protocol.js';
import { HUMAN_ONLY_VERBS } from '../src/daemon/protocol.js';

const PINNED_DESCRIPTORS_ID = 'descriptors:v1:445e4eb767771108a039f21606fa51bfe96d1ddc2b70246f311423184bc77964';

describe('descriptors — frozen, total, surface-correct', () => {
  it('the descriptor table matches the pinned content address (FG-3 tripwire)', () => {
    expect(descriptorsId()).toBe(PINNED_DESCRIPTORS_ID);
  });

  it('is TOTAL over DAEMON_VERBS — every verb has a descriptor naming itself', () => {
    for (const verb of DAEMON_VERBS) {
      expect(VERB_DESCRIPTORS[verb], `descriptor for ${verb}`).toBeDefined();
      expect(VERB_DESCRIPTORS[verb].verb).toBe(verb);
      expect(VERB_DESCRIPTORS[verb].summary.length).toBeGreaterThan(0);
    }
  });

  it('the agent surface omits exactly the HUMAN_ONLY_VERBS (Aegis R2: omission, not expose-then-refuse)', () => {
    const agent = new Set<string>(agentSurfaceVerbs());
    for (const verb of HUMAN_ONLY_VERBS) {
      expect(agent.has(verb), `${verb} must NOT be on the agent surface`).toBe(false);
    }
    expect(agent.size + HUMAN_ONLY_VERBS.length).toBe(DAEMON_VERBS.length);
  });

  it('the untrusted-content sentence rides the prose-carrying tools (admit, knot.show, shadow.tail)', () => {
    for (const verb of ['admit', 'knot.show', 'shadow.tail'] as const) {
      expect(VERB_DESCRIPTORS[verb].summary).toContain(UNTRUSTED_CONTENT_SENTENCE);
    }
  });

  it('summaries hold the 1-2 sentence budget (descriptions may be truncated away — the carrier is status + refusals)', () => {
    for (const verb of DAEMON_VERBS) {
      // Proxy for the budget: no summary runs past ~400 chars (a tutorial
      // would); the real teaching lives in the status RESULT (PW-6).
      expect(VERB_DESCRIPTORS[verb].summary.length, `summary budget for ${verb}`).toBeLessThanOrEqual(400);
    }
  });

  /* ── the next-verb rule is part of the frozen surface (FG-3 finding 1) ───── */

  it('the id MOVES when the next-verb rule changes — the carrier is inside the freeze', () => {
    const before = descriptorsId();
    const original = NEXT_LEGAL_VERBS[0]!.because;
    // mutate through the frozen array's element (Object.freeze is shallow) to
    // prove the hash covers the rule text, then restore.
    (NEXT_LEGAL_VERBS[0] as { because: string }).because = original + ' (probe)';
    try {
      expect(descriptorsId()).not.toBe(before);
    } finally {
      (NEXT_LEGAL_VERBS[0] as { because: string }).because = original;
    }
    expect(descriptorsId()).toBe(before);
  });

  it('the id MOVES when the tool-name law changes — the mangling is inside the freeze', () => {
    // toolNameOf is the law a cold agent uses to translate dotted verbs; the
    // DERIVED map is hashed, so a law change cannot slip past the tripwire.
    expect(descriptorsId()).toContain(':');
    expect(toolNameOf('knot.show')).toBe('warpline_knot_show');
  });

  it('the next-verb rule is TOTAL and puts the KNOT door first (FG-3 finding 2)', () => {
    // Total: the table ends unconditional, so every position resolves.
    for (const scratchPresent of [true, false]) {
      for (const proposalSealed of [true, false]) {
        for (const behindSelvage of [true, false]) {
          for (const knotOpen of [true, false]) {
            const out = nextLegalVerbsFor({ scratchPresent, proposalSealed, behindSelvage, knotOpen });
            expect(out.verbs.length, 'every position resolves to a verb').toBeGreaterThan(0);
            expect(out.because.length).toBeGreaterThan(0);
            // An open KNOT ALWAYS routes to the work order, never back to admit:
            // re-admitting unchanged is the W1 the classifier scores wasted.
            if (knotOpen) {
              expect(out.verbs).toEqual(['knot.show']);
              expect(out.verbs).not.toContain('admit');
            }
          }
        }
      }
    }
  });

  it('never routes an agent to a HUMAN_ONLY verb', () => {
    const human = new Set<string>(HUMAN_ONLY_VERBS);
    for (const rule of NEXT_LEGAL_VERBS) {
      for (const v of rule.verbs) expect(human.has(v), `${v} is human-class`).toBe(false);
    }
  });
});
