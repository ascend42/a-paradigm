// Aegis M-B: a session's session-env/<uuid> is emptied at session end without ever following a link.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { emptySessionEnvDir } from '../src/kernel/supervisor/supervisor.js';

const UUID = '0bac96b2-a05d-4b48-9f5f-d9bab166a40c';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const world = (): { claude: string; env: string; outside: string } => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sess-env-clean-')));
  dirs.push(root);
  const claude = path.join(root, '.claude');
  const env = path.join(claude, 'session-env', UUID);
  fs.mkdirSync(env, { recursive: true, mode: 0o700 });
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'keep\n');
  fs.mkdirSync(path.join(outside, 'precious-dir'));
  fs.writeFileSync(path.join(outside, 'precious-dir', 'inner.txt'), 'keep\n');
  return { claude, env, outside };
};

describe('emptySessionEnvDir (Aegis M-B)', () => {
  it('removes files, links (not their targets) and real sub-dirs; keeps the <uuid> dir', () => {
    const { claude, env, outside } = world();
    fs.writeFileSync(path.join(env, 'sessionstart-hook-0.sh'), 'export X=1\n');
    fs.symlinkSync(path.join(outside, 'precious.txt'), path.join(env, 'link-to-file'));
    fs.symlinkSync(path.join(outside, 'precious-dir'), path.join(env, 'link-to-dir'));
    fs.mkdirSync(path.join(env, 'sub'));
    fs.writeFileSync(path.join(env, 'sub', 'f'), 'x');
    fs.symlinkSync(outside, path.join(env, 'sub', 'link-up'));
    const r = emptySessionEnvDir(claude, UUID);
    expect(r.refused).toBeUndefined();
    expect(r.removed).toBe(6);
    expect(fs.readdirSync(env)).toEqual([]);
    expect(fs.lstatSync(env).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8')).toBe('keep\n');
    expect(fs.readFileSync(path.join(outside, 'precious-dir', 'inner.txt'), 'utf8')).toBe('keep\n');
  });

  it('refuses (touches nothing) when session-env/<uuid> or session-env is a link, or the uuid is malformed', () => {
    const { claude, env, outside } = world();
    fs.rmSync(env, { recursive: true });
    fs.symlinkSync(outside, env);
    expect(emptySessionEnvDir(claude, UUID).refused).toMatch(/symlink/);
    expect(fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8')).toBe('keep\n');
    const root = path.join(claude, 'session-env');
    fs.rmSync(root, { recursive: true });
    fs.symlinkSync(outside, root);
    expect(emptySessionEnvDir(claude, UUID).refused).toMatch(/symlink/);
    expect(fs.existsSync(path.join(outside, 'precious-dir', 'inner.txt'))).toBe(true);
    expect(emptySessionEnvDir(claude, '../../outside').refused).toBe('malformed session uuid');
  });

  it('is a no-op when the dir does not exist', () => {
    const { claude, env } = world();
    fs.rmSync(env, { recursive: true });
    expect(emptySessionEnvDir(claude, UUID)).toEqual({ removed: 0 });
  });
});
