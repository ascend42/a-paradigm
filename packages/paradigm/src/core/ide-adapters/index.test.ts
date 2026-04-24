import { describe, it, expect, afterEach } from 'vitest';
import {
  adapters,
  getAdapter,
  getAdapterNames,
  detectIDE,
  loadParadigmFiles,
  syncToIDE,
} from './index.js';
import { createTempProject, createMockParadigmFiles } from '../../test-utils.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('adapter registry', () => {
  it('has all 5 adapters', () => {
    expect(adapters.size).toBe(5);
    expect(adapters.has('cursor')).toBe(true);
    expect(adapters.has('copilot')).toBe(true);
    expect(adapters.has('windsurf')).toBe(true);
    expect(adapters.has('claude')).toBe(true);
    expect(adapters.has('agents')).toBe(true);
  });
});

describe('getAdapter', () => {
  it('returns correct adapter by name', () => {
    const cursor = getAdapter('cursor');
    expect(cursor).toBeDefined();
    expect(cursor!.name).toBe('cursor');
  });

  it('is case-insensitive', () => {
    const cursor = getAdapter('Cursor');
    expect(cursor).toBeDefined();
    expect(cursor!.name).toBe('cursor');
  });

  it('returns undefined for unknown', () => {
    const result = getAdapter('nonexistent-ide');
    expect(result).toBeUndefined();
  });
});

describe('getAdapterNames', () => {
  it('returns all 5 names', () => {
    const names = getAdapterNames();
    expect(names).toHaveLength(5);
    expect(names).toContain('cursor');
    expect(names).toContain('copilot');
    expect(names).toContain('windsurf');
    expect(names).toContain('claude');
    expect(names).toContain('agents');
  });
});

describe('detectIDE', () => {
  it('finds Cursor (.cursor/ dir)', () => {
    const { rootDir, cleanup: c } = createTempProject({ withCursor: true });
    cleanup = c;
    const result = detectIDE(rootDir);
    expect(result.detected).toBe('cursor');
  });

  it('finds Windsurf (.windsurf/ dir)', () => {
    const { rootDir, cleanup: c } = createTempProject({ withWindsurf: true });
    cleanup = c;
    const result = detectIDE(rootDir);
    expect(result.detected).toBe('windsurf');
  });

  it('finds Copilot (.github/copilot-instructions.md)', () => {
    const { rootDir, cleanup: c } = createTempProject({ withCopilot: true });
    cleanup = c;
    const result = detectIDE(rootDir);
    // Copilot detection checks for .github/copilot-instructions.md OR .github/instructions/
    expect(result.detected).toBe('copilot');
  });

  it('falls back to cursor for .vscode/', () => {
    const { rootDir, cleanup: c } = createTempProject({ withVscode: true });
    cleanup = c;
    const result = detectIDE(rootDir);
    expect(result.detected).toBe('cursor');
    // Cursor adapter's detect() also matches .vscode/, so detectIDE reports 'high'
    expect(result.confidence).toBe('high');
  });

  it('returns null for empty dir', () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    const result = detectIDE(rootDir);
    expect(result.detected).toBeNull();
  });
});

describe('loadParadigmFiles', () => {
  it('loads valid .paradigm/ directory', () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    const files = loadParadigmFiles(rootDir);
    expect(files).not.toBeNull();
    expect(files!.config).toBeDefined();
    expect(files!.projectName).toBeDefined();
  });

  it('returns null for missing directory', () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    const result = loadParadigmFiles(rootDir + '-nonexistent');
    expect(result).toBeNull();
  });

  it('returns null for invalid YAML', () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    const fs = require('fs');
    const path = require('path');
    fs.writeFileSync(
      path.join(rootDir, '.paradigm', 'config.yaml'),
      '{{invalid yaml::: [',
      'utf8',
    );
    const result = loadParadigmFiles(rootDir);
    expect(result).toBeNull();
  });

  it('loads specs and docs when present', () => {
    const { rootDir, cleanup: c } = createTempProject({ withSpecs: true, withDocs: true });
    cleanup = c;
    const files = loadParadigmFiles(rootDir);
    expect(files).not.toBeNull();
    expect(files!.specs.logger).toBeDefined();
    expect(files!.specs.probe).toBeDefined();
    expect(files!.specs.symbols).toBeDefined();
    expect(files!.docs.commands).toBeDefined();
    expect(files!.docs.patterns).toBeDefined();
    expect(files!.docs.troubleshooting).toBeDefined();
  });
});

describe('syncToIDE', () => {
  it('returns error for unknown IDE', () => {
    const files = createMockParadigmFiles();
    const result = syncToIDE('/tmp', 'nonexistent', files);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown IDE');
  });
});
