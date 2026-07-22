/**
 * refusal-vocabulary-totality.test — PW-4 (mcp-skin-spec §4).
 *
 * The invariant: every `RefusalNextStep` any engine/daemon site can emit must
 * be FOLLOWABLE on the surfaces that carry it — the verb exists (post
 * MCP-name-mangling) or is a pinned human/CLI-only escalation, and the step's
 * `params ∪ requires` covers the target verb's REQUIRED params. Jinx found
 * three ladders whose steps BAD_REQUESTed when copied verbatim (resolve
 * advertising resolvedRef/decidedBy the daemon never accepts; propose missing
 * its required intent; dotted verb names illegal as MCP tool names) — each one
 * a guaranteed wasted turn on exactly the recovery paths F4 measures. This
 * test makes that drift fail CI, not F4 runs.
 */

import { describe, it, expect } from 'vitest';
import { meaningRefusal, claimRefusal, trustRefusal, type AdmitDecision } from '../src/fabric/admit.js';
import type { Refusal, RefusalNextStep } from '../src/fabric/refusal.js';
import { VERB_DESCRIPTORS, toolNameOf, agentSurfaceVerbs } from '../src/daemon/descriptors.js';
import { DAEMON_VERBS, type DaemonVerb } from '../src/daemon/protocol.js';

/**
 * Steps whose verb is NOT an agent-callable daemon verb by design: human-class
 * escalations and CLI-only acts. A cold agent seeing one of these must
 * ESCALATE (principal:'human'), so they are exempt from the agent-surface
 * check — but pinned here so a NEW out-of-vocabulary verb fails the test until
 * it is either added to a surface or explicitly allowlisted.
 */
const HUMAN_OR_CLI_ONLY = ['resolve', 'daemon.start', 'daemon.token.mint', 'refs.migrate'] as const;

const decision = (over: Partial<AdmitDecision> = {}): AdmitDecision => ({
  status: 'KNOT',
  knots: [],
  dangling: [],
  confidence: null,
  rebasedOnto: 'state:x',
  agentChanged: [],
  otherChanged: [],
  ...over,
});

/**
 * Every next[]-emitting site, exercised through its real builder where one
 * exists. The PW-2 boundary ladders are pinned as literals MIRRORING the
 * native.ts sites (they are inline throws, not builders) — if a site's ladder
 * changes, update BOTH or the sequencing test (which asserts the real throw)
 * and this pin will disagree, failing CI either way.
 */
function emittedRefusals(): Array<{ site: string; refusal: Refusal | null; steps: RefusalNextStep[] }> {
  const fromBuilders: Array<{ site: string; refusal: Refusal }> = [
    { site: 'meaningRefusal (with payload)', refusal: meaningRefusal('KNOT', decision(), 'state:p', 'agent-x', 'knotPayload:v1:abc') },
    { site: 'meaningRefusal (payload-less downgrade)', refusal: meaningRefusal('KNOT', decision(), 'state:p', 'agent-x') },
    { site: 'claimRefusal', refusal: claimRefusal(decision(), 'state:p', 'claim:v1:abc', ['#x'], { native: 'true' }) },
    { site: 'claimRefusal (git-era params)', refusal: claimRefusal(decision(), 'state:p', 'claim:v1:abc', ['#x'], { ref: 'HEAD' }) },
    { site: 'trustRefusal', refusal: trustRefusal(decision({ status: 'CLEAN' }), 'state:p', '#sym', { native: 'true' }) },
  ];
  const pinnedBoundaryLadders: Array<{ site: string; steps: RefusalNextStep[] }> = [
    // native.ts PW-2 sites (asserted live in native-sequencing-refusals.test.ts)
    { site: 'native: legacy fabric', steps: [{ verb: 'refs.migrate', params: {}, requires: [], principal: 'human' }] },
    { site: 'native: legacy scratch at propose', steps: [{ verb: 'fork', params: {}, requires: [], principal: 'agent' }] },
    {
      site: 'native: admit without propose',
      steps: [
        { verb: 'fork', params: {}, requires: [], principal: 'agent' },
        { verb: 'propose', params: {}, requires: ['intent', 'worktree'], principal: 'agent' },
      ],
    },
    { site: 'native: resolve without scratch', steps: [{ verb: 'propose', params: {}, requires: ['intent', 'worktree'], principal: 'agent' }] },
    { site: 'native: fork clobber guard', steps: [{ verb: 'admit', params: {}, requires: [], principal: 'agent' }] },
    // server.ts boundary AUTH ladder (PW-3c)
    { site: 'daemon: AUTH', steps: [{ verb: 'daemon.token.mint', params: {}, requires: ['name', 'kind'], principal: 'human' }] },
    // the two skin-built refusals (mcp-skin-spec D3)
    { site: 'mcp: daemon-down', steps: [{ verb: 'daemon.start', params: {}, requires: [], principal: 'human' }] },
  ];
  return [
    ...fromBuilders.map((b) => ({ site: b.site, refusal: b.refusal, steps: b.refusal.next })),
    ...pinnedBoundaryLadders.map((p) => ({ site: p.site, refusal: null, steps: p.steps })),
  ];
}

function requiredParamsOf(verb: DaemonVerb): string[] {
  const schema = VERB_DESCRIPTORS[verb].paramsSchema as { required?: string[] };
  return schema.required ?? [];
}

describe('PW-4 — every emitted next[] step is followable on its surface', () => {
  const agentVerbs = new Set<string>(agentSurfaceVerbs());

  it('every step verb exists on the agent surface OR is a pinned human/CLI-only escalation', () => {
    for (const { site, steps } of emittedRefusals()) {
      for (const step of steps) {
        const allowlisted = (HUMAN_OR_CLI_ONLY as readonly string[]).includes(step.verb);
        if (allowlisted) {
          // an allowlisted verb must be marked human — an agent must escalate, not guess.
          expect(step.principal, `${site} → ${step.verb} principal`).toBe('human');
          continue;
        }
        expect(agentVerbs.has(step.verb), `${site} → ${step.verb} must be an agent-surface daemon verb`).toBe(true);
      }
    }
  });

  it("every agent-surface step's params ∪ requires covers the verb's REQUIRED params", () => {
    for (const { site, steps } of emittedRefusals()) {
      for (const step of steps) {
        if (!agentVerbs.has(step.verb)) continue;
        const supplied = new Set([...Object.keys(step.params), ...step.requires]);
        for (const req of requiredParamsOf(step.verb as DaemonVerb)) {
          expect(supplied.has(req), `${site} → ${step.verb}: required param '${req}' is neither in params nor requires`).toBe(true);
        }
      }
    }
  });

  it('the resolve ladder never advertises server-stamped identity or phantom params', () => {
    const r = meaningRefusal('KNOT', decision(), 'state:p', 'agent-x', 'knotPayload:v1:abc');
    const resolveStep = r.next.find((n) => n.verb === 'resolve')!;
    const advertised = new Set([...Object.keys(resolveStep.params), ...resolveStep.requires]);
    // decidedBy is SERVER-STAMPED identity; resolvedRef was never a daemon param.
    expect(advertised.has('decidedBy')).toBe(false);
    expect(advertised.has('resolvedRef')).toBe(false);
    // the TARGET agent is already determined — carried in params, copy-paste ready.
    expect(resolveStep.params.agentId).toBe('agent-x');
    expect(resolveStep.principal).toBe('human');
  });

  it('every MCP tool name derived from a daemon verb is legal ([a-zA-Z0-9_-]+)', () => {
    for (const verb of DAEMON_VERBS) {
      expect(toolNameOf(verb), `toolNameOf(${verb})`).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });
});
