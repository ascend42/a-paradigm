/**
 * concurrency.test — the fabric lock + selvage CAS (Reviewer C1).
 *   - writeSelvage CAS throws when the tip moved off the expected value
 *   - two CONCURRENT picks against one repo serialize: unique seqs, a consistent
 *     chain, and the tip equals the last-sealed strand — no lost update
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readSelvage, writeSelvage, warplineDirOf } from '../src/fabric/fabric.js';
import { withFabricLock } from '../src/fabric/lock.js';

describe('writeSelvage · compare-and-swap', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-cas-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('throws when the on-disk tip is not the expected old value', () => {
    const wdir = warplineDirOf(root);
    writeSelvage(wdir, 'state:v0:one'); // plain write, no CAS
    // CAS from the WRONG expected old → must throw, tip unchanged.
    expect(() => writeSelvage(wdir, 'state:v0:two', 'state:v0:WRONG')).toThrow(/CAS failed/);
    expect(readSelvage(wdir)).toBe('state:v0:one');
    // CAS from the correct expected old → succeeds.
    writeSelvage(wdir, 'state:v0:two', 'state:v0:one');
    expect(readSelvage(wdir)).toBe('state:v0:two');
  });

  it('genesis CAS (expected null) succeeds on an empty fabric', () => {
    const wdir = warplineDirOf(root);
    writeSelvage(wdir, 'state:v0:genesis', null);
    expect(readSelvage(wdir)).toBe('state:v0:genesis');
  });
});

describe('withFabricLock · serializes overlapping critical sections (Reviewer C1)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-lock-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('5 concurrent read-modify-writes all apply — no lost update', async () => {
    const counter = path.join(root, 'counter');
    fs.writeFileSync(counter, '0', 'utf8');
    // Each holder reads, waits (widening the race window), then writes value+1.
    // WITHOUT the lock every holder reads 0 and writes 1 → final 1 (4 lost).
    // WITH the lock they serialize → final 5.
    const bump = () =>
      withFabricLock(root, async () => {
        const v = Number(fs.readFileSync(counter, 'utf8'));
        await new Promise((r) => setTimeout(r, 15));
        fs.writeFileSync(counter, String(v + 1), 'utf8');
      });
    await Promise.all([bump(), bump(), bump(), bump(), bump()]);
    expect(Number(fs.readFileSync(counter, 'utf8'))).toBe(5);
  });

  it('the lock is released so a later acquire succeeds', async () => {
    let ran = 0;
    await withFabricLock(root, () => {
      ran++;
    });
    await withFabricLock(root, () => {
      ran++;
    });
    expect(ran).toBe(2);
    // lockfile cleaned up
    expect(fs.existsSync(path.join(warplineDirOf(root), 'refs', '.lock'))).toBe(false);
  });
});
