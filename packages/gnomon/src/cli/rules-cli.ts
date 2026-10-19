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
 * REVOKE is refused UNSUPPORTED: revoking a rule needs a new kernel-signed
 * event kind (`approval.rule.revoked`), which moves clientApiId; it was not
 * added (reported). It will be human-only (fresh presence) when it lands.
 */
import * as path from 'node:path';
import { kernelPrincipalOf, resolveGnomonHome } from '../kernel/lifecycle/index.js';
import { readKernelPubs } from '../kernel/identity/index.js';
import { KeyRing, verifyLog } from '../kernel/log/index.js';
import { RuleBook, RULE_KINDS, type AlwaysRule } from '../kernel/supervisor/rules.js';
import { GNOMON_VERSION } from '../version.js';
import { heading, readout, refused, type Out } from './readout.js';

export const RULES_EXIT_OK = 0;
export const RULES_EXIT_REFUSED = 1;
export const RULES_EXIT_USAGE = 64;

export const RULES_USAGE = `usage: gnomon rules list [<home>] [--json]
       gnomon rules revoke <rule id>

  list    Verifies the kernel log of <home> (default: the Gnomon home) and lists
          the standing "always allow" rules derived from kernel-signed rows:
          id (the card it was learned on), tool, repoKey, inputHash. Read-only.
  revoke  Not available yet: it needs a new kernel event kind (refused).
`;

/** The rules a verified log yields (rows parsed from the verified envelopes; kernel-signed only). */
export function rulesOfHome(home: string): { ok: true; rules: AlwaysRule[]; rows: number } | { ok: false; why: string } {
  const pubs = readKernelPubs(home);
  const ring = new KeyRing();
  for (const k of pubs) ring.addEd25519(k.publicKeyPem);
  const kernelPrincipal = kernelPrincipalOf();
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
  if (sub === 'revoke') {
    refused(io.stderr, 'UNSUPPORTED', 'not-implemented', 'revoking a rule needs a new kernel-signed event kind (approval.rule.revoked), which moves clientApiId; it is not built yet', ['gnomon rules list']);
    return RULES_EXIT_REFUSED;
  }
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
  for (const x of r.rules) readout(io.stdout, [['id', x.ruleId], ['tool', x.tool], ['repoKey', x.repoKey], ['inputHash', x.inputHash], ['presence', x.presence]]);
  return RULES_EXIT_OK;
}
