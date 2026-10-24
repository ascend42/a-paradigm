/**
 * Aegis F1 + L1 (TD-2026-10-20-514): the cross-process lock is never broken while live. It is taken by hard-linking
 * a temp file that already holds pid:nonce (never seen empty, never overwrites); an unparsable holder (only on the
 * no-hard-link O_EXCL fallback) is live until older than LOCK_UNWRITTEN_GRACE_MS; a stale lock is broken by rename +
 * content re-check, so a second breaker never deletes the fresh lock a live holder took meanwhile.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCK_UNWRITTEN_GRACE_MS, withHomeFileLock } from '../src/kernel/manifest/grant-lock.js';

const tmps: string[] = [];
function tmp(): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lock-')));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) fs.rmSync(tmps.pop()!, { recursive: true, force: true });
});

/** a pid that is not running (a dead holder) */
const DEAD = 2 ** 22 + 12345;

describe('Aegis F1: withHomeFileLock', () => {
  it('an empty holder (being created) is LIVE: the waiter times out busy and the lock is left in place', () => {
    const home = tmp();
    const file = path.join(home, 'grants.lock');
    fs.writeFileSync(file, '');
    let ran = false;
    expect(() => withHomeFileLock(home, 'grants', () => (ran = true), { waitMs: 60 })).toThrow(/being written|lock being created/);
    expect(ran).toBe(false);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('an empty holder older than the grace is stale and broken', () => {
    const home = tmp();
    const file = path.join(home, 'grants.lock');
    fs.writeFileSync(file, '');
    const old = new Date(Date.now() - LOCK_UNWRITTEN_GRACE_MS - 5_000);
    fs.utimesSync(file, old, old);
    expect(withHomeFileLock(home, 'grants', () => 'ran', { waitMs: 60 })).toBe('ran');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('a dead holder is broken; no stale-* file is left behind', () => {
    const home = tmp();
    fs.writeFileSync(path.join(home, 'grants.lock'), `${DEAD}:abcd`);
    expect(withHomeFileLock(home, 'grants', () => 'ran')).toBe('ran');
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('two breakers of the same stale lock: the second never deletes the fresh lock taken in between', () => {
    const home = tmp();
    const file = path.join(home, 'grants.lock');
    fs.writeFileSync(file, `${DEAD}:abcd`);
    const fresh = `${process.pid}:feedface`; // a live holder (this process is alive)
    let ran = false;
    expect(() =>
      withHomeFileLock(home, 'grants', () => (ran = true), {
        waitMs: 60,
        beforeBreak: () => {
          // the OTHER breaker wins first: removes the stale lock, and a live holder takes a fresh one
          fs.rmSync(file);
          fs.writeFileSync(file, fresh);
        },
      }),
    ).toThrow(/being written/);
    expect(ran).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe(fresh);
    expect(fs.readdirSync(home).sort()).toEqual(['grants.lock']);
  });

  it('L1: the lock is linked whole (pid:nonce, never empty) and no temp file is left, held or released', () => {
    const home = tmp();
    const file = path.join(home, 'grants.lock');
    withHomeFileLock(home, 'grants', () => {
      expect(fs.readFileSync(file, 'utf8')).toMatch(new RegExp(`^${process.pid}:[0-9a-f]{16}$`));
      expect(fs.readdirSync(home)).toEqual(['grants.lock']);
    });
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('release removes only its own lock', () => {
    const home = tmp();
    const file = path.join(home, 'grants.lock');
    withHomeFileLock(home, 'grants', () => {
      fs.writeFileSync(file, `${process.pid}:0000`); // someone else's lock now sits there
    });
    expect(fs.readFileSync(file, 'utf8')).toBe(`${process.pid}:0000`);
  });
});
