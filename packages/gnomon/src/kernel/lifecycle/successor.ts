/**
 * @symbol $daemon-lifecycle
 *
 * The upgrade successor (TD-2026-10-19-063 flow 2 "restart"). After an
 * accepted daemon-stop{reason:'upgrade'} card the old kernel drains every
 * session (§2.4 rule 11), releases its lock and unix socket, and then — from
 * runForeground, after `exited` — spawns ONE detached successor gnomond from
 * the (updated) entry on disk with the clean re-exec env and argv of ready.ts
 * (cleanReexecEnv / reexecArgs), and exits.
 *
 * Aegis H: the old kernel's web LISTENING SOCKET is handed to the successor
 * as an inherited fd (`--web-listen-fd 3`), so the 127.0.0.1 port is never
 * unbound across the hand-over and no squatter can take it. Where an fd
 * cannot be inherited (win32) the successor asks for the port by number
 * (`--prefer-port`); any port other than the old one drops the GUI resume
 * record (web/resume.ts).
 *
 * Aegis M: the successor's kernel key and the GUI resume record travel on its
 * STDIN pipe as one bounded JSON object (`--kernel-key-stdin`); never argv,
 * env or a file.
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { cleanReexecEnv, reexecArgs } from './env.js';
import { runningAsSea } from './sea.js';

/** The fd the successor's inherited web listener sits on (stdio slot 3). */
export const WEB_LISTEN_FD = 3;

export interface SuccessorHandoff {
  /** the successor's kernel key (PKCS#8 PEM), minted by the predecessor at accept */
  kernelKeyPem: string;
  /** the GUI resume record (digest + binding), or null when no GUI accepted */
  resume: unknown;
}

export interface SuccessorPlan {
  execPath: string;
  /** the gnomond entry script; omitted for a SEA (its execPath is the entry) */
  entry?: string;
  home: string;
  idleMs?: number;
  preferPort: number | null;
  /** the old kernel's listening socket fd, inherited at WEB_LISTEN_FD (POSIX) */
  listenFd?: number;
  handoff?: SuccessorHandoff;
}

/** argv of the successor: the clean re-exec argv (no ready channel: nobody waits on it) + the hand-over flags. */
export function successorArgs(p: Omit<SuccessorPlan, 'execPath'>): string[] {
  const args = reexecArgs({ ...(p.entry ? { entry: p.entry } : {}), home: p.home, ...(p.idleMs !== undefined ? { idleMs: p.idleMs } : {}) });
  if (p.preferPort !== null && Number.isInteger(p.preferPort) && p.preferPort > 0 && p.preferPort < 65536) args.push('--prefer-port', String(p.preferPort));
  if (p.listenFd !== undefined) args.push('--web-listen-fd', String(WEB_LISTEN_FD));
  if (p.handoff !== undefined) args.push('--kernel-key-stdin');
  return args;
}

/** The successor plan for THIS process: entry = argv[1] unless it is a SEA (#kernel-sea: node:sea, or argv[1] = execPath). */
export function successorPlanOf(home: string, preferPort: number | null, o: { idleMs?: number; argv1?: string; listenFd?: number; handoff?: SuccessorHandoff } = {}): SuccessorPlan {
  const argv1 = 'argv1' in o ? o.argv1 : process.argv[1];
  const isSea = runningAsSea() || argv1 === undefined || path.resolve(process.execPath) === path.resolve(argv1);
  return {
    execPath: process.execPath,
    ...(isSea ? {} : { entry: argv1 }),
    home,
    preferPort,
    ...(o.idleMs !== undefined ? { idleMs: o.idleMs } : {}),
    ...(o.listenFd !== undefined ? { listenFd: o.listenFd } : {}),
    ...(o.handoff !== undefined ? { handoff: o.handoff } : {}),
  };
}

/** Spawn the detached successor; returns its pid (null when the spawn failed: the next client activation starts one). */
export function spawnSuccessor(p: SuccessorPlan, sourceEnv: Readonly<Record<string, string | undefined>> = process.env): number | null {
  try {
    const stdio: Array<'pipe' | 'ignore' | number> = [p.handoff !== undefined ? 'pipe' : 'ignore', 'ignore', 'ignore'];
    if (p.listenFd !== undefined) stdio.push(p.listenFd);
    const child = spawn(p.execPath, successorArgs(p), { detached: true, stdio, env: cleanReexecEnv(sourceEnv), windowsHide: true });
    child.on('error', () => undefined);
    if (p.handoff !== undefined && child.stdin) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(JSON.stringify(p.handoff));
    }
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

/** The largest hand-off the successor reads from stdin, and how long it waits for it (configured bounds). */
export const HANDOFF_STDIN_MAX_BYTES = 16_384;
export const HANDOFF_STDIN_TIMEOUT_MS = 5_000;

/** `--kernel-key-stdin`: read the predecessor's hand-off from the stdin pipe (bounded); null on anything else. */
export function readHandoffStdin(stdin: NodeJS.ReadableStream = process.stdin): Promise<SuccessorHandoff | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let n = 0;
    const done = (v: SuccessorHandoff | null): void => {
      clearTimeout(timer);
      stdin.removeAllListeners('data');
      resolve(v);
    };
    const timer = setTimeout(() => done(null), HANDOFF_STDIN_TIMEOUT_MS);
    stdin.on('data', (c: Buffer) => {
      n += c.length;
      if (n > HANDOFF_STDIN_MAX_BYTES) return done(null);
      chunks.push(Buffer.from(c));
    });
    stdin.once('end', () => done(parseHandoff(Buffer.concat(chunks).toString('utf8'))));
    stdin.once('error', () => done(null));
  });
}

export function parseHandoff(s: string): SuccessorHandoff | null {
  try {
    const o = JSON.parse(s) as { kernelKeyPem?: unknown; resume?: unknown };
    if (typeof o.kernelKeyPem !== 'string' || !/^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+-----END PRIVATE KEY-----\n?$/.test(o.kernelKeyPem)) return null;
    return { kernelKeyPem: o.kernelKeyPem, resume: o.resume ?? null };
  } catch {
    return null;
  }
}
