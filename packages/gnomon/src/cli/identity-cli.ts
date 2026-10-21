/**
 * @symbol #identity
 *
 * `gnomon identity init | status | purge-keys` (spec §3.1 I3 root-signed CLI
 * verbs; M1.3 slice 1). Writes to stdio directly: the kernel has zero deps
 * (G-SEC-01). Since T-2026-10-19-005 this file is a THIN RENDERER over the
 * #provisioner engine (kernel/identity/provisioner.ts), which owns every step
 * below; its output matches the pre-engine CLI except where a ruling corrected it (the digest line "must begin with", the rotate prompt names what rotate does). `gnomon setup`
 * (setup-cli.ts, #first-run) renders the same engine as a guided flow.
 *
 * `gnomon identity init [--home <abs>] [--helper <path>] [--name <n>] [--host <h>] [--rotate | --recover]`
 * provisions this Mac's REAL root, once:
 *   1. refused while the daemon runs and when keys/identity.json exists —
 *      unless `--rotate` (the OLD root, present in the Secure Enclave, signs
 *      a gnomon-root-rotate:v1 statement the helper requires before it
 *      creates the new generation; Aegis H4/H2) or `--recover` (the old root
 *      is LOST: a new namespace, logged as not signed by it), each on an
 *      interactive terminal with the typed word. The GNOMON_HSID refusal is
 *      hygiene, not a security control: presence is the boundary;
 *   2. pins the signed helper (fail closed) and asks it which Gnomon keys the
 *      Secure Enclave holds: any other generation refuses (purge-keys first);
 *   3. creates the root and approvals keys under a fresh generation (no prompt);
 *   4. two root signatures with presence (approvals binding, device row); the
 *      prompt text and stderr name the digest the helper's own line shows (H3);
 *   5. commits: old record moved aside (rotate/recover), identity.json
 *      written, THEN the registry row appended (R3), then the journal.
 *      A rotate re-issues only THIS device's registry row under the new
 *      root; every other row (other devices, agents) is dropped, and the old
 *      registry.jsonl is kept aside (registry.jsonl.rotated-<stamp>) as
 *      evidence — re-register other devices after a rotate.
 * A failure before identity.json is written restores the moved files (R2)
 * and deletes the keys it created — through the live helper, or a fresh one
 * that asks for presence (R4); after it, keys are never deleted. Ctrl-C stops
 * at the next step and cleans up the same way; a second Ctrl-C exits.
 * `gnomon identity purge-keys --gen <g>` deletes another generation's keys,
 * each with fresh presence. The dev/test root
 * (DevTestRootAuthority) is untouched: tests keep using it programmatically.
 *
 * HOME: the raw verbs keep honouring `--home` and GNOMON_HOME (operator
 * tools); `gnomon setup` is strict (never GNOMON_HOME, lstat, no symlink;
 * Aegis I4, spec §2.4 rule 9).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRINCIPAL_NAME_PATTERN } from '@a-company/gnomon-contracts';
import {
  identityPath,
  Provisioner,
  readIdentity,
  type HelperTransport,
  type HelperVerifier,
  type IdentityRecord,
  type PinnedHelper,
  type ProvisionEvent,
  type ProvisionOutcome,
} from '../kernel/identity/index.js';
import { daemonState, resolveGnomonHome } from '../kernel/lifecycle/index.js';
import { bundledHelperPath, helperPathFor } from '../kernel/lifecycle/app-bundle.js';

export const EXIT_OK = 0;
export const EXIT_REFUSED = 1;
export const EXIT_USAGE = 64;

export interface IdentityIo {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

/** Test seams (programmatic only): a dev verifier and a transport factory for a fake helper. */
export interface IdentityDeps {
  env?: Readonly<Record<string, string | undefined>>;
  verifier?: HelperVerifier;
  start?: (pin: PinnedHelper) => HelperTransport;
  once?: (pin: PinnedHelper) => (req: Record<string, unknown>) => Record<string, unknown>;
  /** the typed confirmation for --rotate / --recover (default: read a line from stdin on a TTY) */
  confirm?: () => Promise<string>;
  isTty?: boolean;
  /** after a successful rotate: the answer to "purge the old generation now?" (default: read a line on a TTY) */
  confirmPurge?: () => Promise<string>;
  /** install the SIGINT handler (default true; tests pass false and drive `interrupt`) */
  handleSignals?: boolean;
  /** tests: report an interrupt at the next step boundary */
  interrupt?: () => boolean;
  /** tests (I9): throw at the named provisioner step */
  fault?: (step: string) => void;
}

const HELPER_EXE_IN_APP = path.join('Contents', 'MacOS', 'gnomon-helper');

/**
 * The helper this kernel uses by default: inside a release Gnomon.app, the app's own Contents/Helpers/GnomonHelper.app
 * (#app-bundle, T-2026-10-21-029: bundle-relative, so a moved app still finds it); otherwise the helper next to this
 * package in the monorepo / install (packages/gnomon-helper/bin/darwin).
 */
export function defaultHelperPath(metaUrl: string = import.meta.url): string {
  const bundled = bundledHelperPath(fileURLToPath(metaUrl));
  if (bundled) return bundled;
  const dir = path.dirname(fileURLToPath(metaUrl));
  for (const up of ['../../..', '../../../..', '../..']) {
    const cand = path.resolve(dir, up, 'gnomon-helper', 'bin', 'darwin', 'GnomonHelper.app', HELPER_EXE_IN_APP);
    if (fs.existsSync(cand)) return cand;
    const nm = path.resolve(dir, up, 'node_modules', '@a-company', 'gnomon-helper', 'bin', 'darwin', 'GnomonHelper.app', HELPER_EXE_IN_APP);
    if (fs.existsSync(nm)) return nm;
  }
  return path.resolve(dir, '../../..', 'gnomon-helper', 'bin', 'darwin', 'GnomonHelper.app', HELPER_EXE_IN_APP);
}

export function sanitizeName(s: string): string {
  const n = s.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64);
  return PRINCIPAL_NAME_PATTERN.test(n) ? n : 'founder';
}

export function sanitizeHost(s: string): string {
  const h = s.replace(/\.local$/, '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 64);
  return h || 'mac';
}

interface InitArgs {
  home?: string;
  helper?: string;
  name?: string;
  host?: string;
  rotate: boolean;
  recover: boolean;
  gen?: string;
}

function parse(argv: readonly string[]): InitArgs | string {
  const out: InitArgs = { rotate: false, recover: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const v = (): string | undefined => argv[++i];
    if (a === '--rotate') out.rotate = true;
    else if (a === '--recover') out.recover = true;
    else if (a === '--gen') {
      const g = v();
      if (!g || !/^[a-z0-9]{4,32}$/.test(g)) return '--gen must match [a-z0-9]{4,32}';
      out.gen = g;
    }
    else if (a === '--home') {
      const h = v();
      if (!h || !path.isAbsolute(h)) return '--home needs an absolute path';
      out.home = h;
    } else if (a === '--helper') {
      const h = v();
      if (!h || !path.isAbsolute(h)) return '--helper needs an absolute path (the GnomonHelper.app or its executable)';
      out.helper = h.endsWith('.app') || h.endsWith('.app/') ? path.join(h, HELPER_EXE_IN_APP) : h;
    } else if (a === '--name') {
      const n = v();
      if (!n || !PRINCIPAL_NAME_PATTERN.test(n)) return '--name must match [a-z0-9][a-z0-9._-]{0,63}';
      out.name = n;
    } else if (a === '--host') {
      const n = v();
      if (!n || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(n)) return '--host must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}';
      out.host = n;
    } else return `unknown argument ${a}`;
  }
  return out;
}

function say(io: IdentityIo, obj: Record<string, unknown>): void {
  io.stdout.write(`${JSON.stringify(obj)}\n`);
}

function refused(io: IdentityIo, reason: string, message: string, extra: Record<string, unknown> = {}): number {
  io.stderr.write(`${JSON.stringify({ refused: true, reason, message, ...extra })}\n`);
  return EXIT_REFUSED;
}

function readLine(stdin: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    const onData = (d: Buffer | string): void => {
      buf += d.toString();
      const i = buf.indexOf('\n');
      if (i >= 0) {
        stdin.off('data', onData);
        stdin.pause?.();
        resolve(buf.slice(0, i).trim());
      }
    };
    stdin.on('data', onData);
    stdin.once('end', () => resolve(buf.trim()));
  });
}

const USAGE =
  'usage: gnomon identity init [--home <abs>] [--helper <abs>] [--name <n>] [--host <h>] [--rotate | --recover]\n' +
  '       gnomon identity purge-keys --gen <gen> [--home <abs>] [--helper <abs>]\n' +
  '       gnomon identity status [--home <abs>]\n';

/** The raw verbs' rendering of provisioner events: the exact stderr lines of the pre-engine CLI. */
function renderRaw(io: IdentityIo): (e: ProvisionEvent) => void {
  return (e) => {
    if (e.type === 'step' && e.step === 'logged' && e.detail) io.stderr.write(`${JSON.stringify(e.detail)}\n`);
    if (e.type !== 'presence') return;
    if (e.purpose === 'rotate-statement') io.stderr.write(`Touch ID: the OLD root signs the rotation (the prompt's last line must begin with "Gnomon Helper: root key signs 1: ${e.digest12}")\n`);
    else if (e.purpose === 'approvals-binding') io.stderr.write(`Touch ID 1/2: the root signs your approvals key (the prompt's last line must begin with "Gnomon Helper: root key signs 1: ${e.digest12}")\n`);
    else if (e.purpose === 'device-row') io.stderr.write(`Touch ID 2/2: the root signs this device (the prompt's last line must begin with "Gnomon Helper: root key signs 1: ${e.digest12}")\n`);
    else if (e.purpose === 'complete-device') io.stderr.write(`Touch ID: the root registers this device (the prompt's last line must begin with "Gnomon Helper: root key signs 1: ${e.digest12}")\n`);
    else if (e.purpose === 'purge-old') io.stderr.write(`Touch ID: delete the old ${e.key} key of generation ${e.gen}\n`);
    else if (e.purpose === 'purge') io.stderr.write(`Touch ID: delete the ${e.key} key of generation ${e.gen}\n`);
  };
}

function finish(io: IdentityIo, r: ProvisionOutcome): number {
  if (r.ok) {
    say(io, r.output);
    return EXIT_OK;
  }
  return refused(io, r.reason, r.message, r.extra);
}

export async function runIdentityCommand(argv: readonly string[], io: IdentityIo, deps: IdentityDeps = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === 'status') return identityStatus(rest, io);
  if (sub === 'purge-keys') return purgeKeys(rest, io, deps);
  if (sub !== 'init') {
    io.stderr.write(USAGE);
    return EXIT_USAGE;
  }
  const args = parse(rest);
  if (typeof args === 'string' || args.gen !== undefined || (args.rotate && args.recover)) {
    io.stderr.write(`gnomon identity: ${typeof args === 'string' ? args : 'init takes at most one of --rotate / --recover, and no --gen'}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const env = deps.env ?? process.env;
  // §3.1 I3: refused from a kernel-spawned shell. Hygiene, NOT a security control (Aegis H4): env -u
  // defeats it; the boundary is the presence prompt on every root signature.
  if (env.GNOMON_HSID) return refused(io, 'forbidden', 'gnomon identity init is a human-only, root-signed verb; it is refused from a kernel-spawned shell');
  // the raw verb honours GNOMON_HOME (an operator tool); `gnomon setup` does not (Aegis I4, spec §2.4 rule 9)
  const home = args.home ?? resolveGnomonHome({ env });
  if (daemonState(home).state === 'running') return refused(io, 'daemon-running', 'stop the daemon first (it would keep running on the old root)');

  let existing: IdentityRecord | null;
  try {
    existing = readIdentity(home);
  } catch (e) {
    return refused(io, 'identity-malformed', e instanceof Error ? e.message : 'identity.json is unreadable', { path: identityPath(home) });
  }
  const mode: 'init' | 'rotate' | 'recover' = args.rotate ? 'rotate' : args.recover ? 'recover' : 'init';
  if (existing && mode === 'init') return refused(io, 'exists', `a root already exists for this home (${existing.rootKeyId}); rotating it is explicit: gnomon identity init --rotate`, { rootKeyId: existing.rootKeyId });
  if (!existing && mode !== 'init') return refused(io, 'nothing-to-rotate', `no identity to ${mode}; run gnomon identity init`);
  const tty = deps.isTty ?? io.stdin.isTTY === true;
  if (mode !== 'init') {
    if (!tty && !deps.confirm) return refused(io, 'not-interactive', `--${mode} needs an interactive terminal and a typed confirmation`);
    io.stderr.write(
      mode === 'rotate'
        ? `ROTATE the root of ${home} (${existing!.rootKeyId}). The OLD root signs the change; THIS device's registry row is re-issued under the new root, every other row (other devices, agents) is dropped, and the old registry is kept aside as evidence. Type "rotate" to continue:\n> `
        : `RECOVER ${home}: the root ${existing!.rootKeyId} is LOST. A new root starts a NEW namespace; nothing signed by the lost root carries over, and the recovery is logged as unsigned by it. Type "recover" to continue:\n> `,
    );
    const answer = await (deps.confirm ?? (() => readLine(io.stdin)))();
    if (answer !== mode) return refused(io, 'not-confirmed', `${mode} was not confirmed`);
  }

  // Ctrl-C (R4): the first one stops at the next step boundary and cleans up; a second exits at once
  const ac = new AbortController();
  const onSigint = (): void => {
    if (ac.signal.aborted) {
      io.stderr.write('gnomon identity: interrupted twice; exiting without cleanup\n');
      process.exit(130);
    }
    ac.abort();
    io.stderr.write('gnomon identity: interrupted — cancel any open Touch ID prompt; cleaning up after the current step\n');
  };
  const p = new Provisioner({
    home,
    // #app-bundle: inside a release app the app's own helper wins over a recorded (possibly stale, moved-app) path
    helperPath: args.helper ?? (existing ? helperPathFor(existing.helperPath) : defaultHelperPath()),
    ...(deps.verifier ? { verifier: deps.verifier } : {}),
    ...(deps.start ? { start: deps.start } : {}),
    ...(deps.once ? { once: deps.once } : {}),
    ...(deps.interrupt ? { interrupt: deps.interrupt } : {}),
    ...(deps.fault ? { fault: deps.fault } : {}),
    signal: ac.signal,
  });
  p.on('event', renderRaw(io));
  if (deps.handleSignals !== false) process.on('SIGINT', onSigint);
  try {
    const r = await p.provision({
      mode,
      existing,
      name: args.name ?? sanitizeName(os.userInfo().username),
      host: args.host ?? sanitizeHost(os.hostname()),
      ...(mode === 'rotate' && (deps.confirmPurge || tty)
        ? {
            confirmPurgeOld: async () => {
              io.stderr.write(`Delete the OLD generation ${existing!.gen} from the Secure Enclave now (one touch per key)? Type "purge" to delete, anything else to keep it:\n> `);
              return (await (deps.confirmPurge ?? (() => readLine(io.stdin)))()) === 'purge';
            },
          }
        : {}),
    });
    return finish(io, r);
  } finally {
    if (deps.handleSignals !== false) process.off('SIGINT', onSigint);
  }
}

/** `gnomon identity purge-keys --gen <g>`: delete one generation's SE keys, each with fresh presence (H2). Never the live identity's. */
async function purgeKeys(argv: readonly string[], io: IdentityIo, deps: IdentityDeps): Promise<number> {
  const args = parse(argv);
  if (typeof args === 'string' || !args.gen) {
    io.stderr.write(`gnomon identity: ${typeof args === 'string' ? args : 'purge-keys needs --gen <gen>'}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const env = deps.env ?? process.env;
  // the same refusals as init (reviewer round 3): kernel-spawned shell (hygiene), a running daemon, a malformed record
  if (env.GNOMON_HSID) return refused(io, 'forbidden', 'gnomon identity purge-keys is a human-only verb; it is refused from a kernel-spawned shell');
  const home = args.home ?? resolveGnomonHome({ env });
  if (daemonState(home).state === 'running') return refused(io, 'daemon-running', 'stop the daemon first');
  let existing: IdentityRecord | null;
  try {
    existing = readIdentity(home);
  } catch (e) {
    // a record we cannot read might name the generation asked for: never purge blind
    return refused(io, 'identity-malformed', e instanceof Error ? e.message : 'identity.json is unreadable', { path: identityPath(home) });
  }
  if (existing?.gen === args.gen) return refused(io, 'in-use', `generation ${args.gen} is this home's live identity; rotate or recover instead`);
  const p = new Provisioner({
    home,
    helperPath: args.helper ?? (existing ? helperPathFor(existing.helperPath) : defaultHelperPath()),
    ...(deps.verifier ? { verifier: deps.verifier } : {}),
    ...(deps.start ? { start: deps.start } : {}),
  });
  p.on('event', renderRaw(io));
  const r = await p.purgeGeneration(args.gen);
  // the pre-engine CLI's pin refusal carried no helperPath here
  if (!r.ok && r.reason === 'helper-unavailable') return refused(io, r.reason, r.message);
  return finish(io, r);
}

function identityStatus(argv: readonly string[], io: IdentityIo): number {
  const args = parse(argv);
  if (typeof args === 'string') {
    io.stderr.write(`gnomon identity: ${args}\n`);
    return EXIT_USAGE;
  }
  const home = args.home ?? resolveGnomonHome();
  try {
    const r = readIdentity(home);
    say(io, r ? { state: 'hardware', home, rootKeyId: r.rootKeyId, ns: r.ns, principalId: r.principalId, deviceId: r.deviceId, approvalsKeyId: r.approvals.row.keyId, helper: r.helperPath, createdAt: r.createdAt } : { state: 'unprovisioned', home });
    return EXIT_OK;
  } catch (e) {
    return refused(io, 'identity-malformed', e instanceof Error ? e.message : 'identity.json is unreadable');
  }
}
