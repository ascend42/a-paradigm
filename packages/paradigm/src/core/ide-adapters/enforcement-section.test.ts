/**
 * The generated "Automatic Enforcement" section states the project's real
 * enforcement level and says only what the stop hook does. The default is
 * `none`, so a fresh project's CLAUDE.md must not claim the hook blocks; and no
 * level may claim that nothing can block (guard remediations and a missing CLI
 * block at every level).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { adapters, loadParadigmFiles } from './index.js';
import { claudeAdapter, ClaudeAdapter } from './claude.js';
import { generateEnforcementSection, ENFORCEMENT_CHECK_LABELS } from './base.js';
import { createMockParadigmFiles } from '../../test-utils.js';
import type { ParadigmFiles } from './types.js';
import { CHECK_IDS, ENFORCEMENT_LEVELS } from '../enforcement/types.js';
import type { CheckId, EnforcementConfig } from '../enforcement/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOKS = path.join(here, '..', '..', 'commands', 'hooks', 'scripts');
const COMMON_SH = fs.readFileSync(path.join(HOOKS, 'paradigm-common.sh'), 'utf8').replace(/\r\n/g, '\n');
const STOP_SH = fs.readFileSync(path.join(HOOKS, 'claude-code-stop.sh'), 'utf8').replace(/\r\n/g, '\n');

const ORCH = { threshold: 3, detection: 'git-diff', exempt: [] };

function filesAt(enforcement?: EnforcementConfig): ParadigmFiles {
  return { ...createMockParadigmFiles(), ...(enforcement ? { enforcement } : {}) };
}
const at = (level: EnforcementConfig['level'], checks: EnforcementConfig['checks'] = {}): string =>
  generateEnforcementSection(filesAt({ level, checks, orchestration: ORCH }));

let tmp: string | undefined;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe('generateEnforcementSection', () => {
  it('default (enforcement unset = none): this level\'s checks are off, and the command is named', () => {
    const out = generateEnforcementSection(filesAt());
    expect(out).toContain('Enforcement level: `none`');
    expect(out).toContain("This level's stop-hook checks are **off**");
    expect(out).toContain('paradigm enforcement set <level>');
    expect(out).toContain("| **Stop** | This level's checks are off |");
    expect(out).not.toContain('Blocks on');
    expect(out).not.toContain('If blocked');
  });

  it('minimal: warns and does not block', () => {
    const out = at('minimal');
    expect(out).toContain('Enforcement level: `minimal`');
    expect(out).toContain('**warn and do not block**');
    expect(out).toContain('Warns on: source changed and no Paradigm file updated');
    expect(out).not.toContain('Blocks on');
  });

  it('balanced: lists what blocks and what warns', () => {
    const out = at('balanced');
    expect(out).toContain('Enforcement level: `balanced`');
    expect(out).toContain('Blocks on: source changed and no Paradigm file updated; unmet blocking habits.');
    expect(out).toContain('Warns on: ');
    expect(out).toContain('**If blocked:**');
  });

  it('counts a per-check override and reflects it (none + one blocking override)', () => {
    const out = at('none', { 'portal-gates': 'block' });
    expect(out).toContain('`none` with 1 per-check override');
    expect(out).toContain('| **Stop** | Blocks on: route code changed in a project with no portal.yaml |');
  });

  it('stays short at every level (always-on text)', () => {
    for (const level of ENFORCEMENT_LEVELS) expect(at(level).length).toBeLessThan(1500);
  });
});

describe('the section says only what the hook does', () => {
  it('no level claims that nothing can block or warn', () => {
    for (const level of ENFORCEMENT_LEVELS) {
      const out = at(level);
      expect(out).not.toMatch(/nothing blocks|nothing warns|never blocks in this project/i);
      // true at every level: guard remediations, and the missing-CLI fallback
      expect(out).toContain('At any level: a `guard` remediation blocks');
      expect(out).toContain('if the `paradigm` CLI cannot be found');
    }
  });

  it('the hook really has those two any-level behaviours', () => {
    // Check 14: a guard remediation is a violation, with no severity lookup.
    const check14 = COMMON_SH.slice(COMMON_SH.indexOf('# --- Check 14'), COMMON_SH.indexOf('# --- Check 15'));
    expect(check14).toMatch(/guard\)\s*\n\s*VIOLATIONS=/);
    expect(check14).not.toContain('_check_severity');
    // Missing CLI: empty enforcement map, so the default (block) applies.
    expect(COMMON_SH).toContain('if [ -z "$ENFORCEMENT_MAP" ]; then\n    echo "$_default"');
    expect(COMMON_SH).toContain('_SEV_PARADIGM_MISSING=$(_check_severity "portal-compliance" "block")');
  });

  it('a blocking level says the hook blocks once per violation set, as the Stop script does', () => {
    for (const level of ['balanced', 'strict'] as const) {
      const out = at(level);
      expect(out).toContain('**blocks once** for each new set of violations; the same set is advisory after that');
      expect(out).not.toMatch(/until the blocking checks/);
    }
    expect(STOP_SH).toContain('Loop cap: one block per violation set');
  });

  it('every check the section names is one the hook reads with _check_severity', () => {
    const hookIds = new Set([...COMMON_SH.matchAll(/_check_severity "([a-z-]+)"/g)].map((m) => m[1]));
    const labelled = Object.keys(ENFORCEMENT_CHECK_LABELS) as CheckId[];
    expect(labelled.length).toBeGreaterThan(0);
    for (const id of labelled) {
      expect(CHECK_IDS).toContain(id);
      expect(hookIds.has(id), `label for "${id}" has no _check_severity "${id}" in paradigm-common.sh`).toBe(true);
    }
    // and no hook check is left without a decision: labelled, or deliberately unnamed
    const unnamed = [...hookIds].filter((id) => !labelled.includes(id as CheckId));
    expect(unnamed).toEqual(['graduation-tracking']);
  });

  it('graduation tracking is not listed as something the hook warns on', () => {
    expect(at('strict')).not.toMatch(/graduation/i);
  });

  it('drift and the aspect advisory carry their roster condition; drift is aspect-anchor drift', () => {
    const strict = at('strict');
    expect(strict).toContain('drifted aspect anchors (compliance agent on the roster only)');
    expect(strict).toContain('aspects that may need new anchors (compliance agent on the roster only)');
    expect(strict).not.toContain('symbol drift');
    // the hook gates both emissions on the compliance claimant
    expect(COMMON_SH).toMatch(/HAS_COMPLIANCE_CLAIMANT" = "true" \] && \[ "\$_SEV" != "off" \] && \[ -n "\$DRIFTED_COUNT"/);
    expect(COMMON_SH).toMatch(/ASPECT_UPDATED" = false \] && \[ "\$HAS_COMPLIANCE_CLAIMANT" = "true" \]/);
  });

  it('lore and portal labels state the conditions the hook tests', () => {
    expect(ENFORCEMENT_CHECK_LABELS['lore-required']).toContain('3+ changed source files');
    expect(COMMON_SH).toContain('[ "$SOURCE_COUNT" -ge 3 ] && [ -d ".paradigm/lore" ]');
    expect(ENFORCEMENT_CHECK_LABELS['portal-gates']).toContain('no portal.yaml');
    expect(COMMON_SH).toContain('if [ -f "portal.yaml" ] || echo "$MODIFIED" | grep -q "portal.yaml"; then');
    expect(ENFORCEMENT_CHECK_LABELS['portal-compliance']).toContain('not declared in portal.yaml');
    expect(COMMON_SH).toContain('gate(s) used in code but not declared in portal.yaml');
  });
});

describe('enforcement claim across generated files', () => {
  it('CLAUDE.md for a default project does not claim the stop hook blocks on its checks', () => {
    const out = claudeAdapter.generate(filesAt());
    expect(out).toContain('## Automatic Enforcement (Hooks)');
    expect(out).toContain("This level's stop-hook checks are **off**");
    expect(out).not.toContain('The stop hook **BLOCKS**');
  });

  it('no adapter claims blocking for a default project', () => {
    for (const [, adapter] of adapters) {
      const out = adapter.generate(filesAt());
      expect(out).not.toMatch(/stop hook \*\*BLOCKS\*\*/i);
      expect(out).not.toContain('Blocks on:');
    }
  });

  it('the section sits in the cacheable head and does not change with volatile metadata', () => {
    const base = filesAt({ level: 'strict', checks: {}, orchestration: ORCH });
    const a = claudeAdapter.generate({ ...base, meta: { symbolCount: 1, generatedAt: '2026-01-01T00:00:00Z' } });
    const b = claudeAdapter.generate({ ...base, meta: { symbolCount: 999, generatedAt: '2027-06-01T00:00:00Z', currentArc: 'x' } });
    expect(ClaudeAdapter.headOf(a)).toContain('## Automatic Enforcement (Hooks)');
    expect(ClaudeAdapter.headOf(a)).toBe(ClaudeAdapter.headOf(b));
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
    expect(claudeAdapter.generate(files!)).toContain("This level's stop-hook checks are **off**");
  });

  it('reads a configured level and the generated CLAUDE.md says what blocks', () => {
    const files = loadParadigmFiles(project('version: "2.0"\nproject: demo\nenforcement:\n  level: strict\n'));
    expect(files?.enforcement?.level).toBe('strict');
    const out = claudeAdapter.generate(files!);
    expect(out).toContain('Enforcement level: `strict`');
    expect(out).toContain('Blocks on: ');
  });
});
