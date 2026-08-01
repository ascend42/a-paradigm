/**
 * #warplined — the solo Warpline daemon: THE FABRIC WITH A NETWORK FACE
 * (arky-architecture.md §1.1; roadmap-native-first.md PHASE 1; Aegis stage 1).
 * No database beside it — every verb calls the SAME engine function the CLI
 * calls, in-process, against the same `.warpline/` fabric; write verbs run
 * under the existing fabric lock exactly as the CLI does (the engine functions
 * acquire it). G4: no other mutation path exists here.
 *
 * Transport: NDJSON over a unix domain socket (see protocol.ts for the choice
 * rationale). One line in = one RpcRequest; one line out = one RpcResponse
 * whose `result` is the engine shape VERBATIM (G3).
 *
 * STAGE-1 IDENTITY (aegis-security.md §1.2): every request carries a bearer
 * token; the daemon resolves it (tokens.ts) and STAMPS the principal as
 * actor/agentId on every engine call. Client-supplied identity fields
 * (`params.agentId`, `params.actor`, `params.decidedBy`) are advisory and
 * IGNORED — the session is the truth. The verb × principal matrix (§2.2):
 * resolve / stake / stake.recover and the override flags acceptBreach /
 * acceptRisk are human-class only — an agent must never accept its own breach.
 * Overrides that DO run are additionally audited by the engine itself (claim
 * evaluations / grade-escalation sidecar rows — reused, not duplicated).
 *
 * AUDIT (stage-1 MUST): one append-only line per API call —
 * `.warpline/daemon/audit.jsonl`, `daemonAudit:v1`
 * {ts, principal, kind, verb, target, ok, code?} — including refusals.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { warplineDirOf, readFabric } from '../fabric/fabric.js';
import { listRefs, heads, readRef } from '../fabric/refs.js';
import { readScratch } from '../fabric/scratch.js';
import { parentsOf } from '../fabric/dag.js';
import { summarizeKnotPayload } from '../fabric/knot-payload.js';
import { VERB_DESCRIPTORS, toolNameOf, UNTRUSTED_CONTENT_SENTENCE, nextLegalVerbsFor } from './descriptors.js';
import {
  forkNative,
  proposeNative,
  admitNative,
  resolveNative,
} from '../fabric/native.js';
import { shadowAdmit, readShadowVerdicts } from '../fabric/shadow.js';
import { readKnotPayload, listKnotPayloads } from '../fabric/knot-payload.js';
import { gradeFabric } from '../fabric/grade.js';
import { stake, stakeRecover } from '../fabric/stake.js';
import { WORKTREE_REF } from '../absorb.js';
import type { CreateClaimInput } from '../fabric/claim.js';
import {
  RPC_SCHEMA,
  DAEMON_VERBS,
  HUMAN_ONLY_VERBS,
  HUMAN_ONLY_ADMIT_FLAGS,
  READ_ONLY_VERBS,
  type RpcRequest,
  type RpcResponse,
  type RpcErrorCode,
} from './protocol.js';
import { backupFabric } from '../fabric/backup.js';
import { refuse, refusalOf, RefusedError } from '../fabric/refusal.js';
import { resolveToken, type Principal } from './tokens.js';
import { acquireDaemonLock, releaseDaemonLock } from './lifecycle.js';

export const DAEMON_AUDIT_SCHEMA = 'daemonAudit:v1' as const;

/** One audit row per API call (success AND refusal) — Aegis stage-1 MUST. */
export interface DaemonAuditRow {
  schemaVersion: typeof DAEMON_AUDIT_SCHEMA;
  ts: string;
  /** the SERVER-RESOLVED principal — '(unauthenticated)' on an AUTH refusal. */
  principal: string;
  kind: 'human' | 'agent' | null;
  verb: string;
  /** a structural request summary (selector / worktree / flags) — never prose. */
  target: string | null;
  ok: boolean;
  code?: RpcErrorCode;
  /**
   * PW-8 (additive): the refusal code of a VERDICT-CLASS refusal riding inside
   * an ok result (CLAIM_BREACH/TRUST_HELD/GATE_REFUSED…). Before this field,
   * `ok:true` masked exactly the refusals the founder constraint is about —
   * the audit-log twin of the T-2026-07-21-006 exit-code bug. Derived via
   * `refusalOf` (refusal.ts) — which knows BOTH the engine shape's own
   * `refusal` AND the shadow envelope's nested `result.refusal` (C-16) — per
   * the same rule as exitCodeForResult. `ok` is unchanged and still means "the
   * dispatch produced a result": a verdict-class refusal is an ok row CARRYING
   * a resultCode, on the shadow path exactly as on the direct one. (f4Trace,
   * not this audit, remains F4 ground truth.)
   */
  resultCode?: RpcErrorCode;
}

export function daemonAuditPathOf(root: string): string {
  return path.join(warplineDirOf(root), 'daemon', 'audit.jsonl');
}

function appendAudit(root: string, row: DaemonAuditRow): void {
  const p = daemonAuditPathOf(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(row) + '\n', 'utf8');
}

/** Read the daemon audit rows (telemetry posture: bad lines skipped). */
export function readDaemonAudit(root: string): DaemonAuditRow[] {
  let raw: string;
  try {
    raw = fs.readFileSync(daemonAuditPathOf(root), 'utf8');
  } catch {
    return [];
  }
  const out: DaemonAuditRow[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as DaemonAuditRow);
    } catch {
      /* skip */
    }
  }
  return out;
}

/* ── param plucking (typed, advisory-identity-discarding) ───────────────────── */

const str = (p: Record<string, unknown>, k: string): string | undefined =>
  typeof p[k] === 'string' && (p[k] as string).length > 0 ? (p[k] as string) : undefined;
const bool = (p: Record<string, unknown>, k: string): boolean => p[k] === true;
const num = (p: Record<string, unknown>, k: string): number | undefined =>
  typeof p[k] === 'number' && Number.isFinite(p[k] as number) ? (p[k] as number) : undefined;

class RpcFailure extends Error {
  constructor(
    public code: RpcErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface StartDaemonOptions {
  /** override the socket path (default `.warpline/daemon.sock`) — mainly for
   * tests where the fixture path would exceed the OS socket-path limit. */
  socketPath?: string;
}

export interface DaemonHandle {
  root: string;
  socketPath: string;
  pid: number;
  startedAt: string;
  close(): Promise<void>;
}

/**
 * Start `warplined` for one fabric: acquire the single-instance lock, bind the
 * socket (0600), serve verbs until closed. NEVER call against a live project
 * fabric in tests — fixtures only.
 */
export async function startDaemon(root: string, opts: StartDaemonOptions = {}): Promise<DaemonHandle> {
  const startedAt = new Date().toISOString();
  const sock = acquireDaemonLock(root, process.pid, { socketPath: opts.socketPath, now: startedAt });

  const handleRequest = async (req: RpcRequest): Promise<RpcResponse> => {
    const id = req.id ?? null;
    const verb = typeof req.verb === 'string' ? req.verb : '';
    const params: Record<string, unknown> =
      req.params && typeof req.params === 'object' && !Array.isArray(req.params) ? (req.params as Record<string, unknown>) : {};
    // AUTH — every verb requires a resolvable token (stage 1: no anonymous reads;
    // the sidecars behind these verbs are trust data, Aegis §2.3).
    const who: Principal | null = resolveToken(root, req.token);
    const audit = (ok: boolean, code?: RpcErrorCode, resultCode?: RpcErrorCode): void => {
      try {
        appendAudit(root, {
          schemaVersion: DAEMON_AUDIT_SCHEMA,
          ts: new Date().toISOString(),
          principal: who?.principal ?? '(unauthenticated)',
          kind: who?.kind ?? null,
          verb: verb || '(none)',
          target: targetOf(params),
          ok,
          ...(code ? { code } : {}),
          ...(resultCode ? { resultCode } : {}),
        });
      } catch {
        /* the audit line must never take the daemon down */
      }
    };
    try {
      if (id === null || typeof verb !== 'string' || !verb) {
        throw new RpcFailure('BAD_REQUEST', 'frame needs {rpc, id, verb}');
      }
      if (!who) throw new RpcFailure('AUTH', 'missing or unknown token — mint one with `warpline daemon token mint <name> --kind human|agent` (local CLI only)');
      if (!(DAEMON_VERBS as readonly string[]).includes(verb)) {
        throw new RpcFailure('UNKNOWN_VERB', `unknown verb ${JSON.stringify(verb)} — verbs: ${DAEMON_VERBS.join(', ')}`);
      }
      // Read-SCOPE ceiling (the console class, tokens.ts): a scope:'read' token
      // may only invoke READ_ONLY_VERBS — checked structurally BEFORE the kind
      // matrix, so even a human-class read token holds no write capability.
      if (who.scope === 'read' && !READ_ONLY_VERBS.includes(verb)) {
        throw new RpcFailure(
          'FORBIDDEN',
          `verb ${verb} is outside the read scope (scope:'read' tokens are capped at: ${READ_ONLY_VERBS.join(', ')}) — principal ${JSON.stringify(who.principal)}`,
        );
      }
      // The verb × principal matrix (Aegis §2.2) — human-class-only verbs.
      if (who.kind === 'agent' && HUMAN_ONLY_VERBS.includes(verb)) {
        throw new RpcFailure('FORBIDDEN', `verb ${verb} is human-class only (Aegis §2.2) — principal ${JSON.stringify(who.principal)} is kind:agent`);
      }
      const result = await dispatch(root, verb, params, who);
      // PW-8: a VERDICT-CLASS refusal riding inside an ok result is audited
      // (resultCode), not masked — same derivation rule as exitCodeForResult.
      // C-16: the probe that stood here read the OUTER object only, so the
      // SHADOW path (`{shadow, row, result}` — the engine shape is nested one
      // level down) audited as a clean ok:true with no resultCode at all: the
      // very masking PW-8 was written to close, reopened by an envelope. The
      // depths now live in ONE accessor (refusal.ts refusalOf) that both this
      // probe and the MCP skin's isError probe share, so neither can drift.
      const inResult = refusalOf(result);
      audit(true, undefined, inResult?.code);
      return { rpc: RPC_SCHEMA, id, ok: true, result };
    } catch (err) {
      // PW-2: an engine-boundary RefusedError CARRIES its refusal — emit it
      // verbatim (code included) instead of collapsing to ENGINE/retry-identical,
      // which instructed cold agents to retry a call that fails forever.
      if (err instanceof RefusedError) {
        audit(false, err.refusal.code);
        return { rpc: RPC_SCHEMA, id, ok: false, error: { code: err.refusal.code, message: err.message, refusal: err.refusal } };
      }
      const f = err instanceof RpcFailure ? err : new RpcFailure('ENGINE', err instanceof Error ? err.message : String(err));
      audit(false, f.code);
      // SP2: the error frame carries the SAME refusal:v1 every gate hands back
      // (code tables give gate/retriability; message stays human-only). Built at
      // THIS single boundary so no RpcFailure site can forget it. AUTH carries
      // its escalation ladder (PW-3c): minting is the human's CLI act.
      const refusal =
        f.code === 'AUTH'
          ? refuse({
              code: 'AUTH',
              next: [{ verb: 'daemon.token.mint', params: {}, requires: ['name', 'kind'], principal: 'human' }],
            })
          : refuse({ code: f.code });
      return { rpc: RPC_SCHEMA, id, ok: false, error: { code: f.code, message: f.message, refusal } };
    }
  };

  const dispatch = async (
    r: string,
    verb: string,
    params: Record<string, unknown>,
    who: Principal,
  ): Promise<unknown> => {
    const wdir = warplineDirOf(r);
    switch (verb) {
      case 'status': {
        // PW-6 — the RELOCATED F4 carrier: hosts defer/truncate tool
        // descriptions to names-only, but nothing truncates a RESULT. status
        // teaches the cycle AND the caller's position in it, so a cold agent
        // recovers orientation from one call. All fields additive (G1).
        let scratch: string | null = null;
        let proposalSealed = false;
        let behindSelvage = false;
        let knotOpen = false;
        let selvageTip: string | null = null;
        try {
          scratch = readScratch(r, who.principal);
          selvageTip = readRef(wdir, 'selvage');
          if (scratch?.startsWith('pick:')) {
            const strand = readFabric(wdir).find((s) => s.pickId === scratch);
            // The scratch tip IS this principal's sealed proposal (propose
            // advanced it) — vs the fork base it was minted at (a tip strand
            // someone else authored, or the base itself).
            proposalSealed = !!strand && strand.authoredBy?.agentId === who.principal;
            const base = proposalSealed && strand ? (parentsOf(strand)[0] ?? null) : scratch;
            behindSelvage = selvageTip !== null && base !== selvageTip;
            // FG-3 finding 2: a KNOT work order naming THIS principal's CURRENT
            // sealed proposal means the contest is live. Keyed on stateId, so
            // re-proposing (a new stateId) correctly clears it — the new
            // proposal has not been judged yet.
            if (proposalSealed && strand) {
              knotOpen = listKnotPayloads(r).some(
                (p) => p.ours.agentId === who.principal && p.ours.stateId === strand.stateId,
              );
            }
          }
        } catch {
          /* status stays best-effort — orientation must never throw */
        }
        // the rule is DATA in #warplined-descriptors, so it rides descriptorsId
        // and the FG-3 freeze covers the carrier and not just the descriptions.
        const next = nextLegalVerbsFor({ scratchPresent: scratch !== null, proposalSealed, behindSelvage, knotOpen });
        return {
          schemaVersion: RPC_SCHEMA,
          pid: process.pid,
          startedAt,
          uptimeMs: Date.now() - Date.parse(startedAt),
          root: r,
          principal: who.principal,
          kind: who.kind,
          scope: who.scope ?? null,
          selvage: (() => {
            try {
              return listRefs(wdir).get('selvage') ?? null;
            } catch {
              return null;
            }
          })(),
          verbs: [...DAEMON_VERBS],
          // ── PW-6 state-aware self-description (additive) ──
          cycle: DAEMON_VERBS.map((v) => ({
            verb: v,
            stage: VERB_DESCRIPTORS[v].cycleStage,
            principal: VERB_DESCRIPTORS[v].principal,
          })),
          position: {
            scratchPresent: scratch !== null,
            scratchIsPickId: scratch?.startsWith('pick:') ?? false,
            proposalSealed,
            behindSelvage,
            knotOpen,
          },
          nextLegalVerbs: next.verbs,
          nextBecause: next.because,
          toolMap: Object.fromEntries(DAEMON_VERBS.map((v) => [v, toolNameOf(v)])),
          untrustedContent: UNTRUSTED_CONTENT_SENTENCE,
        };
      }
      case 'refs.list':
        return { refs: Object.fromEntries(listRefs(wdir)), heads: heads(wdir) };
      case 'fork':
        // SERVER-STAMPED: the scratch ref belongs to the SESSION principal —
        // params.agentId is ignored.
        return forkNative(r, who.principal, { into: str(params, 'into') });
      case 'propose': {
        const intent = str(params, 'intent');
        if (!intent) throw new RpcFailure('BAD_REQUEST', 'propose needs params.intent (I3 — an intent-less propose is refused)');
        const claim = params.claim && typeof params.claim === 'object' && !Array.isArray(params.claim)
          ? (params.claim as Omit<CreateClaimInput, 'agentId' | 'intent'> & { intent?: string })
          : undefined;
        return proposeNative(r, {
          worktree: str(params, 'worktree') ?? r,
          agentId: who.principal, // server-stamped (params.agentId ignored)
          actor: who.principal, // server-stamped (params.actor ignored)
          intent,
          ...(claim ? { claim } : {}),
          ...(str(params, 'now') ? { now: str(params, 'now') } : {}),
          ...(str(params, 'sessionKey') ? { sessionKey: str(params, 'sessionKey') } : {}),
        });
      }
      case 'admit': {
        // Override flags are human-class only (Aegis §2.2) — checked BEFORE
        // any engine work so the refusal is structural, not conditional.
        if (who.kind === 'agent') {
          for (const flag of HUMAN_ONLY_ADMIT_FLAGS) {
            if (bool(params, flag)) {
              throw new RpcFailure(
                'FORBIDDEN',
                `admit ${flag} is a human-class override (an agent must never accept its own ${flag === 'acceptBreach' ? 'breach' : 'risk'}; Aegis §2.2) — principal ${JSON.stringify(who.principal)} is kind:agent`,
              );
            }
          }
        }
        if (bool(params, 'shadow')) {
          // R1 shadow gate over the daemon: same routing as `admit --shadow`
          // (observe-only; the row is the only write).
          const { result, row } = await shadowAdmit(r, {
            cwd: str(params, 'worktree') ?? r,
            agentId: who.principal, // server-stamped
            ref: WORKTREE_REF,
            ...(str(params, 'claim') ? { claim: str(params, 'claim') } : {}),
            ...(bool(params, 'acceptBreach') ? { acceptBreach: true } : {}),
            ...(bool(params, 'acceptRisk') ? { acceptRisk: true } : {}),
          });
          return { shadow: true, row, result };
        }
        return admitNative(r, {
          worktree: str(params, 'worktree') ?? r,
          agentId: who.principal, // server-stamped (params.agentId ignored)
          actor: who.principal, // server-stamped
          ...(str(params, 'intent') ? { intent: str(params, 'intent') } : {}),
          ...(str(params, 'claim') ? { claim: str(params, 'claim') } : {}),
          ...(bool(params, 'acceptBreach') ? { acceptBreach: true } : {}),
          ...(bool(params, 'acceptRisk') ? { acceptRisk: true } : {}),
          ...(str(params, 'now') ? { now: str(params, 'now') } : {}),
          ...(bool(params, 'noRestore') ? { noRestore: true } : {}),
        });
      }
      case 'knot.show': {
        const selector = str(params, 'selector');
        if (!selector) throw new RpcFailure('BAD_REQUEST', 'knot.show needs params.selector');
        const payload = readKnotPayload(r, selector);
        if (!payload) throw new RpcFailure('NOT_FOUND', `no KNOT payload matches ${JSON.stringify(selector)}`);
        // PW-7: summary=true bounds the recovery path's largest result — the
        // structural index without file bodies (totals stay honest).
        return bool(params, 'summary') ? summarizeKnotPayload(payload) : payload;
      }
      case 'resolve': {
        // params.agentId here is a TARGET (whose scratch strand is being
        // resolved), not an identity claim — but decidedBy IS identity and is
        // server-stamped from the session (params.decidedBy ignored).
        const agentId = str(params, 'agentId');
        const reason = str(params, 'reason');
        if (!agentId || !reason) throw new RpcFailure('BAD_REQUEST', 'resolve needs params.agentId (whose scratch) and params.reason (the accountability record)');
        return resolveNative(r, {
          worktree: str(params, 'worktree') ?? r,
          agentId,
          reason,
          decidedBy: who.principal, // server-stamped
          ...(str(params, 'now') ? { now: str(params, 'now') } : {}),
        });
      }
      case 'stake':
        return stake(r, { selector: str(params, 'selector'), actor: who.principal });
      case 'stake.recover': {
        const commit = str(params, 'commit');
        if (!commit) throw new RpcFailure('BAD_REQUEST', 'stake.recover needs params.commit');
        return stakeRecover(r, commit, { actor: who.principal });
      }
      case 'grade.report':
        // Report ONLY — applyGrades (the sidecar write) never rides the daemon;
        // grading stays a human/calibration-process act (Aegis §2.2).
        return gradeFabric(r, { window: num(params, 'window') });
      case 'shadow.tail': {
        const n = num(params, 'n') ?? 20;
        const rows = readShadowVerdicts(r);
        return { rows: rows.slice(-Math.max(0, Math.floor(n))), total: rows.length };
      }
      case 'backup': {
        // Custodianship (human-class only, enforced above): atomic snapshot of
        // THIS fabric into params.dest. The one verb whose write lands OUTSIDE
        // `.warpline/` — it writes to dest only; the source fabric is read
        // under the same fabric lock the CLI takes (backupFabric acquires it).
        const dest = str(params, 'dest');
        if (!dest) throw new RpcFailure('BAD_REQUEST', 'backup needs params.dest (the snapshot directory to create)');
        return backupFabric(r, dest);
      }
      default:
        throw new RpcFailure('UNKNOWN_VERB', `unknown verb ${JSON.stringify(verb)}`);
    }
  };

  const server = net.createServer((conn) => {
    let buffer = '';
    // Per-connection serial queue: frames on one connection answer IN ORDER
    // (ids still correlate; cross-connection concurrency is the fabric lock's job).
    let chain: Promise<void> = Promise.resolve();
    conn.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        chain = chain.then(async () => {
          let resp: RpcResponse;
          try {
            const req = JSON.parse(line) as RpcRequest;
            resp = await handleRequest(req);
          } catch {
            resp = { rpc: RPC_SCHEMA, id: null, ok: false, error: { code: 'BAD_REQUEST', message: 'unparseable frame (one JSON object per line)' } };
          }
          if (!conn.destroyed) conn.write(JSON.stringify(resp) + '\n');
        });
      }
    });
    conn.on('error', () => {
      /* client went away mid-write — nothing to do */
    });
  });

  return new Promise<DaemonHandle>((resolvePromise, rejectPromise) => {
    server.once('error', (err) => {
      releaseDaemonLock(root, process.pid);
      rejectPromise(err);
    });
    server.listen(sock, () => {
      try {
        fs.chmodSync(sock, 0o600); // Aegis stage-1 MUST: socket mode 0600
      } catch {
        /* exotic fs — the pidfile+token layers still hold */
      }
      let closed = false;
      resolvePromise({
        root,
        socketPath: sock,
        pid: process.pid,
        startedAt,
        close: () =>
          new Promise<void>((res) => {
            if (closed) return res();
            closed = true;
            server.close(() => {
              releaseDaemonLock(root, process.pid);
              res();
            });
          }),
      });
    });
  });
}

/** Structural request summary for the audit row — selectors/paths/flags only,
 * NEVER free prose (reasons/intents are agent text; the audit is a log sink —
 * aegis-security.md §4.1: log the address, never the body). */
function targetOf(params: Record<string, unknown>): string | null {
  const bits: string[] = [];
  for (const k of ['selector', 'commit', 'agentId', 'claim', 'worktree', 'into', 'dest']) {
    const v = params[k];
    if (typeof v === 'string' && v) bits.push(`${k}=${v}`);
  }
  for (const k of ['acceptBreach', 'acceptRisk', 'shadow', 'noRestore']) {
    if (params[k] === true) bits.push(k);
  }
  return bits.length ? bits.join(' ') : null;
}
