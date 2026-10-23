#!/usr/bin/env -S node --disable-sigusr1
/**
 * gnomon — the CLI. PR-5 implements `gnomon daemon status|stop|--detach`
 * ($daemon-lifecycle, spec §2.4); T-2026-10-17-009(a) adds `gnomon log
 * quarantine` (#kernel-log, log-cli.ts); M1.12 adds `gnomon replay` (replay-cli.ts);
 * #dev-launch adds `gnomon dev init|up` (dev-cli.ts, DEV ONLY until M1.3);
 * M1.3 slice 1 adds `gnomon identity init|status` (identity-cli.ts);
 * #gnomon-up adds `gnomon up` (up-cli.ts: the kernel on the provisioned home);
 * #bare-entry adds bare `gnomon` (bare-cli.ts: up + a folder hint) and `gnomon help`;
 * #gnomon-guide adds `gnomon guide [<topic>]` (guide-cli.ts: compiled-in, pull-only how-to text).
 */
import { BARE_EXIT_USAGE, GNOMON_HELP, runBareCommand } from './bare-cli.js';
import { gnomondEntryFrom, runDaemonCommand } from './daemon-cli.js';
import { runDevCommand } from './dev-cli.js';
import { runGuideCommand } from './guide-cli.js';
import { runIdentityCommand } from './identity-cli.js';
import { runLogCommand } from './log-cli.js';
import { runModCommand } from './mod-cli.js';
import { runPlaceholderBin } from './placeholder.js';
import { runReplayCommand } from './replay-cli.js';
import { runDeskCommand } from './desk-cli.js';
import { runTraceCommand } from './trace-cli.js';
import { runRulesCommand } from './rules-cli.js';
import { runModeCommand } from './mode-cli.js';
import { runStrictnessCommand } from './strictness-cli.js';
import { runLoopCommand } from './loop-cli.js';
import { runLocalCommand } from './local-cli.js';
import { runVoiceCommand } from './voice-cli.js';
import { runSessionCommand } from './session-cli.js';
import { runSetupCommand } from './setup-cli.js';
import { runUp, runUpCommand } from './up-cli.js';
import { openGuiAfterStart } from './relaunch.js';

const argv = process.argv.slice(2);
if (argv[0] === 'daemon') {
  // #gui-relaunch: `daemon start | --detach` opens the GUI after a fresh start (--no-open / GNOMON_NO_OPEN: off)
  runDaemonCommand(argv.slice(1), gnomondEntryFrom(import.meta.url), openGuiAfterStart()).then(
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
} else if (argv[0] === 'voice') {
  // voice slice V1 (#gnomon-voice): `gnomon voice setup | enrol | forget` (root-signed, voice-cli.ts)
  runVoiceCommand(argv.slice(1), { stdout: process.stdout, stderr: process.stderr }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`gnomon: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 70;
    },
  );
} else if (argv[0] === 'mode') {
  // P8-D87: `gnomon mode [manual|ask|auto-edits] [--session <hsid>] [--repo]` (run modes, mode-cli.ts)
  runModeCommand(argv.slice(1), { stdout: process.stdout, stderr: process.stderr }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`gnomon: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 70;
    },
  );
} else if (argv[0] === 'strictness') {
  // M2.11-lite (#strictness-cli): `gnomon strictness show [<repo>]` | `gnomon strictness set <repo> <L0-L3>` (strictness-cli.ts)
  runStrictnessCommand(argv.slice(1), { stdout: process.stdout, stderr: process.stderr }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`gnomon: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 70;
    },
  );
} else if (argv[0] === 'local') {
  // TD-2026-10-22-769 (#local-config-request): `gnomon local set|status|remove` (local-cli.ts; Settings → Local model is the guided form)
  runLocalCommand(argv.slice(1), { stdout: process.stdout, stderr: process.stderr }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`gnomon: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 70;
    },
  );
} else if (argv[0] === 'loop') {
  // 8.0:loops (#loop-registry, #loop-runner): `gnomon loop list|show|trust|untrust|trust-status|run|pause [--all]|resume|runs|logs` (loop-cli.ts)
  runLoopCommand(argv.slice(1), { stdout: process.stdout, stderr: process.stderr }).then(
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
} else if (argv[0] === 'setup') {
  // #first-run: the guided first run (setup-cli.ts), then the normal launch in this process
  const io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };
  runSetupCommand(argv.slice(1), io, { continueUp: ({ noOpen }) => runUp(io, {}, { noOpen }) }).then(
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
} else if (argv[0] === 'mod') {
  // M1.11 slice 3: `gnomon mod …` (#mod-cli, mod-cli.ts) — stages cards, never signs
  runModCommand(argv.slice(1), { stdout: process.stdout, stderr: process.stderr }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`gnomon: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 70;
    },
  );
} else if (argv[0] === 'desk') {
  // TD-2026-10-20-812: `gnomon desk stats` — kept/shown per mod from the verified log (#offer-router, desk-cli.ts)
  runDeskCommand(argv.slice(1), { stdout: process.stdout, stderr: process.stderr }).then(
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
} else if (argv[0] === 'trace') {
  // #gnomon-trace: `gnomon trace` read-only audit timeline; `trace on|off|status` per-project trace mode (trace-cli.ts)
  runTraceCommand(argv.slice(1), { stdout: process.stdout, stderr: process.stderr }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`gnomon: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 70;
    },
  );
} else if (argv[0] === 'guide') {
  // #gnomon-guide: `gnomon guide [<topic>]` — topics compiled into this binary, never read from disk (guide-cli.ts)
  process.exitCode = runGuideCommand(argv.slice(1), { stdout: process.stdout, stderr: process.stderr });
} else if (argv.length === 0 || argv[0] === '--no-open') {
  // #bare-entry: bare `gnomon` in a folder = `gnomon up` with this folder as a GUI hint (bare-cli.ts); `--no-open` = print the URL only
  runBareCommand(argv, { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`gnomon: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 70;
    },
  );
} else if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
  process.stdout.write(GNOMON_HELP);
} else if (argv[0] === '--version' || argv[0] === '-v') {
  process.exitCode = runPlaceholderBin('gnomon', argv);
} else {
  process.stderr.write(`gnomon: unknown command (${argv[0]!.length} chars)\n${GNOMON_HELP}`);
  process.exitCode = BARE_EXIT_USAGE;
}
