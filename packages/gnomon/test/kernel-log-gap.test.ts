/**
 * #kernel-log (spec §3.2; research 33 Addendum S33-10, P8-D83) — G-LOG-11:
 * power-loss CLASSIFICATION of an anchor ahead of the db, by fixtures. The
 * lost WAL tail of a power cut is simulated by deleting the tail rows the
 * anchors cover (what a same-user attacker can also do — the point of S33-10
 * is that the verdict is the same and only the cause differs). The keystore
 * anchor is an in-memory store; the boot session is injected
 * (`bootSession`), so these fixtures run on every platform.
 *   (a) keystore ahead, same boot ⇒ truncated/tamper
 *   (b) ahead, different boot, not closed ⇒ truncated/unclean-reboot, appends refused
 *   (c) ahead, different boot, clean close ⇒ tamper
 *   (d) a forged `boot` (or `closed`) in the file anchor alone changes nothing
 *   (e) acknowledgeGap ⇒ exactly one kernel-signed daemon.log.gap, and the chain verifies across it
 * Round-2 review (research 33 S34-xx): open re-stamp (S34-01), full check of
 * non-ahead anchors + unauthenticated file lead (S34-04), keystore clean-close
 * lag (S34-05), ack only after anchors succeed (S34-12), rotation before the
 * gap row (S34-13).
 */
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KernelLog,
  LogRefusal,
  normalizeBootId,
  SoftwareEd25519Signer,
  type AnchorStore,
  type HeadAnchor,
  type KernelLogOptions,
} from '../src/kernel/log/index.js';

const KERNEL = 'p:abcdefgh/kernel';
const HSID = 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0';
const KERNEL_KEY = SoftwareEd25519Signer.generate();
const BOOT_A = 'AAAAAAAA-0000-4000-8000-00000000000A';
const BOOT_B = 'BBBBBBBB-0000-4000-8000-00000000000B';
const homes: string[] = [];
const opened: KernelLog[] = [];

afterEach(() => {
  for (const l of opened.splice(0)) {
    try {
      void l.close();
    } catch {
      /* already closed */
    }
  }
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

function tmpHome(): string {
  const h = mkdtempSync(path.join(os.tmpdir(), 'gnomon-gap-'));
  homes.push(h);
  return h;
}

/** In-memory keystore anchor: `down` = writes reject (helper gone); `frozen` = writes succeed but store nothing. */
type MemKs = AnchorStore & { stored?: HeadAnchor; writes: HeadAnchor[]; down: boolean; frozen: boolean };
function memKeystore(): MemKs {
  const ks: MemKs = {
    name: 'keystore',
    writes: [],
    down: false,
    frozen: false,
    read: () => (ks.stored ? { state: 'present', head: ks.stored } : { state: 'absent' }),
    write: async (h) => {
      if (ks.down) throw new Error('helper gone');
      ks.writes.push(h);
      if (!ks.frozen) ks.stored = h;
    },
  };
  return ks;
}

/** Let queued keystore writes (the open re-stamp) settle without writing any new anchor. */
const drain = () => new Promise<void>((r) => setImmediate(r));

const base = (home: string, ks: AnchorStore, bootSession: string): KernelLogOptions => ({ home, kernelPrincipal: KERNEL, signer: KERNEL_KEY, keystoreAnchor: ks, bootSession });

function openLog(home: string, ks: AnchorStore, bootSession: string, recovery = false): KernelLog {
  const log = (recovery ? KernelLog.openForRecovery : KernelLog.open)(base(home, ks, bootSession));
  opened.push(log);
  return log;
}

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

/** Delete rows > keep (triggers dropped): the lost WAL tail of a power cut, or a same-user truncation. */
function loseTail(home: string, keep: number): void {
  const db = new DatabaseSync(path.join(home, 'kernel.db'));
  db.exec('DROP TRIGGER chain_no_delete;');
  db.prepare('DELETE FROM chain WHERE seq > ?').run(keep);
  db.close();
}

const headFile = (home: string) => path.join(home, 'head');
const fileHead = (home: string): HeadAnchor => JSON.parse(readFileSync(headFile(home), 'utf8')) as HeadAnchor;

/**
 * A log written in boot A: 5 bulk rows, then a critical row (seq 6) whose
 * append resolved (both anchors at 6, boot A). Then the "power cut": the
 * process is abandoned (never closed) and rows 5..6 are lost.
 */
async function crashedAfterCritical(): Promise<{ home: string; ks: MemKs; lostHash: string }> {
  const home = tmpHome();
  const ks = memKeystore();
  const log = KernelLog.open(base(home, ks, BOOT_A)); // "dies" without close (closed only by afterEach, after the test)
  opened.push(log);
  for (let i = 0; i < 5; i++) await log.append({ kind: 'session.open', principal: KERNEL, session: HSID, payload: { i } });
  const r = await log.append({ kind: 'approval.decide', principal: KERNEL, payload: { decision: 'allow' } });
  expect(r).toMatchObject({ seq: 6, anchored: 'both' });
  expect(ks.stored).toMatchObject({ seq: 6, boot: BOOT_A });
  expect(ks.stored!.closed).toBeUndefined();
  expect(fileHead(home)).toMatchObject({ seq: 6, boot: BOOT_A });
  loseTail(home, 4);
  return { home, ks, lostHash: r.hash };
}

describe('G-LOG-11: an anchor ahead of the db is classified, never downgraded (S33-10, P8-D83)', () => {
  it('(a) keystore ahead, same boot ⇒ INTEGRITY_BROKEN{truncated, cause: tamper}', async () => {
    const { home, ks, lostHash } = await crashedAfterCritical();
    const r = refusalOf(() => openLog(home, ks, BOOT_A));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'truncated']);
    expect(r.refusal.data).toMatchObject({ cause: 'tamper', anchor: 'keystore', lostFrom: 5, lostTo: 6, lostHash, bootPrev: BOOT_A, bootNow: BOOT_A, cleanClose: false, anchorSeq: 6, tipSeq: 4 });
    // recovery mode: appends refused with the same verdict; a tamper gap cannot be acknowledged
    const log = openLog(home, ks, BOOT_A, true);
    expect(log.report.integrity).toMatchObject({ state: 'truncated', cause: 'tamper' });
    const a = await rejection(log.append({ kind: 'session.open', principal: KERNEL }));
    expect([a.refusal.code, a.reason, a.refusal.data.cause]).toEqual(['INTEGRITY_BROKEN', 'truncated', 'tamper']);
    const g = await rejection(log.acknowledgeGap({ presenceToken: 'present' }));
    expect([g.refusal.code, g.reason]).toEqual(['FORBIDDEN', 'tamper']);
    await log.close();
    expect(ks.stored).toMatchObject({ seq: 6, boot: BOOT_A }); // the evidence is never overwritten
  });

  it('(b) ahead, different boot, not a clean close ⇒ truncated/unclean-reboot, and appends are refused', async () => {
    const { home, ks } = await crashedAfterCritical();
    const r = refusalOf(() => openLog(home, ks, BOOT_B));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'truncated']);
    expect(r.refusal.data).toMatchObject({ cause: 'unclean-reboot', anchor: 'keystore', lostFrom: 5, lostTo: 6, bootPrev: BOOT_A, bootNow: BOOT_B, cleanClose: false });
    const log = openLog(home, ks, BOOT_B, true);
    expect(log.report.integrity).toMatchObject({ state: 'truncated', cause: 'unclean-reboot', lostFrom: 5, lostTo: 6, unauthenticatedLead: false });
    expect(log.report.anchors).toEqual({ file: 'ahead', keystore: 'ahead' });
    expect(log.integrity.state).toBe('truncated');
    expect(log.truncation?.cause).toBe('unclean-reboot');
    for (const kind of ['session.open', 'approval.decide']) {
      const a = await rejection(log.append({ kind, principal: KERNEL, payload: {} }));
      expect([a.refusal.code, a.reason, a.refusal.data.cause], kind).toEqual(['INTEGRITY_BROKEN', 'truncated', 'unclean-reboot']);
    }
    expect(log.head().seq).toBe(4);
    await log.flushAnchors();
    await log.close();
    expect(ks.stored).toMatchObject({ seq: 6, boot: BOOT_A }); // no anchor write while truncated
    expect(fileHead(home).seq).toBe(6);
  });

  it('(c) ahead, different boot, after a clean close ⇒ tamper (a clean close is durable)', async () => {
    const home = tmpHome();
    const ks = memKeystore();
    const log = KernelLog.open(base(home, ks, BOOT_A));
    for (let i = 0; i < 6; i++) await log.append({ kind: 'session.open', principal: KERNEL, session: HSID, payload: { i } });
    await log.close();
    expect(ks.stored).toMatchObject({ seq: 6, boot: BOOT_A, closed: true });
    loseTail(home, 4);
    const r = refusalOf(() => openLog(home, ks, BOOT_B));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'truncated']);
    expect(r.refusal.data).toMatchObject({ cause: 'tamper', anchor: 'keystore', cleanClose: true, bootPrev: BOOT_A, bootNow: BOOT_B });
  });

  it('a clean-close keystore marker is cleared by the open re-stamp itself (so a later power cut is not misread as tamper)', async () => {
    const home = tmpHome();
    const ks = memKeystore();
    const l1 = KernelLog.open(base(home, ks, BOOT_A));
    await l1.append({ kind: 'session.open', principal: KERNEL });
    await l1.close();
    expect(ks.stored?.closed).toBe(true);
    const before = ks.writes.length;
    openLog(home, ks, BOOT_A); // no append, no flushAnchors: only the open path writes
    await drain();
    expect(ks.writes.length).toBe(before + 1);
    expect(ks.writes.at(-1)).toMatchObject({ seq: 1, boot: BOOT_A });
    expect(ks.writes.at(-1)!.closed).toBeUndefined();
  });

  it('S34-01: every open re-stamps the keystore anchor with the CURRENT boot; a truncation after an open in this boot reads tamper', async () => {
    const home = tmpHome();
    const ks = memKeystore();
    const l1 = KernelLog.open(base(home, ks, BOOT_B)); // written in an earlier boot
    for (let i = 0; i < 5; i++) await l1.append({ kind: 'session.open', principal: KERNEL, session: HSID, payload: { i } });
    await l1.append({ kind: 'approval.decide', principal: KERNEL, payload: { decision: 'allow' } });
    await l1.close();
    expect(ks.stored).toMatchObject({ seq: 6, boot: BOOT_B, closed: true });
    // reboot into A: the anchors are EXACT (no lag), yet the keystore anchor is re-stamped with boot A
    const l2 = openLog(home, ks, BOOT_A);
    expect(l2.report).toMatchObject({ keystoreLag: 0, anchors: { keystore: 'ok' } });
    await drain();
    expect(ks.stored).toMatchObject({ seq: 6, boot: BOOT_A });
    expect(ks.stored!.closed).toBeUndefined();
    // the daemon "dies"; a same-user process truncates in the SAME boot ⇒ tamper (without the re-stamp: unclean-reboot)
    loseTail(home, 4);
    expect(refusalOf(() => openLog(home, ks, BOOT_A)).refusal.data).toMatchObject({ cause: 'tamper', bootPrev: BOOT_A, bootNow: BOOT_A });
  });

  it('S34-01: the first append waits for the re-stamp; if it fails, critical appends are refused until the head is re-anchored', async () => {
    const home = tmpHome();
    const ks = memKeystore();
    await KernelLog.open(base(home, ks, BOOT_A)).close();
    ks.down = true;
    const log = openLog(home, ks, BOOT_B);
    const bulk = await log.append({ kind: 'session.open', principal: KERNEL }); // waited for the (failed) re-stamp
    expect(bulk.seq).toBe(1);
    expect(log.integrity).toEqual({ state: 'anchor-faulted', failed: [] });
    const c = await rejection(log.append({ kind: 'approval.decide', principal: KERNEL, payload: {} }));
    expect([c.refusal.code, c.reason]).toEqual(['ENGINE', 'anchor-faulted']);
    ks.down = false;
    expect(await log.append({ kind: 'approval.decide', principal: KERNEL, payload: {} })).toMatchObject({ seq: 2, anchored: 'both' });
    expect(ks.stored).toMatchObject({ seq: 2, boot: BOOT_B });
    expect(log.integrity).toEqual({ state: 'ok' });
  });

  it('S34-04: a non-ahead anchor still gets the full check in recovery (forked hash, malformed); a file-only lead cannot be acknowledged', async () => {
    const setup = async () => {
      const home = tmpHome();
      const ks = memKeystore();
      const log = KernelLog.open(base(home, ks, BOOT_A));
      opened.push(log);
      for (let i = 0; i < 4; i++) await log.append({ kind: 'session.open', principal: KERNEL, session: HSID, payload: { i } });
      await log.flushAnchors();
      ks.frozen = true; // the keystore stops recording (helper answers but drops writes)
      await log.append({ kind: 'approval.decide', principal: KERNEL, payload: { decision: 'allow' } }); // file @5, keystore @4
      ks.frozen = false;
      loseTail(home, 4);
      expect([fileHead(home).seq, ks.stored!.seq]).toEqual([5, 4]);
      return { home, ks };
    };
    // file-only lead, keystore present and exact: truncated, but the lead is unauthenticated
    const a = await setup();
    expect(refusalOf(() => openLog(a.home, a.ks, BOOT_B)).refusal.data).toMatchObject({ anchor: 'file', unauthenticatedLead: true });
    const rec = openLog(a.home, a.ks, BOOT_B, true);
    expect(rec.report.anchors).toEqual({ file: 'ahead', keystore: 'ok' });
    const g = await rejection(rec.acknowledgeGap({ presenceToken: 'present' }));
    expect([g.refusal.code, g.reason]).toEqual(['FORBIDDEN', 'unauthenticated-lead']);
    // forked tail: the (non-ahead) keystore anchor's hash differs from the db row ⇒ anchor-mismatch, even in recovery
    const b = await setup();
    b.ks.stored = { ...b.ks.stored!, hash: `sha256:${'0'.repeat(64)}` };
    const f = refusalOf(() => openLog(b.home, b.ks, BOOT_B, true));
    expect([f.refusal.code, f.reason, f.refusal.data.anchor]).toEqual(['INTEGRITY_BROKEN', 'anchor-mismatch', 'keystore']);
    // keystore ahead, file anchor malformed ⇒ anchor-mismatch in recovery too
    const c = await crashedAfterCritical();
    writeFileSync(headFile(c.home), 'not json');
    const m = refusalOf(() => openLog(c.home, c.ks, BOOT_B, true));
    expect([m.reason, m.refusal.data.anchor]).toEqual(['anchor-mismatch', 'file']);
  });

  it('S34-05: any lag behind a clean-close KEYSTORE anchor ⇒ anchor-lag (even when the file anchor is exact)', async () => {
    const home = tmpHome();
    const ks = memKeystore();
    const l1 = KernelLog.open(base(home, ks, BOOT_A));
    for (let i = 0; i < 3; i++) await l1.append({ kind: 'session.open', principal: KERNEL, payload: { i } });
    await l1.close();
    const closedAt3 = { ...ks.stored! };
    expect(closedAt3).toMatchObject({ seq: 3, closed: true });
    const l2 = KernelLog.open(base(home, ks, BOOT_A));
    for (let i = 0; i < 2; i++) await l2.append({ kind: 'session.open', principal: KERNEL, payload: { i } });
    await l2.close();
    ks.stored = closedAt3; // the keystore says "cleanly closed at 3"; the db (and the file anchor) say 5
    expect(fileHead(home).seq).toBe(5);
    const r = refusalOf(() => openLog(home, ks, BOOT_A));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'anchor-lag']);
    expect(r.refusal.data).toMatchObject({ anchor: 'keystore', lag: 2, cleanClose: true });
  });

  it('(d) a forged boot (or closed marker) in the FILE anchor alone changes nothing — only the keystore copy is authoritative', async () => {
    // (a) with the file anchor claiming a different boot: still tamper
    const fa = await crashedAfterCritical();
    writeFileSync(headFile(fa.home), JSON.stringify({ ...fileHead(fa.home), boot: BOOT_B }));
    expect(refusalOf(() => openLog(fa.home, fa.ks, BOOT_A)).refusal.data).toMatchObject({ cause: 'tamper', bootPrev: BOOT_A });
    // (b) with the file anchor claiming this boot and a clean close: still unclean-reboot
    const fb = await crashedAfterCritical();
    writeFileSync(headFile(fb.home), JSON.stringify({ ...fileHead(fb.home), boot: BOOT_B, closed: true }));
    expect(refusalOf(() => openLog(fb.home, fb.ks, BOOT_B)).refusal.data).toMatchObject({ cause: 'unclean-reboot', bootPrev: BOOT_A, cleanClose: false });
    // (b) with the file anchor rewritten to MATCH the truncated db: the keystore anchor still decides
    const fc = await crashedAfterCritical();
    const row4 = (() => {
      const db = new DatabaseSync(path.join(fc.home, 'kernel.db'), { readOnly: true });
      try {
        return (db.prepare('SELECT hash FROM chain WHERE seq = 4').get() as { hash: string }).hash;
      } finally {
        db.close();
      }
    })();
    writeFileSync(headFile(fc.home), JSON.stringify({ ...fileHead(fc.home), seq: 4, hash: row4, boot: BOOT_B }));
    expect(refusalOf(() => openLog(fc.home, fc.ks, BOOT_B)).refusal.data).toMatchObject({ cause: 'unclean-reboot', anchor: 'keystore' });
    // no comparable keystore boot (stub keystore / pre-D83 anchor): fails closed to tamper even across boots
    const fd = await crashedAfterCritical();
    const { boot: _b, ...legacy } = fd.ks.stored!;
    fd.ks.stored = legacy as HeadAnchor;
    expect(refusalOf(() => openLog(fd.home, fd.ks, BOOT_B)).refusal.data).toMatchObject({ cause: 'tamper', bootPrev: 'unknown' });
    const stub: AnchorStore = { name: 'keystore', read: () => ({ state: 'unavailable', why: 'stub' }), write: () => undefined };
    expect(refusalOf(() => openLog(fd.home, stub, BOOT_B)).refusal.data).toMatchObject({ cause: 'tamper', anchor: 'file' });
  });

  it('(e) acknowledgeGap (presence stub) ⇒ exactly one kernel-signed daemon.log.gap; the chain verifies across it', async () => {
    const { home, ks, lostHash } = await crashedAfterCritical();
    const log = openLog(home, ks, BOOT_B, true);
    for (const presenceToken of ['', '   ', undefined as unknown as string]) {
      const g = await rejection(log.acknowledgeGap({ presenceToken }));
      expect([g.refusal.code, g.reason]).toEqual(['FORBIDDEN', 'presence-required']);
    }
    // daemon.log.gap is reserved to the log itself
    const forged = await rejection(log.append({ kind: 'daemon.log.gap', principal: KERNEL, payload: {} }));
    expect([forged.refusal.code, forged.reason]).toEqual(['INTEGRITY_BROKEN', 'truncated']);
    const ack = await log.acknowledgeGap({ presenceToken: 'stub-presence' });
    expect(ack).toMatchObject({ seq: 5, anchored: 'both' });
    expect(ack.event.kind).toBe('daemon.log.gap');
    expect(ack.event.payload).toEqual({ lostFrom: 5, lostTo: 6, lostHash, bootPrev: BOOT_A, bootNow: BOOT_B, fileLag: 0 });
    expect(ack.event.sig).toBeTruthy();
    expect(ack.event.keyId).toBe(KERNEL_KEY.keyId);
    // both anchors re-written at the gap row in this boot (keystore awaited)
    expect(ks.stored).toMatchObject({ seq: 5, hash: ack.hash, boot: BOOT_B });
    expect(fileHead(home)).toMatchObject({ seq: 5, hash: ack.hash, boot: BOOT_B });
    expect(log.report.integrity.state).toBe('truncated'); // the open report is history
    expect(log.truncation).toBeUndefined();
    const again = await rejection(log.acknowledgeGap({ presenceToken: 'stub-presence' }));
    expect([again.refusal.code, again.reason]).toEqual(['BAD_REQUEST', 'no-gap']);
    const reserved = await rejection(log.append({ kind: 'daemon.log.gap', principal: KERNEL, payload: {} }));
    expect([reserved.refusal.code, reserved.reason]).toEqual(['FORBIDDEN', 'reserved-kind']);
    // the log accepts appends again; the chain verifies across the gap row
    await log.append({ kind: 'session.open', principal: KERNEL });
    await log.append({ kind: 'approval.decide', principal: KERNEL, payload: { decision: 'deny' } });
    const v = log.verify();
    expect(v.failures).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.rows).toBe(7);
    await log.close();
    // a plain open accepts it; exactly one gap row
    const reopened = openLog(home, ks, BOOT_B);
    expect(reopened.report.integrity).toEqual({ state: 'ok' });
    const gaps = [...reopened.read({ reader: { class: 'human' }, kinds: ['daemon.log.gap'] })];
    expect(gaps).toHaveLength(1);
    expect(reopened.verify().ok).toBe(true);
  });

  it('S34-12: acknowledgeGap leaves recovery only after both anchors succeed; a retry re-anchors the SAME gap row', async () => {
    const { home, ks } = await crashedAfterCritical();
    const log = openLog(home, ks, BOOT_B, true);
    ks.down = true;
    const f = await rejection(log.acknowledgeGap({ presenceToken: 'present' }));
    expect([f.refusal.code, f.reason, f.refusal.data.seq]).toEqual(['ENGINE', 'anchor-failed', 5]);
    expect(log.integrity.state).toBe('truncated');
    expect((await rejection(log.append({ kind: 'session.open', principal: KERNEL }))).reason).toBe('truncated');
    ks.down = false;
    const ack = await log.acknowledgeGap({ presenceToken: 'present' });
    expect(ack.seq).toBe(5);
    expect(log.head().seq).toBe(5);
    expect(log.integrity).toEqual({ state: 'ok' });
    expect([...log.read({ reader: { class: 'human' }, kinds: ['daemon.log.gap'] })]).toHaveLength(1);
    expect(log.verify().ok).toBe(true);
  });

  it('S34-13: a truncated tail ending at a daemon.segment closing row is rotated before the gap row', async () => {
    const home = tmpHome();
    const ks = memKeystore();
    const opts = { ...base(home, ks, BOOT_A), segmentRows: 4 };
    const log = KernelLog.open(opts);
    for (let i = 0; i < 3; i++) await log.append({ kind: 'session.open', principal: KERNEL, payload: { i } }); // rows 1..3 + closing row 4
    await log.append({ kind: 'session.open', principal: KERNEL, payload: { i: 4 } }); // row 5 in segment 2
    await log.flushAnchors();
    const at5 = { ...ks.stored! };
    await log.close();
    ks.stored = at5; // the power cut: keystore @5 (boot A, not closed)
    // the lost tail: segment 2 never made it; segment 1 is back in kernel.db, rename not done
    for (const s of ['', '-wal', '-shm']) rmSync(path.join(home, `kernel.db${s}`), { force: true });
    renameSync(path.join(home, 'log', 'segments', '000001.db'), path.join(home, 'kernel.db'));
    const rec = KernelLog.openForRecovery({ ...opts, bootSession: BOOT_B });
    opened.push(rec);
    expect(rec.report.integrity).toMatchObject({ state: 'truncated', cause: 'unclean-reboot', lostFrom: 5, lostTo: 5 });
    expect(rec.head()).toMatchObject({ segment: 1, seq: 4 });
    const ack = await rec.acknowledgeGap({ presenceToken: 'present' });
    expect(ack).toMatchObject({ seq: 5 });
    expect(rec.head()).toMatchObject({ segment: 2, seq: 5 });
    expect(rec.verify().failures).toEqual([]);
  });

  it('round 3 (reviewer A): an acknowledgeGap interrupted between the gap-row commit and the keystore write is re-anchored on open (one row lost)', async () => {
    const { home, ks } = await crashedAfterCritical();
    // re-shape to the ONE-row-lost case: restore rows 5..6, then lose only row 6
    rmSync(home, { recursive: true, force: true });
    const h = tmpHome();
    const ks2 = memKeystore();
    const w = KernelLog.open(base(h, ks2, BOOT_A));
    opened.push(w);
    for (let i = 0; i < 5; i++) await w.append({ kind: 'session.open', principal: KERNEL, session: HSID, payload: { i } });
    const lost = await w.append({ kind: 'approval.decide', principal: KERNEL, payload: { decision: 'allow' } }); // seq 6
    loseTail(h, 5);
    void ks;
    const rec = openLog(h, ks2, BOOT_B, true);
    expect(rec.report.integrity).toMatchObject({ state: 'truncated', cause: 'unclean-reboot', lostFrom: 6, lostTo: 6 });
    ks2.down = true; // interrupted: the gap row commits, the keystore write never lands
    expect((await rejection(rec.acknowledgeGap({ presenceToken: 'present' }))).reason).toBe('anchor-failed');
    expect(ks2.stored).toMatchObject({ seq: 6, hash: lost.hash }); // keystore still names the LOST row 6
    ks2.down = false;
    // both entry points treat it as acknowledged-but-unanchored: no mismatch, no second gap row
    for (const recovery of [true, false]) {
      const l = openLog(h, ks2, BOOT_B, recovery);
      expect(l.report.integrity, String(recovery)).toEqual({ state: 'ok' });
      await drain();
      expect(ks2.stored).toMatchObject({ seq: 6, boot: BOOT_B });
      expect(ks2.stored!.hash).not.toBe(lost.hash);
      const gaps = [...l.read({ reader: { class: 'human' }, kinds: ['daemon.log.gap'] })];
      expect(gaps).toHaveLength(1);
      expect(l.verify().ok).toBe(true);
      await l.close();
    }
  });

  it('S34-21: boot ids are normalised on both sides (case, whitespace); a non-UUID seam value is unknown and diagnosed', async () => {
    const { home, ks } = await crashedAfterCritical(); // keystore boot = BOOT_A (upper case)
    const r = refusalOf(() => openLog(home, ks, ` ${BOOT_A.toLowerCase()}\n`));
    expect(r.refusal.data).toMatchObject({ cause: 'tamper', bootPrev: BOOT_A, bootNow: BOOT_A });
    ks.stored = { ...ks.stored!, boot: BOOT_A.toLowerCase() }; // a lower-case stored boot is the same boot too
    expect(refusalOf(() => openLog(home, ks, BOOT_A)).refusal.data).toMatchObject({ cause: 'tamper' });
    const diags: string[] = [];
    const h = tmpHome();
    const l = KernelLog.open({ ...base(h, memKeystore(), 'not-a-uuid'), onDiagnostic: (d) => diags.push(d.what) });
    opened.push(l);
    expect(l.report.boot).toBe('unknown');
    expect(diags).toContain('boot.unknown');
  });

  it('S34-09: a boot id is accepted only as a UUID; anything else is unknown (which never proves a reboot)', () => {
    expect(normalizeBootId(' 0e4f6a2b-1c3d-4e5f-8a9b-0c1d2e3f4a5b\n')).toBe('0E4F6A2B-1C3D-4E5F-8A9B-0C1D2E3F4A5B');
    for (const bad of ['', 'unknown', 'not-a-uuid', '0e4f6a2b-1c3d-4e5f-8a9b-0c1d2e3f4a5b; rm -rf', '{"boot":"x"}']) expect(normalizeBootId(bad), bad).toBe('unknown');
  });

  it('openForRecovery on a healthy log is a plain open; acknowledgeGap then has nothing to acknowledge', async () => {
    const home = tmpHome();
    const ks = memKeystore();
    const l1 = KernelLog.open(base(home, ks, BOOT_A));
    await l1.append({ kind: 'session.open', principal: KERNEL });
    await l1.close();
    const log = openLog(home, ks, BOOT_B, true);
    expect(log.report).toMatchObject({ integrity: { state: 'ok' }, boot: BOOT_B });
    expect((await rejection(log.acknowledgeGap({ presenceToken: 'p' }))).reason).toBe('no-gap');
    await log.append({ kind: 'session.open', principal: KERNEL });
  });
});
