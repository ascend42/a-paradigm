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
 * Library code: no console output — the CLI prints.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const BEGIN = '# >>> warpline auto-seal >>>';
const END = '# <<< warpline auto-seal <<<';

/** The shell block appended to post-commit. Resolves `warpline` on PATH, else a
 * local monorepo build, then seals HEAD — never blocking or failing the commit. */
function block(): string {
  return [
    BEGIN,
    '# Seal each git commit into the Warpline fabric (this project\'s native history).',
    '# Managed by `warpline hook install`. Runs in the BACKGROUND (a full-repo absorb',
    '# is slow) so it never delays, blocks, or fails the commit.',
    'WARPLINE_BIN="${WARPLINE_BIN:-warpline}"',
    'if ! command -v "$WARPLINE_BIN" >/dev/null 2>&1; then',
    '  _wl_root="$(git rev-parse --show-toplevel 2>/dev/null)"',
    '  if [ -n "$_wl_root" ] && [ -f "$_wl_root/packages/warpline/dist/cli.js" ]; then',
    '    WARPLINE_BIN="node $_wl_root/packages/warpline/dist/cli.js"',
    '  fi',
    'fi',
    '( $WARPLINE_BIN pick --ref HEAD --quiet >/dev/null 2>&1 || true ) &',
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

/** Install (or refresh) the warpline auto-seal block. Idempotent. */
export function installHook(hookPath: string): { created: boolean; refreshed: boolean } {
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
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
