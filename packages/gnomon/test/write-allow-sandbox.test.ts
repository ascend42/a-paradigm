// @gnomon-platform: darwin
/**
 * T-2026-10-23-004 (Aegis): session file writes are DENY BY DEFAULT under the generated profile. Outside the
 * allowlist (roots, session temp, measured caches, carve-backs) nothing is writable — another repo's hooks, gh's
 * sign-in, a dotfile — while the roots, temp and an `npm install` in a root still work, and every deny inside the
 * allowlist (git config/hooks/info, steering) still wins. Real Claude Code under this profile: probe p10m-write-allow.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { darwinFloor, sessionLaunchPlan } from '../src/kernel/sandbox/session.js';
import { buildSessionPolicy, SESSION_CACHE_ENV, userTempRoot, WRITE_CACHE_PATHS } from '../src/kernel/manifest/policy.js';
import { scratchOwnershipFile, sessionScratchDirs } from '../src/kernel/supervisor/supervisor.js';
import { sessionWorld, type SessionWorld } from './session-helpers.js';

let w: SessionWorld | null = null;
afterEach(() => {
  w?.cleanup();
  w = null;
});
const NPM = [path.join(path.dirname(process.execPath), 'npm'), '/opt/homebrew/bin/npm', '/usr/local/bin/npm'].find((p) => fs.existsSync(p));

describe.runIf(darwinFloor().ok)('deny-by-default session writes', () => {
  it('outside the allowlist nothing is writable; roots, temp and npm install in a root work; denies inside still win', () => {
    w = sessionWorld();
    const x = w;
    const other = path.join(x.userHome, 'Documents', 'other-repo', '.git', 'hooks');
    fs.mkdirSync(other, { recursive: true });
    fs.mkdirSync(path.join(x.userHome, '.config', 'gh'), { recursive: true });
    const dep = path.join(x.cwd, 'dep');
    fs.mkdirSync(dep);
    fs.writeFileSync(path.join(dep, 'package.json'), JSON.stringify({ name: 'dep', version: '1.0.0' }));
    fs.writeFileSync(path.join(x.cwd, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true }));
    // the world itself lives under the OS temp dir, so the session's TMPDIR here is a separate dir beside the repo
    const tmpdir = path.join(x.root, 'session-tmp');
    fs.mkdirSync(tmpdir);
    const cache = path.join(x.root, 'session-cache');
    fs.mkdirSync(cache);
    fs.mkdirSync(path.join(x.userHome, '.ssh'), { recursive: true });
    fs.writeFileSync(path.join(x.userHome, '.ssh', 'id_ed25519'), 'PRIVATE\n');
    fs.mkdirSync(path.join(x.userHome, '.aws'), { recursive: true });
    fs.writeFileSync(path.join(x.userHome, '.aws', 'credentials'), 'SECRET\n');
    const policy = buildSessionPolicy({ home: x.home, cwd: x.cwd, userClaudeDir: path.join(x.userHome, '.claude'), userHome: x.userHome, managedSettingsPaths: [], linkedFolders: [x.linked], endpointPort: null, tmpdir, sessionCache: cache, memorySubtree: x.cwd });
    const t = (n: string, cmd: string): string => `(${cmd}) >/dev/null 2>&1 && echo "${n}=allowed" || echo "${n}=blocked"`;
    const script = path.join(x.cwd, 'check.sh');
    fs.writeFileSync(script, `#!/bin/bash\ncd "${x.cwd}"\n${[
      t('other_repo_hook', `echo x > "${other}/pre-commit"`),
      t('gh_hosts', `echo x > "${x.userHome}/.config/gh/hosts.yml"`),
      t('home_file', `echo x > "${x.userHome}/planted.txt"`),
      t('home_dir', `mkdir "${x.userHome}/newdir"`),
      t('users_shared', 'echo x > /Users/Shared/gnomon-probe-x'),
      t('root_write', 'echo x > ./a.txt && mkdir -p sub/deep && echo y > sub/deep/b.txt'),
      t('git_config', 'echo x >> .git/config'),
      t('git_hook', 'echo x > .git/hooks/pre-commit'),
      t('claude_md', 'echo x > CLAUDE.md'),
      t('tmp', 'echo x > /tmp/gnomon-wa-$$ && rm /tmp/gnomon-wa-$$'),
      t('tmpdir', `echo x > "${tmpdir}/gnomon-wa-$$" && rm "${tmpdir}/gnomon-wa-$$"`),
      t('dev_null', 'echo x > /dev/null'),
      t('dev_urandom', 'exec 3>/dev/urandom'), // opening for write (libraries open it O_RDWR); macOS refuses the write itself everywhere
      t('home_npm', `mkdir -p "${x.userHome}/.npm/_npx"`),
      t('read_ssh_key', `cat "${x.userHome}/.ssh/id_ed25519"`),
      t('read_aws', `cat "${x.userHome}/.aws/credentials"`),
      t('tmux_dir', `mkdir -p /private/tmp/tmux-${process.getuid!()}/planted`),
      t('bind_shared_tmp', `"${process.execPath}" -e "const s=require('net').createServer();s.on('error',()=>process.exit(1));s.listen('/private/tmp/gnomon-wa-'+process.pid+'.sock',()=>{s.close();process.exit(0)})"`),
      t('bind_session_tmp', `"${process.execPath}" -e "const s=require('net').createServer();s.on('error',()=>process.exit(1));s.listen('${tmpdir}/s.sock',()=>{s.close();process.exit(0)})"`),
      ...(NPM ? [t('npm_install', `HOME="${x.userHome}" npm_config_cache="${cache}/npm" "${NPM}" install --no-audit --no-fund --offline ./dep && test -e node_modules/dep/package.json`)] : []),
    ].join('\n')}\n`, { mode: 0o755 });
    const plan = sessionLaunchPlan({ policy, binaryReal: '/bin/bash', argv: [script], extras: { uid: process.getuid!(), tmpdir, home: x.userHome, roots: [x.cwd] } }, 'darwin');
    const r = spawnSync(plan.command, plan.args, { encoding: 'utf8', env: { HOME: x.userHome, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: tmpdir }, timeout: 120_000 });
    const out = Object.fromEntries(r.stdout.split('\n').filter((l) => /^[a-z_]+=/.test(l)).map((l) => l.split('=') as [string, string]));
    expect(out).toMatchObject({ other_repo_hook: 'blocked', gh_hosts: 'blocked', home_file: 'blocked', home_dir: 'blocked', users_shared: 'blocked', root_write: 'allowed', git_config: 'blocked', git_hook: 'blocked', claude_md: 'blocked', tmp: 'allowed', tmpdir: 'allowed', dev_null: 'allowed', dev_urandom: 'allowed', home_npm: 'blocked', read_ssh_key: 'blocked', read_aws: 'blocked', tmux_dir: 'blocked', bind_shared_tmp: 'blocked', bind_session_tmp: 'allowed' });
    if (NPM) expect(out.npm_install, r.stderr).toBe('allowed');
    expect(fs.existsSync(path.join(other, 'pre-commit'))).toBe(false);
  }, 120_000);

  it('policy data: the allowlist is exactly the roots, the temp dirs and the measured caches', () => {
    w = sessionWorld();
    const p = buildSessionPolicy({ home: w.home, cwd: w.cwd, userClaudeDir: path.join(w.userHome, '.claude'), userHome: w.userHome, managedSettingsPaths: [], linkedFolders: [], endpointPort: null, tmpdir: os.tmpdir() });
    // Aegis round 2: no shared home cache (WRITE_CACHE_PATHS is empty), the TMPDIR's own realpath only (never its parent)
    expect(WRITE_CACHE_PATHS).toEqual([]);
    expect((p.writeAllow ?? []).map((a) => `${a.class}:${a.path}`).sort()).toEqual([`root:${w.cwd}`, 'temp:/private/tmp', 'temp:/private/var/tmp', `temp:${userTempRoot(os.tmpdir())}`].sort());
    expect(userTempRoot(os.tmpdir())).toBe(fs.realpathSync(os.tmpdir()).replace(/\/+$/, ''));
    const sc = buildSessionPolicy({ home: w.home, cwd: w.cwd, userClaudeDir: path.join(w.userHome, '.claude'), userHome: w.userHome, managedSettingsPaths: [], linkedFolders: [], endpointPort: null, sessionCache: path.join(w.root, 'cache') });
    expect((sc.writeAllow ?? []).some((a) => a.class === 'cache' && a.path === path.join(w!.root, 'cache'))).toBe(true);
    // M6: the credential stores are read-denied
    for (const rel of ['.ssh', '.aws', '.config/gh', '.netrc', '.git-credentials', '.docker/config.json', '.kube', '.gnupg', '.config/gcloud', '.azure', '.pypirc', '.cargo/credentials']) expect(p.denyRead.some((d) => d.path === path.join(w!.userHome, rel)), rel).toBe(true);
  });

  it('Aegis round 2: the session gets a private TMPDIR and a per-repo cache (0700, this uid); the env points the tools there', () => {
    w = sessionWorld();
    const d = sessionScratchDirs('hsid:v1:01JAAAAAAAAAAAAAAAAAAAAAAA', 'sha256:' + 'ab'.repeat(32), w.root);
    expect(d.tmp).toBe(path.join(w.root, 'gnomon-tmp', 's-01JAAAAA'.slice(2) === '01JAAAAA' ? fs.readdirSync(path.join(w.root, 'gnomon-tmp'))[0]! : ''));
    expect(d.cache).toBe(path.join(w.root, 'gnomon-cache', 'ab'.repeat(8)));
    for (const x of [d.tmp, d.cache]) expect(fs.statSync(x).mode & 0o077).toBe(0);
    // Aegis round 3 M: a pre-existing TMPDIR or cache is refused unless the kernel's own record made it (same inode)
    expect(() => sessionScratchDirs('hsid:v1:01JAAAAAAAAAAAAAAAAAAAAAAA', 'sha256:' + 'ab'.repeat(32), w!.root)).toThrow(/already exists and was not made by this kernel/);
    const owned = scratchOwnershipFile(path.join(w.root, 'owned.json'));
    const d2 = sessionScratchDirs('hsid:v1:01JBBBBBBBBBBBBBBBBBBBBBBB', 'sha256:' + 'cd'.repeat(32), w.root, owned);
    expect(sessionScratchDirs('hsid:v1:01JBBBBBBBBBBBBBBBBBBBBBBB', 'sha256:' + 'cd'.repeat(32), w.root, owned)).toEqual(d2); // a resume: recorded
    fs.rmSync(d2.cache, { recursive: true });
    fs.mkdirSync(d2.cache, { mode: 0o700 }); // planted: a new inode the record does not hold
    expect(() => sessionScratchDirs('hsid:v1:01JBBBBBBBBBBBBBBBBBBBBBBB', 'sha256:' + 'cd'.repeat(32), w!.root, owned)).toThrow(/not made by this kernel/);
    fs.chmodSync(d.cache, 0o755);
    expect(() => sessionScratchDirs('hsid:v1:01JCCCCCCCCCCCCCCCCCCCCCCC', 'sha256:' + 'ab'.repeat(32), w!.root, owned)).toThrow(/not a private directory/);
    // the base is never a shared temp dir
    expect(() => sessionScratchDirs('hsid:v1:01JDDDDDDDDDDDDDDDDDDDDDDD', 'sha256:' + 'ef'.repeat(32), '/private/tmp')).toThrow(/shared temp dir/);
    expect(() => sessionScratchDirs('hsid:v1:01JDDDDDDDDDDDDDDDDDDDDDDD', 'sha256:' + 'ef'.repeat(32), '/tmp')).toThrow(/shared temp dir/);
    expect(Object.keys(SESSION_CACHE_ENV).sort()).toEqual(['BUN_INSTALL_CACHE_DIR', 'GOCACHE', 'GOMODCACHE', 'NPM_CONFIG_CACHE', 'PIP_CACHE_DIR', 'XDG_CACHE_HOME', 'npm_config_cache']);
  });
});
