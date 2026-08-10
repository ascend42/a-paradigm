/**
 * #hook — the auto-seal git hook. Installs a guarded block in the repo's
 * post-commit hook so every git commit also seals a #strand into the fabric —
 * the project's native history accrues automatically, in lockstep with git.
 *
 * COEXISTENCE: the block is delimited by BEGIN/END markers and APPENDED to any
 * existing post-commit hook (e.g. Paradigm's history capture) — never clobbered.
 * Install is idempotent (re-install replaces the block in place). The block seals
 * `--ref HEAD` (the just-committed tree, NOT the worktree — so it captures exactly
 * what was committed and never conflates another agent's uncommitted work), and is
 * fully fail-safe: `|| true` means a Warpline error never fails the commit.
 *
 * ATTRIBUTION (dogfood): when `WARPLINE_AGENT_ID` is exported in the committing
 * environment (e.g. a per-agent worktree), the block forwards it as `--agent` so the
 * auto-sealed strand records authoredBy.agentId instead of hashing null. This is
 * UNSIGNED self-assertion — attribution DATA for the multi-agent dogfood, not
 * authenticated identity (M3 signatures close that gap). The CLI also reads the env
 * directly, so forwarding here is belt-and-suspenders / explicit intent.
 *
 * ═══ THE SILENT-SKIP DEFECT, AND WHY THE FIX IS SPLIT FOREGROUND/BACKGROUND ═══
 *
 * The block used to end in `>/dev/null 2>&1 || true` inside a `&` subshell. That is
 * THREE independent mutes stacked on one line: the output is discarded, the failure
 * is swallowed, and the whole thing is detached from the commit's exit status. So
 * when `warpline` was not on PATH and the monorepo `dist/cli.js` fallback did not
 * resolve either — the DEFAULT after a plain local `npm i`, and reproduced in a
 * scratch repo — `warpline hook install` printed success, `git commit` exited 0, no
 * `.warpline/` was ever created, and `warpline status` then reported "clean", exit 0.
 * Every surface agreed that nothing was wrong while the entire point of the hook
 * (history accrues in lockstep with git) was silently not happening.
 *
 * The property worth keeping is narrow and real: A COMMIT MUST NEVER BE BLOCKED OR
 * FAILED BY WARPLINE. A full-repo absorb is ~41 s, so the seal stays backgrounded.
 * But BINARY RESOLUTION is one `command -v` — microseconds — so it moves into the
 * FOREGROUND, where an unresolvable binary prints exactly one line to stderr and the
 * operator finds out at the moment the seal did not happen. Cheap check foreground,
 * expensive work backgrounded.
 *
 * And the backgrounded work now writes to `<git-dir>/warpline-hook.log` instead of
 * `/dev/null`: a background seal that fails for any OTHER reason (lock timeout, CAS
 * refusal, ENOSPC) leaves evidence. The log is bounded from both ends — `installHook`
 * truncates it to a tail (`LOG_KEEP_BYTES`) on every install, and the block itself
 * resets it in place once it passes `LOG_CAP_BYTES` — so an append-per-commit file
 * inside `.git` cannot grow without limit.
 *
 * Library code: no console output — the CLI prints.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const BEGIN = '# >>> warpline auto-seal >>>';
const END = '# <<< warpline auto-seal <<<';

/** Runtime ceiling: past this the block resets the log in place (see LOG_KEEP_BYTES). */
const LOG_CAP_BYTES = 1_048_576;
/** Install-time bound: `hook install` keeps at most this much of the log's tail. */
const LOG_KEEP_BYTES = 65_536;

/**
 * Where the backgrounded seal's output lands: `<git-dir>/warpline-hook.log`, i.e.
 * the parent of the hooks directory. Inside the git dir deliberately — never in the
 * worktree, which `core.hooksPath` can point at and which git would then show as an
 * untracked file after every commit.
 *
 * The BLOCK resolves the same path at runtime via `git rev-parse --absolute-git-dir`,
 * which is authoritative; this derivation from `hookPath` agrees with it for the
 * standard `<git-dir>/hooks/post-commit` layout. Under a `core.hooksPath` pointing
 * somewhere else the two can diverge, and the only consequence is that install-time
 * truncation targets a file that is not there (a no-op) — the runtime cap inside the
 * block still bounds the real log.
 */
export function hookLogPath(hookPath: string): string {
  return path.join(path.dirname(path.dirname(hookPath)), 'warpline-hook.log');
}

/**
 * Bound the log on install: keep the last `LOG_KEEP_BYTES` and say how much was
 * dropped. Rewrites in place rather than renaming so a concurrently-appending
 * background seal keeps its (O_APPEND) fd pointed at the live inode.
 *
 * Never throws: the log is a diagnostic, and failing `hook install` because a
 * diagnostic file could not be shortened would be the same class of bug this whole
 * change is about, pointed the other way.
 */
function truncateHookLog(logPath: string): void {
  let size: number;
  try {
    size = fs.statSync(logPath).size;
  } catch {
    return; // no log yet — nothing to bound
  }
  if (size <= LOG_KEEP_BYTES) return;
  try {
    const fd = fs.openSync(logPath, 'r');
    const buf = Buffer.alloc(LOG_KEEP_BYTES);
    try {
      fs.readSync(fd, buf, 0, LOG_KEEP_BYTES, size - LOG_KEEP_BYTES);
    } finally {
      fs.closeSync(fd);
    }
    fs.writeFileSync(
      logPath,
      `warpline: log truncated by \`hook install\` — ${size - LOG_KEEP_BYTES} earlier bytes dropped\n${buf.toString('utf8')}`,
      'utf8',
    );
  } catch {
    /* diagnostic-only — an install must not fail over it */
  }
}

/**
 * The shell block appended to post-commit. Resolves `warpline` on PATH, else a local
 * monorepo build; REPORTS (foreground, stderr) when neither resolves; otherwise seals
 * HEAD in the background — never blocking or failing the commit.
 */
function block(): string {
  return [
    BEGIN,
    '# Seal each git commit into the Warpline fabric (this project\'s native history).',
    '# Managed by `warpline hook install`. The SEAL runs in the BACKGROUND (a full-repo',
    '# absorb is slow) so it never delays, blocks, or fails the commit. The binary',
    '# RESOLUTION check is FOREGROUND: an unresolvable binary used to mean the commit',
    '# was silently never sealed while `warpline status` still reported "clean".',
    'WARPLINE_BIN="${WARPLINE_BIN:-warpline}"',
    '_wl_gitdir="$(git rev-parse --absolute-git-dir 2>/dev/null || git rev-parse --git-dir 2>/dev/null)"',
    '_wl_log="${_wl_gitdir:-.}/warpline-hook.log"',
    '_wl_found=no',
    'if command -v "$WARPLINE_BIN" >/dev/null 2>&1; then',
    '  _wl_found=yes',
    'else',
    '  _wl_root="$(git rev-parse --show-toplevel 2>/dev/null)"',
    '  if [ -n "$_wl_root" ] && [ -f "$_wl_root/packages/warpline/dist/cli.js" ]; then',
    '    WARPLINE_BIN="node $_wl_root/packages/warpline/dist/cli.js"',
    '    _wl_found=yes',
    '  fi',
    'fi',
    'if [ "$_wl_found" = no ]; then',
    // The one line the old block could not print. Stderr, foreground, non-fatal.
    '  echo "warpline: auto-seal SKIPPED — cannot resolve \\"$WARPLINE_BIN\\" (not on PATH, and no packages/warpline/dist/cli.js fallback). This commit was NOT sealed into the fabric; \'warpline status\' will still say clean. Install warpline (or export WARPLINE_BIN=/path/to/warpline) and re-run \'warpline hook install\'." >&2',
    'else',
    // Runtime ceiling — the log is appended to on every commit, so it needs a bound
    // that does not depend on anyone re-running `hook install`. Reset in place (not
    // renamed) so a concurrent background appender is not writing to a stale inode.
    `  if [ -f "$_wl_log" ] && [ "$(wc -c <"$_wl_log" 2>/dev/null || echo 0)" -gt ${LOG_CAP_BYTES} ]; then`,
    `    echo "warpline: log exceeded ${LOG_CAP_BYTES} bytes — reset $(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$_wl_log"`,
    '  fi',
    // Forward WARPLINE_AGENT_ID as --agent when set (per-agent worktree ⇒ attributed
    // seal); ${VAR:+…} expands to nothing when unset, so the anonymous case is unchanged.
    // Output goes to the LOG, not /dev/null: a backgrounded failure must leave evidence.
    '  ( { echo "--- $(date -u +%Y-%m-%dT%H:%M:%SZ) post-commit $(git rev-parse --short HEAD 2>/dev/null)"',
    '      $WARPLINE_BIN pick --ref HEAD --quiet ${WARPLINE_AGENT_ID:+--agent "$WARPLINE_AGENT_ID"}',
    '      echo "    exit=$?"',
    '    } >>"$_wl_log" 2>&1 || true ) &',
    'fi',
    END,
  ].join('\n');
}

export type HookState = 'installed' | 'absent' | 'other-hook-no-warpline';

export interface HookStatus {
  hookPath: string;
  state: HookState;
  hasOtherContent: boolean;
}

function readHook(hookPath: string): string | null {
  try {
    return fs.readFileSync(hookPath, 'utf8');
  } catch {
    return null;
  }
}

/** Strip an existing warpline block (between markers, inclusive) from hook text. */
function stripBlock(text: string): string {
  const begin = text.indexOf(BEGIN);
  if (begin === -1) return text;
  const end = text.indexOf(END);
  if (end === -1) return text; // malformed — leave it for the human
  const after = end + END.length;
  // also swallow one trailing newline the block owned
  const tail = text.slice(after).replace(/^\n/, '');
  return (text.slice(0, begin).replace(/\n+$/, '\n') + tail).replace(/\n{3,}/g, '\n\n');
}

export function hookStatus(hookPath: string): HookStatus {
  const text = readHook(hookPath);
  if (text === null) return { hookPath, state: 'absent', hasOtherContent: false };
  const installed = text.includes(BEGIN);
  const otherContent = stripBlock(text).replace(/^#!.*\n/, '').trim().length > 0;
  return {
    hookPath,
    state: installed ? 'installed' : otherContent ? 'other-hook-no-warpline' : 'absent',
    hasOtherContent: otherContent,
  };
}

/**
 * Install (or refresh) the warpline auto-seal block. Idempotent.
 *
 * Also bounds `<git-dir>/warpline-hook.log` — the block appends to it on every
 * commit, so the one moment we are certainly running is the right moment to cap it.
 */
export function installHook(hookPath: string): { created: boolean; refreshed: boolean } {
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  truncateHookLog(hookLogPath(hookPath));
  const existing = readHook(hookPath);
  if (existing === null) {
    fs.writeFileSync(hookPath, `#!/bin/sh\n${block()}\n`, 'utf8');
    fs.chmodSync(hookPath, 0o755);
    return { created: true, refreshed: false };
  }
  const hadBlock = existing.includes(BEGIN);
  const base = stripBlock(existing).replace(/\n+$/, '\n');
  const withShebang = base.startsWith('#!') ? base : `#!/bin/sh\n${base}`;
  fs.writeFileSync(hookPath, `${withShebang.replace(/\n+$/, '\n')}\n${block()}\n`, 'utf8');
  fs.chmodSync(hookPath, 0o755);
  return { created: false, refreshed: hadBlock };
}

/** Remove the warpline block; leaves any other hook content intact. */
export function uninstallHook(hookPath: string): { removed: boolean } {
  const existing = readHook(hookPath);
  if (existing === null || !existing.includes(BEGIN)) return { removed: false };
  const stripped = stripBlock(existing).replace(/\n+$/, '\n');
  // If nothing but a shebang remains, drop the hook file entirely.
  if (stripped.replace(/^#!.*\n/, '').trim().length === 0) {
    fs.rmSync(hookPath, { force: true });
  } else {
    fs.writeFileSync(hookPath, stripped, 'utf8');
    fs.chmodSync(hookPath, 0o755);
  }
  return { removed: true };
}
