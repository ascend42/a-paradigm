/**
 * @symbol #first-run
 *
 * `gnomon setup` (#first-run, `$first-run`, spec §2.4 rule 9; T-2026-10-19-005
 * MVP-a) — the GUIDED first run in plain terminal prompts (no full-screen
 * TUI: P8-D51 forbids an in-terminal UI). Bare `gnomon` on an interactive
 * terminal with an unprovisioned home runs it, then continues into
 * #gnomon-up's runUp in the same process with the #bare-entry folder hint.
 * It renders the #provisioner engine and the #setup-preflight report; the
 * GUI setup phase (MVP-b) renders the same engine.
 *
 *   welcome → preflight (fixes shown) → leftover generations (purge, never
 *   adopt) → name (prefilled from $USER, PRINCIPAL_NAME_PATTERN) → "exactly
 *   2 Touch ID prompts; a third is an attack" → 1 of 2, 2 of 2, each with
 *   the expected digest shown big and grouped → summary → hand off to up.
 *
 * `^unprovisioned-only`: setup provisions only a home with NO identity.json.
 * One that exists is shown (createdAt, root keyId) and left alone ("already
 * set up"); a malformed one is shown, never replaced; a commit that crashed
 * before its registry row is finished as its own root-signed step (I10).
 * HOME (Aegis I4): `~/.gnomon` of the user's home, never GNOMON_HOME, lstat,
 * a symlink or non-directory refused — unlike the raw `gnomon identity
 * init`, which keeps honouring GNOMON_HOME and --home. HELPER (I5): the
 * pinned default or identity.json's, never the cwd or a prompt.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { PRINCIPAL_NAME_PATTERN } from '@a-company/gnomon-contracts';
import { GNOMON_VERSION } from '../version.js';
import { refused } from './readout.js';
import { defaultHelperPath, sanitizeHost, sanitizeName } from './identity-cli.js';
import { unsafeRuntime, type LaunchTtyIo, type RuntimeFacts } from './launch-tty.js';
import { daemonState, resolveGnomonHome } from '../kernel/lifecycle/index.js';
import {
  HardwareRootAuthority,
  identityPath,
  Provisioner,
  readIdentity,
  readRegistry,
  registryPath,
  deviceKeyPath,
  identityJournalPath,
  type HelperTransport,
  type HelperVerifier,
  type IdentityRecord,
  type PinnedHelper,
  type ProvisionEvent,
} from '../kernel/identity/index.js';
import { runPreflight, type PreflightCheck } from '../kernel/setup/preflight.js';
import { SetupEndpoint, type SetupEndpointOptions, type SetupGrant } from '../kernel/setup/setup-endpoint.js';
import { channelLine, channelRefused } from './launch-tty.js';

export const SETUP_EXIT_OK = 0;
export const SETUP_EXIT_REFUSED = 1;
export const SETUP_EXIT_USAGE = 64;

export const SETUP_USAGE = `gnomon ${GNOMON_VERSION} setup — set up Gnomon on this Mac (guided; two Touch ID prompts)
usage: gnomon setup [--cli]  (default: the setup screens in your browser; --cli: prompts in this terminal. the home is ~/.gnomon; GNOMON_HOME and --home are not read: use \`gnomon identity init\` for those)
`;

export const WELCOME = `Welcome to Gnomon.

Gnomon watches over your Claude Code sessions on this Mac. When Claude wants
to do something that needs your say-so, Gnomon shows it to you and records
your answer, signed by a key that never leaves this Mac's Secure Enclave and
that only your Touch ID can use. Setup creates those keys and registers this
Mac. It takes about a minute.
`;

/** Test seams, programmatic only (gnomon.ts passes none): never env, never argv. */
export interface SetupDeps {
  /** The user's home (default os.homedir()); `~/.gnomon` lives in it. */
  userHome?: string;
  verifier?: HelperVerifier;
  startHelper?: (pin: PinnedHelper) => HelperTransport;
  once?: (pin: PinnedHelper) => (req: Record<string, unknown>) => Record<string, unknown>;
  /** tests only: the helper executable to pin (default: the pinned install location) */
  helperPath?: string;
  runtime?: RuntimeFacts;
  isTty?: boolean;
  handleSignals?: boolean;
  interrupt?: () => boolean;
  fault?: (step: string) => void;
  exec?: (file: string, args: string[]) => string;
  platform?: NodeJS.Platform;
}

export interface SetupResult {
  code: number;
  /** true when this run committed a new identity (the caller may continue into up) */
  provisioned: boolean;
  home?: string;
}

class SetupRefusal extends Error {
  constructor(
    readonly reason: string,
    message: string,
    readonly next: readonly string[] = [],
  ) {
    super(message);
  }
}

/** Aegis I4: `~/.gnomon` of the user's home, never from env; lstat (no symlink); may not exist yet. */
export function resolveSetupHome(userHome: string = os.userInfo().homedir): string {
  const raw = resolveGnomonHome({ env: {}, homedir: userHome });
  let st: fs.Stats;
  try {
    st = fs.lstatSync(raw);
  } catch {
    // round 2: the checks are read-only, so a missing home is only NAMED here; ensureSetupHome creates it before a write
    return path.join(fs.realpathSync.native(path.dirname(raw)), path.basename(raw));
  }
  if (st.isSymbolicLink()) throw new SetupRefusal('unsafe-home', `${raw} is a symlink; the home must be a plain directory`, ['replace the link with the real directory, then run gnomon setup']);
  if (!st.isDirectory()) throw new SetupRefusal('unsafe-home', `${raw} is not a directory`);
  return fs.realpathSync.native(raw);
}

/** L6: create the strict home owner-only right before the first write (purge journal, provision); never a symlink. */
export function ensureSetupHome(home: string): void {
  if (!fs.existsSync(home)) fs.mkdirSync(home, { mode: 0o700 });
  const st = fs.lstatSync(home);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new SetupRefusal('unsafe-home', `${home} is not a plain directory`);
}

/** `3f2a91c07be4` → `3f2a 91c0 7be4` */
export function groupDigest(d: string): string {
  return (d.match(/.{1,4}/g) ?? []).join(' ');
}

const MARK: Record<PreflightCheck['status'], string> = { pass: 'ok  ', warn: 'warn', fail: 'FAIL' };

/** One line reader for the whole run (pre-typed lines are never lost between questions). */
function lineReader(io: LaunchTtyIo): { ask: (prompt: string) => Promise<string>; close: () => void } {
  const rl = readline.createInterface({ input: io.stdin, terminal: false });
  const lines: string[] = [];
  const waiting: Array<(l: string) => void> = [];
  let closed = false;
  rl.on('line', (l) => (waiting.length ? waiting.shift()!(l.trim()) : lines.push(l.trim())));
  rl.on('close', () => {
    closed = true;
    while (waiting.length) waiting.shift()!('');
  });
  return {
    ask: (prompt) => {
      io.stdout.write(prompt);
      if (lines.length) return Promise.resolve(lines.shift()!);
      if (closed) return Promise.resolve('');
      return new Promise((r) => waiting.push(r));
    },
    close: () => rl.close(),
  };
}

function renderPresence(io: LaunchTtyIo): (e: ProvisionEvent) => void {
  return (e) => {
    if (e.type !== 'presence') return;
    const title =
      e.purpose === 'approvals-binding'
        ? 'Touch ID 1 of 2: your root key vouches for your approvals key'
        : e.purpose === 'device-row'
          ? "Touch ID 2 of 2: the root registers this Mac's device key"
            : `Touch ID: delete the ${e.key} key of generation ${e.gen}`;
    io.stdout.write(`\n${title}\n`);
    if (e.digest12) {
      // I2: the expected digest goes to the user's own launch surface (this terminal) and nowhere else
      io.stdout.write(`\n        ${groupDigest(e.digest12)}\n\n`);
      // MEDIUM-3: the real helper appends "; row <schemaVersion> <kind>", so the line BEGINS with this
      io.stdout.write(`  The LAST line of the Touch ID dialog must BEGIN with "Gnomon Helper: root key signs 1: ${e.digest12}".\n  If it doesn't, press Cancel.\n`);
    }
  };
}

/** The guided first run. Never throws for a refusal: it prints it and returns the code. */
export async function runSetup(io: LaunchTtyIo, deps: SetupDeps = {}): Promise<SetupResult> {
  const env = deps.runtime?.env ?? process.env;
  const tty = deps.isTty ?? (io.stdin.isTTY === true && io.stdout.isTTY === true);
  const stop = (e: SetupRefusal): SetupResult => {
    refused(io.stderr, 'setup', e.reason, e.message, e.next);
    return { code: SETUP_EXIT_REFUSED, provisioned: false };
  };
  if (env.GNOMON_HSID) return stop(new SetupRefusal('forbidden', 'gnomon setup is a human-only verb; it is refused from a kernel-spawned shell'));
  if (!tty) return stop(new SetupRefusal('not-interactive', 'setup asks questions and shows Touch ID codes: it needs an interactive terminal', ['run `gnomon setup` (or `gnomon`) in Terminal']));
  let home: string;
  try {
    home = resolveSetupHome(deps.userHome);
  } catch (e) {
    if (e instanceof SetupRefusal) return stop(e);
    throw e;
  }
  if (fs.existsSync(home) && daemonState(home).state === 'running') return stop(new SetupRefusal('daemon-running', `a kernel already runs on ${home}`, ['stop it first (quit Gnomon.app, or Ctrl-C in its terminal)']));

  const rl = lineReader(io);
  const ac = new AbortController();
  const onSigint = (): void => {
    if (ac.signal.aborted) process.exit(130);
    ac.abort();
    io.stderr.write('gnomon setup: interrupted — cancel any open Touch ID prompt; cleaning up after the current step\n');
  };
  if (deps.handleSignals !== false) process.on('SIGINT', onSigint);
  try {
    io.stdout.write(WELCOME);
    const report = await runPreflight({
      home,
      userHome: deps.userHome ?? os.userInfo().homedir,
      helperPath: deps.helperPath ?? defaultHelperPath(),
      ...(deps.verifier ? { verifier: deps.verifier } : {}),
      ...(deps.startHelper ? { start: deps.startHelper } : {}),
      env,
      unsafe: unsafeRuntime(deps.runtime),
      ...(deps.platform ? { platform: deps.platform } : {}),
      ...(deps.exec ? { exec: deps.exec } : {}),
    });
    io.stdout.write('\nChecking this Mac:\n');
    for (const c of report.checks) io.stdout.write(`  ${MARK[c.status]}  ${c.id.padEnd(11)} ${c.detail}${c.fix ? `\n              fix: ${c.fix}` : ''}\n`);
    const engine = (helperPath: string): Provisioner => {
      const p = new Provisioner({
        home,
        helperPath,
        ...(deps.verifier ? { verifier: deps.verifier } : {}),
        ...(deps.startHelper ? { start: deps.startHelper } : {}),
        ...(deps.once ? { once: deps.once } : {}),
        ...(deps.interrupt ? { interrupt: deps.interrupt } : {}),
        ...(deps.fault ? { fault: deps.fault } : {}),
        signal: ac.signal,
      });
      p.on('event', renderPresence(io));
      return p;
    };

    // ^unprovisioned-only: an identity that exists is shown, never adopted or replaced
    if (report.existing) return await alreadySetUp(io, home, report.existing, rl, engine);
    const homeCheck = report.checks.find((c) => c.id === 'home');
    if (homeCheck?.status === 'fail') return stop(new SetupRefusal('unfit-home', homeCheck.detail, homeCheck.fix ? [homeCheck.fix] : []));

    // I6: leftover generations are offered for purge (presence per key), never adopted
    // MEDIUM-2: GNOMON_HOME is read here ONLY to protect the home it names from a purge, never to choose the home
    const otherHome = env.GNOMON_HOME && path.isAbsolute(env.GNOMON_HOME) ? path.resolve(env.GNOMON_HOME) : null;
    for (const gen of report.leftover) {
      if (otherHome) {
        let other: IdentityRecord | null = null;
        try {
          other = readIdentity(otherHome);
        } catch {
          return stop(new SetupRefusal('identity-malformed', `the home GNOMON_HOME names (${otherHome}) has an unreadable identity.json that may use generation ${gen}; not purging blind`));
        }
        if (other?.gen === gen) return stop(new SetupRefusal('in-use', `generation ${gen} is the live identity of ${otherHome} (GNOMON_HOME); setup will not delete it`, ['unset GNOMON_HOME only if that home is really gone, or keep it and use `gnomon identity init --home <abs>`']));
      }
      const a = await rl.ask(`\nThe Secure Enclave holds Gnomon keys (generation ${gen}) not used by ~/.gnomon (another home set by GNOMON_HOME/--home may use it). Setup needs them gone.\nType "purge" to delete them (one Touch ID per key), anything else to stop:\n> `);
      if (a !== 'purge') return stop(new SetupRefusal('keys-exist', `generation ${gen} was kept; setup does not adopt keys it did not create`, [`gnomon identity purge-keys --gen ${gen}`]));
      ensureSetupHome(home);
      const r = await engine(deps.helperPath ?? defaultHelperPath()).purgeGeneration(gen, otherHome ? { alsoCheckHomes: [otherHome] } : {});
      if (!r.ok) return stop(new SetupRefusal(r.reason, r.message));
      io.stdout.write(`  deleted generation ${gen}\n`);
    }
    if (!report.ok) return stop(new SetupRefusal('preflight-failed', 'fix the FAIL lines above, then run gnomon setup again'));

    const dflt = sanitizeName(os.userInfo().username);
    let name = '';
    for (let tries = 0; tries < 3 && !name; tries++) {
      const a = await rl.ask(`\nYour name on approvals [${dflt}]: `);
      const n = a === '' ? dflt : a;
      if (PRINCIPAL_NAME_PATTERN.test(n)) name = n;
      else io.stdout.write('  lowercase letters, digits, ".", "_" or "-", starting with a letter or digit, at most 64\n');
    }
    if (!name) return stop(new SetupRefusal('bad-name', 'no valid name was given'));

    io.stdout.write(`\nNext come EXACTLY 2 Touch ID prompts. Before each one this terminal shows a code;\nthe dialog's last line must show the same code. A third prompt to SIGN during setup is an attack: press Cancel.\nIf something fails (for example the helper crashes), cleanup may ask extra Touch ID prompts to DELETE the keys\nthis run created; cancelling those is safe: the keys stay and the next setup offers to purge them.\n`);
    try {
      ensureSetupHome(home);
    } catch (e) {
      if (e instanceof SetupRefusal) return stop(e);
      throw e;
    }
    const r = await engine(deps.helperPath ?? defaultHelperPath()).provision({ mode: 'init', existing: null, name, host: sanitizeHost(os.hostname()) });
    if (!r.ok) {
      const leftover = typeof r.extra.leftoverGen === 'string' ? [`gnomon identity purge-keys --gen ${r.extra.leftoverGen}`] : [];
      return stop(new SetupRefusal(r.reason, r.message, leftover));
    }
    summary(io, home, r.record!);
    return { code: SETUP_EXIT_OK, provisioned: true, home };
  } finally {
    rl.close();
    if (deps.handleSignals !== false) process.off('SIGINT', onSigint);
  }
}

function summary(io: LaunchTtyIo, home: string, rec: IdentityRecord): void {
  io.stdout.write(
    `\nGnomon is set up.\n` +
      `  root key   ${rec.rootKeyId} (Secure Enclave)\n` +
      `  you        ${rec.principalId}\n` +
      `  this Mac   ${rec.deviceId}\n` +
      `  files      ${identityPath(home)}\n` +
      `             ${registryPath(home)}\n` +
      `             ${deviceKeyPath(home)}\n` +
      `             ${identityJournalPath(home)}\n`,
  );
}

async function alreadySetUp(io: LaunchTtyIo, home: string, rec: IdentityRecord, rl: ReturnType<typeof lineReader>, engine: (h: string) => Provisioner): Promise<SetupResult> {
  io.stdout.write(`\nAlready set up: ${home}\n  created    ${rec.createdAt}\n  root key   ${rec.rootKeyId}\n`);
  // I10: a commit that crashed before its registry row (up says device-unregistered) is finished as its own step
  let registered = false;
  try {
    const verify = new HardwareRootAuthority({ gen: rec.gen, rootPublicKeyPem: rec.rootPublicKeyPem }, {});
    const reg = readRegistry(home, verify);
    const row = reg.devices.get(rec.deviceId);
    registered = row !== undefined && row.principalKind === 'human' && row.principalId === rec.principalId;
  } catch {
    registered = false;
  }
  if (registered) {
    io.stdout.write('  Nothing to do. Run `gnomon` in a repo to start.\n');
    return { code: SETUP_EXIT_OK, provisioned: false, home };
  }
  const a = await rl.ask(`\nThis Mac's device key is not registered yet (an earlier setup stopped just before the last step).\nType "complete" to register it now (no Touch ID: the root already signed it during that setup), anything else to stop:\n> `);
  if (a !== 'complete') {
    refused(io.stderr, 'setup', 'device-unregistered', 'the device registration was not completed', ['gnomon setup']);
    return { code: SETUP_EXIT_REFUSED, provisioned: false, home };
  }
  // I5: the helper comes from identity.json (completeDevice opens it like the daemon does)
  const r = await engine(rec.helperPath).completeDevice();
  if (!r.ok) {
    refused(io.stderr, 'setup', r.reason, r.message);
    return { code: SETUP_EXIT_REFUSED, provisioned: false, home };
  }
  summary(io, home, rec);
  return { code: SETUP_EXIT_OK, provisioned: true, home };
}

/** `gnomon setup`: the guided run, then (on success) the normal launch in this process. */
export async function runSetupCommand(argv: readonly string[], io: LaunchTtyIo, deps: SetupDeps & { continueUp?: () => Promise<number> } = {}): Promise<number> {
  if (argv[0] === '--help' || argv[0] === '-h') {
    io.stdout.write(SETUP_USAGE);
    return SETUP_EXIT_OK;
  }
  const cli = argv[0] === '--cli';
  if (argv.length > (cli ? 1 : 0)) {
    io.stderr.write(`gnomon setup: unknown argument (${argv.length}); setup takes only --cli\n${SETUP_USAGE}`);
    return SETUP_EXIT_USAGE;
  }
  const r = cli || (deps as GuiSetupDeps).surface === 'cli' ? await runSetup(io, deps) : await runGuiSetup(io, deps, 'tty');
  // also an already-set-up Mac (Start Gnomon): code 0 with a home continues into the launch
  if (r.code !== SETUP_EXIT_OK || !r.home || !deps.continueUp) return r.code;
  io.stdout.write('\nStarting Gnomon…\n');
  return deps.continueUp();
}

/** #setup-endpoint seams (tests): the transport child entry and the #web-endpoint factory. */
export interface GuiSetupDeps extends SetupDeps {
  /** 'cli' = the terminal prompts (`gnomon setup --cli`); default 'gui' = the setup screens */
  surface?: 'gui' | 'cli';
  scriptPath?: string;
  createWeb?: SetupEndpointOptions['createWeb'];
  /** tests: the setup token TTL */
  ttlMs?: number;
  /** tests: called with the grant once the endpoint listens (the page side) */
  onGrant?: (g: SetupGrant) => void;
}

export const GUI_SETUP_TRUST =
  'This terminal is the surface to trust: before each Touch ID prompt it prints the code the dialog must show.\n' +
  'If the page and this terminal ever disagree, believe this terminal and press Cancel. Cancelling is always safe.\n';

/**
 * #setup-endpoint from a launch surface: the TTY (bare `gnomon`, `gnomon setup`) prints the setup URL on ONE
 * terminal line (printLaunch rules: only to a TTY; the token nowhere else) and every expected digest; the wrapper
 * (`up --wrapper`) gets `{t:'setup',port,setupToken,setupPublicKey,bundleHash,expiresAt}` on its channel pipe.
 */
export async function runGuiSetup(io: LaunchTtyIo, deps: GuiSetupDeps, via: 'tty' | 'wrapper', urlSuffix = ''): Promise<SetupResult> {
  const env = deps.runtime?.env ?? process.env;
  const fail = (reason: string, message: string, next: readonly string[] = []): SetupResult => {
    if (via === 'wrapper') channelRefused(io, 'setup', reason, message, next.length ? next : ['quit and reopen Gnomon to start setup again']);
    else refused(io.stderr, 'setup', reason, message, next);
    return { code: SETUP_EXIT_REFUSED, provisioned: false };
  };
  if (env.GNOMON_HSID) return fail('forbidden', 'gnomon setup is a human-only verb; it is refused from a kernel-spawned shell');
  if (via === 'tty' && (deps.isTty ?? (io.stdin.isTTY === true && io.stdout.isTTY === true)) !== true) return fail('not-interactive', 'the setup URL carries a single-use token: it is printed only to an interactive terminal');
  let home: string;
  try {
    home = resolveSetupHome(deps.userHome);
  } catch (e) {
    if (e instanceof SetupRefusal) return fail(e.reason, e.message, e.next);
    throw e;
  }
  if (fs.existsSync(home) && daemonState(home).state === 'running') return fail('daemon-running', `a kernel already runs on ${home}`);
  // MEDIUM-2: GNOMON_HOME is read ONLY to protect the home it names from a purge, never to choose the home
  const otherHome = env.GNOMON_HOME && path.isAbsolute(env.GNOMON_HOME) ? path.resolve(env.GNOMON_HOME) : null;
  // the terminal prints a FRESH link when one expires unused (up to SETUP_LINKS); the wrapper's app asks again by reopening
  for (let link = 1; ; link++) {
    const ep = new SetupEndpoint({
      home,
      userHome: deps.userHome ?? os.homedir(),
      helperPath: deps.helperPath ?? defaultHelperPath(),
      host: sanitizeHost(os.hostname()),
      defaultName: sanitizeName(os.userInfo().username),
      env,
      unsafe: unsafeRuntime(deps.runtime),
      ...(otherHome ? { alsoCheckHomes: [otherHome] } : {}),
      ...(deps.verifier ? { verifier: deps.verifier } : {}),
      ...(deps.startHelper ? { start: deps.startHelper } : {}),
      ...(deps.once ? { once: deps.once } : {}),
      ...(deps.exec ? { exec: deps.exec } : {}),
      ...(deps.platform ? { platform: deps.platform } : {}),
      ...(deps.scriptPath ? { scriptPath: deps.scriptPath } : {}),
      ...(deps.createWeb ? { createWeb: deps.createWeb } : {}),
      ...(deps.ttlMs !== undefined ? { ttlMs: deps.ttlMs } : {}),
      // Aegis: started from a terminal, the terminal ALSO prints each expected digest, and is the surface to trust
      ...(via === 'tty' ? { onEvent: renderPresence(io), onNotice: (t: string) => void io.stdout.write(`\n  ${t}\n`) } : {}),
    });
    let g: SetupGrant;
    try {
      g = await ep.start();
    } catch (e) {
      await ep.stop();
      return fail('setup-endpoint', e instanceof Error ? e.message : 'the setup endpoint did not start', via === 'tty' ? ['gnomon setup --cli'] : []);
    }
    deps.onGrant?.(g);
    if (via === 'wrapper') channelLine(io.stdout, { t: 'setup', port: g.port, setupToken: g.setupToken, setupPublicKey: g.setupPublicKey, bundleHash: g.bundleHash, expiresAt: g.expiresAt });
    else io.stdout.write(`${link === 1 ? WELCOME : ''}\n  open this in your browser within 60 s (single use) to set up Gnomon on screens:\n\n  ${g.url}${urlSuffix}\n\n${link === 1 ? GUI_SETUP_TRUST : ''}  (prefer prompts here? Ctrl-C, then: gnomon setup --cli)\n`);
    const r = await waitSetup(io, deps, via, ep);
    if (!r.ok && r.reason === 'token-expired' && via === 'tty' && link < SETUP_LINKS) {
      io.stdout.write('\n  That link expired unused. Here is a fresh one:\n');
      continue;
    }
    if (!r.ok) {
      const next = r.leftoverGen ? [`keys of generation ${r.leftoverGen} were left in the Secure Enclave: setup offers to delete them next time`] : [];
      return fail(r.reason, r.message, r.reason === 'token-expired' ? (via === 'tty' ? ['run gnomon (or gnomon setup) again for a fresh link'] : []) : [...next, ...(via === 'tty' ? ['gnomon setup'] : [])]);
    }
    const rec = readIdentity(home);
    if (via === 'tty' && rec && r.provisioned) summary(io, home, rec);
    return { code: SETUP_EXIT_OK, provisioned: r.provisioned, home };
  }
}

/** How many fresh links the terminal prints before it stops (each one is single use, 60 s). */
export const SETUP_LINKS = 3;

async function waitSetup(io: LaunchTtyIo, deps: GuiSetupDeps, via: 'tty' | 'wrapper', ep: SetupEndpoint) {
  const onSigint = (): void => void ep.stop();
  if (deps.handleSignals !== false) process.on('SIGINT', onSigint);
  // the wrapper channel: `quit` or EOF (the app went away) aborts setup; the provisioner cleans up at its next step
  let buf = '';
  const onData = (d: Buffer | string): void => {
    buf += String(d);
    if (buf.split('\n').some((l) => l.trim() === 'quit')) void ep.stop();
  };
  const onEnd = (): void => void ep.stop();
  if (via === 'wrapper') {
    io.stdin.on('data', onData);
    io.stdin.on('end', onEnd);
  }
  try {
    return await ep.done;
  } finally {
    if (deps.handleSignals !== false) process.off('SIGINT', onSigint);
    io.stdin.off('data', onData);
    io.stdin.off('end', onEnd);
    await ep.stop();
  }
}
