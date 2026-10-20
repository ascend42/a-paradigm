// @gnomon-platform: darwin, linux
/**
 * #gnomon-voice V2e, daemon half (T-2026-10-19-026): the kernel spawns the voice client as its own child over an
 * inherited socketpair (fd 3), authenticates that fd as p:<ns>/voice itself (no hello, no auth, no key in the child),
 * and the child dies with the kernel on every exit, an upgrade drain included: it never carries over (TD-908).
 * The child here is a real node process standing in for gnomon-voice: it speaks one `status` over fd 3.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startDaemon, type DaemonHandle } from '../src/kernel/lifecycle/index.js';
import { loadDevHome, provisionDevHome } from '../src/cli/dev-home.js';
import { tempHome } from './daemon-helpers.js';

const FAKE_CLIENT = `
const net = require('node:net');
process.stdin.on('end', () => process.exit(0)); process.stdin.resume();
const s = new net.Socket({ fd: 3, readable: true, writable: true });
let buf = '';
s.on('data', (b) => { buf += b; const i = buf.indexOf('\\n'); if (i >= 0) { process.stdout.write(buf.slice(0, i) + '\\n'); buf = buf.slice(i + 1); } });
s.write(JSON.stringify({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 1, method: 'status', params: {} }) + '\\n');
setInterval(() => {}, 1000);
`;

const homes: Array<() => void> = [];
const daemons: DaemonHandle[] = [];
afterEach(async () => {
  for (const d of daemons.splice(0)) await d.shutdown('signal').catch(() => undefined);
  homes.splice(0).forEach((c) => c());
});

async function boot() {
  const t = tempHome('v2e-');
  homes.push(t.cleanup);
  fs.mkdirSync(path.dirname(t.home), { recursive: true });
  const userHome = fs.realpathSync.native(path.dirname(t.home));
  const home = path.join(userHome, 'devhome');
  provisionDevHome(home, { userHome });
  const l = loadDevHome(home, { userHome });
  const kids: Array<{ child: ChildProcess; args: string[]; env: NodeJS.ProcessEnv | undefined; out: string[]; exited: Promise<void> }> = [];
  const d = await startDaemon({
    home,
    idleMs: 60_000,
    kernelSigner: l.kernel,
    rootAuthority: l.root,
    voice: {
      client: {
        entry: '/pkg/gnomon-voice/dist/cli.js',
        prepare: async () => ({ ioBinary: '/io/gnomon-voice-io', devUnsigned: true }),
        spawn: (_cmd, args, o) => {
          const child = spawn(process.execPath, ['-e', FAKE_CLIENT], o);
          const out: string[] = [];
          child.stdout!.on('data', (b: Buffer) => out.push(b.toString('utf8')));
          kids.push({ child, args, env: o.env, out, exited: new Promise((r) => child.once('exit', () => r())) });
          return child;
        },
      },
    },
  });
  daemons.push(d);
  return { d, l, kids, ns: l.root.ns! };
}

const until = async (f: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('#gnomon-voice V2e: the kernel-spawned voice client', () => {
  it('spawns over fd 3; the kernel authenticates that fd as p:<ns>/voice; status.voice reports it', async () => {
    const { d, kids, ns } = await boot();
    const s = await d.voiceClient.start();
    expect(s).toMatchObject({ phase: 'running', clientConnected: true, devUnsigned: true });
    expect(kids).toHaveLength(1);
    expect(kids[0]!.args).toEqual(['--disable-sigusr1', '/pkg/gnomon-voice/dist/cli.js', 'run', '--fd', '3', '--home', expect.any(String), '--io', '/io/gnomon-voice-io']);
    expect(Object.keys(kids[0]!.env!).filter((k) => k.startsWith('GNOMON_'))).toEqual(['GNOMON_HOME']);
    const c = d.dispatcher.clients().find((x) => x.connId === d.voiceClient.connId);
    expect(c).toMatchObject({ principal: `p:${ns}/voice`, principalKind: 'voice', credential: 'device' });
    // the child really speaks over the inherited fd, as the voice principal, with no hello and no key
    await until(() => kids[0]!.out.join('').includes('\n'));
    const reply = JSON.parse(kids[0]!.out.join('').split('\n')[0]!) as { result?: { voice?: { clientConnected?: boolean; client?: { phase?: string } } } };
    expect(reply.result?.voice).toMatchObject({ clientConnected: true, client: { phase: 'running' } });
    const auth = [...d.log.read({ reader: { class: 'human' }, kinds: ['socket.auth.ok'] })].map((v) => (v.view === 'full' ? v.event.payload : null));
    expect(auth).toContainEqual(expect.objectContaining({ principal: `p:${ns}/voice`, via: 'spawn' }));
    expect(d.status()).toBeDefined();
  });

  it('a crashed child is restarted (backoff) and re-authenticated on a fresh connection', async () => {
    const { d, kids } = await boot();
    await d.voiceClient.start();
    const first = d.voiceClient.connId;
    kids[0]!.child.kill('SIGKILL');
    await until(() => kids.length === 2 && d.voiceClient.status().phase === 'running', 8000);
    expect(d.voiceClient.connId).not.toBe(first);
    expect(d.voiceClient.status().restarts).toBe(1);
  });

  it('dies with the daemon on close (signal) and is awaited before exit', async () => {
    const { d, kids } = await boot();
    await d.voiceClient.start();
    await d.shutdown('signal');
    daemons.splice(0);
    expect(kids[0]!.child.exitCode !== null || kids[0]!.child.signalCode !== null).toBe(true);
    expect(d.voiceClient.status()).toMatchObject({ phase: 'stopped', clientConnected: false });
    expect(await d.voiceClient.start()).toMatchObject({ phase: 'stopped' }); // never respawned after close
    expect(kids).toHaveLength(1);
  });

  it('dies on an upgrade drain too: it never carries over to the successor (TD-908)', async () => {
    const { d, kids } = await boot();
    await d.voiceClient.start();
    await d.shutdown('upgrade');
    daemons.splice(0);
    await kids[0]!.exited;
    expect(kids[0]!.child.exitCode !== null || kids[0]!.child.signalCode !== null).toBe(true);
    expect(kids).toHaveLength(1);
  });
});
