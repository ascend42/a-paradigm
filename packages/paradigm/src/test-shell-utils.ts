/**
 * Test helpers for running the shell hooks the way Claude Code does on each OS.
 *
 * Claude Code runs plugin hooks with bash; on Windows that is Git Bash. Tests that drive the hook scripts
 * spawn BASH (or SH) from here, put only SYS_PATH (plus their own stub dirs) on PATH, and embed paths into
 * scripts with shellPath(). On Windows, PARADIGM_TEST_BASH overrides the Git Bash location.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const WIN = process.platform === 'win32';

/** Git Bash on Windows (what Claude Code uses for hooks), bash elsewhere. */
export const BASH = WIN ? process.env.PARADIGM_TEST_BASH || 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';

/** The hooks' `#!/bin/sh`: Git Bash on Windows (it runs them in sh mode by shebang), sh elsewhere. */
export const SH = WIN ? BASH : 'sh';

const GIT_ROOT = WIN ? path.dirname(path.dirname(BASH)) : '';
const SYSTEM_ROOT = WIN ? process.env.SystemRoot || 'C:\\Windows' : '';

/**
 * The system tools a hook needs (grep, sed, awk, git, cat...) and nothing Paradigm-related: no node, npx or
 * paradigm. POSIX: /usr/bin and /bin. Windows: Git's usr\bin and cmd (git.exe) plus System32.
 */
export const SYS_PATH: string[] = WIN
  ? [path.join(GIT_ROOT, 'usr', 'bin'), path.join(GIT_ROOT, 'cmd'), path.join(SYSTEM_ROOT, 'System32'), SYSTEM_ROOT]
  : ['/usr/bin', '/bin'];

/** Environment a Windows child needs to start at all (cmd.exe, node and Git Bash read these). Empty elsewhere. */
export function baseEnv(): Record<string, string> {
  if (!WIN) return {};
  const out: Record<string, string> = {};
  for (const k of ['SystemRoot', 'windir', 'ComSpec', 'PATHEXT', 'SystemDrive', 'ProgramData', 'ProgramFiles']) {
    const v = process.env[k];
    if (v) out[k] = v;
  }
  return out;
}

/** A PATH value from directories, with the platform's delimiter. */
export const pathValue = (dirs: string[]): string => dirs.join(path.delimiter);

/** A path to embed in a shell script: forward slashes on Windows (Git Bash reads C:/x), unchanged elsewhere. */
export const shellPath = (p: string): string => (WIN ? p.replace(/\\/g, '/') : p);

/** The real, long path (no 8.3 names such as RUNNER~1 on Windows runners). */
export const realPath = (p: string): string => fs.realpathSync.native(p);

/** A fresh temp dir by its real, long path. */
export const tempDir = (prefix: string): string => realPath(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

/**
 * A directory holding only `node`, so PATH gains nothing else. POSIX: a symlink to this node. Windows: a
 * Git Bash wrapper script (symlinks need a privilege there).
 */
export function nodeOnlyDir(cleanups: Array<() => void>): string {
  const d = tempDir('paradigm-node-');
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  if (WIN) {
    fs.writeFileSync(path.join(d, 'node'), `#!/bin/sh\nexec "${shellPath(process.execPath)}" "$@"\n`, { mode: 0o755 });
  } else {
    fs.symlinkSync(process.execPath, path.join(d, 'node'));
  }
  return d;
}

/**
 * Shell lines a `paradigm` stub starts with to answer `paradigm internal learn-path <artifact> --root <root>`
 * (scoped learning S2) the way the real CLI does in a git repository: overrides in the repo home, every other
 * store as `<stateDir>/<artifact>.jsonl` (pass the test's machine-home events dir). Any other call falls through.
 */
export const learnPathStubLines = (stateDir: string): string =>
  'if [ "$1" = internal ] && [ "$2" = learn-path ]; then\n' +
  `  case "$3" in overrides) printf '%s/.paradigm/events/overrides.jsonl\\n' "$5" ;; *) printf '%s/%s.jsonl\\n' '${shellPath(stateDir)}' "$3" ;; esac\n` +
  '  exit 0\n' +
  'fi\n';

/** A temp dir holding a `paradigm` stub that answers only `internal learn-path` (see learnPathStubLines). */
export function learnPathStubBin(stateDir: string): string {
  const d = tempDir('paradigm-learn-stub-');
  fs.writeFileSync(path.join(d, 'paradigm'), `#!/bin/sh\n${learnPathStubLines(stateDir)}exit 0\n`, { mode: 0o755 });
  return d;
}

/** Per-test timeout: process start-up through cmd.exe / Git Bash is slow on Windows runners. */
export const SHELL_TEST_TIMEOUT = WIN ? 180_000 : 30_000;

/** An MSYS-style path for colon-separated shell lists (CDPATH): /c/Users/x on Windows, unchanged elsewhere. */
export const msysPath = (p: string): string =>
  WIN ? p.replace(/^([A-Za-z]):[\\/]/, (_m, d: string) => `/${d.toLowerCase()}/`).replace(/\\/g, '/') : p;
