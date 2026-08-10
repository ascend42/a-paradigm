/**
 * state-cache-durability.test — the `.warpline/states/` snapshot was the one
 * Warpline write that could fail and say nothing, and the one that could not
 * afford to.
 *
 * WHAT WAS WRONG. store.ts's writer was:
 *
 *     try { fs.writeFileSync(full, JSON.stringify(value)) }
 *     catch { /* disk cache is best-effort *\/ }
 *
 * — no fsync (every other Warpline write goes through durable.ts since C-7), no
 * atomicity, and a swallowed error. On a full disk the snapshot silently did not
 * land, the strand SEALED anyway, and every later `loadState` for that stateId
 * returned undefined: indistinguishable from "never written", and a PERMANENT
 * fail-closed for that base (native.ts propose, pick.ts, admit.ts, anchor.ts,
 * stake.ts all refuse on it). A failed write wearing the costume of a cache miss.
 *
 * WHAT THESE ASSERT, AND AGAINST WHICH AUTHORITY. The interesting ones do not stop
 * at "putState threw" — they drive the real `sealState` and assert against the
 * LEDGER: when the snapshot cannot be written, `fabric.jsonl` must be untouched.
 * That is the property that makes throwing safe (every putState precedes its
 * appendStrand) and it is the one a mutation cannot dodge by simply not running.
 *
 * The fs boundary is recorded pass-through (the durable-write-path.test.ts
 * pattern) so the durable ORDER — stage, fsync file, rename, fsync dir — is
 * asserted rather than merely the presence of an fsync.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/** Pass-through fs recorder — hoisted so vi.mock can see it. */
const rec = vi.hoisted(() => ({
  ops: [] as string[],
  fds: new Map<number, string>(),
  reset(): void {
    this.ops.length = 0;
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
import * as zlib from 'node:zlib';
import { WarpStore, serializeState } from '../src/warp/store.js';
import { sealState } from '../src/fabric/seal.js';
import { warplineDirOf, readFabric, readSelvage } from '../src/fabric/fabric.js';
import type { WarpState } from '../src/warp/warp-state.js';
import type { WarpObject } from '../src/warp/warp-object.js';

let root: string;
let wdir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-statecache-'));
  wdir = warplineDirOf(root);
  rec.reset();
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A state whose objects carry realistically REPETITIVE prose — the shape gzip eats. */
function mkState(stateId: string, n = 40): WarpState {
  const objects = new Map<string, WarpObject>();
  for (let i = 0; i < n; i++) {
    const symbol = `#component-${i}`;
    objects.set(symbol, {
      symbol,
      kind: 'component',
      stableKey: `packages/thing/src/component-${i}.ts#component-${i}`,
      contentId: `warp:v0:${String(i).padStart(2, '0').repeat(32)}`,
      contract: {
        description: 'Handles the thing that the other thing needs handled, carefully.',
        endpoints: [`GET /api/thing/${i}`, `POST /api/thing/${i}`],
        gates: ['^authenticated', '^resource-owner'],
        signals: ['!thing-created', '!thing-updated'],
      },
    } as unknown as WarpObject);
  }
  return { ref: 'WORKTREE', treeSha: null, stateId, absorbedAt: '2026-08-10T00:00:00.000Z', objects };
}

const SAFE = (id: string): string => id.replace(/[^a-zA-Z0-9._-]/g, '_');
const gzPath = (id: string): string => path.join(wdir, 'states', `${SAFE(id)}.json.gz`);
const jsonPath = (id: string): string => path.join(wdir, 'states', `${SAFE(id)}.json`);
const tail = (ops: string[]): string[] =>
  ops.map((o) => o.split(root).join('').replace(/\.tmp\.\d+\.\d+/g, '.TMP'));

describe('the state snapshot is written through durable.ts (audit C-7 discipline)', () => {
  it('putState stages, fsyncs the BYTES, renames, then fsyncs the DIRECTORY', () => {
    const store = new WarpStore(root, { diskCache: true });
    const state = mkState('state:v0:aaa', 2);
    rec.reset();
    store.putState(state);

    const stateOps = tail(rec.ops).filter((o) => o.includes('/states'));
    expect(stateOps).toEqual([
      'write /.warpline/states/state_v0_aaa.json.gz.TMP',
      'fsync /.warpline/states/state_v0_aaa.json.gz.TMP',
      'rename /.warpline/states/state_v0_aaa.json.gz.TMP -> /.warpline/states/state_v0_aaa.json.gz',
      'fsync /.warpline/states',
    ]);
    // no staging residue left behind
    expect(fs.readdirSync(path.join(wdir, 'states'))).toEqual(['state_v0_aaa.json.gz']);
  });

  it('the ZERO-READER object mirror is NOT fsynced — ~13.8k files/seal at 3.66 ms each', () => {
    // Consistency would say harden both; cost says otherwise, and the justification
    // is only honest if it is also enforced. Hardening the mirror would add ~100 s
    // to every seal on this repo, to protect files nothing ever reads.
    const store = new WarpStore(root, { diskCache: true });
    rec.reset();
    store.putState(mkState('state:v0:bbb', 12));
    const mirrorOps = tail(rec.ops).filter((o) => o.includes('/warp/objects/'));
    expect(mirrorOps.length).toBe(12); // one plain write per object
    expect(mirrorOps.every((o) => o.startsWith('write '))).toBe(true);
    expect(mirrorOps.filter((o) => o.startsWith('fsync')).length).toBe(0);
  });
});

describe('a failed snapshot write is LOUD, and the ledger stays untouched', () => {
  /** Make `.warpline/states` unwritable by parking a FILE where the dir must go. */
  function blockStatesDir(): void {
    fs.mkdirSync(wdir, { recursive: true });
    fs.writeFileSync(path.join(wdir, 'states'), 'not a directory', 'utf8');
  }

  it('putState THROWS and names it a failed write rather than a cache miss', () => {
    blockStatesDir();
    const store = new WarpStore(root, { diskCache: true });
    let caught: Error | undefined;
    try {
      store.putState(mkState('state:v0:ccc', 3));
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('FAILED WRITE, not a cache miss');
    expect(caught!.message).toContain('state:v0:ccc');
    expect(caught!.message).toContain('Nothing has been appended to the ledger');
    expect((caught as Error & { cause?: unknown }).cause).toBeDefined(); // the errno survives
  });

  it('AUTHORITY: sealState refuses and fabric.jsonl gains NO strand', () => {
    // The property that makes throwing the right call: every putState precedes its
    // appendStrand, so a snapshot failure costs a refusal, never a half-history.
    blockStatesDir();
    const store = new WarpStore(root, { diskCache: true });
    expect(readFabric(wdir).length).toBe(0);

    expect(() =>
      sealState(root, store, mkState('state:v0:ddd', 3), {
        actor: 'test',
        intent: 'seal onto a wedged states dir',
        now: '2026-08-10T00:00:00.000Z',
        parentStateId: null,
        gitCommit: null,
      }),
    ).toThrow(/FAILED WRITE, not a cache miss/);

    // The ledger and BOTH tip pointers are exactly as they were.
    expect(readFabric(wdir).length).toBe(0);
    expect(readSelvage(wdir)).toBe(null);
    expect(fs.existsSync(path.join(wdir, 'refs', 'heads', 'selvage'))).toBe(false);
  });

  it('CONTROL: with the states dir writable, that same seal succeeds and is loadable', () => {
    const store = new WarpStore(root, { diskCache: true });
    const strand = sealState(root, store, mkState('state:v0:ddd', 3), {
      actor: 'test',
      intent: 'seal onto a healthy states dir',
      now: '2026-08-10T00:00:00.000Z',
      parentStateId: null,
      gitCommit: null,
    });
    expect(readFabric(wdir).length).toBe(1);
    expect(strand.stateId).toBe('state:v0:ddd');
    // ...and a COLD reader (fresh store, empty in-mem map) gets it back off disk.
    expect(new WarpStore(root, { diskCache: true }).loadState('state:v0:ddd')?.objects.size).toBe(3);
  });

  it('the object mirror does NOT throw — it is counted, and the snapshot still lands', () => {
    // A file parked where `.warpline/warp` must be wedges only the debug mirror.
    fs.mkdirSync(wdir, { recursive: true });
    fs.writeFileSync(path.join(wdir, 'warp'), 'not a directory', 'utf8');
    const store = new WarpStore(root, { diskCache: true });
    expect(store.cacheHealth()).toEqual({ objectMirrorFailures: 0, firstObjectMirrorError: null });

    expect(() => store.putState(mkState('state:v0:eee', 5))).not.toThrow();

    const health = store.cacheHealth();
    expect(health.objectMirrorFailures).toBe(5); // counted, not swallowed
    expect(health.firstObjectMirrorError).toMatch(/ENOTDIR|EEXIST|ENOENT/);
    // ...and the thing that actually matters was written anyway
    expect(fs.existsSync(gzPath('state:v0:eee'))).toBe(true);
    expect(new WarpStore(root, { diskCache: true }).loadState('state:v0:eee')?.objects.size).toBe(5);
  });

  it('CONTROL: diskCache:false touches no disk at all and never throws', () => {
    blockStatesDir(); // even with the dir wedged
    const store = new WarpStore(root, { diskCache: false });
    expect(() => store.putState(mkState('state:v0:fff', 3))).not.toThrow();
    expect(store.getState('state:v0:fff')?.objects.size).toBe(3); // in-mem only
    expect(store.cacheHealth().objectMirrorFailures).toBe(0);
  });
});

describe('the snapshot is gzipped, and both forms still load (7.9× measured)', () => {
  it('putState writes <stateId>.json.gz — a real gzip stream — and no plain .json', () => {
    const store = new WarpStore(root, { diskCache: true });
    store.putState(mkState('state:v0:ggg'));
    expect(fs.existsSync(gzPath('state:v0:ggg'))).toBe(true);
    expect(fs.existsSync(jsonPath('state:v0:ggg'))).toBe(false);
    const bytes = fs.readFileSync(gzPath('state:v0:ggg'));
    expect(bytes[0]).toBe(0x1f); // gzip magic — not JSON that merely got renamed
    expect(bytes[1]).toBe(0x8b);
    // the filename is still the CONTENT ADDRESS, only the extension moved
    expect(path.basename(gzPath('state:v0:ggg'))).toBe('state_v0_ggg.json.gz');
  });

  it('compression is REAL on snapshot-shaped data (≥3× on the on-disk artifact)', () => {
    const store = new WarpStore(root, { diskCache: true });
    const state = mkState('state:v0:hhh', 200);
    store.putState(state);
    const plain = Buffer.byteLength(JSON.stringify(serializeState(state)), 'utf8');
    const onDisk = fs.statSync(gzPath('state:v0:hhh')).size;
    expect(onDisk).toBeLessThan(plain / 3);
    // and it round-trips byte-exactly through the reader
    expect(JSON.parse(zlib.gunzipSync(fs.readFileSync(gzPath('state:v0:hhh'))).toString('utf8'))).toEqual(
      JSON.parse(JSON.stringify(serializeState(state))),
    );
  });

  it('MIGRATION: a pre-compression <stateId>.json still loads, untouched', () => {
    // Written exactly the way the old code wrote it.
    const legacy = mkState('state:v0:iii', 7);
    fs.mkdirSync(path.join(wdir, 'states'), { recursive: true });
    fs.writeFileSync(jsonPath('state:v0:iii'), JSON.stringify(serializeState(legacy)), 'utf8');

    const loaded = new WarpStore(root, { diskCache: true }).loadState('state:v0:iii');
    expect(loaded?.objects.size).toBe(7);
    expect(loaded?.ref).toBe('WORKTREE');
    expect(loaded?.absorbedAt).toBe('2026-08-10T00:00:00.000Z');
    // LEFT ALONE: reading does not convert, delete or rewrite it.
    expect(fs.existsSync(jsonPath('state:v0:iii'))).toBe(true);
    expect(fs.existsSync(gzPath('state:v0:iii'))).toBe(false);
  });

  it('when BOTH forms exist the compressed one wins (it can only be the newer write)', () => {
    fs.mkdirSync(path.join(wdir, 'states'), { recursive: true });
    const stale = mkState('state:v0:jjj', 2);
    fs.writeFileSync(jsonPath('state:v0:jjj'), JSON.stringify(serializeState(stale)), 'utf8');
    new WarpStore(root, { diskCache: true }).putState(mkState('state:v0:jjj', 9));

    expect(fs.existsSync(jsonPath('state:v0:jjj'))).toBe(true); // still there, still stale
    expect(new WarpStore(root, { diskCache: true }).loadState('state:v0:jjj')?.objects.size).toBe(9);
  });

  it('an unreadable snapshot answers undefined (fail-closed), not a crash', () => {
    fs.mkdirSync(path.join(wdir, 'states'), { recursive: true });
    fs.writeFileSync(gzPath('state:v0:kkk'), Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00])); // torn deflate
    expect(new WarpStore(root, { diskCache: true }).loadState('state:v0:kkk')).toBeUndefined();
    expect(new WarpStore(root, { diskCache: true }).loadState('state:v0:never-written')).toBeUndefined();
  });
});
