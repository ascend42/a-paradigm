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
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gitBinary, hardenedGitEnv } from './scratch.js';
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
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat',
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

/** gh's absolute path: the kernel PATH, then the known install folders; realpath'd; null when absent. */
export function ghPath(from: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const dirs = [...(from.PATH ?? '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  for (const d of dirs) {
    if (!d || !path.isAbsolute(d)) continue;
    const c = path.join(d, 'gh');
    try {
      fs.accessSync(c, fs.constants.X_OK);
      if (fs.statSync(c).isFile()) return fs.realpathSync.native(c);
    } catch {
      /* next */
    }
  }
  return null;
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

export async function capturePushConfig(o: { dir: string; git: string; userHome: string; exec?: Exec; from?: Readonly<Record<string, string | undefined>> }): Promise<string> {
  const exec = o.exec ?? execTool;
  fs.mkdirSync(o.dir, { recursive: true, mode: 0o700 });
  const env = { PATH: [path.dirname(o.git), '/usr/bin', '/bin'].join(path.delimiter), HOME: o.userHome, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', ...(o.from?.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: o.from.XDG_CONFIG_HOME } : {}) };
  const r = await exec(o.git, ['config', '--list', '--show-scope', '-z'], { cwd: o.userHome, env, timeoutMs: VERB_TIMEOUTS.read });
  const tmp = path.join(o.dir, `gitconfig.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tmp, '', { mode: 0o600 });
  const fields = r.code === 0 ? r.stdout.split('\0') : [];
  let ssh = false;
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const scope = fields[i]!;
    const nl = fields[i + 1]!.indexOf('\n');
    const key = nl < 0 ? fields[i + 1]! : fields[i + 1]!.slice(0, nl);
    const value = nl < 0 ? 'true' : fields[i + 1]!.slice(nl + 1);
    if (!PUSH_CONFIG_SCOPES.includes(scope) || !PUSH_CONFIG_KEYS.test(key)) continue;
    if (/^core\.sshcommand$/i.test(key)) ssh = true;
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
  return out;
}

/** A command's output as the agent may see it: URL userinfo and secret shapes redacted, the last `max` characters. */
export function redactOutput(s: string, max = 1200): string {
  const noUserinfo = s.replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, '$1[redacted]@');
  // gh's own OAuth / user / server tokens (gho_, ghu_, ghs_, ghr_) beside the shared shapes (ghp_, github_pat_)
  const { text } = redactText(noUserinfo.replace(/\bgh[ousr]_[A-Za-z0-9]{20,}/g, '[redacted:github-token]'));
  const t = text.trim();
  return t.length > max ? `…${t.slice(t.length - max)}` : t;
}
