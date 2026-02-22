/**
 * Paradigm Habits System - Type Definitions
 *
 * Defines the data model for habit definitions, practice events,
 * practice profiles, and evaluation results.
 */

// ═══════════════════════════════════════════════════════════════════
// HABIT DEFINITION TYPES
// ═══════════════════════════════════════════════════════════════════

export type HabitCategory =
  | 'discovery'
  | 'verification'
  | 'testing'
  | 'documentation'
  | 'collaboration'
  | 'security';

export type HabitTrigger =
  | 'preflight'
  | 'postflight'
  | 'on-commit'
  | 'on-stop';

export type HabitSeverity = 'advisory' | 'warn' | 'block';

export type HabitCheckType =
  | 'tool-called'
  | 'file-exists'
  | 'lore-recorded'
  | 'symbols-registered'
  | 'gates-declared'
  | 'tests-exist';

export interface HabitCheckParams {
  /** For tool-called: list of tool names (any one suffices) */
  tools?: string[];
  /** For file-exists: glob patterns that should match */
  patterns?: string[];
  /** For symbols-registered: minimum symbols that should be registered */
  minSymbols?: number;
  /** For gates-declared: whether portal.yaml must have route entries */
  requireRoutes?: boolean;
}

export interface HabitCheck {
  type: HabitCheckType;
  params: HabitCheckParams;
}

export interface HabitDefinition {
  id: string;
  name: string;
  description: string;
  category: HabitCategory;
  trigger: HabitTrigger;
  severity: HabitSeverity;
  check: HabitCheck;
  enabled: boolean;
}

export interface HabitOverride {
  severity?: HabitSeverity;
  enabled?: boolean;
}

export interface HabitsConfig {
  version: string;
  habits: HabitDefinition[];
  overrides?: Record<string, HabitOverride>;
}

// ═══════════════════════════════════════════════════════════════════
// PRACTICE EVENT TYPES
// ═══════════════════════════════════════════════════════════════════

export type PracticeResult = 'followed' | 'skipped' | 'partial';

export interface PracticeEvent {
  id: string;
  timestamp: string;
  habitId: string;
  habitCategory: HabitCategory;
  result: PracticeResult;
  engineer: string;
  sessionId: string;
  loreEntryId?: string;
  taskDescription?: string;
  symbolsTouched: string[];
  filesModified: string[];
  relatedIncidentId?: string;
  notes?: string;
}

export interface PracticeEventInput {
  habitId: string;
  habitCategory: HabitCategory;
  result: PracticeResult;
  engineer: string;
  sessionId: string;
  loreEntryId?: string;
  taskDescription?: string;
  symbolsTouched?: string[];
  filesModified?: string[];
  relatedIncidentId?: string;
  notes?: string;
}

export interface PracticeEventQuery {
  habitId?: string;
  habitCategory?: HabitCategory;
  result?: PracticeResult;
  engineer?: string;
  sessionId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

// ═══════════════════════════════════════════════════════════════════
// EVALUATION TYPES
// ═══════════════════════════════════════════════════════════════════

export interface HabitEvaluation {
  habit: HabitDefinition;
  result: PracticeResult;
  reason: string;
  evidence?: string[];
}

export interface EvaluationContext {
  /** Tool calls made during the session (breadcrumbs) */
  toolsCalled: string[];
  /** Files modified during the session */
  filesModified: string[];
  /** Symbols touched during the session */
  symbolsTouched: string[];
  /** Whether lore was recorded */
  loreRecorded: boolean;
  /** Whether portal.yaml exists and has routes */
  hasPortalRoutes: boolean;
  /** Whether the task involves routes */
  taskAddsRoutes: boolean;
  /** Task description */
  taskDescription?: string;
}

export interface EvaluationResult {
  trigger: HabitTrigger;
  evaluations: HabitEvaluation[];
  summary: {
    total: number;
    followed: number;
    skipped: number;
    partial: number;
    blockingViolations: number;
  };
  blocksCompletion: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// PRACTICE PROFILE TYPES
// ═══════════════════════════════════════════════════════════════════

export interface CategoryCompliance {
  category: HabitCategory;
  total: number;
  followed: number;
  skipped: number;
  partial: number;
  rate: number;
}

export interface HabitTrend {
  habitId: string;
  habitName: string;
  period: string;
  followed: number;
  skipped: number;
  partial: number;
  rate: number;
  direction: 'improving' | 'declining' | 'stable';
}

export interface IncidentCorrelation {
  habitId: string;
  habitName: string;
  skipCount: number;
  incidentCount: number;
  correlationScore: number;
}

export interface PracticeProfile {
  engineer: string;
  period: { start: string; end: string };
  overall: {
    totalEvents: number;
    complianceRate: number;
    strongestCategory: HabitCategory | null;
    weakestCategory: HabitCategory | null;
  };
  byCategory: CategoryCompliance[];
  trends: HabitTrend[];
  incidentCorrelations: IncidentCorrelation[];
}

// ═══════════════════════════════════════════════════════════════════
// PRACTICE CONTEXT TYPES (proactive warnings)
// ═══════════════════════════════════════════════════════════════════

export interface PracticeWarning {
  habitId: string;
  habitName: string;
  category: HabitCategory;
  severity: HabitSeverity;
  message: string;
  suggestion: string;
}

export interface PracticeContext {
  symbols: string[];
  warnings: PracticeWarning[];
  recentCompliance: {
    rate: number;
    weakAreas: HabitCategory[];
  };
}
