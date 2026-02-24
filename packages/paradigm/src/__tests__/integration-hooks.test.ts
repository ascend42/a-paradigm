import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

describe('Hook Generation', () => {
  it('plugin hooks.json is valid JSON', () => {
    const hooksPath = path.join(ROOT, 'plugins', 'paradigm', 'hooks', 'hooks.json');
    if (!fs.existsSync(hooksPath)) {
      // Skip if plugin directory doesn't exist
      return;
    }
    const content = fs.readFileSync(hooksPath, 'utf8');
    const hooks = JSON.parse(content);
    expect(hooks).toBeDefined();
    expect(hooks.hooks).toBeDefined();
    expect(typeof hooks.hooks).toBe('object');
  });

  it('plugin hooks.json has required hook types', () => {
    const hooksPath = path.join(ROOT, 'plugins', 'paradigm', 'hooks', 'hooks.json');
    if (!fs.existsSync(hooksPath)) {
      return;
    }
    const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    // Should have at least one hook defined
    const hookTypes = Object.keys(hooks.hooks);
    expect(hookTypes.length).toBeGreaterThan(0);
  });
});
