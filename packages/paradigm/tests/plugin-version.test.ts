/**
 * The Claude Code plugin's version must equal @a-company/paradigm's.
 *
 * Claude Code caches an installed plugin by its plugin.json version, so a change shipped under an unchanged version
 * never reaches anyone who already installed that version (8.0.1: PRs #54–#56 merged under the same number and every
 * early install kept the stale hooks). Bumping paradigm without plugin.json, or the reverse, fails here.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string): { version?: string } => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));

describe('plugin version', () => {
  it('plugins/paradigm/.claude-plugin/plugin.json matches packages/paradigm/package.json', () => {
    const paradigm = read('packages/paradigm/package.json').version;
    expect(paradigm).toMatch(/^\d+\.\d+\.\d+/);
    expect(read('plugins/paradigm/.claude-plugin/plugin.json').version).toBe(paradigm);
  });
});
