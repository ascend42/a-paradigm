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
 *   - a kernel already running (Gnomon.app, another `gnomon up`, gnomond):
 *     no second one starts. On an interactive terminal bare `gnomon` asks it
 *     for a launch grant over the P8-D98 human-device verb `gui.open`
 *     (requestRunningLaunch in up-cli.ts; T-2026-10-19-001 A3) with this
 *     folder as `cwdHint`, and prints/opens that URL with the same fragment
 *     hint. Not a terminal: nothing on stdout, no RPC (the TTY check comes
 *     BEFORE the call, rule 7), and the `already-running` refusal (exit 3).
 * Also `gnomon help | --help | -h` (GNOMON_HELP). Zero deps (G-SEC-01).
 */
import { sanitizeDisplayText } from '@a-company/gnomon-contracts';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GNOMON_VERSION } from '../version.js';
import { displayPath, needsEscape, DISPLAY_CAP } from '../kernel/folders/display-path.js';
export { DISPLAY_CAP };
import { readout, refused } from './readout.js';
import type { LaunchTtyIo } from './launch-tty.js';
import { requestRunningLaunch, runUp, upOpener, UpRefusal, type KernelCall, type UpDeps } from './up-cli.js';
import { defaultBuildStampPath, readBuildStamp, readKernelBuild, sameBuild, type BuildStamp } from '../kernel/lifecycle/build-stamp.js';
import { presentUrl } from './open-browser.js';
import { isDevHome } from './dev-home.js';
import { runGuiSetup, runSetup, type GuiSetupDeps } from './setup-cli.js';
import { resolveGnomonHome } from '../kernel/lifecycle/index.js';
import { hasIdentityFile } from '../kernel/identity/index.js';

export const BARE_EXIT_ALREADY_RUNNING = 3;
export const BARE_EXIT_USAGE = 64;
/** A path longer than this (UTF-8 bytes; macOS PATH_MAX) is not carried as a hint. */
export const HINT_MAX_BYTES = 1024;
/* DISPLAY_CAP (code points, for a folder path in a terminal line) lives in kernel/folders/display-path.ts. */

export const GNOMON_HELP = `gnomon ${GNOMON_VERSION} — supervise Claude Code sessions with signed, attended approvals
usage: gnomon [<command>] [options]     (every command takes --help)

  gnomon             in a repo: start the kernel and open the GUI in your default browser with this folder suggested
                     for a new session (the URL is printed too; --no-open or GNOMON_NO_OPEN=1: print it only)
                     (the first time, on a terminal, it sets this Mac up first: same as \`gnomon setup\`)
  setup              guided first run: checks, your name, two Touch ID prompts, then start
  up                 start the kernel on your provisioned home (~/.gnomon) and open the GUI in your browser
  identity           init | status: provision or inspect the hardware identity (Secure Enclave, Touch ID)
  session            repin-claude: re-pin the claude binary after Claude Code updates itself
  rules              list | revoke: standing always-allow rules
  local              set | status | remove: the local model (loopback only; you allow it with the root key)
  mod                stage mod changes as cards for approval (never signs)
  desk               stats: offers shown and kept per mod (the Desk)
  replay             replay the hash-chained log and check its head
  trace              read-only audit timeline of a session (log + transcript; contains prompt text);
                     on | off | status | path: record a folder's sessions (kept in ~/.gnomon/trace/)
  log                log maintenance (quarantine)
  daemon             status | stop | --detach: the background kernel (gnomond)
  dev                init | up: the DEV ONLY unsigned launch path on a separate dev home
  guide              how-to topics compiled into this binary (spawn, claims, cards, refusals)
  help               this listing        --version  the version

first run: \`gnomon\` in a repo (it runs \`gnomon setup\` the first time); scripted: gnomon identity init
`;

/** The ONE prefill/escape rule lives in kernel/folders/display-path.ts (shared with the folder verbs). */
export { displayPath, needsEscape };

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
  setup?: GuiSetupDeps;
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

/**
 * TD-2026-10-19-063: the kernel running on `home` loaded another build than the one on disk (kernel-build.json vs
 * dist/build-id.json). No record, no stamp or the same build ⇒ false (never a claimed mismatch on doubt).
 */
export function launcherSeesUpdate(home: string, onDisk: BuildStamp | null = readBuildStamp(defaultBuildStampPath())): boolean {
  const k = readKernelBuild(home);
  return !!k?.stamp && !!onDisk && !sameBuild(k.stamp, onDisk);
}

/** Live sessions in a `status` result (sessions.n, else the list length); null when it cannot tell. */
export function liveSessionsOf(status: unknown): number | null {
  const s = (status as { sessions?: { n?: unknown; sessions?: unknown } } | null)?.sessions;
  if (typeof s?.n === 'number') return s.n;
  return Array.isArray(s?.sessions) ? s.sessions.length : null;
}

/**
 * TD-2026-10-19-063: a stale kernel with 0 live sessions gets the upgrade card (daemon.stop{reason:'upgrade'}: the
 * kernel's own card if #update-watch already raised it — one card, never a second prompt). Never stops anything
 * by itself: the human accepts in the window with Touch ID. Any refusal only skips the card.
 */
export async function raiseUpgradeIfIdle(call: KernelCall): Promise<'raised' | 'busy' | 'skipped'> {
  const st = await call('status', {}).catch(() => null);
  if (!st || !('result' in st)) return 'skipped';
  if (liveSessionsOf(st.result) !== 0) return 'busy';
  const r = await call('daemon.stop', { reason: 'upgrade' }).catch(() => null);
  return r && 'result' in r ? 'raised' : 'skipped';
}

export async function runBareCommand(argv: readonly string[], io: LaunchTtyIo, deps: BareDeps = {}): Promise<number> {
  // spec §2.4 rule 10: on a terminal the launch (and setup) URL opens in the default browser; --no-open prints it only
  const noOpen = argv.length === 1 && argv[0] === '--no-open';
  if (argv.length > (noOpen ? 1 : 0)) {
    io.stderr.write(`gnomon: unknown arguments (${argv.length}) for bare gnomon\n${GNOMON_HELP}`);
    return BARE_EXIT_USAGE;
  }
  // #first-run (spec §2.4 rule 9): on an interactive terminal, an unprovisioned default home is set up first,
  // then this same process continues into up with the folder hint. Not a TTY: up's own refusal, unchanged.
  const tty = deps.setup?.isTty ?? (io.stdin.isTTY === true && io.stdout.isTTY === true);
  if (tty && unprovisionedDefaultHome(deps.userHome)) {
    const sd = { ...deps, ...deps.setup, ...(noOpen ? { noOpen } : {}) } as GuiSetupDeps;
    const s = sd.surface === 'cli' ? await runSetup(io, sd) : await runGuiSetup(io, sd, 'tty', hintSuffix(folderOf(deps.cwd ?? process.cwd()).folder) ?? '');
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
    noOpen,
    rows: [['folder', `${shown}  (${where}${note}; a suggestion: the GUI asks before opening)`]],
    ...(suffix !== null ? { urlSuffix: suffix } : {}),
    onRunning: async (e: UpRefusal, home: string) => {
      const pid = /\bpid (\d+)/.exec(e.message);
      const which = instanceOf(pid ? Number(pid[1]) : undefined);
      const alreadyRunning = (why: string, extra: readonly string[] = []): number => {
        refused(io.stderr, 'gnomon', 'already-running', `Gnomon is already running on ${displayPath(home)}: ${which}; bare gnomon does not start a second kernel${why}`, [
          `open a session for this folder in that window: "+ new" (Cmd-N), cwd: ${shown}`,
          'or stop that instance (quit Gnomon.app, or Ctrl-C in its terminal) and run `gnomon` here again',
          ...extra,
        ]);
        return BARE_EXIT_ALREADY_RUNNING;
      };
      // rule 7's TTY check BEFORE the call: with nothing to show a URL on, no grant is asked for and nothing is printed
      if (io.stdout.isTTY !== true) return alreadyRunning('', ['run `gnomon` in an interactive terminal to open this folder in it (gnomon open: the URL is shown only on a terminal)']);
      let g;
      try {
        // the folder rides as cwdHint only when it fits the fragment (HINT_MAX_BYTES, the same cap gui.open applies)
        const stale = launcherSeesUpdate(home);
        g = await requestRunningLaunch(home, suffix !== null ? folder : undefined, {
          ...(stale
            ? {
                beforeOpen: async (call) => {
                  if ((await raiseUpgradeIfIdle(call)) === 'raised') io.stdout.write('UPDATE    Gnomon was updated: approve "Restart now" in the window (one Touch ID); your sessions come back after the restart\n');
                },
              }
            : {}),
        });
      } catch (x) {
        if (x instanceof UpRefusal) return alreadyRunning(`, and it did not hand this terminal a launch URL (${sanitizeDisplayText(x.reason).text}: ${sanitizeDisplayText(x.message).text})`, x.next);
        throw x;
      }
      io.stdout.write(`ATTACHED  gnomon (to the running kernel: ${which})\n`);
      readout(io.stdout, [['home', home], ['folder', `${shown}  (${where}${note}; a suggestion: the GUI asks before opening)`]]);
      // Aegis L4: the fragment is built from THIS process's already-capped folder, never the kernel's echoed cwdHint
      const hint = suffix ?? '';
      await presentUrl(io.stdout, `${g.url}${hint}`, upOpener(deps, { noOpen }), 'open this in your browser within 60 s (single use)');
      return 0;
    },
  });
}
