/**
 * @symbol #paradigm-mcp
 *
 * TD-2026-10-27-833: the mode the Gnomon kernel sets when it runs this server from its STAGED, hashed copy for a
 * LOCAL model session (`PARADIGM_GNOMON_STAGED=1`). In that mode the server starts nothing beyond its own tools:
 *   - no Conductor auto-registration (it runs `ps`/`osascript` and writes the global dir at start);
 *   - no plugin update check (it shells out and reaches the network).
 * Its global dir is wherever HOME points (the kernel points it at an empty, per-session, kernel-owned dir), and git
 * runs with the hardening the kernel puts in the env (GIT_CONFIG_*: no fsmonitor, no hooks path). Paradigm loads no
 * `.paradigm/` file as code in any mode (habits, protocols, loops and config are data; loop checks run only in the
 * Gnomon kernel after a human trusts the exact content hash).
 */
import * as os from 'os';
import * as path from 'path';

export const GNOMON_STAGED_ENV = 'PARADIGM_GNOMON_STAGED';

export function gnomonStaged(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[GNOMON_STAGED_ENV] === '1';
}

export const GNOMON_STAGED_REFUSAL = 'not available when Paradigm runs staged for a Gnomon local session';

/**
 * Aegis M2: the families that reach the network or run other processes (personas run agents, symphony and platform
 * talk to relays and the platform UI, conductor registers with a local app, brain reads the personal vault, sentinel
 * runs its own server). In the staged mode they are not listed, carry no annotations and refuse every call, also by a
 * legacy per-op name.
 */
export const STAGED_REFUSED_FAMILIES: readonly string[] = Object.freeze(['paradigm_persona', 'paradigm_symphony', 'paradigm_platform', 'paradigm_conductor', 'paradigm_brain', 'paradigm_sentinel']);

/**
 * Aegis H2: where per-project session trails live (breadcrumbs, the session work log, postflight liveness, verdicts).
 * In the staged Gnomon mode they go under HOME (the kernel's per-session dir), never into the repo's `.paradigm/`: a
 * local model's tool trail must not replay into a later Claude session's recover.
 */
export function breadcrumbBase(rootDir: string): string {
  return gnomonStaged() ? path.join(os.homedir(), 'staged-project') : rootDir;
}
