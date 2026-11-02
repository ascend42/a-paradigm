/**
 * resolveProjectRoot with a portable MCP config (no absolute cwd): Cursor names the root with
 * PARADIGM_PROJECT_DIR=${workspaceFolder}. A client that leaves the placeholder unexpanded must not make it a path.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveProjectRoot } from './global-store.js';

describe('resolveProjectRoot: portable MCP configs', () => {
  let root: string;
  let sub: string;
  const saved = { cwd: process.cwd(), p: process.env.PARADIGM_PROJECT_DIR, c: process.env.CLAUDE_PROJECT_DIR };
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-root-')));
    fs.mkdirSync(path.join(root, '.paradigm'));
    sub = path.join(root, 'packages', 'a');
    fs.mkdirSync(sub, { recursive: true });
    delete process.env.PARADIGM_PROJECT_DIR;
    delete process.env.CLAUDE_PROJECT_DIR;
  });
  afterEach(() => {
    process.chdir(saved.cwd);
    if (saved.p === undefined) delete process.env.PARADIGM_PROJECT_DIR; else process.env.PARADIGM_PROJECT_DIR = saved.p;
    if (saved.c === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = saved.c;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('"." with no cwd in the config: walks up from where the client started it', () => {
    process.chdir(sub);
    expect(resolveProjectRoot('.')).toBe(root);
  });

  it('PARADIGM_PROJECT_DIR expanded by the client (Cursor ${workspaceFolder}) wins over a wrong spawn cwd', () => {
    process.chdir(os.tmpdir());
    process.env.PARADIGM_PROJECT_DIR = root;
    expect(resolveProjectRoot('.')).toBe(root);
  });

  it('an unexpanded ${workspaceFolder} is ignored: never returned as a path, the walk-up still finds the project', () => {
    process.chdir(sub);
    process.env.PARADIGM_PROJECT_DIR = '${workspaceFolder}';
    expect(resolveProjectRoot('.')).toBe(root);
    expect(resolveProjectRoot('${workspaceFolder}')).toBe(root);
  });

  it('outside any project, the literal placeholder is never invented as the root (falls back to the cwd)', () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'no-project-')));
    try {
      process.chdir(outside);
      process.env.PARADIGM_PROJECT_DIR = '${workspaceFolder}';
      const got = resolveProjectRoot('.');
      expect(got).not.toContain('${');
      expect(got).toBe(outside);
    } finally {
      process.chdir(saved.cwd);
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
