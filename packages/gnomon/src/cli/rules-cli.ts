/**
 * @symbol #rules-cli
 *
 * `gnomon rules list [<home>] [--json]` and `gnomon rules revoke <id>`
 * (spec §3.4 S-L1 `always`; gui-complete item 2). LIST verifies the kernel
 * log of the home read-only (verifyLog, like `gnomon replay`) and folds the
 * verified rows through the same #always-rules RuleBook the daemon uses:
 * only rows signed by the kernel principal with a kernel key recorded in the
 * home count, so a forged rule row is never listed. A log that does not
 * verify is REFUSED (nothing is listed from an unverified chain). Runs with or
 * without a daemon.
 *
 * REVOKE (P8-D98, TD-2026-10-19-528 F1) asks the RUNNING daemon of the home:
 * it reads the hello's key id, pins it from the home (root-signed registry,
 * else kernel-pub.jsonl — never from the server; an unpinned server is
 * refused, nothing is sent to it), authenticates as this home's human device
 * (device.key + its root-signed human registry row) and calls the
 * `rules.revoke{ruleId}` human-device verb (#rules-revoke). The kernel writes
 * the kernel-signed `approval.rule.revoked`; no presence prompt (revoking only
 * narrows). The kernel's refusals (NOT_FOUND, BAD_REQUEST, FORBIDDEN) are
 * printed as they come.
 */
import * as path from 'node:path';
import { RefusedError, refusalOf } from '@a-company/gnomon-contracts';
import { kernelPrincipalOf, resolveGnomonHome, selectSocketPath } from '../kernel/lifecycle/index.js';
import { loadDeviceCredential, readKernelPubs, readRegistry } from '../kernel/identity/index.js';
import { connectGnomon, ServerAuthError, type DeviceCredential } from '../kernel/socket/index.js';
import { kernelPinOf } from './daemon-cli.js';
import { homeTrust } from './mod-cli.js';
import { KeyRing, verifyLog } from '../kernel/log/index.js';
import { RuleBook, RULE_KINDS, type AlwaysRule } from '../kernel/supervisor/rules.js';
import { GNOMON_VERSION } from '../version.js';
import { heading, readout, refused, type Out } from './readout.js';

export const RULES_EXIT_OK = 0;
export const RULES_EXIT_REFUSED = 1;
export const RULES_EXIT_USAGE = 64;

export const RULES_USAGE = `usage: gnomon rules list [<home>] [--json]
       gnomon rules revoke <rule id> [--home <abs>] [--json]

  list    Verifies the kernel log of <home> (default: the Gnomon home) and lists
          the standing "always allow" rules derived from kernel-signed rows:
          id (the card it was learned on), tool, repoKey, match (exact, or prefix: the literal argv words), inputHash. Read-only.
  revoke  Asks the running daemon of the home to revoke the rule, as this
          home's human device (no Touch ID: revoking only narrows). The kernel
          logs approval.rule.revoked; the next exact match raises the card.
`;

/** The rules a verified log yields (rows parsed from the verified envelopes; kernel-signed only). */
export function rulesOfHome(home: string): { ok: true; rules: AlwaysRule[]; rows: number } | { ok: false; why: string } {
  const pubs = readKernelPubs(home);
  const ring = new KeyRing();
  for (const k of pubs) ring.addEd25519(k.publicKeyPem);
  // the kernel principal is namespaced by the home's root (daemon.ts kernelPrincipalOf(authority)); an
  // unprovisioned home has none and keeps the unprovisioned namespace
  const kernelPrincipal = kernelPrincipalOf(homeTrust(home));
  const ids = new Set(pubs.map((k) => k.keyId));
  const book = new RuleBook({ principal: kernelPrincipal, isKernelKey: (k) => ids.has(k) });
  const want = new Set<string>(RULE_KINDS);
  const seen: Array<{ seq: number; envelope: string; kind: string }> = [];
  const report = verifyLog(home, { keyRing: ring, kernelPrincipal, kernelKeyIds: [...ids], onRow: (r) => void (want.has(r.kind) && seen.push(r)) });
  if (!report.ok) return { ok: false, why: `${report.failures.length} verify failure(s); first: ${report.failures[0]?.code ?? '?'}` };
  for (const r of seen) {
    let e: { principal?: unknown; keyId?: unknown; payload?: unknown };
    try {
      e = JSON.parse(r.envelope) as typeof e;
    } catch {
      continue;
    }
    book.fold({ seq: r.seq, kind: r.kind, principal: typeof e.principal === 'string' ? e.principal : '', keyId: e.keyId, payload: e.payload });
  }
  return { ok: true, rules: book.list(), rows: report.rows };
}

export async function runRulesCommand(argv: readonly string[], io: { stdout: Out; stderr: Out }): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === '--help' || sub === '-h') {
    io.stdout.write(`gnomon ${GNOMON_VERSION}\n${RULES_USAGE}`);
    return sub === undefined ? RULES_EXIT_USAGE : RULES_EXIT_OK;
  }
  if (sub === 'revoke') return runRevoke(rest, io);
  if (sub !== 'list') {
    refused(io.stderr, 'BAD_REQUEST', 'usage', `unknown subcommand ${sub}`, ['gnomon rules --help']);
    return RULES_EXIT_USAGE;
  }
  let home: string | undefined;
  let json = false;
  for (const a of rest) {
    if (a === '--json') json = true;
    else if (!a.startsWith('-') && home === undefined) {
      if (!path.isAbsolute(a)) {
        refused(io.stderr, 'BAD_REQUEST', 'usage', 'the home must be an absolute path', ['gnomon rules --help']);
        return RULES_EXIT_USAGE;
      }
      home = a;
    } else {
      refused(io.stderr, 'BAD_REQUEST', 'usage', `unknown argument ${a}`, ['gnomon rules --help']);
      return RULES_EXIT_USAGE;
    }
  }
  home = path.resolve(home ?? resolveGnomonHome());
  let r: ReturnType<typeof rulesOfHome>;
  try {
    r = rulesOfHome(home);
  } catch (err) {
    refused(io.stderr, 'ENGINE', 'rules-unreadable', `could not read the log: ${(err as Error).message}`, ['check the home path']);
    return RULES_EXIT_REFUSED;
  }
  if (!r.ok) {
    refused(io.stderr, 'INTEGRITY_BROKEN', 'verify-failed', r.why, ['an unverified log is never read for rules']);
    return RULES_EXIT_REFUSED;
  }
  if (json) {
    io.stdout.write(`${JSON.stringify({ rules: r.rules })}\n`);
    return RULES_EXIT_OK;
  }
  heading(io.stdout, 'rules', `${r.rules.length} standing always-allow rule(s) · ${r.rows} rows verified`);
  for (const x of r.rules) readout(io.stdout, [['id', x.ruleId], ['tool', x.tool], ['repoKey', x.repoKey], ['match', x.match === 'prefix' ? `prefix: ${(x.prefix ?? []).join(' ')} …` : 'exact'], ...(x.match === 'prefix' ? [] : [['inputHash', x.inputHash] as [string, string]]), ['presence', x.presence]]);
  return RULES_EXIT_OK;
}

/** This home's human device credential: device.key and its root-signed human registry row (fail closed). */
export function humanDeviceOf(home: string): DeviceCredential | string {
  let signer;
  try {
    signer = loadDeviceCredential(home).signer;
  } catch (e) {
    return `the device key does not load: ${(e as Error).message}`;
  }
  const row = [...readRegistry(home, homeTrust(home)).devices.values()].find((d) => d.keyId === signer.keyId);
  if (!row || row.principalKind !== 'human') return 'this device key has no root-signed human registry row in the home';
  return { principalId: row.principalId, deviceId: row.deviceId, signer };
}

async function runRevoke(args: readonly string[], io: { stdout: Out; stderr: Out }): Promise<number> {
  let ruleId: string | undefined;
  let home: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--json') json = true;
    else if (a === '--home') {
      const h = args[++i];
      if (h === undefined || !path.isAbsolute(h)) {
        refused(io.stderr, 'BAD_REQUEST', 'usage', '--home takes an absolute path', ['gnomon rules --help']);
        return RULES_EXIT_USAGE;
      }
      home = h;
    } else if (!a.startsWith('-') && ruleId === undefined) ruleId = a;
    else {
      refused(io.stderr, 'BAD_REQUEST', 'usage', `unknown argument ${a}`, ['gnomon rules --help']);
      return RULES_EXIT_USAGE;
    }
  }
  if (ruleId === undefined) {
    refused(io.stderr, 'BAD_REQUEST', 'usage', 'name the rule to revoke (its id, from gnomon rules list)', ['gnomon rules list']);
    return RULES_EXIT_USAGE;
  }
  home = path.resolve(home ?? resolveGnomonHome());
  const sock = selectSocketPath({ home });
  if (!sock.ok) {
    refused(io.stderr, 'ENGINE', 'no-endpoint', `no safe endpoint path for ${home}`, []);
    return RULES_EXIT_REFUSED;
  }
  const device = humanDeviceOf(home);
  if (typeof device === 'string') {
    refused(io.stderr, 'FORBIDDEN', 'no-human-device', device, ['gnomon setup']);
    return RULES_EXIT_REFUSED;
  }
  const client = { name: 'gnomon', version: GNOMON_VERSION, surface: 'cli' as const };
  try {
    // 1) an unpinned hello only learns which key the server claims; 2) the pin comes from the home, never the server
    const probe = await connectGnomon({ socketPath: sock.path, client });
    await probe.conn.close();
    const found = kernelPinOf(home, probe.hello.serverKeyId);
    if (!found) {
      refused(io.stderr, 'FORBIDDEN', 'unverified-server', 'the key this server names is not registered in the home: nothing was sent to it', ['gnomon daemon status']);
      return RULES_EXIT_REFUSED;
    }
    const s = await connectGnomon({ socketPath: sock.path, client, serverKey: found.pin, device });
    try {
      const r = await s.conn.call('rules.revoke', { ruleId });
      if ('error' in r) {
        const data = refusalOf(r);
        refused(io.stderr, data?.code ?? 'ENGINE', String(data?.data?.reason ?? 'refused'), r.error.message, data?.code === 'NOT_FOUND' ? ['gnomon rules list'] : []);
        return RULES_EXIT_REFUSED;
      }
      if (json) io.stdout.write(`${JSON.stringify(r.result)}\n`);
      else {
        heading(io.stdout, 'revoked', ruleId);
        readout(io.stdout, [['logged', 'approval.rule.revoked (kernel-signed)'], ['next', 'an exact match raises the card again']]);
      }
      return RULES_EXIT_OK;
    } finally {
      await s.conn.close();
    }
  } catch (err) {
    if (err instanceof RefusedError || err instanceof ServerAuthError) {
      refused(io.stderr, err instanceof RefusedError ? err.refusal.code : 'FORBIDDEN', err instanceof RefusedError ? String(err.refusal.data?.reason ?? 'refused') : 'server-auth', err.message, []);
      return RULES_EXIT_REFUSED;
    }
    refused(io.stderr, 'ENGINE', 'not-running', `no daemon answers on ${home}: ${(err as Error).message}`, ['gnomond --home <abs> (or gnomon up), then retry']);
    return RULES_EXIT_REFUSED;
  }
}
