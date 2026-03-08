/**
 * Pipeline MCP Tools — spec pipeline workflow management
 *
 * Tools:
 * - paradigm_pipeline_start: Create a new pipeline with template/gate config
 * - paradigm_pipeline_status: Get current stage and progress
 * - paradigm_pipeline_advance: Advance past current gate
 * - paradigm_pipeline_configure: Change gate modes on active pipeline
 * - paradigm_pipeline_escalate: Flag for user input
 * - paradigm_pipeline_abort: Cancel a pipeline
 * - paradigm_pipeline_list: List all active pipelines
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ProjectContext } from '../utils/index-loader.js';

// ── Pipeline types (local, no cross-package import) ──────────

type PipelineStage = 'specify' | 'plan' | 'task' | 'implement' | 'validate';
type GateMode = 'auto' | 'manual' | 'sentinel';

interface GateConfig {
  specify: GateMode;
  plan: GateMode;
  task: GateMode;
  implement: GateMode;
  validate: GateMode;
}

interface StageState {
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

interface PipelineState {
  version: string;
  feature: string;
  created: string;
  current_stage: PipelineStage;
  gate_config: GateConfig;
  template?: string;
  stages: Record<PipelineStage, StageState>;
}

const STAGE_ORDER: PipelineStage[] = ['specify', 'plan', 'task', 'implement', 'validate'];
const PIPELINE_DIR = '.paradigm/pipeline';

const DEFAULT_TEMPLATES: Record<string, { gates: GateConfig; description: string }> = {
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

// ── Pipeline utilities (local, no cross-package import) ──────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function loadPipeline(projectDir: string, feature: string): PipelineState | null {
  const slug = slugify(feature);
  const filePath = path.join(projectDir, PIPELINE_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  return yaml.load(fs.readFileSync(filePath, 'utf8')) as PipelineState;
}

function savePipeline(projectDir: string, pipeline: PipelineState): string {
  const slug = slugify(pipeline.feature);
  const dir = path.join(projectDir, PIPELINE_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${slug}.yaml`);
  fs.writeFileSync(filePath, yaml.dump(pipeline, { lineWidth: 120 }), 'utf8');
  return filePath;
}

function listPipelines(projectDir: string): PipelineState[] {
  const dir = path.join(projectDir, PIPELINE_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.yaml') && !f.startsWith('completed'))
    .map(f => {
      try {
        return yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')) as PipelineState;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as PipelineState[];
}

function createPipeline(feature: string, gateConfig: GateConfig, template?: string): PipelineState {
  const stages: Record<PipelineStage, StageState> = {
    specify: { status: 'pending' },
    plan: { status: 'pending' },
    task: { status: 'pending' },
    implement: { status: 'pending' },
    validate: { status: 'pending' },
  };
  stages.specify.status = 'in-progress';

  return {
    version: '1.0',
    feature: slugify(feature),
    created: new Date().toISOString(),
    current_stage: 'specify',
    gate_config: gateConfig,
    template,
    stages,
  };
}

function getNextStage(current: PipelineStage): PipelineStage | null {
  const idx = STAGE_ORDER.indexOf(current);
  return idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;
}

function archivePipeline(projectDir: string, pipeline: PipelineState): void {
  const slug = slugify(pipeline.feature);
  const completedDir = path.join(projectDir, PIPELINE_DIR, 'completed');
  if (!fs.existsSync(completedDir)) fs.mkdirSync(completedDir, { recursive: true });
  const destPath = path.join(completedDir, `${slug}.yaml`);
  fs.writeFileSync(destPath, yaml.dump(pipeline, { lineWidth: 120 }), 'utf8');
  const activePath = path.join(projectDir, PIPELINE_DIR, `${slug}.yaml`);
  if (fs.existsSync(activePath)) fs.unlinkSync(activePath);
}

// ── Tool definitions ─────────────────────────────────────────

export function getPipelineToolsList() {
  return [
    {
      name: 'paradigm_pipeline_start',
      description:
        'Create a new spec pipeline for a feature. Uses templates (add-feature, bug-fix, security-change, refactor) or custom gate config. Returns pipeline state. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          feature: {
            type: 'string',
            description: 'Feature name or description (will be slugified)',
          },
          template: {
            type: 'string',
            enum: ['add-feature', 'bug-fix', 'security-change', 'refactor'],
            description: 'Pipeline template (default: add-feature)',
          },
          gates: {
            type: 'object',
            properties: {
              specify: { type: 'string', enum: ['auto', 'manual', 'sentinel'] },
              plan: { type: 'string', enum: ['auto', 'manual', 'sentinel'] },
              task: { type: 'string', enum: ['auto', 'manual', 'sentinel'] },
              implement: { type: 'string', enum: ['auto', 'manual', 'sentinel'] },
              validate: { type: 'string', enum: ['auto', 'manual', 'sentinel'] },
            },
            description: 'Custom gate config (overrides template)',
          },
        },
        required: ['feature'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_pipeline_status',
      description:
        'Get pipeline status — current stage, progress, gate config. Pass feature name for specific pipeline, or omit for all active pipelines. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          feature: {
            type: 'string',
            description: 'Feature name (omit to list all active pipelines)',
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_pipeline_advance',
      description:
        'Advance pipeline past the current gate. Marks current stage as approved and moves to the next stage. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          feature: {
            type: 'string',
            description: 'Feature name',
          },
          approved_by: {
            type: 'string',
            description: 'Who approved this gate (default: agent)',
          },
        },
        required: ['feature'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_pipeline_configure',
      description:
        'Change gate modes on an active pipeline. Use to escalate or relax gates during development. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          feature: {
            type: 'string',
            description: 'Feature name',
          },
          updates: {
            type: 'object',
            properties: {
              specify: { type: 'string', enum: ['auto', 'manual', 'sentinel'] },
              plan: { type: 'string', enum: ['auto', 'manual', 'sentinel'] },
              task: { type: 'string', enum: ['auto', 'manual', 'sentinel'] },
              implement: { type: 'string', enum: ['auto', 'manual', 'sentinel'] },
              validate: { type: 'string', enum: ['auto', 'manual', 'sentinel'] },
            },
            description: 'Stage-to-gate-mode updates',
          },
          reason: {
            type: 'string',
            description: 'Reason for the configuration change',
          },
        },
        required: ['feature', 'updates', 'reason'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_pipeline_escalate',
      description:
        'Flag a pipeline stage for user input. Use when a gate requires a decision the agent cannot make autonomously. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          feature: {
            type: 'string',
            description: 'Feature name',
          },
          stage: {
            type: 'string',
            enum: ['specify', 'plan', 'task', 'implement', 'validate'],
            description: 'Stage to escalate',
          },
          question: {
            type: 'string',
            description: 'Question for the user',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Available options for the user',
          },
          context: {
            type: 'object',
            description: 'Additional context for the decision',
          },
        },
        required: ['feature', 'stage', 'question', 'options'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    {
      name: 'paradigm_pipeline_abort',
      description:
        'Cancel and archive an active pipeline. Use when a feature is abandoned or no longer needed. ~100 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          feature: {
            type: 'string',
            description: 'Feature name',
          },
        },
        required: ['feature'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    {
      name: 'paradigm_pipeline_list',
      description:
        'List all active pipelines with current stages and progress. ~150 tokens.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
  ];
}

// ── Handler ──────────────────────────────────────────────────

export async function handlePipelineTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ text: string; handled: boolean }> {
  switch (name) {
    case 'paradigm_pipeline_start': {
      const feature = args.feature as string;
      const templateName = (args.template as string) || 'add-feature';
      const customGates = args.gates as Record<string, string> | undefined;

      let gateConfig: GateConfig;
      if (customGates) {
        gateConfig = {
          specify: (customGates.specify as GateMode) || 'manual',
          plan: (customGates.plan as GateMode) || 'manual',
          task: (customGates.task as GateMode) || 'auto',
          implement: (customGates.implement as GateMode) || 'sentinel',
          validate: (customGates.validate as GateMode) || 'sentinel',
        };
      } else {
        const tmpl = DEFAULT_TEMPLATES[templateName];
        if (!tmpl) {
          return {
            handled: true,
            text: JSON.stringify({
              error: `Unknown template: ${templateName}`,
              available: Object.keys(DEFAULT_TEMPLATES),
            }),
          };
        }
        gateConfig = tmpl.gates;
      }

      const pipeline = createPipeline(feature, gateConfig, templateName);
      const filePath = savePipeline(ctx.rootDir, pipeline);

      return {
        handled: true,
        text: JSON.stringify(
          {
            created: true,
            feature: pipeline.feature,
            template: templateName,
            file: filePath,
            current_stage: pipeline.current_stage,
            gate_config: pipeline.gate_config,
            stages: pipeline.stages,
            hint: `Pipeline '${pipeline.feature}' started at 'specify' stage. Create your spec, then call paradigm_pipeline_advance to move to 'plan'.`,
          },
          null,
          2,
        ),
      };
    }

    case 'paradigm_pipeline_status': {
      const feature = args.feature as string | undefined;

      if (feature) {
        const pipeline = loadPipeline(ctx.rootDir, feature);
        if (!pipeline) {
          return {
            handled: true,
            text: JSON.stringify({ error: `Pipeline not found: ${feature}` }),
          };
        }

        const completedStages = STAGE_ORDER.filter(
          s => pipeline.stages[s].status === 'approved',
        ).length;

        return {
          handled: true,
          text: JSON.stringify(
            {
              feature: pipeline.feature,
              created: pipeline.created,
              template: pipeline.template,
              current_stage: pipeline.current_stage,
              progress: `${completedStages}/${STAGE_ORDER.length}`,
              gate_config: pipeline.gate_config,
              stages: pipeline.stages,
            },
            null,
            2,
          ),
        };
      }

      // List all active pipelines
      const pipelines = listPipelines(ctx.rootDir);
      if (pipelines.length === 0) {
        return {
          handled: true,
          text: JSON.stringify({
            count: 0,
            message: 'No active pipelines. Use paradigm_pipeline_start to create one.',
          }),
        };
      }

      return {
        handled: true,
        text: JSON.stringify(
          {
            count: pipelines.length,
            pipelines: pipelines.map(p => {
              const completed = STAGE_ORDER.filter(
                s => p.stages[s].status === 'approved',
              ).length;
              return {
                feature: p.feature,
                current_stage: p.current_stage,
                progress: `${completed}/${STAGE_ORDER.length}`,
                template: p.template,
                created: p.created,
              };
            }),
          },
          null,
          2,
        ),
      };
    }

    case 'paradigm_pipeline_advance': {
      const feature = args.feature as string;
      const approvedBy = (args.approved_by as string) || 'agent';

      const pipeline = loadPipeline(ctx.rootDir, feature);
      if (!pipeline) {
        return {
          handled: true,
          text: JSON.stringify({ error: `Pipeline not found: ${feature}` }),
        };
      }

      const current = pipeline.current_stage;
      const gateMode = pipeline.gate_config[current];
      const next = getNextStage(current);

      // Mark current as approved
      pipeline.stages[current].status = 'approved';
      pipeline.stages[current].approved_by = approvedBy;
      pipeline.stages[current].approved_at = new Date().toISOString();

      if (gateMode === 'auto') {
        pipeline.stages[current].auto_passed_at = new Date().toISOString();
      }

      if (next) {
        pipeline.current_stage = next;
        pipeline.stages[next].status = 'in-progress';
        savePipeline(ctx.rootDir, pipeline);

        return {
          handled: true,
          text: JSON.stringify(
            {
              advanced: true,
              from: current,
              to: next,
              gate_mode: gateMode,
              approved_by: approvedBy,
              pipeline: {
                feature: pipeline.feature,
                current_stage: pipeline.current_stage,
                stages: pipeline.stages,
              },
            },
            null,
            2,
          ),
        };
      }

      // Pipeline complete
      savePipeline(ctx.rootDir, pipeline);
      archivePipeline(ctx.rootDir, pipeline);

      return {
        handled: true,
        text: JSON.stringify(
          {
            completed: true,
            feature: pipeline.feature,
            message: `Pipeline '${pipeline.feature}' completed and archived.`,
            stages: pipeline.stages,
          },
          null,
          2,
        ),
      };
    }

    case 'paradigm_pipeline_configure': {
      const feature = args.feature as string;
      const updates = args.updates as Record<string, string>;
      const reason = args.reason as string;

      const pipeline = loadPipeline(ctx.rootDir, feature);
      if (!pipeline) {
        return {
          handled: true,
          text: JSON.stringify({ error: `Pipeline not found: ${feature}` }),
        };
      }

      const changes: Array<{ stage: string; from: string; to: string }> = [];
      for (const [stage, mode] of Object.entries(updates)) {
        if (STAGE_ORDER.includes(stage as PipelineStage) && ['auto', 'manual', 'sentinel'].includes(mode)) {
          const old = pipeline.gate_config[stage as keyof GateConfig];
          pipeline.gate_config[stage as keyof GateConfig] = mode as GateMode;
          changes.push({ stage, from: old, to: mode });
        }
      }

      if (changes.length === 0) {
        return {
          handled: true,
          text: JSON.stringify({
            error: 'No valid gate updates provided',
            valid_stages: STAGE_ORDER,
            valid_modes: ['auto', 'manual', 'sentinel'],
          }),
        };
      }

      savePipeline(ctx.rootDir, pipeline);

      return {
        handled: true,
        text: JSON.stringify(
          {
            configured: true,
            feature: pipeline.feature,
            changes,
            reason,
            gate_config: pipeline.gate_config,
          },
          null,
          2,
        ),
      };
    }

    case 'paradigm_pipeline_escalate': {
      const feature = args.feature as string;
      const stage = args.stage as PipelineStage;
      const question = args.question as string;
      const options = args.options as string[];
      const context = args.context as Record<string, unknown> | undefined;

      const pipeline = loadPipeline(ctx.rootDir, feature);
      if (!pipeline) {
        return {
          handled: true,
          text: JSON.stringify({ error: `Pipeline not found: ${feature}` }),
        };
      }

      // Mark the stage as blocked
      pipeline.stages[stage].status = 'blocked';
      pipeline.stages[stage].block_reason = question;
      savePipeline(ctx.rootDir, pipeline);

      return {
        handled: true,
        text: JSON.stringify(
          {
            escalated: true,
            feature: pipeline.feature,
            stage,
            question,
            options,
            context: context || {},
            current_gate: pipeline.gate_config[stage],
            instruction:
              'This pipeline stage requires user input. Present the question and options to the user, then use paradigm_pipeline_advance or paradigm_pipeline_configure based on their response.',
          },
          null,
          2,
        ),
      };
    }

    case 'paradigm_pipeline_abort': {
      const feature = args.feature as string;

      const pipeline = loadPipeline(ctx.rootDir, feature);
      if (!pipeline) {
        return {
          handled: true,
          text: JSON.stringify({ error: `Pipeline not found: ${feature}` }),
        };
      }

      archivePipeline(ctx.rootDir, pipeline);

      return {
        handled: true,
        text: JSON.stringify({
          aborted: true,
          feature: pipeline.feature,
          message: `Pipeline '${pipeline.feature}' aborted and archived.`,
        }),
      };
    }

    case 'paradigm_pipeline_list': {
      const pipelines = listPipelines(ctx.rootDir);

      if (pipelines.length === 0) {
        return {
          handled: true,
          text: JSON.stringify({
            count: 0,
            message: 'No active pipelines.',
          }),
        };
      }

      return {
        handled: true,
        text: JSON.stringify(
          {
            count: pipelines.length,
            pipelines: pipelines.map(p => {
              const completed = STAGE_ORDER.filter(
                s => p.stages[s].status === 'approved',
              ).length;
              return {
                feature: p.feature,
                current_stage: p.current_stage,
                progress: `${completed}/${STAGE_ORDER.length}`,
                template: p.template,
                created: p.created,
              };
            }),
          },
          null,
          2,
        ),
      };
    }

    default:
      return { handled: false, text: '' };
  }
}
