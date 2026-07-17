/**
 * #warpline-config — the per-repo engine toggles, `.warpline/config.json`.
 *
 * NATIVE-FIRST R1 (.paradigm/research/warpline-native-first/roadmap-native-first.md;
 * loid-loops.md §1): config carries OPT-IN switches only — the engine's defaults
 * never change because a config file exists. v1 carries exactly one key:
 *
 *   - `shadowGate` (default false): when true, every #pick (including the
 *     post-commit auto-seal #hook path) ALSO records an observe-only #shadow-gate
 *     admit verdict of the sealed state vs the current selvage. Rows land in
 *     `.warpline/shadow/verdicts.jsonl`; nothing about the seal path changes.
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

export interface WarplineConfig {
  /** R1 shadow gate: record observe-only admit verdicts on every pick (default false). */
  shadowGate?: boolean;
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
