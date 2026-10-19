/**
 * @symbol #session-runner
 *
 * `gnomon session repin-claude [--home <abs>] [--claude <abs>]` (spec §3.3
 * trust-on-first-use pin; Aegis H1/N1, M1.7 round 3). The native installer
 * auto-updates `~/.local/bin/claude`, after which every open is refused
 * `claude_binary_changed` until a human re-pins. Until presence lands (M1.3)
 * the human is proved like `gnomon log quarantine`: an interactive terminal
 * and a typed confirmation (the last 8 characters of the NEW sha256). There
 * is no --yes. Refused while the daemon runs (so no session is live): the
 * daemon pre-stages a re-pin card instead (TD-2026-10-19-063), approved in the
 * Gnomon window with one Touch ID; this verb stays the OFFLINE raw form. The
 * re-pin record carries {from, to, logged:false}; the supervisor writes the
 * kernel-signed `session.sandbox{phase:'binary-pin', by:'repin', from, to}`
 * row at the next open (the CLI holds no kernel key).
 */
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { Readable } from 'node:stream';
import { resolveGnomonHome } from '../kernel/lifecycle/home.js';
import { daemonState } from '../kernel/lifecycle/pidfile.js';
import { readClaudePin, repinClaudeBinary, sha256File, binaryKind, REPIN_COMMAND } from '../kernel/runner/binary.js';
import { resolveClaudeBinary, PreflightRefusal } from '../kernel/runner/preflight.js';
import { claudeCodePlatform } from '../platform/claude-code.js';
import * as os from 'node:os';

type Out = { write(s: string): unknown };
export interface SessionCliIo {
  stdin: Readable & { isTTY?: boolean };
  stdout: Out & { isTTY?: boolean };
  stderr: Out;
}

export const SESSION_EXIT_OK = 0;
export const SESSION_EXIT_REFUSED = 1;
export const SESSION_EXIT_USAGE = 64;

export const SESSION_USAGE = `usage: ${REPIN_COMMAND} [--home <abs>] [--claude <abs path>]
  Pins the claude binary's current sha256 as the one Gnomon sessions may run
  (trust on first use, spec §3.3). Use it after Claude Code updated itself.
  Refused while the daemon runs. Until presence lands (M1.3) the human is
  proved only by an interactive terminal and a typed confirmation. No --yes.
`;

function refused(err: Out, why: string, next: string): void {
  err.write(`gnomon session: refused — ${why}\n  next: ${next}\n`);
}

function ask(io: SessionCliIo, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: io.stdin, terminal: false });
    io.stdout.write(prompt);
    let done = false;
    rl.once('line', (l) => {
      done = true;
      rl.close();
      resolve(l.trim());
    });
    rl.once('close', () => {
      if (!done) resolve('');
    });
  });
}

export async function runSessionCommand(argv: readonly string[], io: SessionCliIo, opts: { platform?: string; userHome?: string } = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== 'repin-claude') {
    io.stdout.write(SESSION_USAGE);
    return sub === '--help' || sub === '-h' ? SESSION_EXIT_OK : SESSION_EXIT_USAGE;
  }
  let home: string | undefined;
  let claude: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    const v = rest[i + 1];
    if ((a === '--home' || a === '--claude') && v && path.isAbsolute(v)) {
      if (a === '--home') home = v;
      else claude = v;
      i++;
    } else {
      refused(io.stderr, `unknown or malformed argument ${a}${a === '--yes' ? ' (there is no --yes: the confirmation is the human gate)' : ''}`, `${REPIN_COMMAND} --help`);
      return SESSION_EXIT_USAGE;
    }
  }
  home = path.resolve(home ?? resolveGnomonHome());
  if (!io.stdin.isTTY || !io.stdout.isTTY) {
    refused(io.stderr, 'a re-pin needs a human at an interactive terminal (presence lands at M1.3)', `run it yourself in a terminal: ${REPIN_COMMAND}`);
    return SESSION_EXIT_REFUSED;
  }
  if (daemonState(home).state === 'running') {
    // TD-2026-10-19-063: with a daemon running the re-pin is the card it pre-staged (one Touch ID); this is the offline form
    refused(io.stderr, 'the daemon is running: it pre-staged a re-pin card', 'approve the re-pin card in the Gnomon window');
    return SESSION_EXIT_REFUSED;
  }
  const row = claudeCodePlatform(opts.platform ?? process.platform);
  if (!row) {
    refused(io.stderr, 'no Claude Code platform row for this OS', 'none');
    return SESSION_EXIT_REFUSED;
  }
  let real: string;
  try {
    real = resolveClaudeBinary({ ...(claude ? { explicit: claude } : {}), row, home: opts.userHome ?? os.homedir() }).real;
  } catch (e) {
    refused(io.stderr, e instanceof PreflightRefusal ? e.message : String(e), `${REPIN_COMMAND} --claude <abs path>`);
    return SESSION_EXIT_REFUSED;
  }
  const sha = await sha256File(real);
  const prev = readClaudePin(home);
  io.stdout.write(`re-pin claude\n  source  ${real}\n  kind    ${binaryKind(real)}\n  from    ${prev?.sha256 ?? '(none)'}\n  to      ${sha}\n  gate    interactive confirmation only — no proof of presence (M1.3)\n`);
  if (prev?.sha256 === sha) {
    io.stdout.write('  already pinned: nothing to do\n');
    return SESSION_EXIT_OK;
  }
  const typed = await ask(io, '  type the last 8 characters of the NEW sha256 to confirm: ');
  if (typed !== sha.slice(-8)) {
    refused(io.stderr, 'the confirmation did not match; nothing was pinned', `re-run ${REPIN_COMMAND} and type the last 8 characters shown after "to"`);
    return SESSION_EXIT_REFUSED;
  }
  repinClaudeBinary(home, sha, real);
  io.stdout.write(`  pinned ${sha} (logged as session.sandbox{binary-pin, by:'repin'} at the next session open)\n`);
  return SESSION_EXIT_OK;
}
