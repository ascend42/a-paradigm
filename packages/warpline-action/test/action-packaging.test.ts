/**
 * action-packaging.test — the action.yml packaging lint: valid YAML, composite
 * runner, every declared input threaded into the entrypoint env, outputs wired
 * to the guard step, defaults consistent with the code, and the repo self-test
 * workflow staying advisory.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { DEFAULT_THRESHOLD } from '../src/report.js';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface ActionYml {
  name: string;
  description: string;
  inputs: Record<string, { description?: string; default?: string; required?: boolean }>;
  outputs: Record<string, { description?: string; value?: string }>;
  runs: {
    using: string;
    steps: Array<{ id?: string; shell?: string; run?: string; env?: Record<string, string> }>;
  };
}

const action = yaml.load(fs.readFileSync(path.join(pkgDir, 'action.yml'), 'utf8')) as ActionYml;

describe('action.yml — packaging lint', () => {
  it('parses and declares the composite runner', () => {
    expect(action.name).toBe('Warpline Guard');
    expect(action.description.length).toBeGreaterThan(20);
    expect(action.runs.using).toBe('composite');
  });

  it('the guard step runs the built entrypoint via GITHUB_ACTION_PATH', () => {
    const step = action.runs.steps.find((s) => s.id === 'guard');
    expect(step).toBeDefined();
    expect(step!.shell).toBe('bash');
    expect(step!.run).toContain('$GITHUB_ACTION_PATH/dist/main.js');
  });

  it('every declared input is threaded into the entrypoint env', () => {
    const step = action.runs.steps.find((s) => s.id === 'guard')!;
    const env = step.env ?? {};
    const inputNames = Object.keys(action.inputs);
    expect(inputNames.sort()).toEqual(
      [
        'base-ref',
        'head-ref',
        'threshold',
        'paths',
        'fail-on-flag',
        'working-directory',
        'report-path',
      ].sort(),
    );
    for (const input of inputNames) {
      const envName = 'WARPLINE_INPUT_' + input.toUpperCase().replace(/-/g, '_');
      expect(env[envName], `env ${envName} for input ${input}`).toBe(`\${{ inputs.${input} }}`);
    }
  });

  it('defaults are safe: advisory fail-on-flag, threshold = the validated stratum', () => {
    expect(action.inputs['fail-on-flag'].default).toBe('false');
    expect(action.inputs['threshold'].default).toBe(String(DEFAULT_THRESHOLD));
  });

  it('outputs are wired to the guard step', () => {
    for (const name of ['verdict', 'knot-size', 'flag-count', 'report-path']) {
      expect(action.outputs[name]?.value).toBe(`\${{ steps.guard.outputs.${name} }}`);
    }
  });

  it('no input default smuggles an expression (refs resolve in code, not YAML)', () => {
    for (const [name, input] of Object.entries(action.inputs)) {
      expect(input.default ?? '', `input ${name}`).not.toContain('${{');
    }
  });
});

describe('repo self-test workflow — advisory, never blocking', () => {
  const wfPath = path.resolve(pkgDir, '../../.github/workflows/warpline-guard.yml');

  it('exists, parses, and cannot go red on a PR', () => {
    const wf = yaml.load(fs.readFileSync(wfPath, 'utf8')) as {
      on: unknown;
      jobs: Record<
        string,
        { 'continue-on-error'?: boolean; steps: Array<{ uses?: string; with?: Record<string, string> }> }
      >;
    };
    const guard = wf.jobs['guard'];
    expect(guard).toBeDefined();
    expect(guard['continue-on-error']).toBe(true);
    const actionStep = guard.steps.find((s) => s.uses === './packages/warpline-action');
    expect(actionStep).toBeDefined();
    expect(actionStep!.with?.['fail-on-flag']).toBe('false');
  });
});
