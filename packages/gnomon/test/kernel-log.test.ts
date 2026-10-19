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
 * Research 33 / P8-D82 (anchor policy): G-LOG-06 gains the bounded-lag and
 * keystore-truncation cases; G-LOG-10 (critical kinds anchored before append
 * resolves) is new. `append` is async: it resolves {seq, hash, anchored, event}.
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
  CRITICAL_ANCHOR_KINDS,
  FILE_ANCHOR_MAX_LAG,
  FILE_ANCHOR_MAX_MS,
  isCriticalKind,
  KEYSTORE_ANCHOR_MAX_LAG,
  genesisPrev,
  KernelLog,
  KeyRing,
  LogRefusal,
  projectForReader,
  RESERVED_KINDS,
  verifyLog,
  SIGNATURE_DOMAINS,
  signaturePreimage,
  SignerDomainError,
  SoftwareEd25519Signer,
  type AnchorStore,
  type HeadAnchor,
  type Signer,
} from '../src/kernel/log/index.js';
import { openKernelLog, type KernelLogTestOptions } from '../src/kernel/testing.js';

// 1024+ fsync'd commits: ~0.2 s on macOS, >30 s on Windows CI (FlushFileBuffers per commit).
const SLOW_FSYNC_TIMEOUT = 240_000; // a ceiling, not a budget: same on every OS (no platform branch, G-WIN-05)

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

function openLog(home: string, extra: Partial<KernelLogTestOptions> = {}, signer: Signer | null = KERNEL_KEY): KernelLog {
  const log = openKernelLog({ home, kernelPrincipal: KERNEL, signer, ...extra });
  open.push(log);
  return log;
}

async function fill(log: KernelLog, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await log.append({ kind: 'session.open', principal: KERNEL, session: HSID, payload: { i } });
}

/** Append and return the event (most tests only look at the row). */
async function ev(log: KernelLog, input: Parameters<KernelLog['append']>[0]) {
  return (await log.append(input)).event;
}

/** An in-memory keystore anchor (the P04 seam) with an optional write hook. */
function memKeystore(onWrite?: (h: HeadAnchor) => void | Promise<void>): AnchorStore & { stored?: HeadAnchor; frozen: boolean } {
  const ks: AnchorStore & { stored?: HeadAnchor; frozen: boolean } = {
    name: 'keystore',
    frozen: false,
    read: () => (ks.stored ? { state: 'present', head: ks.stored } : { state: 'absent' }),
    write: async (h) => {
      if (ks.frozen) return;
      await onWrite?.(h);
      ks.stored = h;
    },
  };
  return ks;
}

/** Raw writer that drops the append-only triggers — what a same-user attacker can do. */
function attacker(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('DROP TRIGGER chain_no_update; DROP TRIGGER chain_no_delete;');
  return db;
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

const headOf = (home: string): HeadAnchor => JSON.parse(readFileSync(path.join(home, 'head'), 'utf8')) as HeadAnchor;

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
  it('genesis prev is sha256("gnomon-log-genesis:" + logId) and every row chains', async () => {
    const log = openLog(tmpHome());
    expect(log.report.created).toBe(true);
    const a = await ev(log, { kind: 'daemon.start', principal: KERNEL, signer: null });
    const b = await ev(log, { kind: 'session.open', principal: KERNEL, session: HSID });
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

  it('G-LOG-01: a flipped byte anywhere in a row is detected', async () => {
    const home = tmpHome();
    const log = openLog(home);
    await fill(log, 5);
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

  it('G-LOG-01: a re-hashed forgery still fails (signature, next prev)', async () => {
    const log = openLog(tmpHome());
    await fill(log, 4);
    const db = attacker(log.activePath);
    const row = db.prepare('SELECT envelope FROM chain WHERE seq = 2').get() as { envelope: string };
    const forged = row.envelope.replace('"i":1', '"i":9');
    db.prepare('UPDATE chain SET envelope = ?, hash = ? WHERE seq = 2').run(forged, sha256Tagged(forged));
    db.close();
    const codes = log.verify().failures.map((f) => `${f.code}@${f.seq}`);
    expect(codes).toContain('sig@2');
    expect(codes).toContain('prev@3');
  });

  it('G-LOG-01: truncation (deleted tail) and reorder (swapped rows) are detected', async () => {
    const home = tmpHome();
    const log = openLog(home);
    await fill(log, 6);
    log.close();
    let db = attacker(path.join(home, 'kernel.db'));
    db.exec('DELETE FROM chain WHERE seq = 6');
    db.close();
    const trunc = refusalOf(() => openLog(home));
    expect(trunc.refusal.code).toBe('INTEGRITY_BROKEN');
    expect(trunc.reason).toBe('truncated');

    const home2 = tmpHome();
    const log2 = openLog(home2);
    await fill(log2, 6);
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

  it('G-LOG-02: UPDATE and DELETE on chain (and meta) abort', async () => {
    const log = openLog(tmpHome());
    await fill(log, 2);
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
  it('G-LOG-08: an unsigned mandatory kind is refused; diagnostics may be unsigned', async () => {
    const log = openLog(tmpHome(), {}, null);
    for (const kind of ['approval.decide', 'budget.usage', 'permit.grant', 'key.mint', 'manifest.load', 'config.loaded', 'billing.api.ended', 'verdict.founder', 'oracle.result']) {
      const r = await rejection(log.append({ kind, principal: KERNEL }));
      expect(r.reason, kind).toBe('unsigned-mandatory');
      expect(r.refusal.code).toBe('FORBIDDEN');
    }
    // stricter than the list (kernel-appended events are signed by the kernel key, §3.2)
    expect((await rejection(log.append({ kind: 'session.open', principal: KERNEL }))).reason).toBe('unsigned-kind');
    for (const kind of ['daemon.start', 'socket.connect', 'schedule.due']) expect((await ev(log, { kind, principal: KERNEL })).sig).toBeUndefined();
    expect(log.verify().ok).toBe(true);
  });

  it('G-LOG-08: verify flags a mandatory row whose signature was stripped', async () => {
    const log = openLog(tmpHome());
    await log.append({ kind: 'approval.decide', principal: KERNEL, payload: { decision: 'allow' } });
    const db = attacker(log.activePath);
    db.exec('UPDATE chain SET sig = NULL WHERE seq = 1');
    db.close();
    expect(log.verify().failures.map((f) => f.code)).toContain('unsigned');
  });

  it('S34-06: the log integrity kinds are signature-mandatory and reserved to the log; stripped signatures fail verify', async () => {
    const log = openLog(tmpHome(), {}, null);
    for (const kind of ['daemon.log.gap', 'daemon.segment', 'daemon.anchor.lag', 'daemon.anchor.failed']) {
      expect((await rejection(log.append({ kind, principal: KERNEL, payload: {} }))).reason, kind).toBe('reserved-kind');
    }
    expect((await rejection(log.append({ kind: 'socket.auth.theft', principal: KERNEL, payload: {} }))).reason).toBe('unsigned-mandatory');
    const home = tmpHome();
    const l2 = openLog(home, { segmentRows: 4 });
    await l2.append({ kind: 'socket.auth.theft', principal: KERNEL, payload: {} }); // seq 1
    await fill(l2, 2); // rows 2..3 + closing daemon.segment row 4 → sealed
    expect(l2.verify().ok).toBe(true);
    const db = attacker(path.join(home, 'log', 'segments', '000001.db'));
    db.exec('UPDATE chain SET sig = NULL WHERE seq IN (1, 4)');
    db.close();
    const unsigned = l2.verify().failures.filter((f) => f.code === 'unsigned').map((f) => f.seq);
    expect(unsigned).toEqual([1, 4]);
  });

  it('S34-06: a kernel-principal row must be signed by a kernel key (rotated keys via kernelKeyIds)', async () => {
    const other = SoftwareEd25519Signer.generate();
    const ring = new KeyRing();
    ring.addEd25519(other.publicKeyPem); // known key, so this is not 'unknown-key'
    const home = tmpHome();
    const log = openLog(home, { keyRing: ring });
    await log.append({ kind: 'session.open', principal: HUMAN, signer: other }); // not the kernel principal: fine
    expect(log.verify().ok).toBe(true);
    await log.append({ kind: 'session.open', principal: KERNEL, signer: other });
    const v = log.verify();
    expect(v.failures.map((f) => [f.code, f.seq])).toEqual([['kernel-key', 2]]);
    await log.close();
    const rotated = openLog(home, { keyRing: ring, kernelKeyIds: [other.keyId] });
    expect(rotated.verify().ok).toBe(true);
  });

  it('S34-18: reserved-kind rows are bound to the kernel principal + key; standalone verify says kernelBinding not-checked', async () => {
    const home = tmpHome();
    const impostor = 'p:abcdefgh/impostor';
    const l1 = openKernelLog({ home, kernelPrincipal: impostor, signer: KERNEL_KEY, segmentRows: 4 });
    await fill(l1, 3); // rows 1..3 + daemon.segment row 4 by the impostor principal
    await l1.close();
    const log = openLog(home, { segmentRows: 4 });
    const v = log.verify();
    expect(v.failures.map((f) => [f.code, f.seq])).toEqual([['reserved-binding', 4]]);
    expect(v.kernelBinding).toBe('failed');
    // a healthy log: bound ⇒ ok; the same home verified standalone ⇒ not-checked (never a silent pass)
    const h2 = tmpHome();
    const l2 = openLog(h2, { segmentRows: 4 });
    await fill(l2, 3);
    expect(l2.verify()).toMatchObject({ ok: true, kernelBinding: 'ok' });
    expect(verifyLog(h2, { keyRing: l2.keyRing })).toMatchObject({ kernelBinding: 'not-checked' });
    expect(RESERVED_KINDS).toEqual(['daemon.segment', 'daemon.log.gap', 'daemon.anchor.lag', 'daemon.anchor.failed', 'daemon.log.quarantined']);
  });

  it('event signatures are domain-separated and keyed by gkey:v1:<sha256(spki)>', async () => {
    const signer = SoftwareEd25519Signer.generate();
    expect(signer.keyId).toMatch(/^gkey:v1:[0-9a-f]{64}$/);
    const log = openLog(tmpHome(), {}, signer);
    const e = await ev(log, { kind: 'session.open', principal: KERNEL, session: HSID });
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

  it('a P-256 (hardware-class) signer plugs into the seam and verifies; unknown keys are flagged', async () => {
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
    const e = await ev(log, { kind: 'approval.decide', principal: HUMAN, payload: { decision: 'allow' }, signer: hw });
    expect(e.keyId).toMatch(/^gkey-p256:v1:/);
    expect(log.verify().ok).toBe(true);

    const stranger = SoftwareEd25519Signer.generate('agent');
    await log.append({ kind: 'session.open', principal: 'p:abcdefgh/arky', signer: stranger });
    expect(log.verify().failures.map((f) => f.code)).toContain('unknown-key');
  });
});

describe('#kernel-log labels (L6, §9.1, G-LOG-09)', () => {
  it('G-LOG-09: every registered kind has a default label; the S32 §6 kinds default sensitive', async () => {
    for (const kind of EVENT_KIND_NAMES) expect(defaultLabelsFor(kind), kind).toBeDefined();
    expect(defaultLabelsFor('session.inject')?.sensitivity).toBe('sensitive');
    expect(defaultLabelsFor('turn.event')?.sensitivity).toBe('sensitive');
    expect(defaultLabelsFor('voice.turn.user')?.sensitivity).toBe('sensitive');
    expect(defaultLabelsFor('voice.turn.agent')?.sensitivity).toBe('sensitive');
  });

  it('G-LOG-09: the appender sets the default; unregistered kinds and relaxed labels are refused', async () => {
    const log = openLog(tmpHome());
    const inj = await ev(log, { kind: 'session.inject', principal: KERNEL, session: HSID, payload: { origin: 'kernel', hash: sha256Tagged('x'), bytes: 1 } });
    expect([inj.audience, inj.sensitivity]).toEqual(['private', 'sensitive']);
    expect([(await ev(log, { kind: 'session.open', principal: KERNEL })).sensitivity]).toEqual(['normal']);
    expect((await rejection(log.append({ kind: 'session.made-up', principal: KERNEL }))).reason).toBe('unregistered-kind');
    expect((await rejection(log.append({ kind: 'turn.event', principal: KERNEL, sensitivity: 'normal' }))).reason).toBe('label-relaxed');
    expect((await rejection(log.append({ kind: 'session.open', principal: KERNEL, audience: 'team' }))).reason).toBe('label-relaxed');
    expect((await ev(log, { kind: 'session.open', principal: KERNEL, sensitivity: 'secret' })).sensitivity).toBe('secret');
  });

  it('L7: the kernel never writes a userland kind; daemon.segment is reserved to the log', async () => {
    const log = openLog(tmpHome());
    expect((await rejection(log.append({ kind: 'inject.receipt', principal: KERNEL }))).reason).toBe('kind-owner');
    expect((await ev(log, { kind: 'inject.receipt', principal: KERNEL, as: 'userland' })).kind).toBe('inject.receipt');
    expect((await rejection(log.append({ kind: 'session.open', principal: KERNEL, as: 'userland' }))).reason).toBe('kind-owner');
    expect((await rejection(log.append({ kind: 'daemon.segment', principal: KERNEL }))).reason).toBe('reserved-kind');
  });

  it('G-LOG-03 (log half): session.inject is committed before append returns and must name origin/hash/bytes', async () => {
    const log = openLog(tmpHome());
    const e = await ev(log, { kind: 'session.inject', principal: KERNEL, session: HSID, payload: { origin: 'kernel', hash: sha256Tagged('ctx'), bytes: 3 } });
    // visible to a separate connection the moment append returns (durable commit, not a buffer)
    const db = new DatabaseSync(log.activePath, { readOnly: true });
    expect((db.prepare('SELECT hash FROM chain WHERE seq = ?').get(e.seq) as { hash: string }).hash).toBe(e.hash);
    db.close();
    expect((await rejection(log.append({ kind: 'session.inject', principal: KERNEL, payload: { origin: 'model', hash: sha256Tagged('x'), bytes: 1 } }))).reason).toBe('bad-payload');
    expect((await rejection(log.append({ kind: 'session.inject', principal: KERNEL, payload: { origin: 'kernel', bytes: 1 } }))).reason).toBe('bad-payload');
  });

  it('T-2026-10-18-016 (P8-D93): session.compacted is typed — a closed payload is appended, anything else is bad-payload', async () => {
    const log = openLog(tmpHome());
    const good = { hsid: HSID, turn: `turn:${HSID}/1`, reason: 'threshold', summaryHash: sha256Tagged('summary'), tokensBefore: 9000, tokensAfter: 700 };
    const e = await ev(log, { kind: 'session.compacted', principal: KERNEL, session: HSID, payload: good });
    expect(e.sensitivity).toBe('normal');
    for (const bad of [{ ...good, line: 'raw' }, { ...good, summaryHash: 'x' }, { ...good, tokensAfter: -1 }, { hsid: HSID }]) {
      expect((await rejection(log.append({ kind: 'session.compacted', principal: KERNEL, session: HSID, payload: bad }))).reason).toBe('bad-payload');
    }
  });
});

describe('#kernel-log read projection (§9.3, ~ample-internal-logs)', () => {
  it('filters by audience/sensitivity per reader class', async () => {
    const log = openLog(tmpHome());
    await log.append({ kind: 'session.inject', principal: KERNEL, session: HSID, payload: { origin: 'kernel', hash: sha256Tagged('ctx'), bytes: 3 } });
    await log.append({ kind: 'approval.request', principal: KERNEL, session: HSID, payload: { card: 'card:x', tool_input: { cmd: 'rm -rf /' } } });
    await log.append({ kind: 'session.open', principal: KERNEL, session: HSID, sensitivity: 'secret' });
    await log.append({ kind: 'session.idle', principal: KERNEL, sensitivity: 'sensitive' });
    await log.append({ kind: 'daemon.start', principal: KERNEL });

    const human = [...log.read({ reader: { class: 'human' } })];
    expect(human.map((v) => v.view)).toEqual(['full', 'full', 'full', 'full', 'full']);

    const token = [...log.read({ reader: { class: 'read-token' } })];
    expect(token.map((v) => v.seq)).toEqual([1, 2, 4, 5]); // secret never streamed
    expect(token[0]!.view).toBe('stub');
    if (token[0]!.view === 'stub') expect(Object.keys(token[0]!.stub).sort()).toEqual(['at', 'hsid', 'kind']); // M1.4 slice 2 round 2: limited stubs carry no hash (no confirmation oracle)
    const req = token[1]!;
    expect(req.view === 'full' && (req.event.payload as Record<string, { redacted?: unknown }>).tool_input).toEqual({ redacted: true });
    expect(req.view === 'full' && ['hash', 'sig', 'prev'].some((k) => Object.hasOwn(req.event, k))).toBe(false);

    const community = [...log.read({ reader: { class: 'community-client' } })];
    expect(community.map((v) => v.seq)).toEqual([1, 2, 5]); // minus sensitive and secret

    expect([...log.read({ reader: { class: 'peer' } })]).toEqual([]);
    expect([...log.read({ reader: { class: 'session', hsid: HSID } })].map((v) => v.seq)).toEqual([1, 2, 3]);
    expect([...log.read({ reader: { class: 'mod', name: 'gnome', grantedKinds: ['daemon.start', 'session.inject'] } })].map((v) => v.seq)).toEqual([5]);
    expect(() => [...log.read({ reader: { class: 'agent' } })]).toThrow(LogRefusal);
    expect([...log.read({ reader: { class: 'human' }, kinds: ['daemon.start'] })].map((v) => v.seq)).toEqual([5]);
  });

  it('projectForReader never mutates the chain row', async () => {
    const log = openLog(tmpHome());
    const e = await ev(log, { kind: 'approval.request', principal: KERNEL, payload: { tool_input: { a: 1 } } });
    projectForReader(e, { class: 'read-token' });
    expect((e.payload as { tool_input: unknown }).tool_input).toEqual({ a: 1 });
    expect(log.verify().ok).toBe(true);
  });
});

describe('#kernel-log anchors (G-LOG-06, G-LOG-07)', () => {
  it('G-LOG-06: head ≠ anchor ⇒ INTEGRITY_BROKEN; the keystore anchor is an honest stub', async () => {
    const home = tmpHome();
    const log = openLog(home);
    expect(log.report.anchors).toEqual({ file: 'created', keystore: 'unavailable' });
    await fill(log, 3);
    log.close();
    const head = JSON.parse(readFileSync(path.join(home, 'head'), 'utf8')) as HeadAnchor;
    expect(head.seq).toBe(3);
    writeFileSync(path.join(home, 'head'), JSON.stringify({ ...head, hash: sha256Tagged('forged') }));
    const r = refusalOf(() => openLog(home));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'anchor-mismatch']);
    rmSync(path.join(home, 'head'));
    expect(refusalOf(() => openLog(home)).reason).toBe('anchor-missing');
  });

  it('G-LOG-06: a second (keystore-seam) anchor that disagrees also refuses', async () => {
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
    await fill(log, 2);
    expect(log.verify().anchors.file).toBe('lagging'); // coalesced (S33-05): no rename per commit
    await log.flushAnchors();
    expect(log.verify().anchors).toEqual({ file: 'ok', keystore: 'ok' });
    log.close();
    stored = { ...stored!, seq: 9 };
    expect(refusalOf(() => openLog(home, { keystoreAnchor: ks })).reason).toBe('truncated');
  });

  it('a lagging anchor (crash between commit and anchor write) is accepted only as a prefix and repaired', async () => {
    const home = tmpHome();
    const log = openLog(home);
    await fill(log, 2);
    log.checkpoint(); // an idle checkpoint renames the pending anchor in
    const head2 = readFileSync(path.join(home, 'head'), 'utf8');
    await fill(log, 2);
    log.close();
    writeFileSync(path.join(home, 'head'), head2);
    const again = openLog(home);
    expect(again.report.anchorLag).toBe(2);
    expect(again.report.anchors.file).toBe('lagging-repaired');
    expect(again.verify().ok).toBe(true);
  });

  it('G-LOG-07: a missing db with keys (or any prior trace) refuses start; a clean machine creates genesis', async () => {
    expect(refusalOf(() => openLog(tmpHome(), { keysPresent: true })).reason).toBe('missing-db');
    const home = tmpHome();
    const log = openLog(home);
    await fill(log, 1);
    log.close();
    rmSync(path.join(home, 'kernel.db'));
    rmSync(path.join(home, 'kernel.db-wal'), { force: true });
    rmSync(path.join(home, 'kernel.db-shm'), { force: true });
    const r = refusalOf(() => openLog(home));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'missing-db']);
  });
});

describe('#kernel-log anchor policy (research 33 S33-05..07, P8-D82)', () => {
  it('S33-05: bulk rows coalesce the file anchor — the count trigger renames at the 63rd un-anchored row (deterministic window)', async () => {
    const home = tmpHome();
    const log = openLog(home, { fileAnchorMaxMs: 3_600_000 }); // the time trigger cannot fire: the count trigger is asserted unconditionally
    await fill(log, 10);
    expect(headOf(home).seq).toBe(0); // genesis anchor; 10 un-anchored rows
    await fill(log, FILE_ANCHOR_MAX_LAG - 10);
    expect(headOf(home).seq).toBe(FILE_ANCHOR_MAX_LAG); // the 63rd un-anchored row renames it in
    expect(log.anchorStatus.fileAnchors).toBeLessThan(FILE_ANCHOR_MAX_LAG); // never a rename per commit
    expect(log.anchorStatus.fileAnchors).toBe(1);
    await fill(log, 2);
    log.checkpoint();
    expect(headOf(home).seq).toBe(FILE_ANCHOR_MAX_LAG + 2); // the idle checkpoint catches it up
    await log.close();
    expect(headOf(home)).toMatchObject({ seq: FILE_ANCHOR_MAX_LAG + 2, closed: true });
    const again = openLog(home);
    expect(headOf(home).closed).toBeUndefined(); // the clean-close marker is cleared durably on open
    expect(again.report.anchorLag).toBe(0);
  });

  it('S33-05: the 50 ms timer path renames a pending file anchor without further appends', async () => {
    const home = tmpHome();
    const log = openLog(home);
    await fill(log, 1);
    await new Promise((r) => setTimeout(r, FILE_ANCHOR_MAX_MS + 30));
    expect(headOf(home).seq).toBe(1);
    expect(log.anchorStatus.fileLag).toBe(0);
  });

  it('G-LOG-06: file-anchor lag > 63 ⇒ INTEGRITY_BROKEN{anchor-lag}; lag of exactly 63 is a repairable crash lag', async () => {
    for (const [extra, ok] of [
      [FILE_ANCHOR_MAX_LAG, true],
      [FILE_ANCHOR_MAX_LAG + 1, false],
    ] as const) {
      const home = tmpHome();
      const log = openLog(home);
      await fill(log, 1);
      log.checkpoint();
      const head1 = readFileSync(path.join(home, 'head'), 'utf8');
      await fill(log, extra);
      await log.close();
      writeFileSync(path.join(home, 'head'), head1); // as a crash after commit, before the rename, would leave it (no closed marker)
      if (ok) {
        const again = openLog(home);
        expect(again.report.anchorLag).toBe(FILE_ANCHOR_MAX_LAG);
        expect(again.report.anchors.file).toBe('lagging-repaired');
      } else {
        const r = refusalOf(() => openLog(home));
        expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'anchor-lag']);
      }
    }
  });

  it('G-LOG-06: ANY file-anchor lag behind a clean-close anchor ⇒ INTEGRITY_BROKEN{anchor-lag}', async () => {
    const home = tmpHome();
    const log = openLog(home);
    await fill(log, 3);
    await log.close();
    const closed3 = readFileSync(path.join(home, 'head'), 'utf8');
    expect(JSON.parse(closed3)).toMatchObject({ seq: 3, closed: true });
    const b = openLog(home);
    await fill(b, 1);
    await b.close();
    writeFileSync(path.join(home, 'head'), closed3);
    const r = refusalOf(() => openLog(home));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'anchor-lag']);
    expect(r.refusal.data).toMatchObject({ lag: 1, cleanClose: true });
  });

  it('G-LOG-06: truncating below the keystore anchor ⇒ truncated, even when the file anchor was rewritten to match', async () => {
    const home = tmpHome();
    const ks = memKeystore();
    const log = openLog(home, { keystoreAnchor: ks });
    await fill(log, 6);
    await log.close();
    expect(ks.stored?.seq).toBe(6);
    const db = attacker(path.join(home, 'kernel.db'));
    const row5 = db.prepare('SELECT hash FROM chain WHERE seq = 5').get() as { hash: string };
    db.exec('DELETE FROM chain WHERE seq = 6');
    db.close();
    // the same-user attacker of S33-01 rewrites the file anchor too (S33-02): only the keystore anchor stops it
    const { closed: _closed, ...head } = headOf(home);
    writeFileSync(path.join(home, 'head'), JSON.stringify({ ...head, seq: 5, hash: row5.hash }));
    const r = refusalOf(() => openLog(home, { keystoreAnchor: ks }));
    expect([r.refusal.code, r.reason]).toEqual(['INTEGRITY_BROKEN', 'truncated']);
    expect(r.refusal.data).toMatchObject({ anchor: 'keystore' });
  });

  it('S33-07: keystore lag > 1023 on open appends a kernel-signed daemon.anchor.lag{rows, which}', async () => {
    const home = tmpHome();
    const ks = memKeystore();
    const log = openLog(home, { keystoreAnchor: ks });
    await fill(log, 2);
    await log.flushAnchors();
    ks.frozen = true; // the helper stops answering
    await fill(log, KEYSTORE_ANCHOR_MAX_LAG + 1);
    await log.close();
    ks.frozen = false;
    const again = openLog(home, { keystoreAnchor: ks });
    expect(again.report.keystoreLag).toBe(KEYSTORE_ANCHOR_MAX_LAG + 1);
    const rows = [...again.read({ reader: { class: 'human' }, kinds: ['daemon.anchor.lag'] })];
    expect(rows).toHaveLength(1);
    const lagRow = rows[0]!;
    expect(lagRow.view === 'full' && lagRow.event.payload).toEqual({ rows: KEYSTORE_ANCHOR_MAX_LAG + 1, which: 'keystore' });
    expect(lagRow.view === 'full' && lagRow.event.sig).toBeTruthy();
    await again.flushAnchors();
    expect(again.verify().ok).toBe(true);
    // at or below the bound: repaired, no row
    const home2 = tmpHome();
    const ks2 = memKeystore();
    const l2 = openLog(home2, { keystoreAnchor: ks2 });
    await l2.flushAnchors();
    ks2.frozen = true;
    await fill(l2, 5);
    await l2.close();
    ks2.frozen = false;
    const r2 = openLog(home2, { keystoreAnchor: ks2 });
    expect([r2.report.keystoreLag, r2.report.anchors.keystore]).toEqual([5, 'lagging-repaired']);
    expect([...r2.read({ reader: { class: 'human' }, kinds: ['daemon.anchor.lag'] })]).toEqual([]);
  }, SLOW_FSYNC_TIMEOUT);

  it('S33-06: forcedAnchorRate is critical rows / rows over the last ≤ 10⁴ rows', async () => {
    const log = openLog(tmpHome());
    expect(log.forcedAnchorRate).toBe(0);
    await fill(log, 63);
    expect((await log.append({ kind: 'config.loaded', principal: KERNEL, payload: { n: 1 } })).anchored).toBe('file-only');
    expect(log.forcedAnchorRate).toBeCloseTo(1 / 64, 10);
    expect(log.anchorStatus).toMatchObject({ withinEnvelope: true, forcedAnchors: 1 });
    await log.append({ kind: 'config.loaded', principal: KERNEL, payload: { n: 2 } });
    expect(log.anchorStatus.withinEnvelope).toBe(false);
  });
});

describe('G-LOG-10: critical kinds are anchored before append resolves (S33-06)', () => {
  const PEER_INJECT = { origin: 'peer', hash: sha256Tagged('peer-bytes'), bytes: 10 };
  /** Every registered critical kind, plus session.inject{origin:'peer'}. */
  const CRITICAL: Array<{ kind: string; payload: unknown }> = [
    ...EVENT_KIND_NAMES.filter((k) => isCriticalKind(k)).map((kind) => ({ kind, payload: { t: kind } })),
    { kind: 'session.inject', payload: PEER_INJECT },
  ];

  it('the list is the S33-06 list and classification is exact', () => {
    expect(CRITICAL_ANCHOR_KINDS.ref).toMatch(/S33-06/);
    for (const k of [
      'approval.decide',
      'approval.suspect',
      'approval.presence.denied',
      'approval.rule.learned',
      'approval.rule.revoked',
      'approval.voice.arm',
      'approval.voice.disarm',
      'key.mint',
      'config.loaded',
      'manifest.installed',
      'billing.api.active',
      'verdict.founder',
      'link.paired',
      'link.revoked',
      'link.renewed',
      'link.pair.offered',
      'socket.auth.theft',
    ]) {
      expect(isCriticalKind(k), k).toBe(true);
    }
    for (const k of ['approval.request', 'permit.grant', 'budget.usage', 'session.open', 'link.msg.in', 'socket.auth.fail', 'daemon.start']) expect(isCriticalKind(k), k).toBe(false);
    expect(isCriticalKind('session.inject', PEER_INJECT)).toBe(true);
    expect(isCriticalKind('session.inject', { ...PEER_INJECT, origin: 'kernel' })).toBe(false);
    expect(CRITICAL.length).toBeGreaterThan(20);
  });

  it('for each critical kind: after append resolves, truncating that one row ⇒ open reports truncated', async () => {
    for (const { kind, payload } of CRITICAL) {
      const home = tmpHome();
      const ks = memKeystore();
      const log = openLog(home, { keystoreAnchor: ks });
      await fill(log, 3);
      const r = await log.append({ kind, principal: KERNEL, session: HSID, payload });
      expect(r.anchored, kind).toBe('both');
      // "stop the kernel at the first instruction after append returns": nothing else runs; truncate one row.
      expect(headOf(home).seq, kind).toBe(r.seq);
      expect(ks.stored?.seq, kind).toBe(r.seq);
      const db = attacker(path.join(home, 'kernel.db'));
      db.prepare('DELETE FROM chain WHERE seq = ?').run(r.seq);
      db.close();
      const refused = refusalOf(() => openKernelLog({ home, kernelPrincipal: KERNEL, signer: KERNEL_KEY, keystoreAnchor: ks }));
      expect([refused.refusal.code, refused.reason], kind).toEqual(['INTEGRITY_BROKEN', 'truncated']);
    }
  }, SLOW_FSYNC_TIMEOUT);

  it('both anchor writes complete before the critical append resolves (instrumented keystore store)', async () => {
    const home = tmpHome();
    const order: string[] = [];
    let resolved = false;
    const ks = memKeystore(async (h) => {
      if (h.seq !== 4) return;
      order.push(`file-anchor@${headOf(home).seq}`);
      await new Promise((r) => setTimeout(r, 15)); // a slow helper round trip
      order.push(resolved ? 'ks-write-after-resolve' : 'ks-write-done');
    });
    const log = openLog(home, { keystoreAnchor: ks });
    await fill(log, 3);
    const r = await log.append({ kind: 'approval.decide', principal: KERNEL, payload: { decision: 'allow' } }).then((x) => {
      resolved = true;
      order.push('append-resolved');
      return x;
    });
    expect(r).toMatchObject({ seq: 4, anchored: 'both' });
    expect(order).toEqual(['file-anchor@4', 'ks-write-done', 'append-resolved']);
    // a bulk append resolves without waiting for any anchor
    expect((await log.append({ kind: 'session.open', principal: KERNEL })).anchored).toBe(false);
  });

  it('S33-10: the keystore write STARTS only after COMMIT returned (independent reader sees the row), and every anchor records boot', async () => {
    const home = tmpHome();
    const seen: Array<{ seq: number; committed: boolean; fileSeq: number }> = [];
    const ks = memKeystore((h) => {
      if (h.seq === 0) return; // genesis anchor: no row yet
      // a separate connection sees only COMMITTED rows (WAL): the row must already be there when the write starts
      const db = new DatabaseSync(path.join(home, 'kernel.db'), { readOnly: true });
      try {
        const row = db.prepare('SELECT hash FROM chain WHERE seq = ?').get(h.seq) as { hash: string } | undefined;
        seen.push({ seq: h.seq, committed: row?.hash === h.hash, fileSeq: headOf(home).seq });
      } finally {
        db.close();
      }
    });
    const log = openLog(home, { keystoreAnchor: ks, bootSession: 'C0FFEE00-0000-4000-8000-000000000001' });
    await fill(log, 2);
    for (const kind of ['approval.decide', 'key.rotate', 'config.loaded']) {
      const r = await log.append({ kind, principal: KERNEL, payload: { t: kind } });
      expect(r.anchored, kind).toBe('both');
    }
    expect(seen.map((s) => s.seq)).toEqual([3, 4, 5]);
    for (const s of seen) {
      expect(s.committed, `seq ${s.seq}`).toBe(true);
      expect(s.fileSeq, `file anchor renamed before the keystore write (seq ${s.seq})`).toBe(s.seq);
    }
    expect(ks.stored).toMatchObject({ seq: 5, boot: 'C0FFEE00-0000-4000-8000-000000000001' });
    expect(headOf(home)).toMatchObject({ seq: 5, boot: 'C0FFEE00-0000-4000-8000-000000000001' });
    expect(log.report.boot).toBe('C0FFEE00-0000-4000-8000-000000000001');
  });

  it('S34-02: a failed keystore write rejects ENGINE{anchor-failed} and faults the log — bulk continues, critical refused until re-anchored, then ONE signed daemon.anchor.failed', async () => {
    const diags: string[] = [];
    let down = false;
    const ks = memKeystore(() => {
      if (down) throw new Error('helper gone');
    });
    const log = openLog(tmpHome(), { keystoreAnchor: ks, onDiagnostic: (d) => diags.push(d.what) });
    await fill(log, 2);
    down = true;
    const r = await rejection(log.append({ kind: 'key.rotate', principal: KERNEL, payload: {} }));
    expect([r.refusal.code, r.reason, r.refusal.data.seq]).toEqual(['ENGINE', 'anchor-failed', 3]);
    // S34-17: the marker is committed IMMEDIATELY (seq 4) — durable without the keystore
    expect(log.integrity).toEqual({ state: 'anchor-faulted', failed: [{ seq: 3, kind: 'key.rotate', recorded: true, markerSeq: 4 }] });
    expect(log.anchorStatus.faulted).toBe(true);
    expect((await log.append({ kind: 'session.open', principal: KERNEL })).seq).toBe(5); // bulk continues
    const c = await rejection(log.append({ kind: 'config.loaded', principal: KERNEL, payload: {} }));
    expect([c.refusal.code, c.reason]).toEqual(['ENGINE', 'anchor-faulted']);
    expect(log.head().seq).toBe(5); // the refused critical committed nothing
    down = false;
    expect(await log.append({ kind: 'config.loaded', principal: KERNEL, payload: { n: 2 } })).toMatchObject({ seq: 6, anchored: 'both' });
    const failed = [...log.read({ reader: { class: 'human' }, kinds: ['daemon.anchor.failed'] })];
    expect(failed).toHaveLength(1);
    expect(failed[0]!.view === 'full' && failed[0]!.event).toMatchObject({ seq: 4, payload: { seq: 3, kind: 'key.rotate' } });
    expect(failed[0]!.view === 'full' && failed[0]!.event.sig).toBeTruthy();
    expect(log.integrity).toEqual({ state: 'ok' });
    expect(ks.stored?.seq).toBe(6);
    expect(log.verify().ok).toBe(true);
    await log.close();
    expect(diags).toContain('anchor.keystore.failed');
  });

  it('S34-11: a keystore write that never settles times out the critical append; while it is unsettled new writes refuse at once; order kept', async () => {
    let release: (() => void) | undefined;
    const order: number[] = [];
    const ks = memKeystore(async (h) => {
      if (h.seq === 2 && !release) await new Promise<void>((r) => (release = r));
      order.push(h.seq);
    });
    const log = openLog(tmpHome(), { keystoreAnchor: ks, keystoreTimeoutMs: 50 });
    await fill(log, 1);
    const r = await rejection(log.append({ kind: 'approval.decide', principal: KERNEL, payload: {} }));
    expect([r.refusal.code, r.reason, r.refusal.data.seq]).toEqual(['ENGINE', 'anchor-failed', 2]);
    expect(r.message).toMatch(/did not settle within 50 ms/);
    expect(log.head().seq).toBe(3); // the daemon.anchor.failed marker, committed at once
    // the hung write is still in flight: a re-anchor is refused immediately (no hang, no write racing it)
    await expect(log.flushAnchors()).rejects.toThrow(/still unsettled/);
    release!();
    await new Promise<void>((r2) => setImmediate(r2));
    await log.flushAnchors(); // now re-anchors the head (marker included) and clears the fault
    expect(order).toEqual([0, 2, 3]); // re-stamp, the late write, the re-anchor — never out of order
    expect(ks.stored?.seq).toBe(3);
    expect(log.integrity).toEqual({ state: 'ok' });
  });

  it('S34-11 (round 3): the timeout runs from DEQUEUE — a write queued behind a slow one is not charged for the wait', async () => {
    const ks = memKeystore(async (h) => {
      if (h.seq >= 2) await new Promise((r2) => setTimeout(r2, 35));
    });
    const log = openLog(tmpHome(), { keystoreAnchor: ks, keystoreTimeoutMs: 50 });
    await fill(log, 1);
    // two critical writes queued together: the second settles ~70 ms after ENQUEUE but ~35 ms after it started
    const [a, b] = await Promise.all([
      log.append({ kind: 'approval.decide', principal: KERNEL, payload: { n: 1 } }),
      log.append({ kind: 'approval.decide', principal: KERNEL, payload: { n: 2 } }),
    ]);
    expect([a.anchored, b.anchored]).toEqual(['both', 'both']);
    expect(ks.stored?.seq).toBe(3);
  });

  it('S34-12: close() reports a failed clean-close keystore write instead of swallowing it', async () => {
    let down = false;
    const ks = memKeystore(() => {
      if (down) throw new Error('helper gone');
    });
    const log = openLog(tmpHome(), { keystoreAnchor: ks });
    await fill(log, 1);
    down = true;
    expect(await log.close()).toEqual({ keystore: 'failed', error: 'helper gone', fault: 'none' });
    expect(await log.close()).toEqual({ keystore: 'failed', error: 'helper gone', fault: 'none' }); // idempotent
    expect(await openLog(tmpHome(), { keystoreAnchor: memKeystore() }).close()).toEqual({ keystore: 'ok', fault: 'none' });
  });

  it('S34-17: the fault is durable — critical fails, bulk continues, close (helper still down), reopen ⇒ exactly ONE marker', async () => {
    let down = false;
    const ks = memKeystore(() => {
      if (down) throw new Error('helper gone');
    });
    const home = tmpHome();
    const log = openLog(home, { keystoreAnchor: ks });
    await fill(log, 2);
    down = true;
    await rejection(log.append({ kind: 'approval.decide', principal: KERNEL, payload: {} })); // seq 3, marker 4
    await fill(log, 2); // 5, 6
    expect(await log.close()).toMatchObject({ keystore: 'failed', fault: 'pending' });
    down = false;
    const again = openLog(home, { keystoreAnchor: ks });
    await again.flushAnchors();
    const markers = [...again.read({ reader: { class: 'human' }, kinds: ['daemon.anchor.failed'] })];
    expect(markers).toHaveLength(1);
    expect(markers[0]!.view === 'full' && markers[0]!.event).toMatchObject({ seq: 4, payload: { seq: 3, kind: 'approval.decide' } });
    expect(again.verify().ok).toBe(true);
  });

  it('S34-17: close() records and anchors a pending fault when the helper is back ⇒ fault recovered', async () => {
    let down = false;
    const ks = memKeystore(() => {
      if (down) throw new Error('helper gone');
    });
    const log = openLog(tmpHome(), { keystoreAnchor: ks });
    await log.flushAnchors(); // the open re-stamp has landed
    down = true;
    expect((await rejection(log.append({ kind: 'config.loaded', principal: KERNEL, payload: {} }))).reason).toBe('anchor-failed'); // seq 1, marker 2
    down = false;
    expect(log.integrity.state).toBe('anchor-faulted');
    expect(await log.close()).toEqual({ keystore: 'ok', fault: 'recovered' });
    expect(ks.stored).toMatchObject({ seq: 2, closed: true });
  });

  it('S34-17: crash-shaped — a critical row above the keystore anchor with no marker gets one on open, exactly once', async () => {
    const ks = memKeystore();
    const home = tmpHome();
    const log = openLog(home, { keystoreAnchor: ks });
    await fill(log, 2);
    await log.flushAnchors(); // keystore @2
    ks.frozen = true; // the keystore write of the critical row never lands (crash between COMMIT and the helper write)
    await log.append({ kind: 'key.rotate', principal: KERNEL, payload: {} }); // seq 3
    await fill(log, 1); // seq 4
    await log.close(); // still frozen: the keystore never sees anything past seq 2
    ks.frozen = false;
    expect(ks.stored?.seq).toBe(2);
    const again = openLog(home, { keystoreAnchor: ks });
    const markers = () => [...again.read({ reader: { class: 'human' }, kinds: ['daemon.anchor.failed'] })];
    expect(markers()).toHaveLength(1);
    expect(markers()[0]!.view === 'full' && markers()[0]!.event).toMatchObject({ seq: 5, payload: { seq: 3, kind: 'key.rotate' } });
    expect(markers()[0]!.view === 'full' && markers()[0]!.event.sig).toBeTruthy();
    expect(again.verify().ok).toBe(true);
    await again.close();
    const third = openLog(home, { keystoreAnchor: ks });
    expect([...third.read({ reader: { class: 'human' }, kinds: ['daemon.anchor.failed'] })]).toHaveLength(1);
  });

  it('S34-22: a keyless log is non-rotating — the boundary append is refused BEFORE commit; a keyless open that must record refuses too', async () => {
    const home = tmpHome();
    const log = openLog(home, { segmentRows: 4 }, null);
    await log.append({ kind: 'daemon.start', principal: KERNEL });
    await log.append({ kind: 'daemon.start', principal: KERNEL });
    const r = await rejection(log.append({ kind: 'daemon.start', principal: KERNEL }));
    expect([r.refusal.code, r.reason]).toEqual(['FORBIDDEN', 'kernel-key-required']);
    expect(log.head().seq).toBe(2); // nothing committed-then-thrown
    expect(log.verify().ok).toBe(true);
    // open-time keystore lag > 1023 needs a kernel-signed daemon.anchor.lag
    const home2 = tmpHome();
    const ks = memKeystore();
    const l2 = openLog(home2, { keystoreAnchor: ks });
    await l2.flushAnchors();
    ks.frozen = true;
    await fill(l2, KEYSTORE_ANCHOR_MAX_LAG + 1);
    await l2.close();
    ks.frozen = false;
    const k = refusalOf(() => openLog(home2, { keystoreAnchor: ks }, null));
    expect([k.refusal.code, k.reason]).toEqual(['FORBIDDEN', 'kernel-key-required']);
  }, SLOW_FSYNC_TIMEOUT);
});

describe('#kernel-log segments (L5, §9.4)', () => {
  it('rotates at segmentRows with a daemon.segment closing row; the chain continues across files', async () => {
    const home = tmpHome();
    const log = openLog(home, { segmentRows: 5 });
    await fill(log, 11); // 4 rows + closing row per sealed segment (rotation is eager)
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

  it('segment verify and full verify detect a removed or tampered sealed segment', async () => {
    const home = tmpHome();
    const log = openLog(home, { segmentRows: 4 });
    await fill(log, 9);
    const seg1 = path.join(home, 'log', 'segments', '000001.db');
    const db = attacker(seg1);
    db.exec("UPDATE chain SET at = '2020-01-01T00:00:00.000Z' WHERE seq = 2");
    db.close();
    expect(log.verify({ segment: 1 }).failures.map((f) => f.code)).toContain('column-mismatch');
    expect(log.verify({ segment: 2 }).ok).toBe(true);
    rmSync(seg1);
    expect(log.verify().failures.map((f) => f.code)).toContain('segment-link');
  });

  it('a crash mid-rotation is completed on open (both windows), never forked', async () => {
    // window 1: sealed file renamed, new kernel.db not yet created
    const home = tmpHome();
    const log = openLog(home, { segmentRows: 4 });
    await fill(log, 3); // rows 1..3 + closing row 4 → rotated
    log.close();
    for (const s of ['', '-wal', '-shm']) rmSync(path.join(home, `kernel.db${s}`), { force: true });
    const a = openLog(home, { segmentRows: 4 });
    expect(a.report.recoveredRotation).toBe(true);
    expect(a.head().segment).toBe(2);
    await fill(a, 1);
    expect(a.verify().failures).toEqual([]);
    a.close();

    // window 2: closing row committed in kernel.db, rename not done
    const home2 = tmpHome();
    const b = openLog(home2, { segmentRows: 4 });
    await fill(b, 3);
    b.close();
    for (const s of ['', '-wal', '-shm']) rmSync(path.join(home2, `kernel.db${s}`), { force: true });
    renameSync(path.join(home2, 'log', 'segments', '000001.db'), path.join(home2, 'kernel.db'));
    const c = openLog(home2, { segmentRows: 4 });
    expect(c.report.recoveredRotation).toBe(true);
    expect(existsSync(path.join(home2, 'log', 'segments', '000001.db'))).toBe(true);
    expect(c.verify().ok).toBe(true);

    // a missing active segment AFTER rows were added to it is not a rotation window
    await fill(c, 1);
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

  it('a torn last commit with a lagging anchor recovers to the last whole commit', async () => {
    const src = tmpHome();
    const log = openLog(src);
    await fill(log, 9);
    await log.flushAnchors();
    const head9 = readFileSync(path.join(src, 'head'), 'utf8');
    await fill(log, 1);
    const dst = tornCopy(src, head9);
    const r = openLog(dst, {}, SoftwareEd25519Signer.generate());
    expect(r.head().seq).toBe(9);
    const v = verifyWith(dst, log.keyRing);
    expect(v).toBe(true);
  });

  it('a torn tail behind a newer anchor is INTEGRITY_BROKEN{truncated}, never silently forked', async () => {
    const src = tmpHome();
    const log = openLog(src);
    await fill(log, 10);
    await log.flushAnchors();
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
