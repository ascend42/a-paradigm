/**
 * Paradigm Habits System
 *
 * Behavioral feedback loop for AI agent discipline.
 * Observation → Measurement → Feedback.
 */

// Types
export type {
  HabitCategory,
  HabitTrigger,
  HabitSeverity,
  HabitCheckType,
  HabitCheckParams,
  HabitCheck,
  HabitDefinition,
  HabitOverride,
  HabitsConfig,
  PracticeResult,
  PracticeEvent,
  PracticeEventInput,
  PracticeEventQuery,
  HabitEvaluation,
  EvaluationContext,
  EvaluationResult,
  CategoryCompliance,
  HabitTrend,
  IncidentCorrelation,
  PracticeProfile,
  PracticeWarning,
  PracticeContext,
} from './types.js';

// Loader
export {
  loadHabits,
  getHabitsByTrigger,
  getEnabledHabits,
  invalidateHabitsCache,
  clearHabitsCache,
} from './loader.js';

// Evaluator
export {
  evaluateHabits,
  buildEvaluationContext,
} from './evaluator.js';
