/**
 * @symbol #kernel-log
 *
 * #kernel-log (spec §3.2; Aegis S34-30) — CHECKS BEFORE WRITES on open. Every
 * open-time integrity check must complete before the first anchor write,
 * rotation completion or row append, so a refused open leaves both anchors —
 * the evidence — byte-for-byte as found, and no queued (async) keystore write
 * can land after the throw. The regression: a crash mid-rotation (closing
 * daemon.segment row committed, rename not done) used to be completed with
 * `void #writeAnchorsDurable()` BEFORE the keystore check; when that check
 * then refused anchor-mismatch, the queued write overwrote the forked
 * keystore anchor afterwards. The keystore is an in-memory store that keeps
 * the serialised bytes and counts writes.
 */
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KernelLog,
  KEYSTORE_ANCHOR_MAX_LAG,
  LogRefusal,
  SoftwareEd25519Signer,
  type AnchorReadResult,
  type AnchorStore,
  type HeadAnchor,
  type KernelLogOptions,
  type Signer,
} from '../src/kernel/log/index.js';

const KERNEL = 'p:abcdefgh/kernel';
const KERNEL_KEY = SoftwareEd25519Signer.generate();
const BOOT = 'AAAAAAAA-0000-4000-8000-00000000000A';
const homes: string[] = [];
const opened: KernelLog[] = [];

afterEach(async () => {
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
  const h = mkdtempSync(path.join(os.tmpdir(), 'gnomon-open-order-'));
  homes.push(h);
  return h;
}

/** In-memory keystore anchor holding the SERIALISED bytes, with a write counter; `frozen` = writes counted but not stored. */
type CountingKs = AnchorStore & { bytes?: string; writes: number; frozen: boolean };
function countingKeystore(): CountingKs {
  const ks: CountingKs = {
    name: 'keystore',
    writes: 0,
    frozen: false,
    read: (): AnchorReadResult => (ks.bytes === undefined ? { state: 'absent' } : { state: 'present', head: JSON.parse(ks.bytes) as HeadAnchor }),
    write: async (h) => {
      ks.writes++;
      if (!ks.frozen) ks.bytes = JSON.stringify(h);
    },
  };
  return ks;
}

const opts = (home: string, ks: AnchorStore, signer: Signer | null = KERNEL_KEY, extra: Partial<KernelLogOptions> = {}): KernelLogOptions => ({
  home,
  kernelPrincipal: KERNEL,
  signer,
  keystoreAnchor: ks,
  bootSession: BOOT,
  kernelKeyIds: [KERNEL_KEY.keyId],
  ...extra,
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

async function fill(log: KernelLog, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await log.append({ kind: 'session.open', principal: KERNEL, payload: { i } });
}

/** Let every queued microtask, promise chain and short timer run (a stray async anchor write would land here). */
async function drain(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setTimeout(r, 20));
  }
}

const headFile = (home: string) => path.join(home, 'head');

function rowsOf(file: string): Array<{ seq: number; hash: string; kind: string }> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare('SELECT seq, hash, kind FROM chain ORDER BY seq').all() as Array<{ seq: number; hash: string; kind: string }>;
  } finally {
    db.close();
  }
}

describe('#kernel-log S34-30: every open-time integrity check runs before any anchor write', () => {
  it('crash mid-rotation + forked keystore anchor ⇒ anchor-mismatch, and the keystore evidence is never overwritten', async () => {
    const SEG = 4;
    const home = tmpHome();
    const ks = countingKeystore();
    const l1 = KernelLog.open(opts(home, ks, KERNEL_KEY, { segmentRows: SEG }));
    await fill(l1, SEG - 1); // rows 1..3 + the closing daemon.segment row 4 → rotated
    await l1.close();

    // crash window 2: the closing row is committed in kernel.db, the rename never happened
    const sealed = path.join(home, 'log', 'segments', '000001.db');
    const rows = rowsOf(sealed);
    const closing = rows[rows.length - 1]!;
    expect([closing.seq, closing.kind]).toEqual([SEG, 'daemon.segment']);
    for (const sfx of ['', '-wal', '-shm']) rmSync(path.join(home, `kernel.db${sfx}`), { force: true });
    renameSync(sealed, path.join(home, 'kernel.db'));

    // a FORKED keystore anchor: same log, seq = the closing row, hash = another row's hash (≠ row SEG)
    const stored = JSON.parse(ks.bytes!) as HeadAnchor;
    expect(stored.seq).toBe(SEG);
    const { closed: _c, ...rest } = stored;
    ks.bytes = JSON.stringify({ ...rest, hash: rows[0]!.hash });
    const ksBefore = ks.bytes;
    const writesBefore = ks.writes;
    const fileBefore = readFileSync(headFile(home));

    const r = refusalOf(() => KernelLog.open(opts(home, ks, KERNEL_KEY, { segmentRows: SEG })));
    expect(r.reason).toBe('anchor-mismatch');
    expect(r.refusal.data).toMatchObject({ anchor: 'keystore', seq: SEG });

    await drain();
    expect(ks.writes).toBe(writesBefore); // no keystore write was even attempted
    expect(ks.bytes).toBe(ksBefore); // the keystore anchor is byte-for-byte the evidence
    expect(readFileSync(headFile(home)).equals(fileBefore)).toBe(true); // the file anchor too
    // the rotation was not completed either: the refused open wrote nothing
    expect(existsSync(sealed)).toBe(false);
    expect(rowsOf(path.join(home, 'kernel.db')).at(-1)).toMatchObject({ seq: SEG, kind: 'daemon.segment' });

    // a second refused open reads the same evidence and refuses the same way
    expect(refusalOf(() => KernelLog.open(opts(home, ks, KERNEL_KEY, { segmentRows: SEG }))).reason).toBe('anchor-mismatch');
    await drain();
    expect(ks.bytes).toBe(ksBefore);
  });

  it('crash mid-rotation with agreeing anchors still completes the rotation and anchors the head once', async () => {
    const SEG = 4;
    const home = tmpHome();
    const ks = countingKeystore();
    const l1 = KernelLog.open(opts(home, ks, KERNEL_KEY, { segmentRows: SEG }));
    await fill(l1, SEG - 1);
    await l1.close();
    const sealed = path.join(home, 'log', 'segments', '000001.db');
    for (const sfx of ['', '-wal', '-shm']) rmSync(path.join(home, `kernel.db${sfx}`), { force: true });
    renameSync(sealed, path.join(home, 'kernel.db'));
    const writesBefore = ks.writes;

    const l2 = KernelLog.open(opts(home, ks, KERNEL_KEY, { segmentRows: SEG }));
    opened.push(l2);
    expect(l2.report.recoveredRotation).toBe(true);
    expect(existsSync(sealed)).toBe(true);
    await l2.flushAnchors();
    expect(ks.writes - writesBefore).toBe(2); // the open re-stamp + this flush — no extra rotation write
    expect(JSON.parse(ks.bytes!)).toMatchObject({ seq: SEG, segment: 2, boot: BOOT });
    expect(JSON.parse(readFileSync(headFile(home), 'utf8'))).toMatchObject({ seq: SEG, segment: 2 });
    expect(l2.verify().ok).toBe(true);
  });

  it('a keyless open that would need a keystore-lag row refuses kernel-key-required with both anchors untouched', async () => {
    const home = tmpHome();
    const ks = countingKeystore();
    const l1 = KernelLog.open(opts(home, ks));
    await fill(l1, 1);
    await l1.flushAnchors();
    ks.frozen = true; // the keystore anchor stays at seq 1 (never stores again)
    await fill(l1, KEYSTORE_ANCHOR_MAX_LAG + 1 - 5);
    l1.checkpoint();
    await l1.flushAnchors();
    const lagging = readFileSync(headFile(home)); // a file anchor 5 rows behind the tip (a legal, repairable lag)
    await fill(l1, 5);
    await l1.flushAnchors();
    opened.push(l1); // "dies" without close: no clean-close marker
    writeFileSync(headFile(home), lagging);
    const ksBefore = ks.bytes;
    const fileBefore = readFileSync(headFile(home));
    const writesBefore = ks.writes;

    const r = refusalOf(() => KernelLog.open(opts(home, ks, null)));
    expect([r.refusal.code, r.reason]).toEqual(['FORBIDDEN', 'kernel-key-required']);
    await drain();
    expect(ks.writes).toBe(writesBefore);
    expect(ks.bytes).toBe(ksBefore);
    expect(readFileSync(headFile(home)).equals(fileBefore)).toBe(true); // was rewritten before the refusal pre-S34-30
  });

  it('a fresh log facing a keystore anchor of another log refuses before writing a file anchor', async () => {
    const other = tmpHome();
    const ks = countingKeystore();
    const lo = KernelLog.open(opts(other, ks));
    await fill(lo, 1);
    await lo.close();
    const ksBefore = ks.bytes;
    const writesBefore = ks.writes;

    const home = tmpHome();
    const r = refusalOf(() => KernelLog.open(opts(home, ks)));
    expect(r.reason).toBe('anchor-mismatch');
    await drain();
    expect(existsSync(headFile(home))).toBe(false);
    expect(ks.writes).toBe(writesBefore);
    expect(ks.bytes).toBe(ksBefore);
    writeFileSync(path.join(home, 'probe'), ''); // home still writable (the refusal released the db handle)
  });
});
