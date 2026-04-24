/**
 * Test utilities for Paradigm CLI tests
 * Provides temp project scaffolding with configurable fixtures
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { getDefaultParadigmConfig, type ParadigmConfig } from './core/paradigm-config.js';

export interface TempProjectOptions {
  config?: Partial<ParadigmConfig>;
  withGit?: boolean;
  withCursor?: boolean;
  withVscode?: boolean;
  withWindsurf?: boolean;
  withPurpose?: boolean;
  purposeContent?: string;
  withClaude?: boolean;
  withAgents?: boolean;
  withCopilot?: boolean;
  withSpecs?: boolean;
  withDocs?: boolean;
  withScanIndex?: boolean;
  scanIndexContent?: string;
}

export interface TempProject {
  rootDir: string;
  cleanup: () => void;
}

/**
 * Create a temporary Paradigm project for testing.
 * Returns the root directory and a cleanup function.
 */
export function createTempProject(options: TempProjectOptions = {}): TempProject {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-test-'));

  // Create .paradigm directory with config
  const paradigmDir = path.join(rootDir, '.paradigm');
  fs.mkdirSync(paradigmDir, { recursive: true });

  const defaultConfig = getDefaultParadigmConfig('test-project');
  const config = options.config
    ? { ...defaultConfig, ...options.config }
    : defaultConfig;

  fs.writeFileSync(
    path.join(paradigmDir, 'config.yaml'),
    yaml.dump(config, { lineWidth: -1, quotingType: '"' }),
    'utf8',
  );

  // Optional .git directory
  if (options.withGit) {
    fs.mkdirSync(path.join(rootDir, '.git', 'hooks'), { recursive: true });
  }

  // Optional IDE directories
  if (options.withCursor) {
    fs.mkdirSync(path.join(rootDir, '.cursor'), { recursive: true });
  }

  if (options.withVscode) {
    fs.mkdirSync(path.join(rootDir, '.vscode'), { recursive: true });
  }

  if (options.withWindsurf) {
    fs.writeFileSync(path.join(rootDir, '.windsurfrules'), '', 'utf8');
  }

  if (options.withClaude) {
    fs.writeFileSync(path.join(rootDir, 'CLAUDE.md'), '', 'utf8');
  }

  if (options.withAgents) {
    fs.writeFileSync(path.join(rootDir, 'AGENTS.md'), '', 'utf8');
  }

  if (options.withCopilot) {
    fs.mkdirSync(path.join(rootDir, '.github', 'instructions'), { recursive: true });
  }

  // Optional .purpose file
  if (options.withPurpose) {
    const purposeContent = options.purposeContent || yaml.dump({
      name: 'test-project',
      description: 'A test project',
      components: [{ id: 'test-component', description: 'A test component' }],
    });
    fs.writeFileSync(path.join(rootDir, '.purpose'), purposeContent, 'utf8');
  }

  // Optional specs directory
  if (options.withSpecs) {
    const specsDir = path.join(paradigmDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'logger.md'), '# Logger Spec', 'utf8');
    fs.writeFileSync(path.join(specsDir, 'probe.md'), '# Probe Spec', 'utf8');
    fs.writeFileSync(path.join(specsDir, 'symbols.md'), '# Symbols Spec', 'utf8');
  }

  // Optional docs directory
  if (options.withDocs) {
    const docsDir = path.join(paradigmDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'commands.md'), '# Commands', 'utf8');
    fs.writeFileSync(path.join(docsDir, 'patterns.md'), '# Patterns', 'utf8');
    fs.writeFileSync(path.join(docsDir, 'troubleshooting.md'), '# Troubleshooting', 'utf8');
  }

  // Optional scan index
  if (options.withScanIndex) {
    const scanContent = options.scanIndexContent || JSON.stringify({
      $meta: {
        generatedAt: new Date().toISOString(),
        project: 'test-project',
      },
      components: {},
      features: {},
      flows: {},
      state: {},
      gates: {},
      signals: {},
    });
    fs.writeFileSync(path.join(paradigmDir, 'scan-index.json'), scanContent, 'utf8');
  }

  return {
    rootDir,
    cleanup: () => {
      fs.rmSync(rootDir, { recursive: true, force: true });
    },
  };
}

/**
 * Create a minimal ParadigmFiles object for testing adapter generation
 */
export function createMockParadigmFiles(overrides?: {
  projectName?: string;
  config?: Partial<ParadigmConfig>;
}) {
  const defaultConfig = getDefaultParadigmConfig(overrides?.projectName || 'test-project');
  return {
    config: overrides?.config
      ? { ...defaultConfig, ...overrides.config }
      : defaultConfig,
    specs: {},
    docs: {},
    projectName: overrides?.projectName || 'test-project',
  };
}
