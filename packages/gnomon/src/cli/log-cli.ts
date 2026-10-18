/**
 * @symbol #kernel-log
 *
 * `gnomon log quarantine [--home <abs>]` (spec §19.1 release gate (a), §A.6;
 * T-2026-10-17-009(a)) — the human-run recovery for a log that refuses to
 * open: moves the whole home aside intact as evidence and starts a new log
 * whose genesis row names the quarantined log id and head
 * (kernel/log/quarantine.ts).
 *
 * HUMAN GATE (residual until M1.3): presence has not landed, so the command
 * demands an interactive terminal (stdin and stdout TTYs) and the typed last
 * 8 characters of the quarantined log id. A TTY proves no presence: any
 * same-user process that owns a terminal can pass it. It is recorded in the
 * genesis row as `authorizedBy: 'interactive-confirm'`; M1.3 replaces it with
 * a PresenceToken. There is no --yes flag on purpose.
 */
import * as net from 'node:net';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { Readable } from 'node:stream';
import { daemonState, resolveGnomonHome, selectSocketPath } from '../kernel/lifecycle/index.js';
import { UNPROVISIONED_NS } from '../kernel/identity/index.js';
import { LogRefusal, quarantineLog, readQuarantineIdentity, SoftwareEd25519Signer } from '../kernel/log/index.js';
import { GNOMON_VERSION } from '../version.js';
import { heading, readout, refused, type Out } from './readout.js';

export const LOG_EXIT_OK = 0;
export const LOG_EXIT_REFUSED = 1;
export const LOG_EXIT_USAGE = 64;

export interface LogCliIo {
  stdin: Readable & { isTTY?: boolean };
  stdout: Out & { isTTY?: boolean };
  stderr: Out;
}

export const LOG_USAGE = `usage: gnomon log quarantine [--home <abs>]

  Moves the whole Gnomon home aside, intact, to <home>.quarantine-<stamp>
  (evidence; nothing is changed or deleted) and starts a NEW log whose genesis
  row is a kernel-signed daemon.log.quarantined naming the quarantined log id
  and head. Refused while the daemon is running. Never an in-place downgrade.

  Until presence lands (M1.3) the human is proved only by an interactive
  terminal and a typed confirmation: any same-user process that owns a
  terminal can pass that gate. There is no --yes.
`;

function canConnect(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect(socketPath);
    c.once('connect', () => {
      c.destroy();
      resolve(true);
    });
    c.once('error', () => resolve(false));
  });
}

function ask(io: LogCliIo, prompt: string): Promise<string> {
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

/** `gnomon log …` */
export async function runLogCommand(argv: readonly string[], io: LogCliIo): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === '--help' || sub === '-h' || sub === undefined) {
    io.stdout.write(`gnomon ${GNOMON_VERSION}\n${LOG_USAGE}`);
    return sub === undefined ? LOG_EXIT_USAGE : LOG_EXIT_OK;
  }
  if (sub !== 'quarantine') {
    refused(io.stderr, 'BAD_REQUEST', 'usage', `unknown log subcommand ${sub}`, ['gnomon log --help']);
    return LOG_EXIT_USAGE;
  }
  let home: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--home') {
      const v = rest[++i];
      if (!v || !path.isAbsolute(v)) {
        refused(io.stderr, 'BAD_REQUEST', 'usage', '--home needs an absolute path', ['gnomon log --help']);
        return LOG_EXIT_USAGE;
      }
      home = v;
    } else if (a === '--help' || a === '-h') {
      io.stdout.write(LOG_USAGE);
      return LOG_EXIT_OK;
    } else {
      refused(io.stderr, 'BAD_REQUEST', 'usage', `unknown argument ${a}${a === '--yes' || a === '-y' ? ' (there is no --yes: the confirmation is the human gate)' : ''}`, ['gnomon log --help']);
      return LOG_EXIT_USAGE;
    }
  }
  home = path.resolve(home ?? resolveGnomonHome());

  if (!io.stdin.isTTY || !io.stdout.isTTY) {
    refused(io.stderr, 'FORBIDDEN', 'not-interactive', 'quarantine needs a human at an interactive terminal (presence lands at M1.3)', ['run it yourself in a terminal: gnomon log quarantine']);
    return LOG_EXIT_REFUSED;
  }
  const sock = selectSocketPath({ home });
  const socketPath = sock.ok ? sock.path : undefined;
  const st = daemonState(home, socketPath);
  if (st.state === 'running' || (socketPath && (await canConnect(socketPath)))) {
    refused(io.stderr, 'FORBIDDEN', 'daemon-running', `the daemon is running${st.state === 'running' ? ` (pid ${st.pidfile.pid})` : ''}; the home cannot be moved under it`, [
      'wait for the daemon to idle out, then re-run',
      'gnomon daemon status',
    ]);
    return LOG_EXIT_REFUSED;
  }
  const id = readQuarantineIdentity(home);
  if (!id) {
    refused(io.stderr, 'BAD_REQUEST', 'nothing-to-quarantine', `no kernel log in ${home}`);
    return LOG_EXIT_REFUSED;
  }
  const code = id.log.slice(-8);
  heading(io.stdout, 'quarantine', 'the whole home moves aside as evidence; a new log starts');
  readout(io.stdout, [
    ['home', home],
    ['log', id.log],
    ['head', `seq ${id.head.seq}  segment ${id.head.segment}  ${id.head.hash}  (${id.source})`],
    ['evidence', `${home}.quarantine-<stamp>`],
    ['gate', 'interactive confirmation (presence lands at M1.3)'],
  ]);
  const typed = await ask(io, `  type the last 8 characters of the log id (${'•'.repeat(8)}) to confirm: `);
  if (typed !== code) {
    refused(io.stderr, 'FORBIDDEN', 'not-confirmed', 'the confirmation did not match; nothing was moved', ['re-run and type the last 8 characters of the log id shown above']);
    return LOG_EXIT_REFUSED;
  }
  try {
    const signer = SoftwareEd25519Signer.generate('kernel');
    const r = await quarantineLog({ home, signer, kernelPrincipal: `p:${UNPROVISIONED_NS}/kernel`, authorizedBy: 'interactive-confirm', ...(socketPath ? { socketPath } : {}) });
    heading(io.stdout, 'quarantined', r.quarantined.log);
    readout(io.stdout, [
      ['evidence', r.evidencePath],
      ['new log', r.newLogId],
      ['genesis', `seq ${r.genesis.seq}  daemon.log.quarantined  ${r.genesis.hash}`],
      ...(r.abandoned.length ? ([['abandoned', r.abandoned.join(', ')]] as const) : []),
    ]);
    return LOG_EXIT_OK;
  } catch (err) {
    if (err instanceof LogRefusal) {
      refused(io.stderr, err.refusal.code, err.reason, err.message.replace(/^#kernel-log: /, ''));
      return LOG_EXIT_REFUSED;
    }
    throw err;
  }
}
