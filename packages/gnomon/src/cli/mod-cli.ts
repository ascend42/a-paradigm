/**
 * @symbol #mod-cli
 *
 * `gnomon mod install|link|list|status|pause|start|uninstall` (spec §12.4,
 * §12.5, §3.1 I3; M1.11 slice 3). A thin layer over #manifest-loader
 * (stageInstall, the grant table, rederiveInstallDetail) and the on-disk
 * control surface the kernel's StagedCardPickup reads (modhost/control.ts).
 * The kernel has zero deps (G-SEC-01): plain text through readout.ts.
 *
 *   install <path>   stage a package: validate, snapshot, pending install card
 *   link <folder>    stage a linked folder (tier `local`)
 *       Both SIGN NOTHING. Staging from a session (the I3 staging exception)
 *       is NOT available yet: on darwin the `session` profile denies writes
 *       under the Gnomon home, so the snapshot copy fails there; it needs the
 *       gnomon-mods bridge (a later lane). If GNOMON_HSID is set the record
 *       carries it as a CLAIM (shown as such on the card). The card printed is
 *       the one the broker will show — re-derived from the pinned snapshot by
 *       the hardened install path (one line per entry, the kernel-composed
 *       count line, COMMAND_UNSAFE refusal of a linked path, the linked-source
 *       re-hash). The running kernel raises it through #approval-broker; the
 *       human decides it with Touch ID (root key) in the GUI. A `url` source
 *       is refused (only local paths are staged in Move 1).
 *   list             every mod with an effective install or a pending card
 *   status [<name>]  pin, source, tier, pause, pending cards, snapshots
 *   pause <name>     write the pause marker (narrows: allowed from a session)
 *   start <name>     clear it and request an operator start
 *   uninstall <name> stage an uninstall request; the kernel raises a root-class
 *                    card whose `allow` appends a root-signed grant.uninstall
 *
 * THE GNOMON_HSID CHECK IS ADVISORY (hygiene, §3.1 I3 "honest limit"):
 * `start` and `uninstall` refuse when GNOMON_HSID is set, but `env -u` defeats
 * that. The boundaries are the `session` sandbox profile (SBPL on darwin: a
 * session cannot write the home at all, so it cannot write any marker or
 * request) and, for uninstall, the root-key presence on the card.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { HSID_PATTERN } from '@a-company/gnomon-contracts';
import { RootVerifier } from '../kernel/identity/root-authority.js';
import type { RowVerifier } from '../kernel/identity/registry.js';
import { readIdentity } from '../kernel/identity/provision.js';
import { daemonState } from '../kernel/lifecycle/pidfile.js';
import { resolveGnomonHome } from '../kernel/lifecycle/home.js';
import { effectiveInstall, readGrants } from '../kernel/manifest/grants.js';
import { rederiveInstallDetail, stageInstall } from '../kernel/manifest/install.js';
import { ManifestRefusal } from '../kernel/manifest/refusal.js';
import { modDir } from '../kernel/manifest/snapshot.js';
import { isUserPaused, modNames, pendingStaged, requestStart, writePause, requestUninstall, uninstallRequested } from '../kernel/modhost/control.js';
import { GNOMON_VERSION } from '../version.js';
import { isDevHome, loadDevHome } from './dev-home.js';
import { readout, refused, type Out } from './readout.js';
import { runModConfig } from './desk-cli.js';

export const MOD_EXIT_OK = 0;
export const MOD_EXIT_REFUSED = 1;
export const MOD_EXIT_USAGE = 64;

export const MOD_USAGE = `gnomon ${GNOMON_VERSION} mod — install, link and control mods (spec §12.4)
usage: gnomon mod <verb> [--home <abs>] …
  install <path>     stage a mod package; prints the install card (signs nothing)
  link <folder>      stage a linked folder (tier local); prints the install card
  list               installed mods and pending cards
  status [<name>]    pin, source, tier, pause state, pending cards, snapshots
  pause <name>       stop the mod and keep it stopped
  start <name>       clear a pause and start the mod
  uninstall <name>   ask for the uninstall card (root key, decided in the GUI)
  config <name> [--server <s>] [--command <abs>] [--args …] [--env NAME=value]
                     ask to override how the mod's MCP server launches (only what
                     its manifest lets you set; a card in the GUI decides it)
Cards are raised by the running kernel (gnomon up) and decided in the GUI with Touch ID.
`;

const MOD_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const NO_TRUST: RowVerifier = Object.freeze({ rootKeyId: null, ns: null, verifyRow: () => false });

export interface ModCliIo {
  stdout: Out;
  stderr: Out;
}

/** Programmatic seams only (gnomon.ts passes none): never env, never argv. */
export interface ModCliDeps {
  /** the root to verify the grant table with (default: identity.json, else a DEV home's root) */
  trust?: RowVerifier;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

/** The root that signs this home's grant table, read from the home (never asserted by the caller). */
export function homeTrust(home: string): RowVerifier {
  try {
    const id = readIdentity(home);
    if (id) return new RootVerifier(id.rootPublicKeyPem);
  } catch {
    return NO_TRUST;
  }
  try {
    if (isDevHome(home)) return loadDevHome(home).root;
  } catch {
    return NO_TRUST;
  }
  return NO_TRUST;
}

function fromSession(env: NodeJS.ProcessEnv): string | null {
  const h = env.GNOMON_HSID;
  return typeof h === 'string' && h.length > 0 ? h : null;
}

function short(h: string): string {
  return h.startsWith('sha256:') ? `${h.slice(0, 19)}…` : h;
}

function snapshots(home: string, name: string): string[] {
  try {
    return fs.readdirSync(path.join(modDir(home, name), 'pinned')).sort();
  } catch {
    return [];
  }
}

export async function runModCommand(argv: readonly string[], io: ModCliIo, deps: ModCliDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const args = [...argv];
  let home: string | undefined;
  const hi = args.indexOf('--home');
  if (hi >= 0) {
    const v = args[hi + 1];
    if (!v || !path.isAbsolute(v)) {
      refused(io.stderr, 'usage', 'bad-home', '--home needs an absolute path');
      return MOD_EXIT_USAGE;
    }
    home = v;
    args.splice(hi, 2);
  }
  const [verb, target, ...extra] = args;
  // TD-2026-10-20-812 (#mcp-passthrough): `gnomon mod config` takes flags, so it is parsed by desk-cli.ts
  if (verb === 'config') {
    const h = path.resolve(home ?? resolveGnomonHome());
    return runModConfig(args.slice(1), io, { home: h, trust: deps.trust ?? homeTrust(h), env, ...(deps.now ? { now: deps.now } : {}) });
  }
  if (!verb || verb === '--help' || verb === '-h' || verb === 'help') {
    // asked-for help goes to stdout; a missing verb is a usage error: stderr
    (verb ? io.stdout : io.stderr).write(MOD_USAGE);
    return verb ? MOD_EXIT_OK : MOD_EXIT_USAGE;
  }
  if (extra.length) {
    refused(io.stderr, 'usage', 'extra-arguments', `unexpected ${extra.join(' ').slice(0, 80)}`, ['gnomon mod --help']);
    return MOD_EXIT_USAGE;
  }
  home = path.resolve(home ?? resolveGnomonHome());
  const trust = deps.trust ?? homeTrust(home);
  const hsid = fromSession(env);
  const needName = (): string | null => {
    if (typeof target === 'string' && MOD_NAME.test(target)) return target;
    refused(io.stderr, 'usage', 'bad-name', `gnomon mod ${verb} needs a mod name (a-z, 0-9, -)`);
    return null;
  };
  const noTrustNote = (): void => {
    if (trust.rootKeyId === null) io.stderr.write('  note: this home has no provisioned root (gnomon identity init); no install can take effect\n');
  };
  const human = (what: string): boolean => {
    if (!hsid) return true;
    refused(io.stderr, 'forbidden', 'kernel-spawned-shell', `gnomon mod ${what} is human-only; it is refused from a kernel-spawned shell (GNOMON_HSID set; advisory: the session sandbox is the boundary)`, ['ask the human to run it in their own terminal']);
    return false;
  };

  switch (verb) {
    case 'install':
    case 'link': {
      if (!target) {
        refused(io.stderr, 'usage', 'no-source', `gnomon mod ${verb} needs a ${verb === 'install' ? 'path' : 'folder'}`);
        return MOD_EXIT_USAGE;
      }
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
        refused(io.stderr, 'unsupported', 'url-source', 'only a local path can be staged in Move 1; clone or download it first', [`gnomon mod ${verb} <path>`]);
        return MOD_EXIT_REFUSED;
      }
      const source = path.resolve(target);
      let st: ReturnType<typeof stageInstall>;
      try {
        st = stageInstall({
          home,
          source,
          via: verb === 'install' ? 'package' : 'linked',
          requestedBy: `p:${trust.ns ?? '00000000'}/cli`,
          ...(hsid && HSID_PATTERN.test(hsid) ? { hsid } : {}),
          attended: !hsid,
          trust,
          ...(deps.now ? { now: deps.now() } : {}),
        });
      } catch (err) {
        if (err instanceof ManifestRefusal) {
          refused(io.stderr, err.manifestCode, 'manifest', err.message);
          return MOD_EXIT_REFUSED;
        }
        throw err;
      }
      if (st.state === 'unchanged') {
        io.stdout.write(`UNCHANGED  ${short(st.packageHash)}\n  this snapshot is already the installed pin: nothing to approve\n`);
        return MOD_EXIT_OK;
      }
      const name = st.record.detail.name;
      let lines: string[];
      try {
        lines = rederiveInstallDetail(home, name, st.cardId).lines;
      } catch (err) {
        refused(io.stderr, err instanceof ManifestRefusal ? err.manifestCode : 'integrity', 'card', (err as Error).message);
        return MOD_EXIT_REFUSED;
      }
      io.stdout.write(`STAGED  ${st.cardId}\n`);
      for (const l of lines) io.stdout.write(`  │ ${l}\n`);
      const running = daemonState(home).state === 'running';
      readout(io.stdout, [
        ['signed', 'nothing (a staged card takes no effect until decided)'],
        ['decide', running ? 'in the GUI: the running kernel raises this card (Touch ID, root key)' : 'start the kernel (gnomon up); it raises this card in the GUI'],
        ...(hsid ? ([['staged by', `session ${hsid}`]] as Array<[string, string]>) : []),
      ]);
      return MOD_EXIT_OK;
    }
    case 'list': {
      const g = readGrants(home, trust);
      const names = [...new Set([...g.installs.map((r) => r.name), ...modNames(home)])].sort();
      const pending = pendingStaged(home);
      let any = false;
      for (const n of names) {
        const row = effectiveInstall(g, n);
        const cards = pending.filter((p) => p.name === n);
        if (!row && cards.length === 0) continue;
        any = true;
        const state = !row ? 'staged' : isUserPaused(home, n) ? 'paused' : uninstallRequested(home, n) ? 'uninstall-requested' : 'installed';
        io.stdout.write(`${n.padEnd(24)} ${state.padEnd(20)} ${row ? `${short(row.packageHash)} ${row.source === 'package' ? 'package' : 'linked'}` : ''}${cards.length ? `  ${cards.length} pending card(s)` : ''}\n`);
      }
      if (!any) io.stdout.write('no mods installed or staged\n');
      noTrustNote();
      return MOD_EXIT_OK;
    }
    case 'status': {
      if (!target) return runModCommand(['list', '--home', home], io, deps);
      const name = needName();
      if (!name) return MOD_EXIT_USAGE;
      const g = readGrants(home, trust);
      const row = effectiveInstall(g, name);
      const cards = pendingStaged(home).filter((p) => p.name === name);
      if (!row && cards.length === 0) {
        refused(io.stderr, 'not_found', 'not-installed', `${name} is neither installed nor staged`, [`gnomon mod install <path>`]);
        noTrustNote();
        return MOD_EXIT_REFUSED;
      }
      io.stdout.write(`MOD  ${name}\n`);
      readout(io.stdout, [
        ['state', !row ? 'staged (not installed)' : isUserPaused(home, name) ? 'paused (gnomon mod start to resume)' : 'installed'],
        ...(row
          ? ([
              ['packageHash', row.packageHash],
              ['manifestHash', row.manifestHash],
              ['source', row.source],
              ['tier', g.trust.get(row.manifestHash) ?? 'unknown'],
              ['dev', row.dev ? `until ${row.dev.until}` : 'off'],
              ['card', row.cardId],
            ] as Array<[string, string]>)
          : []),
        ['pending cards', cards.length ? cards.map((c) => c.cardId).join(', ') : 'none'],
        ['uninstall', uninstallRequested(home, name) ? 'requested (decide the card in the GUI)' : 'no'],
        ['snapshots', String(snapshots(home, name).length)],
        ['kernel', daemonState(home).state],
      ]);
      noTrustNote();
      return MOD_EXIT_OK;
    }
    case 'pause': {
      const name = needName();
      if (!name) return MOD_EXIT_USAGE;
      if (!effectiveInstall(readGrants(home, trust), name)) {
        refused(io.stderr, 'not_found', 'not-installed', `${name} is not installed`);
        return MOD_EXIT_REFUSED;
      }
      writePause(home, name, deps.now?.());
      io.stdout.write(`PAUSED  ${name}\n  the kernel stops it and starts nothing for it until gnomon mod start ${name}\n`);
      return MOD_EXIT_OK;
    }
    case 'start': {
      const name = needName();
      if (!name) return MOD_EXIT_USAGE;
      if (!human('start')) return MOD_EXIT_REFUSED;
      if (!effectiveInstall(readGrants(home, trust), name)) {
        refused(io.stderr, 'not_found', 'not-installed', `${name} is not installed`);
        return MOD_EXIT_REFUSED;
      }
      requestStart(home, name, deps.now?.());
      io.stdout.write(`START  ${name}\n  ${daemonState(home).state === 'running' ? 'the running kernel starts it from its pinned snapshot' : 'the kernel starts it when it runs (gnomon up)'}\n`);
      return MOD_EXIT_OK;
    }
    case 'uninstall': {
      const name = needName();
      if (!name) return MOD_EXIT_USAGE;
      if (!human('uninstall')) return MOD_EXIT_REFUSED;
      const row = effectiveInstall(readGrants(home, trust), name);
      if (!row) {
        refused(io.stderr, 'not_found', 'not-installed', `${name} is not installed`);
        return MOD_EXIT_REFUSED;
      }
      requestUninstall(home, name, row.packageHash, deps.now?.(), { attended: true });
      io.stdout.write(`UNINSTALL REQUESTED  ${name}\n  the kernel raises an uninstall card (root key, Touch ID) in the GUI; nothing is removed until you allow it\n`);
      return MOD_EXIT_OK;
    }
    default:
      refused(io.stderr, 'usage', 'unknown-verb', `unknown verb ${verb.slice(0, 32)}`, ['gnomon mod --help']);
      return MOD_EXIT_USAGE;
  }
}
