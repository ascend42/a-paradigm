import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { runContextAudit, type ContextAuditResult } from './context-audit.js';
import { createTempProject } from '../../test-utils.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

/** Suppress logger output during tests */
function suppressOutput(): void {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

function findCheck(results: ContextAuditResult[], check: string): ContextAuditResult | undefined {
  return results.find((r) => r.check === check);
}

// ---------------------------------------------------------------------------
// Check 1: stale-references
// ---------------------------------------------------------------------------

describe('stale-references', () => {
  it('reports dead paths in CLAUDE.md', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.writeFileSync(
      path.join(rootDir, 'CLAUDE.md'),
      'Check `.paradigm/config.yaml` and `src/nonexistent/file.ts` for details.',
      'utf8',
    );
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'stale-references');
    expect(check).toBeDefined();
    expect(check!.status).toBe('error');
    expect(check!.details).toBeDefined();
    expect(check!.details!.some((d) => d.includes('nonexistent'))).toBe(true);
  });

  it('reports ok when all paths exist', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.writeFileSync(
      path.join(rootDir, 'CLAUDE.md'),
      'Check `.paradigm/config.yaml` for details.',
      'utf8',
    );
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'stale-references');
    expect(check).toBeDefined();
    expect(check!.status).toBe('ok');
  });

  it('reports advisory when no instruction files exist', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'stale-references');
    expect(check).toBeDefined();
    expect(check!.status).toBe('advisory');
  });
});

// ---------------------------------------------------------------------------
// Check 2: convention-contradictions
// ---------------------------------------------------------------------------

describe('convention-contradictions', () => {
  it('detects conflicting naming conventions in same scope', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.writeFileSync(
      path.join(rootDir, 'CLAUDE.md'),
      [
        'Use camelCase for file naming.',
        'Use kebab-case for file naming.',
      ].join('\n'),
      'utf8',
    );
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'convention-contradictions');
    expect(check).toBeDefined();
    expect(check!.status).toBe('warn');
  });

  it('reports ok when no contradictions', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.writeFileSync(
      path.join(rootDir, 'CLAUDE.md'),
      'Use kebab-case for file names.',
      'utf8',
    );
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'convention-contradictions');
    expect(check).toBeDefined();
    expect(check!.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Check 3: undocumented-stack
// ---------------------------------------------------------------------------

describe('undocumented-stack', () => {
  it('detects dependencies not mentioned in instruction files', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.writeFileSync(
      path.join(rootDir, 'package.json'),
      JSON.stringify({
        dependencies: { express: '^4.18.0', 'some-obscure-lib': '^1.0.0' },
        devDependencies: { typescript: '^5.0.0' },
      }),
      'utf8',
    );
    fs.writeFileSync(path.join(rootDir, 'CLAUDE.md'), 'This project uses express.', 'utf8');
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'undocumented-stack');
    expect(check).toBeDefined();
    expect(check!.status).toBe('advisory');
    expect(check!.details).toBeDefined();
    expect(check!.details!.includes('some-obscure-lib')).toBe(true);
    // express should NOT be in the undocumented list
    expect(check!.details!.includes('express')).toBe(false);
  });

  it('reports ok when no package.json', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'undocumented-stack');
    expect(check).toBeDefined();
    expect(check!.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Check 4: purpose-coverage
// ---------------------------------------------------------------------------

describe('purpose-coverage', () => {
  it('warns when purpose coverage is below 80%', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    // Create multiple source dirs without .purpose
    for (const dir of ['src/a', 'src/b', 'src/c', 'src/d', 'src/e']) {
      fs.mkdirSync(path.join(rootDir, dir), { recursive: true });
      fs.writeFileSync(path.join(rootDir, dir, 'index.ts'), '// code', 'utf8');
    }
    // Only 1 has purpose
    fs.writeFileSync(path.join(rootDir, 'src/a', '.purpose'), 'version: 2.0.0', 'utf8');
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'purpose-coverage');
    expect(check).toBeDefined();
    expect(check!.status).toBe('warn');
    expect(check!.message).toContain('below 80%');
  });

  it('reports ok when coverage is at or above 80%', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject({
      withPurpose: true,
      purposeContent: 'description: The test project, with its source under src.\ncomponents:\n  test-app:\n    description: The app entry point.\n    path: src\n',
    });
    cleanup = c;
    // Create source dirs, all documented by the root .purpose (path: src)
    fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'src', 'main.ts'), '// code', 'utf8');
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'purpose-coverage');
    expect(check).toBeDefined();
    expect(check!.status).toBe('ok');
  });

  it('an ancestor that does not document a dir, or a placeholder stub, is not coverage', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject({ withPurpose: true });
    cleanup = c;
    // Root .purpose (from createTempProject) names no paths; src/b has a Cid stub.
    for (const dir of ['src/a', 'src/b']) {
      fs.mkdirSync(path.join(rootDir, dir), { recursive: true });
      fs.writeFileSync(path.join(rootDir, dir, 'index.ts'), '// code', 'utf8');
    }
    fs.writeFileSync(
      path.join(rootDir, 'src/b', '.purpose'),
      '# Auto-generated .purpose stub — update with real descriptions\ncomponents:\n  b:\n    description: "TODO: describe this component"\n',
      'utf8',
    );
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'purpose-coverage');
    expect(check!.status).toBe('warn');
    expect(check!.message).toContain('(0/2 ');
  });

  it('never counts release or gitignored output as source directories', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'src', 'main.ts'), '// code', 'utf8');
    fs.writeFileSync(
      path.join(rootDir, 'src', '.purpose'),
      'description: The application source and its entry point main.ts.\n',
      'utf8',
    );
    // Uncovered build output: would drag coverage to 1/3 if counted.
    for (const rel of ['pkg/release/App.app/Contents/Resources', 'pkg/out-x']) {
      fs.mkdirSync(path.join(rootDir, rel), { recursive: true });
      fs.writeFileSync(path.join(rootDir, rel, 'bundle.js'), '// built', 'utf8');
    }
    const hasGit = spawnSync('git', ['--version']).status === 0;
    if (hasGit) {
      spawnSync('git', ['init', '-q'], { cwd: rootDir });
      fs.writeFileSync(path.join(rootDir, '.gitignore'), 'pkg/release/\nout-*/\n', 'utf8');
    }
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'purpose-coverage');
    // Without git only release/ is skipped by name; out-x stays a source dir.
    expect(check!.message).toContain(hasGit ? '(1/1 ' : '(1/2 ');
  });
});

// ---------------------------------------------------------------------------
// Check 5: orphaned-symbols
// ---------------------------------------------------------------------------

describe('orphaned-symbols', () => {
  it('detects symbols with zero cross-references', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject({
      withScanIndex: true,
      scanIndexContent: JSON.stringify({
        $meta: { generatedAt: new Date().toISOString() },
        components: {
          'lonely-component': {
            id: 'lonely-component',
            symbol: '#lonely-component',
            path: '/test/.purpose',
            related: [],
          },
          'connected-a': {
            id: 'connected-a',
            symbol: '#connected-a',
            path: '/test/.purpose',
            related: ['#connected-b'],
          },
          'connected-b': {
            id: 'connected-b',
            symbol: '#connected-b',
            path: '/test/.purpose',
            related: ['#connected-a'],
          },
        },
      }),
    });
    cleanup = c;
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'orphaned-symbols');
    expect(check).toBeDefined();
    expect(check!.status).toBe('advisory');
    expect(check!.details).toBeDefined();
    expect(check!.details!.includes('#lonely-component')).toBe(true);
  });

  it('reports advisory when no scan index', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'orphaned-symbols');
    expect(check).toBeDefined();
    expect(check!.status).toBe('advisory');
  });
});

// ---------------------------------------------------------------------------
// Check 6: stale-portal
// ---------------------------------------------------------------------------

describe('stale-portal', () => {
  it('detects portal routes with no matching implementation', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    // Create portal.yaml with a route that has no matching file
    fs.writeFileSync(
      path.join(rootDir, 'portal.yaml'),
      [
        'version: "1.0"',
        'gates:',
        '  ^authenticated:',
        '    description: Must be logged in',
        'routes:',
        '  "GET /api/widgets/:id": [^authenticated]',
      ].join('\n'),
      'utf8',
    );
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'stale-portal');
    expect(check).toBeDefined();
    expect(check!.status).toBe('error');
    expect(check!.details!.some((d) => d.includes('widgets'))).toBe(true);
  });

  it('reports ok when route has matching file', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    // Create portal.yaml and matching route file
    fs.writeFileSync(
      path.join(rootDir, 'portal.yaml'),
      [
        'version: "1.0"',
        'gates:',
        '  ^authenticated:',
        '    description: Must be logged in',
        'routes:',
        '  "GET /api/projects/:id": [^authenticated]',
      ].join('\n'),
      'utf8',
    );
    fs.mkdirSync(path.join(rootDir, 'src', 'routes'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'src', 'routes', 'projects.ts'), '// route', 'utf8');
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'stale-portal');
    expect(check).toBeDefined();
    expect(check!.status).toBe('ok');
  });

  it('reports ok when no portal.yaml', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'stale-portal');
    expect(check).toBeDefined();
    expect(check!.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Check 7: instruction-vagueness
// ---------------------------------------------------------------------------

describe('instruction-vagueness', () => {
  it('detects vague phrases in instruction files', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.writeFileSync(
      path.join(rootDir, 'CLAUDE.md'),
      [
        '# Instructions',
        'You might want to use the logger.',
        'Try to follow the existing patterns.',
        'Consider using chalk for output.',
      ].join('\n'),
      'utf8',
    );
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'instruction-vagueness');
    expect(check).toBeDefined();
    expect(check!.status).toBe('advisory');
    expect(check!.details!.length).toBeGreaterThanOrEqual(3);
  });

  it('reports ok when no vague language found', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.writeFileSync(
      path.join(rootDir, 'CLAUDE.md'),
      [
        '# Instructions',
        'Use the Paradigm logger for all output.',
        'Follow kebab-case for file names.',
      ].join('\n'),
      'utf8',
    );
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'instruction-vagueness');
    expect(check).toBeDefined();
    expect(check!.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Integration: runContextAudit returns every check
// ---------------------------------------------------------------------------

describe('runContextAudit', () => {
  it('returns results for every check', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject({ withScanIndex: true });
    cleanup = c;
    const results = await runContextAudit(rootDir, { quiet: true });
    const checks = results.map((r) => r.check);
    expect(checks).toContain('stale-references');
    expect(checks).toContain('convention-contradictions');
    expect(checks).toContain('undocumented-stack');
    expect(checks).toContain('purpose-coverage');
    expect(checks).toContain('orphaned-symbols');
    expect(checks).toContain('stale-portal');
    expect(checks).toContain('instruction-vagueness');
    expect(checks).toContain('always-on-budget');
  });
});

// ---------------------------------------------------------------------------
// Check 10: always-on-budget (advisory)
// ---------------------------------------------------------------------------

describe('always-on-budget', () => {
  function setup(): { rootDir: string; home: string } {
    const { rootDir, cleanup: c } = createTempProject();
    const home = fs.mkdtempSync(path.join(rootDir, '..', 'aob-home-'));
    cleanup = () => { c(); fs.rmSync(home, { recursive: true, force: true }); };
    return { rootDir, home };
  }
  const budgetResults = (results: ContextAuditResult[]) => results.filter((r) => r.check === 'always-on-budget');

  it('reports per-surface chars and estimated tokens, ok under the default cap', async () => {
    suppressOutput();
    const { rootDir, home } = setup();
    fs.writeFileSync(path.join(rootDir, 'CLAUDE.md'), 'x'.repeat(400), 'utf8');
    const results = budgetResults(await runContextAudit(rootDir, { quiet: true, homeDir: home }));
    const claude = results.find((r) => r.message.startsWith('claude-code'));
    expect(claude?.status).toBe('ok');
    expect(claude?.message).toContain('400 chars (~100 tokens est.)');
    expect(claude?.details?.[0]).toContain('CLAUDE.md');
    expect(results.some((r) => r.status === 'warn' || r.status === 'error')).toBe(false);
  });

  it('is advisory (never warn or error) over the configured cap and counts only Paradigm text', async () => {
    suppressOutput();
    const { rootDir, home } = setup();
    fs.appendFileSync(path.join(rootDir, '.paradigm', 'config.yaml'), '\ncontext:\n  always-on-max-chars: 100\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'CLAUDE.md'), 'x'.repeat(150), 'utf8');
    // User-owned always-on text is census only, even when huge.
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'y'.repeat(50000), 'utf8');
    const results = budgetResults(await runContextAudit(rootDir, { quiet: true, homeDir: home }));
    const claude = results.find((r) => r.message.startsWith('claude-code'));
    expect(claude?.status).toBe('advisory');
    expect(claude?.message).toContain('150 chars');
    expect(claude?.message).toContain('over the 100-char cap');
    const census = results.find((r) => r.message.startsWith('census'));
    expect(census?.status).toBe('ok');
    expect(census?.details?.some((d) => d.includes('~/.claude/CLAUDE.md') && d.includes('50,000'))).toBe(true);
    // B1: over the cap never counts against doctor/shift health.
    expect(results.some((r) => r.status === 'error' || r.status === 'warn')).toBe(false);
  });

  it('counts alwaysApply paradigm rules and skill descriptions on their surfaces', async () => {
    suppressOutput();
    const { rootDir, home } = setup();
    const rules = path.join(rootDir, '.cursor', 'rules');
    fs.mkdirSync(rules, { recursive: true });
    fs.writeFileSync(path.join(rules, 'paradigm-core.mdc'), '---\ndescription: core\nalwaysApply: true\n---\nbody', 'utf8');
    fs.writeFileSync(path.join(rules, 'paradigm-cmds.mdc'), '---\ndescription: cmds\nalwaysApply: false\n---\nbody', 'utf8');
    const skill = path.join(rootDir, '.claude', 'skills', 'pdg-demo');
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: pdg-demo\ndescription: Do the demo. Use when the user asks.\n---\nbody', 'utf8');
    const results = budgetResults(await runContextAudit(rootDir, { quiet: true, homeDir: home }));
    const cursor = results.find((r) => r.message.startsWith('cursor'));
    expect(cursor?.details).toHaveLength(1);
    expect(cursor?.details?.[0]).toContain('paradigm-core.mdc');
    const claude = results.find((r) => r.message.startsWith('claude-code'));
    expect(claude?.details?.[0]).toContain('pdg-* descriptions');
    expect(claude?.details?.[0]).toContain('1 skill');
    expect(claude?.message).toContain(`${'Do the demo. Use when the user asks.'.length} chars`);
  });
});

// ---------------------------------------------------------------------------
// Check 11: warpline-guidance (advisory, T-2026-11-12-001)
// ---------------------------------------------------------------------------

describe('warpline-guidance', () => {
  const wl = (results: ContextAuditResult[]) => results.filter((r) => r.check === 'warpline-guidance');

  it('is silent when the project does not use Warpline', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.writeFileSync(path.join(rootDir, 'CLAUDE.md'), '# plain\n', 'utf8');
    expect(wl(await runContextAudit(rootDir, { quiet: true }))).toHaveLength(0);
  });

  it('fires an advisory naming each generated file that lacks the block', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.mkdirSync(path.join(rootDir, '.warpline'));
    fs.writeFileSync(path.join(rootDir, 'CLAUDE.md'), '# no block\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'AGENTS.md'), '# x\n<!-- warpline:begin -->\nhi\n<!-- warpline:end -->\n', 'utf8');
    const [r] = wl(await runContextAudit(rootDir, { quiet: true }));
    expect(r.status).toBe('advisory');
    expect(r.details).toEqual(['CLAUDE.md']);
    expect(r.fix).toBe('Run `paradigm sync` if Paradigm generates these files, or `warpline init` to add only the block');
  });

  it('reports malformed markers (two blocks), ignores inline/fenced mentions, and survives a CLAUDE.md directory', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.mkdirSync(path.join(rootDir, '.warpline'));
    const blk = '<!-- warpline:begin -->\nhi\n<!-- warpline:end -->\n';
    fs.writeFileSync(path.join(rootDir, 'AGENTS.md'), blk + blk, 'utf8');
    fs.mkdirSync(path.join(rootDir, 'CLAUDE.md'));
    let results = wl(await runContextAudit(rootDir, { quiet: true }));
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('advisory');
    expect(results[0].details).toEqual(['AGENTS.md: 2 Warpline blocks']);
    fs.writeFileSync(path.join(rootDir, 'AGENTS.md'), 'Uses `<!-- warpline:begin -->`.\n```\n' + blk + '```\n', 'utf8');
    results = wl(await runContextAudit(rootDir, { quiet: true }));
    expect(results[0].details).toEqual(['AGENTS.md']);
  });

  it('is ok once the block is present, and silent when guidance is off', async () => {
    suppressOutput();
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    fs.mkdirSync(path.join(rootDir, '.warpline'));
    fs.writeFileSync(path.join(rootDir, 'CLAUDE.md'), '<!-- warpline:begin -->\nhi\n<!-- warpline:end -->\n', 'utf8');
    expect(wl(await runContextAudit(rootDir, { quiet: true }))[0]?.status).toBe('ok');
    fs.writeFileSync(path.join(rootDir, 'CLAUDE.md'), '# none\n', 'utf8');
    fs.appendFileSync(path.join(rootDir, '.paradigm', 'config.yaml'), '\nintegrations:\n  warpline:\n    guidance: off\n', 'utf8');
    expect(wl(await runContextAudit(rootDir, { quiet: true }))).toHaveLength(0);
  });
});
