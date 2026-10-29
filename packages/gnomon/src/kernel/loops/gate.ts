/**
 * @symbol #loops-gate
 *
 * #loops-gate (TD-2026-10-24-447; docs/specs/gnomon-loops.md §11 "Release gate", G-LOOP-29) - the ONE boot-time
 * switch that decides whether loops exist in this kernel. Resolved once in daemon.ts before wireLoops():
 *
 *   - a release build (the compiled `__GNOMON_RELEASE__` define, via release-pins.ts loadedReleasePins) is OFF, always;
 *   - a dev build is ON unless `GNOMON_LOOPS=0`;
 *   - `GNOMON_LOOPS=1` turns loops on ONLY when the release define is absent. It is never a back door in a signed build.
 *
 * The gate is never read from a user file or the log. Off means wireLoops() returns a stub that constructs nothing
 * (no registry, runner, timers, watchers, idle holder) and refuses every loop ask with LOOPS_DISABLED_REASON.
 */
import { loadedReleasePins } from '../lifecycle/release-pins.js';

export const LOOPS_DISABLED_REASON = 'loops-disabled';
export const LOOPS_DISABLED_MESSAGE = 'Loops are off in this release while they are finished.';
export const LOOPS_DISABLED_STATUS_REASON = 'not-in-this-build';

/** Env lookup that ignores the case of the NAME (Windows env names are case-insensitive). */
function envValue(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  for (const k of Object.keys(env)) if (k.toUpperCase() === name) return env[k];
  return undefined;
}

export interface LoopsGateInput {
  /** the compiled release define is present (default: this bundle's own) */
  release?: boolean;
  env?: Readonly<Record<string, string | undefined>>;
}

/** Are loops enabled in this process? Pure given its inputs; the daemon calls it once at boot. */
export function resolveLoopsEnabled(i: LoopsGateInput = {}): boolean {
  const release = i.release ?? loadedReleasePins().mode !== 'dev';
  if (release) return false;
  const v = envValue(i.env ?? process.env, 'GNOMON_LOOPS')?.trim();
  return v !== '0';
}
