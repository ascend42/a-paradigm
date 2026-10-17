/**
 * #kernel-log (spec §3.2, §9.1/§9.3, M1.2) — G-LOG-01..03, G-LOG-06..09 and
 * the segment / torn-tail behaviour, as far as implementable without the
 * hardware keys (P04/P02). G-LOG-04 (p99) and the crash (kill -9) test live in
 * kernel-log-posix.test.ts. Oracle definitions (spec v2 §19 M1.2 row):
 *   G-LOG-01 flipped byte detected · G-LOG-02 UPDATE/DELETE abort ·
 *   G-LOG-03 inject-before-spawn · G-LOG-04 10⁶ appends p99 < 5 ms ·
 *   G-LOG-06 head ≠ anchor ⇒ INTEGRITY_BROKEN · G-LOG-07 missing db + keys ⇒
 *   refuse start · G-LOG-08 unsigned mandatory kind refused · G-LOG-09 every
 *   kind has a default label set by its appender (v3.6).
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, truncateSync, writeFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { EVENT_KIND_NAMES, defaultLabelsFor, sha256Tagged } from '@a-company/gnomon-contracts';
import {
  approveMessage,
  genesisPrev,
  KernelLog,
  KeyRing,
  LogRefusal,
  projectForReader,
  SIGNATURE_DOMAINS,
  signaturePreimage,
  SignerDomainError,
  SoftwareEd25519Signer,
  type AnchorStore,
  type HeadAnchor,
  type KernelLogOptions,
  type Signer,
} from '../src/kernel/log/index.js';

const KERNEL = 'p:abcdefgh/kernel';
const HUMAN = 'p:abcdefgh/founder';
const HSID = 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0';
/** One kernel key for the file, so a reopened log verifies its earlier rows. */
const KERNEL_KEY = SoftwareEd25519Signer.generate();
const homes: string[] = [];
const open: KernelLog[] = [];

function tmpHome(): string {
  const h = mkdtempSync(path.join(os.tmpdir(), 'gnomon-log-'));
  homes.push(h);
  return h;
}

function openLog(home: string, extra: Partial<KernelLogOptions> = {}, signer: Signer | null = KERNEL_KEY): KernelLog {
  const log = KernelLog.open({ home, kernelPrincipal: KERNEL, signer, ...extra });
  open.push(log);
  return log;
}

function fill(log: KernelLog, n: number): void {
  for (let i = 0; i < n; i++) log.append({ kind: 'session.open', principal: KERNEL, session: HSID, payload: { i } });
}

/** Raw writer that drops the append-only triggers — what a same-user attacker can do. */
function attacker(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('DROP TRIGGER chain_no_update; DROP TRIGGER chain_no_delete;');
  return db;
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

afterEach(() => {
  for (const l of open.splice(0)) {
    try {
      l.close();
    } catch {
      /* already closed */
    }
  }
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

describe('#kernel-log chain (§3.2 data model)', () => {
  it('genesis prev is sha256("gnomon-log-genesis:" + logId) and every row chains', () => {
    const log = openLog(tmpHome());
    expect(log.report.created).toBe(true);
    const a = log.append({ kind: 'daemon.start', principal: KERNEL, signer: null });
    const b = log.append({ kind: 'session.open', principal: KERNEL, session: HSID });
    expect(a.seq).toBe(1);
    expect(a.prev).toBe(genesisPrev(log.logId));
    expect(a.prev).toBe(sha256Tagged(`gnomon-log-genesis:${log.logId}`));
    expect(b.prev).toBe(a.hash);
    expect(a.log).toBe(log.logId);
    // hash = sha256(canonical(envelope minus hash, sig)) — recomputed with the contracts hash
    const { hash, sig: _sig, ...rest } = b;
    expect(sha256Tagged(JSON.stringify(sortDeep(rest)))).toBe(hash);
    expect(log.verify().ok).toBe(true);
  });

  it('G-LOG-01: a flipped byte anywhere in a row is detected', () => {
    const home = tmpHome();
    const log = openLog(home);
    fill(log, 5);
    const db = attacker(log.activePath);
    const row = db.prepare('SELECT envelope FROM chain WHERE seq = 3').get() as { envelope: string };
    const flipped = row.envelope.replace('"i":2', '"i":7');
    expect(flipped).not.toBe(row.envelope);
    db.prepare('UPDATE chain SET envelope = ? WHERE seq = 3').run(flipped);
    db.close();
    const r = log.verify();
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => [f.code, f.seq])).toContainEqual(['hash', 3]);
  });

  it('G-LOG-01: a re-hashed forgery still fails (signature, next prev)', () => {
    const log = openLog(tmpHome());
    fill(log, 4);
    const db = attacker(log.activePath);
    const row = db.prepare('SELECT envelope FROM chain WHERE seq = 2').get() as { envelope: string };
    const forged = row.envelope.replace('"i":1', '"i":9');
    db.prepare('UPDATE chain SET envelope = ?, hash = ? WHERE seq = 2').run(forged, sha256Tagged(forged));
    db.close();
    const codes = log.verify().failures.map((f) => `${f.code}@${f.seq}`);
    expect(codes).toContain('sig@2');
    expect(codes).toContain('prev@3');
  });

  it('G-LOG-01: truncation (deleted tail) and reorder (swapped rows) are detected', () => {
    const home = tmpHome();
    const log = openLog(home);
    fill(log, 6);
    log.close();
    let db = attacker(path.join(home, 'kernel.db'));
    db.exec('DELETE FROM chain WHERE seq = 6');
    db.close();
    const trunc = refusalOf(() => openLog(home));
    expect(trunc.refusal.code).toBe('INTEGRITY_BROKEN');
    expect(trunc.reason).toBe('truncated');

    const home2 = tmpHome();
    const log2 = openLog(home2);
    fill(log2, 6);
    db = attacker(log2.activePath);
    const r3 = db.prepare('SELECT * FROM chain WHERE seq = 3').get() as Record<string, string | number | null>;
    const r4 = db.prepare('SELECT * FROM chain WHERE seq = 4').get() as Record<string, string | number | null>;
    const put = db.prepare('UPDATE chain SET id=?, kind=?, at=?, principal=?, audience=?, sensitivity=?, envelope=?, prev_hash=?, hash=?, sig=? WHERE seq = ?');
    const cols = (r: Record<string, string | number | null>) => [r.id, r.kind, r.at, r.principal, r.audience, r.sensitivity, r.envelope, r.prev_hash, r.hash, r.sig] as const;
    db.exec("UPDATE chain SET id = 'tmp3' WHERE seq = 3; UPDATE chain SET id = 'tmp4' WHERE seq = 4;");
    put.run(...cols(r4), 3);
    put.run(...cols(r3), 4);
    db.close();
    const codes = log2.verify().failures.map((f) => f.code);
    expect(codes).toContain('prev');
    expect(codes).toContain('column-mismatch');
  });

  it('G-LOG-02: UPDATE and DELETE on chain (and meta) abort', () => {
    const log = openLog(tmpHome());
    fill(log, 2);
    const db = new DatabaseSync(log.activePath);
    expect(() => db.exec("UPDATE chain SET kind = 'x' WHERE seq = 1")).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM chain WHERE seq = 1')).toThrow(/append-only/);
    expect(() => db.exec("UPDATE meta SET v = 'x'")).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM meta')).toThrow(/append-only/);
    db.close();
    expect(log.verify().ok).toBe(true);
  });
});

describe('#kernel-log signatures (§3.1 domains, §3.2, G-LOG-08)', () => {
  it('G-LOG-08: an unsigned mandatory kind is refused; diagnostics may be unsigned', () => {
    const log = openLog(tmpHome(), {}, null);
    for (const kind of ['approval.decide', 'budget.usage', 'permit.grant', 'key.mint', 'manifest.load', 'config.loaded', 'billing.api.ended', 'verdict.founder', 'oracle.result']) {
      const r = refusalOf(() => log.append({ kind, principal: KERNEL }));
      expect(r.reason, kind).toBe('unsigned-mandatory');
      expect(r.refusal.code).toBe('FORBIDDEN');
    }
    // stricter than the list (kernel-appended events are signed by the kernel key, §3.2)
    expect(refusalOf(() => log.append({ kind: 'session.open', principal: KERNEL })).reason).toBe('unsigned-kind');
    for (const kind of ['daemon.start', 'socket.connect', 'schedule.due']) expect(log.append({ kind, principal: KERNEL }).sig).toBeUndefined();
    expect(log.verify().ok).toBe(true);
  });

  it('G-LOG-08: verify flags a mandatory row whose signature was stripped', () => {
    const log = openLog(tmpHome());
    log.append({ kind: 'approval.decide', principal: KERNEL, payload: { decision: 'allow' } });
    const db = attacker(log.activePath);
    db.exec('UPDATE chain SET sig = NULL WHERE seq = 1');
    db.close();
    expect(log.verify().failures.map((f) => f.code)).toContain('unsigned');
  });

  it('event signatures are domain-separated and keyed by gkey:v1:<sha256(spki)>', () => {
    const signer = SoftwareEd25519Signer.generate();
    expect(signer.keyId).toMatch(/^gkey:v1:[0-9a-f]{64}$/);
    const log = openLog(tmpHome(), {}, signer);
    const e = log.append({ kind: 'session.open', principal: KERNEL, session: HSID });
    expect(e.keyId).toBe(signer.keyId);
    const ring = new KeyRing();
    ring.addEd25519(signer.publicKeyPem);
    const sig = Buffer.from(e.sig!, 'base64');
    expect(ring.verify(e.keyId!, 'event', e.hash, sig)).toBe('ok');
    expect(ring.verify(e.keyId!, 'auth', e.hash, sig)).toBe('bad'); // same bytes, other domain
    expect(signaturePreimage('event', e.hash).toString()).toBe(`${SIGNATURE_DOMAINS.event}\n${e.hash}`);
    // a kernel key never signs a decision or a root row
    expect(() => signer.sign('approve', approveMessage({ cardId: 'card:x', decision: 'allow', cardContentHash: e.hash, approverPrincipalId: HUMAN }))).toThrow(SignerDomainError);
    expect(() => signer.sign('row', 'x')).toThrow(SignerDomainError);
    // root and approvals keys are hardware-only
    expect(() => SoftwareEd25519Signer.generate('root')).toThrow(/hardware-only/);
    expect(() => SoftwareEd25519Signer.generate('approvals')).toThrow(/hardware-only/);
  });

  it('a P-256 (hardware-class) signer plugs into the seam and verifies; unknown keys are flagged', () => {
    // TEST-ONLY software stand-in for the Secure Enclave approvals key (P04): the seam, not custody.
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const ring = new KeyRing();
    const keyId = ring.addP256(publicKey);
    const hw: Signer = {
      keyId,
      keyClass: 'approvals',
      custody: 'hardware',
      sign: (domain, message) => cryptoSign('sha256', signaturePreimage(domain, message), { key: privateKey, dsaEncoding: 'ieee-p1363' }),
    };
    const kernel = SoftwareEd25519Signer.generate();
    const log = openLog(tmpHome(), { keyRing: ring }, kernel);
    const e = log.append({ kind: 'approval.decide', principal: HUMAN, payload: { decision: 'allow' }, signer: hw });
    expect(e.keyId).toMatch(/^gkey-p256:v1:/);
    expect(log.verify().ok).toBe(true);

    const stranger = SoftwareEd25519Signer.generate('agent');
    log.append({ kind: 'session.open', principal: 'p:abcdefgh/arky', signer: stranger });
    expect(log.verify().failures.map((f) => f.code)).toContain('unknown-key');
  });
});

describe('#kernel-log labels (L6, §9.1, G-LOG-09)', () => {
  it('G-LOG-09: every registered kind has a default label; the S32 §6 kinds default sensitive', () => {
    for (const kind of EVENT_KIND_NAMES) expect(defaultLabelsFor(kind), kind).toBeDefined();
    expect(defaultLabelsFor('session.inject')?.sensitivity).toBe('sensitive');
    expect(defaultLabelsFor('turn.event')?.sensitivity).toBe('sensitive');
    expect(defaultLabelsFor('voice.turn.user')?.sensitivity).toBe('sensitive');
    expect(defaultLabelsFor('voice.turn.agent')?.sensitivity).toBe('sensitive');
  });

  it('G-LOG-09: the appender sets the default; unregistered kinds and relaxed labels are refused', () => {
    const log = openLog(tmpHome());
    const inj = log.append({ kind: 'session.inject', principal: KERNEL, session: HSID, payload: { origin: 'kernel', hash: sha256Tagged('x'), bytes: 1 } });
    expect([inj.audience, inj.sensitivity]).toEqual(['private', 'sensitive']);
    expect([log.append({ kind: 'session.open', principal: KERNEL }).sensitivity]).toEqual(['normal']);
    expect(refusalOf(() => log.append({ kind: 'session.made-up', principal: KERNEL })).reason).toBe('unregistered-kind');
    expect(refusalOf(() => log.append({ kind: 'turn.event', principal: KERNEL, sensitivity: 'normal' })).reason).toBe('label-relaxed');
    expect(refusalOf(() => log.append({ kind: 'session.open', principal: KERNEL, audience: 'team' })).reason).toBe('label-relaxed');
    expect(log.append({ kind: 'session.open', principal: KERNEL, sensitivity: 'secret' }).sensitivity).toBe('secret');
  });

  it('L7: the kernel never writes a userland kind; daemon.segment is reserved to the log', () => {
    const log = openLog(tmpHome());
    expect(refusalOf(() => log.append({ kind: 'inject.receipt', principal: KERNEL })).reason).toBe('kind-owner');
    expect(log.append({ kind: 'inject.receipt', principal: KERNEL, as: 'userland' }).kind).toBe('inject.receipt');
    expect(refusalOf(() => log.append({ kind: 'session.open', principal: KERNEL, as: 'userland' })).reason).toBe('kind-owner');
    expect(refusalOf(() => log.append({ kind: 'daemon.segment', principal: KERNEL })).reason).toBe('reserved-kind');
  });

  it('G-LOG-03 (log half): session.inject is committed before append returns and must name origin/hash/bytes', () => {
    const log = openLog(tmpHome());
    const e = log.append({ kind: 'session.inject', principal: KERNEL, session: HSID, payload: { origin: 'kernel', hash: sha256Tagged('ctx'), bytes: 3 } });
    // visible to a separate connection the moment append returns (durable commit, not a buffer)
    const db = new DatabaseSync(log.activePath, { readOnly: true });
    expect((db.prepare('SELECT hash FROM chain WHERE seq = ?').get(e.seq) as { hash: string }).hash).toBe(e.hash);
    db.close();
    expect(refusalOf(() => log.append({ kind: 'session.inject', principal: KERNEL, payload: { origin: 'model', hash: sha256Tagged('x'), bytes: 1 } })).reason).toBe('bad-payload');
    expect(refusalOf(() => log.append({ kind: 'session.inject', principal: KERNEL, payload: { origin: 'kernel', bytes: 1 } })).reason).toBe('bad-payload');
  });
});

describe('#kernel-log read projection (§9.3, ~ample-internal-logs)', () => {
  it('filters by audience/sensitivity per reader class', () => {
    const log = openLog(tmpHome());
    log.append({ kind: 'session.inject', principal: KERNEL, session: HSID, payload: { origin: 'kernel', hash: sha256Tagged('ctx'), bytes: 3 } });
    log.append({ kind: 'approval.request', principal: KERNEL, session: HSID, payload: { card: 'card:x', tool_input: { cmd: 'rm -rf /' } } });
    log.append({ kind: 'session.open', principal: KERNEL, session: HSID, sensitivity: 'secret' });
    log.append({ kind: 'session.idle', principal: KERNEL, sensitivity: 'sensitive' });
    log.append({ kind: 'daemon.start', principal: KERNEL });

    const human = [...log.read({ reader: { class: 'human' } })];
    expect(human.map((v) => v.view)).toEqual(['full', 'full', 'full', 'full', 'full']);

    const token = [...log.read({ reader: { class: 'read-token' } })];
    expect(token.map((v) => v.seq)).toEqual([1, 2, 4, 5]); // secret never streamed
    expect(token[0]!.view).toBe('stub');
    if (token[0]!.view === 'stub') expect(Object.keys(token[0]!.stub).sort()).toEqual(['at', 'hash', 'hsid', 'kind']);
    const req = token[1]!;
    expect(req.view === 'full' && (req.event.payload as Record<string, { redacted?: string }>).tool_input.redacted).toBe('sensitive');

    const community = [...log.read({ reader: { class: 'community-client' } })];
    expect(community.map((v) => v.seq)).toEqual([1, 2, 5]); // minus sensitive and secret

    expect([...log.read({ reader: { class: 'peer' } })]).toEqual([]);
    expect([...log.read({ reader: { class: 'session', hsid: HSID } })].map((v) => v.seq)).toEqual([1, 2, 3]);
    expect([...log.read({ reader: { class: 'mod', name: 'gnome', grantedKinds: ['daemon.start', 'session.inject'] } })].map((v) => v.seq)).toEqual([5]);
    expect(() => [...log.read({ reader: { class: 'agent' } })]).toThrow(LogRefusal);
    expect([...log.read({ reader: { class: 'human' }, kinds: ['daemon.start'] })].map((v) => v.seq)).toEqual([5]);
  });

  it('projectForReader never mutates the chain row', () => {
    const log = openLog(tmpHome());
    const e = log.append({ kind: 'approval.request', principal: KERNEL, payload: { tool_input: { a: 1 } } });
    projectForReader(e, { class: 'read-token' });
    expect((e.payload as { tool_input: unknown }).tool_input).toEqual({ a: 1 });
    expect(log.verify().ok).toBe(true);
  });
});

describe('#kernel-log anchors (G-LOG-06, G-LOG-07)', () => {
  it('G-LOG-06: head ≠ anchor ⇒ INTEGRITY_BROKEN; the keystore anchor is an honest stub', () => {
    const home = tmpHome();
    const log = openLog(home);
    expect(log.report.anchors).toEqual({ file: 'created', keystore: 'unavailable' });
    fill(log, 3);
    log.close();
    const head = JSON.parse(readFileSync(path.join(home, 'head'), 'utf8')) as HeadAnchor;
    expect(head.seq).toBe(3);
    writeFileSync(path.join(home, 'head'), JSON.stringify({ ...head, hash: sha256Tagged('forged') }));
    const r = refusalOf(() => openLog(home));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'anchor-mismatch']);
    rmSync(path.join(home, 'head'));
    expect(refusalOf(() => openLog(home)).reason).toBe('anchor-missing');
  });

  it('G-LOG-06: a second (keystore-seam) anchor that disagrees also refuses', () => {
    const home = tmpHome();
    let stored: HeadAnchor | undefined;
    const ks: AnchorStore = {
      name: 'keystore',
      read: () => (stored ? { state: 'present', head: stored } : { state: 'absent' }),
      write: (h) => {
        stored = h;
      },
    };
    const log = openLog(home, { keystoreAnchor: ks });
    expect(log.report.anchors.keystore).toBe('created');
    fill(log, 2);
    expect(log.verify().anchors).toEqual({ file: 'ok', keystore: 'ok' });
    log.close();
    stored = { ...stored!, seq: 9 };
    expect(refusalOf(() => openLog(home, { keystoreAnchor: ks })).reason).toBe('truncated');
  });

  it('a lagging anchor (crash between commit and anchor write) is accepted only as a prefix and repaired', () => {
    const home = tmpHome();
    const log = openLog(home);
    fill(log, 2);
    const head2 = readFileSync(path.join(home, 'head'), 'utf8');
    fill(log, 2);
    log.close();
    writeFileSync(path.join(home, 'head'), head2);
    const again = openLog(home);
    expect(again.report.anchorLag).toBe(2);
    expect(again.report.anchors.file).toBe('lagging-repaired');
    expect(again.verify().ok).toBe(true);
  });

  it('G-LOG-07: a missing db with keys (or any prior trace) refuses start; a clean machine creates genesis', () => {
    expect(refusalOf(() => openLog(tmpHome(), { keysPresent: true })).reason).toBe('missing-db');
    const home = tmpHome();
    const log = openLog(home);
    fill(log, 1);
    log.close();
    rmSync(path.join(home, 'kernel.db'));
    rmSync(path.join(home, 'kernel.db-wal'), { force: true });
    rmSync(path.join(home, 'kernel.db-shm'), { force: true });
    const r = refusalOf(() => openLog(home));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'missing-db']);
  });
});

describe('#kernel-log segments (L5, §9.4)', () => {
  it('rotates at segmentRows with a daemon.segment closing row; the chain continues across files', () => {
    const home = tmpHome();
    const log = openLog(home, { segmentRows: 5 });
    fill(log, 11); // 4 rows + closing row per sealed segment (rotation is eager)
    const segs = log.segments();
    expect(segs.map((s) => [s.segment, s.baseSeq, s.lastSeq, s.sealed])).toEqual([
      [1, 1, 5, true],
      [2, 6, 10, true],
      [3, 11, 13, false],
    ]);
    expect(segs[0]!.lastKind).toBe('daemon.segment');
    expect(segs[1]!.basePrev).toBe(segs[0]!.lastHash);
    const all = [...log.read({ reader: { class: 'human' } })];
    expect(all.map((v) => v.seq)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    const full = log.verify();
    expect(full.ok).toBe(true);
    expect(full.rows).toBe(13);
    expect(log.verify({ segment: 2 }).segments.map((s) => s.segment)).toEqual([2]);
  });

  it('segment verify and full verify detect a removed or tampered sealed segment', () => {
    const home = tmpHome();
    const log = openLog(home, { segmentRows: 4 });
    fill(log, 9);
    const seg1 = path.join(home, 'log', 'segments', '000001.db');
    const db = attacker(seg1);
    db.exec("UPDATE chain SET at = '2020-01-01T00:00:00.000Z' WHERE seq = 2");
    db.close();
    expect(log.verify({ segment: 1 }).failures.map((f) => f.code)).toContain('column-mismatch');
    expect(log.verify({ segment: 2 }).ok).toBe(true);
    rmSync(seg1);
    expect(log.verify().failures.map((f) => f.code)).toContain('segment-link');
  });

  it('a crash mid-rotation is completed on open (both windows), never forked', () => {
    // window 1: sealed file renamed, new kernel.db not yet created
    const home = tmpHome();
    const log = openLog(home, { segmentRows: 4 });
    fill(log, 3); // rows 1..3 + closing row 4 → rotated
    log.close();
    for (const s of ['', '-wal', '-shm']) rmSync(path.join(home, `kernel.db${s}`), { force: true });
    const a = openLog(home, { segmentRows: 4 });
    expect(a.report.recoveredRotation).toBe(true);
    expect(a.head().segment).toBe(2);
    fill(a, 1);
    expect(a.verify().failures).toEqual([]);
    a.close();

    // window 2: closing row committed in kernel.db, rename not done
    const home2 = tmpHome();
    const b = openLog(home2, { segmentRows: 4 });
    fill(b, 3);
    b.close();
    for (const s of ['', '-wal', '-shm']) rmSync(path.join(home2, `kernel.db${s}`), { force: true });
    renameSync(path.join(home2, 'log', 'segments', '000001.db'), path.join(home2, 'kernel.db'));
    const c = openLog(home2, { segmentRows: 4 });
    expect(c.report.recoveredRotation).toBe(true);
    expect(existsSync(path.join(home2, 'log', 'segments', '000001.db'))).toBe(true);
    expect(c.verify().ok).toBe(true);

    // a missing active segment AFTER rows were added to it is not a rotation window
    fill(c, 1);
    c.close();
    for (const s of ['', '-wal', '-shm']) rmSync(path.join(home2, `kernel.db${s}`), { force: true });
    expect(refusalOf(() => openLog(home2, { segmentRows: 4 })).reason).toBe('missing-db');
  });
});

describe('#kernel-log torn tail (crash safety)', () => {
  /** Snapshot a live (unclosed) log's files into a fresh home with a torn WAL. */
  function tornCopy(src: string, head: string): string {
    const dst = tmpHome();
    mkdirSync(path.join(dst, 'log', 'segments'), { recursive: true });
    copyFileSync(path.join(src, 'kernel.db'), path.join(dst, 'kernel.db'));
    copyFileSync(path.join(src, 'kernel.db-wal'), path.join(dst, 'kernel.db-wal'));
    const wal = path.join(dst, 'kernel.db-wal');
    truncateSync(wal, statSync(wal).size - 50); // tear the last frame (the last commit)
    writeFileSync(path.join(dst, 'head'), head);
    return dst;
  }

  it('a torn last commit with a lagging anchor recovers to the last whole commit', () => {
    const src = tmpHome();
    const log = openLog(src);
    fill(log, 9);
    const head9 = readFileSync(path.join(src, 'head'), 'utf8');
    fill(log, 1);
    const dst = tornCopy(src, head9);
    const r = openLog(dst, {}, SoftwareEd25519Signer.generate());
    expect(r.head().seq).toBe(9);
    const v = verifyWith(dst, log.keyRing);
    expect(v).toBe(true);
  });

  it('a torn tail behind a newer anchor is INTEGRITY_BROKEN{truncated}, never silently forked', () => {
    const src = tmpHome();
    const log = openLog(src);
    fill(log, 10);
    const head10 = readFileSync(path.join(src, 'head'), 'utf8');
    const dst = tornCopy(src, head10);
    const r = refusalOf(() => openLog(dst));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'truncated']);
  });
});

function verifyWith(home: string, ring: KeyRing): boolean {
  const l = openLog(home, { keyRing: ring }, null);
  return l.verify().ok;
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
