/**
 * `paradigm enforcement set --help` and its error message list every valid
 * level, including the default `none`, from one source of truth.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import {
  ENFORCEMENT_LEVELS,
  ENFORCEMENT_SET_DESCRIPTION,
  isValidLevel,
  getPreset,
} from '../core/enforcement/index.js';
import { enforcementSetCommand, ENFORCEMENT_SYNC_NOTE } from './enforcement.js';

const here = path.dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe('enforcement levels — one source of truth', () => {
  it('lists strict, balanced, minimal and none', () => {
    expect([...ENFORCEMENT_LEVELS]).toEqual(['strict', 'balanced', 'minimal', 'none']);
  });

  it('every listed level is valid and has a preset; nothing else is valid', () => {
    for (const level of ENFORCEMENT_LEVELS) {
      expect(isValidLevel(level)).toBe(true);
      expect(Object.keys(getPreset(level)).length).toBeGreaterThan(0);
    }
    expect(isValidLevel('off')).toBe(false);
  });
});

describe('paradigm enforcement set --help', () => {
  it('the description names every valid level, including none', () => {
    for (const level of ENFORCEMENT_LEVELS) expect(ENFORCEMENT_SET_DESCRIPTION).toContain(level);
  });

  it('commander renders that description in the help text', () => {
    const program = new Command();
    const set = program.command('enforcement').command('set <level>').description(ENFORCEMENT_SET_DESCRIPTION);
    const help = set.helpInformation();
    expect(help).toContain('strict, balanced, minimal, none');
  });

  it('the CLI registers `enforcement set` with the shared description, not a hand-typed list', () => {
    const src = fs.readFileSync(path.join(here, '..', 'index.ts'), 'utf8');
    const at = src.indexOf(".command('set <level>')");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 120)).toContain('.description(ENFORCEMENT_SET_DESCRIPTION)');
    expect(src).not.toContain('(strict, balanced, minimal)');
  });
});

describe('enforcementSetCommand', () => {
  it('rejects an unknown level and lists all four valid levels', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    await enforcementSetCommand('loud');
    expect(process.exitCode).toBe(1);
    expect(chunks.join('')).toContain('Must be one of: strict, balanced, minimal, none');
  });

  it('after a change, warns that `paradigm sync` overwrites hand edits instead of telling the user to run it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-enf-set-'));
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
      fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), 'version: "2.0"\nproject: demo\n', 'utf8');
      await enforcementSetCommand('balanced');
      const text = chunks.join('');
      expect(text).toContain('Enforcement level set to');
      expect(text).toContain('`paradigm sync` regenerates CLAUDE.md: hand edits to that file are overwritten.');
      expect(text).not.toMatch(/Run `paradigm sync`/);
      expect(fs.readFileSync(path.join(root, '.paradigm', 'config.yaml'), 'utf8')).toMatch(/level: balanced/);
    } finally {
      cwd.mockRestore();
      vi.restoreAllMocks();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('the note names both facts: the file is stale, and sync overwrites hand edits', () => {
    expect(ENFORCEMENT_SYNC_NOTE.join(' ')).toMatch(/still states the old level/);
    expect(ENFORCEMENT_SYNC_NOTE.join(' ')).toMatch(/hand edits to that file are overwritten/);
  });
});
