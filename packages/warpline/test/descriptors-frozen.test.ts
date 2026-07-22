/**
 * descriptors-frozen.test — the FG-3 freeze tripwire (mcp-skin-spec §7).
 *
 * The descriptor table is the content-addressed teaching-text artifact
 * (Loid 3): T-005 pins `descriptorsId` in its pre-registration before the
 * first SCORED F4 batch, and ANY descriptor change — wording included — resets
 * the ≥10-run denominator. This snapshot makes a change IMPOSSIBLE TO MISS:
 * editing descriptors.ts fails this test until the pinned id here is updated,
 * which is the reviewer's cue to apply the denominator-reset rule (and, once
 * FG-3 is ratified and a scored batch is running, to STOP — you don't move
 * the instrument while the measurement is running).
 *
 * Updating the literal below is the deliberate act; there is no other way
 * through.
 */

import { describe, it, expect } from 'vitest';
import { descriptorsId, VERB_DESCRIPTORS, agentSurfaceVerbs, UNTRUSTED_CONTENT_SENTENCE } from '../src/daemon/descriptors.js';
import { DAEMON_VERBS } from '../src/daemon/protocol.js';
import { HUMAN_ONLY_VERBS } from '../src/daemon/protocol.js';

const PINNED_DESCRIPTORS_ID = 'descriptors:v1:a2ca0ab96554e90881b7bcb398559282e183fb5143aeae49df4dc948cd829bcc';

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
});
