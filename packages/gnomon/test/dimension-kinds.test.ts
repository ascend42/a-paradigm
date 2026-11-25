// @gnomon-platform: darwin, linux
/**
 * #dimension-mod: ONLY the dimension mod can append the dimension row kinds, on the REAL kernel (boards S1.3 pass
 * P4b-3; Aegis, final review of P4a: "not verified by reading: that only the dimension mod can append the dimension
 * row kinds. Test it").
 *
 * A real daemon and its real log. Every other writer is tried against all four kinds (`modns.gnomon.dimension.`
 * session.start, attach, op, session.end):
 *   - a human, an agent, a session, the voice principal and a mod principal on real socket connections, and a
 *     human's read token;
 *   - another mod's `kernel.call` at the daemon's own bridge (`modKernelCall`), under names chosen to sit as close to
 *     the owner's as a name can: a third-party mod, a first-party mod, a name that only shares the prefix, and the
 *     legacy bare name;
 *   - two real mod children (a third-party probe and a `gnomon`-published one) asking through their own SDK.
 * Each is refused and no dimension row is in the log. Then the real `gnomon.dimension` child appends all four through
 * its commands, and the log holds exactly those rows under the mod's own principal.
 *
 * POSIX-only (a unix socket and device keys under an owner-only keys/), as test/dimension-relay.test.ts.
 */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DIM_KINDS, type PrincipalKind } from '@a-company/gnomon-contracts';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority, RootVerifier, loadDeviceKey, mintReadToken, readRegistry, registerDevice, registerKernelKey, writeNewDeviceKey } from '../src/kernel/identity/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { connectGnomon, type DeviceCredential, type GnomonSession, type ServerKeyPin } from '../src/kernel/socket/index.js';
import { startDaemonForTest, unsandboxedModLauncher } from '../src/kernel/testing.js';
import { tempHome } from './daemon-helpers.js';
import { DIMENSION, DIM_ROW_KINDS, dimId, installDimension, rectOp } from './dimension-helpers.js';
import { firstPartyProbeManifest, host, install, installFirstParty, probeManifest, PROBE_SOURCE, rig as modRig, writeModFolder } from './mod-helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const LIVE = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const OTHER = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const REPO = 'repo:0123456789abcdef';
const SOCKET_MS = 90_000;

/** The probe mod, asked to append ANY kind (its own source appends only its own). */
const FIXED = "api.kernel('log.append', { kind: 'modns.acme.probe.done' })";
const ANY_KIND = PROBE_SOURCE.replace(FIXED, "api.kernel('log.append', { kind: input.kind ?? 'modns.acme.probe.done', payload: input.payload ?? {} })");

describe('#dimension-mod: only the dimension mod appends the dimension row kinds (real kernel; S1.3 P4b-3)', () => {
  it('the probe source used here really asks for the kind it is given', () => {
    expect(PROBE_SOURCE).toContain(FIXED);
    expect(ANY_KIND).not.toContain(FIXED);
    expect(DIM_ROW_KINDS).toEqual([DIM_KINDS.start, DIM_KINDS.attach, DIM_KINDS.op, DIM_KINDS.end]);
    for (const k of DIM_ROW_KINDS) expect(k.startsWith('modns.gnomon.dimension.')).toBe(true);
  });

  it(
    'every other writer is refused for all four kinds and no dimension row is written; the dimension mod writes all four under its own principal',
    async () => {
      const t = tempHome('dk-');
      cleanups.push(t.cleanup);
      const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
      const kernel = SoftwareEd25519Signer.generate('kernel');
      registerKernelKey(t.home, root, kernel.publicKeyPem);
      writeNewDeviceKey(t.home);
      const creds = new Map<PrincipalKind, DeviceCredential>();
      for (const kind of ['human', 'agent', 'mod', 'voice', 'session'] as PrincipalKind[]) {
        const file = path.join(t.home, 'keys', `${kind}.key`);
        const key = writeNewDeviceKey(t.home, file);
        const e = registerDevice(t.home, root, { host: `host-${kind}`, name: `n-${kind}`, publicKeyPem: key.publicKeyPem, principalKind: kind });
        creds.set(kind, { principalId: e.principalId, deviceId: e.deviceId, signer: loadDeviceKey(t.home, file) });
      }
      const d = await startDaemonForTest({ home: t.home, idleMs: 60_000, kernelSigner: kernel, rootAuthority: root }, {});
      cleanups.push(() => d.shutdown('signal'));
      const reg = readRegistry(t.home, new RootVerifier(root.publicKeyPem));
      const pin: ServerKeyPin = { keyId: kernel.keyId, publicKeyPem: reg.kernelKeys.get(kernel.keyId)! };
      const client = { name: 'gnomon-test', version: '0.0.0', surface: 'cli' as const };
      const as = async (kind: PrincipalKind): Promise<GnomonSession> => {
        const s = await connectGnomon({ socketPath: d.pidfile.socketPath, client, serverKey: pin, device: creds.get(kind)! });
        cleanups.push(() => s.conn.close());
        return s;
      };
      const dimRows = (): Array<{ seq: number; kind: string; principal: string }> =>
        [...d.log.read({ reader: { class: 'human' }, kinds: [...DIM_ROW_KINDS] })].map((v) => {
          const e = (v as { event: { kind: string; principal: string } }).event;
          return { seq: v.seq, kind: e.kind, principal: e.principal };
        });
      const dim = dimId(31);
      // a payload the mod itself could have written, so nothing but WHO asks is wrong with it
      const payloadOf = (kind: string): Record<string, unknown> =>
        kind === DIM_KINDS.op ? { v: 1, dim, ops: [rectOp(1)] } : kind === DIM_KINDS.end ? { v: 1, dim, ops: 0, nodes: 0 } : kind === DIM_KINDS.attach ? { v: 1, dim, hsid: LIVE } : { v: 1, dim, title: 'Forged', attached: [LIVE], opened: 'menu' };

      const refusals: string[] = [];
      /** every row of the log, whatever its kind (a connection writes rows of its own, so the head moves; what must not appear is a dimension row) */
      const allKinds = (): string[] => [...d.log.read({ reader: { class: 'human' } })].map((v) => (v as { event: { kind: string } }).event.kind);
      const none = (who: string): void => {
        expect(dimRows(), `${who} wrote a dimension row`).toEqual([]);
        expect(allKinds().filter((k) => k.startsWith('modns.gnomon.dimension')), `${who} wrote a dimension row`).toEqual([]);
      };
      none('nobody yet');

      // 1. real socket connections, one per caller class, and a human's read token
      for (const cls of ['human', 'agent', 'mod', 'voice', 'session'] as const) {
        const s = await as(cls);
        for (const kind of DIM_ROW_KINDS) {
          const f = await s.conn.call('log.append', { kind, payload: payloadOf(kind) });
          expect('error' in f, `${cls} ${kind} must be refused`).toBe(true);
          if ('error' in f) refusals.push(`${cls}:${String(f.error.data.code)}`);
        }
      }
      const m = mintReadToken(t.home, root, { principalId: creds.get('human')!.principalId, ttlMs: 60_000 });
      const rt = await connectGnomon({ socketPath: d.pidfile.socketPath, client, serverKey: pin, readToken: m.token });
      cleanups.push(() => rt.conn.close());
      for (const kind of DIM_ROW_KINDS) {
        const f = await rt.conn.call('log.append', { kind, payload: payloadOf(kind) });
        expect('error' in f, `read-token ${kind} must be refused`).toBe(true);
      }
      none('a socket caller');

      // 2. the daemon's own bridge, as another mod: names as near the owner's as a name can be
      // (a bare id `gnomon` would own every modns.gnomon.* kind by the whole-segment rule; it is not a mod id: an id is
      // `<publisher>.<name>`, and this list holds only ids of that shape plus the legacy bare name)
      const near = ['acme.probe', 'gnomon.probe', 'gnomon.dimension2', 'gnomon.dimensio', 'gnomon.dim', 'dimension', 'gnomon.dimension.x', 'evil.gnomon.dimension'];
      for (const name of near) {
        for (const kind of DIM_ROW_KINDS) {
          const call = d.modKernelCall({ name, principal: `p:${root.ns}/mod-${name}`, verb: 'log.append', params: { kind, payload: payloadOf(kind) } });
          await expect(call, `mod ${name} ${kind}`).rejects.toMatchObject({ name: 'ModRefusal', modCode: 'VERB', detail: { name, verb: 'log.append' } });
        }
      }
      // and the dispatcher's mod cell for a mod principal that is not the owner
      for (const name of ['acme.probe', 'gnomon.probe']) {
        for (const kind of DIM_ROW_KINDS) await expect(d.dispatcher.callAs(`p:${root.ns}/mod-${name}`, 'log.append', { kind, payload: payloadOf(kind) }), `callAs ${name} ${kind}`).rejects.toBeTruthy();
      }
      none('another mod at the bridge');

      // 3. two REAL mod children beside the real dimension mod, on the daemon's own kernel.call
      const r = { ...modRig(), auth: root };
      cleanups.push(r.cleanup);
      installDimension(r);
      install(r, writeModFolder(path.join(r.root, 'src', 'acme.probe'), probeManifest(), ANY_KIND));
      const first = installFirstParty(r, firstPartyProbeManifest(), ANY_KIND.replaceAll('modns.acme.probe.', 'modns.gnomon.probe.'));
      const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall: d.modKernelCall, callTimeoutMs: 20_000, focusRepo: (hsid) => (hsid === LIVE || hsid === OTHER ? REPO : null) });
      cleanups.push(() => h.stopAll());
      await h.start('acme.probe');
      await h.start(first);
      await h.start(DIMENSION);
      // (each probe CAN append its own kind: the refusals below are about the kind, not about a probe that cannot write)
      expect(await h.callTool('acme.probe', 'probe.write', { op: 'append' })).toMatchObject({ ok: true });
      expect(await h.callTool(first, 'probe.write', { op: 'append' })).toMatchObject({ ok: true });
      expect(allKinds().filter((k) => k === 'modns.acme.probe.done' || k === 'modns.gnomon.probe.done').sort()).toEqual(['modns.acme.probe.done', 'modns.gnomon.probe.done']);
      const afterOwn = d.log.head().seq;
      for (const name of ['acme.probe', first]) {
        for (const kind of DIM_ROW_KINDS) {
          expect(await h.callTool(name, 'probe.write', { op: 'append', kind, payload: payloadOf(kind) }), `${name} child ${kind}`).toMatchObject({ ok: false });
        }
      }
      // (nothing else writes here: no connection is made in this part, so the head itself must stand still)
      expect(d.log.head().seq, 'a mod child moved the log').toBe(afterOwn);
      none('a mod child');

      // 4. the owner: the real dimension mod writes all four kinds through its commands, under its own principal
      const who = { principal: `p:${root.ns}/founder`, connId: 'conn:01JTESTGUI000000000000000', surface: 'gui' as const, principalClass: 'human' };
      const run = async (commandId: string, args: Record<string, unknown>, hsid = LIVE): Promise<{ ok?: boolean; code?: string }> => (await h.relayCommand({ name: DIMENSION, commandId, args: { ...args, focus: { hsid } }, ...who })) as { ok?: boolean; code?: string };
      expect(await run('dim.open', { dim, title: 'Owner', opened: 'menu' })).toMatchObject({ ok: true, created: true });
      expect(await run('dim.attach', { dim }, OTHER)).toMatchObject({ ok: true });
      expect(await run('dim.op', { dim, ops: [rectOp(1)] })).toMatchObject({ ok: true });
      expect(await run('dim.close', { dim })).toMatchObject({ ok: true });
      const rows = dimRows();
      const modPrincipal = `p:${root.ns}/mod-${DIMENSION}`;
      expect(rows.map((x) => x.kind)).toEqual([DIM_KINDS.start, DIM_KINDS.attach, DIM_KINDS.op, DIM_KINDS.end]);
      expect(new Set(rows.map((x) => x.principal))).toEqual(new Set([modPrincipal]));

      // what the socket said to each class, for the record of this run (a refusal code, never a success)
      expect(refusals).toHaveLength(5 * DIM_ROW_KINDS.length);
      expect(new Set(refusals.map((x) => x.split(':')[1]))).toEqual(new Set(['FORBIDDEN']));
    },
    SOCKET_MS,
  );
});
