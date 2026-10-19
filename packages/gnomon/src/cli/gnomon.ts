#!/usr/bin/env node
/**
 * gnomon — the CLI. PR-5 implements `gnomon daemon status|stop|--detach`
 * ($daemon-lifecycle, spec §2.4); T-2026-10-17-009(a) adds `gnomon log
 * quarantine` (#kernel-log, log-cli.ts); M1.12 adds `gnomon replay` (replay-cli.ts);
 * #dev-launch adds `gnomon dev init|up` (dev-cli.ts, DEV ONLY until M1.3);
 * M1.3 slice 1 adds `gnomon identity init|status` (identity-cli.ts);
 * #gnomon-up adds `gnomon up` (up-cli.ts: the kernel on the provisioned home);
 * every other verb is still the placeholder.
 */
import { gnomondEntryFrom, runDaemonCommand } from './daemon-cli.js';
import { runDevCommand } from './dev-cli.js';
import { runIdentityCommand } from './identity-cli.js';
import { runLogCommand } from './log-cli.js';
import { runPlaceholderBin } from './placeholder.js';
import { runReplayCommand } from './replay-cli.js';
import { runRulesCommand } from './rules-cli.js';
import { runSessionCommand } from './session-cli.js';
import { runUpCommand } from './up-cli.js';

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
} else if (argv[0] === 'rules') {
  // gui-complete item 2: `gnomon rules list|revoke` (standing always-allow rules, rules-cli.ts)
  runRulesCommand(argv.slice(1), { stdout: process.stdout, stderr: process.stderr }).then(
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
} else if (argv[0] === 'dev') {
  // #dev-launch: `gnomon dev init|up` — DEV ONLY, unsigned dogfood path until M1.3 (dev-cli.ts)
  runDevCommand(argv.slice(1), { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`gnomon: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 70;
    },
  );
} else if (argv[0] === 'up') {
  // #gnomon-up: the kernel in-process on the PROVISIONED home (hardware identity) + the GUI launch URL (up-cli.ts)
  runUpCommand(argv.slice(1), { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`gnomon: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 70;
    },
  );
} else if (argv[0] === 'identity') {
  // M1.3 slice 1: `gnomon identity init | status` (#identity, identity-cli.ts) — provisions the hardware root
  runIdentityCommand(argv.slice(1), { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`gnomon: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 70;
    },
  );
} else if (argv[0] === 'replay') {
  // M1.12 slice 3: `gnomon replay [<home>] [--expect <hash>]` (#kernel-log, replay-cli.ts, G-KRN-01)
  runReplayCommand(argv.slice(1), { stdout: process.stdout, stderr: process.stderr }).then(
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
