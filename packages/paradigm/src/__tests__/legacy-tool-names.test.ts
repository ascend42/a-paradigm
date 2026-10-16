/**
 * 7.13.0 MCP surface cut — reference hygiene (T-2026-09-26-005).
 *
 * 1. Grep guard: no renamed legacy `paradigm_<family>_<op>` name may appear in
 *    the agent-facing surfaces the codemod owns (allowlist below).
 * 2. Codemod contract: forms + idempotency, driven by the real legacy map.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore — plain ESM script, no type declarations
import * as codemod from '../../../../scripts/migrate-tool-names.mjs';

const {
  REPO_ROOT, loadLegacyMap, rewritableEntries, legacyTokenRegex, rewriteText, listTargetFiles, EXCLUDE,
} = codemod as any;

const map = loadLegacyMap();
const renamed = rewritableEntries(map);

/**
 * Files under a codemod target that legitimately keep legacy names.
 * Anything else containing one fails the guard.
 */
const ALLOWLIST: Record<string, string> = {
  'packages/paradigm/src/core/habits/seed-habits.json':
    'habit `tools`/`contextTools` are matched against toolsCalled, which records CANONICAL LEGACY names',
};

describe('legacy tool-name grep guard', () => {
  it('the map is non-trivial and every renamed entry points at a different name or folds args', () => {
    expect(Object.keys(map).length).toBeGreaterThan(150);
    for (const [k, t] of Object.entries(renamed) as Array<[string, any]>) {
      expect(t.tool !== k || !!t.args).toBe(true);
    }
  });

  it('no agent-facing surface references a renamed legacy tool name', () => {
    const re = legacyTokenRegex(Object.keys(renamed));
    const offenders: string[] = [];
    for (const f of listTargetFiles(REPO_ROOT) as string[]) {
      if (ALLOWLIST[f]) continue;
      const text = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
      const found = new Set<string>();
      for (const m of text.matchAll(re)) found.add(m[1]);
      if (found.size) offenders.push(`${f}: ${[...found].join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('allowlisted files are excluded from rewriting by the codemod itself', () => {
    for (const f of Object.keys(ALLOWLIST)) {
      expect((EXCLUDE as RegExp[]).some(rx => rx.test(f))).toBe(true);
    }
  });

  it('historical records are never targets', () => {
    const files = listTargetFiles(REPO_ROOT) as string[];
    expect(files.some(f => /CHANGELOG|\/lore\/|docs\/(private|specs)\//.test(f))).toBe(false);
  });
});

describe('migrate-tool-names codemod', () => {
  const md = [
    'Call `paradigm_lore_record` after work.',
    'Then paradigm_task_create to track it.',
    'paradigm_lore_record({ type: "agent-session" })',
    'paradigm_session_recover()',
    'paradigm_habits_check({})',
    'paradigm_purpose_add_component({',
    '  name: "x",',
    '})',
    'allowed-tools: mcp__paradigm__paradigm_lore_record, mcp__paradigm__paradigm_lore_search, Read',
    'Workspace: `paradigm_workspace_reindex`',
    'Anchors stay: `paradigm_status`, paradigm_ripple({ symbol }) and `paradigm_tags`.',
    'Not a tool: paradigm_lore_recorder, xparadigm_lore_record.',
  ].join('\n');

  it('rewrites each form', () => {
    const { text } = rewriteText(md, '.md', map);
    expect(text).toContain('Call `paradigm_lore` (op `record`) after work.');
    expect(text).toContain('Then paradigm_task (op `create`) to track it.');
    expect(text).toContain(`paradigm_lore({op:'record', type: "agent-session" })`);
    expect(text).toContain(`paradigm_session({op:'recover'})`);
    expect(text).toContain(`paradigm_habits({op:'check'})`);
    expect(text).toContain(`paradigm_purpose({op:'add_component',\n  name: "x",`);
    expect(text).toContain('allowed-tools: mcp__paradigm__paradigm_lore, Read');
    expect(text).toContain('`paradigm_reindex` (scope `workspace`)');
    expect(text).toContain('Anchors stay: `paradigm_status`, paradigm_ripple({ symbol }) and `paradigm_tags`.');
    expect(text).toContain('paradigm_lore_recorder, xparadigm_lore_record');
  });

  it('uses shell/TS-safe phrasing in code files', () => {
    const sh = `echo "  5. paradigm_lore_record — record"\nX="call paradigm_session_recover() first"`;
    const { text } = rewriteText(sh, '.sh', map);
    expect(text).toContain('paradigm_lore (op: record) — record');
    expect(text).toContain(`paradigm_session({op:'recover'}) first`);
    const ts = `const a = 'Run paradigm_pm_postflight({ x })';\nconst b = \`see \\\`paradigm_lore_search\\\`\`;`;
    const out = rewriteText(ts, '.ts', map).text;
    expect(out).toContain(`'Run paradigm_pm({op:"postflight", x })'`);
    expect(out).toContain('\\`paradigm_lore\\` (op \\`search\\`)');
  });

  it('is idempotent', () => {
    for (const [src, ext] of [[md, '.md'], ['echo "paradigm_lore_record()"', '.sh']] as const) {
      const once = rewriteText(src, ext, map);
      const twice = rewriteText(once.text, ext, map);
      expect(once.count).toBeGreaterThan(0);
      expect(twice.count).toBe(0);
      expect(twice.text).toBe(once.text);
    }
  });

  it('is idempotent over every real target file', () => {
    for (const f of listTargetFiles(REPO_ROOT) as string[]) {
      if (ALLOWLIST[f]) continue;
      const text = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
      expect(rewriteText(text, path.extname(f), map).count, f).toBe(0);
    }
  });
});
