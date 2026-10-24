/**
 * @symbol #kernel-log
 *
 * #kernel-log (spec §3.2) — faults INSIDE a rotation, injected at the
 * directory fsync of `log/segments/` (the first durability step after the
 * seal rename). `fsyncDir` is replaced through the module mock below on every
 * OS (no platform branch, G-WIN-05: the injected EIO is raised before the
 * real helper runs, so the win32 no-op is never reached).
 *
 *   - T-2026-10-17-013(a): a failure after the active db is closed HALTS the
 *     instance (append refuses ENGINE{rotation-failed}, reads refuse closed,
 *     close() reports it, no timer touches the closed handle); reopen
 *     completes the rotation.
 *   - T-2026-10-17-015(2): completing a crashed rotation on open with a
 *     lagging (non-relaxed) file anchor rewrites the file anchor BEFORE
 *     sealing, so a crash between the seal rename and the new kernel.db
 *     reopens as a rotation window, never missing-db.
 *   - T-2026-10-17-012 (S34-25) / T-015(4): the same crash in a RELAXED
 *     cross-boot open (P8-D85) leaves the lagging file anchor (the evidence)
 *     and no kernel.db; the next open in another boot accepts it, creates the
 *     segment and appends the relaxed daemon.anchor.lag row there first, the
 *     file anchor second. Same boot / keyless refuse with nothing written.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FILE_ANCHOR_MAX_LAG, KernelLog, LogRefusal, SoftwareEd25519Signer, type AnchorStore, type HeadAnchor, type Signer } from '../src/kernel/log/index.js';
import { acknowledgeGap, mintTestPresence, openKernelLog, openKernelLogForRecovery, type KernelLogTestOptions } from '../src/kernel/testing.js';

const fault = vi.hoisted(() => ({ armed: false, hits: 0 }));
vi.mock('../src/kernel/log/anchor.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/kernel/log/anchor.js')>();
  return {
    ...orig,
    fsyncDir: (dir: string): void => {
      if (fault.armed && dir.replace(/\\/g, '/').endsWith('/log/segments')) {
        fault.hits++;
        throw Object.assign(new Error(`EIO: i/o error (injected), fsync '${dir}'`), { code: 'EIO' });
      }
      orig.fsyncDir(dir);
    },
  };
});

const KERNEL = 'p:abcdefgh/kernel';
const KERNEL_KEY = SoftwareEd25519Signer.generate();
const BOOT_A = 'AAAAAAAA-0000-4000-8000-00000000000A';
const BOOT_B = 'BBBBBBBB-0000-4000-8000-00000000000B';
const homes: string[] = [];
const opened: KernelLog[] = [];

afterEach(async () => {
  fault.armed = false;
  fault.hits = 0;
  for (const l of opened.splice(0)) {
    try {
      await l.close();
    } catch {
      /* already closed */
    }
  }
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

function tmpHome(): string {
  const h = mkdtempSync(path.join(os.tmpdir(), 'gnomon-rotfault-'));
  homes.push(h);
  return h;
}

type MemKs = AnchorStore & { stored?: HeadAnchor; writes: number; down?: boolean };
function memKeystore(): MemKs {
  const ks: MemKs = {
    name: 'keystore',
    writes: 0,
    read: () => (ks.stored ? { state: 'present', head: ks.stored } : { state: 'absent' }),
    write: async (h) => {
      if (ks.down) throw new Error('helper gone');
      ks.writes++;
      ks.stored = h;
    },
  };
  return ks;
}

const base = (home: string, ks: AnchorStore, bootSession: string, segmentRows: number, signer: Signer | null = KERNEL_KEY): KernelLogTestOptions => ({
  home,
  kernelPrincipal: KERNEL,
  signer,
  keystoreAnchor: ks,
  bootSession,
  kernelKeyIds: [KERNEL_KEY.keyId],
  segmentRows,
});

function refusalOf(fn: () => unknown): LogRefusal {
  try {
    fn();
  } catch (err) {
    if (err instanceof LogRefusal) return err;
    throw err;
  }
  throw new Error('expected a LogRefusal');
}

async function rejection(p: Promise<unknown>): Promise<LogRefusal> {
  try {
    await p;
  } catch (err) {
    if (err instanceof LogRefusal) return err;
    throw err;
  }
  throw new Error('expected a LogRefusal');
}

async function fill(log: KernelLog, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await log.append({ kind: 'session.open', principal: KERNEL, payload: { i } });
}

/** Let queued promises and short timers run (a stray checkpoint / anchor write on a closed handle would surface here). */
async function drain(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setTimeout(r, 20));
  }
}

/** The kernel key, except that its `failOn`-th signature (1-based) throws — an injected failure mid-open. */
function failingSigner(failOn: number): Signer {
  let n = 0;
  return {
    keyId: KERNEL_KEY.keyId,
    keyClass: KERNEL_KEY.keyClass,
    custody: KERNEL_KEY.custody,
    sign(domain, message) {
      if (++n === failOn) throw new Error('injected signer failure');
      return KERNEL_KEY.sign(domain, message);
    },
  };
}

const headFile = (home: string) => path.join(home, 'head');
const activeDb = (home: string) => path.join(home, 'kernel.db');
const sealed1 = (home: string) => path.join(home, 'log', 'segments', '000001.db');

function rowsOf(file: string): Array<{ seq: number; hash: string; kind: string; envelope: string }> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare('SELECT seq, hash, kind, envelope FROM chain ORDER BY seq').all() as Array<{ seq: number; hash: string; kind: string; envelope: string }>;
  } finally {
    db.close();
  }
}

/**
 * Crash window 2 in boot A: segment 1 (rows 1..seg-1 + the closing row `seg`)
 * is back in kernel.db, the rename never happened; the keystore anchor holds
 * the closing row (no clean-close marker); the file anchor is the head file
 * captured at seq `fileAt` (no clean-close marker).
 */
async function rotationWindow2(seg: number, fileAt: number): Promise<{ home: string; ks: MemKs; closing: { seq: number; hash: string }; head: string }> {
  const home = tmpHome();
  const ks = memKeystore();
  const l1 = openKernelLog(base(home, ks, BOOT_A, seg));
  await fill(l1, fileAt);
  l1.checkpoint();
  await l1.flushAnchors();
  const head = readFileSync(headFile(home), 'utf8');
  expect(JSON.parse(head)).toMatchObject({ seq: fileAt });
  await fill(l1, seg - 1 - fileAt); // … + the closing daemon.segment row `seg` → rotated
  await l1.close();
  const rows = rowsOf(sealed1(home));
  const closing = rows.at(-1)!;
  expect([closing.seq, closing.kind]).toEqual([seg, 'daemon.segment']);
  for (const sfx of ['', '-wal', '-shm']) rmSync(`${activeDb(home)}${sfx}`, { force: true });
  renameSync(sealed1(home), activeDb(home));
  const { closed: _c, ...k } = ks.stored!;
  ks.stored = k;
  writeFileSync(headFile(home), head);
  return { home, ks, closing, head };
}

describe('#kernel-log rotation faults', () => {
  it('T-013(a): an fsyncDir EIO after the seal rename halts the instance with ENGINE{rotation-failed}; reopen completes the rotation', async () => {
    const SEG = 4;
    const home = tmpHome();
    const ks = memKeystore();
    const log = openKernelLog(base(home, ks, BOOT_A, SEG));
    await fill(log, 2);
    fault.armed = true;
    const r = await rejection(log.append({ kind: 'session.open', principal: KERNEL, payload: { i: 3 } })); // row 3 → closing row 4 → seal
    expect([r.refusal.code, r.reason]).toEqual(['ENGINE', 'rotation-failed']);
    expect(r.refusal.data).toMatchObject({ segment: 1, closingSeq: SEG });
    expect(fault.hits).toBe(1);
    fault.armed = false;
    // halted: every later append refuses the same way, reads refuse closed, no timer fires on the closed handle
    expect((await rejection(log.append({ kind: 'session.open', principal: KERNEL, payload: { i: 9 } }))).reason).toBe('rotation-failed');
    expect(refusalOf(() => log.readPage({ reader: { class: 'human' }, afterSeq: 0, maxScan: 10, visit: () => true })).reason).toBe('closed');
    await drain();
    const closed = await log.close();
    expect(closed.keystore).toBe('failed');
    expect(closed.error).toMatch(/rotation of segment 1 failed/);
    // on disk: a rotation window (sealed segment, no kernel.db, file anchor at the closing row)
    expect(existsSync(sealed1(home))).toBe(true);
    expect(existsSync(activeDb(home))).toBe(false);
    const closing = rowsOf(sealed1(home)).at(-1)!;
    expect(JSON.parse(readFileSync(headFile(home), 'utf8'))).toMatchObject({ seq: SEG, hash: closing.hash });

    const l2 = openKernelLog(base(home, ks, BOOT_A, SEG));
    opened.push(l2);
    expect(l2.report).toMatchObject({ recoveredRotation: true });
    expect(l2.head()).toMatchObject({ segment: 2, seq: SEG });
    await fill(l2, 1);
    expect(l2.verify().ok).toBe(true);
  });

  it('round 2: a CRITICAL append whose rotation halts resolves anchored (row committed + anchored); the halt surfaces on the next call', async () => {
    const SEG = 4;
    const home = tmpHome();
    const ks = memKeystore();
    const log = openKernelLog(base(home, ks, BOOT_A, SEG));
    await fill(log, 2);
    fault.armed = true;
    const r = await log.append({ kind: 'approval.decide', principal: KERNEL, payload: { decision: 'allow' } }); // row 3 → closing row 4 → seal fails
    expect(r).toMatchObject({ seq: 3, anchored: 'both' });
    expect(fault.hits).toBe(1);
    fault.armed = false;
    expect(log.integrity).toEqual({ state: 'ok' }); // no anchor fault: the critical row's anchors succeeded before the rotation
    expect((await rejection(log.append({ kind: 'session.open', principal: KERNEL, payload: { i: 9 } }))).reason).toBe('rotation-failed');
    expect((await log.close()).keystore).toBe('failed');
    expect(ks.stored).toMatchObject({ seq: 3, hash: r.hash }); // the keystore anchored the critical row; the rotation wrote none
    // reopen: the rotation completes; the critical row is committed, anchored and needs no daemon.anchor.failed marker
    const l2 = openKernelLog(base(home, ks, BOOT_A, SEG));
    opened.push(l2);
    expect(l2.report).toMatchObject({ recoveredRotation: true });
    expect(rowsOf(sealed1(home)).map((x) => x.kind)).toEqual(['session.open', 'session.open', 'approval.decide', 'daemon.segment']);
    expect(rowsOf(activeDb(home))).toEqual([]);
    expect(l2.verify().ok).toBe(true);
  });

  it('round 3: close() of an anchor-faulted log whose pending marker reaches the boundary and halts RETURNS its report (never throws)', async () => {
    const SEG = 4;
    const home = tmpHome();
    const ks = memKeystore();
    // signatures: row 1 (#1), critical row 2 (#2), its immediate marker (#3 — fails ⇒ the marker stays pending)
    const log = openKernelLog(base(home, ks, BOOT_A, SEG, failingSigner(3)));
    await fill(log, 1);
    await log.flushAnchors(); // keystore anchor at seq 1
    ks.down = true;
    expect((await rejection(log.append({ kind: 'approval.decide', principal: KERNEL, payload: { decision: 'allow' } }))).reason).toBe('anchor-failed');
    expect(log.integrity).toMatchObject({ state: 'anchor-faulted', failed: [{ seq: 2, recorded: false }] });
    // close: the pending marker (row 3) brings the segment to its boundary ⇒ closing row 4 ⇒ the seal halts
    fault.armed = true;
    const report = await log.close();
    expect(fault.hits).toBe(1);
    expect(report.keystore).toBe('failed');
    expect(report.error).toMatch(/rotation of segment 1 failed after the closing row was committed/);
    fault.armed = false;
    ks.down = false;
    expect(rowsOf(sealed1(home)).map((x) => x.kind)).toEqual(['session.open', 'approval.decide', 'daemon.anchor.failed', 'daemon.segment']);
    // reopen completes the rotation; the critical row has its marker (no new one), verify ok
    const l2 = openKernelLog(base(home, ks, BOOT_A, SEG));
    opened.push(l2);
    expect(l2.report).toMatchObject({ recoveredRotation: true });
    expect(rowsOf(activeDb(home))).toEqual([]);
    expect(l2.verify().ok).toBe(true);
  });

  it('round 3: a critical append that re-anchors a faulted log and halts in that rotation refuses rotation-failed (not anchor-faulted)', async () => {
    const SEG = 4;
    const home = tmpHome();
    const ks = memKeystore();
    const log = openKernelLog(base(home, ks, BOOT_A, SEG, failingSigner(3)));
    await fill(log, 1);
    await log.flushAnchors();
    ks.down = true;
    await rejection(log.append({ kind: 'approval.decide', principal: KERNEL, payload: { decision: 'allow' } }));
    ks.down = false;
    fault.armed = true;
    const r = await rejection(log.append({ kind: 'approval.decide', principal: KERNEL, payload: { decision: 'deny' } }));
    expect([r.refusal.code, r.reason]).toEqual(['ENGINE', 'rotation-failed']);
    fault.armed = false;
    expect((await log.close()).keystore).toBe('failed');
  });

  it('round 2: a failure BEFORE the db is closed (the durable closing-row file anchor) halts too — no row is ever appended after daemon.segment', async () => {
    const SEG = 4;
    const home = tmpHome();
    const ks = memKeystore();
    // no coalesced file-anchor write or idle checkpoint between the injection and the rotation
    const log = openKernelLog({ ...base(home, ks, BOOT_A, SEG), fileAnchorMaxMs: 600_000, checkpointIdleMs: 600_000 });
    await fill(log, 2);
    await log.flushAnchors();
    mkdirSync(path.join(home, 'head.tmp')); // the head anchor's tmp path is a directory: the durable write fails (every OS)
    const r = await rejection(log.append({ kind: 'session.open', principal: KERNEL, payload: { i: 3 } }));
    expect([r.refusal.code, r.reason]).toEqual(['ENGINE', 'rotation-failed']);
    expect((await rejection(log.append({ kind: 'session.open', principal: KERNEL, payload: { i: 4 } }))).reason).toBe('rotation-failed');
    await drain();
    expect((await log.close()).keystore).toBe('failed');
    rmSync(path.join(home, 'head.tmp'), { recursive: true });
    // kernel.db still holds segment 1 ending at the closing row (window 2), nothing after it
    expect(rowsOf(activeDb(home)).at(-1)).toMatchObject({ seq: SEG, kind: 'daemon.segment' });
    const l2 = openKernelLog(base(home, ks, BOOT_A, SEG));
    opened.push(l2);
    expect(l2.report).toMatchObject({ recoveredRotation: true });
    expect(l2.head()).toMatchObject({ segment: 2, seq: SEG });
    expect(l2.verify().ok).toBe(true);
  });

  it('round 2: a rotation halt inside acknowledgeGap (stated residual): rotation-failed, the keystore evidence untouched, reopen refuses missing-db', async () => {
    const SEG = 4;
    const home = tmpHome();
    const ks = memKeystore();
    const log = openKernelLog(base(home, ks, BOOT_A, SEG));
    await fill(log, 4); // rows 1..3 + closing row 4, row 5 in segment 2
    await log.flushAnchors();
    const at5 = { ...ks.stored! };
    await log.close();
    ks.stored = at5; // the power cut: keystore @5 (boot A, not closed)
    for (const s of ['', '-wal', '-shm']) rmSync(`${activeDb(home)}${s}`, { force: true });
    renameSync(sealed1(home), activeDb(home)); // segment 2 lost; segment 1 back in kernel.db
    const rec = openKernelLogForRecovery(base(home, ks, BOOT_B, SEG));
    expect(rec.report.integrity).toMatchObject({ state: 'truncated', cause: 'unclean-reboot', lostFrom: 5, lostTo: 5 });
    const writesBefore = ks.writes;
    fault.armed = true;
    const r = await rejection(acknowledgeGap(rec, { presenceToken: mintTestPresence() }));
    expect(r.reason).toBe('rotation-failed');
    fault.armed = false;
    await drain();
    expect(ks.writes).toBe(writesBefore);
    expect(ks.stored).toEqual(at5); // the ahead keystore anchor (the evidence) was never rewritten
    expect((await rejection(acknowledgeGap(rec, { presenceToken: mintTestPresence() }))).reason).toBe('rotation-failed');
    expect((await rec.close()).keystore).toBe('failed');
    expect(existsSync(activeDb(home))).toBe(false);
    expect(refusalOf(() => openKernelLogForRecovery(base(home, ks, BOOT_B, SEG))).reason).toBe('missing-db'); // fail-closed; quarantine recovers
  });

  it('T-015(2): window-2 completion with a lagging file anchor rewrites it BEFORE sealing — a crash after the seal rename reopens as a rotation window', async () => {
    const SEG = 8;
    const { home, ks, closing } = await rotationWindow2(SEG, 1); // file anchor lags the closing row by 7 (≤ 63, not relaxed)
    fault.armed = true;
    const r = refusalOf(() => openKernelLog(base(home, ks, BOOT_A, SEG)));
    expect(r.reason).toBe('rotation-failed');
    fault.armed = false;
    expect(existsSync(activeDb(home))).toBe(false);
    expect(existsSync(sealed1(home))).toBe(true);
    // the rewrite ran first: the file anchor is AT the closing row (was seq 1)
    expect(JSON.parse(readFileSync(headFile(home), 'utf8'))).toMatchObject({ seq: SEG, hash: closing.hash });

    const l2 = openKernelLog(base(home, ks, BOOT_A, SEG));
    opened.push(l2);
    expect(l2.report).toMatchObject({ recoveredRotation: true, anchorLag: 0 });
    expect(l2.head()).toMatchObject({ segment: 2, seq: SEG });
    expect(l2.verify().ok).toBe(true);
  });

  it('T-012 (S34-25) + T-015(4): a relaxed cross-boot open whose rotation crashes after the seal rename reopens relaxed — row first, anchor second', async () => {
    const SEG = FILE_ANCHOR_MAX_LAG + 7; // 70: closing row 70, file anchor at seq 1 ⇒ lag 69 > 63
    const { home, ks, closing, head } = await rotationWindow2(SEG, 1);
    const ksBefore = JSON.stringify(ks.stored);
    const writesBefore = ks.writes;

    // boot B, relaxed (P8-D85): the rotation completion runs before the row and crashes after the seal rename
    fault.armed = true;
    expect(refusalOf(() => openKernelLog(base(home, ks, BOOT_B, SEG))).reason).toBe('rotation-failed');
    fault.armed = false;
    expect(existsSync(activeDb(home))).toBe(false);
    expect(rowsOf(sealed1(home)).at(-1)).toMatchObject({ seq: SEG, kind: 'daemon.segment' }); // no lag row was committed
    expect(readFileSync(headFile(home), 'utf8')).toBe(head); // the lagging file anchor is still the evidence
    await drain();
    expect([JSON.stringify(ks.stored), ks.writes]).toEqual([ksBefore, writesBefore]);

    // fail closed, nothing written: the same boot (not relaxable) ⇒ missing-db; keyless ⇒ kernel-key-required
    const same = refusalOf(() => openKernelLog(base(home, ks, BOOT_A, SEG)));
    expect([same.refusal.code, same.reason]).toEqual(['INTEGRITY_BROKEN', 'missing-db']);
    const keyless = refusalOf(() => openKernelLog(base(home, ks, BOOT_B, SEG, null)));
    expect([keyless.refusal.code, keyless.reason]).toEqual(['FORBIDDEN', 'kernel-key-required']);
    expect(existsSync(activeDb(home))).toBe(false);
    expect(readFileSync(headFile(home), 'utf8')).toBe(head);

    // row first: the signed row fails after the segment is created ⇒ the file anchor is still the evidence
    expect(() => openKernelLog(base(home, ks, BOOT_B, SEG, failingSigner(1)))).toThrow(/injected signer failure/);
    expect(existsSync(activeDb(home))).toBe(true);
    expect(readFileSync(headFile(home), 'utf8')).toBe(head);
    await drain();
    expect([JSON.stringify(ks.stored), ks.writes]).toEqual([ksBefore, writesBefore]);

    // boot B again: the relaxation still holds; exactly one daemon.anchor.lag{which: file} in segment 2, then the anchor
    const l = openKernelLog(base(home, ks, BOOT_B, SEG));
    opened.push(l);
    expect(l.report).toMatchObject({ anchorLag: SEG - 1, anchors: { file: 'lagging-repaired' } });
    const lag = rowsOf(activeDb(home));
    expect(lag).toHaveLength(1);
    expect(lag[0]).toMatchObject({ seq: SEG + 1, kind: 'daemon.anchor.lag' });
    expect(JSON.parse(lag[0]!.envelope).payload).toEqual({ rows: SEG - 1, which: 'file', bootPrev: BOOT_A, bootNow: BOOT_B });
    expect(JSON.parse(readFileSync(headFile(home), 'utf8'))).toMatchObject({ seq: SEG + 1, segment: 2, hash: lag[0]!.hash });
    expect(l.head()).toMatchObject({ segment: 2, seq: SEG + 1 });
    expect(closing.seq).toBe(SEG);
    expect(l.verify().ok).toBe(true);
  });

  it('T-012 (S34-25): the window opens directly (no prior fault run) and reports the recovered rotation', async () => {
    const SEG = FILE_ANCHOR_MAX_LAG + 7;
    const { home, ks } = await rotationWindow2(SEG, 1);
    // the crash state built by hand: seal done, no kernel.db
    renameSync(activeDb(home), sealed1(home));
    const l = openKernelLog(base(home, ks, BOOT_B, SEG));
    opened.push(l);
    expect(l.report).toMatchObject({ recoveredRotation: true, anchorLag: SEG - 1 });
    expect(rowsOf(activeDb(home)).map((x) => x.kind)).toEqual(['daemon.anchor.lag']);
    expect(l.verify().ok).toBe(true);
  });
});
