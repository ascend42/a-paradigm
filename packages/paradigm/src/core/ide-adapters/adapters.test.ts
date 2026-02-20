import { describe, it, expect, afterEach } from 'vitest';
import { adapters } from './index.js';
import { createTempProject, createMockParadigmFiles } from '../../test-utils.js';
import type { IDEAdapter } from './types.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const adapterEntries: [string, IDEAdapter][] = Array.from(adapters.entries());

describe.each(adapterEntries)('adapter: %s', (name, adapter) => {
  it('has correct name property', () => {
    expect(adapter.name).toBe(name);
  });

  it('has a displayName', () => {
    expect(adapter.displayName).toBeDefined();
    expect(typeof adapter.displayName).toBe('string');
    expect(adapter.displayName.length).toBeGreaterThan(0);
  });

  it('has an outputPath', () => {
    expect(adapter.outputPath).toBeDefined();
    expect(typeof adapter.outputPath).toBe('string');
    expect(adapter.outputPath.length).toBeGreaterThan(0);
  });

  it('detect() returns boolean', () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    const result = adapter.detect(rootDir);
    expect(typeof result).toBe('boolean');
  });

  it('generate() returns non-empty string', () => {
    const files = createMockParadigmFiles();
    const result = adapter.generate(files);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('generate() output contains project name', () => {
    const projectName = 'my-unique-project';
    const files = createMockParadigmFiles({ projectName });
    const result = adapter.generate(files);
    expect(result).toContain(projectName);
  });
});
