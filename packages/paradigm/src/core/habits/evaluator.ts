/**
 * Habit Evaluator — Re-exports from the canonical MCP habits-loader.
 *
 * Single source of truth: packages/paradigm-mcp/src/utils/habits-loader.ts
 * This file re-exports to maintain the CLI's existing import paths.
 */

export {
  evaluateHabits,
  buildEvaluationContext,
} from '../../../../paradigm-mcp/src/utils/habits-loader.js';
