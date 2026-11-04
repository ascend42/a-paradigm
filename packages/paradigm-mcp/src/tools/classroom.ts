/**
 * The Classroom MCP Tools (TD-2026-06-19-007) — the curriculum-artifact surface
 * the wave-2c skills (/paradigm:class, /paradigm:study-hall) drive.
 *
 * Tools:
 *   paradigm_syllabus_record  — write/re-ratify a per-agent .syllabus (gated sign-off)
 *   paradigm_syllabus_list    — list syllabi + status/health rollup (gate-zero read)
 *   paradigm_syllabus_get     — fetch one syllabus + a fresh validate pass
 *   paradigm_scenario_list    — list/filter the scenario bank by agent
 *   paradigm_scenario_record  — author a scenario (origin: authored | poison-pill)
 *   paradigm_scenario_run     — record one scenario run; a human-confirmed cross-lens
 *                               run of a pending notebook cert writes exercise evidence
 *   paradigm_classroom_status — read-only per-agent: field-failures + certs + repeat-rate
 *   paradigm_classroom_promote — gated single-entry promotion (certifiedBy: peer|quorum)
 *
 * Handlers are THIN: they delegate to syllabus-loader / scenario-loader / the
 * wave-1 field-failures ledger. paradigm_classroom_status is the same rollup the
 * doctor metric (separate wave) will reuse.
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  recordSyllabus,
  loadSyllabi,
  loadLatestSyllabus,
  validateSyllabus,
  type SyllabusSource,
  type SyllabusSuccessCriterion,
} from '../utils/syllabus-loader.js';
import {
  recordScenario,
  isSafeScenarioId,
  loadScenarios,
  loadScenariosForAgent,
  type ScenarioProbe,
} from '../utils/scenario-loader.js';
import { readHomedExerciseEvents, readFieldFailures } from '../utils/field-failures.js';
import { recordProbeRun, readReprobeMode } from '../utils/probe-runs.js';
import { gatedPromoteJournalEntry } from '../utils/nomination-engine.js';
// The repeat-failure-rate rollup is the ONE canonical formula in premise-core
// (TD-2026-06-19-007) — shared with `paradigm doctor` so the metric never
// drifts between the MCP tool and the CLI. The cert WRITER stays in
// field-failures.ts; only the read + rollup is shared.
// Scoped learning: certifications are read through field-failures (the union of
// every home), so a transferable:true promotion's user-home cert is counted.
import { computeRepeatFailureRate, NO_EXERCISE_WRITER_NOTICE } from '@a-company/premise-core';
import { readClassroomCertifications, certEvidenceState } from '../utils/field-failures.js';
import { SURVIVAL_WINDOW_DAYS } from '../utils/decay.js';

/** Status lists at most this many pending certs (pendingCertsTotal has the count). */
export const PENDING_CERTS_MAX = 50;

export function getClassroomToolsList() {
  return [
    {
      name: 'paradigm_syllabus_record',
      description:
        'Record (or re-ratify) a per-agent curriculum .syllabus — written at gated class sign-off. Pins the sources the learner was certified against, the scope, the breaking success criteria, and a term TTL. Bumps version if one exists. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'Agent id this syllabus certifies (e.g., "builder")' },
          sources: {
            type: 'array',
            description: 'Pinned sources the learner was certified against',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['notebook', 'scenario', 'external'] },
                ref: { type: 'string', description: 'notebook entry id / scenario id / external handle' },
                trust: { type: 'string', enum: ['certified', 'provisional', 'external'] },
              },
              required: ['kind', 'ref'],
            },
          },
          scope: {
            type: 'string',
            enum: ['generalizable', 'project-specific', 'platform-specific'],
          },
          success_criteria: {
            type: 'array',
            description: 'Breaking probes the learner must clear',
            items: {
              type: 'object',
              properties: {
                probe: { type: 'string', description: 'Scenario id or probe description' },
                must: { type: 'string', enum: ['survive', 'reject'] },
              },
              required: ['probe', 'must'],
            },
          },
          notebook_target: { type: 'string', enum: ['global', 'local'] },
          approved_by: { type: 'string', description: 'Who ratified (gate / peer id / human)' },
          term_ttl_days: { type: 'number', description: 'Days the certification is valid' },
          recorded_from: { type: 'string', description: 'Lore entry id this was ratified from' },
        },
        required: ['agent', 'scope', 'notebook_target', 'term_ttl_days'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_syllabus_list',
      description:
        'List all per-agent syllabi with their validated status (current/stale/broken/expired) + a health rollup. This is the gate-zero read: a stale/broken/expired syllabus refuses the autonomous study-hall. ~200 tokens.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_syllabus_get',
      description:
        'Get one agent\'s latest syllabus plus a fresh validate pass (status + issues). ~250 tokens.',
      inputSchema: {
        type: 'object',
        properties: { agent: { type: 'string', description: 'Agent id' } },
        required: ['agent'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_scenario_list',
      description:
        'List the scenario bank (breaking test-cases). Optionally filter by agent (scenarios whose probes target that agent). ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: { agent: { type: 'string', description: 'Filter to scenarios probing this agent' } },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_scenario_record',
      description:
        'Author a scenario in the bank (origin: authored or poison-pill). Field-failure scenarios are generated automatically by the reducer — author here for assessor-written probes and planted poison-pills. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Stable scenario id (e.g., "SC-auth-token-leak")' },
          scenario: { type: 'string', description: 'The breaking test-case prose' },
          probes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                agent: { type: 'string' },
                learning_ref: { type: 'string', description: 'Notebook entry id this probe targets' },
                claim: { type: 'string', description: 'The claim the learning asserts' },
              },
              required: ['agent', 'learning_ref', 'claim'],
            },
          },
          origin: { type: 'string', enum: ['poison-pill', 'authored'] },
          origin_ref: { type: 'string', description: 'Provenance id (poison-pill id / lore id)' },
          expected: {
            type: 'object',
            properties: { must: { type: 'string', enum: ['survive', 'reject'] } },
            required: ['must'],
          },
          authored_by: { type: 'string', description: 'Who wrote the scenario (required). A scenario the learner wrote never counts as a probe of it.' },
        },
        required: ['id', 'scenario', 'probes', 'origin', 'expected', 'authored_by'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_scenario_run',
      description:
        'Record one scenario run against one learning. The outcome always lands on the scenario. It counts as classroom evidence only when the human confirmed the result, the entry is a NOTEBOOK id with a pending cert, and neither the assessor nor the scenario author is the learner. held = an adversarial-probe exercise (two distinct scenarios clear the survival floor); broke = a probe-break field failure that revises the entry down and overturns the cert. Run only inside a class term the human started: a confirmed run with no term (or term ad-hoc) is recorded but counts nothing. ~120 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          scenarioId: { type: 'string', description: 'The scenario that was run' },
          entryId: { type: 'string', description: 'The learning it targeted: a notebook entry id (binds a pending cert) or a journal id (stand; binds nothing)' },
          assessor: { type: 'string', description: 'Who ran the probe (must not be the learner)' },
          result: { type: 'string', enum: ['held', 'broke'] },
          human_confirmed: { type: 'boolean', description: 'True only after the human confirmed the result; drills pass false' },
          term: { type: 'string', description: 'Class term id (needed for a confirmed run to count)' },
          reason: { type: 'string', description: 'Short note: why it held or how it broke' },
        },
        required: ['scenarioId', 'entryId', 'assessor', 'result', 'human_confirmed'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_classroom_status',
      description:
        'Read-only Classroom summary per agent: field-failures (confounded ones counted apart), certifications (pending/unproven/survived/overturned), and repeat-failure-rate. `survived` counts only exercise-evidenced survivals; aged-but-unexercised certs and legacy aged-only survivals read `unproven` and are not in the rate. When no exercise event and no probe break exists it says so plainly (`survival`: no exercise events recorded yet, no cert can survive). Also returns probeBreakRate (all-time: probe breaks / counted scenario_run probes, null when none), reprobe (classroom.reprobe: ask | off) and pendingCerts (first 50, with pendingCertsTotal) for the class re-probe step. ~300 tokens.',
      inputSchema: {
        type: 'object',
        properties: { agent: { type: 'string', description: 'Filter to one agent (omit for all)' } },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_classroom_promote',
      description:
        'Gated promotion of a SINGLE journal entry to the notebook (TD-2026-06-25-044, the "two-loops" resolution). This is the gated `/class` sign-off path: a human ruling IS the gate, so there is NO confidence-0.8 threshold. Writes a `pending` certification stamped certifiedBy: peer|quorum (NOT the legacy `gate`). Checks the journal entry\'s optional `evidence` against the ledgers and returns `evidenceStrength` plus a `warnings` list when it is none or confounded-only (advisory: never refuses). ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', description: 'Agent id whose journal entry is promoted' },
          journalId: { type: 'string', description: 'The journal entry id to promote' },
          certifiedBy: {
            type: 'string',
            enum: ['peer', 'quorum'],
            description: 'Certification authority for the gated sign-off (default: peer)',
          },
          refinedForm: {
            type: 'string',
            description: 'Optional refined snippet to store instead of the raw correct_approach/insight',
          },
          home: {
            type: 'string',
            enum: ['repo', 'user'],
            description: "Scoped learning S3: the home the human picked at sign-off (repo = committed and shared, user = just them). Given = home_source explicit. Omit to keep the journal's home.",
          },
          homeConfirmed: {
            type: 'boolean',
            description: "The human saw the candidate's home at sign-off and kept it: records home_source explicit.",
          },
        },
        required: ['agent', 'journalId'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
  ];
}

export async function handleClassroomTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_syllabus_record': {
      const id = await recordSyllabus(ctx.rootDir, {
        agent: args.agent as string,
        sources: (args.sources as SyllabusSource[]) || [],
        scope: args.scope as 'generalizable' | 'project-specific' | 'platform-specific',
        success_criteria: (args.success_criteria as SyllabusSuccessCriterion[]) || [],
        notebook_target: args.notebook_target as 'global' | 'local',
        approved_by: args.approved_by as string | undefined,
        term_ttl_days: args.term_ttl_days as number,
        recorded_from: args.recorded_from as string | undefined,
      });
      const saved = await loadLatestSyllabus(ctx.rootDir, args.agent as string);
      return {
        handled: true,
        text: JSON.stringify({
          success: true,
          id,
          version: saved?.version,
          message: 'Syllabus ratified',
        }),
      };
    }

    case 'paradigm_syllabus_list': {
      const syllabi = await loadSyllabi(ctx.rootDir);
      const rows = syllabi.map(s => {
        const v = validateSyllabus(ctx.rootDir, s);
        return {
          id: s.id,
          agent: s.agent,
          version: s.version,
          status: v.status,
          last_ratified: s.last_ratified,
          term_ttl_days: s.term_ttl_days,
          issues: v.issues,
        };
      });
      const health = {
        total: rows.length,
        current: rows.filter(r => r.status === 'current').length,
        stale: rows.filter(r => r.status === 'stale').length,
        broken: rows.filter(r => r.status === 'broken').length,
        expired: rows.filter(r => r.status === 'expired').length,
      };
      return { handled: true, text: JSON.stringify({ syllabi: rows, health }, null, 2) };
    }

    case 'paradigm_syllabus_get': {
      const agent = args.agent as string;
      const syllabus = await loadLatestSyllabus(ctx.rootDir, agent);
      if (!syllabus) {
        return { handled: true, text: JSON.stringify({ error: `No syllabus for agent: ${agent}` }) };
      }
      const validation = validateSyllabus(ctx.rootDir, syllabus);
      return {
        handled: true,
        text: JSON.stringify(
          { ...syllabus, freshness: { status: validation.status, issues: validation.issues } },
          null,
          2,
        ),
      };
    }

    case 'paradigm_scenario_list': {
      const agent = args.agent as string | undefined;
      const scenarios = agent
        ? await loadScenariosForAgent(ctx.rootDir, agent)
        : await loadScenarios(ctx.rootDir);
      return {
        handled: true,
        text: JSON.stringify({
          count: scenarios.length,
          scenarios: scenarios.map(s => ({
            id: s.id,
            origin: s.origin,
            origin_ref: s.origin_ref,
            status: s.status,
            repeat_failures: s.repeat_failures,
            expected: s.expected,
            agents: Array.from(new Set(s.probes.map(p => p.agent))),
            scenario: s.scenario,
          })),
        }, null, 2),
      };
    }

    case 'paradigm_scenario_record': {
      if (!isSafeScenarioId(args.id)) {
        return { handled: true, text: JSON.stringify({ error: 'scenario id must match [A-Za-z0-9._-]+ and contain no ".."', field: 'id' }) };
      }
      // Loid F2: every new scenario names its author, so a self-authored probe can be refused.
      if (typeof args.authored_by !== 'string' || !args.authored_by.trim()) {
        return { handled: true, text: JSON.stringify({ error: 'scenario_record needs authored_by (who wrote the scenario)', field: 'authored_by' }) };
      }
      const id = await recordScenario(ctx.rootDir, {
        id: args.id as string,
        scenario: args.scenario as string,
        probes: (args.probes as ScenarioProbe[]) || [],
        origin: args.origin as 'poison-pill' | 'authored',
        origin_ref: args.origin_ref as string | undefined,
        expected: args.expected as { must: 'survive' | 'reject' },
        authored_by: args.authored_by.trim(),
      });
      return {
        handled: true,
        text: JSON.stringify({ success: true, id, message: 'Scenario recorded' }),
      };
    }

    case 'paradigm_scenario_run': {
      const missing = ['scenarioId', 'entryId', 'assessor'].filter(k => typeof args[k] !== 'string' || !(args[k] as string).trim());
      if (missing.length > 0) {
        return { handled: true, text: JSON.stringify({ error: `scenario_run needs ${missing.join(', ')}`, missing }) };
      }
      if (args.result !== 'held' && args.result !== 'broke') {
        return { handled: true, text: JSON.stringify({ error: 'result must be held or broke', field: 'result', got: args.result ?? null }) };
      }
      if (typeof args.human_confirmed !== 'boolean') {
        return { handled: true, text: JSON.stringify({ error: 'human_confirmed must be true or false (false for a drill)', field: 'human_confirmed' }) };
      }
      if (!isSafeScenarioId(args.scenarioId)) {
        return { handled: true, text: JSON.stringify({ error: 'scenarioId must match [A-Za-z0-9._-]+ and contain no ".."', field: 'scenarioId' }) };
      }
      // Any caller-supplied timestamp is ignored: every row is server-stamped.
      const result = await recordProbeRun(ctx.rootDir, {
        scenarioId: args.scenarioId as string,
        entryId: args.entryId as string,
        assessor: args.assessor as string,
        result: args.result,
        humanConfirmed: args.human_confirmed,
        term: typeof args.term === 'string' ? args.term : undefined,
        reason: typeof args.reason === 'string' ? args.reason : undefined,
      });
      return { handled: true, text: JSON.stringify(result, null, 2) };
    }

    case 'paradigm_classroom_status': {
      const filterAgent = args.agent as string | undefined;
      const failures = readFieldFailures(ctx.rootDir);
      const certs = readClassroomCertifications(ctx.rootDir);
      // Ruling 6: an empty exercises ledger means no cert CAN survive, so a null
      // rate is not "nothing happened yet". Say so plainly instead of a silent null.
      // Judge 9 / Loid F6: the homed reader (physical home), the one survival uses.
      const exercises = readHomedExerciseEvents(ctx.rootDir);
      const probeBreaks = failures.filter(f => f.signal === 'probe-break');
      // Flag a: a probe that broke is exercise-writer activity too.
      const noExerciseWriter = exercises.length === 0 && probeBreaks.length === 0;
      // T-2026-11-04-002: probe-break rate (ALL-TIME) = breaks / counted probes
      // (held adversarial-probe receipts + probe-break rows), null when none ran.
      // Confounded rows never count.
      const probeBreakRateFor = (agent?: string): number | null => {
        const held = new Set<string>();
        for (const ev of exercises) {
          if (ev.attribution === 'confounded') continue;
          if (ev.kind !== 'adversarial-probe' || (agent && ev.agent !== agent)) continue;
          held.add(`${ev.certEntryId}::${ev.orchestrationId}`);
        }
        const breaks = new Set<string>();
        for (const f of probeBreaks) {
          if (f.attribution === 'confounded' || (agent && f.agent !== agent)) continue;
          for (const id of f.attributedEntryIds ?? []) breaks.add(`${id}::${f.orchestrationId}`);
        }
        for (const b of breaks) held.delete(b);
        const total = held.size + breaks.size;
        return total === 0 ? null : breaks.size / total;
      };

      // The repeat-failure-rate is computed by premise-core's canonical rollup
      // (shared with `paradigm doctor`). We map its per-agent { resolved,
      // overturned, rate } onto this tool's stable output shape (which also
      // reports pending/survived counts + field-failures).
      // requireExercise: a `survived` row without exercise evidence (minted by the
      // pre-gate aging timer) is `unproven`, not resolved (TD-2026-07-01-401).
      const rollup = computeRepeatFailureRate(
        certs.map((c): Parameters<typeof computeRepeatFailureRate>[0][number] => ({ ...c })),
        { requireExercise: true },
      );
      // Read-time evidence state: `unproven` is derived, never stored.
      const stateCtx = { now: Date.now(), survivalWindowDays: SURVIVAL_WINDOW_DAYS };
      const stateOf = (c: (typeof certs)[number]) => certEvidenceState(c, stateCtx);

      const pendingAll = certs
        .filter(c => c.outcome === 'pending' && c.kind !== 'skill')
        .filter(c => !filterAgent || c.agent === filterAgent);

      // Per-agent rollup.
      const agents = new Set<string>();
      for (const f of failures) agents.add(f.agent);
      for (const c of certs) agents.add(c.agent);

      const perAgent: Record<string, unknown> = {};
      for (const agent of agents) {
        if (filterAgent && agent !== filterAgent) continue;
        const agentFailures = failures.filter(f => f.agent === agent);
        const agentCerts = certs.filter(c => c.agent === agent);
        const states = agentCerts.map(stateOf);
        const overturned = states.filter(st => st === 'overturned').length;
        const survived = states.filter(st => st === 'survived').length;
        const pending = states.filter(st => st === 'pending').length;
        const unproven = states.filter(st => st === 'unproven').length;
        // Legacy aged-only survivals: still written `survived`, read `unproven`.
        const legacyAgedSurvived = agentCerts.filter(c => c.outcome === 'survived' && stateOf(c) === 'unproven').length;
        // Canonical rate from premise-core (null until ≥1 EXERCISED cert resolves).
        const repeatFailureRate = rollup.perAgent[agent]?.rate ?? null;
        perAgent[agent] = {
          fieldFailures: agentFailures.length,
          confoundedFailures: agentFailures.filter(f => f.attribution === 'confounded').length,
          certifications: { total: agentCerts.length, pending, unproven, survived, overturned, legacyAgedSurvived },
          repeatFailureRate,
          probeBreakRate: probeBreakRateFor(agent),
          ...(repeatFailureRate === null && noExerciseWriter ? { repeatFailureRateNote: NO_EXERCISE_WRITER_NOTICE } : {}),
        };
      }

      return {
        handled: true,
        text: JSON.stringify({
          ...(noExerciseWriter ? { survival: NO_EXERCISE_WRITER_NOTICE } : {}),
          totals: {
            fieldFailures: failures.length,
            certifications: certs.length,
            overturned: certs.filter(c => c.outcome === 'overturned').length,
            unproven: certs.filter(c => stateOf(c) === 'unproven').length,
            probeBreakRate: probeBreakRateFor(),
            probeBreakRateWindow: 'all-time',
          },
          // The class skill's re-probe step: `off` skips it; `ask` lists these
          // and asks the human (count + rough cost) before running any scenario.
          reprobe: readReprobeMode(ctx.rootDir),
          pendingCerts: pendingAll.slice(0, PENDING_CERTS_MAX)
            .map(c => ({ agent: c.agent, entryId: c.entryId, home: c.home, ts: c.ts })),
          pendingCertsTotal: pendingAll.length,
          perAgent,
        }, null, 2),
      };
    }

    case 'paradigm_classroom_promote': {
      const result = gatedPromoteJournalEntry(
        ctx.rootDir,
        args.agent as string,
        args.journalId as string,
        {
          certifiedBy: args.certifiedBy as 'peer' | 'quorum' | undefined,
          refinedForm: args.refinedForm as string | undefined,
          home: args.home === 'repo' || args.home === 'user' ? args.home : undefined,
          homeConfirmed: args.homeConfirmed === true,
        },
      );
      return { handled: true, text: JSON.stringify(result, null, 2) };
    }

    default:
      return { handled: false, text: '' };
  }
}
