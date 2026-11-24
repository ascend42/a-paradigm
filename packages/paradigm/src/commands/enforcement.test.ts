/**
 * `paradigm enforcement set --help` and its error message list every valid
 * level, including the default `none`, from one source of truth.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import {
  ENFORCEMENT_LEVELS,
  ENFORCEMENT_SET_DESCRIPTION,
  isValidLevel,
  getPreset,
} from '../core/enforcement/index.js';
import { enforcementSetCommand } from './enforcement.js';

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
});
