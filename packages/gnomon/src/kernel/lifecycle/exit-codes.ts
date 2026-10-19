/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4 rule 2) — the ONE table of gnomond exit codes.
 *
 * A supervisor (launchd at 8.1, Gnomon.app, `gnomon daemon --detach`) must
 * tell a fault a human has to fix from one that may clear by itself, or it
 * restarts a misconfigured kernel in a loop. Every gnomond exit is one of
 * these codes, and every code has exactly one class:
 *
 *   ok          0   clean exit (idle, signal)                      no restart
 *   superseded  4   another kernel already serves this home        no restart (attach to it)
 *   config     64   usage: bad argv                                 no restart
 *   internal   70   unexpected error (a bug)                        restart with backoff
 *   transient  75   lock race, endpoint busy, not ready in time     restart with backoff
 *   config     78   unsafe home, no endpoint path, ACL, sigusr1,    no restart
 *                   dev home, identity cannot open, sandbox
 *
 * Codes 64/70/75/78 are the sysexits(3) values (EX_USAGE, EX_SOFTWARE,
 * EX_TEMPFAIL, EX_CONFIG), so launchd/systemd conventions read them right.
 * The client verbs (`gnomon daemon status|stop`) keep their own 0/1/3.
 */
import type { LifecycleRefusalReason } from './refusal.js';

export const DAEMON_EXIT = Object.freeze({
  ok: 0,
  superseded: 4,
  usage: 64,
  internal: 70,
  transient: 75,
  config: 78,
} as const);

export type DaemonExitCode = (typeof DAEMON_EXIT)[keyof typeof DAEMON_EXIT];
export type DaemonExitClass = 'ok' | 'superseded' | 'config' | 'internal' | 'transient';

/** Every lifecycle refusal is classified here; the Record type makes a new reason a compile error until it is. */
export const REFUSAL_EXIT_CLASS: Readonly<Record<LifecycleRefusalReason, DaemonExitClass>> = Object.freeze({
  'already-running': 'superseded',
  'lock-race': 'transient',
  'endpoint-busy': 'transient',
  'unsafe-home': 'config',
  'no-safe-endpoint': 'config',
  'endpoint-acl': 'config',
  'sandbox-unavailable': 'config',
  'web-bundle-mismatch': 'config',
  'web-transport-failed': 'transient',
  'web-launch-refused': 'transient',
  'quarantine-pending': 'config',
});

/** Faults the kernel raises before or outside a LifecycleRefusal (runForeground's own checks). */
export type StartupFault = 'sigusr1-enabled' | 'dev-home' | 'identity';
export const STARTUP_FAULT_CLASS: Readonly<Record<StartupFault, DaemonExitClass>> = Object.freeze({
  'sigusr1-enabled': 'config',
  'dev-home': 'config',
  identity: 'config',
});

export function exitCodeOfClass(c: DaemonExitClass): DaemonExitCode {
  switch (c) {
    case 'ok':
      return DAEMON_EXIT.ok;
    case 'superseded':
      return DAEMON_EXIT.superseded;
    case 'config':
      return DAEMON_EXIT.config;
    case 'internal':
      return DAEMON_EXIT.internal;
    case 'transient':
      return DAEMON_EXIT.transient;
  }
}

export function exitCodeOfRefusal(reason: LifecycleRefusalReason): DaemonExitCode {
  return exitCodeOfClass(REFUSAL_EXIT_CLASS[reason]);
}

/** The class of an observed exit code. A code outside the table (a crashed interpreter, a signal) is `internal`. */
export function classifyExitCode(code: number | null): DaemonExitClass {
  switch (code) {
    case DAEMON_EXIT.ok:
      return 'ok';
    case DAEMON_EXIT.superseded:
      return 'superseded';
    case DAEMON_EXIT.usage:
    case DAEMON_EXIT.config:
      return 'config';
    case DAEMON_EXIT.transient:
      return 'transient';
    default:
      return 'internal';
  }
}

/** Whether a supervisor may restart after this class (with backoff). Config and superseded never are. */
export function restartable(c: DaemonExitClass): boolean {
  return c === 'transient' || c === 'internal';
}
