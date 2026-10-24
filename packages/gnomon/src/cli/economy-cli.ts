/**
 * @symbol #turn-economy
 *
 * The turn-economy CLI (orchestration design §12, Phase 0 item 1).
 *
 *   gnomon economy stats [<home>] [--json]
 *       Verifies the kernel log (as `gnomon replay` and `gnomon desk stats` do) and folds turn.event / turn.sent /
 *       turn.result / session.open into one row per turn: model calls, Read / Grep / Glob before the first edit,
 *       context at turn start, cache-read share and subagent tokens by model. Lines stored by hash only (over the
 *       cap, or a control_request) are not read; the coverage line says how many. Numbers only: no row carries
 *       text. Read-only; runs with or without a daemon. An unverified log is refused.
 */
import * as path from 'node:path';
import { kernelPrincipalOf, resolveGnomonHome } from '../kernel/lifecycle/index.js';
import { readKernelPubs } from '../kernel/identity/index.js';
import { KeyRing, verifyLog } from '../kernel/log/index.js';
import { ECONOMY_KINDS, EconomyFold, type TurnEconomyRow } from '../kernel/desk/turn-economy.js';
import { GNOMON_VERSION } from '../version.js';
import { heading, readout, refused, type Out } from './readout.js';

export const ECONOMY_EXIT_OK = 0;
export const ECONOMY_EXIT_REFUSED = 1;
export const ECONOMY_EXIT_USAGE = 64;

export { ECONOMY_KINDS, foldTurnEconomy, EconomyFold, type EconomyRow, type TurnEconomy, type TurnEconomyRow } from '../kernel/desk/turn-economy.js';

export const ECONOMY_USAGE = `gnomon ${GNOMON_VERSION} economy — what each turn cost
usage: gnomon economy stats [<home>] [--json]
  stats   per turn: model calls, Read/Grep/Glob before the first edit, context at turn start, cache-read share,
          subagent tokens by model; and how many stream lines were stored by hash only (not read)
`;

const pct = (v: number | null): string => (v === null ? '-' : `${Math.round(v * 100)}%`);

export async function runEconomyCommand(argv: readonly string[], io: { stdout: Out; stderr: Out }): Promise<number> {
  const [verb, ...rest] = argv;
  if (!verb || verb === '--help' || verb === '-h' || verb === 'help') {
    (verb ? io.stdout : io.stderr).write(ECONOMY_USAGE);
    return verb ? ECONOMY_EXIT_OK : ECONOMY_EXIT_USAGE;
  }
  if (verb !== 'stats') {
    refused(io.stderr, 'usage', 'unknown-verb', `unknown verb ${verb.slice(0, 32)}`, ['gnomon economy --help']);
    return ECONOMY_EXIT_USAGE;
  }
  let home: string | undefined;
  let json = false;
  for (const a of rest) {
    if (a === '--json') json = true;
    else if (!a.startsWith('-') && home === undefined && path.isAbsolute(a)) home = a;
    else {
      refused(io.stderr, 'usage', 'bad-argument', `unexpected ${a.slice(0, 80)} (the home must be an absolute path)`, ['gnomon economy --help']);
      return ECONOMY_EXIT_USAGE;
    }
  }
  home = path.resolve(home ?? resolveGnomonHome());
  const pubs = readKernelPubs(home);
  const ring = new KeyRing();
  for (const k of pubs) ring.addEd25519(k.publicKeyPem);
  // folded incrementally (as replay does): the turn.event lines are never buffered, only the finished rows
  const kernelPrincipal = kernelPrincipalOf();
  const fold = new EconomyFold({ kernelPrincipal });
  const turns: TurnEconomyRow[] = [];
  let report: ReturnType<typeof verifyLog>;
  try {
    report = verifyLog(home, {
      keyRing: ring,
      kernelPrincipal,
      kernelKeyIds: pubs.map((k) => k.keyId),
      onRow: (r) => {
        if (!ECONOMY_KINDS.includes(r.kind)) return;
        try {
          const env = JSON.parse(r.envelope) as { payload?: unknown; principal?: unknown; session?: unknown };
          const t = fold.push({ kind: r.kind, payload: env.payload, seq: r.seq, ...(typeof env.principal === 'string' ? { principal: env.principal } : {}), ...(typeof env.session === 'string' ? { session: env.session } : {}) });
          if (t) turns.push(t);
        } catch {
          /* an envelope verify accepted always parses */
        }
      },
    });
  } catch (err) {
    refused(io.stderr, 'ENGINE', 'log-unreadable', `could not read the log: ${(err as Error).message}`, ['check the home path']);
    return ECONOMY_EXIT_REFUSED;
  }
  if (!report.ok) {
    refused(io.stderr, 'INTEGRITY_BROKEN', 'verify-failed', `${report.failures.length} verify failure(s); an unverified log is never counted`);
    return ECONOMY_EXIT_REFUSED;
  }
  const econ = { rows: turns, coverage: fold.coverage() }; // report.ok: an unverified log was refused above, its folds discarded
  if (json) {
    io.stdout.write(`${JSON.stringify({ rows: report.rows, turns: econ.rows, coverage: econ.coverage })}\n`);
    return ECONOMY_EXIT_OK;
  }
  heading(io.stdout, 'economy', `${econ.rows.length} turn(s)`);
  if (!econ.rows.length) {
    io.stdout.write('  no finished turn yet\n');
    return ECONOMY_EXIT_OK;
  }
  readout(
    io.stdout,
    econ.rows.map((t) => {
      const sub = Object.entries(t.subagentTokensByModel).map(([m, n]) => `${m} ${n}`).join(', ') || '-';
      const e = t.preEditExplore;
      return [
        t.turn,
        `calls ${t.modelCalls}${t.foldedTurns > 1 ? ` (${t.foldedTurns} turns)` : ''} · explore R${e.read} G${e.grep} Gl${e.glob} · ctx ${t.ctxAtStart ?? '-'} · cache ${pct(t.cacheReadShare)} · subagents ${sub}${t.truncatedLines ? ` · ${t.truncatedLines} line(s) not read` : ''}`,
      ] as const;
    }),
  );
  const c = econ.coverage;
  readout(io.stdout, [['coverage', `${c.lines - c.truncated}/${c.lines} lines read (${pct(c.share)}); ${c.truncated} hash-only${c.truncatedAssistant ? `, ${c.truncatedAssistant} of them assistant lines (calls may be undercounted)` : ''}${c.unpaired ? `; ${c.unpaired} result(s) closed no turn` : ''}`]]);
  return ECONOMY_EXIT_OK;
}
