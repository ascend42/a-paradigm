/**
 * The generated "Automatic Enforcement" section states the project's real
 * enforcement level. The default is `none` (every check off), so a fresh
 * project's CLAUDE.md must not claim the stop hook blocks.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { adapters, loadParadigmFiles } from './index.js';
import { claudeAdapter } from './claude.js';
import { generateEnforcementSection } from './base.js';
import { createMockParadigmFiles } from '../../test-utils.js';
import type { ParadigmFiles } from './types.js';
import type { EnforcementConfig } from '../enforcement/types.js';

const ORCH = { threshold: 3, detection: 'git-diff', exempt: [] };

function filesAt(enforcement?: EnforcementConfig): ParadigmFiles {
  return { ...createMockParadigmFiles(), ...(enforcement ? { enforcement } : {}) };
}

let tmp: string | undefined;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe('generateEnforcementSection', () => {
  it('says checks are off and names the command when enforcement is unset (default none)', () => {
    const out = generateEnforcementSection(filesAt());
    expect(out).toContain('Enforcement level: `none`');
    expect(out).toContain('checks are **off**');
    expect(out).toContain('paradigm enforcement set <level>');
    expect(out).toContain('| **Stop** | All checks off |');
    expect(out).not.toContain('BLOCKS');
    expect(out).not.toContain('If blocked');
  });

  it('says warns-but-never-blocks at minimal', () => {
    const out = generateEnforcementSection(filesAt({ level: 'minimal', checks: {}, orchestration: ORCH }));
    expect(out).toContain('Enforcement level: `minimal`');
    expect(out).toContain('**warns but never blocks**');
    expect(out).toContain('Warns on: source files changed without a .purpose update');
    expect(out).not.toContain('BLOCKS');
    expect(out).not.toContain('Blocks on');
  });

  it('lists what blocks and what warns at balanced', () => {
    const out = generateEnforcementSection(filesAt({ level: 'balanced', checks: {}, orchestration: ORCH }));
    expect(out).toContain('Enforcement level: `balanced`');
    expect(out).toContain('**BLOCKS**');
    expect(out).toContain('Blocks on: source files changed without a .purpose update; unmet blocking habits.');
    expect(out).toContain('Warns on: ');
    expect(out).toContain('**If blocked:**');
  });

  it('counts a per-check override and reflects it (none + one blocking override)', () => {
    const out = generateEnforcementSection(
      filesAt({ level: 'none', checks: { 'portal-gates': 'block' }, orchestration: ORCH }),
    );
    expect(out).toContain('`none` with 1 per-check override');
    expect(out).toContain('| **Stop** | Blocks on: routes with no portal.yaml gates |');
  });
});

describe('enforcement claim across generated files', () => {
  it('CLAUDE.md for a default project does not claim the stop hook blocks', () => {
    const out = claudeAdapter.generate(filesAt());
    expect(out).toContain('## Automatic Enforcement (Hooks)');
    expect(out).toContain('checks are **off**');
    expect(out).not.toContain('The stop hook **BLOCKS**');
  });

  it('no adapter claims blocking for a default project', () => {
    for (const [, adapter] of adapters) {
      const out = adapter.generate(filesAt());
      expect(out).not.toMatch(/stop hook \*\*BLOCKS\*\*/i);
      expect(out).not.toContain('Blocks on:');
    }
  });

  it('the section is byte-stable across generations (cacheable head)', () => {
    const files = filesAt({ level: 'strict', checks: {}, orchestration: ORCH });
    expect(generateEnforcementSection(files)).toBe(generateEnforcementSection(files));
  });
});

describe('loadParadigmFiles resolves the enforcement level from config.yaml', () => {
  function project(configYaml: string): string {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-enf-'));
    fs.mkdirSync(path.join(tmp, '.paradigm'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.paradigm', 'config.yaml'), configYaml, 'utf8');
    return tmp;
  }

  it('defaults to none when config.yaml has no enforcement block', () => {
    const files = loadParadigmFiles(project('version: "2.0"\nproject: demo\n'));
    expect(files?.enforcement?.level).toBe('none');
    expect(claudeAdapter.generate(files!)).toContain('checks are **off**');
  });

  it('reads a configured level and the generated CLAUDE.md says it blocks', () => {
    const files = loadParadigmFiles(project('version: "2.0"\nproject: demo\nenforcement:\n  level: strict\n'));
    expect(files?.enforcement?.level).toBe('strict');
    const out = claudeAdapter.generate(files!);
    expect(out).toContain('Enforcement level: `strict`');
    expect(out).toContain('The stop hook **BLOCKS** in this project');
  });
});
