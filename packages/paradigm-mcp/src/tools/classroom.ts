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
  loadScenarios,
  loadScenariosForAgent,
  type ScenarioProbe,
} from '../utils/scenario-loader.js';
import { readFieldFailures } from '../utils/field-failures.js';
import { gatedPromoteJournalEntry } from '../utils/nomination-engine.js';
// The repeat-failure-rate rollup is the ONE canonical formula in premise-core
// (TD-2026-06-19-007) — shared with `paradigm doctor` so the metric never
// drifts between the MCP tool and the CLI. The cert WRITER stays in
// field-failures.ts; only the read + rollup is shared.
import {
  readClassroomCertifications,
  computeRepeatFailureRate,
} from '@a-company/premise-core';

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
        },
        required: ['id', 'scenario', 'probes', 'origin', 'expected'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: 'paradigm_classroom_status',
      description:
        'Read-only Classroom summary per agent: field-failures, certifications (pending/survived/overturned), and repeat-failure-rate. This is the rollup the doctor metric reuses. ~250 tokens.',
      inputSchema: {
        type: 'object',
        properties: { agent: { type: 'string', description: 'Filter to one agent (omit for all)' } },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_classroom_promote',
      description:
        'Gated promotion of a SINGLE journal entry to the notebook (TD-2026-06-25-044, the "two-loops" resolution). This is the gated `/class` sign-off path: a human ruling IS the gate, so there is NO confidence-0.8 threshold. Writes a `pending` certification stamped certifiedBy: peer|quorum (NOT the legacy `gate`). ~100 tokens.',
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
      const id = await recordScenario(ctx.rootDir, {
        id: args.id as string,
        scenario: args.scenario as string,
        probes: (args.probes as ScenarioProbe[]) || [],
        origin: args.origin as 'poison-pill' | 'authored',
        origin_ref: args.origin_ref as string | undefined,
        expected: args.expected as { must: 'survive' | 'reject' },
      });
      return {
        handled: true,
        text: JSON.stringify({ success: true, id, message: 'Scenario recorded' }),
      };
    }

    case 'paradigm_classroom_status': {
      const filterAgent = args.agent as string | undefined;
      const failures = readFieldFailures(ctx.rootDir);
      const certs = readClassroomCertifications(ctx.rootDir);

      // The repeat-failure-rate is computed by premise-core's canonical rollup
      // (shared with `paradigm doctor`). We map its per-agent { resolved,
      // overturned, rate } onto this tool's stable output shape (which also
      // reports pending/survived counts + field-failures).
      const rollup = computeRepeatFailureRate(certs);

      // Per-agent rollup.
      const agents = new Set<string>();
      for (const f of failures) agents.add(f.agent);
      for (const c of certs) agents.add(c.agent);

      const perAgent: Record<string, unknown> = {};
      for (const agent of agents) {
        if (filterAgent && agent !== filterAgent) continue;
        const agentFailures = failures.filter(f => f.agent === agent);
        const agentCerts = certs.filter(c => c.agent === agent);
        const overturned = agentCerts.filter(c => c.outcome === 'overturned').length;
        const survived = agentCerts.filter(c => c.outcome === 'survived').length;
        const pending = agentCerts.filter(c => c.outcome === 'pending').length;
        // Canonical rate from premise-core (null until ≥1 cert resolves).
        const repeatFailureRate = rollup.perAgent[agent]?.rate ?? null;
        perAgent[agent] = {
          fieldFailures: agentFailures.length,
          certifications: { total: agentCerts.length, pending, survived, overturned },
          repeatFailureRate,
        };
      }

      return {
        handled: true,
        text: JSON.stringify({
          totals: {
            fieldFailures: failures.length,
            certifications: certs.length,
            overturned: certs.filter(c => c.outcome === 'overturned').length,
          },
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
        },
      );
      return { handled: true, text: JSON.stringify(result, null, 2) };
    }

    default:
      return { handled: false, text: '' };
  }
}
