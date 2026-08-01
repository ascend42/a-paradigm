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
import { pickGateRefusal } from '../src/fabric/pick.js';
import type { ShadowVerdictRow } from '../src/fabric/shadow.js';
import type { AdmitStatus } from '../src/fabric/admit.js';
import type { Refusal, RefusalNextStep } from '../src/fabric/refusal.js';
import { VERB_DESCRIPTORS, toolNameOf, agentSurfaceVerbs } from '../src/daemon/descriptors.js';
import { DAEMON_VERBS, type DaemonVerb } from '../src/daemon/protocol.js';
import { agentShellRefusal } from '../src/agent-shell.js';

/**
 * Steps whose verb is NOT an agent-callable daemon verb by design: human-class
 * escalations and CLI-only acts. Exempt from the agent-surface check — but
 * pinned here (with the principals that surface actually offers) so a NEW
 * out-of-vocabulary verb fails the test until it is either added to a surface
 * or explicitly allowlisted.
 *
 * A cold agent seeing a `['human']` verb must ESCALATE, never guess. `pick` is
 * the one genuine both-ways entry: `warpline pick` is CLI-only and appears as
 * BOTH the agent's own retry after an ENGINE gate crash and the human's
 * --accept-risk override door.
 */
const OFF_DAEMON_SURFACE: Record<string, ReadonlyArray<'agent' | 'human'>> = {
  resolve: ['human'],
  'daemon.start': ['human'],
  'daemon.token.mint': ['human'],
  'refs.migrate': ['human'],
  pick: ['agent', 'human'],
};

/**
 * Names a ladder step may advertise that are NOT properties of the daemon
 * verb's paramsSchema, and why. The human override door is a CLI act, so its
 * step carries the CLI's skin-selection params and the human-only flags —
 * which are deliberately ABSENT from the MCP schema (mcp-skin-spec: they must
 * never be able to travel over the agent wire). Everything else advertised on
 * a daemon verb must exist on that verb, or it is a phantom (D-6a / D-10).
 */
const CLI_ONLY_PARAMS = ['native', 'ref', 'acceptBreach', 'acceptRisk'] as const;

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

/** A minimal ShadowVerdictRow — enough to drive the #pick gate's ladder builder. */
const verdictRow = (status: AdmitStatus): ShadowVerdictRow => ({
  schemaVersion: 'shadowVerdict:v1',
  ts: '2026-07-31T00:00:00.000Z',
  ref: 'WORKTREE',
  agentId: 'agent-x',
  status,
  confidence: null,
  knots: [],
  agentChanged: [],
  otherChanged: [],
  coverage: null,
  wouldSeal: false,
  proposedStateId: 'state:p',
  durationMs: 1,
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
    // D-10: #pick's own gate ladders were absent from this inventory entirely,
    // which is how a phantom-param `resolve` step survived here for a whole
    // era after PW-3a fixed the identical defect in admit.ts.
    { site: 'pickGateRefusal (KNOT)', refusal: pickGateRefusal(verdictRow('KNOT'), undefined) },
    { site: 'pickGateRefusal (DANGLE)', refusal: pickGateRefusal(verdictRow('DANGLE'), undefined) },
    { site: 'pickGateRefusal (HELD — no resolve step)', refusal: pickGateRefusal(verdictRow('HELD'), undefined) },
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
    // native.ts fork clobber guard — DERIVED from NEXT_LEGAL_VERBS since D-6b,
    // so both positions it can answer are pinned (asserted live in
    // native-sequencing-refusals.test.ts).
    // C-10: both positions now carry the withdrawal door SECOND. These pins are
    // literals, so they passed unchanged when `abandon` landed — the live
    // assertions in native-sequencing-refusals.test.ts are what caught the
    // drift; keeping the mirror honest is what keeps THIS file's inventory
    // (and therefore its param/phantom checks) covering the real ladders.
    {
      site: 'native: fork clobber guard (unjudged proposal)',
      steps: [
        { verb: 'admit', params: {}, requires: [], principal: 'agent' },
        { verb: 'abandon', params: {}, requires: [], principal: 'agent' },
      ],
    },
    {
      site: 'native: fork clobber guard (KNOT open)',
      steps: [
        { verb: 'knot.show', params: { selector: 'knotPayload:v1:abc' }, requires: [], principal: 'agent' },
        { verb: 'abandon', params: {}, requires: [], principal: 'agent' },
      ],
    },
    // pick.ts inline ENGINE throws (asserted live in the R2 gate tests)
    { site: 'pick: corrupt config (escalate)', steps: [] },
    { site: 'pick: gate crash', steps: [{ verb: 'pick', params: { ref: 'WORKTREE' }, requires: [], principal: 'agent' }] },
    // server.ts boundary AUTH ladder (PW-3c)
    { site: 'daemon: AUTH', steps: [{ verb: 'daemon.token.mint', params: {}, requires: ['name', 'kind'], principal: 'human' }] },
    // C-11 #agent-shell: the CLI's human-class gate. EMPTY by design and
    // inventoried so it stays empty — an empty next[] means "escalate", and
    // naming the human verb here would invite the retry that IS the violation.
    // Built by the real builder below, not pinned as a literal.
    { site: 'cli: agent-shell human-class gate', steps: [...agentShellRefusal().next] },
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

function declaredParamsOf(verb: DaemonVerb): string[] {
  const schema = VERB_DESCRIPTORS[verb].paramsSchema as { properties?: Record<string, unknown> };
  return Object.keys(schema.properties ?? {});
}

const isDaemonVerb = (verb: string): verb is DaemonVerb => (DAEMON_VERBS as readonly string[]).includes(verb);

describe('PW-4 — every emitted next[] step is followable on its surface', () => {
  const agentVerbs = new Set<string>(agentSurfaceVerbs());

  it('every step verb exists on the agent surface OR is a pinned human/CLI-only escalation', () => {
    for (const { site, steps } of emittedRefusals()) {
      for (const step of steps) {
        const allowed = OFF_DAEMON_SURFACE[step.verb];
        if (allowed) {
          // an allowlisted verb must carry a principal that surface offers —
          // an agent must escalate on a human-only door, never guess.
          expect(allowed, `${site} → ${step.verb} principal`).toContain(step.principal);
          continue;
        }
        expect(agentVerbs.has(step.verb), `${site} → ${step.verb} must be an agent-surface daemon verb`).toBe(true);
      }
    }
  });

  /**
   * D-10 widened this from "agent-surface steps" to EVERY step naming a daemon
   * verb. The old skip is precisely why `pick.ts`'s `resolve` step could omit a
   * required param for an era: `resolve` is principal:'human', so the check
   * never ran on it — even though a human following the ladder BAD_REQUESTs
   * exactly like an agent would. Off-daemon verbs (CLI acts) have no schema
   * here and are skipped by absence, not by principal.
   */
  it("every step's params ∪ requires covers its daemon verb's REQUIRED params — human steps included", () => {
    for (const { site, steps } of emittedRefusals()) {
      for (const step of steps) {
        if (!isDaemonVerb(step.verb)) continue;
        const supplied = new Set([...Object.keys(step.params), ...step.requires]);
        for (const req of requiredParamsOf(step.verb)) {
          expect(supplied.has(req), `${site} → ${step.verb}: required param '${req}' is neither in params nor requires`).toBe(true);
        }
      }
    }
  });

  /**
   * The OTHER half of the same defect class: coverage catches an OMITTED
   * required param, and this catches an INVENTED one. D-6a's ladder named
   * `claimedSymbols` — a param of no skin (it lives nested inside `claim`), and
   * the MCP skin's filterToSchema drops unknown keys SILENTLY, so following the
   * ladder verbatim produced a call that looked accepted and did the wrong
   * thing. Nothing failed. Now something does.
   */
  it('no step advertises a param its daemon verb does not declare', () => {
    for (const { site, steps } of emittedRefusals()) {
      for (const step of steps) {
        if (!isDaemonVerb(step.verb)) continue;
        const declared = new Set([
          ...declaredParamsOf(step.verb),
          // the human override door is a CLI act (see CLI_ONLY_PARAMS)
          ...(step.principal === 'human' ? CLI_ONLY_PARAMS : []),
        ]);
        for (const name of [...Object.keys(step.params), ...step.requires]) {
          expect(declared.has(name), `${site} → ${step.verb}: advertises '${name}', which is not a declared param of that verb`).toBe(true);
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

  it('D-6a — the CLAIM_BREACH ladder names `claim`, never the nested `claimedSymbols`', () => {
    const r = claimRefusal(decision({ status: 'CLAIM-BREACH' }), 'state:p', 'claim:v1:abc', ['#x'], { native: 'true' });
    const proposeStep = r.next.find((n) => n.verb === 'propose')!;
    const advertised = new Set([...Object.keys(proposeStep.params), ...proposeStep.requires]);
    // claimedSymbols is a field INSIDE `claim`; naming it at the top level is a
    // param of no skin, and filterToSchema drops it in silence.
    expect(advertised.has('claimedSymbols')).toBe(false);
    expect(advertised.has('claim')).toBe(true);
    expect(advertised.has('intent')).toBe(true);
    // and the step is the agent's own move — the ladder is not a human-only dead end
    expect(proposeStep.principal).toBe('agent');
  });

  it('D-10 — #pick\'s resolve step carries the target agent and no phantom params', () => {
    const r = pickGateRefusal(verdictRow('KNOT'), undefined);
    const resolveStep = r.next.find((n) => n.verb === 'resolve')!;
    const advertised = new Set([...Object.keys(resolveStep.params), ...resolveStep.requires]);
    expect(advertised.has('decidedBy')).toBe(false);
    expect(advertised.has('resolvedRef')).toBe(false);
    expect(resolveStep.params.agentId).toBe('agent-x');
    expect(resolveStep.principal).toBe('human');
  });

  it('every MCP tool name derived from a daemon verb is legal ([a-zA-Z0-9_-]+)', () => {
    for (const verb of DAEMON_VERBS) {
      expect(toolNameOf(verb), `toolNameOf(${verb})`).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });
});
