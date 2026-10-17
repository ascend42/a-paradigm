#!/usr/bin/env node
/**
 * gnomon — the CLI. PR-5 implements `gnomon daemon status|stop|--detach`
 * ($daemon-lifecycle, spec §2.4); every other verb is still the placeholder.
 */
import { gnomondEntryFrom, runDaemonCommand } from './daemon-cli.js';
import { runPlaceholderBin } from './placeholder.js';

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
} else {
  process.exitCode = runPlaceholderBin('gnomon', argv);
}
