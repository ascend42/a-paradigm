// @gnomon-platform: darwin, linux
/**
 * M1.12 slice 2 (spec §12.8, §19.1; G-CLI-02, G-OBS-01): the published TS
 * client (src/clients/ts) against a LIVE kernel spawned in-test, and the
 * conformance runner driving it through the language-neutral driver protocol.
 * Every CONFORMANCE_CHECKS `run` check passes; `slice-2` checks are `todo`.
 */
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { CLIENT_API_ID, CLIENT_METHODS, CONFORMANCE_CHECKS, RefusedError, conformanceReportHash, type ClientMethod } from '@a-company/gnomon-contracts';
import {
  DEV_TEST_ROOT_ACK,
  DevTestRootAuthority,
  mintReadToken,
  readRegistry,
  registerDevice,
  registerKernelKey,
  RootVerifier,
  writeNewDeviceKey,
} from '../src/kernel/identity/index.js';
import { deviceKeyPath } from '../src/kernel/identity/device-key.js';
import { startDaemon } from '../src/kernel/lifecycle/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { ClientAuthError, GnomonClient, ed25519KeyIdOf, type ClientLogPort } from '../src/clients/ts/index.js';
import { TsClientDriver } from '../src/clients/conformance/driver.js';
import { RUNNER_CHECK_IDS, runConformance, type ConformanceFixture } from '../src/clients/conformance/runner.js';
import { extractSpecifiers, PKG_ROOT, walk } from './helpers.js';
import { tempHome } from './daemon-helpers.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function kernelRig(): Promise<ConformanceFixture & { home: string }> {
  const t = tempHome('gc-');
  cleanups.push(t.cleanup);
  const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  const kernel = SoftwareEd25519Signer.generate('kernel');
  registerKernelKey(t.home, root, kernel.publicKeyPem);
  const devKey = writeNewDeviceKey(t.home);
  const entry = registerDevice(t.home, root, { host: 'mac-1', name: 'founder', publicKeyPem: devKey.publicKeyPem, principalKind: 'human' });
  const d = await startDaemon({ home: t.home, idleMs: 60_000, kernelSigner: kernel, rootAuthority: root });
  cleanups.push(() => d.shutdown('signal'));
  const reg = readRegistry(t.home, new RootVerifier(root.publicKeyPem));
  const other = SoftwareEd25519Signer.generate('kernel');
  const stray = generateKeyPairSync('ed25519');
  const token = mintReadToken(t.home, root, { principalId: `p:${root.ns}/console`, ttlMs: 60 * 60_000 });
  return {
    home: t.home,
    socketPath: d.pidfile.socketPath,
    kernelKey: { keyId: kernel.keyId, publicKeyPem: reg.kernelKeys.get(kernel.keyId)! },
    otherKey: { keyId: other.keyId, publicKeyPem: other.publicKeyPem },
    device: { kind: 'device', principalId: entry.principalId, deviceId: entry.deviceId, privateKeyPem: readFileSync(deviceKeyPath(t.home), 'utf8') },
    unregisteredDevice: { kind: 'device', principalId: entry.principalId, deviceId: `${entry.deviceId}x`, privateKeyPem: stray.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
    readToken: token.token,
    authRows: () => {
      const db = new DatabaseSync(path.join(t.home, 'kernel.db'), { readOnly: true });
      try {
        return (db.prepare("SELECT count(*) AS n FROM chain WHERE kind LIKE 'socket.auth.%'").get() as { n: number }).n;
      } finally {
        db.close();
      }
    },
  };
}

const CLIENT = { name: 'gnomon-ts-client-test', version: '0.0.0', surface: 'cli' };

describe('#gnomon-ts-client against a live kernel (§4.9, §12.8)', () => {
  it('hello + serverSig against the pinned key, device auth, typed calls; refusals reject with the contracts RefusedError', async () => {
    const f = await kernelRig();
    const logs: string[] = [];
    const log: ClientLogPort = { info: (m) => logs.push(`info ${m}`), warn: (m) => logs.push(`warn ${m}`) };
    const c = await GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, kernelKey: f.kernelKey, credential: f.device, log });
    cleanups.push(() => c.close());
    expect(c.serverVerified).toBe(true);
    expect(c.principal).toBe(f.device.principalId);
    expect(c.hello.clientApiId).toBe(CLIENT_API_ID);
    expect(ed25519KeyIdOf(f.kernelKey.publicKeyPem)).toBe(f.kernelKey.keyId);
    const st = await c.call('status', {});
    expect(st.connId).toBe(c.connId);
    expect(st.clientConformance).toEqual({ n: 0, of: 1, label: 'declared' });
    const err = await c.callRaw('no.such.verb', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RefusedError);
    expect((err as RefusedError).refusal.code).toBe('UNKNOWN_VERB');
    expect(logs).toContain('info connected'); // through the injected port, never console
  });

  it('never sends a credential to an unverified or mismatched server', async () => {
    const f = await kernelRig();
    const before = f.authRows();
    await expect(GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, credential: f.device })).rejects.toMatchObject({ reason: 'unverified-server' });
    await expect(GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, kernelKey: f.otherKey, credential: f.device })).rejects.toBeInstanceOf(ClientAuthError);
    await expect(GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, kernelKey: { ...f.kernelKey, keyId: f.otherKey.keyId }, credential: f.device })).rejects.toMatchObject({ reason: 'server-key-mismatch' });
    await new Promise((r) => setTimeout(r, 50));
    expect(f.authRows()).toBe(before);
  });

  it('read token by proof of possession: reads served, writes FORBIDDEN; a subscription delivers backlog then live rows in seq order', async () => {
    const f = await kernelRig();
    const t = await GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, kernelKey: f.kernelKey, credential: { kind: 'read-token', token: f.readToken } });
    cleanups.push(() => t.close());
    expect(t.expiresAt).toBeDefined();
    await expect(t.call('log.append', { kind: 'request.grant', payload: {} })).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    const seqs: number[] = [];
    const sub = await t.subscribe({ since: 0 }, { row: (r) => seqs.push(r.seq) });
    expect(typeof sub.subscription).toBe('string');
    const other = await GnomonClient.connect({ socketPath: f.socketPath, client: CLIENT, kernelKey: f.kernelKey, credential: f.device });
    cleanups.push(() => other.close());
    const deadline = Date.now() + 3000;
    while (!seqs.some((s) => s > sub.head) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(seqs[0]).toBe(1);
    expect(seqs.every((s, i) => i === 0 || s === seqs[i - 1]! + 1 || s > seqs[i - 1]!)).toBe(true);
    expect(seqs.some((s) => s > sub.head)).toBe(true);
    expect(sub.cursor()).toBe(seqs.at(-1));
  });
});

describe('#client-conformance runner (G-CLI-02)', () => {
  it('every `run` check in the catalog has a runner implementation, and nothing else does', () => {
    expect([...RUNNER_CHECK_IDS].sort()).toEqual(CONFORMANCE_CHECKS.filter((c) => c.status === 'run').map((c) => c.id).sort());
  });

  it('the TS client passes every run check against a spawned kernel; slice-2 checks are todo, never passes; the report hash is the declared one', async () => {
    const f = await kernelRig();
    const driver = new TsClientDriver();
    cleanups.push(() => driver.stop());
    const report = await runConformance(driver, f, { client: { name: '@a-company/gnomon/clients/ts', version: '8.0.0', language: 'typescript' } });
    const failed = report.checks.filter((c) => c.result === 'fail');
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.pass).toBe(true);
    for (const c of CONFORMANCE_CHECKS) expect(report.checks.find((x) => x.id === c.id)?.result).toBe(c.status === 'run' ? 'pass' : 'todo');
    expect(report.reportHash).toBe(conformanceReportHash(report));
    expect(report.reportHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('#client-conformance falsifiers (the runner can fail)', () => {
  it('a client whose sanitizer keeps a bidi override, or that authenticates to any server, fails — and the report is not a pass', async () => {
    const f = await kernelRig();
    const inner = new TsClientDriver();
    cleanups.push(() => inner.stop());
    const lying = {
      language: 'typescript',
      stop: () => inner.stop(),
      request: async (r: Parameters<TsClientDriver['request']>[0]) => {
        if (r.op === 'sanitize') return { id: r.id, ok: true, text: String(r.input), flags: [] };
        // a client that skips serverSig verification: drops the pin but still authenticates
        if (r.op === 'connect' && r.kernelKey && (r.kernelKey as { keyId: string }).keyId === f.otherKey.keyId) return inner.request({ ...r, kernelKey: f.kernelKey });
        return inner.request(r);
      },
    };
    const report = await runConformance(lying, f, { client: { name: 'liar', version: '0' } });
    expect(report.pass).toBe(false);
    expect(report.checks.find((c) => c.id === 'display.sanitize')?.result).toBe('fail');
    expect(report.checks.find((c) => c.id === 'hello.server-sig-mismatch')?.result).toBe('fail');
  });
});

describe('#gnomon-ts-client surface', () => {
  it('the client imports only @a-company/gnomon-contracts and node:* (a community client could be built from the package alone)', () => {
    for (const dir of ['src/clients/ts', 'src/clients/conformance']) {
      for (const file of walk(path.join(PKG_ROOT, dir), (f) => f.endsWith('.ts'))) {
        for (const spec of extractSpecifiers(readFileSync(file, 'utf8'))) {
          const ok = spec.startsWith('node:') || spec === '@a-company/gnomon-contracts' || (spec.startsWith('./') || spec.startsWith('../ts/'));
          expect(ok, `${path.relative(PKG_ROOT, file)} imports ${spec}`).toBe(true);
        }
      }
    }
  });

  it('call() is typed for exactly the 12 verbs + 2 relays (ClientMethodParams keys = CLIENT_METHODS)', () => {
    const typed: Record<ClientMethod, true> = {
      status: true, 'session.open': true, 'session.send': true, 'session.stop': true, 'log.append': true, 'log.read': true,
      'permit.reserve': true, approve: true, 'contract.register': true, 'contract.claim': true, 'oracle.run': true, 'ref.resolve': true,
      'mod.view': true, 'mod.command': true,
    };
    expect(Object.keys(typed).sort()).toEqual([...CLIENT_METHODS].sort());
  });
});
