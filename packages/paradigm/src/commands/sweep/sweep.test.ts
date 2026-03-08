import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { sweepCommand } from './index.js';
import { createTempProject } from '../../test-utils.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

/**
 * Helper to create a temp project with sweep-relevant fixtures.
 */
function createSweepProject(opts: {
  symbols?: Record<string, { id: string; symbol: string; category: string; path: string; description?: string; related?: string[] }>;
  signals?: Record<string, { id: string; symbol: string; category: string; path: string; description?: string }>;
  flows?: Record<string, { id: string; steps: Array<{ id: string; action: string; symbol?: string }>; definedIn: string }>;
  gates?: Record<string, { id: string; symbol: string; category: string; path: string; description?: string }>;
  portal?: Record<string, unknown>;
  purposeFiles?: Array<{ relPath: string; content: string }>;
  codeFiles?: Array<{ relPath: string; content: string }>;
  tags?: Record<string, unknown>;
  loreEntries?: Array<{ date: string; filename: string; content: Record<string, unknown> }>;
} = {}) {
  const { rootDir, cleanup: c } = createTempProject({
    withPurpose: true,
    withScanIndex: true,
    scanIndexContent: JSON.stringify({
      $meta: {
        generatedAt: new Date().toISOString(),
        project: 'test-sweep',
        sources: { purposeFiles: 1 },
      },
      components: opts.symbols || {},
      features: {},
      flows: {},
      state: {},
      gates: opts.gates || {},
      signals: opts.signals || {},
      aspects: {},
      screens: {},
      symbolMap: {},
    }),
  });
  cleanup = c;

  // Write flow index if provided
  if (opts.flows) {
    fs.writeFileSync(
      path.join(rootDir, '.paradigm', 'flow-index.json'),
      JSON.stringify({ version: '1.0', flows: opts.flows, symbolToFlows: {} }),
      'utf8',
    );
  }

  // Write portal.yaml if provided
  if (opts.portal) {
    fs.writeFileSync(path.join(rootDir, 'portal.yaml'), yaml.dump(opts.portal), 'utf8');
  }

  // Write additional .purpose files
  if (opts.purposeFiles) {
    for (const pf of opts.purposeFiles) {
      const fullPath = path.join(rootDir, pf.relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, pf.content, 'utf8');
    }
  }

  // Write code files
  if (opts.codeFiles) {
    for (const cf of opts.codeFiles) {
      const fullPath = path.join(rootDir, cf.relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, cf.content, 'utf8');
    }
  }

  // Write tags.yaml
  if (opts.tags) {
    fs.writeFileSync(
      path.join(rootDir, '.paradigm', 'tags.yaml'),
      yaml.dump({ version: '1.0', ...opts.tags }),
      'utf8',
    );
  }

  // Write lore entries
  if (opts.loreEntries) {
    for (const entry of opts.loreEntries) {
      const dirPath = path.join(rootDir, '.paradigm', 'lore', 'entries', entry.date);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(
        path.join(dirPath, entry.filename),
        yaml.dump(entry.content),
        'utf8',
      );
    }
  }

  return rootDir;
}

describe('sweepCommand', () => {
  it('runs without errors on an empty project', async () => {
    const rootDir = createSweepProject();
    // Should not throw
    await sweepCommand({ quiet: true, rootDir, dry: true });
  });

  it('detects orphaned symbols (0 cross-references)', async () => {
    const rootDir = createSweepProject({
      symbols: {
        'lonely-comp': {
          id: 'lonely-comp',
          symbol: '#lonely-comp',
          category: 'components',
          path: path.join('src', '.purpose'),
          description: 'A lonely component',
        },
      },
      purposeFiles: [
        {
          relPath: 'src/.purpose',
          content: '#lonely-comp:\n  description: A lonely component\n  tags: [feature]\n',
        },
      ],
    });

    // Suppress console output
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // Run in dry mode so we can check the report
    await sweepCommand({ quiet: true, rootDir, dry: true });
    // The command itself should run — we verify by checking it does not throw
  });

  it('detects stale .purpose files (code newer by >14 days)', async () => {
    const rootDir = createSweepProject({
      codeFiles: [
        { relPath: 'src/app.ts', content: 'export const app = true;\n' },
      ],
      purposeFiles: [
        { relPath: 'src/.purpose', content: '#app:\n  description: App\n' },
      ],
    });

    // Set .purpose mtime to 20 days ago
    const purposePath = path.join(rootDir, 'src', '.purpose');
    const past = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    fs.utimesSync(purposePath, past, past);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Fix mode: should add stale-since marker
    await sweepCommand({ quiet: true, rootDir });

    const content = fs.readFileSync(purposePath, 'utf8');
    expect(content).toContain('# stale-since:');
  });

  it('skips phantom gates check when no portal.yaml', async () => {
    const rootDir = createSweepProject();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Should not throw
    await sweepCommand({ quiet: true, rootDir, dry: true });
  });

  it('detects broken flow steps referencing non-existent symbols', async () => {
    const rootDir = createSweepProject({
      flows: {
        '$test-flow': {
          id: '$test-flow',
          steps: [
            { id: 'step-1', action: 'Do something', symbol: '#nonexistent-component' },
          ],
          definedIn: '.purpose',
        },
      },
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Fix mode: should add broken comment
    await sweepCommand({ quiet: true, rootDir });

    const content = fs.readFileSync(path.join(rootDir, '.purpose'), 'utf8');
    expect(content).toContain('# broken: #nonexistent-component not found');
  });

  it('detects lore entries with dead symbol references', async () => {
    const rootDir = createSweepProject({
      loreEntries: [
        {
          date: '2026-01-01',
          filename: 'L-2026-01-01-001.yaml',
          content: {
            id: 'L-2026-01-01-001',
            type: 'human-note',
            timestamp: '2026-01-01T00:00:00Z',
            author: 'test',
            title: 'Test entry',
            summary: 'A test lore entry',
            symbols_touched: ['#deleted-component'],
            tags: [],
          },
        },
      ],
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sweepCommand({ quiet: true, rootDir });

    // Should add 'stale' tag
    const lorePath = path.join(rootDir, '.paradigm', 'lore', 'entries', '2026-01-01', 'L-2026-01-01-001.yaml');
    const content = yaml.load(fs.readFileSync(lorePath, 'utf8')) as Record<string, unknown>;
    expect(content.tags).toContain('stale');
  });

  it('detects tag orphans (tags in bank never used)', async () => {
    const rootDir = createSweepProject({
      tags: {
        core: {
          'unused-tag': { description: 'A tag nobody uses', 'applies-to': ['#'] },
          'feature': { description: 'Feature tag', 'applies-to': ['#'] },
        },
        project: {},
      },
      purposeFiles: [
        { relPath: 'src/.purpose', content: '#comp:\n  description: A component\n  tags: [feature]\n' },
      ],
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sweepCommand({ quiet: true, rootDir });

    // Should remove unused-tag from tags.yaml
    const tagsContent = yaml.load(
      fs.readFileSync(path.join(rootDir, '.paradigm', 'tags.yaml'), 'utf8'),
    ) as Record<string, Record<string, unknown>>;
    expect(tagsContent.core).not.toHaveProperty('unused-tag');
    expect(tagsContent.core).toHaveProperty('feature');
  });

  it('dry mode does not modify files', async () => {
    const rootDir = createSweepProject({
      loreEntries: [
        {
          date: '2026-01-01',
          filename: 'L-2026-01-01-001.yaml',
          content: {
            id: 'L-2026-01-01-001',
            type: 'human-note',
            timestamp: '2026-01-01T00:00:00Z',
            author: 'test',
            title: 'Test',
            summary: 'Test',
            symbols_touched: ['#deleted-component'],
            tags: [],
          },
        },
      ],
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sweepCommand({ quiet: true, rootDir, dry: true });

    // Lore entry should NOT have stale tag in dry mode
    const lorePath = path.join(rootDir, '.paradigm', 'lore', 'entries', '2026-01-01', 'L-2026-01-01-001.yaml');
    const content = yaml.load(fs.readFileSync(lorePath, 'utf8')) as Record<string, unknown>;
    expect(content.tags).not.toContain('stale');
  });

  it('reports healthy when no entropy found', async () => {
    const rootDir = createSweepProject();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Should complete without errors
    await sweepCommand({ quiet: true, rootDir, dry: true });
  });
});
