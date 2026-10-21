/**
 * #session-runner: a session's USER/LOGNAME/SHELL/TMPDIR come from the OS, never from the daemon's env
 * (spec §3.3 "Environment"). Regression: the clean re-exec (upgrade successor, --detach) keeps no USER, and
 * Claude Code finds its keychain credentials by $USER, so every session was refused not_subscription_auth.
 * Pure functions with injected deps: runs on every platform (the win32 case is a dep, not the host).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSessionEnv, ENV_ALLOWLIST, IDENTITY_KEYS, resolveSessionIdentity, validTempDir, WINDOWS_EXTRA } from '../src/kernel/runner/env.js';

/** capabilities, not platforms: POSIX uid + mode bits; darwin's per-user temp dir via getconf */
const POSIX = typeof process.getuid === 'function';
const DARWIN_TMP = ((): boolean => {
  try {
    return execFileSync('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], { env: {}, stdio: ['ignore', 'pipe', 'ignore'] }).length > 1;
  } catch {
    return false;
  }
})();
const base = { hsid: 'hsid:v1:x', sock: '/s.sock', sessionKeyPath: '/k' };
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const uid = (): number | undefined => process.getuid?.();
const ownedDir = (mode = 0o700): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-idt-'));
  dirs.push(d);
  fs.chmodSync(d, mode);
  return d;
};

describe('buildSessionEnv: identity names come only from the OS identity', () => {
  it('a daemon env with no USER/LOGNAME/SHELL/TMPDIR still gives the session all four', () => {
    const { env } = buildSessionEnv({ ...base, from: { HOME: '/h', PATH: '/usr/bin:/bin' }, identity: { user: 'alice', shell: '/bin/zsh', tmpdir: '/var/folders/x/T/' } });
    expect(env).toMatchObject({ USER: 'alice', LOGNAME: 'alice', SHELL: '/bin/zsh', TMPDIR: '/var/folders/x/T/' });
  });
  it('a WRONG inherited USER/LOGNAME/SHELL/TMPDIR is overridden', () => {
    const { env } = buildSessionEnv({ ...base, from: { HOME: '/h', USER: 'nobody', LOGNAME: 'mallory', SHELL: '/tmp/evil', TMPDIR: '/tmp/elsewhere' }, identity: { user: 'alice', shell: '/bin/zsh', tmpdir: '/var/folders/x/T/' } });
    expect(env).toMatchObject({ USER: 'alice', LOGNAME: 'alice', SHELL: '/bin/zsh', TMPDIR: '/var/folders/x/T/' });
  });
  it('a name the OS could not give is ABSENT, never back-filled from the daemon env', () => {
    const { env, envKeys } = buildSessionEnv({ ...base, from: { HOME: '/h', USER: 'nobody', LOGNAME: 'nobody', SHELL: '/bin/sh', TMPDIR: '/tmp/x' }, identity: {} });
    for (const k of IDENTITY_KEYS) expect(env[k], k).toBeUndefined();
    expect(envKeys).toEqual(['GNOMON_HSID', 'GNOMON_SESSION_KEY', 'GNOMON_SOCK', 'HOME']);
  });
  it('identity null (win32) keeps the allowlist as it was; USERNAME/USERPROFILE stay WINDOWS_EXTRA data', () => {
    const { env } = buildSessionEnv({ ...base, from: { USERPROFILE: 'C:\\Users\\a', USER: 'a' }, identity: null });
    expect(env).toMatchObject({ USERPROFILE: 'C:\\Users\\a', USER: 'a' });
  });
  it('envKeys are names only: no identity value appears in them', () => {
    const { envKeys } = buildSessionEnv({ ...base, from: { HOME: '/h', USER: 'gnomon-wrong-user-probe' }, identity: { user: 'alice', shell: '/bin/zsh', tmpdir: '/var/folders/x/T/' } });
    expect(envKeys).toEqual(['GNOMON_HSID', 'GNOMON_SESSION_KEY', 'GNOMON_SOCK', 'HOME', 'LOGNAME', 'SHELL', 'TMPDIR', 'USER']);
    expect(envKeys.every((k) => [...ENV_ALLOWLIST, ...WINDOWS_EXTRA].includes(k) || k.startsWith('GNOMON_'))).toBe(true);
    expect(JSON.stringify(envKeys)).not.toMatch(/alice|zsh|folders|gnomon-wrong-user-probe/);
  });
});

describe('resolveSessionIdentity: the OS sources', () => {
  const info = () => ({ username: 'alice', shell: '/bin/zsh' });
  it('win32 ⇒ null (Windows identity is USERNAME/USERPROFILE, already allowlisted)', () => {
    expect(resolveSessionIdentity({ platform: 'win32', userInfo: () => { throw new Error('must not be read'); } })).toBeNull();
  });
  it('linux: user + shell from userInfo, no TMPDIR source', () => {
    expect(resolveSessionIdentity({ platform: 'linux', userInfo: info, darwinUserTempDir: () => { throw new Error('must not run'); } })).toEqual({ user: 'alice', shell: '/bin/zsh' });
  });
  it('a relative or empty shell, or an unsafe username, is omitted; a userInfo throw omits both', () => {
    expect(resolveSessionIdentity({ platform: 'linux', userInfo: () => ({ username: 'a\nb', shell: 'zsh' }) })).toEqual({});
    expect(resolveSessionIdentity({ platform: 'linux', userInfo: () => ({ username: 'alice', shell: null }) })).toEqual({ user: 'alice' });
    expect(resolveSessionIdentity({ platform: 'linux', userInfo: () => { throw new Error('no passwd entry'); } })).toEqual({});
  });
  it('darwin: TMPDIR is the getconf dir when valid, omitted when getconf fails', () => {
    expect(resolveSessionIdentity({ platform: 'darwin', userInfo: info, darwinUserTempDir: () => { throw new Error('no getconf'); } })).toEqual({ user: 'alice', shell: '/bin/zsh' });
  });
  it.runIf(POSIX)('darwin: an owned 0700 dir is accepted verbatim (trailing newline from getconf stripped)', () => {
    const d = ownedDir();
    const id = resolveSessionIdentity({ platform: 'darwin', userInfo: info, darwinUserTempDir: () => `${d}/\n`, uid });
    expect(id?.tmpdir).toBe(`${d}/`);
    expect(fs.realpathSync.native(id!.tmpdir!)).toBe(fs.realpathSync.native(d));
  });
});

describe('validTempDir: absolute, a directory, owned by the uid, not group/world-writable', () => {
  it('relative, missing, a file, or an unknown uid ⇒ undefined', () => {
    expect(validTempDir('rel/T/', 501)).toBeUndefined();
    expect(validTempDir(path.join(os.tmpdir(), 'gnomon-idt-missing-x', 'T'), uid())).toBeUndefined();
    expect(validTempDir('/', undefined)).toBeUndefined();
  });
  it.runIf(POSIX)('another uid, or a group/world-writable mode ⇒ undefined (POSIX modes)', () => {
    const d = ownedDir();
    expect(validTempDir(d, uid())).toBe(d);
    expect(validTempDir(d, (uid() ?? 0) + 1)).toBeUndefined();
    const ww = ownedDir(0o777);
    expect(validTempDir(ww, uid())).toBeUndefined();
    const f = path.join(d, 'file');
    fs.writeFileSync(f, '');
    expect(validTempDir(f, uid())).toBeUndefined();
  });
  it.runIf(DARWIN_TMP)('the real darwin resolution matches getconf DARWIN_USER_TEMP_DIR and needs no env', () => {
    const id = resolveSessionIdentity();
    expect(id?.user).toBe(os.userInfo().username);
    expect(id?.tmpdir).toBeDefined();
    expect(path.isAbsolute(id!.tmpdir!)).toBe(true);
    expect(fs.statSync(fs.realpathSync.native(id!.tmpdir!)).uid).toBe(uid());
  });
});
