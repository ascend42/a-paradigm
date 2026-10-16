import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { auditLegacyToolNames, describeReplacement, describePermissionReplacement, renamedLegacyEntries } from './legacy-names-audit.js';

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-legacy-names-'));
  dirs.push(d);
  return d;
}

describe('auditLegacyToolNames', () => {
  it('flags legacy names in CLAUDE.md, AGENTS.md, .cursor/rules and settings permissions', () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'Call `paradigm_lore_record` twice: paradigm_lore_record({})\nand `paradigm_status`.');
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Use paradigm_task_create.');
    fs.mkdirSync(path.join(root, '.cursor', 'rules', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cursor', 'rules', 'nested', 'x.mdc'), 'paradigm_session_recover()');
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({
      permissions: { allow: ['mcp__paradigm__paradigm_lore_record', 'mcp__paradigm__paradigm_status', 'Bash(git *)'] },
      // Non-permission keys are ignored
      env: { NOTE: 'paradigm_wisdom_record' },
    }));

    const { hits, filesScanned } = auditLegacyToolNames(root);
    expect(filesScanned).toBe(4);
    const byFile = (f: string) => hits.filter(h => h.file === f);

    expect(byFile('CLAUDE.md')).toEqual([
      expect.objectContaining({ legacy: 'paradigm_lore_record', count: 2, permission: false, replacement: "paradigm_lore({op:'record'})" }),
    ]);
    expect(byFile('AGENTS.md').map(h => h.legacy)).toEqual(['paradigm_task_create']);
    expect(byFile(path.join('.cursor', 'rules', 'nested', 'x.mdc')).map(h => h.legacy)).toEqual(['paradigm_session_recover']);
    const perm = byFile(path.join('.claude', 'settings.json'));
    expect(perm).toEqual([
      expect.objectContaining({ legacy: 'paradigm_lore_record', permission: true, replacement: 'mcp__paradigm__paradigm_lore' }),
    ]);
    // anchors are never flagged
    expect(hits.some(h => h.legacy === 'paradigm_status')).toBe(false);
  });

  it('suggests the allowlist form for permission hits, preserving the server prefix', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({
      permissions: {
        allow: ['mcp__plugin_paradigm_paradigm__paradigm_task_create'],
        deny: ['mcp__paradigm__paradigm_workspace_reindex'],
        ask: ['paradigm_lore_delete'],
      },
    }));
    const byLegacy = Object.fromEntries(auditLegacyToolNames(root).hits.map(h => [h.legacy, h.replacement]));
    expect(byLegacy).toEqual({
      paradigm_task_create: 'mcp__plugin_paradigm_paradigm__paradigm_task',
      // folded anchor: args dropped — permissions match tool names only
      paradigm_workspace_reindex: 'mcp__paradigm__paradigm_reindex',
      // bare name: default prefix
      paradigm_lore_delete: 'mcp__paradigm__paradigm_lore',
    });
    for (const r of Object.values(byLegacy)) expect(r).not.toMatch(/[({]/);
    expect(describePermissionReplacement(renamedLegacyEntries().paradigm_lore_record)).toBe('mcp__paradigm__paradigm_lore');
  });

  it('reports nothing for a clean project', () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), "Call paradigm_lore({op:'record'}) and `paradigm_status`.");
    expect(auditLegacyToolNames(root)).toEqual({ hits: [], filesScanned: 1 });
  });

  it('describes folded anchors with their fixed args', () => {
    const e = renamedLegacyEntries();
    expect(describeReplacement(e.paradigm_workspace_reindex)).toBe("paradigm_reindex({scope:'workspace'})");
    expect(e.paradigm_status).toBeUndefined();
  });
});
