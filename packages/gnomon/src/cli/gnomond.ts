#!/usr/bin/env -S node --disable-sigusr1
/**
 * gnomond — the per-user kernel daemon ($daemon-lifecycle, spec §2.4).
 * `--foreground` runs in this process; otherwise it re-execs itself detached
 * with the clean env (client activation) and exits once the kernel's ready
 * line arrives on the inherited pipe (§2.4 rule 2). Exit codes: exit-codes.ts.
 */
import { GNOMON_VERSION } from '../version.js';
import { DAEMON_EXIT } from '../kernel/lifecycle/exit-codes.js';
import { activateDetached, daemonHomeOf, daemonUsage, EXIT_OK, parseDaemonArgs, runForeground } from './daemon-cli.js';

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`gnomond ${GNOMON_VERSION}\n`);
    return EXIT_OK;
  }
  const parsed = parseDaemonArgs(argv);
  if (typeof parsed === 'string') return daemonUsage(parsed);
  return parsed.foreground ? runForeground(parsed) : activateDetached(parsed, process.argv[1] ?? process.execPath, daemonHomeOf); // gnomond never reads GNOMON_HOME
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`gnomond: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = DAEMON_EXIT.internal; // classified: restart with backoff (exit-codes.ts)
  },
);
