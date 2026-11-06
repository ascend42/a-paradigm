/**
 * #git-run — the ONE way the fabric mirror (#fabric-mirror) talks to git.
 *
 * Why a dedicated runner (W2 findings M3, M4, I6, M6):
 *
 *   - ENV SANITIZED (M4). An inherited GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE /
 *     GIT_COMMON_DIR / GIT_OBJECT_DIRECTORY / GIT_ALTERNATE_OBJECT_DIRECTORIES /
 *     GIT_NAMESPACE / GIT_PREFIX (a hook run, a parent git process, an agent shell)
 *     would point every plumbing call at ANOTHER repository and defeat the root
 *     guard. They are stripped from every spawn; `cwd` alone selects the repo.
 *   - BINARY RESOLVED (I6). launchd / GUI helpers often run with a PATH that has no
 *     git. The binary is found via WARPLINE_GIT, then PATH (`git.exe` on win32 —
 *     never the `git.cmd` shim, which cannot run without a shell), then the usual
 *     install locations. Not found ⇒ `unavailable`, and callers FAIL CLOSED when a
 *     `.git` exists (the backstop never silently switches off).
 *   - TIMEOUTS. 30 s for local plumbing, 60 s for network calls, SIGKILL after.
 *   - NETWORK ENV (M6). GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=never and ssh
 *     BatchMode (unless the user configured their own ssh command), so a push from
 *     a hook can never prompt or wait on a TTY.
 *   - ARGV ONLY. spawnSync with an argv array, never a shell string (Windows-safe).
 *
 * Failure classes: `unavailable` (no binary / cannot spawn), `timeout`, `error`
 * (git ran and exited non-zero). "Not a repository" is decided by callers from
 * the filesystem (`.git` absent), never inferred from a git error.
 *
 * A spawn counter is exposed as a test seam (I9 — the cost budget per seal).
 *
 * Library code: no console output — callers report.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Environment variables that redirect git away from `cwd` — stripped from every spawn (M4). */
export const REDIRECTING_GIT_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
  'GIT_REPLACE_REF_BASE',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_SHALLOW_FILE',
] as const;

export const LOCAL_TIMEOUT_MS = 30_000;
export const NETWORK_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 256 * 1024 * 1024;

export type GitFailureClass = 'unavailable' | 'timeout' | 'error';

/** A git invocation that did not succeed. `cls` says why. */
export class GitRunError extends Error {
  constructor(
    message: string,
    readonly cls: GitFailureClass,
    readonly args: string[],
    readonly status: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitRunError';
  }
}

export interface GitRunOptions {
  input?: Buffer | string;
  /** extra env merged over the sanitized environment. */
  env?: Record<string, string>;
  timeoutMs?: number;
  maxBuffer?: number;
}

export interface GitResult {
  status: number;
  stdout: Buffer;
  stderr: string;
}

let spawns = 0;
/** Test seam (I9): git processes spawned by #git-run since the last reset. */
export function gitSpawnCount(): number {
  return spawns;
}
export function resetGitSpawnCount(): void {
  spawns = 0;
}

let cachedBinary: { key: string; bin: string | null } | null = null;
/** Drop the resolved-binary cache (tests that change PATH / WARPLINE_GIT). */
export function resetGitBinaryCache(): void {
  cachedBinary = null;
}

function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    if (process.platform === 'win32') return true;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function usualLocations(): string[] {
  if (process.platform === 'win32') {
    const out: string[] = [];
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432]) {
      if (base) out.push(path.join(base, 'Git', 'cmd', 'git.exe'), path.join(base, 'Git', 'bin', 'git.exe'));
    }
    if (process.env.LOCALAPPDATA) out.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe'));
    return out;
  }
  return [
    '/usr/bin/git',
    '/usr/local/bin/git',
    '/opt/homebrew/bin/git',
    '/opt/local/bin/git',
    '/Library/Developer/CommandLineTools/usr/bin/git',
  ];
}

/**
 * The git binary: WARPLINE_GIT (taken literally — a set-but-missing value is
 * `unavailable`, never a silent fallback), else PATH, else the usual install
 * locations. null ⇒ git cannot be found.
 */
export function resolveGitBinary(): string | null {
  const key = `${process.env.WARPLINE_GIT ?? ''}\u0000${process.env.PATH ?? ''}`;
  if (cachedBinary?.key === key) return cachedBinary.bin;
  let bin: string | null = null;
  const forced = process.env.WARPLINE_GIT;
  if (forced !== undefined && forced !== '') {
    bin = isExecutableFile(forced) ? forced : null;
  } else {
    const names = process.platform === 'win32' ? ['git.exe'] : ['git'];
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      if (!dir) continue;
      for (const n of names) {
        const p = path.join(dir, n);
        if (isExecutableFile(p)) {
          bin = p;
          break;
        }
      }
      if (bin) break;
    }
    if (!bin) bin = usualLocations().find(isExecutableFile) ?? null;
  }
  cachedBinary = { key, bin };
  return bin;
}

/** process.env minus every redirecting GIT_* variable, plus `extra`. */
export function sanitizedGitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of REDIRECTING_GIT_ENV) delete env[k];
  // never let a plumbing call open an editor or a pager, or prompt for credentials
  for (const k of Object.keys(env)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)) delete env[k];
  env.GIT_TERMINAL_PROMPT = '0';
  // replace refs must never substitute the objects the record is read from
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.GIT_PAGER = 'cat';
  return { ...env, ...extra };
}

/**
 * Extra env for a network call (M6): no terminal prompt, no credential-manager
 * UI, ssh in BatchMode unless the user set GIT_SSH_COMMAND or core.sshCommand.
 */
export function networkGitEnv(cwd: string): Record<string, string> {
  const extra: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' };
  if (!process.env.GIT_SSH_COMMAND && !process.env.GIT_SSH) {
    const configured = gitRun(cwd, ['config', '--get', 'core.sshCommand']);
    if (configured.status !== 0 || configured.stdout.toString('utf8').trim() === '') {
      extra.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=2';
    }
  }
  return extra;
}

/**
 * Run git. Never throws for a non-zero exit (inspect `status`); throws
 * GitRunError('unavailable') when no binary can be spawned and
 * GitRunError('timeout') when the call was killed.
 */
export function gitRun(cwd: string, args: string[], opts: GitRunOptions = {}): GitResult {
  const bin = resolveGitBinary();
  if (bin === null) {
    throw new GitRunError(
      'warpline: git is not available (not on PATH, not in the usual install locations, WARPLINE_GIT unset or missing)',
      'unavailable',
      args,
      null,
      '',
    );
  }
  spawns++;
  const r = spawnSync(bin, args, {
    cwd,
    input: opts.input,
    env: sanitizedGitEnv(opts.env),
    maxBuffer: opts.maxBuffer ?? MAX_BUFFER,
    timeout: opts.timeoutMs ?? LOCAL_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderr = r.stderr ? r.stderr.toString('utf8') : '';
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') {
      throw new GitRunError(`warpline: git ${args[0]} timed out`, 'timeout', args, null, stderr);
    }
    if (code === 'ENOBUFS') {
      throw new GitRunError(`warpline: git ${args[0]} output exceeded the buffer cap`, 'error', args, null, stderr);
    }
    throw new GitRunError(`warpline: git could not be spawned (${bin}): ${r.error.message}`, 'unavailable', args, null, stderr);
  }
  if (r.signal) {
    throw new GitRunError(`warpline: git ${args[0]} was killed (${r.signal})`, 'timeout', args, null, stderr);
  }
  return { status: r.status ?? -1, stdout: r.stdout ?? Buffer.alloc(0), stderr };
}

/** Run git; non-zero exit ⇒ GitRunError('error'). */
export function git(cwd: string, args: string[], opts: GitRunOptions = {}): Buffer {
  const r = gitRun(cwd, args, opts);
  if (r.status !== 0) {
    throw new GitRunError(
      `warpline: git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr.trim()}`,
      'error',
      args,
      r.status,
      r.stderr,
    );
  }
  return r.stdout;
}

export const gitText = (cwd: string, args: string[], opts?: GitRunOptions): string =>
  git(cwd, args, opts).toString('utf8').trim();

/** Exit status 0? (Binary unavailability / timeouts still throw — they are not a "no".) */
export function gitOk(cwd: string, args: string[], opts?: GitRunOptions): boolean {
  return gitRun(cwd, args, opts).status === 0;
}
