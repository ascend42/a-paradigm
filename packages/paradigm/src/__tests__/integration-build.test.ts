import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

describe('Build Verification', () => {
  it('paradigm package compiles without type errors', () => {
    expect(() => {
      execSync('npx tsc --noEmit', {
        cwd: path.join(ROOT, 'packages', 'paradigm'),
        timeout: 60000,
      });
    }).not.toThrow();
  });

  it('paradigm package bundles successfully', () => {
    expect(() => {
      execSync('npm run build', {
        cwd: path.join(ROOT, 'packages', 'paradigm'),
        timeout: 60000,
      });
    }).not.toThrow();
  });
});
