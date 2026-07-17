/**
 * #warpline-config — the per-repo engine toggles, `.warpline/config.json`.
 *
 * NATIVE-FIRST R1 (.paradigm/research/warpline-native-first/roadmap-native-first.md;
 * loid-loops.md §1): config carries OPT-IN switches only — the engine's defaults
 * never change because a config file exists. Keys:
 *
 *   - `shadowGate` (default false): when true, every #pick (including the
 *     post-commit auto-seal #hook path) ALSO records an observe-only #shadow-gate
 *     admit verdict of the sealed state vs the current selvage. Rows land in
 *     `.warpline/shadow/verdicts.jsonl`; nothing about the seal path changes.
 *   - `stake` (default: valve OFF): the checkpoint valve (#stake, Phase 1,
 *     T-2026-07-17-001). `enabled:true` + a per-ref allowlist `refs` are BOTH
 *     required before `warpline stake` will cut a checkpoint commit (S4).
 *     NOTE: the leakage deny-list is NOT here and never will be — it is a
 *     constitution-grade frozen constant (stake-guard.ts, D5); a denylist that
 *     can drift by configuration is not a denylist.
 *
 * Read posture: a MISSING config is the empty config (defaults). A config that
 * exists but cannot be parsed THROWS — a corrupt toggle file must not silently
 * read as "everything off". Callers on the seal path (pick.ts) catch, because
 * shadow telemetry must never break a seal; interactive callers surface it.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** The checkpoint valve toggle (#stake, S4) — every field opt-in. */
export interface StakeConfig {
  /** master switch — the valve is OFF unless this is literally true. */
  enabled?: boolean;
  /** per-ref allowlist of stakeable NATIVE refs (e.g. ["selvage"]). No list = nothing stakeable. */
  refs?: string[];
  /** the DEDICATED stake branch in the git repo (default "warpline-stakes"; working-branch names refused). */
  branch?: string;
  /** path of the git repo receiving stakes, relative to the root (default: the root repo itself). */
  repo?: string;
  /** commit AUTHOR ident "Name <email>" (default: the machine committer). Committer is always Warpline Stake. */
  author?: string;
}

export interface WarplineConfig {
  /** R1 shadow gate: record observe-only admit verdicts on every pick (default false). */
  shadowGate?: boolean;
  /** the checkpoint valve (default OFF — see StakeConfig). */
  stake?: StakeConfig;
}

/** `.warpline/config.json` for a repo root. */
export function configPathOf(root: string): string {
  return path.join(root, '.warpline', 'config.json');
}

/** Read the repo config. ENOENT ⇒ {} (all defaults); malformed JSON ⇒ throw. */
export function readWarplineConfig(root: string): WarplineConfig {
  const p = configPathOf(root);
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`warpline: config unreadable at ${p}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `warpline: config malformed at ${p} — refusing to read a corrupt toggle file as defaults: ${(err as Error).message}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`warpline: config at ${p} must be a JSON object`);
  }
  return parsed as WarplineConfig;
}
