/**
 * Spec Pipeline Utilities — load, save, create, and manage pipeline YAML files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { PipelineState, PipelineStage, GateConfig, StageState } from './pipeline-types.js';
import { STAGE_ORDER, PIPELINE_DIR } from './pipeline-types.js';

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function loadPipeline(projectDir: string, feature: string): PipelineState | null {
  const slug = slugify(feature);
  const filePath = path.join(projectDir, PIPELINE_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  return yaml.load(fs.readFileSync(filePath, 'utf8')) as PipelineState;
}

export function savePipeline(projectDir: string, pipeline: PipelineState): string {
  const slug = slugify(pipeline.feature);
  const dir = path.join(projectDir, PIPELINE_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${slug}.yaml`);
  fs.writeFileSync(filePath, yaml.dump(pipeline, { lineWidth: 120 }), 'utf8');
  return filePath;
}

export function listPipelines(projectDir: string): PipelineState[] {
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

export function createPipeline(feature: string, gateConfig: GateConfig, template?: string): PipelineState {
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

export function getNextStage(current: PipelineStage): PipelineStage | null {
  const idx = STAGE_ORDER.indexOf(current);
  return idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;
}

export function archivePipeline(projectDir: string, pipeline: PipelineState): void {
  const slug = slugify(pipeline.feature);
  const completedDir = path.join(projectDir, PIPELINE_DIR, 'completed');
  if (!fs.existsSync(completedDir)) fs.mkdirSync(completedDir, { recursive: true });
  const destPath = path.join(completedDir, `${slug}.yaml`);
  fs.writeFileSync(destPath, yaml.dump(pipeline, { lineWidth: 120 }), 'utf8');
  // Remove active pipeline file
  const activePath = path.join(projectDir, PIPELINE_DIR, `${slug}.yaml`);
  if (fs.existsSync(activePath)) fs.unlinkSync(activePath);
}
