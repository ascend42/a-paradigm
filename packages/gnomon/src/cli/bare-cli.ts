/**
 * @symbol #bare-entry
 *
 * Bare `gnomon` (#bare-entry, spec §2.4 rule 8): like `claude`, `cd` into a
 * repo and type `gnomon`. It is `gnomon up` (#gnomon-up: same guards, same
 * in-process kernel on the provisioned home, same TTY-only launch URL) plus a
 * FOLDER HINT: the git top of the cwd (or the cwd itself, said so) rides in
 * the launch URL FRAGMENT as `&cwd=<base64url(utf-8)>`, after the token, on
 * the same terminal line. The GUI opens its new-session form prefilled with
 * it and shows the full path as text; the human still clicks `open`.
 *
 * RULES (falsified in test/bare-entry.test.ts and the gnomon-gui tests):
 *   - the hint is an UNVERIFIED same-user claim: it never opens, approves or
 *     skips anything; session.open still runs only on a user gesture;
 *   - the token goes nowhere new: no argv, no env, no file, no extra stdout
 *     line; the wrapper channel never carries a hint;
 *   - a hostile path (quotes, newlines, control or bidi characters, invalid
 *     UTF-8 decoded to U+FFFD, very long) is ESCAPED and CAPPED for display
 *     here and in the GUI, and a path that needs escaping is never prefilled;
 *     over HINT_MAX_BYTES it is not carried at all;
 *   - a kernel already running (Gnomon.app, another `gnomon up`, gnomond) is
 *     NOT joined and no second one starts: `already-running` (exit 3) with
 *     which instance and how to open this folder in it. Reaching a running
 *     kernel to mint a URL needs a `gnomon open` wire verb, which moves
 *     clientApiId: queued with the batched bump (T-2026-10-19-001), not here.
 * Also `gnomon help | --help | -h` (GNOMON_HELP). Zero deps (G-SEC-01).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GNOMON_VERSION } from '../version.js';
import { refused } from './readout.js';
import type { LaunchTtyIo } from './launch-tty.js';
import { runUp, type UpDeps, type UpRefusal } from './up-cli.js';
import { isDevHome } from './dev-home.js';
import { runSetup, type SetupDeps } from './setup-cli.js';
import { resolveGnomonHome } from '../kernel/lifecycle/index.js';
import { hasIdentityFile } from '../kernel/identity/index.js';

export const BARE_EXIT_ALREADY_RUNNING = 3;
export const BARE_EXIT_USAGE = 64;
/** A path longer than this (UTF-8 bytes; macOS PATH_MAX) is not carried as a hint. */
export const HINT_MAX_BYTES = 1024;
/** Display cap, in code points, for a folder path in a terminal line. */
export const DISPLAY_CAP = 240;

export const GNOMON_HELP = `gnomon ${GNOMON_VERSION} — supervise Claude Code sessions with signed, attended approvals
usage: gnomon [<command>] [options]     (every command takes --help)

  gnomon             in a repo: start the kernel and open the GUI with this folder suggested for a new session
                     (the first time, on a terminal, it sets this Mac up first: same as \`gnomon setup\`)
  setup              guided first run: checks, your name, two Touch ID prompts, then start
  up                 start the kernel on your provisioned home (~/.gnomon) and print the GUI launch URL
  identity           init | status: provision or inspect the hardware identity (Secure Enclave, Touch ID)
  session            repin-claude: re-pin the claude binary after Claude Code updates itself
  rules              list | revoke: standing always-allow rules
  mod                stage mod changes as cards for approval (never signs)
  replay             replay the hash-chained log and check its head
  log                log maintenance (quarantine)
  daemon             status | stop | --detach: the background kernel (gnomond)
  dev                init | up: the DEV ONLY unsigned launch path on a separate dev home
  help               this listing        --version  the version

first run: \`gnomon\` in a repo (it runs \`gnomon setup\` the first time); scripted: gnomon identity init
`;

/**
 * The ONE prefill/escape rule (Aegis L3), identical in packages/gnomon-gui/src/core/launch.ts and checked by the
 * shared vectors test/fixtures/cwd-hint.v1.json: a code point is shown as itself only when it is a letter, number,
 * punctuation, symbol or a plain space, is not a format character (Cf) or default-ignorable (fillers, variation
 * selectors, tags), is not U+FFFD (invalid UTF-8) and is not a backslash; anything else is escaped as \\u{hex}.
 */
const SAFE_CP = /^[\p{L}\p{N}\p{P}\p{S} ]$/u;
const HIDDEN_CP = /[\p{Cf}\p{Default_Ignorable_Code_Point}\ufffd\\]/u;
const ESCAPE = { test: (c: string): boolean => !SAFE_CP.test(c) || HIDDEN_CP.test(c) };

/** Escape what a terminal or a page could interpret or hide, then cap. Pure; the same rule the GUI applies. */
export function displayPath(p: string, cap: number = DISPLAY_CAP): string {
  // Aegis round 3: checked and shown as q = NFC(p) (a decomposed name composes, an orphan or uncomposable mark
  // stays and is escaped); the code-point cap is counted on the ORIGINAL p; the prefill (GUI) is p byte for byte
  const n = [...p].length;
  const shown = [...p.normalize('NFC')].slice(0, Math.min(cap, n)).map((c) => (c === '\\' ? '\\\\' : ESCAPE.test(c) ? `\\u{${c.codePointAt(0)!.toString(16)}}` : c));
  return shown.join('') + (n > cap ? `… (+${n - cap} chars)` : '');
}

/** True when a path needs escaping to be shown (checked on NFC(p)): such a path is shown, never prefilled. */
export function needsEscape(p: string): boolean {
  return [...p.normalize('NFC')].some((c) => ESCAPE.test(c));
}

/** The folder a session would open in: the nearest ancestor holding `.git` (dir or file), else the cwd itself. */
export function folderOf(cwd: string): { folder: string; inGit: boolean } {
  let real: string;
  try {
    real = fs.realpathSync.native(cwd);
  } catch {
    real = path.resolve(cwd);
  }
  for (let d = real; ; ) {
    if (fs.existsSync(path.join(d, '.git'))) return { folder: d, inGit: true };
    const up = path.dirname(d);
    if (up === d) return { folder: real, inGit: false };
    d = up;
  }
}

/** The fragment-only suffix for a folder, or null when it is too long to carry. */
export function hintSuffix(folder: string): string | null {
  const b = Buffer.from(folder, 'utf8');
  if (b.length === 0 || b.length > HINT_MAX_BYTES) return null;
  return `&cwd=${b.toString('base64url')}`;
}

/** Which instance holds the home, from the pidfile pid (diagnostic only: the pidfile is same-user writable). */
export function instanceOf(pid: number | undefined): string {
  if (pid === undefined) return 'a kernel answering on its socket';
  let cmd = '';
  try {
    if (process.platform !== 'win32') cmd = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    cmd = '';
  }
  // classified, never echoed: another process's command line is not this CLI's to print
  const kind = /\bup\b.*--wrapper/.test(cmd) ? 'Gnomon.app' : /\bdev up\b/.test(cmd) ? '`gnomon dev up` in a terminal' : /\bup\b/.test(cmd) ? '`gnomon up` / `gnomon` in a terminal' : /gnomond/.test(cmd) ? 'gnomond' : 'a Gnomon kernel';
  return `${kind} (pid ${pid}, diagnostic only)`;
}

/** Test seams, programmatic only (gnomon.ts passes none). */
export interface BareDeps extends UpDeps {
  /** The working directory (default process.cwd()). */
  cwd?: string;
  /** #first-run test seams (helper path, fake helper, the TTY verdict). */
  setup?: SetupDeps;
}

/** ^unprovisioned-only: the default home is missing, or a plain non-dev directory with no identity.json at all. */
export function unprovisionedDefaultHome(userHome?: string): boolean {
  const home = resolveGnomonHome({ env: {}, homedir: userHome ?? os.userInfo().homedir });
  let st: fs.Stats;
  try {
    st = fs.lstatSync(home);
  } catch {
    return true;
  }
  if (!st.isDirectory() || isDevHome(home)) return false; // a symlink, a file or a dev home: up's refusal names it
  return !hasIdentityFile(home);
}

export async function runBareCommand(argv: readonly string[], io: LaunchTtyIo, deps: BareDeps = {}): Promise<number> {
  if (argv.length > 0) {
    io.stderr.write(`gnomon: unknown arguments (${argv.length}) for bare gnomon\n${GNOMON_HELP}`);
    return BARE_EXIT_USAGE;
  }
  // #first-run (spec §2.4 rule 9): on an interactive terminal, an unprovisioned default home is set up first,
  // then this same process continues into up with the folder hint. Not a TTY: up's own refusal, unchanged.
  const tty = deps.setup?.isTty ?? (io.stdin.isTTY === true && io.stdout.isTTY === true);
  if (tty && unprovisionedDefaultHome(deps.userHome)) {
    const s = await runSetup(io, { ...deps, ...deps.setup });
    if (s.code !== 0) return s.code; // "already set up" (another run won) also continues into up
    io.stdout.write('\nStarting Gnomon…\n');
  }
  const { folder, inGit } = folderOf(deps.cwd ?? process.cwd());
  const suffix = hintSuffix(folder);
  const shown = displayPath(folder);
  const where = inGit ? 'git top' : 'not in a git repo: the current directory';
  const note = suffix === null ? `; too long to carry (${Buffer.byteLength(folder)} bytes): type it in the GUI` : needsEscape(folder) ? '; shown escaped, so the GUI will not prefill it' : '';
  return runUp(io, deps, {
    code: 'gnomon',
    rows: [['folder', `${shown}  (${where}${note}; a suggestion: the GUI asks before opening)`]],
    ...(suffix !== null ? { urlSuffix: suffix } : {}),
    onRunning: (e: UpRefusal, home: string) => {
      const pid = /\bpid (\d+)/.exec(e.message);
      refused(io.stderr, 'gnomon', 'already-running', `Gnomon is already running on ${displayPath(home)}: ${instanceOf(pid ? Number(pid[1]) : undefined)}; bare gnomon does not start a second kernel`, [
        `open a session for this folder in that window: "+ new" (Cmd-N), cwd: ${shown}`,
        'or stop that instance (quit Gnomon.app, or Ctrl-C in its terminal) and run `gnomon` here again',
        'opening this folder in a running kernel from the terminal needs `gnomon open` (queued, T-2026-10-19-001)',
      ]);
      return BARE_EXIT_ALREADY_RUNNING;
    },
  });
}
