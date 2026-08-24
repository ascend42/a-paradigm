/**
 * hook.test — the auto-seal post-commit hook manager.
 *   - install creates an executable hook with the warpline block
 *   - install COEXISTS with an existing hook (appends, never clobbers)
 *   - install is idempotent (re-install refreshes the block, no duplication)
 *   - uninstall strips ONLY the warpline block, leaving other content
 *   - status reports installed / absent / other-hook
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { installHook, uninstallHook, hookStatus } from '../src/fabric/hook.js';

const BEGIN = '# >>> warpline auto-seal >>>';

describe('hook · auto-seal post-commit manager', () => {
  let dir: string;
  let hookPath: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-hook-'));
    hookPath = path.join(dir, 'hooks', 'post-commit');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('install creates an executable hook carrying the block', () => {
    const r = installHook(hookPath);
    expect(r.created).toBe(true);
    const text = fs.readFileSync(hookPath, 'utf8');
    expect(text.startsWith('#!/bin/sh')).toBe(true);
    expect(text).toContain(BEGIN);
    expect(text).toContain('pick --ref HEAD --quiet');
    expect(text).toContain('|| true'); // fail-safe
    expect(fs.statSync(hookPath).mode & 0o111).toBeTruthy(); // executable
    expect(hookStatus(hookPath).state).toBe('installed');
  });

  it('coexists with an existing post-commit hook (appends, preserves it)', () => {
    const existing = '#!/bin/sh\n# Paradigm history capture\necho "paradigm ran" >/dev/null\n';
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, existing, 'utf8');
    expect(hookStatus(hookPath).state).toBe('other-hook-no-warpline');

    const r = installHook(hookPath);
    expect(r.created).toBe(false);
    const text = fs.readFileSync(hookPath, 'utf8');
    expect(text).toContain('# Paradigm history capture'); // preserved
    expect(text).toContain('echo "paradigm ran"');
    expect(text).toContain(BEGIN); // appended
    expect(hookStatus(hookPath).state).toBe('installed');
  });

  it('is idempotent — re-install refreshes the block, never duplicates it', () => {
    installHook(hookPath);
    const r2 = installHook(hookPath);
    expect(r2.refreshed).toBe(true);
    const text = fs.readFileSync(hookPath, 'utf8');
    // exactly one marker
    expect(text.split(BEGIN).length - 1).toBe(1);
  });

  it('uninstall strips only the warpline block, leaving other content', () => {
    const existing = '#!/bin/sh\n# Paradigm history capture\necho keep >/dev/null\n';
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, existing, 'utf8');
    installHook(hookPath);
    const u = uninstallHook(hookPath);
    expect(u.removed).toBe(true);
    const text = fs.readFileSync(hookPath, 'utf8');
    expect(text).toContain('# Paradigm history capture');
    expect(text).toContain('echo keep');
    expect(text).not.toContain(BEGIN);
    expect(hookStatus(hookPath).state).toBe('other-hook-no-warpline');
  });

  it('uninstall removes the file entirely when only the block (+shebang) remained', () => {
    installHook(hookPath); // created fresh: shebang + block only
    const u = uninstallHook(hookPath);
    expect(u.removed).toBe(true);
    expect(fs.existsSync(hookPath)).toBe(false);
    expect(hookStatus(hookPath).state).toBe('absent');
  });
});
