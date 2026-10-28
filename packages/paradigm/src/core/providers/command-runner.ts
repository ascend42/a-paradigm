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
 */

import { spawn } from 'child_process';

/**
 * Environment variables removed before a command runs. A name is removed when
 * it matches any of these (case-insensitive):
 *  - contains TOKEN, SECRET, PASSWORD, PASSWD, CREDENTIAL, API_KEY,
 *    ACCESS_KEY, PRIVATE_KEY, AUTHTOKEN or SESSION_KEY
 *  - ends with _KEY, _AUTH or _PAT
 *  - starts with AWS_, AZURE_, GCP_, GCLOUD_, CLOUDSDK_, GOOGLE_APPLICATION_,
 *    ANTHROPIC_, OPENAI_, NPM_CONFIG__AUTH or NPM_CONFIG_//
 *  - is exactly GH_TOKEN, GITHUB_TOKEN, NPM_TOKEN, NODE_AUTH_TOKEN,
 *    SSH_AUTH_SOCK, KUBECONFIG, DOCKER_AUTH_CONFIG or VAULT_ADDR
 * PATH, HOME, LANG, TERM, PWD and the rest are kept.
 */
export const SECRET_ENV_PATTERNS: RegExp[] = [
  /TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTHTOKEN|SESSION_KEY/i,
  /(_KEY|_AUTH|_PAT)$/i,
  /^(AWS_|AZURE_|GCP_|GCLOUD_|CLOUDSDK_|GOOGLE_APPLICATION_|ANTHROPIC_|OPENAI_|NPM_CONFIG__AUTH|NPM_CONFIG_\/\/)/i,
  /^(GH_TOKEN|GITHUB_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN|SSH_AUTH_SOCK|KUBECONFIG|DOCKER_AUTH_CONFIG|VAULT_ADDR)$/i,
];

export function isSecretEnvName(name: string): boolean {
  return SECRET_ENV_PATTERNS.some((re) => re.test(name));
}

export function cleanCommandEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (!isSecretEnvName(k)) out[k] = v;
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
        else child.kill(signal);
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
