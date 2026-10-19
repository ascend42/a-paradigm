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
}

/** argv of the successor: the clean re-exec argv (no ready channel: nobody waits on it) + `--prefer-port`. */
export function successorArgs(p: Omit<SuccessorPlan, 'execPath'>): string[] {
  const args = reexecArgs({ ...(p.entry ? { entry: p.entry } : {}), home: p.home, ...(p.idleMs !== undefined ? { idleMs: p.idleMs } : {}) });
  if (p.preferPort !== null && Number.isInteger(p.preferPort) && p.preferPort > 0 && p.preferPort < 65536) args.push('--prefer-port', String(p.preferPort));
  return args;
}

/** The successor plan for THIS process: entry = argv[1] unless it is a SEA. */
export function successorPlanOf(home: string, preferPort: number | null, idleMs?: number, argv1: string | undefined = process.argv[1]): SuccessorPlan {
  const isSea = argv1 === undefined || path.resolve(process.execPath) === path.resolve(argv1);
  return { execPath: process.execPath, ...(isSea ? {} : { entry: argv1 }), home, preferPort, ...(idleMs !== undefined ? { idleMs } : {}) };
}

/** Spawn the detached successor; returns its pid (null when the spawn failed: the next client activation starts one). */
export function spawnSuccessor(p: SuccessorPlan, sourceEnv: Readonly<Record<string, string | undefined>> = process.env): number | null {
  try {
    const child = spawn(p.execPath, successorArgs(p), { detached: true, stdio: 'ignore', env: cleanReexecEnv(sourceEnv), windowsHide: true });
    child.on('error', () => undefined);
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}
