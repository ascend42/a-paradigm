// @gnomon-platform: darwin
/**
 * #session-runner platform backend (TD-2026-10-19-063): the claude signer
 * check runs /usr/bin/codesign on a PRIVATE COPY. An unsigned copy and an
 * Apple platform binary (no TeamIdentifier) both fail; the installed native
 * claude, when this host has one, names Anthropic PBC's team.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLAUDE_EXPECTED_TEAM, claudeVerifierFor } from '../src/platform/claude-verifier.js';
import { tempHome } from './daemon-helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function realClaude(): string | null {
  try {
    return fs.realpathSync(path.join(os.homedir(), '.local', 'bin', 'claude'));
  } catch {
    return null;
  }
}

function scratch(): string {
  const t = tempHome('gcv-');
  cleanups.push(t.cleanup);
  fs.mkdirSync(t.home, { recursive: true });
  return t.home;
}

describe('claudeVerifierFor(darwin): codesign on the private copy', () => {
  const v = claudeVerifierFor('darwin');
  it('is codesign; other platforms are unavailable (verified:false, never a throw)', () => {
    expect(v.kind).toBe('codesign');
    expect(claudeVerifierFor('linux').check('x')).toEqual({ verified: false, team: null });
  });
  it('an unsigned copy fails, team null', () => {
    const f = path.join(scratch(), 'claude-unsigned');
    fs.writeFileSync(f, Buffer.concat([Buffer.from('cffaedfe', 'hex'), Buffer.alloc(64)]));
    expect(v.check(f)).toEqual({ verified: false, team: null });
  });
  it('an Apple platform binary (no team) fails the Anthropic requirement', () => {
    expect(v.check('/usr/bin/true').verified).toBe(false);
  });
  it.skipIf(!realClaude())('a private copy of the installed native claude is signed by Anthropic PBC', () => {
    const copy = path.join(scratch(), 'claude-copy');
    fs.copyFileSync(realClaude()!, copy);
    expect(v.check(copy)).toEqual({ verified: true, team: CLAUDE_EXPECTED_TEAM });
  });
});
