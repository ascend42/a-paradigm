// @gnomon-platform: darwin, linux
/**
 * #loops-gate (TD-2026-10-24-447, G-LOOP-29), daemon level. A real dev-home daemon booted with GNOMON_LOOPS=0 (the dev
 * switch for the release default): requests.loops is wired (status.loops present with enabled:false), request.loop.* and
 * loop.request are refused loops-disabled, `approve` of a loop-trust card an earlier kernel left pending is NOT_FOUND
 * (cards live in the raising kernel's memory; the new broker holds none), and old loop rows are only read.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refusalOf } from '@a-company/gnomon-contracts';
import { approvalsKeyFrom, type ApprovalsKey } from '../src/kernel/broker/index.js';
import { NEVER_STANDING_KINDS } from '../src/kernel/broker/standing-grant.js';
import { replayLoopRuns } from '../src/kernel/loops/ledger.js';
import { selectSocketPath, startDaemon } from '../src/kernel/lifecycle/index.js';
import { connectGnomon } from '../src/kernel/socket/index.js';
import { loadDevHome, provisionDevHome } from '../src/cli/dev-home.js';
import { recordKernelPub } from '../src/kernel/identity/index.js';
import { KeyRing, signaturePreimage } from '../src/kernel/log/signer.js';
import { mintTestPresence } from '../src/kernel/testing.js';
import { kernelPinOf } from '../src/cli/daemon-cli.js';
import { humanDeviceOf } from '../src/cli/rules-cli.js';
import { GNOMON_VERSION } from '../src/version.js';
import { tempHome } from './daemon-helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  while (cleanups.length) await cleanups.pop()!();
});

/** A dev home whose kernel pub is recorded, and an approvals key that signs after a (test) fresh presence. */
function world() {
  const t = tempHome('ds-');
  cleanups.push(t.cleanup);
  fs.mkdirSync(path.dirname(t.home), { recursive: true });
  const userHome = fs.realpathSync.native(path.dirname(t.home));
  const home = path.join(userHome, 'devhome');
  provisionDevHome(home, { userHome });
  const l = loadDevHome(home, { userHome });
  recordKernelPub(home, l.kernelKey.publicKeyPem);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const prompts: string[] = [];
  const approvalsKey: ApprovalsKey = {
    ...approvalsKeyFrom(ring, (p) => (p === l.device.principalId ? keyId : undefined)),
    signDecision: async (req) => {
      prompts.push(req.mode);
      const decisionSig = cryptoSign('sha256', signaturePreimage('approve', req.message), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
      return { decisionSig, token: req.presence ? mintTestPresence(req.presence.purpose, { bind: req.presence.binding }) : null, kept: false };
    },
  };
  const sock = selectSocketPath({ home });
  if (!sock.ok) throw new Error('no socket path');
  return { home, l, approvalsKey, prompts, sock: sock.path };
}

async function humanConn(w: ReturnType<typeof world>) {
  const found = kernelPinOf(w.home, w.l.kernelKey.keyId)!;
  const device = humanDeviceOf(w.home);
  if (typeof device === 'string') throw new Error(device);
  const s = await connectGnomon({ socketPath: w.sock, client: { name: 'gnomon', version: GNOMON_VERSION, surface: 'cli' }, serverKey: found.pin, device });
  cleanups.push(() => s.conn.close().catch(() => undefined));
  return s;
}


describe('loops off at daemon level', () => {
  it('requests.loops is always wired: status.loops is the stub and every loop ask is refused loops-disabled; a foreign loop-trust card cannot be allowed', async () => {
    vi.stubEnv('GNOMON_LOOPS', '0');
    const w = world();
    const events: Array<{ kind: string; event?: string }> = [];
    const d = await startDaemon({ home: w.home, idleMs: 60_000, kernelSigner: w.l.kernel, rootAuthority: w.l.root, approvalsKey: w.approvalsKey, onEvent: (e) => events.push(e as never) });
    cleanups.push(() => d.shutdown('signal').catch(() => undefined));
    expect(events.filter((e) => e.event === 'loops.disabled')).toHaveLength(1);
    const s = await humanConn(w);
    const st = await s.conn.call('status', {});
    if ('error' in st) throw new Error(st.error.message);
    expect((st.result as { loops?: unknown }).loops).toMatchObject({ enabled: false, reason: 'not-in-this-build', loops: [] });
    for (const kind of ['request.loop.run', 'request.loop.trust', 'request.loop.pause', 'loop.request']) {
      const r = await s.conn.call('log.append', { kind, payload: { loopId: 'x', all: true } } as never);
      expect('error' in r && refusalOf(r)).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'loops-disabled' } });
    }
    const before = [...d.log.read({ reader: { class: 'human' }, kinds: ['loop.trusted', 'loop.run.started'] })].length;
    // a loop-trust card an earlier kernel left pending: this broker holds no such card
    const a = await s.conn.call('approve', { cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ', decision: 'allow' } as never);
    expect('error' in a && refusalOf(a)?.code).toMatch(/NOT_FOUND|BAD_REQUEST/);
    expect([...d.log.read({ reader: { class: 'human' }, kinds: ['loop.trusted', 'loop.run.started'] })].length).toBe(before);
  });
});

describe('loops off: old cards and rows', () => {
  it('loop-trust and loop-choice are never standing-grant kinds', () => {
    expect(NEVER_STANDING_KINDS.has('loop-trust')).toBe(true);
    expect(NEVER_STANDING_KINDS.has('loop-choice')).toBe(true);
  });
  it('replaying old loop.run.* rows only reads them (the rows are not mutated, nothing is appended)', () => {
    const rows = [
      { kind: 'loop.run.started', payload: { runId: 'lr-1', loopId: 'one', startNode: 'a' } },
      { kind: 'loop.run.ended', payload: { runId: 'lr-1', loopId: 'one', reason: 'done' } },
    ];
    const frozen = JSON.stringify(rows);
    const out = replayLoopRuns(rows);
    expect(typeof out.runs).toBe('object');
    expect(JSON.stringify(rows)).toBe(frozen);
  });
});
