/**
 * Shift closes with a first action a newcomer can take: one prompt to paste to
 * their agent. It must not send them to hand-edit .purpose, and every command
 * it recommends must exist.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  FIRST_PROMPT,
  VERIFY_COMMAND,
  formatFirstPrompt,
  formatRecommendations,
  getRecommendations,
} from './shift-recommendations.js';

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

let tmp: string | undefined;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function freshProject(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-shift-recs-'));
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.purpose'), 'description: ""\ncomponents: []\n', 'utf8');
  return tmp;
}

describe('formatFirstPrompt', () => {
  it('prints the first prompt alone on one line so it copies cleanly', () => {
    const lines = stripAnsi(formatFirstPrompt()).split('\n');
    expect(lines).toContain(FIRST_PROMPT);
  });

  it('asks the agent to map the codebase and answer an impact question', () => {
    expect(FIRST_PROMPT).toContain('Map this codebase with Paradigm');
    expect(FIRST_PROMPT).toContain('draft .purpose files for the main directories');
    expect(FIRST_PROMPT).toContain('what would be affected if I changed <a module I know>');
  });

  it('does not tell the user to edit .purpose by hand', () => {
    expect(stripAnsi(formatFirstPrompt())).not.toMatch(/\bEdit\b/);
  });

  it('names the health check that exists', () => {
    expect(stripAnsi(formatFirstPrompt())).toContain('`paradigm doctor`');
  });
});

describe('getRecommendations', () => {
  it('recommends `paradigm doctor`, never the nonexistent `paradigm doctor --verify`', async () => {
    const recs = await getRecommendations(freshProject());
    const verify = recs.find((r) => r.id === 'verify-not-run');
    expect(verify?.command).toBe('paradigm doctor');
    expect(VERIFY_COMMAND).toBe('paradigm doctor');
    for (const r of recs) expect(r.command ?? '').not.toContain('doctor --verify');
  });

  it('points an empty project at the first prompt instead of hand-editing .purpose', async () => {
    const recs = await getRecommendations(freshProject());
    const out = stripAnsi(formatRecommendations(recs));
    expect(recs.find((r) => r.id === 'empty-purpose')?.message).toContain('first prompt below');
    expect(recs.find((r) => r.id === 'no-sub-purpose')?.message).toContain('first prompt below');
    expect(out).not.toContain('Edit `.purpose`');
  });
});
