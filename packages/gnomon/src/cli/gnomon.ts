#!/usr/bin/env node
/**
 * gnomon — the CLI. PR-5 implements `gnomon daemon status|stop|--detach`
 * ($daemon-lifecycle, spec §2.4); T-2026-10-17-009(a) adds `gnomon log
 * quarantine` (#kernel-log, log-cli.ts); every other verb is still the placeholder.
 */
import { gnomondEntryFrom, runDaemonCommand } from './daemon-cli.js';
import { runLogCommand } from './log-cli.js';
import { runPlaceholderBin } from './placeholder.js';
import { runSessionCommand } from './session-cli.js';

const argv = process.argv.slice(2);
if (argv[0] === 'daemon') {
  runDaemonCommand(argv.slice(1), gnomondEntryFrom(import.meta.url)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`gnomon: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 70;
    },
  );
} else if (argv[0] === 'log') {
  runLogCommand(argv.slice(1), { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`gnomon: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 70;
    },
  );
} else if (argv[0] === 'session') {
  // M1.7 round 3: `gnomon session repin-claude` (attended re-pin of the claude binary, session-cli.ts)
  runSessionCommand(argv.slice(1), { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`gnomon: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 70;
    },
  );
} else {
  process.exitCode = runPlaceholderBin('gnomon', argv);
}
