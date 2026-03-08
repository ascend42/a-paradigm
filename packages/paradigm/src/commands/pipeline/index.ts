/**
 * Pipeline CLI Commands — spec pipeline workflow management
 */

import chalk from 'chalk';
import {
  loadPipeline,
  savePipeline,
  listPipelines,
  createPipeline,
  getNextStage,
  archivePipeline,
} from '../../core/pipeline-utils.js';
import {
  DEFAULT_TEMPLATES,
  STAGE_ORDER,
  type PipelineState,
  type GateConfig,
  type GateMode,
} from '../../core/pipeline-types.js';

export async function pipelineStartCommand(
  description: string,
  options: { template?: string; gates?: string },
): Promise<void> {
  const projectDir = process.cwd();
  const template = options.template || 'add-feature';

  let gateConfig: GateConfig;
  if (options.gates) {
    const parts = options.gates.split(',');
    if (parts.length !== 5) {
      console.error(
        chalk.red('--gates requires 5 comma-separated modes: specify,plan,task,implement,validate'),
      );
      process.exit(1);
    }
    gateConfig = {
      specify: parts[0] as GateMode,
      plan: parts[1] as GateMode,
      task: parts[2] as GateMode,
      implement: parts[3] as GateMode,
      validate: parts[4] as GateMode,
    };
  } else {
    const tmpl = DEFAULT_TEMPLATES[template];
    if (!tmpl) {
      console.error(
        chalk.red(
          `Unknown template: ${template}. Available: ${Object.keys(DEFAULT_TEMPLATES).join(', ')}`,
        ),
      );
      process.exit(1);
    }
    gateConfig = tmpl.gates;
  }

  const pipeline = createPipeline(description, gateConfig, template);
  const filePath = savePipeline(projectDir, pipeline);

  console.log(chalk.green(`Pipeline created: ${pipeline.feature}`));
  console.log(chalk.gray(`Template: ${template}`));
  console.log(
    chalk.gray(`Gates: ${STAGE_ORDER.map(s => `${s}=${gateConfig[s]}`).join(', ')}`),
  );
  console.log(chalk.gray(`File: ${filePath}`));
  console.log(chalk.cyan(`\nCurrent stage: specify (in-progress)`));
}

export async function pipelineStatusCommand(feature?: string): Promise<void> {
  const projectDir = process.cwd();

  if (feature) {
    const pipeline = loadPipeline(projectDir, feature);
    if (!pipeline) {
      console.error(chalk.red(`Pipeline not found: ${feature}`));
      process.exit(1);
    }
    displayPipelineStatus(pipeline);
  } else {
    const pipelines = listPipelines(projectDir);
    if (pipelines.length === 0) {
      console.log(chalk.gray('No active pipelines'));
      return;
    }
    for (const p of pipelines) {
      displayPipelineStatus(p);
      console.log();
    }
  }
}

function displayPipelineStatus(pipeline: PipelineState): void {
  console.log(chalk.bold(`Pipeline: ${pipeline.feature}`));
  console.log(chalk.gray(`Created: ${pipeline.created}`));
  if (pipeline.template) console.log(chalk.gray(`Template: ${pipeline.template}`));
  console.log();

  for (const stage of STAGE_ORDER) {
    const state = pipeline.stages[stage];
    const gate = pipeline.gate_config[stage];
    const isCurrent = pipeline.current_stage === stage;
    const icon =
      state.status === 'approved'
        ? '+'
        : state.status === 'in-progress'
          ? '>'
          : state.status === 'blocked'
            ? 'x'
            : '.';
    const color =
      state.status === 'approved'
        ? chalk.green
        : state.status === 'in-progress'
          ? chalk.cyan
          : state.status === 'blocked'
            ? chalk.red
            : chalk.gray;

    console.log(
      color(
        `  ${icon} ${stage.padEnd(12)} [${gate}] ${state.status}${isCurrent ? ' <- current' : ''}`,
      ),
    );
    if (state.artifact) console.log(chalk.gray(`    Artifact: ${state.artifact}`));
    if (state.symbols_touched?.length)
      console.log(chalk.gray(`    Symbols: ${state.symbols_touched.join(', ')}`));
  }
}

export async function pipelineAdvanceCommand(feature: string): Promise<void> {
  const projectDir = process.cwd();
  const pipeline = loadPipeline(projectDir, feature);
  if (!pipeline) {
    console.error(chalk.red(`Pipeline not found: ${feature}`));
    process.exit(1);
  }

  const current = pipeline.current_stage;
  const gateMode = pipeline.gate_config[current];
  const next = getNextStage(current);

  // Mark current as approved
  pipeline.stages[current].status = 'approved';
  pipeline.stages[current].approved_at = new Date().toISOString();

  if (gateMode === 'auto') {
    pipeline.stages[current].auto_passed_at = new Date().toISOString();
  }

  if (next) {
    pipeline.current_stage = next;
    pipeline.stages[next].status = 'in-progress';
    savePipeline(projectDir, pipeline);
    console.log(chalk.green(`Stage '${current}' approved. Advanced to '${next}'.`));
  } else {
    // Pipeline complete
    savePipeline(projectDir, pipeline);
    archivePipeline(projectDir, pipeline);
    console.log(chalk.green(`Pipeline '${pipeline.feature}' completed and archived.`));
  }
}

export async function pipelineConfigureCommand(
  feature: string,
  options: { stage: string; gate: string; reason?: string },
): Promise<void> {
  const projectDir = process.cwd();
  const pipeline = loadPipeline(projectDir, feature);
  if (!pipeline) {
    console.error(chalk.red(`Pipeline not found: ${feature}`));
    process.exit(1);
  }

  const stage = options.stage as keyof GateConfig;
  if (!STAGE_ORDER.includes(stage as any)) {
    console.error(chalk.red(`Invalid stage: ${options.stage}`));
    process.exit(1);
  }

  const gate = options.gate as GateMode;
  if (!['auto', 'manual', 'sentinel'].includes(gate)) {
    console.error(chalk.red(`Invalid gate mode: ${options.gate}. Use: auto, manual, sentinel`));
    process.exit(1);
  }

  const old = pipeline.gate_config[stage];
  pipeline.gate_config[stage] = gate;
  savePipeline(projectDir, pipeline);

  console.log(chalk.green(`Gate for '${stage}' changed: ${old} -> ${gate}`));
  if (options.reason) console.log(chalk.gray(`Reason: ${options.reason}`));
}

export async function pipelineAbortCommand(feature: string): Promise<void> {
  const projectDir = process.cwd();
  const pipeline = loadPipeline(projectDir, feature);
  if (!pipeline) {
    console.error(chalk.red(`Pipeline not found: ${feature}`));
    process.exit(1);
  }

  archivePipeline(projectDir, pipeline);
  console.log(chalk.yellow(`Pipeline '${pipeline.feature}' aborted and archived.`));
}

export async function pipelineListCommand(): Promise<void> {
  const projectDir = process.cwd();
  const pipelines = listPipelines(projectDir);

  if (pipelines.length === 0) {
    console.log(chalk.gray('No active pipelines.'));
    return;
  }

  console.log(chalk.bold(`Active Pipelines (${pipelines.length}):\n`));
  for (const p of pipelines) {
    const completedStages = STAGE_ORDER.filter(s => p.stages[s].status === 'approved').length;
    console.log(
      `  ${chalk.cyan(p.feature)} -- stage ${completedStages}/${STAGE_ORDER.length} (${p.current_stage})`,
    );
  }
}
