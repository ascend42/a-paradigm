import { describe, it, expect, afterEach } from 'vitest';
import {
  getScanIndexPath,
  scanIndexExists,
  getScanIndexAge,
  parseFlowSteps,
  indexFlowSymbols,
} from './index.js';
import { createTempProject } from '../../test-utils.js';
import * as fs from 'fs';
import * as path from 'path';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('getScanIndexPath', () => {
  it('returns modern path when .paradigm/ is directory', () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    const result = getScanIndexPath(rootDir);
    expect(result).toBe(path.join(rootDir, '.paradigm', 'scan-index.json'));
  });

  it('returns legacy path when .paradigm is file', () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    // Remove the .paradigm directory and create it as a file
    fs.rmSync(path.join(rootDir, '.paradigm'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, '.paradigm'), 'version: 1.0', 'utf8');
    const result = getScanIndexPath(rootDir);
    expect(result).toBe(path.join(rootDir, '.paradigm-scan-index.json'));
  });
});

describe('scanIndexExists', () => {
  it('returns true when scan-index.json exists', () => {
    const { rootDir, cleanup: c } = createTempProject({ withScanIndex: true });
    cleanup = c;
    expect(scanIndexExists(rootDir)).toBe(true);
  });

  it('returns false when absent', () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    expect(scanIndexExists(rootDir)).toBe(false);
  });
});

describe('getScanIndexAge', () => {
  it('returns age in ms for valid index', () => {
    const pastDate = new Date(Date.now() - 60000).toISOString();
    const content = JSON.stringify({
      $meta: { generatedAt: pastDate, project: 'test' },
      components: {},
      features: {},
      flows: {},
      state: {},
      gates: {},
      signals: {},
    });
    const { rootDir, cleanup: c } = createTempProject({
      withScanIndex: true,
      scanIndexContent: content,
    });
    cleanup = c;
    const age = getScanIndexAge(rootDir);
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThanOrEqual(50000); // ~60s ago, allow some tolerance
    expect(age!).toBeLessThan(120000);
  });

  it('returns null when no index', () => {
    const { rootDir, cleanup: c } = createTempProject();
    cleanup = c;
    expect(getScanIndexAge(rootDir)).toBeNull();
  });
});

describe('parseFlowSteps', () => {
  it('parses valid flow steps array', () => {
    const steps = [
      { id: 'step-1', action: 'Create user', symbol: '#user-service' },
      { action: 'Send email', symbol: '!welcome-email' },
    ];
    const result = parseFlowSteps(steps);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('step-1');
    expect(result[0].action).toBe('Create user');
    expect(result[0].symbol).toBe('#user-service');
    expect(result[1].id).toBe('step-2'); // auto-generated
    expect(result[1].action).toBe('Send email');
  });

  it('returns empty for undefined input', () => {
    expect(parseFlowSteps(undefined)).toEqual([]);
  });

  it('returns empty for null input', () => {
    expect(parseFlowSteps(null as unknown as undefined)).toEqual([]);
  });
});

describe('indexFlowSymbols', () => {
  it('indexes symbols from steps', () => {
    const symbolToFlows: Record<string, string[]> = {};
    const steps = [
      { id: 'step-1', action: 'Create user', symbol: '#user-service' },
      { id: 'step-2', action: 'Send email', symbol: '!welcome-email' },
    ];
    indexFlowSymbols('$onboarding', steps, symbolToFlows);
    expect(symbolToFlows['#user-service']).toEqual(['$onboarding']);
    expect(symbolToFlows['!welcome-email']).toEqual(['$onboarding']);
  });

  it('deduplicates flow references', () => {
    const symbolToFlows: Record<string, string[]> = {
      '#user-service': ['$onboarding'],
    };
    const steps = [
      { id: 'step-1', action: 'Again', symbol: '#user-service' },
    ];
    indexFlowSymbols('$onboarding', steps, symbolToFlows);
    expect(symbolToFlows['#user-service']).toEqual(['$onboarding']);
  });
});
