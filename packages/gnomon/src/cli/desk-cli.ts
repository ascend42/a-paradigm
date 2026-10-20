/**
 * @symbol #offer-router
 * @symbol #mcp-passthrough
 *
 * The Desk's CLI (TD-2026-10-20-812, slice S1).
 *
 *   gnomon desk stats [<home>] [--json]
 *       Verifies the kernel log (as `gnomon replay` does) and folds offer.shown / offer.decided / offer.kept per mod:
 *       shown, open, not-now, stop-here, kept, and kept/shown (the A6 metric; the kill line is 15% after two weeks of
 *       daily use). Read-only; runs with or without a daemon. An unverified log is refused.
 *
 *   gnomon mod config <mod> [--server <name>] [--command <abs>] [--args <a> <b> …] [--env NAME=value …]
 *       Asks for a per-user launch override of one of the mod's provides.mcp servers (Aegis D2). Accepted only for
 *       what the manifest entry's `config` declares; an overridden command must be an absolute path. Writes a REQUEST
 *       under the Gnomon home; the running kernel raises a root-class card showing the effective launch (command,
 *       args, env names, launch hash) and only `allow` writes the kernel-owned store. Refused from a kernel-spawned
 *       shell (GNOMON_HSID, advisory: the session sandbox cannot write the home anyway).
 */
import * as path from 'node:path';
import { kernelPrincipalOf, resolveGnomonHome } from '../kernel/lifecycle/index.js';
import { readKernelPubs } from '../kernel/identity/index.js';
import { KeyRing, verifyLog } from '../kernel/log/index.js';
import { daemonState } from '../kernel/lifecycle/pidfile.js';
import { launchCardLines, readDeskMods, requestMcpConfig } from '../kernel/desk/mcp-passthrough.js';
import { resolveMcpLaunch } from '../kernel/manifest/manifest.js';
import type { RowVerifier } from '../kernel/identity/registry.js';
import { GNOMON_VERSION } from '../version.js';
import { heading, readout, refused, type Out } from './readout.js';

export const DESK_EXIT_OK = 0;
export const DESK_EXIT_REFUSED = 1;
export const DESK_EXIT_USAGE = 64;

export const DESK_USAGE = `gnomon ${GNOMON_VERSION} desk — the Desk (mod playbook offers)
usage: gnomon desk stats [<home>] [--json]
  stats   per mod: offers shown, opened, not now, stop here, kept, and kept/shown
`;

export interface DeskModStats {
  shown: number;
  open: number;
  notNow: number;
  stopHere: number;
  kept: number;
}

/** Fold offer rows (in log order) into per-mod counts. Decisions and kept rows count once per offer. */
export function foldDeskStats(rows: Iterable<{ kind: string; payload: unknown }>): Record<string, DeskModStats> {
  const byOffer = new Map<string, { mod: string; decided: boolean; kept: boolean }>();
  const out: Record<string, DeskModStats> = {};
  const of = (mod: string): DeskModStats => (out[mod] ??= { shown: 0, open: 0, notNow: 0, stopHere: 0, kept: 0 });
  for (const r of rows) {
    const p = r.payload !== null && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : {};
    const id = typeof p.offerId === 'string' ? p.offerId : null;
    if (!id) continue;
    if (r.kind === 'offer.shown' && typeof p.mod === 'string' && !byOffer.has(id)) {
      byOffer.set(id, { mod: p.mod, decided: false, kept: false });
      of(p.mod).shown++;
    } else if (r.kind === 'offer.decided') {
      const o = byOffer.get(id);
      if (!o || o.decided) continue;
      o.decided = true;
      const s = of(o.mod);
      if (p.decision === 'open') s.open++;
      else if (p.decision === 'not-now') s.notNow++;
      else if (p.decision === 'stop-here') s.stopHere++;
    } else if (r.kind === 'offer.kept') {
      const o = byOffer.get(id);
      if (!o || o.kept) continue;
      o.kept = true;
      of(o.mod).kept++;
    }
  }
  return out;
}

const pct = (kept: number, shown: number): string => (shown === 0 ? '-' : `${Math.round((kept / shown) * 100)}%`);

export async function runDeskCommand(argv: readonly string[], io: { stdout: Out; stderr: Out }): Promise<number> {
  const [verb, ...rest] = argv;
  if (!verb || verb === '--help' || verb === '-h' || verb === 'help') {
    (verb ? io.stdout : io.stderr).write(DESK_USAGE);
    return verb ? DESK_EXIT_OK : DESK_EXIT_USAGE;
  }
  if (verb !== 'stats') {
    refused(io.stderr, 'usage', 'unknown-verb', `unknown verb ${verb.slice(0, 32)}`, ['gnomon desk --help']);
    return DESK_EXIT_USAGE;
  }
  let home: string | undefined;
  let json = false;
  for (const a of rest) {
    if (a === '--json') json = true;
    else if (!a.startsWith('-') && home === undefined && path.isAbsolute(a)) home = a;
    else {
      refused(io.stderr, 'usage', 'bad-argument', `unexpected ${a.slice(0, 80)} (the home must be an absolute path)`, ['gnomon desk --help']);
      return DESK_EXIT_USAGE;
    }
  }
  home = path.resolve(home ?? resolveGnomonHome());
  const pubs = readKernelPubs(home);
  const ring = new KeyRing();
  for (const k of pubs) ring.addEd25519(k.publicKeyPem);
  const rows: Array<{ kind: string; payload: unknown }> = [];
  let report: ReturnType<typeof verifyLog>;
  try {
    report = verifyLog(home, {
      keyRing: ring,
      kernelPrincipal: kernelPrincipalOf(),
      kernelKeyIds: pubs.map((k) => k.keyId),
      onRow: (r) => {
        if (!r.kind.startsWith('offer.')) return;
        try {
          rows.push({ kind: r.kind, payload: (JSON.parse(r.envelope) as { payload?: unknown }).payload });
        } catch {
          /* an envelope verify accepted always parses */
        }
      },
    });
  } catch (err) {
    refused(io.stderr, 'ENGINE', 'log-unreadable', `could not read the log: ${(err as Error).message}`, ['check the home path']);
    return DESK_EXIT_REFUSED;
  }
  if (!report.ok) {
    refused(io.stderr, 'INTEGRITY_BROKEN', 'verify-failed', `${report.failures.length} verify failure(s); an unverified log is never counted`);
    return DESK_EXIT_REFUSED;
  }
  const stats = foldDeskStats(rows);
  const mods = Object.keys(stats).sort();
  if (json) {
    io.stdout.write(`${JSON.stringify({ rows: report.rows, mods: Object.fromEntries(mods.map((m) => [m, { ...stats[m], keptPerShown: stats[m]!.shown ? stats[m]!.kept / stats[m]!.shown : null }])) })}\n`);
    return DESK_EXIT_OK;
  }
  heading(io.stdout, 'desk', `${mods.length} mod(s) offered`);
  if (!mods.length) {
    io.stdout.write('  no offer shown yet\n');
    return DESK_EXIT_OK;
  }
  readout(io.stdout, mods.map((m) => {
    const s = stats[m]!;
    return [m, `shown ${s.shown} · open ${s.open} · not now ${s.notNow} · stop here ${s.stopHere} · kept ${s.kept} · kept/shown ${pct(s.kept, s.shown)}`] as const;
  }));
  return DESK_EXIT_OK;
}

/** `gnomon mod config …` (mod-cli delegates here; home and trust already resolved). */
export function runModConfig(argv: readonly string[], io: { stdout: Out; stderr: Out }, ctx: { home: string; trust: RowVerifier; env: NodeJS.ProcessEnv; now?: () => Date }): number {
  const [name, ...rest] = argv;
  if (!name || !/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
    refused(io.stderr, 'usage', 'bad-name', 'gnomon mod config needs a mod name (a-z, 0-9, -)', ['gnomon mod config <mod> --command <abs> --args …']);
    return DESK_EXIT_USAGE;
  }
  if (typeof ctx.env.GNOMON_HSID === 'string' && ctx.env.GNOMON_HSID.length > 0) {
    refused(io.stderr, 'forbidden', 'kernel-spawned-shell', 'gnomon mod config is human-only; it is refused from a kernel-spawned shell', ['ask the human to run it in their own terminal']);
    return DESK_EXIT_REFUSED;
  }
  let server: string | undefined;
  const config: { command?: string; args?: string[]; env?: Record<string, string> } = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--server' && rest[i + 1] !== undefined) server = rest[++i];
    else if (a === '--command' && rest[i + 1] !== undefined) config.command = rest[++i];
    else if (a === '--args') {
      config.args ??= [];
      while (i + 1 < rest.length && !rest[i + 1]!.startsWith('--')) config.args.push(rest[++i]!);
    } else if (a === '--env' && rest[i + 1] !== undefined) {
      const kv = rest[++i]!;
      const eq = kv.indexOf('=');
      if (eq <= 0) {
        refused(io.stderr, 'usage', 'bad-env', '--env takes NAME=value');
        return DESK_EXIT_USAGE;
      }
      (config.env ??= {})[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else {
      refused(io.stderr, 'usage', 'bad-argument', `unexpected ${a.slice(0, 80)}`, ['gnomon mod config <mod> [--server <name>] [--command <abs>] [--args …] [--env NAME=value]']);
      return DESK_EXIT_USAGE;
    }
  }
  if (config.command === undefined && config.args === undefined && config.env === undefined) {
    refused(io.stderr, 'usage', 'nothing-to-set', 'give --command, --args or --env');
    return DESK_EXIT_USAGE;
  }
  const mod = readDeskMods(ctx.home, ctx.trust).find((m) => m.name === name);
  if (!mod) {
    refused(io.stderr, 'not_found', 'not-installed', `${name} is not an installed, granted mod`, ['gnomon mod list']);
    return DESK_EXIT_REFUSED;
  }
  const entries = mod.manifest.provides?.mcp ?? [];
  const entry = server !== undefined ? entries.find((e) => e.name === server) : entries.length === 1 ? entries[0] : entries.find((e) => e.name === name);
  if (!entry) {
    refused(io.stderr, 'not_found', 'no-server', `${name} declares ${entries.length} mcp server(s); name one with --server`, entries.map((e) => `--server ${e.name}`));
    return DESK_EXIT_USAGE;
  }
  try {
    requestMcpConfig(ctx.home, mod, entry.name, config, ctx.now?.());
  } catch (err) {
    refused(io.stderr, 'forbidden', 'not-declared', (err as Error).message.slice(0, 300), ['the mod author decides what a user may set (provides.mcp[].config)']);
    return DESK_EXIT_REFUSED;
  }
  io.stdout.write(`REQUESTED  ${name} ${entry.name}\n`);
  for (const l of launchCardLines(name, entry.name, resolveMcpLaunch(entry, config))) io.stdout.write(`  │ ${l}\n`);
  readout(io.stdout, [
    ['signed', 'nothing (the request takes no effect until the card is allowed)'],
    ['decide', daemonState(ctx.home).state === 'running' ? 'in the GUI: the running kernel raises this card' : 'start the kernel (gnomon up); it raises this card in the GUI'],
  ]);
  return DESK_EXIT_OK;
}
