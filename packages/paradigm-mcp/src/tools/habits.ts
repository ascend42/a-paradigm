/**
 * MCP Habits Tools
 *
 * Four tools for the habits behavioral feedback loop:
 * - paradigm_habits_list: List all habit definitions (seed + global + project)
 * - paradigm_habits_check: Evaluate habits + record practice events
 * - paradigm_habits_status: Practice profile with compliance rates
 * - paradigm_practice_context: Proactive warnings before modifying symbols
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { ProjectContext } from '../utils/index-loader.js';
import { trackToolCall } from './context.js';
import { getSessionTracker } from '../utils/session-tracker.js';
import {
  loadHabits,
  evaluateHabits,
  buildEvaluationContext,
  type HabitTrigger,
  type HabitCategory,
  type EvaluationResult,
} from '../utils/habits-loader.js';
import {
  recordEvaluationResults,
  getComplianceRate,
  getComplianceByCategory,
  getPracticeEvents,
} from '../utils/practice-store.js';

// ============================================================================
// Tool Definitions
// ============================================================================

export function getHabitsToolsList() {
  return [
    {
      name: 'paradigm_habits_list',
      description:
        'List all habit definitions: seed (built-in), global (~/.paradigm/habits.yaml), and project (.paradigm/habits.yaml). Shows what habits exist, their triggers, severity, and enabled state. Use to discover available habits before evaluating them.',
      inputSchema: {
        type: 'object',
        properties: {
          trigger: {
            type: 'string',
            enum: ['preflight', 'postflight', 'on-commit', 'on-stop'],
            description: 'Filter by trigger point',
          },
          category: {
            type: 'string',
            enum: ['discovery', 'verification', 'testing', 'documentation', 'collaboration', 'security'],
            description: 'Filter by category',
          },
          enabled: {
            type: 'boolean',
            description: 'Filter by enabled state (default: show all)',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_habits_check',
      description:
        'Evaluate habit compliance for the current session and record practice events. Call at preflight (before implementing), postflight (after implementing), or on-stop (session end). Returns which habits were followed, skipped, or partially met.',
      inputSchema: {
        type: 'object',
        properties: {
          trigger: {
            type: 'string',
            enum: ['preflight', 'postflight', 'on-stop', 'on-commit'],
            description: 'When to evaluate: preflight (before task), postflight (after task), on-stop (session end)',
          },
          filesModified: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files modified during the session/task',
          },
          symbolsTouched: {
            type: 'array',
            items: { type: 'string' },
            description: 'Symbols touched during the session/task',
          },
          taskDescription: {
            type: 'string',
            description: 'Description of the task being performed',
          },
          record: {
            type: 'boolean',
            description: 'Whether to record practice events (default: true)',
          },
        },
        required: ['trigger'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_habits_status',
      description:
        'View practice profile: compliance rates by category, trends, and incident correlations. Shows how well habits are being followed over time.',
      inputSchema: {
        type: 'object',
        properties: {
          engineer: {
            type: 'string',
            description: 'Filter by engineer name (default: all)',
          },
          period: {
            type: 'string',
            enum: ['7d', '30d', '90d', 'all'],
            description: 'Time period for analysis (default: 30d)',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_practice_context',
      description:
        'Get proactive practice warnings before modifying symbols. Shows recent compliance gaps and team-aware suggestions. Call this alongside paradigm_wisdom_context for full context.',
      inputSchema: {
        type: 'object',
        properties: {
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Symbols about to be modified',
          },
          task: {
            type: 'string',
            description: 'Description of the upcoming task',
          },
        },
        required: ['symbols'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
  ];
}

// ============================================================================
// Tool Handler
// ============================================================================

export async function handleHabitsTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_habits_list': {
      const result = handleHabitsList(args, ctx);
      trackToolCall(result.length, name);
      return { text: result, handled: true };
    }

    case 'paradigm_habits_check': {
      const result = await handleHabitsCheck(args, ctx);
      trackToolCall(result.length, name);
      return { text: result, handled: true };
    }

    case 'paradigm_habits_status': {
      const result = await handleHabitsStatus(args, ctx);
      trackToolCall(result.length, name);
      return { text: result, handled: true };
    }

    case 'paradigm_practice_context': {
      const result = await handlePracticeContext(args, ctx);
      trackToolCall(result.length, name);
      return { text: result, handled: true };
    }

    default:
      return { text: '', handled: false };
  }
}

// ============================================================================
// paradigm_habits_list
// ============================================================================

function handleHabitsList(
  args: Record<string, unknown>,
  ctx: ProjectContext
): string {
  const triggerFilter = args.trigger as HabitTrigger | undefined;
  const categoryFilter = args.category as HabitCategory | undefined;
  const enabledFilter = args.enabled as boolean | undefined;

  let habits = loadHabits(ctx.rootDir);

  if (triggerFilter) habits = habits.filter((h) => h.trigger === triggerFilter);
  if (categoryFilter) habits = habits.filter((h) => h.category === categoryFilter);
  if (enabledFilter !== undefined) habits = habits.filter((h) => h.enabled === enabledFilter);

  // Group by trigger for readability
  const byTrigger: Record<string, typeof habits> = {};
  for (const h of habits) {
    if (!byTrigger[h.trigger]) byTrigger[h.trigger] = [];
    byTrigger[h.trigger].push(h);
  }

  return JSON.stringify(
    {
      total: habits.length,
      filters: Object.fromEntries(
        Object.entries({ trigger: triggerFilter, category: categoryFilter, enabled: enabledFilter })
          .filter(([, v]) => v !== undefined)
      ),
      byTrigger: Object.fromEntries(
        Object.entries(byTrigger).map(([trigger, list]) => [
          trigger,
          list.map((h) => ({
            id: h.id,
            name: h.name,
            description: h.description,
            category: h.category,
            severity: h.severity,
            enabled: h.enabled,
            check: { type: h.check.type, params: h.check.params },
            platforms: h.platforms || null,
          })),
        ])
      ),
    },
    null,
    2
  );
}

// ============================================================================
// paradigm_habits_check
// ============================================================================

async function handleHabitsCheck(
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<string> {
  const trigger = args.trigger as HabitTrigger;
  const filesModified = (args.filesModified as string[]) || [];
  const symbolsTouched = (args.symbolsTouched as string[]) || [];
  const taskDescription = args.taskDescription as string | undefined;
  const shouldRecord = args.record !== false;

  // Load habits
  const habits = loadHabits(ctx.rootDir);

  // Get session breadcrumbs to know which tools were called
  const tracker = getSessionTracker();
  const stats = tracker.getStats();
  const toolsCalled = [...new Set(stats.toolCalls.map((tc) => tc.toolName))];

  // Check if lore was recorded
  const loreRecorded = toolsCalled.includes('paradigm_lore_record');

  // Check if task adds routes
  const taskLower = (taskDescription || '').toLowerCase();
  const taskAddsRoutes = [
    'endpoint', 'route', 'api', 'handler',
    'get', 'post', 'put', 'patch', 'delete',
  ].some((k) => taskLower.includes(k));

  // Check if working tree is clean (for git-clean habit)
  let gitClean: boolean | undefined;
  try {
    const status = execSync('git status --porcelain', {
      cwd: ctx.rootDir,
      encoding: 'utf8',
      timeout: 5000,
    });
    gitClean = status.trim() === '';
  } catch {
    // Git not available or not a repo
  }

  // Build evaluation context
  const evalContext = buildEvaluationContext({
    toolsCalled,
    filesModified,
    symbolsTouched,
    loreRecorded,
    hasPortalRoutes: ctx.gateConfig !== null && (ctx.gateConfig as unknown as Record<string, unknown>).routes != null,
    taskAddsRoutes,
    taskDescription,
    gitClean,
  });

  // Evaluate (MCP = claude or cursor; detect from session context)
  const platform = 'claude';  // MCP calls always come from Claude or Cursor
  const evaluation = evaluateHabits(habits, trigger, evalContext, platform);

  // Record practice events if requested
  let recordedIds: string[] = [];
  if (shouldRecord && evaluation.evaluations.length > 0) {
    try {
      const loreEntryId = tracker.getLastLoreEntryId() ?? undefined;
      recordedIds = await recordEvaluationResults(
        ctx.rootDir,
        evaluation.evaluations.map((e) => ({
          habitId: e.habit.id,
          habitCategory: e.habit.category,
          result: e.result,
          notes: e.reason,
        })),
        {
          engineer: 'agent',
          sessionId: stats.sessionId,
          loreEntryId,
          taskDescription,
          symbolsTouched,
          filesModified,
        }
      );
    } catch {
      // Recording is best-effort
    }
  }

  // Write/clear the blocking marker file for stop hook integration
  const markerPath = path.join(ctx.rootDir, '.paradigm', '.habits-blocking');
  try {
    if (trigger === 'on-stop' && evaluation.blocksCompletion) {
      const blocking = evaluation.evaluations
        .filter((e) => e.result === 'skipped' && e.habit.severity === 'block')
        .map((e) => `${e.habit.name}: ${e.reason}`);
      fs.writeFileSync(markerPath, blocking.join('\n'), 'utf8');
    } else if (trigger === 'on-stop') {
      // Clear the marker on successful on-stop evaluation
      if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
    }
  } catch {
    // Marker file is best-effort
  }

  return JSON.stringify(
    {
      trigger,
      evaluation: {
        total: evaluation.summary.total,
        followed: evaluation.summary.followed,
        skipped: evaluation.summary.skipped,
        partial: evaluation.summary.partial,
        blockingViolations: evaluation.summary.blockingViolations,
        blocksCompletion: evaluation.blocksCompletion,
      },
      habits: evaluation.evaluations.map((e) => ({
        id: e.habit.id,
        name: e.habit.name,
        category: e.habit.category,
        severity: e.habit.severity,
        result: e.result,
        reason: e.reason,
        evidence: e.evidence,
      })),
      recorded: shouldRecord ? recordedIds.length : 0,
      recommendations: buildRecommendations(evaluation),
    },
    null,
    2
  );
}

function buildRecommendations(evaluation: EvaluationResult): string[] {
  const recs: string[] = [];

  for (const e of evaluation.evaluations) {
    if (e.result === 'skipped') {
      switch (e.habit.id) {
        case 'explore-before-implement':
        case 'ripple-before-modify':
          recs.push(`Call paradigm_ripple or paradigm_navigate before modifying symbols.`);
          break;
        case 'check-fragility':
          recs.push(`Call paradigm_history_fragility to check for fragile symbols.`);
          break;
        case 'wisdom-before-implement':
          recs.push(`Call paradigm_wisdom_context to check team preferences and antipatterns.`);
          break;
        case 'verify-before-done':
          recs.push(`Call paradigm_pm_postflight to verify compliance before finishing.`);
          break;
        case 'record-lore-for-significant':
          recs.push(`Call paradigm_lore_record to document this session.`);
          break;
        case 'gates-for-routes':
          recs.push(`Call paradigm_gates_for_route and update portal.yaml for new routes.`);
          break;
        case 'purpose-coverage':
          recs.push(`Update .purpose files using paradigm_purpose_add_component.`);
          break;
        case 'changelog-updated':
          recs.push(`Update CHANGELOG.md with the changes made in this phase.`);
          break;
        case 'changes-committed':
          recs.push(`Commit all changes to git before finishing this phase.`);
          break;
        default:
          recs.push(`${e.habit.name}: ${e.reason}`);
      }
    }
  }

  return [...new Set(recs)];
}

// ============================================================================
// paradigm_habits_status
// ============================================================================

async function handleHabitsStatus(
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<string> {
  const engineer = args.engineer as string | undefined;
  const period = (args.period as string) || '30d';

  // Calculate date range
  const now = new Date();
  let dateFrom: string | undefined;
  if (period !== 'all') {
    const days = parseInt(period.replace('d', ''), 10) || 30;
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    dateFrom = from.toISOString();
  }

  const queryOptions = {
    engineer,
    dateFrom,
  };

  // Get overall compliance
  const overall = await getComplianceRate(ctx.rootDir, queryOptions);

  // Get by category
  const byCategory = await getComplianceByCategory(ctx.rootDir, queryOptions);

  // Get recent events for trend analysis
  const recentEvents = await getPracticeEvents(ctx.rootDir, {
    ...queryOptions,
    limit: 200,
  });

  // Calculate per-habit compliance
  const habitStats = new Map<
    string,
    { followed: number; skipped: number; partial: number; name?: string }
  >();
  for (const event of recentEvents) {
    const existing = habitStats.get(event.habitId) || {
      followed: 0,
      skipped: 0,
      partial: 0,
    };
    const result = event.result as 'followed' | 'skipped' | 'partial';
    existing[result]++;
    habitStats.set(event.habitId, existing);
  }

  // Find strongest and weakest categories
  let strongestCategory: string | null = null;
  let weakestCategory: string | null = null;
  let bestRate = -1;
  let worstRate = 101;

  for (const cat of byCategory) {
    if (cat.rate > bestRate) {
      bestRate = cat.rate;
      strongestCategory = cat.category;
    }
    if (cat.rate < worstRate) {
      worstRate = cat.rate;
      weakestCategory = cat.category;
    }
  }

  // Load habits for names
  const habits = loadHabits(ctx.rootDir);
  const habitNameMap = new Map(habits.map((h) => [h.id, h.name]));

  // Build per-habit breakdown
  const habitBreakdown = Array.from(habitStats.entries())
    .map(([id, stats]) => {
      const total = stats.followed + stats.skipped + stats.partial;
      const rate = total > 0 ? Math.round(((stats.followed + stats.partial * 0.5) / total) * 100) : 100;
      return {
        habitId: id,
        habitName: habitNameMap.get(id) || id,
        ...stats,
        total,
        rate,
      };
    })
    .sort((a, b) => a.rate - b.rate);

  return JSON.stringify(
    {
      period,
      engineer: engineer || 'all',
      overall: {
        totalEvents: overall.total,
        complianceRate: overall.rate,
        followed: overall.followed,
        skipped: overall.skipped,
        partial: overall.partial,
        strongestCategory,
        weakestCategory,
      },
      byCategory: byCategory.map((c) => ({
        category: c.category,
        rate: c.rate,
        total: c.total,
        followed: c.followed,
        skipped: c.skipped,
        partial: c.partial,
      })),
      byHabit: habitBreakdown,
      activeHabits: habits.filter((h) => h.enabled).length,
      totalHabits: habits.length,
    },
    null,
    2
  );
}

// ============================================================================
// paradigm_practice_context
// ============================================================================

async function handlePracticeContext(
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<string> {
  const symbols = (args.symbols as string[]) || [];
  const task = args.task as string | undefined;

  // Load habits
  const habits = loadHabits(ctx.rootDir);
  const preflightHabits = habits.filter(
    (h) => h.enabled && h.trigger === 'preflight'
  );

  // Get session tracker to check which tools have been called
  const tracker = getSessionTracker();
  const stats = tracker.getStats();
  const toolsCalled = [...new Set(stats.toolCalls.map((tc) => tc.toolName))];

  // Build warnings for habits that haven't been followed yet
  const warnings: Array<{
    habitId: string;
    habitName: string;
    category: string;
    severity: string;
    message: string;
    suggestion: string;
  }> = [];

  for (const habit of preflightHabits) {
    if (habit.check.type === 'tool-called') {
      const requiredTools = habit.check.params.tools || [];
      const anyCalled = requiredTools.some((t) => toolsCalled.includes(t));
      if (!anyCalled && symbols.length > 0) {
        warnings.push({
          habitId: habit.id,
          habitName: habit.name,
          category: habit.category,
          severity: habit.severity,
          message: `${habit.name}: ${habit.description}`,
          suggestion: `Call one of: ${requiredTools.join(', ')}`,
        });
      }
    }
  }

  // Get recent compliance for context
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();
  const recentCompliance = await getComplianceRate(ctx.rootDir, {
    dateFrom: thirtyDaysAgo,
  });

  // Find weak categories
  const byCategory = await getComplianceByCategory(ctx.rootDir, {
    dateFrom: thirtyDaysAgo,
  });
  const weakAreas = byCategory
    .filter((c) => c.rate < 60)
    .map((c) => c.category);

  return JSON.stringify(
    {
      symbols,
      task: task || null,
      warnings,
      recentCompliance: {
        rate: recentCompliance.rate,
        totalEvents: recentCompliance.total,
        weakAreas,
      },
      preflightReminders:
        warnings.length > 0
          ? `${warnings.length} habit(s) not yet followed this session. See warnings above.`
          : 'All preflight habits satisfied.',
    },
    null,
    2
  );
}
