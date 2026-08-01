/**
 * durable-write-path.test — soundness audit C-7: there was not one fsync call in
 * the package, so "PICK sealed → exit 0" was a claim about the PAGE CACHE.
 *
 * `tmp`+`rename` is atomic against process death and says nothing about power
 * loss: without an fsync on the staging fd BEFORE the rename the rename can
 * reach stable storage ahead of the data, and without an fsync on the PARENT
 * DIRECTORY AFTER the rename the rename itself can be lost — the half people
 * forget. Git has hardened loose objects by default since 2.36 (`core.fsync`).
 *
 * A genuine power-loss test is not possible in CI, so these observe the syscalls
 * at the fs BOUNDARY (`node:fs` is mocked as a pass-through recorder). What is
 * asserted is the ORDER — stage, fsync(file), rename, fsync(dir) — because the
 * order is the entire guarantee; a test that only counted fsyncs would pass on a
 * fsync-after-rename implementation that protects nothing.
 *
 * The escape hatch (`WARPLINE_FSYNC=none`, defaults to safe) is asserted to
 * remove the fsyncs AND NOTHING ELSE: same bytes, same atomic rename, same
 * unique staging name, no residue.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/** Pass-through recorder over the fs boundary — hoisted so vi.mock can see it. */
const rec = vi.hoisted(() => ({
  ops: [] as string[],
  fds: new Map<number, string>(),
  reset(): void {
    this.ops.length = 0;
  },
  /** ops as a compact "verb path" trace, with the tmp suffix normalized. */
  trace(filter?: RegExp): string[] {
    return this.ops.filter((o) => (filter ? filter.test(o) : true));
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    default: real,
    openSync: (p: unknown, ...rest: unknown[]) => {
      const fd = (real.openSync as (...a: unknown[]) => number)(p, ...rest);
      rec.fds.set(fd, String(p));
      return fd;
    },
    fsyncSync: (fd: number) => {
      rec.ops.push(`fsync ${rec.fds.get(fd) ?? fd}`);
      return real.fsyncSync(fd);
    },
    renameSync: (a: unknown, b: unknown) => {
      rec.ops.push(`rename ${a} -> ${b}`);
      return real.renameSync(a as string, b as string);
    },
    writeFileSync: (target: unknown, data: unknown, ...rest: unknown[]) => {
      const name = typeof target === 'number' ? (rec.fds.get(target) ?? target) : target;
      rec.ops.push(`write ${name}`);
      return (real.writeFileSync as (...a: unknown[]) => void)(target, data, ...rest);
    },
  };
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fsyncPolicy, setFsyncPolicy, tmpNameFor, atomicWriteSync, appendDurableSync, syncDir } from '../src/warp/durable.js';
import { warplineDirOf, writeSelvage, readSelvage, appendStrand, readFabric, rewriteFabric } from '../src/fabric/fabric.js';
import { writeRef, readRef } from '../src/fabric/refs.js';
import { writeScratchRef, forkScratch, readScratch } from '../src/fabric/scratch.js';
import { ObjectStore } from '../src/warp/object-store.js';
import { computePickId, type Strand, type StrandBody } from '../src/fabric/strand.js';

const P = (n: string): string => `pick:v2:${n.repeat(64)}`;

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-durable-'));
}

/** A real (identity-reproducing) v2 strand — rewriteFabric's guard rejects junk. */
function junkStrand(seq: number): Strand {
  const body: StrandBody = {
    schemaVersion: 2, seq, parentPickId: null, stateId: `state:v0:${seq}`,
    parentStateId: null, actor: 't', intent: `s${seq}`,
    recordedAt: '2026-07-31T00:00:00.000Z', objectCount: 1,
    delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
    calibratedConfidence: null, provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
  };
  return { ...body, pickId: computePickId(body) };
}

/** The op trace with absolute paths reduced to their tail, for readable asserts. */
function tail(ops: string[], root: string): string[] {
  return ops.map((o) => o.split(root).join('').replace(/\.tmp\.\d+\.\d+/g, '.TMP'));
}

let root: string;
let wdir: string;

beforeEach(() => {
  setFsyncPolicy(null);
  delete process.env.WARPLINE_FSYNC;
  root = mkTmp();
  wdir = warplineDirOf(root);
  rec.reset();
});
afterEach(() => {
  setFsyncPolicy(null);
  delete process.env.WARPLINE_FSYNC;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('C-7 · the durable write ORDER (stage → fsync file → rename → fsync dir)', () => {
  it('writeRef: the ref bytes are fsynced BEFORE the rename and the parent dir AFTER', () => {
    writeRef(wdir, 'selvage', P('1'));
    const t = tail(rec.ops, root);
    expect(t).toEqual([
      'write /.warpline/refs/heads/selvage.TMP',
      'fsync /.warpline/refs/heads/selvage.TMP',
      'rename /.warpline/refs/heads/selvage.TMP -> /.warpline/refs/heads/selvage',
      'fsync /.warpline/refs/heads',
    ]);
    expect(readRef(wdir, 'selvage')).toBe(P('1'));
  });

  it('writeSelvage (the LEGACY tip pointer) is hardened identically', () => {
    writeSelvage(wdir, 'state:v0:abc');
    const t = tail(rec.ops, root);
    expect(t.indexOf('fsync /.warpline/refs/selvage.TMP')).toBeLessThan(
      t.findIndex((o) => o.startsWith('rename')),
    );
    expect(t[t.length - 1]).toBe('fsync /.warpline/refs');
    expect(readSelvage(wdir)).toBe('state:v0:abc');
  });

  it('appendStrand: the LEDGER append is fsynced (it was a bare appendFileSync)', () => {
    appendStrand(wdir, junkStrand(0));
    const t = tail(rec.ops, root);
    expect(t).toContain('fsync /.warpline/fabric.jsonl');
    // the CREATING append also hardens the directory entry; a later append need not
    expect(t).toContain('fsync /.warpline');
    rec.reset();
    appendStrand(wdir, junkStrand(1));
    const t2 = tail(rec.ops, root);
    expect(t2).toEqual(['write /.warpline/fabric.jsonl', 'fsync /.warpline/fabric.jsonl']);
    expect(readFabric(wdir).length).toBe(2);
  });

  it('rewriteFabric: the whole-ledger republish is hardened before it is renamed', () => {
    appendStrand(wdir, junkStrand(0));
    rec.reset();
    rewriteFabric(wdir, readFabric(wdir));
    const t = tail(rec.ops, root);
    expect(t).toEqual([
      'write /.warpline/fabric.jsonl.TMP',
      'fsync /.warpline/fabric.jsonl.TMP',
      'rename /.warpline/fabric.jsonl.TMP -> /.warpline/fabric.jsonl',
      'fsync /.warpline',
    ]);
  });

  it('loose objects are hardened (git-parity: core.fsync has covered these since 2.36)', () => {
    const store = new ObjectStore(root);
    const id = store.putBlob(Buffer.from('hello warpline'));
    const t = tail(rec.ops, root);
    const fsyncs = t.filter((o) => o.startsWith('fsync'));
    // the object's own bytes, then the fanout directory the rename published into
    expect(fsyncs.length).toBe(2);
    expect(fsyncs[0]).toMatch(/\.TMP$/);
    expect(fsyncs[1]).toMatch(/objects\/blobs\/[0-9a-f]{2}$/);
    expect(t.findIndex((o) => o.startsWith('rename'))).toBe(2);
    expect(store.getBlob(id).toString()).toBe('hello warpline');
    // idempotent re-put writes nothing at all — and therefore fsyncs nothing
    rec.reset();
    store.putBlob(Buffer.from('hello warpline'));
    expect(rec.ops).toEqual([]);
  });

  it('both scratch writers are hardened (forkScratch was a bare truncate-then-write)', () => {
    writeSelvage(wdir, 'state:v0:base');
    rec.reset();
    forkScratch(root, 'agent-1');
    expect(tail(rec.ops, root).filter((o) => o.startsWith('fsync')).length).toBe(2);
    expect(readScratch(root, 'agent-1')).toBe('state:v0:base');
    rec.reset();
    writeScratchRef(root, 'agent-1', P('7'));
    const t = tail(rec.ops, root);
    expect(t).toEqual([
      'write /.warpline/refs/scratch/agent-1.TMP',
      'fsync /.warpline/refs/scratch/agent-1.TMP',
      'rename /.warpline/refs/scratch/agent-1.TMP -> /.warpline/refs/scratch/agent-1',
      'fsync /.warpline/refs/scratch',
    ]);
  });
});

describe('C-7 · the escape hatch defaults to SAFE and changes nothing but the fsyncs', () => {
  it('WARPLINE_FSYNC is `all` when absent, empty, or UNRECOGNIZED (fail safe)', () => {
    expect(fsyncPolicy()).toBe('all');
    for (const v of ['', '   ', 'yes-please', 'batch', 'writeout-only']) {
      process.env.WARPLINE_FSYNC = v;
      expect(fsyncPolicy()).toBe('all');
    }
    for (const v of ['none', 'NONE', 'off', '0', 'false']) {
      process.env.WARPLINE_FSYNC = v;
      expect(fsyncPolicy()).toBe('none');
    }
  });

  it('WARPLINE_FSYNC=none: zero fsyncs, identical bytes, still atomic, no residue', () => {
    process.env.WARPLINE_FSYNC = 'none';
    writeRef(wdir, 'selvage', P('1'));
    writeSelvage(wdir, 'state:v0:abc');
    appendStrand(wdir, junkStrand(0));
    writeScratchRef(root, 'agent-1', P('7'));
    const store = new ObjectStore(root);
    const id = store.putBlob(Buffer.from('durable-off'));

    expect(rec.ops.filter((o) => o.startsWith('fsync'))).toEqual([]);
    // still tmp+rename — turning fsync off must not turn ATOMICITY off
    expect(rec.ops.filter((o) => o.startsWith('rename')).length).toBe(4);
    // ...and the staging names are still unique (C-15 is not gated on the policy)
    for (const o of rec.ops.filter((o) => o.startsWith('rename'))) {
      expect(o).toMatch(/\.tmp\.\d+\.\d+ ->/);
    }
    expect(readRef(wdir, 'selvage')).toBe(P('1'));
    expect(readSelvage(wdir)).toBe('state:v0:abc');
    expect(readFabric(wdir).length).toBe(1);
    expect(readScratch(root, 'agent-1')).toBe(P('7'));
    expect(store.getBlob(id).toString()).toBe('durable-off');
    expect(fs.readdirSync(path.join(wdir, 'refs', 'heads'))).toEqual(['selvage']);
  });

  it('setFsyncPolicy overrides the environment in both directions', () => {
    process.env.WARPLINE_FSYNC = 'none';
    setFsyncPolicy('all');
    writeRef(wdir, 'a', P('1'));
    expect(rec.ops.filter((o) => o.startsWith('fsync')).length).toBe(2);
    rec.reset();
    delete process.env.WARPLINE_FSYNC;
    setFsyncPolicy('none');
    writeRef(wdir, 'b', P('2'));
    expect(rec.ops.filter((o) => o.startsWith('fsync'))).toEqual([]);
    setFsyncPolicy(null);
  });
});

describe('C-7 · atomicWriteSync leaves no residue and never clobbers a live file', () => {
  it('a failed rename removes the staging file instead of leaving a stray', () => {
    const target = path.join(root, 'sub', 'file');
    fs.mkdirSync(target, { recursive: true }); // rename-onto-a-directory fails
    expect(() => atomicWriteSync(target, 'x')).toThrow();
    expect(fs.readdirSync(path.join(root, 'sub'))).toEqual(['file']);
  });

  it('the staging fd is opened O_EXCL, so a name collision refuses rather than clobbers', () => {
    // Belt-and-braces beneath the unique name: even if two writers somehow chose
    // the same staging path, the second refuses instead of overwriting.
    const collide = tmpNameFor(path.join(root, 'f'));
    fs.writeFileSync(collide, 'squatter');
    expect(() => fs.openSync(collide, 'wx')).toThrow(/EEXIST/);
    expect(fs.readFileSync(collide, 'utf8')).toBe('squatter');
  });

  it('syncDir does NOT swallow a real error — silent non-durability is the bug', () => {
    // The tolerance in syncDir is for platforms that cannot fsync a directory at
    // all. Anything else must reach the caller rather than be reported as hardened.
    expect(() => syncDir(path.join(root, 'no-such-dir'))).toThrow(/ENOENT/);
    // ...and it is genuinely gated on the policy, not on the error handling
    setFsyncPolicy('none');
    expect(() => syncDir(path.join(root, 'no-such-dir'))).not.toThrow();
  });

  it('on POSIX an EACCES on the directory PROPAGATES — it is not "no dir fsync here"', () => {
    // The narrow tolerance is the whole point: EISDIR/EPERM/EACCES mean "this
    // platform has no directory fsync" ONLY on Windows. A tolerant-everywhere
    // catch would turn an unreadable directory into a silent claim of durability.
    if (process.platform === 'win32') return;
    if (typeof process.getuid === 'function' && process.getuid() === 0) return; // root ignores mode bits
    const dir = path.join(root, 'unreadable');
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o333); // write+execute, NOT readable ⇒ open(dir,'r') = EACCES
    try {
      expect(() => syncDir(dir)).toThrow(/EACCES/);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });

  it('appendDurableSync creates then appends, and the bytes survive a re-read', () => {
    const p = path.join(root, 'log.jsonl');
    appendDurableSync(p, 'one\n');
    appendDurableSync(p, 'two\n');
    expect(fs.readFileSync(p, 'utf8')).toBe('one\ntwo\n');
  });
});
