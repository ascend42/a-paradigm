// @gnomon-platform: darwin, linux
/**
 * #dimension-mod over REAL connections (S1.3 P2; spec §12.3, §12.7; Aegis B4). The real mod tree runs as a child
 * from its pinned snapshot; everything between the socket and the mod is the real code.
 *
 *  - The relay table per caller class: a human on the GUI credential (the `gnomon-web` child, a WebSocket and a
 *    launch token) with and without a gesture stamp; a human on a device key, an agent, a session, the voice
 *    principal and a mod on the unix socket.
 *  - A mod's own `log.read`, through the real daemon: `payload.relayedFor` comes back unredacted, so a cold open
 *    folds the same authorship the log holds.
 *  - First-party identity on `tool.call`, and that no production code calls `callTool`.
 *
 * POSIX-only (unix socket, device keys under an owner-only keys/); the mod's own rules run everywhere in
 * test/dimension-mod.test.ts.
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DIM_KINDS, dimHash, foldDim, type DimRow, type PrincipalKind } from '@a-company/gnomon-contracts';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority, readRegistry, registerDevice, registerKernelKey, RootVerifier, UnprovisionedRootAuthority } from '../src/kernel/identity/index.js';
import { startDaemon } from '../src/kernel/lifecycle/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { createModRelayPort } from '../src/kernel/modhost/index.js';
import { connectGnomon, createKernelDispatcher, listenSocket, SocketAuthenticator } from '../src/kernel/socket/index.js';
import { createWebEndpointForTest, unsandboxedModLauncher } from '../src/kernel/testing.js';
import type { WebEndpoint } from '../src/kernel/web/index.js';
import { runDimCommand } from '../src/cli/dim-cli.js';
import { PKG_ROOT } from './helpers.js';
import { tempHome } from './daemon-helpers.js';
import { DIMENSION, DIMENSION_TREE, DIM_ROW_KINDS, dimId, fakeLog, installDimension, rectOp, ulid } from './dimension-helpers.js';
import { host, install, rig as modRig } from './mod-helpers.js';
import { HELLO, rpc, wsConnect, type RawWs } from './web-helpers.js';

const CHILD = path.join(PKG_ROOT, 'dist', 'transport', 'gnomon-web.js');
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const LIVE = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const REPO = 'repo:0123456789abcdef';
const GUI_HUMAN = { connId: 'conn:01JTESTASKER0000000000000', phase: 'authenticated' as const, credential: 'device' as const, principalKind: 'human' as const, principal: 'p:00000000/founder', deviceId: 'dev:00000000/mac-1' };
const SOCKET_MS = 90_000;

type Res = { ok?: boolean; code?: string; fix?: string; seq?: number; hash?: string; applied?: number };
interface Reply {
  result?: { result?: Res };
  error?: { data?: { code?: string; data?: { reason?: string; needs?: string; why?: string; modCode?: string; cap?: string } } };
}

describe('#dimension-mod relay table over real connections (S1.3; G-MOD-16, G-MOD-17, C6)', () => {
  it(
    'human GUI with a stamp: a row that folds human. Human GUI without a stamp: refused. Human on a device key, agent, session, voice, mod: refused not-human-gui, no row, no state',
    async () => {
      const r = modRig();
      cleanups.push(r.cleanup);
      installDimension(r);
      const log = fakeLog();
      const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall: log.kernelCall, callTimeoutMs: 20_000, focusRepo: (hsid) => (hsid === LIVE ? REPO : null), focusPrincipal: () => null });
      cleanups.push(() => h.stopAll());
      await h.start(DIMENSION);
      const stateFile = path.join(r.home, 'mods', DIMENSION, 'state.db');

      /* the GUI credential: the real web endpoint, a WebSocket and a launch token */
      const t = tempHome('dr-');
      cleanups.push(t.cleanup);
      fs.mkdirSync(t.home, { recursive: true, mode: 0o700 });
      const webKernel = SoftwareEd25519Signer.generate('kernel');
      let ep!: WebEndpoint;
      ep = createWebEndpointForTest(
        {
          home: t.home,
          kernelPublicKeyPem: webKernel.publicKeyPem,
          scriptPath: CHILD,
          log: async () => undefined,
          dispatcher: (endpointPath, web) =>
            createKernelDispatcher({
              authenticator: new SocketAuthenticator({ home: t.home, endpointPath, kernelSigner: webKernel, trust: new UnprovisionedRootAuthority() }),
              web,
              mods: createModRelayPort(h),
              log: async () => undefined,
              status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: webKernel.keyId, custody: 'partial', source: 'test' }), root: () => ({ state: 'unprovisioned', rootKeyId: null }), web: () => ep.status() },
            }),
        },
        {},
      );
      cleanups.push(() => ep.stop('test'));
      const grant = await ep.requestLaunch(GUI_HUMAN);
      const ws: RawWs = await wsConnect(ep.port);
      cleanups.push(() => ws.end());
      ws.sendJson(rpc(1, 'hello', HELLO('browser')));
      await ws.nextJson();
      ws.sendJson(rpc(2, 'auth', { launchToken: grant.launchToken }));
      const guiConn = ((await ws.nextJson()) as { result: { connId: string } }).result.connId;
      let id = 10;
      let n = 0;
      const gui = async (commandId: string, args: Record<string, unknown>, stamped = true): Promise<Reply> => {
        ws.sendJson(rpc(++id, 'mod.command', { name: DIMENSION, commandId, args: { ...args, focus: { hsid: LIVE }, ...(stamped ? { gesture: { n: ++n, kind: 'pointer' } } : {}) } }));
        return (await ws.nextJson()) as Reply;
      };

      const dim = dimId(1);
      const table: unknown[][] = [];

      // human GUI WITHOUT a stamp: the socket refuses before the mod is called
      const bare = await gui('dim.open', { dim, title: 'Relay', opened: 'command' }, false);
      table.push(['human gui, no stamp', bare.error?.data?.code, `${String(bare.error?.data?.data?.reason)}/${String(bare.error?.data?.data?.needs)}`, log.rows.length]);
      expect(fs.existsSync(stateFile)).toBe(false);

      // human GUI WITH a stamp: open, draw, and the rows fold human
      const opened = await gui('dim.open', { dim, title: 'Relay', opened: 'command' });
      expect(opened.result?.result).toMatchObject({ ok: true, created: true, seq: 1 });
      const drew = await gui('dim.op', { dim, ops: [rectOp(1), rectOp(2)] });
      expect(drew.result?.result).toMatchObject({ ok: true, seq: 2, applied: 2 });
      const fold = log.fold(dim);
      table.push(['human gui, stamp', 'ok', [...fold.nodes.values()].map((x) => x.by.cls).join(','), log.rows.length]);
      expect([...fold.nodes.values()].map((x) => x.by)).toEqual([{ cls: 'human', principal: GUI_HUMAN.principal }, { cls: 'human', principal: GUI_HUMAN.principal }]);
      expect(log.rows.map((x) => [x.kind, x.scope, x.payload.relayedFor])).toEqual([
        [DIM_KINDS.start, { repo: REPO }, { principal: GUI_HUMAN.principal, connId: guiConn, surface: 'gui' }],
        [DIM_KINDS.op, { repo: REPO }, { principal: GUI_HUMAN.principal, connId: guiConn, surface: 'gui' }],
      ]);
      // the stamp is in no row and reached no arg the mod kept
      expect(JSON.stringify(log.rows).includes('gesture')).toBe(false);
      // a client-supplied identity is never read: hsid, repo, relayedFor and by sent by the page change nothing
      const forged = await gui('dim.op', { dim, ops: [rectOp(3)], hsid: 'hs-evil', repo: 'repo:ffffffffffffffff' });
      expect(forged.result?.result).toMatchObject({ ok: true, seq: 3 });
      expect(log.rows[2]).toMatchObject({ scope: { repo: REPO }, payload: { relayedFor: { principal: GUI_HUMAN.principal, surface: 'gui' } } });

      /* device keys on a real unix socket: every other caller class */
      const u = tempHome('du-');
      cleanups.push(u.cleanup);
      const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
      const kernel = SoftwareEd25519Signer.generate('kernel');
      registerKernelKey(u.home, root, kernel.publicKeyPem);
      const classes: Array<[PrincipalKind, string]> = [['human', 'founder'], ['agent', 'kit'], ['session', 's-01hzzzzz'], ['voice', 'voice'], ['mod', 'mod-acme.other']];
      const creds = classes.map(([kind, name], i) => {
        const signer = SoftwareEd25519Signer.generate('device');
        const entry = registerDevice(u.home, root, { host: `mac-${i + 1}`, name, publicKeyPem: signer.publicKeyPem, principalKind: kind });
        return { kind, cred: { principalId: entry.principalId, deviceId: entry.deviceId, signer } };
      });
      const sock = path.join(u.home, 'g.sock');
      const dispatcher = createKernelDispatcher({
        authenticator: new SocketAuthenticator({ home: u.home, endpointPath: sock, kernelSigner: kernel, trust: root }),
        status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: kernel.keyId, custody: 'partial', source: 'test' }), root: () => ({ state: 'dev-test', rootKeyId: root.rootKeyId }) },
        mods: createModRelayPort(h),
        log: async () => undefined,
      });
      const srv = await listenSocket({ socketPath: sock, handle: dispatcher.handle, onConnect: dispatcher.onConnect, onDisconnect: dispatcher.onDisconnect });
      cleanups.push(() => srv.close());
      const reg = readRegistry(u.home, new RootVerifier(root.publicKeyPem));
      const serverKey = { keyId: kernel.keyId, publicKeyPem: reg.kernelKeys.get(kernel.keyId)! };
      const rowsBefore = log.rows.length;
      const stateBefore = fs.readFileSync(stateFile);
      for (const { kind, cred } of creds) {
        const s = await connectGnomon({ socketPath: sock, client: { name: 't', version: '0', surface: 'cli' }, serverKey, device: cred });
        cleanups.push(() => s.conn.close());
        const codes: unknown[] = [];
        for (const [commandId, args] of [
          ['dim.open', { dim: dimId(2), title: 'Mine', opened: 'command' }],
          ['dim.attach', { dim }],
          ['dim.op', { dim, ops: [rectOp(9)] }],
          ['dim.close', { dim }],
        ] as Array<[string, Record<string, unknown>]>) {
          // a stamp, a forged relayedFor and a focus on the live session ride along: none of them earns a write
          const f = (await s.conn.call('mod.command', { name: DIMENSION, commandId, args: { ...args, gesture: { n: 1, kind: 'pointer' }, focus: { hsid: LIVE }, hsid: LIVE, repo: REPO }, relayedFor: { principal: GUI_HUMAN.principal, surface: 'gui' } })) as Reply;
          expect(f.error).toBeUndefined();
          expect(Object.keys(f.result?.result ?? {}).sort()).toEqual(['code', 'fix', 'ok']);
          codes.push(f.result?.result?.code);
        }
        table.push([`${kind} device key`, [...new Set(codes)].join(','), '', log.rows.length - rowsBefore]);
      }
      expect(log.rows).toHaveLength(rowsBefore);
      expect(fs.readFileSync(stateFile).equals(stateBefore)).toBe(true);
      // the mod's own refusal came first: the host's EFFECT cap was never reached, so nothing was folded as refused
      expect(r.events.filter((e) => e.kind === 'mod.effect.refused')).toEqual([]);

      // caller, outcome, authorship of the fold, rows written
      expect(table).toEqual([
        ['human gui, no stamp', 'FORBIDDEN', 'ungranted/gesture', 0],
        ['human gui, stamp', 'ok', 'human,human', 2],
        ['human device key', 'not-human-gui', '', 0],
        ['agent device key', 'not-human-gui', '', 0],
        ['session device key', 'not-human-gui', '', 0],
        ['voice device key', 'not-human-gui', '', 0],
        ['mod device key', 'not-human-gui', '', 0],
      ]);
      process.stdout.write(`dimension relay table\n${table.map((row) => `  ${row.map((c) => String(c)).join(' | ')}`).join('\n')}\n`);
    },
    SOCKET_MS,
  );
});

describe("#dimension-mod on the real kernel log (S1.3): a mod's own log.read", () => {
  it(
    'returns payload.relayedFor unredacted and the envelope scope, so a cold open folds the authorship the log holds (hash equal to a human reader\'s fold)',
    async () => {
      const t = tempHome('dl-');
      cleanups.push(t.cleanup);
      const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
      const kernel = SoftwareEd25519Signer.generate('kernel');
      registerKernelKey(t.home, root, kernel.publicKeyPem);
      const d = await startDaemon({ home: t.home, idleMs: 60_000, kernelSigner: kernel, rootAuthority: root });
      cleanups.push(() => d.shutdown('signal'));
      // a mod host beside the daemon on the unsandboxed launcher seam; its kernel.call is the DAEMON's own
      const r = { ...modRig(), auth: root };
      cleanups.push(r.cleanup);
      installDimension(r);
      const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall: d.modKernelCall, callTimeoutMs: 20_000, focusRepo: (hsid) => (hsid === LIVE ? REPO : null) });
      cleanups.push(() => h.stopAll());
      await h.start(DIMENSION);
      const who = { principal: `p:${root.ns}/founder`, connId: 'conn:01JTESTGUI000000000000000', surface: 'gui' as const, principalClass: 'human' };
      const run = async (commandId: string, args: Record<string, unknown>): Promise<Res> => (await h.relayCommand({ name: DIMENSION, commandId, args: { ...args, focus: { hsid: LIVE } }, ...who })) as Res;
      const dim = dimId(7);
      expect(await run('dim.open', { dim, title: 'Real log', opened: 'menu' })).toMatchObject({ ok: true, created: true });
      expect(await run('dim.op', { dim, ops: [rectOp(1), rectOp(2, { label: 'two' })] })).toMatchObject({ ok: true, applied: 2 });
      expect(await run('dim.op', { dim, ops: [{ type: 'delete', id: ulid(1) }] })).toMatchObject({ ok: true, applied: 1 });

      // the mod principal's own page, through the real dispatcher: the stamp is there, whole
      const modPrincipal = `p:${root.ns}/mod-${DIMENSION}`;
      const page = (await d.dispatcher.callAs(modPrincipal, 'log.read', { kinds: [...DIM_ROW_KINDS] })) as { projection: string; rows: Array<{ seq: number; view: string; event: { kind: string; payload: Record<string, unknown>; scope?: Record<string, unknown>; hash?: string } }> };
      expect(page.projection).toBe('mod');
      expect(page.rows.map((x) => [x.view, x.event.kind, x.event.payload.relayedFor, x.event.scope?.repo])).toEqual([
        ['full', DIM_KINDS.start, { principal: who.principal, connId: who.connId, surface: 'gui' }, REPO],
        ['full', DIM_KINDS.op, { principal: who.principal, connId: who.connId, surface: 'gui' }, REPO],
        ['full', DIM_KINDS.op, { principal: who.principal, connId: who.connId, surface: 'gui' }, REPO],
      ]);
      const human: DimRow[] = [...d.log.read({ reader: { class: 'human' }, kinds: [...DIM_ROW_KINDS] })].map((v) => ({ seq: v.seq, kind: (v as { event: { kind: string } }).event.kind, payload: (v as { event: { payload: unknown } }).event.payload }));
      expect(foldDim(page.rows.map((x) => ({ seq: x.seq, kind: x.event.kind, payload: x.event.payload })))).toEqual(foldDim(human));

      // a cold open (no keyframe yet: the dimension was never closed) reads those rows with a cursor and an until
      await h.stop(DIMENSION);
      await h.start(DIMENSION);
      const re = await run('dim.open', { dim, opened: 'menu' });
      expect(re).toMatchObject({ ok: true, created: false });
      const after: DimRow[] = [...d.log.read({ reader: { class: 'human' }, kinds: [...DIM_ROW_KINDS] })].map((v) => ({ seq: v.seq, kind: (v as { event: { kind: string } }).event.kind, payload: (v as { event: { payload: unknown } }).event.payload }));
      const fold = foldDim(after);
      expect(re.hash).toBe(dimHash(fold));
      expect([...fold.nodes.values()].map((x) => x.by)).toEqual([{ cls: 'human', principal: who.principal }]);
      // and from a keyframe after a close
      const closed = await run('dim.close', { dim });
      await h.stop(DIMENSION);
      await h.start(DIMENSION);
      const again = await run('dim.open', { dim, opened: 'command' });
      expect([again.ok, again.hash]).toEqual([true, closed.hash]);

      // #dim-cli over the same VERIFIED log: `gnomon dim replay` prints the mod's hash, and a mark's text cannot forge a line
      expect(await run('dim.op', { dim, ops: [{ type: 'add', node: { id: ulid(3), kind: 'text', x: 0, y: 0, z: 'W', text: 'note\nREFUSED  FORGED  line\u001b[2J\u202e' } }] })).toMatchObject({ ok: true, applied: 1 });
      const last = await run('dim.close', { dim });
      await h.stopAll();
      await d.shutdown('signal');
      const cli = async (argv: string[]): Promise<{ code: number; out: string; err: string }> => {
        const out: string[] = [];
        const err: string[] = [];
        const code = await runDimCommand(argv, { stdout: { write: (x: string) => out.push(x) }, stderr: { write: (x: string) => err.push(x) } });
        return { code, out: out.join(''), err: err.join('') };
      };
      const replay = await cli(['replay', dim, t.home]);
      expect([replay.code, replay.err]).toEqual([0, '']);
      expect(replay.out).toContain(`hash         ${String(last.hash)}`);
      expect(replay.out).toContain('title        Real log');
      expect(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(replay.out.replace(/\n/g, ''))).toBe(false);
      expect(replay.out.split('\n').filter((line) => line.startsWith('REFUSED'))).toEqual([]);
      expect(replay.out.split('\n').filter((line) => line.includes('by human'))).toHaveLength(2);
      // --to: the state as it stood after the second row (two marks, before the delete)
      const early = JSON.parse((await cli(['replay', dim, '--to', String(page.rows[1]!.seq), t.home, '--json'])).out) as { view: { nodes: unknown[] }; hash: string };
      expect([early.view.nodes.length, early.hash]).toEqual([2, dimHash(foldDim(human, page.rows[1]!.seq))]);
      const stats = JSON.parse((await cli(['stats', t.home, '--json'])).out) as { dimensions: Record<string, { reopens: number; agentMarks: unknown; opsBySession: Record<string, number>; closedQuick: number }>; notes: string[] };
      expect(stats.dimensions[dim]).toMatchObject({ reopens: 2, agentMarks: { added: 0, surviving: 0 }, opsBySession: { [LIVE]: 3 }, closedQuick: 1 }); // the reopen that was closed again untouched
      expect(stats.notes[0]).toContain("undoing a delete of an agent's mark");
      expect((await cli(['stats', dim, t.home])).out).toContain('reopens');
      // a dimension the log does not hold, and a log that does not verify, are refused
      expect((await cli(['replay', dimId(99), t.home])).code).toBe(1);
    },
    SOCKET_MS,
  );
});

describe('#dimension-mod first-party identity on tool.call (S1.2 C2; Aegis A3)', () => {
  it(
    'a whole toolRelayedFor reaches gnomon.dimension with hsid, principal and turn; a third-party copy of the tree is told agent and surface only; neither appends',
    async () => {
      const r = modRig();
      cleanups.push(r.cleanup);
      installDimension(r);
      // the same tree under another publisher: no pin, so the local tier
      const copy = path.join(r.root, 'src', 'acme.spacecopy');
      fs.cpSync(DIMENSION_TREE, copy, { recursive: true });
      const m = JSON.parse(fs.readFileSync(path.join(copy, 'gnomon-manifest.json'), 'utf8')) as { publisher: string; name: string; provides: { events: string[] } };
      m.publisher = 'acme';
      m.name = 'spacecopy'; // `dimension` and `dim` are reserved first-party names
      m.provides.events = m.provides.events.map((k) => k.replace('modns.gnomon.dimension.', 'modns.acme.spacecopy.'));
      fs.writeFileSync(path.join(copy, 'gnomon-manifest.json'), JSON.stringify(m, null, 2));
      install(r, copy);
      const log = fakeLog();
      const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall: log.kernelCall, callTimeoutMs: 20_000 });
      cleanups.push(() => h.stopAll());
      await h.start(DIMENSION);
      await h.start('acme.spacecopy');
      const toolRelayedFor = { principal: 'p:00000000/s-01hzzzzz', surface: 'bridge' as const, agent: 'kit', hsid: LIVE, turn: `turn:${LIVE}/3` };
      for (const tool of ['dim-view', 'dim-draw']) {
        const first = (await h.callTool(DIMENSION, tool, { dim: dimId(1), ops: [rectOp(1)] }, { hsid: LIVE, toolRelayedFor })) as { refused: string; saw: string[] };
        expect(first.refused).toBe('not-available');
        expect(first.saw).toEqual(expect.arrayContaining(['hsid', 'principal', 'turn']));
        expect([...first.saw].sort()).toEqual(['agent', 'hsid', 'principal', 'surface', 'turn']);
        const third = (await h.callTool('acme.spacecopy', tool, { dim: dimId(1), ops: [rectOp(1)] }, { hsid: LIVE, toolRelayedFor })) as { refused: string; saw: string[] };
        expect([third.refused, [...third.saw].sort()]).toEqual(['not-available', ['agent', 'surface']]);
      }
      // `saw` is field names only
      expect(JSON.stringify(await h.callTool(DIMENSION, 'dim-draw', {}, { hsid: LIVE, toolRelayedFor })).includes('kit')).toBe(false);
      expect(log.rows).toEqual([]);
    },
    SOCKET_MS,
  );

  it('no production caller of ModHost.callTool exists: the tools are unreachable until the S1.4 bridge', () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|mts|mjs|js)$/.test(e.name)) {
          const lines = fs.readFileSync(p, 'utf8').split('\n');
          lines.forEach((line, i) => {
            if (/\bcallTool\s*\(/.test(line)) hits.push(`${path.relative(path.join(PKG_ROOT, 'src'), p).split(path.sep).join('/')}:${i + 1}`);
          });
        }
      }
    };
    walk(path.join(PKG_ROOT, 'src'));
    // the two definitions (the mod host's and the local MCP client's own method) and the MCP client calling ITS method
    const src = (f: string): string => fs.readFileSync(path.join(PKG_ROOT, 'src', f), 'utf8');
    expect(hits.map((x) => x.replace(/:\d+$/, '')).sort()).toEqual(['kernel/local/mcp-client.ts', 'kernel/local/mcp-client.ts', 'kernel/modhost/host.ts']);
    expect(src('kernel/modhost/host.ts').match(/\bcallTool\s*\(/g)).toHaveLength(1); // the definition
    expect(/import[^;]*modhost/.test(src('kernel/local/mcp-client.ts'))).toBe(false); // that file's callTool is its own class's
  });
});
