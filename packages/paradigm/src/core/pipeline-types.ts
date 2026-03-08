/**
 * Spec Pipeline Types — structured feature workflow with configurable gates
 *
 * 5 stages: specify → plan → task → implement → validate
 * 3 gate modes: auto (pass-through), manual (human approval), sentinel (automated checks)
 */

export type PipelineStage = 'specify' | 'plan' | 'task' | 'implement' | 'validate';
export type GateMode = 'auto' | 'manual' | 'sentinel';

export interface GateConfig {
  specify: GateMode;
  plan: GateMode;
  task: GateMode;
  implement: GateMode;
  validate: GateMode;
}

export interface StageState {
  status: 'pending' | 'in-progress' | 'approved' | 'blocked' | 'skipped';
  approved_by?: string;
  approved_at?: string;
  auto_passed_at?: string;
  gate_mode?: GateMode;
  artifact?: string;
  tasks?: string[];
  tasks_completed?: number;
  tasks_remaining?: number;
  symbols_touched?: string[];
  block_reason?: string;
}

export interface PipelineState {
  version: string;
  feature: string;
  created: string;
  current_stage: PipelineStage;
  gate_config: GateConfig;
  template?: string;
  stages: Record<PipelineStage, StageState>;
}

export interface PipelineTemplate {
  gates: GateConfig;
  description?: string;
}

export const DEFAULT_TEMPLATES: Record<string, PipelineTemplate> = {
  'add-feature': {
    gates: { specify: 'manual', plan: 'manual', task: 'auto', implement: 'sentinel', validate: 'sentinel' },
    description: 'Standard feature addition with manual spec/plan review',
  },
  'bug-fix': {
    gates: { specify: 'auto', plan: 'auto', task: 'auto', implement: 'sentinel', validate: 'sentinel' },
    description: 'Quick bug fix with automated gates except validation',
  },
  'security-change': {
    gates: { specify: 'manual', plan: 'manual', task: 'manual', implement: 'manual', validate: 'manual' },
    description: 'Security-sensitive change with all-manual gates',
  },
  'refactor': {
    gates: { specify: 'auto', plan: 'manual', task: 'auto', implement: 'sentinel', validate: 'sentinel' },
    description: 'Code refactoring with manual plan review',
  },
};

export const STAGE_ORDER: PipelineStage[] = ['specify', 'plan', 'task', 'implement', 'validate'];

export const PIPELINE_DIR = '.paradigm/pipeline';
