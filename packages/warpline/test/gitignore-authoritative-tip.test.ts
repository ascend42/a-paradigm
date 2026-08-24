/**
 * gitignore-authoritative-tip.test — git was replicating the WRONG pointer.
 *
 * `.warpline/fabric.jsonl` is git-tracked on purpose: with no signatures and no
 * length attestation, git is currently Warpline's entire anti-truncation backstop
 * (soundness audit C-6). The TIP pointer needs the same treatment, and after the
 * V3.2 refs migration it moved:
 *
 *     tracked (legacy):        .warpline/refs/selvage        state:v0:6b440d36…
 *     IGNORED (authoritative): .warpline/refs/heads/selvage  pick:v2:876939980…
 *
 * `.warpline/refs/*` was catching `refs/heads`, so the pointer that refs.ts:5-7
 * exists BECAUSE stateIds are many-to-one and cannot name a history position was
 * the one git did not carry.
 *
 * ASSERTED AGAINST THE AUTHORITY, NOT THE TEXT. These run `git check-ignore -q`
 * against the real repository rather than pattern-matching `.gitignore`, because
 * the file is a program and only git evaluates it — precedence between `*`, `!`
 * and directory rules is exactly where this bug lived. Read-only: check-ignore
 * takes a path string and does not need the file to exist.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: HERE,
  encoding: 'utf8',
}).trim();

/** git's own verdict. exit 0 ⇒ ignored, exit 1 ⇒ not ignored. */
function ignored(rel: string): boolean {
  const r = spawnSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: REPO });
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`git check-ignore failed for ${rel}: status ${r.status}`);
  }
  return r.status === 0;
}

describe('.gitignore · git replicates the AUTHORITATIVE tip', () => {
  it('the pickId tip refs/heads/selvage is NOT ignored — git carries it', () => {
    expect(ignored('.warpline/refs/heads/selvage')).toBe(false);
  });

  it('the legacy stateId selvage stays carried too (no regression on the old pointer)', () => {
    expect(ignored('.warpline/refs/selvage')).toBe(false);
  });

  it('the ledger — the anti-truncation backstop — stays carried', () => {
    expect(ignored('.warpline/fabric.jsonl')).toBe(false);
    expect(ignored('.warpline/config.json')).toBe(false);
    expect(ignored('.warpline/fabric-legacy.json')).toBe(false);
  });

  it('CONTROL: exactly one head is un-ignored, not the whole heads/ directory', () => {
    expect(ignored('.warpline/refs/heads/some-agent-branch')).toBe(true);
    expect(ignored('.warpline/refs/heads/warpline-stakes')).toBe(true);
  });

  it('CONTROL: per-agent scratch refs stay local (ephemeral, per-clone)', () => {
    expect(ignored('.warpline/refs/scratch/agent-zed')).toBe(true);
  });

  it('CONTROL: the heavy regenerable store stays ignored', () => {
    expect(ignored('.warpline/states/state_v0_deadbeef.json.gz')).toBe(true);
    expect(ignored('.warpline/states/state_v0_deadbeef.json')).toBe(true);
    expect(ignored('.warpline/warp/objects/warp_v0_deadbeef.json')).toBe(true);
    expect(ignored('.warpline/oracle.jsonl')).toBe(true);
    expect(ignored('.warpline/shadow/verdicts.jsonl')).toBe(true);
  });
});
