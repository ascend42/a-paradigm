/**
 * @symbol #git-verbs
 *
 * #git-verbs, the effect half: how the kernel runs git and gh for a verb, OUTSIDE the session sandbox.
 *
 *   execTool        an async spawn (never a shell, argv only, never blocks the daemon), stdout and stderr capped at
 *                   EXEC_OUTPUT_CAP, SIGKILL at the timeout.
 *   localGitEnv     git.init's env: hardenedGitEnv (no global or system config, no template dir, no prompt, no
 *                   protocol), so the human's own init.templateDir / core.hooksPath never reach the new repo.
 *   networkEnv      push and create: a SCRUBBED allowlist — PATH, HOME (the user's: their git credential helper and
 *                   gh sign-in live there), USER, LOGNAME, TMPDIR, SSH_AUTH_SOCK when the daemon has one, LC_ALL=C —
 *                   plus GIT_TERMINAL_PROMPT=0, GIT_ALLOW_PROTOCOL=https:ssh, GCM_INTERACTIVE=never,
 *                   GH_PROMPT_DISABLED=1. Never GIT_DIR, GIT_*_PATH, GH_TOKEN/GITHUB_TOKEN, proxies or askpass from
 *                   the daemon's env.
 *   PUSH_GIT_FLAGS  every network git call: no hooks, no fsmonitor, only the https and ssh protocols, no
 *                   redirects (http.followRedirects=false), no submodule recursion, no follow-tags.
 *   gitPath / ghPath  git from the kernel's own resolution (#loop-git gitBinary); gh from the kernel PATH and the
 *                   known install folders, realpath'd.
 *   redactOutput    what reaches the agent or the card of a command's output: secret-shaped spans and URL userinfo
 *                   redacted, capped. Output never reaches a log row.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EMPTY_HOOKS_PATH, gitBinary, hardenedGitEnv } from './scratch.js';
import { redactText } from '../trace/capture.js';

export const EXEC_OUTPUT_CAP = 256 * 1024;
export const VERB_TIMEOUTS = Object.freeze({ init: 20_000, read: 20_000, push: 180_000, create: 60_000 });

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type Exec = (bin: string, args: readonly string[], o: { cwd: string; env: Record<string, string>; timeoutMs: number }) => Promise<ExecResult>;

/** The real runner: spawn with an argv (no shell), capped output, SIGKILL at the timeout. */
export const execTool: Exec = (bin, args, o) =>
  new Promise((resolve) => {
    let out = '';
    let err = '';
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, [...args], { cwd: o.cwd, env: o.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String((e as Error).message ?? e), timedOut: false });
      return;
    }
    const t = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, o.timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      if (out.length < EXEC_OUTPUT_CAP) out += d.slice(0, EXEC_OUTPUT_CAP - out.length);
    });
    child.stderr?.on('data', (d: string) => {
      if (err.length < EXEC_OUTPUT_CAP) err += d.slice(0, EXEC_OUTPUT_CAP - err.length);
    });
    child.on('error', (e) => {
      clearTimeout(t);
      resolve({ code: -1, stdout: out, stderr: `${err}${String(e.message ?? e)}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ code: typeof code === 'number' ? code : -1, stdout: out, stderr: err, timedOut });
    });
  });

/** Flags on every network git call (push, remote reads that resolve URLs). */
export const PUSH_GIT_FLAGS: readonly string[] = Object.freeze([
  '-c', `core.hooksPath=${EMPTY_HOOKS_PATH}`, '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat',
  '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always',
  '-c', 'http.followRedirects=false', '-c', 'push.recurseSubmodules=no', '-c', 'submodule.recurse=false', '-c', 'push.followTags=false',
]);

/** git.init's env: no global or system config, no template, no prompt (the #loop-git hardened env). */
export function localGitEnv(from: Readonly<Record<string, string | undefined>> = process.env): Record<string, string> {
  const env = hardenedGitEnv(from);
  delete (env as Record<string, string | undefined>).GIT_TEMPLATE_DIR;
  return env;
}

/** The scrubbed env of a push / create (the human's own HOME so their credential helper and gh sign-in apply). */
export function networkEnv(o: { userHome: string; toolDir: string; from?: Readonly<Record<string, string | undefined>>; gitConfig?: string | null; commonDir?: string }): Record<string, string> {
  const from = o.from ?? process.env;
  const keep = (k: string): Record<string, string> => (typeof from[k] === 'string' && from[k] !== '' ? { [k]: from[k]! } : {});
  return {
    PATH: [...new Set([o.toolDir, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'])].join(path.delimiter),
    HOME: o.userHome,
    LC_ALL: 'C',
    ...keep('USER'),
    ...keep('LOGNAME'),
    ...keep('TMPDIR'),
    ...keep('SSH_AUTH_SOCK'),
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'https:ssh',
    // Aegis H1: the kernel's config snapshot only (credential helper, ssh command), never the live system/global files
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: o.gitConfig ?? '/dev/null',
    ...(o.commonDir ? { GIT_COMMON_DIR: o.commonDir } : {}),
    GIT_PAGER: 'cat',
    GCM_INTERACTIVE: 'never',
    SSH_ASKPASS_REQUIRE: 'never',
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GH_SPINNER_DISABLED: '1',
    NO_COLOR: '1',
  };
}

/** Env names never copied into a verb's env (asserted by the tests). */
export const NEVER_VERB_ENV: readonly string[] = Object.freeze(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'SSH_ASKPASS', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'GH_ENTERPRISE_TOKEN', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'GIT_EXEC_PATH', 'GIT_TEMPLATE_DIR']);

/** git's absolute path (the kernel's one resolution), or null. */
export function gitPath(): string | null {
  try {
    return gitBinary();
  } catch {
    return null;
  }
}

/** Aegis M4: gh is looked for ONLY here (never PATH), in this order. */
export const GH_LOCATIONS: readonly string[] = Object.freeze(['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']);
/** Aegis M4: a gh realpath must be root-owned, or sit under one of these install prefixes (never session-writable: T-2026-10-23-004). */
export const GH_TRUSTED_PREFIXES: readonly string[] = Object.freeze(['/opt/homebrew/', '/usr/local/', '/usr/bin/']);

/** Is this resolved binary one the kernel may run with the human's credentials? (root-owned or a trusted prefix; never group/world-writable) */
export function trustedToolPath(real: string, st: { uid: number; mode: number }): boolean {
  if ((st.mode & 0o022) !== 0) return false;
  return st.uid === 0 || GH_TRUSTED_PREFIXES.some((p) => real.startsWith(p));
}

let GH_RESOLVED: { path: string | null } | null = null;

/** gh's realpath from GH_LOCATIONS, resolved ONCE per daemon; null when absent or untrusted. */
export function ghPath(): string | null {
  if (GH_RESOLVED) return GH_RESOLVED.path;
  let found: string | null = null;
  for (const c of GH_LOCATIONS) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      const real = fs.realpathSync.native(c);
      const st = fs.statSync(real);
      if (st.isFile() && trustedToolPath(real, st)) {
        found = real;
        break;
      }
    } catch {
      /* next */
    }
  }
  GH_RESOLVED = { path: found };
  return found;
}

/**
 * Aegis H1 (T-2026-10-23-002): the git config a push or a create runs under is a KERNEL SNAPSHOT, never the live
 * global or system files: only the human's credential settings (credential.*) and ssh command (core.sshCommand), read
 * once with `git config --list --show-scope` from the system, global and git's built-in (unknown) scopes and written
 * with `git config --file` to `<dir>/gitconfig` (0600, inside the Gnomon home, which sessions can neither read nor
 * write). Their ~/.ssh/config is copied beside it and, when they set no ssh command, `core.sshCommand = ssh -F <copy>`
 * (or -F /dev/null) pins it, so the system ssh config and a later edit of either file never reach a push. Captured
 * at daemon start (a human action) and when missing; the push env is GIT_CONFIG_NOSYSTEM=1 + GIT_CONFIG_GLOBAL=<it>.
 */
export const PUSH_CONFIG_KEYS = /^(credential\..+|core\.sshcommand)$/i;
export const PUSH_CONFIG_SCOPES: readonly string[] = Object.freeze(['system', 'global', 'unknown']);

/** Aegis round 2 L2: what a snapshot runs and where its entries came from (checked against each session's write allows at push). */
export interface PushConfigSnapshot {
  path: string;
  /** sha256 of the snapshot file (on the push card) */
  hash: string;
  /** realpaths of the programs it runs (credential helpers, the ssh command's program); null when not resolvable */
  programs: Array<{ key: string; program: string | null }>;
  /** the config files its entries came from (`--show-origin`), realpath'd */
  origins: string[];
}

/** The program a credential helper / ssh command value runs, realpath'd (helper names resolve as git-credential-<name>). */
export function helperProgram(key: string, value: string, searchDirs: readonly string[]): string | null {
  const v = value.trim();
  if (v === '') return null;
  const first = (v.startsWith('!') ? v.slice(1).trim() : v).split(/\s+/)[0] ?? '';
  if (first === '') return null;
  const name = path.isAbsolute(first) || /^core\.sshcommand$/i.test(key) || v.startsWith('!') ? first : `git-credential-${first}`;
  const cands = path.isAbsolute(name) ? [name] : searchDirs.map((d) => path.join(d, name));
  for (const c of cands) {
    try {
      return fs.realpathSync.native(c);
    } catch {
      /* next */
    }
  }
  return null;
}

export async function capturePushConfig(o: { dir: string; git: string; userHome: string; exec?: Exec; from?: Readonly<Record<string, string | undefined>> }): Promise<PushConfigSnapshot> {
  const exec = o.exec ?? execTool;
  fs.mkdirSync(o.dir, { recursive: true, mode: 0o700 });
  const env = { PATH: [path.dirname(o.git), '/usr/bin', '/bin'].join(path.delimiter), HOME: o.userHome, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', ...(o.from?.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: o.from.XDG_CONFIG_HOME } : {}) };
  const r = await exec(o.git, ['config', '--list', '--show-origin', '--show-scope', '-z'], { cwd: o.userHome, env, timeoutMs: VERB_TIMEOUTS.read });
  const execPath = (await exec(o.git, ['--exec-path'], { cwd: o.userHome, env, timeoutMs: VERB_TIMEOUTS.read })).stdout.trim();
  const searchDirs = [...(execPath ? [execPath] : []), path.dirname(o.git), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const programs: PushConfigSnapshot['programs'] = [];
  const origins = new Set<string>();
  const tmp = path.join(o.dir, `gitconfig.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tmp, '', { mode: 0o600 });
  const fields = r.code === 0 ? r.stdout.split('\0') : [];
  let ssh = false;
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const scope = fields[i]!;
    const origin = fields[i + 1]!;
    const nl = fields[i + 2]!.indexOf('\n');
    const key = nl < 0 ? fields[i + 2]! : fields[i + 2]!.slice(0, nl);
    const value = nl < 0 ? 'true' : fields[i + 2]!.slice(nl + 1);
    if (!PUSH_CONFIG_SCOPES.includes(scope) || !PUSH_CONFIG_KEYS.test(key)) continue;
    if (/^core\.sshcommand$/i.test(key)) ssh = true;
    if (origin.startsWith('file:')) {
      try {
        origins.add(fs.realpathSync.native(origin.slice(5)));
      } catch {
        origins.add(path.resolve(origin.slice(5)));
      }
    }
    if (/^credential\..*helper$/i.test(key) || /^core\.sshcommand$/i.test(key)) programs.push({ key, program: helperProgram(key, value, searchDirs) });
    await exec(o.git, ['config', '--file', tmp, '--add', key, value], { cwd: o.dir, env, timeoutMs: VERB_TIMEOUTS.read });
  }
  if (!ssh) {
    const src = path.join(o.userHome, '.ssh', 'config');
    const copy = path.join(o.dir, 'ssh_config');
    let pinned = '/dev/null';
    try {
      fs.writeFileSync(copy, fs.readFileSync(src), { mode: 0o600 });
      pinned = copy;
    } catch {
      fs.rmSync(copy, { force: true });
    }
    await exec(o.git, ['config', '--file', tmp, 'core.sshCommand', `ssh -F '${pinned.replace(/'/g, `'\\''`)}'`], { cwd: o.dir, env, timeoutMs: VERB_TIMEOUTS.read });
  }
  const out = path.join(o.dir, 'gitconfig');
  fs.renameSync(tmp, out);
  const hash = `sha256:${createHash('sha256').update(fs.readFileSync(out)).digest('hex')}`;
  return { path: out, hash, programs, origins: [...origins].sort() };
}

/**
 * Aegis round 2 L2: a snapshot is refused for a session when a program it runs or a config file it came from lies under
 * a path that session may write (its roots, TMPDIR, cache, the shared temp dirs). Returns the offending path, or null.
 */
export function snapshotWritableBy(snap: Pick<PushConfigSnapshot, 'programs' | 'origins'>, writable: readonly string[]): string | null {
  const under = (p: string): boolean => writable.some((w) => p === w || p.startsWith(w.endsWith(path.sep) ? w : `${w}${path.sep}`));
  for (const pr of snap.programs) if (pr.program && under(pr.program)) return pr.program;
  for (const o of snap.origins) if (under(o)) return o;
  return null;
}

/** A command's output as the agent may see it: URL userinfo and secret shapes redacted, the last `max` characters. */
export function redactOutput(s: string, max = 1200): string {
  const noUserinfo = s.replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, '$1[redacted]@');
  const { text } = redactText(noUserinfo);
  const t = text.trim();
  return t.length > max ? `…${t.slice(t.length - max)}` : t;
}
