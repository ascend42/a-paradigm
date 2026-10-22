// @gnomon-platform: win32
/**
 * The Windows platform helper against the real OS (W2/W3, docs/plans/gnomon-windows.md; spec §16):
 *   G-WIN-01  the kernel pipe: owner-only DACL from the helper's read-back before anything is served; nothing that
 *             connected under the default DACL is served; a pipe without securePipe refuses; a squatted name fails
 *             the listen closed (endpoint-busy)
 *   G-WIN-02  the home: protected owner-only DACL, read back; files below inherit it
 *   G-RUN-03  the job-object launcher kills the whole tree when it dies
 *   G-LOG-06  the write-through rename; the boot id
 * Needs the built helper (node packages/gnomon-helper/scripts/build-win32.mjs); with CI=true a missing helper fails.
 */
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureGnomonHome } from '../src/kernel/lifecycle/home.js';
import { windowsPipePath } from '../src/kernel/lifecycle/endpoint.js';
import { listenSocket } from '../src/kernel/socket/server.js';
import { LifecycleRefusal } from '../src/kernel/lifecycle/refusal.js';
import { clearVerifiedRootsForTests, isOwnerOnly } from '../src/platform/owner-only.js';
import { defaultWin32HelperPath, helperOpSync, jobLaunch, pinWin32Helper, Win32HelperError } from '../src/platform/win32/helper-client.js';
import { secureKernelPipe } from '../src/platform/win32/pipe.js';
import { PKG_ROOT } from './helpers.js';

const exe = path.resolve(PKG_ROOT, '..', 'gnomon-helper', 'bin', 'win32', 'gnomon-helper.exe');
const built = fs.existsSync(exe);
if (!built && process.env.CI) throw new Error(`the win32 helper is not built at ${exe} (CI must build it first)`);
const describeHelper = built ? describe : describe.skip;

const dirs: string[] = [];
afterEach(() => {
  clearVerifiedRootsForTests();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-w32-')));
  dirs.push(d);
  return d;
};
const handle = async (): Promise<never> => {
  throw new Error('no rpc in this test');
};

describeHelper('win32 helper (W2/W3)', () => {
  const pin = () => pinWin32Helper(exe);

  it('the default path finds the repo-built helper; a dev kernel pins it unsigned by sha256 and re-checks it', () => {
    expect(fs.realpathSync.native(defaultWin32HelperPath())).toBe(fs.realpathSync.native(exe));
    const p = pin();
    expect(p.signed).toBe(false);
    expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => p.recheck()).not.toThrow();
    // a swapped binary is refused before any spawn
    const copy = path.join(tmp(), 'gnomon-helper.exe');
    fs.copyFileSync(exe, copy);
    const cp = pinWin32Helper(copy);
    fs.appendFileSync(copy, Buffer.from([0]));
    expect(() => cp.recheck()).toThrow(Win32HelperError);
    expect(() => helperOpSync(cp, 'info')).toThrow(/changed/);
    expect(() => pinWin32Helper(path.join(tmp(), 'nope.exe'))).toThrow(/no helper/);
  });

  it('info names the protocol and the user SID; only the approvals key lives here (W4 phase A); no voice arms', () => {
    const r = helperOpSync(pin(), 'info');
    expect(r).toMatchObject({ protocol: 'gnomon-helper:v2', platform: 'win32' });
    expect(String(r.userSid)).toMatch(/^S-1-5-/);
    expect(() => helperOpSync(pin(), 'key.create', { key: 'root', gen: 'g1' })).toThrow(/unsupported-op/);
    expect(() => helperOpSync(pin(), 'key.public', { key: 'approvals', gen: 'Bad Gen' })).toThrow(/bad-request/);
    expect(() => helperOpSync(pin(), 'arm.open')).toThrow(/unsupported-op/);
  });

  it('G-WIN-02: the home gets a protected owner-only DACL, read back; files below inherit it', () => {
    const home = path.join(tmp(), 'home');
    ensureGnomonHome(home);
    const r = helperOpSync(pin(), 'acl.read', { path: home });
    expect(r.ownerOnlyProtected).toBe(true);
    // read-back SDDL spells the user as the OS does (an alias such as LA for the built-in Administrator on CI)
    const me = String(helperOpSync(pin(), 'info').userSddlSid);
    expect(String(r.sddl)).toBe(`O:${me}D:PAI(A;OICI;FA;;;${me})`);
    fs.mkdirSync(path.join(home, 'keys'));
    fs.writeFileSync(path.join(home, 'keys', 'k'), 'x');
    expect(helperOpSync(pin(), 'acl.read', { path: path.join(home, 'keys', 'k') }).ownerOnly).toBe(true);
    expect(isOwnerOnly(path.join(home, 'keys', 'k'))).toBe(true);
    // ensureGnomonHome set this process's default owner to the user (an elevated admin's would be BA): what it
    // creates below the home passes the STRICT check, which reads the owner back per file
    expect(String(helperOpSync(pin(), 'acl.read', { path: path.join(home, 'keys') }).sddl)).toMatch(new RegExp(`^O:${me}D:`));
    expect(isOwnerOnly(path.join(home, 'keys'), undefined, { strict: true })).toBe(true);
    expect(isOwnerOnly(path.join(home, 'keys', 'k'), undefined, { strict: true })).toBe(true);
    expect(helperOpSync(pin(), 'process.owner-default', { pid: process.pid }).ownerDefault).toBe('user');
    // a temp dir outside every verified root inherits the profile's DACL: not owner-only
    clearVerifiedRootsForTests();
    expect(isOwnerOnly(tmp())).toBe(false);
  });

  it('G-WIN-01: the pipe is owner-only before anything is served, and served by this process', async () => {
    const sock = windowsPipePath(path.join(tmp(), 'home'));
    let secured = false;
    const early: net.Socket[] = [];
    const server = await listenSocket({
      socketPath: sock,
      handle,
      securePipe: async (p) => {
        // a client that connects under the default DACL is dropped unserved
        early.push(net.connect(p));
        await new Promise((r) => setTimeout(r, 100));
        await secureKernelPipe(p, pin());
        secured = true;
      },
    });
    try {
      expect(secured).toBe(true);
      await new Promise((r) => setTimeout(r, 100));
      expect(early[0]!.destroyed || early[0]!.readableEnded).toBe(true);
      const name = sock.slice('\\\\.\\pipe\\'.length);
      const r = helperOpSync(pin(), 'pipe.read', { name });
      expect(r.ownerOnly).toBe(true);
      expect(r.sessionDenied).toBe(true);
      expect(String(r.sddl)).not.toMatch(/;;;(WD|AN|BA|SY)\)/);
      // a connection after the read-back is served
      const c = net.connect(sock);
      await new Promise<void>((res, rej) => {
        c.once('connect', () => res());
        c.once('error', rej);
      });
      c.destroy();
      // a session (a restricted token carrying GNOMON_SESSION_SID) cannot connect, though it carries the user SID
      const probe = `require('net').connect(${JSON.stringify(sock)}).on('connect',()=>{console.log('CONNECTED');process.exit(0)}).on('error',(e)=>{console.log(e.code);process.exit(0)})`;
      const out = spawnSync(pin().exe, ['sandbox', '--', process.execPath, '-e', probe], { encoding: 'utf8', input: '', windowsHide: true, timeout: 30_000 });
      expect(out.stdout.trim()).toMatch(/^(EACCES|EPERM)$/);
    } finally {
      for (const s of early) s.destroy();
      await server.close();
    }
  });

  it('G-WIN-01: a pipe without securePipe refuses; a failed read-back refuses; a squatted name fails closed', async () => {
    const sock = windowsPipePath(path.join(tmp(), 'home'));
    await expect(listenSocket({ socketPath: sock, handle })).rejects.toMatchObject({ reason: 'endpoint-acl' });
    await expect(listenSocket({ socketPath: sock, handle, securePipe: async () => { throw new Error('read-back not owner-only'); } })).rejects.toBeInstanceOf(LifecycleRefusal);
    // someone else holds the name first: the kernel's listen fails, it never shares the pipe
    const squat = net.createServer().listen(sock);
    await new Promise((r) => squat.once('listening', r));
    try {
      await expect(listenSocket({ socketPath: sock, handle, securePipe: async (p) => secureKernelPipe(p, pin()) })).rejects.toMatchObject({ reason: 'endpoint-busy' });
    } finally {
      squat.close();
    }
  });

  it('G-RUN-03: killing the job launcher kills the grandchildren', async () => {
    const d = tmp();
    const marker = path.join(d, 'gc.pid');
    const script = `const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(marker)},String(c.pid));setInterval(()=>{},1000);`;
    const l = jobLaunch(pin(), process.execPath, ['-e', script]);
    const launcher = spawn(l.command, l.args, { stdio: 'ignore', windowsHide: true });
    for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await new Promise((r) => setTimeout(r, 100));
    const gc = Number(fs.readFileSync(marker, 'utf8'));
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(alive(gc)).toBe(true);
    launcher.kill();
    for (let i = 0; i < 50 && alive(gc); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive(gc)).toBe(false);
    // only an absolute .exe runs under the launcher
    const bat = spawnSync(exe, ['exec', '--', 'C:\\Windows\\System32\\x.bat'], { encoding: 'utf8' });
    expect(bat.status).toBe(70);
    expect(bat.stderr).toMatch(/absolute path to an \.exe/);
  });

  it('G-LOG-06: the write-through rename replaces atomically; the boot id is stable win:<n>', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'a'), 'new');
    fs.writeFileSync(path.join(d, 'b'), 'old');
    helperOpSync(pin(), 'fs.rename-durable', { from: path.join(d, 'a'), to: path.join(d, 'b') });
    expect(fs.readFileSync(path.join(d, 'b'), 'utf8')).toBe('new');
    expect(fs.existsSync(path.join(d, 'a'))).toBe(false);
    const a = helperOpSync(pin(), 'boot.id').bootId;
    expect(a).toMatch(/^win:\d+$/);
    expect(helperOpSync(pin(), 'boot.id').bootId).toBe(a);
  });

  it('inputs are bounded: UNC, device and .. paths, foreign pipe names and token URLs are refused', () => {
    for (const p of ['\\\\server\\share\\x', '\\\\.\\pipe\\x', 'C:\\a\\..\\b', 'relative']) expect(() => helperOpSync(pin(), 'acl.read', { path: p })).toThrow(/bad-request/);
    expect(() => helperOpSync(pin(), 'pipe.read', { name: 'other-pipe' })).toThrow(/bad-request/);
    expect(() => helperOpSync(pin(), 'shell.open', { url: 'http://127.0.0.1:1/#launch=abc' })).toThrow(/bad-request/);
    expect(() => helperOpSync(pin(), 'shell.open', { url: 'https://example.com/' })).toThrow(/bad-request/);
  });
});
