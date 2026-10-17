/**
 * #kernel-log (spec §3.2; research 33 S33-07, P8-D85) — the file-anchor lag
 * bound (> 63 ⇒ anchor-lag) relaxed ACROSS A BOOT CHANGE only. Un-fsynced
 * file-anchor renames can roll back after a power cut, so a genuine power
 * loss can leave the file anchor far behind the db. The relaxation reads ONLY
 * the keystore anchor (present, not closed, full anchor check, known boot
 * that differs from this known boot); the file anchor's own `boot` is never
 * consulted, and its hash must still match the row at its seq. When relaxed,
 * one kernel-signed daemon.anchor.lag{rows, which: 'file', bootPrev, bootNow}
 * is appended. Fixtures 1–10 are the Aegis-specified set. The keystore anchor
 * is an in-memory store; the boot session is injected (`bootSession`).
 */
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FILE_ANCHOR_MAX_LAG,
  KernelLog,
  KEYSTORE_ANCHOR_MAX_LAG,
  KeystoreAnchorStore,
  LogRefusal,
  SoftwareEd25519Signer,
  type AnchorStore,
  type HeadAnchor,
  type KernelLogOptions,
  type Signer,
} from '../src/kernel/log/index.js';

const KERNEL = 'p:abcdefgh/kernel';
const KERNEL_KEY = SoftwareEd25519Signer.generate();
const BOOT_A = 'AAAAAAAA-0000-4000-8000-00000000000A';
const BOOT_B = 'BBBBBBBB-0000-4000-8000-00000000000B';
const LAG = FILE_ANCHOR_MAX_LAG + 1; // 64
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
  const h = mkdtempSync(path.join(os.tmpdir(), 'gnomon-xboot-'));
  homes.push(h);
  return h;
}

/** In-memory keystore anchor: `frozen` = writes succeed but store nothing. */
type MemKs = AnchorStore & { stored?: HeadAnchor; frozen: boolean };
function memKeystore(): MemKs {
  const ks: MemKs = {
    name: 'keystore',
    frozen: false,
    read: () => (ks.stored ? { state: 'present', head: ks.stored } : { state: 'absent' }),
    write: async (h) => {
      if (!ks.frozen) ks.stored = h;
    },
  };
  return ks;
}

const base = (home: string, ks: AnchorStore, bootSession: string, signer: Signer | null = KERNEL_KEY): KernelLogOptions => ({
  home,
  kernelPrincipal: KERNEL,
  signer,
  keystoreAnchor: ks,
  bootSession,
  kernelKeyIds: [KERNEL_KEY.keyId],
});

function openLog(home: string, ks: AnchorStore, bootSession: string, signer: Signer | null = KERNEL_KEY): KernelLog {
  const log = KernelLog.open(base(home, ks, bootSession, signer));
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

async function fill(log: KernelLog, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await log.append({ kind: 'session.open', principal: KERNEL, payload: { i } });
}

const headFile = (home: string) => path.join(home, 'head');
const fileHead = (home: string): HeadAnchor => JSON.parse(readFileSync(headFile(home), 'utf8')) as HeadAnchor;

/**
 * A log written in boot A whose FILE anchor rolled back by `lag` rows (as an
 * un-fsynced rename can after a power cut) while the keystore anchor holds the
 * head at the tip, boot A, no clean-close marker (crash after anchoring).
 * `ksLagRows` > 0 freezes the keystore that many rows behind instead.
 */
async function rolledBackFileAnchor(opts: { lag?: number; ks?: AnchorStore & { stored?: HeadAnchor; frozen?: boolean }; ksLagRows?: number } = {}) {
  const lag = opts.lag ?? LAG;
  const home = tmpHome();
  const ks = opts.ks ?? memKeystore();
  const l1 = KernelLog.open(base(home, ks, BOOT_A));
  await fill(l1, 1);
  l1.checkpoint(); // file anchor durable at seq 1
  await l1.flushAnchors();
  const head1 = readFileSync(headFile(home), 'utf8');
  expect(JSON.parse(head1)).toMatchObject({ seq: 1, boot: BOOT_A });
  if (opts.ksLagRows !== undefined) (ks as MemKs).frozen = true;
  await fill(l1, Math.max(lag, opts.ksLagRows ?? 0));
  await l1.close();
  if (opts.ksLagRows !== undefined) (ks as MemKs).frozen = false;
  if ('stored' in ks && ks.stored) {
    const { closed: _c, ...k } = ks.stored; // crashed after anchoring: no clean-close marker
    (ks as MemKs).stored = k;
  }
  writeFileSync(headFile(home), head1); // the rename rolled back: the file anchor is at seq 1 again, no closed marker
  return { home, ks: ks as MemKs, tipSeq: 1 + Math.max(lag, opts.ksLagRows ?? 0) };
}

/** Boot A: file anchor rolled back to seq 1, keystore anchor at seq LAG+7, db cut to LAG+2 (keystore ahead, file lag LAG+1). */
async function ksAheadFileLagging(): Promise<{ home: string; ks: MemKs }> {
  const home = tmpHome();
  const ks = memKeystore();
  const l = KernelLog.open(base(home, ks, BOOT_A));
  opened.push(l); // "dies" without close
  await fill(l, 1);
  l.checkpoint();
  const head1 = readFileSync(headFile(home), 'utf8');
  await fill(l, LAG + 5);
  await l.flushAnchors();
  expect(ks.stored).toMatchObject({ seq: LAG + 6, boot: BOOT_A });
  writeFileSync(headFile(home), head1);
  const cut = new DatabaseSync(path.join(home, 'kernel.db'));
  cut.exec('DROP TRIGGER chain_no_delete;');
  cut.prepare('DELETE FROM chain WHERE seq > ?').run(LAG + 2);
  cut.close();
  return { home, ks };
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

function lagRows(log: KernelLog) {
  return [...log.read({ reader: { class: 'human' }, kinds: ['daemon.anchor.lag'] })].map((r) => {
    if (r.view !== 'full') throw new Error('expected a full view');
    return r.event;
  });
}

describe('P8-D85: file-anchor lag > 63 is relaxed only across a boot change, authenticated by the keystore anchor', () => {
  it('(1) same boot, lag 64 ⇒ INTEGRITY_BROKEN{anchor-lag} (relax: same-boot)', async () => {
    const f = await rolledBackFileAnchor();
    expect(f.ks.stored).toMatchObject({ seq: f.tipSeq, boot: BOOT_A });
    const r = refusalOf(() => openLog(f.home, f.ks, BOOT_A));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'anchor-lag']);
    expect(r.refusal.data).toMatchObject({ anchor: 'file', lag: LAG, bound: FILE_ANCHOR_MAX_LAG, relax: 'same-boot' });
  });

  it('(2) different boot + valid keystore + lag 64 ⇒ opens; exactly one kernel-signed daemon.anchor.lag{rows, which: file, bootPrev, bootNow}; verify ok', async () => {
    const f = await rolledBackFileAnchor();
    const log = openLog(f.home, f.ks, BOOT_B);
    expect(log.report.anchorLag).toBe(LAG);
    expect(log.report.anchors.file).toBe('lagging-repaired');
    expect(log.report.keystoreLag).toBe(0);
    const rows = lagRows(log);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ rows: LAG, which: 'file', bootPrev: BOOT_A, bootNow: BOOT_B });
    expect(rows[0]!.principal).toBe(KERNEL);
    expect(rows[0]!.sig).toBeTruthy();
    expect(rows[0]!.keyId).toBe(KERNEL_KEY.keyId);
    expect(log.head().seq).toBe(f.tipSeq + 1);
    expect(fileHead(f.home).seq).toBe(f.tipSeq + 1); // re-anchored past the lag row
    await log.flushAnchors();
    expect(f.ks.stored).toMatchObject({ seq: f.tipSeq + 1, boot: BOOT_B });
    const v = log.verify();
    expect(v.ok).toBe(true);
    // a later same-boot open is clean (nothing left to relax, no second row)
    await log.close();
    const again = openLog(f.home, f.ks, BOOT_B);
    expect(again.report.anchorLag).toBe(0);
    expect(lagRows(again)).toHaveLength(1);
    // laundering: roll the file anchor back again in BOOT_B and reopen in BOOT_B — the keystore now records BOOT_B ⇒ same-boot, refused
    const rolled = readFileSync(headFile(f.home), 'utf8');
    await fill(again, LAG);
    await again.close();
    const { closed: _c, ...k } = f.ks.stored!;
    f.ks.stored = k;
    writeFileSync(headFile(f.home), rolled);
    expect(f.ks.stored).toMatchObject({ boot: BOOT_B });
    const l = refusalOf(() => openLog(f.home, f.ks, BOOT_B));
    expect([l.refusal.code, l.reason, l.refusal.data.relax]).toEqual(['INTEGRITY_BROKEN', 'anchor-lag', 'same-boot']);
  });

  it('(3) different boot + stub (unavailable) keystore ⇒ anchor-lag (relax: keystore-unavailable); absent / malformed keystore ⇒ anchor-lag too', async () => {
    const f = await rolledBackFileAnchor({ ks: new KeystoreAnchorStore() });
    const r = refusalOf(() => openLog(f.home, new KeystoreAnchorStore(), BOOT_B));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'anchor-lag']);
    expect(r.refusal.data).toMatchObject({ anchor: 'file', lag: LAG, relax: 'keystore-unavailable' });
    // absent keystore anchor on an existing log
    const g = await rolledBackFileAnchor();
    g.ks.stored = undefined;
    const a = refusalOf(() => openLog(g.home, g.ks, BOOT_B));
    expect([a.reason, a.refusal.data.relax]).toEqual(['anchor-lag', 'keystore-absent']);
    // malformed keystore read
    const m = refusalOf(() => openLog(g.home, { name: 'keystore', read: () => ({ state: 'malformed', why: 'bad json' }), write: async () => {} }, BOOT_B));
    expect([m.reason, m.refusal.data.relax]).toEqual(['anchor-lag', 'keystore-malformed']);
  });

  it('(4) different boot + keystore anchor with no boot (pre-D83) or an unknown boot, or bootNow unknown ⇒ anchor-lag (relax: boot-unknown)', async () => {
    const f = await rolledBackFileAnchor();
    const { boot: _b, ...preD83 } = f.ks.stored!;
    f.ks.stored = preD83 as HeadAnchor;
    const r = refusalOf(() => openLog(f.home, f.ks, BOOT_B));
    expect([r.refusal.code, r.reason, r.refusal.data.relax]).toEqual(['INTEGRITY_BROKEN', 'anchor-lag', 'boot-unknown']);
    f.ks.stored = { ...preD83, boot: 'unknown' } as HeadAnchor;
    expect(refusalOf(() => openLog(f.home, f.ks, BOOT_B)).refusal.data.relax).toBe('boot-unknown');
    f.ks.stored = { ...preD83, boot: 'not-a-uuid' } as HeadAnchor;
    expect(refusalOf(() => openLog(f.home, f.ks, BOOT_B)).refusal.data.relax).toBe('boot-unknown');
    // the keystore boot is known, but this boot is not
    f.ks.stored = { ...preD83, boot: BOOT_A } as HeadAnchor;
    expect(refusalOf(() => openLog(f.home, f.ks, 'garbage')).refusal.data.relax).toBe('boot-unknown');
  });

  it('(5) different boot + keystore closed ⇒ anchor-lag (relax: keystore-closed); a closed FILE anchor with any lag ⇒ anchor-lag{cleanClose}', async () => {
    const f = await rolledBackFileAnchor();
    f.ks.stored = { ...f.ks.stored!, closed: true };
    const r = refusalOf(() => openLog(f.home, f.ks, BOOT_B));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'anchor-lag']);
    expect(r.refusal.data).toMatchObject({ anchor: 'file', relax: 'keystore-closed' });
    // file anchor marked closed (keystore valid, boot changed) — any lag refuses, the boot is irrelevant
    const g = await rolledBackFileAnchor();
    writeFileSync(headFile(g.home), JSON.stringify({ ...fileHead(g.home), closed: true }));
    const c = refusalOf(() => openLog(g.home, g.ks, BOOT_B));
    expect(c.reason).toBe('anchor-lag');
    expect(c.refusal.data).toMatchObject({ anchor: 'file', lag: LAG, cleanClose: true });
    expect(c.refusal.data.relax).toBeUndefined();
  });

  it('(6) different boot + file-anchor hash mismatch ⇒ anchor-mismatch (only the lag is relaxed)', async () => {
    const f = await rolledBackFileAnchor();
    writeFileSync(headFile(f.home), JSON.stringify({ ...fileHead(f.home), hash: f.ks.stored!.hash })); // seq 1, but the tip's hash
    const r = refusalOf(() => openLog(f.home, f.ks, BOOT_B));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'anchor-mismatch']);
    expect(r.refusal.data).toMatchObject({ anchor: 'file', seq: 1 });
    // a keystore anchor that fails its own check is never trusted to relax the bound
    const g = await rolledBackFileAnchor();
    g.ks.stored = { ...g.ks.stored!, hash: fileHead(g.home).hash };
    const k = refusalOf(() => openLog(g.home, g.ks, BOOT_B));
    expect([k.reason, k.refusal.data.anchor]).toEqual(['anchor-mismatch', 'keystore']);
    expect(fileHead(g.home).seq).toBe(1); // refused before any anchor write (ordering)
  });

  it('(7) a forged file-anchor boot while the keystore shows this same boot ⇒ anchor-lag (the file boot is never consulted)', async () => {
    const f = await rolledBackFileAnchor();
    writeFileSync(headFile(f.home), JSON.stringify({ ...fileHead(f.home), boot: BOOT_B }));
    const r = refusalOf(() => openLog(f.home, f.ks, BOOT_A));
    expect([r.refusal.code, r.reason, r.refusal.data.relax]).toEqual(['INTEGRITY_BROKEN', 'anchor-lag', 'same-boot']);
  });

  it('(8) keyless log + different boot (otherwise relaxable) ⇒ FORBIDDEN{kernel-key-required}, nothing committed', async () => {
    const f = await rolledBackFileAnchor();
    const r = refusalOf(() => openLog(f.home, f.ks, BOOT_B, null));
    expect([r.refusal.code, r.reason]).toEqual(['FORBIDDEN', 'kernel-key-required']);
    const db = new DatabaseSync(path.join(f.home, 'kernel.db'), { readOnly: true });
    try {
      expect((db.prepare('SELECT MAX(seq) AS s FROM chain').get() as { s: number }).s).toBe(f.tipSeq);
    } finally {
      db.close();
    }
    expect(fileHead(f.home).seq).toBe(1); // the lagging file anchor (the evidence) is untouched
  });

  it('(9) different boot, file lag > 63 AND keystore lag > 1023 ⇒ two kernel-signed daemon.anchor.lag rows; verify ok', async () => {
    const rows = KEYSTORE_ANCHOR_MAX_LAG + 1;
    const f = await rolledBackFileAnchor({ ksLagRows: rows });
    expect(f.ks.stored).toMatchObject({ seq: 1, boot: BOOT_A });
    expect(f.ks.stored!.closed).toBeUndefined();
    const log = openLog(f.home, f.ks, BOOT_B);
    expect([log.report.anchorLag, log.report.keystoreLag]).toEqual([rows, rows]);
    const lag = lagRows(log);
    expect(lag.map((e) => e.payload)).toEqual([
      { rows, which: 'keystore' },
      { rows, which: 'file', bootPrev: BOOT_A, bootNow: BOOT_B },
    ]);
    expect(lag.every((e) => Boolean(e.sig))).toBe(true);
    await log.flushAnchors();
    expect(log.verify().ok).toBe(true);
  });

  it('(10) different boot with the keystore anchor AHEAD ⇒ still the truncation path, never relaxed', async () => {
    // keystore ahead, file anchor within bound ⇒ truncated / unclean-reboot
    const home = tmpHome();
    const ks = memKeystore();
    const l1 = KernelLog.open(base(home, ks, BOOT_A));
    opened.push(l1); // "dies" without close
    await fill(l1, 6);
    await l1.flushAnchors();
    expect(ks.stored).toMatchObject({ seq: 6, boot: BOOT_A });
    const cut = new DatabaseSync(path.join(home, 'kernel.db'));
    cut.exec('DROP TRIGGER chain_no_delete;');
    cut.prepare('DELETE FROM chain WHERE seq > 4').run();
    cut.close();
    const t = refusalOf(() => openLog(home, ks, BOOT_B));
    expect([t.refusal.code, t.reason]).toEqual(['INTEGRITY_BROKEN', 'truncated']);
    expect(t.refusal.data).toMatchObject({ cause: 'unclean-reboot', anchor: 'keystore', bootPrev: BOOT_A, bootNow: BOOT_B });
    // S34-24: keystore ahead AND the file anchor > 63 behind ⇒ still truncated (the keystore classifies; fileLag reported)
    const ahead = await ksAheadFileLagging();
    const s = refusalOf(() => openLog(ahead.home, ahead.ks, BOOT_B));
    expect([s.refusal.code, s.reason]).toEqual(['INTEGRITY_BROKEN', 'truncated']);
    expect(s.refusal.data).toMatchObject({ cause: 'unclean-reboot', anchor: 'keystore', fileLag: LAG + 1, bootPrev: BOOT_A, bootNow: BOOT_B });
    // same boot ⇒ truncated / tamper
    const same = await ksAheadFileLagging();
    const st = refusalOf(() => openLog(same.home, same.ks, BOOT_A));
    expect([st.reason, st.refusal.data.cause, st.refusal.data.fileLag]).toEqual(['truncated', 'tamper', LAG + 1]);
    // recovery + acknowledgeGap records fileLag in daemon.log.gap; the chain verifies
    const rec = await ksAheadFileLagging();
    const rl = KernelLog.openForRecovery(base(rec.home, rec.ks, BOOT_B));
    opened.push(rl);
    expect(rl.report.integrity).toMatchObject({ state: 'truncated', cause: 'unclean-reboot', fileLag: LAG + 1 });
    const ack = await rl.acknowledgeGap({ presenceToken: 'stub-presence' });
    expect(ack.event.payload).toMatchObject({ bootPrev: BOOT_A, bootNow: BOOT_B, fileLag: LAG + 1 });
    expect(fileHead(rec.home).seq).toBe(ack.seq);
    expect(rl.verify().ok).toBe(true);
    // the file anchor's hash / clean-close checks still apply while the keystore is ahead
    const mm = await ksAheadFileLagging();
    writeFileSync(headFile(mm.home), JSON.stringify({ ...fileHead(mm.home), hash: mm.ks.stored!.hash }));
    expect(refusalOf(() => openLog(mm.home, mm.ks, BOOT_B)).reason).toBe('anchor-mismatch');
    const cc = await ksAheadFileLagging();
    writeFileSync(headFile(cc.home), JSON.stringify({ ...fileHead(cc.home), closed: true }));
    expect(refusalOf(() => openLog(cc.home, cc.ks, BOOT_B)).refusal.data).toMatchObject({ anchor: 'file', cleanClose: true });
  });

  it('evidence first: a failure between the relax decision and the signed row never reopens clean with no row', async () => {
    // (a) keystore lag > 1023 too: the keystore-lag row commits, then the file-lag row's signature fails
    const rows = KEYSTORE_ANCHOR_MAX_LAG + 1;
    const f = await rolledBackFileAnchor({ ksLagRows: rows });
    expect(() => openLog(f.home, f.ks, BOOT_B, failingSigner(2))).toThrow('injected signer failure');
    expect(fileHead(f.home).seq).toBe(1); // no early file-anchor write: the lag is still the evidence
    const again = openLog(f.home, f.ks, BOOT_B);
    expect(again.report.anchorLag).toBe(rows + 1); // + the committed keystore-lag row
    const fileRows = lagRows(again).filter((e) => (e.payload as { which: string }).which === 'file');
    expect(fileRows.map((e) => e.payload)).toEqual([{ rows: rows + 1, which: 'file', bootPrev: BOOT_A, bootNow: BOOT_B }]);
    await again.flushAnchors();
    expect(again.verify().ok).toBe(true);

    // (b) crash mid-rotation (closing row committed, rename not done): the rotation completes WITHOUT its anchor
    // writes, then the file-lag row's signature fails; the reopen still relaxes with the row
    const home = tmpHome();
    const ks = memKeystore();
    const seg = LAG + 8; // closing row seq
    const l1 = KernelLog.open({ ...base(home, ks, BOOT_A), segmentRows: seg });
    await fill(l1, 1);
    l1.checkpoint();
    await l1.flushAnchors();
    const head1 = readFileSync(headFile(home), 'utf8');
    await fill(l1, seg - 2); // rows 2..seg-1, then the closing row seg → rotated
    await l1.flushAnchors();
    await l1.close();
    const closing = (() => {
      const db = new DatabaseSync(path.join(home, 'log', 'segments', '000001.db'), { readOnly: true });
      try {
        return db.prepare('SELECT seq, hash, kind FROM chain ORDER BY seq DESC LIMIT 1').get() as { seq: number; hash: string; kind: string };
      } finally {
        db.close();
      }
    })();
    expect([closing.seq, closing.kind]).toEqual([seg, 'daemon.segment']);
    for (const sfx of ['', '-wal', '-shm']) rmSync(path.join(home, `kernel.db${sfx}`), { force: true });
    renameSync(path.join(home, 'log', 'segments', '000001.db'), path.join(home, 'kernel.db'));
    ks.stored = { ...ks.stored!, segment: 1, seq: closing.seq, hash: closing.hash, closed: undefined } as HeadAnchor; // anchored at the closing row, boot A
    writeFileSync(headFile(home), head1);
    expect(() => KernelLog.open({ ...base(home, ks, BOOT_B, failingSigner(1)), segmentRows: seg })).toThrow('injected signer failure');
    expect(fileHead(home).seq).toBe(1);
    expect(ks.stored).toMatchObject({ seq: closing.seq, boot: BOOT_A });
    const r = KernelLog.open({ ...base(home, ks, BOOT_B), segmentRows: seg });
    opened.push(r);
    expect(r.report.anchorLag).toBe(seg - 1);
    expect(lagRows(r).map((e) => e.payload)).toEqual([{ rows: seg - 1, which: 'file', bootPrev: BOOT_A, bootNow: BOOT_B }]);
    await r.flushAnchors();
    expect(r.verify().ok).toBe(true);
  });
});
