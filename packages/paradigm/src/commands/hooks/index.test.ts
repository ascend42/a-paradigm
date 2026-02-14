import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createTempProject } from '../../test-utils.js';

let cleanup: (() => void) | undefined;
let rootDir: string;

beforeEach(() => {
  const project = createTempProject({ withGit: true });
  rootDir = project.rootDir;
  cleanup = project.cleanup;
  vi.spyOn(process, 'cwd').mockReturnValue(rootDir);
  // Suppress console output
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

// Dynamic import to pick up mocked process.cwd()
async function importHooks() {
  return import('./index.js');
}

describe('hooksInstallCommand - Claude Code', () => {
  it('creates .claude/settings.json with hook entries', async () => {
    const { hooksInstallCommand } = await importHooks();
    await hooksInstallCommand({ claudeCode: true });

    const settingsPath = path.join(rootDir, '.claude', 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.Stop).toBeDefined();
    expect(settings.hooks.PreToolUse).toBeDefined();
    expect(settings.hooks.PostToolUse).toBeDefined();
  });

  it('merges with existing Claude settings (non-destructive)', async () => {
    // Create existing settings
    const claudeDir = path.join(rootDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ customSetting: true }),
      'utf8',
    );

    const { hooksInstallCommand } = await importHooks();
    await hooksInstallCommand({ claudeCode: true });

    const settings = JSON.parse(
      fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'),
    );
    expect(settings.customSetting).toBe(true);
    expect(settings.hooks).toBeDefined();
  });

  it('force mode overwrites Claude hooks', async () => {
    const { hooksInstallCommand } = await importHooks();

    // Install once
    await hooksInstallCommand({ claudeCode: true });
    // Install again with force
    await hooksInstallCommand({ claudeCode: true, force: true });

    const hookPath = path.join(rootDir, '.claude', 'hooks', 'paradigm-stop.sh');
    expect(fs.existsSync(hookPath)).toBe(true);
  });
});

describe('hooksInstallCommand - Cursor', () => {
  it('creates .cursor/hooks.json', async () => {
    const { hooksInstallCommand } = await importHooks();
    // Create .cursor dir first
    fs.mkdirSync(path.join(rootDir, '.cursor'), { recursive: true });
    await hooksInstallCommand({ cursor: true });

    const hooksJsonPath = path.join(rootDir, '.cursor', 'hooks.json');
    expect(fs.existsSync(hooksJsonPath)).toBe(true);

    const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
    expect(hooksJson.hooks).toBeDefined();
    expect(hooksJson.hooks.stop).toBeDefined();
    expect(hooksJson.hooks.afterFileEdit).toBeDefined();
    expect(hooksJson.hooks.beforeShellExecution).toBeDefined();
  });

  it('creates .cursor/hooks/paradigm-*.sh scripts', async () => {
    const { hooksInstallCommand } = await importHooks();
    fs.mkdirSync(path.join(rootDir, '.cursor'), { recursive: true });
    await hooksInstallCommand({ cursor: true });

    const hooksDir = path.join(rootDir, '.cursor', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'paradigm-stop.sh'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'paradigm-precommit.sh'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'paradigm-postwrite.sh'))).toBe(true);
  });

  it('hook scripts are executable (mode 755)', async () => {
    const { hooksInstallCommand } = await importHooks();
    fs.mkdirSync(path.join(rootDir, '.cursor'), { recursive: true });
    await hooksInstallCommand({ cursor: true });

    const hookPath = path.join(rootDir, '.cursor', 'hooks', 'paradigm-stop.sh');
    const stat = fs.statSync(hookPath);
    // Check that the file is executable (owner execute bit)
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  it('merges with existing .cursor/hooks.json', async () => {
    const cursorDir = path.join(rootDir, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.writeFileSync(
      path.join(cursorDir, 'hooks.json'),
      JSON.stringify({ version: 1, hooks: { stop: [{ command: 'other-hook.sh' }] } }),
      'utf8',
    );

    const { hooksInstallCommand } = await importHooks();
    await hooksInstallCommand({ cursor: true });

    const hooksJson = JSON.parse(
      fs.readFileSync(path.join(cursorDir, 'hooks.json'), 'utf8'),
    );
    // Existing hook preserved
    expect(hooksJson.hooks.stop.length).toBeGreaterThanOrEqual(2);
    expect(
      hooksJson.hooks.stop.some((h: Record<string, unknown>) => h.command === 'other-hook.sh'),
    ).toBe(true);
  });
});

describe('hooksInstallCommand - Git', () => {
  it('creates .git/hooks/post-commit', async () => {
    const { hooksInstallCommand } = await importHooks();
    await hooksInstallCommand({ postCommit: true });

    const hookPath = path.join(rootDir, '.git', 'hooks', 'post-commit');
    expect(fs.existsSync(hookPath)).toBe(true);
    const content = fs.readFileSync(hookPath, 'utf8');
    expect(content).toContain('paradigm');
  });

  it('preserves existing git hooks (no overwrite)', async () => {
    // Create an existing hook
    const hookPath = path.join(rootDir, '.git', 'hooks', 'post-commit');
    fs.writeFileSync(hookPath, '#!/bin/sh\necho "existing hook"', 'utf8');

    const { hooksInstallCommand } = await importHooks();
    await hooksInstallCommand({ postCommit: true });

    // Should not overwrite (no --force)
    const content = fs.readFileSync(hookPath, 'utf8');
    expect(content).toContain('existing hook');
    expect(content).not.toContain('paradigm');
  });
});

describe('hooksUninstallCommand - Cursor', () => {
  it('removes Cursor hook scripts and entries', async () => {
    const { hooksInstallCommand, hooksUninstallCommand } = await importHooks();
    fs.mkdirSync(path.join(rootDir, '.cursor'), { recursive: true });

    // Install first
    await hooksInstallCommand({ cursor: true });
    expect(
      fs.existsSync(path.join(rootDir, '.cursor', 'hooks', 'paradigm-stop.sh')),
    ).toBe(true);

    // Uninstall
    await hooksUninstallCommand({ cursor: true });
    expect(
      fs.existsSync(path.join(rootDir, '.cursor', 'hooks', 'paradigm-stop.sh')),
    ).toBe(false);

    // Check hooks.json entries are cleaned up
    const hooksJsonPath = path.join(rootDir, '.cursor', 'hooks.json');
    if (fs.existsSync(hooksJsonPath)) {
      const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
      const hooks = hooksJson.hooks || {};
      for (const key of ['stop', 'afterFileEdit', 'beforeShellExecution']) {
        if (hooks[key]) {
          expect(
            hooks[key].every(
              (h: Record<string, unknown>) => !JSON.stringify(h).includes('paradigm-'),
            ),
          ).toBe(true);
        }
      }
    }
  });
});

describe('hooksStatusCommand', () => {
  it('reports installed hooks correctly', async () => {
    const { hooksInstallCommand, hooksStatusCommand } = await importHooks();

    // Install Claude Code hooks
    await hooksInstallCommand({ claudeCode: true });

    // Status should complete without throwing
    await expect(hooksStatusCommand()).resolves.not.toThrow();
  });
});
