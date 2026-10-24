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
 *
 * `gnomon session rename <hsid> <name> [--home <abs>] [--json]` (8.0:session-rename): the raw form of the GUI's
 * inline rename. Asks the RUNNING daemon as this home's human device (the `gnomon mode` connection: the server key
 * pinned from the home, never from the server) with `log.append{kind:'request.session.rename', payload:{hsid, name}}`.
 * An empty name ('') resets the session to its derived title. The kernel normalises the name (contracts
 * normalizeSessionName) and refuses a control character or a name over 80 characters; its refusals print as they come.
 */
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { Readable } from 'node:stream';
import { resolveGnomonHome } from '../kernel/lifecycle/home.js';
import { daemonState } from '../kernel/lifecycle/pidfile.js';
import { readClaudePin, repinClaudeBinary, sha256File, binaryKind, REPIN_COMMAND } from '../kernel/runner/binary.js';
import { resolveClaudeBinary, PreflightRefusal } from '../kernel/runner/preflight.js';
import { claudeCodePlatform } from '../platform/claude-code.js';
import { CLAUDE_EXPECTED_PUBLISHER, CLAUDE_EXPECTED_TEAM, claudeVerifierFor, type PlatformClaudeVerifier, type ClaudeSignature } from '../platform/claude-verifier.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { RefusedError, refusalOf, SESSION_NAME_MAX } from '@a-company/gnomon-contracts';
import { selectSocketPath } from '../kernel/lifecycle/index.js';
import { connectGnomon, ServerAuthError } from '../kernel/socket/index.js';
import { kernelPinOf } from './daemon-cli.js';
import { humanDeviceOf } from './rules-cli.js';
import { GNOMON_VERSION } from '../version.js';
import { heading, readout, refused as refusedReadout } from './readout.js';

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

usage: gnomon session rename [--home <abs>] [--json] <hsid> [--] <name>
  Names a session you opened (the GUI shows it instead of the first message).
  At most ${SESSION_NAME_MAX} characters; "" resets it to the derived title. Needs the
  daemon running. A name is display text only: nothing routes by it.
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

export async function runSessionCommand(argv: readonly string[], io: SessionCliIo, opts: { platform?: string; userHome?: string; verifier?: PlatformClaudeVerifier } = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === 'rename') return runSessionRename(rest, io);
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
  // TD-2026-10-19-063 L5: the same publisher check as the re-pin card, on a private copy (the bytes hashed are the bytes checked)
  const verifier = opts.verifier ?? claudeVerifierFor(opts.platform ?? process.platform);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true, mode: 0o700 });
  const tmp = path.join(home, 'bin', `.claude-cli-${process.pid}-${Date.now()}`);
  fs.copyFileSync(real, tmp, fs.constants.COPYFILE_EXCL);
  let sha: string;
  let kind: string;
  let sig: ClaudeSignature;
  try {
    sha = await sha256File(tmp);
    kind = binaryKind(tmp);
    sig = verifier.check(tmp);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  const prev = readClaudePin(home);
  const mismatch = !sig.verified || sig.team !== CLAUDE_EXPECTED_TEAM || (prev?.signer?.team != null && prev.signer.team !== sig.team);
  const signer = mismatch
    ? `NOT signed by the expected publisher (${CLAUDE_EXPECTED_PUBLISHER}, ${CLAUDE_EXPECTED_TEAM}): ${sig.team ? `team ${sig.team}${sig.verified ? '' : ', signature did not verify'}` : 'no signature that verifies'}`
    : `${CLAUDE_EXPECTED_PUBLISHER} (${sig.team})`;
  io.stdout.write(`re-pin claude\n  source  ${real}\n  kind    ${kind}\n  signer  ${signer}\n  from    ${prev?.sha256 ?? '(none)'}\n  to      ${sha}\n  gate    interactive confirmation only — no proof of presence (M1.3)\n`);
  if (prev?.sha256 === sha) {
    io.stdout.write('  already pinned: nothing to do\n');
    return SESSION_EXIT_OK;
  }
  const typed = await ask(io, '  type the last 8 characters of the NEW sha256 to confirm: ');
  if (typed !== sha.slice(-8)) {
    refused(io.stderr, 'the confirmation did not match; nothing was pinned', `re-run ${REPIN_COMMAND} and type the last 8 characters shown after "to"`);
    return SESSION_EXIT_REFUSED;
  }
  repinClaudeBinary(home, sha, real, { signer: { team: sig.team, verified: sig.verified } });
  io.stdout.write(`  pinned ${sha} (logged as session.sandbox{binary-pin, by:'repin'} at the next session open)\n`);
  return SESSION_EXIT_OK;
}

/** `gnomon session rename <hsid> <name> [--home <abs>] [--json]` (see the header). */
export async function runSessionRename(argv: readonly string[], io: { stdout: Out; stderr: Out }): Promise<number> {
  const pos: string[] = [];
  let home: string | undefined;
  let json = false;
  const usage = (msg: string): number => {
    refusedReadout(io.stderr, 'BAD_REQUEST', 'usage', msg, ['gnomon session --help']);
    return SESSION_EXIT_USAGE;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') json = true;
    else if (a === '--home') {
      const h = argv[++i];
      if (h === undefined || !path.isAbsolute(h)) return usage('--home takes an absolute path');
      home = h;
    } else if (a === '--') {
      pos.push(...argv.slice(i + 1)); // a name that starts with '-'
      break;
    } else if (a.startsWith('--')) return usage(`unknown argument ${a}`);
    else pos.push(a);
  }
  if (pos.length !== 2) return usage('give the session id (hsid) and the name (quote it; "" resets it)');
  const [hsid, name] = pos as [string, string];
  home = path.resolve(home ?? resolveGnomonHome());
  const sock = selectSocketPath({ home });
  if (!sock.ok) {
    refusedReadout(io.stderr, 'ENGINE', 'no-endpoint', `no safe endpoint path for ${home}`, []);
    return SESSION_EXIT_REFUSED;
  }
  const device = humanDeviceOf(home);
  if (typeof device === 'string') {
    refusedReadout(io.stderr, 'FORBIDDEN', 'no-human-device', device, ['gnomon setup']);
    return SESSION_EXIT_REFUSED;
  }
  const client = { name: 'gnomon', version: GNOMON_VERSION, surface: 'cli' as const };
  try {
    const probe = await connectGnomon({ socketPath: sock.path, client });
    await probe.conn.close();
    const found = kernelPinOf(home, probe.hello.serverKeyId);
    if (!found) {
      refusedReadout(io.stderr, 'FORBIDDEN', 'unverified-server', 'the key this server names is not registered in the home: nothing was sent to it', ['gnomon daemon status']);
      return SESSION_EXIT_REFUSED;
    }
    const s = await connectGnomon({ socketPath: sock.path, client, serverKey: found.pin, device });
    try {
      const r = await s.conn.call('log.append', { kind: 'request.session.rename', payload: { hsid, name } });
      if ('error' in r) {
        const data = refusalOf(r);
        refusedReadout(io.stderr, data?.code ?? 'ENGINE', String(data?.data?.reason ?? 'refused'), r.error.message, data?.code === 'NOT_FOUND' ? ['the hsid of a session you opened (the GUI: hover the session title)'] : []);
        return SESSION_EXIT_REFUSED;
      }
      const res = (r.result ?? {}) as { hsid?: unknown; name?: unknown; changed?: unknown };
      if (json) {
        io.stdout.write(`${JSON.stringify(res)}\n`);
        return SESSION_EXIT_OK;
      }
      heading(io.stdout, 'renamed', typeof res.name === 'string' ? `${hsid}: ${res.name}` : `${hsid}: back to the derived title`);
      readout(io.stdout, [['logged', 'request.session.rename, session.renamed (kernel-signed)'], ['changed', res.changed === true ? 'yes' : 'no (it already had that name)']]);
      return SESSION_EXIT_OK;
    } finally {
      await s.conn.close();
    }
  } catch (err) {
    if (err instanceof RefusedError || err instanceof ServerAuthError) {
      refusedReadout(io.stderr, err instanceof RefusedError ? err.refusal.code : 'FORBIDDEN', err instanceof RefusedError ? String(err.refusal.data?.reason ?? 'refused') : 'server-auth', err.message, []);
      return SESSION_EXIT_REFUSED;
    }
    refusedReadout(io.stderr, 'ENGINE', 'not-running', `no daemon answers on ${home}: ${(err as Error).message}`, ['gnomond --home <abs> (or gnomon up), then retry']);
    return SESSION_EXIT_REFUSED;
  }
}
