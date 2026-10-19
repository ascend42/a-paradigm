/**
 * @symbol $daemon-lifecycle
 *
 * The upgrade successor (TD-2026-10-19-063 flow 2 "restart"). After an
 * accepted daemon-stop{reason:'upgrade'} card the old kernel drains every
 * session (§2.4 rule 11), releases its lock and socket, and then — from
 * runForeground, after `exited` — spawns ONE detached successor gnomond from
 * the (updated) entry on disk with the clean re-exec env and argv of ready.ts
 * (cleanReexecEnv / reexecArgs) plus `--prefer-port <old web port>`, and
 * exits. The successor binds 127.0.0.1 only, exclusively; a taken port falls
 * back to an OS-chosen one (status web.portFallback). It resumes the drained
 * sessions (resume.ts) and takes the GUI resume hand-off (web/resume.ts).
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { cleanReexecEnv, reexecArgs } from './env.js';

export interface SuccessorPlan {
  execPath: string;
  /** the gnomond entry script; omitted for a SEA (its execPath is the entry) */
  entry?: string;
  home: string;
  idleMs?: number;
  preferPort: number | null;
  /** the successor's kernel key (PKCS#8 PEM), written to its stdin pipe (`--kernel-key-stdin`) */
  kernelKeyPem?: string;
}

/** argv of the successor: the clean re-exec argv (no ready channel: nobody waits on it) + `--prefer-port`. */
export function successorArgs(p: Omit<SuccessorPlan, 'execPath'>): string[] {
  const args = reexecArgs({ ...(p.entry ? { entry: p.entry } : {}), home: p.home, ...(p.idleMs !== undefined ? { idleMs: p.idleMs } : {}) });
  if (p.preferPort !== null && Number.isInteger(p.preferPort) && p.preferPort > 0 && p.preferPort < 65536) args.push('--prefer-port', String(p.preferPort));
  if (p.kernelKeyPem !== undefined) args.push('--kernel-key-stdin');
  return args;
}

/** The successor plan for THIS process: entry = argv[1] unless it is a SEA. */
export function successorPlanOf(home: string, preferPort: number | null, idleMs?: number, argv1: string | undefined = process.argv[1], kernelKeyPem?: string): SuccessorPlan {
  const isSea = argv1 === undefined || path.resolve(process.execPath) === path.resolve(argv1);
  return { execPath: process.execPath, ...(isSea ? {} : { entry: argv1 }), home, preferPort, ...(idleMs !== undefined ? { idleMs } : {}), ...(kernelKeyPem !== undefined ? { kernelKeyPem } : {}) };
}

/** Spawn the detached successor; returns its pid (null when the spawn failed: the next client activation starts one). */
export function spawnSuccessor(p: SuccessorPlan, sourceEnv: Readonly<Record<string, string | undefined>> = process.env): number | null {
  try {
    const child = spawn(p.execPath, successorArgs(p), { detached: true, stdio: [p.kernelKeyPem !== undefined ? 'pipe' : 'ignore', 'ignore', 'ignore'], env: cleanReexecEnv(sourceEnv), windowsHide: true });
    child.on('error', () => undefined);
    if (p.kernelKeyPem !== undefined && child.stdin) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(p.kernelKeyPem);
    }
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

/** The largest kernel key the successor reads from stdin, and how long it waits for it (configured bounds). */
export const KERNEL_KEY_STDIN_MAX_BYTES = 8192;
export const KERNEL_KEY_STDIN_TIMEOUT_MS = 5_000;

/** `--kernel-key-stdin`: read the predecessor's key from the stdin pipe (bounded); null on anything else. */
export function readKernelKeyStdin(stdin: NodeJS.ReadableStream = process.stdin): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let n = 0;
    const done = (v: string | null): void => {
      clearTimeout(timer);
      stdin.removeAllListeners('data');
      resolve(v);
    };
    const timer = setTimeout(() => done(null), KERNEL_KEY_STDIN_TIMEOUT_MS);
    stdin.on('data', (c: Buffer) => {
      n += c.length;
      if (n > KERNEL_KEY_STDIN_MAX_BYTES) return done(null);
      chunks.push(Buffer.from(c));
    });
    stdin.once('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      done(/^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+-----END PRIVATE KEY-----\n?$/.test(s) ? s : null);
    });
    stdin.once('error', () => done(null));
  });
}
