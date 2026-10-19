// @gnomon-platform: darwin, linux
/**
 * #socket / $daemon-lifecycle — socket ownership: never treat "can't tell" as
 * "dead" (T-2026-10-19-009 item 2, Orca audit "Adopt 2", spec §2.4 rule 1).
 * Falsifiers: a live holder (even one that is stopped and slow to answer) is
 * never unlinked; a proven-dead holder (ECONNREFUSED) is reclaimed; a timeout
 * or EPERM is "undecided", never "dead"; close() never unlinks a successor's
 * socket; the socket directory must be private (0700). POSIX-only: unix
 * sockets, modes and SIGSTOP (Windows uses the helper-created named pipe,
 * P8-D78).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, linkSync, mkdirSync, readdirSync } from 'node:fs';
import * as net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LifecycleRefusal } from '../src/kernel/lifecycle/refusal.js';
import { listenSocket, probeSocketHolder } from '../src/kernel/socket/server.js';
import { tempHome } from './daemon-helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function home(): string {
  const t = tempHome('so-');
  cleanups.push(t.cleanup);
  mkdirSync(t.home, { recursive: true, mode: 0o700 });
  return t.home;
}

function rawListen(p: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    // a holder probe connects and destroys at once: on Linux the reply write then resets (ECONNRESET), which is no test failure
    const s = net.createServer((c) => {
      c.on('error', () => undefined);
      c.end('raw\n');
    });
    s.once('error', reject);
    s.listen(p, () => resolve(s));
  });
}

function reaches(p: string): Promise<string> {
  return new Promise((resolve) => {
    const c = net.createConnection(p);
    let buf = '';
    c.on('data', (d) => (buf += d.toString()));
    c.on('end', () => resolve(buf.trim()));
    c.on('error', (e: NodeJS.ErrnoException) => resolve(`error:${e.code}`));
    setTimeout(() => (c.destroy(), resolve(buf.trim() || 'connected')), 500);
  });
}

const noop = (): Record<string, never> => ({});

describe('socket ownership (never "can\'t tell" ⇒ "dead")', () => {
  it('a proven-dead holder (ECONNREFUSED) is reclaimed; the private bind name does not linger', async () => {
    const h = home();
    const sock = path.join(h, 'g.sock');
    const tmp = path.join(h, 't.sock');
    const dead = await rawListen(tmp);
    linkSync(tmp, sock); // a second name for the socket…
    await new Promise<void>((r) => dead.close(() => r())); // …left behind when its holder closes: stale, refuses connect
    expect(existsSync(sock)).toBe(true);
    expect(await probeSocketHolder(sock)).toEqual({ holder: 'dead' });
    const srv = await listenSocket({ socketPath: sock, handle: noop });
    cleanups.push(() => srv.close());
    expect(await reaches(sock)).not.toMatch(/^error:/);
    expect(readdirSync(h).filter((n) => n.startsWith('.s'))).toEqual([]);
  });

  it('a live holder is never unlinked: refused endpoint-busy{holder:alive}, its socket still answers', async () => {
    const h = home();
    const sock = path.join(h, 'g.sock');
    const live = await rawListen(sock);
    cleanups.push(() => new Promise<void>((r) => live.close(() => r())));
    const err = await listenSocket({ socketPath: sock, handle: noop }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LifecycleRefusal);
    expect((err as LifecycleRefusal).reason).toBe('endpoint-busy');
    expect((err as LifecycleRefusal).detail.holder).toBe('alive');
    expect(await reaches(sock)).toBe('raw');
    expect(readdirSync(h).filter((n) => n.startsWith('.s'))).toEqual([]);
  });

  it('a live holder that is slow to answer (SIGSTOPped) is not unlinked', async () => {
    const h = home();
    const sock = path.join(h, 'g.sock');
    const holder: ChildProcess = spawn(process.execPath, ['-e', `require('node:net').createServer(()=>{}).listen(${JSON.stringify(sock)},()=>process.stdout.write('up\\n'))`], { stdio: ['ignore', 'pipe', 'ignore'] });
    cleanups.push(() => {
      holder.kill('SIGCONT');
      holder.kill('SIGKILL');
    });
    await new Promise<void>((r) => holder.stdout!.once('data', () => r()));
    holder.kill('SIGSTOP');
    const err = await listenSocket({ socketPath: sock, handle: noop, holderProbeMs: 300 }).catch((e: unknown) => e);
    expect((err as LifecycleRefusal).reason).toBe('endpoint-busy');
    expect(['alive', 'undecided']).toContain((err as LifecycleRefusal).detail.holder);
    expect(existsSync(sock)).toBe(true);
  }, 15_000);

  it('a timeout, EPERM or any other connect error is undecided — never dead', async () => {
    const h = home();
    const sock = path.join(h, 'x.sock');
    const silent = (): net.Socket => new net.Socket(); // never connects, never errors
    expect(await probeSocketHolder(sock, 50, silent)).toEqual({ holder: 'undecided', why: 'timeout' });
    for (const code of ['EPERM', 'EACCES', 'EAGAIN']) {
      const failing = (): net.Socket => {
        const s = new net.Socket();
        setImmediate(() => s.emit('error', Object.assign(new Error(code), { code })));
        return s;
      };
      expect(await probeSocketHolder(sock, 1_000, failing)).toEqual({ holder: 'undecided', why: code });
    }
    expect(await probeSocketHolder(sock)).toEqual({ holder: 'gone' }); // nothing there
  });

  it("close() never unlinks a successor's socket (Node's server.close unlinks only the private bind name)", async () => {
    const h = home();
    const sock = path.join(h, 'g.sock');
    const a = await listenSocket({ socketPath: sock, handle: noop });
    // a successor takes the public name while A is still closing down
    const { unlinkSync } = await import('node:fs');
    unlinkSync(sock);
    const b = await rawListen(sock);
    cleanups.push(() => new Promise<void>((r) => b.close(() => r())));
    await a.close();
    expect(existsSync(sock)).toBe(true);
    expect(await reaches(sock)).toBe('raw');
  });

  it('a clean close removes its own socket', async () => {
    const h = home();
    const sock = path.join(h, 'g.sock');
    const a = await listenSocket({ socketPath: sock, handle: noop });
    await a.close();
    expect(existsSync(sock)).toBe(false);
  });

  it('close unlinks before server.close: the dev+ino compare runs while our listener still pins the inode (swapping the two reopens inode reuse)', async () => {
    const h = home();
    const sock = path.join(h, 'g.sock');
    const steps: string[] = [];
    const a = await listenSocket({ socketPath: sock, handle: noop, traceClose: (s) => steps.push(s) });
    await a.close();
    expect(steps).toEqual(['unlink-public', 'server-close']);
  });

  it('refuses a socket directory that is not 0700 (no bind-then-chmod window)', async () => {
    const h = home();
    const open = path.join(h, 'open');
    mkdirSync(open, { mode: 0o755 });
    chmodSync(open, 0o755);
    const err = await listenSocket({ socketPath: path.join(open, 'g.sock'), handle: noop }).catch((e: unknown) => e);
    expect((err as LifecycleRefusal).reason).toBe('endpoint-acl');
    expect(existsSync(path.join(open, 'g.sock'))).toBe(false);
  });
});
