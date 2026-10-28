/**
 * #command-runner — how an API-run agent's allowed run_command actually runs.
 *
 * - Cleaned environment (cleanCommandEnv): secrets the CLI holds are not
 *   handed to model-chosen commands.
 * - Own process group (detached on POSIX): on timeout the whole group gets
 *   SIGTERM, then SIGKILL after a grace period, so `cmd &` children die too.
 *   Every live group is killed when the CLI exits or gets SIGINT, SIGTERM or
 *   SIGHUP (a detached group no longer receives the terminal's Ctrl+C itself).
 * - No stdin: a command can't read the terminal, or the consent answer.
 *
 * Limits: env cleaning is defense in depth, not containment; a command that is
 * allowed to run can still read files such as ~/.netrc or a cloud CLI's
 * credentials. On POSIX a command can leave its process group with `setsid`
 * (or a double fork plus setsid), and such a process survives the group kill.
 * On Windows the command's process tree is killed with `taskkill /T /F`.
 */

import { execFileSync, spawn } from 'child_process';

/**
 * Environment variables removed before a command runs (defense in depth, not
 * containment). A name is removed when it matches any of these
 * (case-insensitive):
 *  - contains TOKEN, SECRET, PASSWORD, PASSWD, CREDENTIAL, CREDS, COOKIE,
 *    JWT, API_KEY, ACCESS_KEY, PRIVATE_KEY, AUTHTOKEN or SESSION_KEY
 *  - ends with _KEY, _AUTH, _PAT, _PASS, _PW, _PWD or _DSN (PWD and OLDPWD
 *    have no underscore before PWD and are kept)
 *  - starts with AWS_, AZURE_, GCP_, GCLOUD_, CLOUDSDK_, GOOGLE_APPLICATION_,
 *    ANTHROPIC_, OPENAI_, TF_VAR_, GIT_CONFIG_KEY_, GIT_CONFIG_VALUE_,
 *    NPM_CONFIG__AUTH or NPM_CONFIG_//
 *  - is exactly GH_TOKEN, GITHUB_TOKEN, NPM_TOKEN, NODE_AUTH_TOKEN,
 *    SSH_AUTH_SOCK, KUBECONFIG, DOCKER_AUTH_CONFIG, DOCKER_CONFIG, VAULT_ADDR,
 *    GIT_CONFIG_COUNT, GIT_ASKPASS, SSH_ASKPASS or NETRC
 * A variable is also removed when its VALUE holds a URL with a password
 * (scheme://user:password@host). PATH, HOME, LANG, TERM, PWD and the rest are
 * kept.
 */
export const SECRET_ENV_PATTERNS: RegExp[] = [
  /TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDS|COOKIE|JWT|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTHTOKEN|SESSION_KEY/i,
  /(_KEY|_AUTH|_PAT|_PASS|_PW|_PWD|_DSN)$/i,
  /^(AWS_|AZURE_|GCP_|GCLOUD_|CLOUDSDK_|GOOGLE_APPLICATION_|ANTHROPIC_|OPENAI_|TF_VAR_|GIT_CONFIG_KEY_|GIT_CONFIG_VALUE_|NPM_CONFIG__AUTH|NPM_CONFIG_\/\/)/i,
  /^(GH_TOKEN|GITHUB_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN|SSH_AUTH_SOCK|KUBECONFIG|DOCKER_AUTH_CONFIG|DOCKER_CONFIG|VAULT_ADDR|GIT_CONFIG_COUNT|GIT_ASKPASS|SSH_ASKPASS|NETRC)$/i,
];

/** A value carrying credentials in a URL: scheme://user:password@host. */
export const CREDENTIAL_URL = /:\/\/[^/\s:@]+:[^/\s@]+@/;

export function isSecretEnvName(name: string): boolean {
  return SECRET_ENV_PATTERNS.some((re) => re.test(name));
}

export function cleanCommandEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (isSecretEnvName(k)) continue;
    if (typeof v === 'string' && CREDENTIAL_URL.test(v)) continue;
    out[k] = v;
  }
  return out;
}

export interface CommandResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const MAX_OUTPUT = 1024 * 1024;
const KILL_GRACE_MS = 2000;
const POSIX = process.platform !== 'win32';

// Live commands: pid -> kill function for its whole group.
const live = new Map<number, (signal: NodeJS.Signals) => void>();
const EXIT_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const signalHandlers = new Map<NodeJS.Signals, () => void>();
let exitHookInstalled = false;

/** Kill every live command's process group (used on CLI exit). */
export function killAllCommandGroups(signal: NodeJS.Signals = 'SIGKILL'): void {
  for (const kill of live.values()) kill(signal);
}

function onProcessExit(): void {
  killAllCommandGroups('SIGKILL');
}

function installExitHooks(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', onProcessExit);
  for (const sig of EXIT_SIGNALS) {
    const handler = (): void => {
      killAllCommandGroups('SIGKILL');
      // If we were the only listener, keep the default behaviour: exit on the signal.
      if (process.listenerCount(sig) === 1) {
        uninstallExitHooks();
        process.kill(process.pid, sig);
      }
    };
    signalHandlers.set(sig, handler);
    process.on(sig, handler);
  }
}

function uninstallExitHooks(): void {
  if (!exitHookInstalled) return;
  exitHookInstalled = false;
  process.removeListener('exit', onProcessExit);
  for (const [sig, handler] of signalHandlers) process.removeListener(sig, handler);
  signalHandlers.clear();
}

export function runShellCommand(
  command: string,
  opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: opts.cwd,
      env: opts.env ?? cleanCommandEnv(),
      shell: true,
      detached: POSIX,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const pid = child.pid;
    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        if (POSIX && pid) process.kill(-pid, signal);
        else if (pid) {
          // Windows has no process groups: kill the whole tree. Synchronous so
          // it also works from the process 'exit' hook.
          execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
        } else child.kill(signal);
      } catch {
        // Already gone.
      }
    };
    if (pid) {
      live.set(pid, killGroup);
      installExitHooks();
    }

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += d.toString('utf-8'); });
    child.stderr?.on('data', (d: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += d.toString('utf-8'); });

    let timedOut = false;
    let graceTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      graceTimer = setTimeout(() => killGroup('SIGKILL'), KILL_GRACE_MS);
      graceTimer.unref();
    }, opts.timeoutMs);

    let done = false;
    const finish = (exitCode: number | null, signal: string | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (timedOut) {
        // Make sure nothing in the group outlives a timed-out command.
        killGroup('SIGKILL');
        if (graceTimer) clearTimeout(graceTimer);
      }
      if (pid) live.delete(pid);
      if (live.size === 0) uninstallExitHooks();
      resolve({
        exitCode,
        signal,
        stdout: stdout.length > MAX_OUTPUT ? `${stdout.slice(0, MAX_OUTPUT)}\n[output truncated]` : stdout,
        stderr: stderr.length > MAX_OUTPUT ? `${stderr.slice(0, MAX_OUTPUT)}\n[output truncated]` : stderr,
        timedOut,
      });
    };
    child.on('error', (err) => {
      stderr += String(err.message);
      finish(null, null);
    });
    child.on('close', (code, signal) => finish(code, signal));
  });
}
