import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createTempProject } from '../../test-utils.js';

let cleanup: (() => void) | undefined;
let rootDir: string;
let homeDir: string;
let originalHome: string | undefined;

beforeEach(() => {
  const project = createTempProject({ withGit: true });
  rootDir = project.rootDir;
  cleanup = project.cleanup;
  vi.spyOn(process, 'cwd').mockReturnValue(rootDir);
  // Isolate from the developer's real ~/.claude — otherwise installClaudeCodeHooks
  // detects an active paradigm plugin and skips project-level installation.
  // os.homedir() honors $HOME on macOS/Linux, so re-pointing it gives a clean
  // home for the duration of each test. (vi.spyOn on os.homedir does not work
  // under ESM because the namespace is non-configurable.)
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-test-home-'));
  originalHome = process.env.HOME;
  process.env.HOME = homeDir;
  // Suppress console output
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  if (homeDir && fs.existsSync(homeDir)) {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
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

  it('post-commit delegates to the provider-agnostic sync-commit command (Phase 2b)', async () => {
    const { hooksInstallCommand } = await importHooks();
    await hooksInstallCommand({ postCommit: true, force: true });

    const hookPath = path.join(rootDir, '.git', 'hooks', 'post-commit');
    const content = fs.readFileSync(hookPath, 'utf8');
    // The delegation line: best-effort, redirected, '|| true', uses MSG_SYMBOLS.
    expect(content).toContain('task sync-commit --hash "$COMMIT_HASH" --symbols "$MSG_SYMBOLS"');
    expect(content).toContain('>/dev/null 2>&1 || true');
    // It must NEVER name a provider (provider-agnostic).
    expect(content).not.toContain('gh ');
    // Version marker bumped so `hooks install --force` re-emits.
    expect(content).toContain('paradigm-hook-version: 2');
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

describe('Check 7 — Lore enforcement', () => {
  // Check 7 (lore enforcement) lives in the shared paradigm-common.sh library
  // which both stop hooks source. We assert (a) the stop hook sources the
  // library and (b) the library actually contains the check.
  it('Claude Code stop hook contains lore check', async () => {
    const { hooksInstallCommand } = await importHooks();
    await hooksInstallCommand({ claudeCode: true });

    const hooksDir = path.join(rootDir, '.claude', 'hooks');
    const hookPath = path.join(hooksDir, 'paradigm-stop.sh');
    const commonPath = path.join(hooksDir, 'paradigm-common.sh');

    expect(fs.existsSync(hookPath)).toBe(true);
    expect(fs.existsSync(commonPath)).toBe(true);

    const stopContent = fs.readFileSync(hookPath, 'utf8');
    expect(stopContent).toContain('paradigm-common.sh');

    const commonContent = fs.readFileSync(commonPath, 'utf8');
    expect(commonContent).toContain('Check 7');
    expect(commonContent).toContain('LORE_RECORDED');
    expect(commonContent).toContain('paradigm_lore_record');
  });

  it('Cursor stop hook contains lore check', async () => {
    const { hooksInstallCommand } = await importHooks();
    fs.mkdirSync(path.join(rootDir, '.cursor'), { recursive: true });
    await hooksInstallCommand({ cursor: true });

    const hooksDir = path.join(rootDir, '.cursor', 'hooks');
    const hookPath = path.join(hooksDir, 'paradigm-stop.sh');
    const commonPath = path.join(hooksDir, 'paradigm-common.sh');

    expect(fs.existsSync(hookPath)).toBe(true);
    expect(fs.existsSync(commonPath)).toBe(true);

    const stopContent = fs.readFileSync(hookPath, 'utf8');
    expect(stopContent).toContain('paradigm-common.sh');

    const commonContent = fs.readFileSync(commonPath, 'utf8');
    expect(commonContent).toContain('Check 7');
    expect(commonContent).toContain('LORE_RECORDED');
    expect(commonContent).toContain('paradigm_lore_record');
  });
});

describe('Check 15 — Native memory hygiene nudge (advisory only, TD-2026-09-19-110)', () => {
  // Check 15 lives in the shared paradigm-common.sh library. It is advisory-only:
  // it appends AT MOST one line to ADVISORY and must NEVER touch VIOLATIONS.
  // These tests EXECUTE the extracted block in isolation (POSIX sh) with a fake
  // repo + fake HOME to assert behavior, not just presence.
  const COMMON_SH = fileURLToPath(
    new URL('./scripts/paradigm-common.sh', import.meta.url),
  );

  // Extract just the Check 15 block (between its opening and END markers).
  function extractCheck15(): string {
    const src = fs.readFileSync(COMMON_SH, 'utf8');
    const start = src.indexOf('# --- Check 15:');
    const endMarker = '# --- END Check 15 ---';
    const end = src.indexOf(endMarker);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end + endMarker.length);
  }

  // Run the extracted block with the given CWD/HOME, returning parsed results.
  function runCheck15(cwd: string, home: string): {
    rc: number;
    violationCount: string;
    violations: string;
    advisory: string;
  } {
    const block = extractCheck15();
    const harness = [
      'VIOLATIONS=""',
      'VIOLATION_COUNT=0',
      'ADVISORY=""',
      `CWD="${cwd}"`,
      block,
      'echo "RC=$?"',
      'echo "VC=$VIOLATION_COUNT"',
      'echo "VIOL_START"',
      'printf "%s" "$VIOLATIONS"',
      'echo ""',
      'echo "VIOL_END"',
      'echo "ADV_START"',
      'printf "%s" "$ADVISORY"',
      'echo ""',
      'echo "ADV_END"',
    ].join('\n');
    const harnessPath = path.join(rootDir, 'check15-harness.sh');
    fs.writeFileSync(harnessPath, harness, 'utf8');
    const out = execFileSync('sh', [harnessPath], {
      cwd,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    });
    const rc = Number(/^RC=(\d+)$/m.exec(out)?.[1] ?? '0');
    const violationCount = /^VC=(.*)$/m.exec(out)?.[1] ?? '';
    const violations = out
      .slice(out.indexOf('VIOL_START') + 'VIOL_START\n'.length, out.indexOf('VIOL_END'))
      .trim();
    const advisory = out
      .slice(out.indexOf('ADV_START') + 'ADV_START\n'.length, out.indexOf('ADV_END'))
      .trim();
    return { rc, violationCount, violations, advisory };
  }

  // Build the native-memory dir for a repo at `cwd` under a fake `home`.
  function memoryDir(cwd: string, home: string): string {
    const slug = cwd.replace(/\//g, '-');
    return path.join(home, '.claude', 'projects', slug, 'memory');
  }

  it('emits an advisory line when the entry-count threshold is crossed', () => {
    const mem = memoryDir(rootDir, homeDir);
    fs.mkdirSync(mem, { recursive: true });
    // 30 entries (> 25) and never reviewed.
    for (let i = 0; i < 30; i++) {
      fs.writeFileSync(path.join(mem, `entry-${i}.md`), '', 'utf8');
    }

    const res = runCheck15(rootDir, homeDir);
    expect(res.advisory).toMatch(
      /^- \(memory\) 30 entries \/ never reviewed — run: paradigm memory review$/,
    );
    // Advisory-only: never blocks.
    expect(res.rc).toBe(0);
    expect(res.violationCount).toBe('0');
    expect(res.violations).toBe('');
  });

  it('emits an advisory when MEMORY.md exceeds the byte-size threshold', () => {
    const mem = memoryDir(rootDir, homeDir);
    fs.mkdirSync(mem, { recursive: true });
    // Few entries, but a large MEMORY.md (> 32768 bytes).
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(mem, `e-${i}.md`), '', 'utf8');
    }
    fs.writeFileSync(path.join(mem, 'MEMORY.md'), 'x'.repeat(40000), 'utf8');

    const res = runCheck15(rootDir, homeDir);
    expect(res.advisory).toContain('(memory) 5 entries');
    expect(res.advisory).toContain('run: paradigm memory review');
    expect(res.rc).toBe(0);
    expect(res.violationCount).toBe('0');
  });

  it('emits an advisory when the review stamp is older than the day threshold', () => {
    const mem = memoryDir(rootDir, homeDir);
    fs.mkdirSync(mem, { recursive: true });
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(mem, `e-${i}.md`), '', 'utf8');
    }
    // Stamp exists but is ~60 days old.
    const stamp = path.join(rootDir, '.paradigm', '.memory-last-review');
    fs.writeFileSync(stamp, new Date().toISOString(), 'utf8');
    const old = new Date(Date.now() - 60 * 86400 * 1000);
    fs.utimesSync(stamp, old, old);

    const res = runCheck15(rootDir, homeDir);
    expect(res.advisory).toMatch(/\(memory\) 3 entries \/ \d+d since review/);
    expect(res.rc).toBe(0);
    expect(res.violationCount).toBe('0');
  });

  it('emits NOTHING (fail-open) and exits 0 when the memory dir is missing', () => {
    // No memory dir created at all under homeDir.
    const res = runCheck15(rootDir, homeDir);
    expect(res.advisory).toBe('');
    expect(res.rc).toBe(0);
    expect(res.violationCount).toBe('0');
  });

  it('emits NOTHING when HOME is empty (fail-open)', () => {
    const mem = memoryDir(rootDir, homeDir);
    fs.mkdirSync(mem, { recursive: true });
    for (let i = 0; i < 30; i++) {
      fs.writeFileSync(path.join(mem, `entry-${i}.md`), '', 'utf8');
    }
    const res = runCheck15(rootDir, '');
    expect(res.advisory).toBe('');
    expect(res.rc).toBe(0);
    expect(res.violationCount).toBe('0');
  });

  it('emits NOTHING on the common path (below all thresholds)', () => {
    const mem = memoryDir(rootDir, homeDir);
    fs.mkdirSync(mem, { recursive: true });
    // 10 entries (<= 15) and never reviewed → quiet.
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(mem, `e-${i}.md`), '', 'utf8');
    }
    const res = runCheck15(rootDir, homeDir);
    expect(res.advisory).toBe('');
    expect(res.rc).toBe(0);
    expect(res.violationCount).toBe('0');
  });

  it('never adds to the blocking/violation path even when nudging', () => {
    const mem = memoryDir(rootDir, homeDir);
    fs.mkdirSync(mem, { recursive: true });
    for (let i = 0; i < 40; i++) {
      fs.writeFileSync(path.join(mem, `entry-${i}.md`), '', 'utf8');
    }
    const res = runCheck15(rootDir, homeDir);
    // Nudge present…
    expect(res.advisory).toContain('(memory)');
    // …but the block never touched VIOLATIONS / VIOLATION_COUNT / exit code.
    expect(res.violations).toBe('');
    expect(res.violationCount).toBe('0');
    expect(res.rc).toBe(0);
  });

  it('the shared library contains the Check 15 block and never writes VIOLATIONS from it', () => {
    const src = fs.readFileSync(COMMON_SH, 'utf8');
    expect(src).toContain('# --- Check 15:');
    expect(src).toContain('# --- END Check 15 ---');
    // Structural guard: the Check 15 region must not mutate the blocking path.
    const block = extractCheck15();
    expect(block).not.toContain('VIOLATIONS=');
    expect(block).not.toContain('VIOLATION_COUNT=');
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
