import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_ALWAYS_ON_MAX_CHARS, measureAlwaysOn, overCapLine, readAlwaysOnCap, surfaceForAdapter, estimateTokens,
  paradigmPluginInstallPath, samePath,
} from './always-on-budget.js';

let dirs: string[] = [];
function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function skill(dir: string, name: string, description: string): void {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\nbody\n`);
}

describe('#always-on-budget', () => {
  it('defaults the cap and reads context.always-on-max-chars', () => {
    const root = tmp('aob-root-');
    expect(readAlwaysOnCap(root)).toBe(DEFAULT_ALWAYS_ON_MAX_CHARS);
    fs.mkdirSync(path.join(root, '.paradigm'));
    fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), 'context:\n  always-on-max-chars: 500\n');
    expect(readAlwaysOnCap(root)).toBe(500);
    fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), 'context:\n  always-on-max-chars: -1\n');
    expect(readAlwaysOnCap(root)).toBe(DEFAULT_ALWAYS_ON_MAX_CHARS);
  });

  it('estimates tokens as chars / 4 rounded up', () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(5)).toBe(2);
  });

  it('counts the installed paradigm plugin and pdg- skills; other skills are census', () => {
    const root = tmp('aob-root-');
    const home = tmp('aob-home-');
    const install = path.join(home, '.claude', 'plugins', 'cache', 'a-paradigm', 'paradigm', '9.9.9');
    skill(path.join(install, 'skills'), 'class', 'Convene class. Use when the user says class.');
    fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'paradigm@a-paradigm': [{ scope: 'user', installPath: install, version: '9.9.9' }] },
    }));
    skill(path.join(home, '.claude', 'skills'), 'pdg-x', 'abcd');
    skill(path.join(home, '.claude', 'skills'), 'mine', 'user skill');
    skill(path.join(home, '.claude', 'skills', 'synced'), 'nested', 'ignored');
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'z'.repeat(40));

    const b = measureAlwaysOn(root, { homeDir: home });
    const labels = b.entries.map((e) => e.label);
    expect(labels).toContain('paradigm plugin skill descriptions');
    expect(labels).toContain('~/.claude/skills/pdg-* descriptions');
    expect(labels).toContain('AGENTS.md');
    expect(b.census.map((e) => e.label)).toContain('~/.claude/skills (user, non-Paradigm) descriptions');
    const claude = b.surfaces.find((s) => s.surface === 'claude-code');
    expect(claude?.chars).toBe('Convene class. Use when the user says class.'.length + 4);
    expect(b.surfaces.find((s) => s.surface === 'agents-md')?.chars).toBe(40);
  });

  it('formats a one-line sync warning only for an over-cap surface', () => {
    const root = tmp('aob-root-');
    const home = tmp('aob-home-');
    fs.mkdirSync(path.join(root, '.paradigm'));
    fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), 'context:\n  always-on-max-chars: 10\n');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'x'.repeat(20));
    const b = measureAlwaysOn(root, { homeDir: home });
    expect(overCapLine(b, 'claude-code')).toContain('20 chars (~5 tokens est.), over the 10 cap (context.always-on-max-chars)');
    expect(overCapLine(b, 'cursor')).toBeNull();
    expect(surfaceForAdapter('claude')).toBe('claude-code');
    expect(surfaceForAdapter('copilot')).toBeNull();
  });
});

describe('#always-on-budget plugin install path (N3)', () => {
  it('matches a project-scope install case-insensitively on win32 only', () => {
    expect(samePath('/Work/Repo', '/work/repo', 'win32')).toBe(true);
    expect(samePath('/Work/Repo', '/work/repo', 'linux')).toBe(false);

    const home = tmp('aob-n3-home-');
    fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
      plugins: { 'paradigm@market': [
        { scope: 'user', installPath: '/user-install' },
        { scope: 'project', projectPath: '/Work/Repo', installPath: '/project-install' },
      ] },
    }));
    expect(paradigmPluginInstallPath('/work/repo', home, 'win32')).toBe('/project-install');
    expect(paradigmPluginInstallPath('/work/repo', home, 'darwin')).toBe('/user-install');
  });
});
