import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
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
    const { rootDir, cleanup: c } = createTempProject({ withPurpose: true });
    cleanup = c;
    // Create source dirs, all covered by root .purpose
    fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'src', 'main.ts'), '// code', 'utf8');
    const results = await runContextAudit(rootDir, { quiet: true });
    const check = findCheck(results, 'purpose-coverage');
    expect(check).toBeDefined();
    expect(check!.status).toBe('ok');
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
// Integration: runContextAudit returns all 7 checks
// ---------------------------------------------------------------------------

describe('runContextAudit', () => {
  it('returns results for all 7 checks', async () => {
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
  });
});
