/**
 * @symbol #loop-agent-ops
 * @symbol #loop-registry
 *
 * #loop-agent-ops: the kernel's pre-gate for an AGENT's `loop.request{op, loopId, …}` (docs/specs/gnomon-loops.md §5
 * "What an agent may do", §3.1 "Attribution"; build plan step 12, LP7). Agents have no other userland append path
 * (log-append.ts); dispatch.ts routes `loop.request` here and nowhere else. The asker is stamped from the CONNECTION:
 * a `principal`, `hsid` or `by` in the payload is ignored (Aegis step 12).
 *
 *   | op             | an agent may                                                                          |
 *   |----------------|---------------------------------------------------------------------------------------|
 *   | create, update | attribute the definition it just wrote (`sourceHash` = its compiled source hash): the |
 *   |                | kernel row `loop.request{op, loopId, scope, repoKey, repo, sourceHash, by, hsid}`, then |
 *   |                | the loop's ONE `loop-trust` card. Never trusts (no envelope in 8.0, G-LOOP-03)          |
 *   | run            | trusted loops only (a manual trigger; budgets apply)                                  |
 *   | pause          | any loop (narrowing): `loop.paused{reason:'agent', by}`; a loop it did not author     |
 *   |                | also toasts the founder ("arky paused flow-health")                                   |
 *   | resume         | only a loop it paused itself (`agent` pause, `by` = this principal) in the current    |
 *   |                | kill epoch, never under a kernel or human pause; ONE catch-up run if a schedule or    |
 *   |                | continuous trigger came due during the pause                                          |
 *   | delete         | 8.0 (Aegis): ALWAYS a pause plus a founder toast; deleting is the founder's           |
 *   | runs, logs     | reads in a repo the agent names, redacted: verdicts, edges and counts, no evidence    |
 *   | trust-status   | who trusted which hash and when, in a repo the agent names; envelopes: none in 8.0    |
 *
 * Targets (Aegis): an agent names a repo the registry ALREADY knows (registry.repos()); the agent path never adds a
 * repo, so junk paths cannot evict real ones. An unknown repo and an unknown loop are the same NOT_FOUND (no
 * cross-repo enumeration). Rows carry the registry's repo root, never the agent's string.
 *
 * Residual (LL5): the kernel has no peer-pid or connection→session mapping (server.ts: no getpeereid), so a loop
 * session is recognised only by an hsid bound to the connection, and none is bound yet (no session-key auth). Loop
 * sessions get no socket, session key or GNOMON_* env (local-session.ts), which is what holds today.
 *
 * Refused outright: every class but `agent` (humans use request.loop.*; peers, voice, mods, read tokens and
 * sessions never), and a LOOP session (origin 'loop', LL5: a loop cannot create or widen a loop) by its hsid.
 * Reads write no row; every other op writes a kernel row (LL6). `repo` is a sensitive field of loop.request.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LOOP_REQUEST_OPS } from '@a-company/gnomon-contracts';
import type { CompiledLoop } from '../../loops/index.js';
import { calendarWindow, parseHhmm, WEEKDAYS } from '../scheduler/zoned.js';
import { RpcRefusal } from '../socket/rpc.js';
import type { LoopLedger, LoopRunRecord } from './ledger.js';
import { authorLabel, repoRootOf, type LoopEntry, type LoopRegistry, type LoopScopeName } from './registry.js';
import type { LoopRunner, LoopToast } from './runner.js';
import { hostTimeZone } from './timers.js';
import type { LoopAsker, LoopTrust } from './trust.js';

/** The read ops (no row; served here, not in the contract's row ops). */
export const LOOP_AGENT_READ_OPS: readonly string[] = Object.freeze(['runs', 'logs', 'trust-status']);
/** Every op an agent's loop.request may name. */
export const LOOP_AGENT_OPS: readonly string[] = Object.freeze([...LOOP_REQUEST_OPS, ...LOOP_AGENT_READ_OPS]);
/** Payload keys the kernel stamps itself: a client's value is dropped, never trusted. */
const STAMPED = ['principal', 'hsid', 'by', 'authoredBy', 'envelopeId'];

/** The connection an agent's request arrived on (dispatch.ts stamps it; never from params). */
export interface LoopAgentAsker extends LoopAsker {
  /** the kernel-spawned session this connection speaks for, when the connection is bound to one; else null */
  hsid: string | null;
}

export interface LoopAgentOpsOptions {
  registry: LoopRegistry;
  runner: LoopRunner;
  ledger: LoopLedger;
  trust: LoopTrust;
  /** append a kernel row (as the kernel principal) */
  append: (kind: string, payload: Record<string, unknown>, ids: { connId: string }) => Promise<void>;
  /** the founder's toast (absent: the delete-becomes-pause still pauses) */
  toast?: (t: LoopToast) => void;
  /** LL5: is this hsid a loop session (supervisor.isLoopSession)? */
  isLoopSession?: (hsid: string) => boolean;
  /** the zone daily/weekly triggers are read in (catch-up), default the host's */
  tz?: string;
  clock?: () => number;
}

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const REPO_KEY = /^sha256:[0-9a-f]{64}$/;

/** Did any schedule or continuous trigger of this loop come due between from and to (ms)? */
export function missedDuring(c: CompiledLoop, from: number, to: number, tz: string): boolean {
  if (!(to > from)) return false;
  for (const t of c.triggers) {
    if (t.type === 'continuous') return true;
    if (t.type !== 'schedule') continue;
    if (t.every !== undefined && to - from >= t.every * 1000) return true;
    const at = t.daily ?? t.weekly?.at;
    const minute = at === undefined ? null : parseHhmm(at);
    if (minute === null) continue;
    const weekday = t.weekly ? WEEKDAYS.indexOf(t.weekly.day as (typeof WEEKDAYS)[number]) : undefined;
    if (calendarWindow({ minute, tz, ...(weekday !== undefined && weekday >= 0 ? { weekday } : {}) }, from, to).count > 0) return true;
  }
  return false;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (msg: string, data?: Record<string, unknown>): RpcRefusal => new RpcRefusal('BAD_REQUEST', 'bad-params', msg, data);
const forbidden = (reason: string, msg: string, data?: Record<string, unknown>): RpcRefusal => new RpcRefusal('FORBIDDEN', reason, msg, data);

/** A run as an agent sees it: counts and verdicts, never evidence, node detail or the trigger's payload. */
export function redactRun(r: LoopRunRecord, withNodes: boolean): Record<string, unknown> {
  const verdicts: Record<string, number> = {};
  for (const n of r.nodes) verdicts[n.verdict] = (verdicts[n.verdict] ?? 0) + 1;
  const trig = isObj(r.trigger) && typeof r.trigger.type === 'string' ? r.trigger.type : undefined;
  return {
    runId: r.runId, loopId: r.loopId, ...(r.scope ? { scope: r.scope } : {}), ...(r.repoKey ? { repoKey: r.repoKey } : {}),
    ...(trig ? { trigger: trig } : {}), ...(r.parentRunId ? { parentRunId: r.parentRunId } : {}),
    ...(r.startedAt ? { startedAt: r.startedAt } : {}), ...(r.endedAt ? { endedAt: r.endedAt } : {}), ...(r.reason ? { reason: r.reason } : {}),
    rounds: r.rounds, computeMs: r.computeMs, nodeVisits: r.nodes.length, verdicts, notified: r.notified,
    ...(withNodes
      ? { nodes: r.nodes.slice(0, 256).map((n) => ({ nodeId: n.nodeId, ...(n.type ? { type: n.type } : {}), visit: n.visit, ...(n.round !== undefined ? { round: n.round } : {}), verdict: n.verdict, ...(n.edge ? { edge: n.edge } : {}), ...(n.next !== undefined ? { next: n.next } : {}), ...(n.durationMs !== undefined ? { durationMs: n.durationMs } : {}), ...(n.evidenceRef ? { evidence: 'withheld' } : {}) })) }
      : {}),
  };
}

export class LoopAgentOps {
  readonly #o: LoopAgentOpsOptions;

  constructor(o: LoopAgentOpsOptions) {
    this.#o = o;
  }

  async request(asker: LoopAgentAsker, payload: unknown): Promise<unknown> {
    // LL5 and the class matrix first, before the payload is read
    if (asker.principalClass === 'session') throw forbidden('loop-session', 'a session cannot ask for loop ops (LL5: a loop cannot create or widen a loop)');
    if (asker.principalClass !== 'agent' || !asker.principal || asker.credential === 'read-token') {
      throw forbidden('matrix', `loop.request is an agent's; ${asker.principalClass === 'human' ? 'the human uses request.loop.*' : 'peers, voice, mods and read tokens may not ask for loop ops'}`);
    }
    if (asker.hsid !== null && this.#o.isLoopSession?.(asker.hsid)) throw forbidden('loop-session', 'a loop session cannot ask for loop ops (LL5: a loop cannot create or widen a loop)');
    if (!isObj(payload)) throw bad('loop.request takes {op, loopId, scope, repo | repoKey, …}');
    const op = payload.op;
    if (typeof op !== 'string' || !LOOP_AGENT_OPS.includes(op)) throw bad(`op is one of ${LOOP_AGENT_OPS.join(', ')}`, { field: 'op' });
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) if (k !== 'op' && !STAMPED.includes(k)) rest[k] = v;

    const runId = rest.runId;
    const sourceHash = rest.sourceHash;
    const limit = rest.limit;
    delete rest.runId;
    delete rest.sourceHash;
    delete rest.limit;
    if ((op === 'create' || op === 'update') && (typeof sourceHash !== 'string' || !/^[0-9a-f]{64}$/.test(sourceHash))) throw bad(`${op} names the definition it wrote: sourceHash (64 hex, the compiled source hash)`, { field: 'sourceHash' });
    if (op !== 'create' && op !== 'update' && sourceHash !== undefined) throw bad(`${op} takes no sourceHash`, { field: 'sourceHash' });
    if (op !== 'runs' && limit !== undefined) throw bad(`${op} takes no limit`, { field: 'limit' });
    if (op !== 'logs' && runId !== undefined) throw bad(`${op} takes no runId`, { field: 'runId' });
    const where = this.#where(op, rest, op !== 'trust-status' && op !== 'logs');
    if (op === 'trust-status') return this.#trustStatus(where);
    if (op === 'logs') return this.#logs(where, runId);
    const e = where.entry!;
    switch (op) {
      case 'create':
      case 'update':
        return this.#authored(asker, e, op, sourceHash as string);
      case 'run':
        return this.#run(asker, e);
      case 'pause':
        return this.#pause(asker, e);
      case 'resume':
        return this.#resume(asker, e);
      case 'delete':
        return this.#delete(asker, e);
      default: {
        const n = typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 20;
        return { runs: this.#o.ledger.recent({ key: e.key, limit: n }).map((r) => redactRun(r, false)) };
      }
    }
  }

  /**
   * The agent's target: a scope, a repo the registry already knows (never added here), and (when needed or named)
   * a loop. Unknown repo and unknown loop are the same NOT_FOUND.
   */
  #where(op: string, rest: Record<string, unknown>, needLoop: boolean): { scope: LoopScopeName; repoKey: string | null; entry: LoopEntry | null } {
    const shape = `loop.request{op:'${op}'} takes {${needLoop ? 'loopId' : 'loopId?'}, scope, repo | repoKey${op === 'logs' ? ', runId' : ''}}`;
    const extra = Object.keys(rest).filter((k) => !['loopId', 'scope', 'repo', 'repoKey'].includes(k));
    if (extra.length) throw bad(`${shape} (unknown: ${extra.slice(0, 4).join(', ')})`);
    const { loopId, scope, repo, repoKey } = rest;
    if (scope !== 'repo' && scope !== 'personal') throw bad("scope is 'repo' or 'personal'", { field: 'scope' });
    if (loopId !== undefined && (typeof loopId !== 'string' || !KEBAB.test(loopId) || loopId.length > 64)) throw bad('loopId is a kebab-case loop id', { field: 'loopId' });
    if (needLoop && loopId === undefined) throw bad(shape, { field: 'loopId' });
    if (repoKey !== undefined && (typeof repoKey !== 'string' || !REPO_KEY.test(repoKey))) throw bad('repoKey is sha256:<64 hex>', { field: 'repoKey' });
    if (repo !== undefined && (typeof repo !== 'string' || !path.isAbsolute(repo) || repo.length > 4096 || repo.includes('\u0000'))) throw bad('repo is an absolute path', { field: 'repo' });
    const notFound = (): RpcRefusal => new RpcRefusal('NOT_FOUND', 'not-found', 'no such loop in a repo Gnomon knows (is its .loop.json compiled? paradigm_loop validate)');
    let key: string | null = null;
    if (scope === 'repo') {
      if (repo === undefined && repoKey === undefined) throw bad('a repo loop names its repo (repo or repoKey)', { field: 'repo' });
      const known = this.#o.registry.repos();
      let real: string | null = null;
      if (typeof repo === 'string') {
        try {
          real = fs.realpathSync.native(repoRootOf(repo));
        } catch {
          throw notFound();
        }
      }
      const hit = known.find((r) => (real === null || r.root === real) && (repoKey === undefined || r.repoKey === repoKey));
      if (!hit) throw notFound();
      key = hit.repoKey;
    } else if (repoKey !== undefined) key = repoKey as string;
    if (loopId === undefined) return { scope, repoKey: key, entry: null };
    this.#o.registry.scan();
    const entry = this.#o.registry.find(loopId as string, scope, key ?? undefined);
    if (!entry) throw notFound();
    return { scope, repoKey: entry.repoKey, entry };
  }

  /** The kernel request row: op and target, the asker from the connection (never the payload). */
  async #row(asker: LoopAgentAsker, e: LoopEntry, op: string, extra: Record<string, unknown> = {}): Promise<void> {
    // the registry's repo root, never the agent's string; the principal and hsid from the connection, a key CLAIM
    await this.#o.append('loop.request', { op, loopId: e.loopId, scope: e.scope, repoKey: e.repoKey, repo: e.repoRoot, ...extra, by: asker.principal!, hsid: asker.hsid, basis: 'agent-key-claim' }, { connId: asker.connId });
  }

  async #authored(asker: LoopAgentAsker, e: LoopEntry, op: 'create' | 'update', sourceHash: string): Promise<unknown> {
    const current = e.compiled?.compiled.sourceHash;
    if (!current) throw bad(`loop ${e.loopId} has no compiled source hash (refused or compiled without one: paradigm_loop validate)`, { field: 'sourceHash' });
    // the kernel attributes only the definition on disk now: a stale or guessed hash attributes nothing
    if (current !== sourceHash) throw bad(`loop ${e.loopId} on disk is not the definition named (now ${current.slice(0, 12)}): write it, then ask again`, { field: 'sourceHash', current });
    await this.#row(asker, e, op, { sourceHash });
    const s = this.#o.registry.stateOf(e);
    if (s.state === 'invalid' || s.state === 'deleted') return { authored: true, state: s.state, card: null };
    // no envelope in 8.0: an agent's loop always takes the founder's one loop-trust card, and nothing runs before it
    const card = await this.#o.trust.raiseForAgent(asker, e.key);
    return { authored: true, authoredBy: authorLabel(this.#o.registry.authoredBy(e)), ...(isObj(card) ? card : {}) };
  }

  async #run(asker: LoopAgentAsker, e: LoopEntry): Promise<unknown> {
    const can = this.#o.registry.canRun(e.key);
    if (!can.ok) throw forbidden('not-trusted', `loop ${e.loopId} is ${can.reason}: an agent runs trusted loops only`, { state: can.reason });
    await this.#row(asker, e, 'run');
    const r = this.#o.runner.start(e.key, { type: 'manual', by: asker.principal!, agent: true });
    return 'runId' in r && 'done' in r ? { runId: r.runId, started: true } : r;
  }

  async #pause(asker: LoopAgentAsker, e: LoopEntry): Promise<unknown> {
    await this.#row(asker, e, 'pause');
    const r = await this.#o.runner.pause(e.key, asker.principal!, 'agent', asker.connId);
    const a = this.#o.registry.authoredBy(e);
    if (r.paused && (a === 'file' || a.principal !== asker.principal)) {
      this.#o.toast?.({ loopId: e.loopId, runId: '', repo: e.repoRoot, text: `${authorLabel({ principal: asker.principal!, hsid: null, basis: 'agent-key-claim' })} paused ${e.loopId}` });
    }
    return r;
  }

  async #resume(asker: LoopAgentAsker, e: LoopEntry): Promise<unknown> {
    const s = this.#o.registry.stateOf(e);
    if (s.state !== 'paused') return { resumed: false, state: s.state };
    const p = this.#o.registry.pauseOf(e.key);
    if (!p || p.reason !== 'agent' || p.by !== asker.principal) {
      throw forbidden('not-own-pause', `loop ${e.loopId} was paused ${p?.reason === 'agent' ? 'by another agent' : `for ${p?.reason ?? 'a reason'} (${p?.by ?? 'kernel'})`}: an agent resumes only its own pause; ask the founder`, { pausedFor: p?.reason });
    }
    // a kill switch after this pause (a later kill epoch) holds it for a human with presence
    if (p.epoch < this.#o.registry.killEpoch()) throw forbidden('kernel-pause', 'the kill switch was used after your pause: only the founder resumes now');
    await this.#row(asker, e, 'resume');
    const res = await this.#o.runner.resume(e.key, asker);
    // ONE catch-up run when a schedule or continuous trigger came due while it was paused
    const now = (this.#o.clock ?? Date.now)();
    if (isObj(res) && res.resumed === true && p.at !== undefined && e.compiled && missedDuring(e.compiled, p.at, now, this.#o.tz ?? hostTimeZone())) {
      const r = this.#o.runner.start(e.key, { type: 'catch-up', by: asker.principal!, agent: true, pausedAt: new Date(p.at).toISOString() });
      return { ...res, catchUp: 'runId' in r ? r.runId : r };
    }
    return res;
  }

  async #delete(asker: LoopAgentAsker, e: LoopEntry): Promise<unknown> {
    // 8.0 (Aegis): an agent never deletes; the loop is paused and the founder decides (the files stay)
    await this.#row(asker, e, 'delete', { downgraded: 'pause' });
    const paused = await this.#o.runner.pause(e.key, asker.principal!, 'agent', asker.connId);
    const who = authorLabel({ principal: asker.principal!, hsid: asker.hsid, basis: 'agent-key-claim' });
    this.#o.toast?.({ loopId: e.loopId, runId: '', repo: e.repoRoot, text: `${who} asked to delete loop ${e.loopId}; it is paused instead. Delete it in Gnomon if you agree` });
    return { deleted: false, paused: paused.paused, stopped: paused.stopped, why: 'in 8.0 an agent cannot delete a loop: it is paused and the founder is asked', founderToast: true };
  }

  #logs(where: { scope: LoopScopeName; repoKey: string | null; entry: LoopEntry | null }, runId: unknown): unknown {
    if (typeof runId !== 'string' || !/^lr-[0-9a-z-]{1,60}$/.test(runId)) throw bad("loop.request{op:'logs'} takes {runId, scope, repo} (lr-…, from op runs)", { field: 'runId' });
    const r = this.#o.ledger.run(runId);
    // a run outside the named repo (or loop) is the same NOT_FOUND as no run
    if (!r || r.scope !== where.scope || (where.repoKey !== null && r.repoKey !== where.repoKey) || (where.entry !== null && r.key !== where.entry.key)) throw new RpcRefusal('NOT_FOUND', 'not-found', `no run ${runId} there`);
    return { run: redactRun(r, true) };
  }

  #trustStatus(where: { scope: LoopScopeName; repoKey: string | null; entry: LoopEntry | null }): unknown {
    const match = (x: { loopId: string; scope: string; repoKey: string }): boolean => x.scope === where.scope && (where.repoKey === null || x.repoKey === where.repoKey) && (where.entry === null || x.loopId === where.entry.loopId);
    const events = this.#o.registry.history().filter((h) => (h.event === 'trusted' || h.event === 'untrusted' || h.event === 'deleted' || h.event === 'closure.changed') && match(h));
    const loops = this.#o.registry.list().filter((l) => match(l)).map((l) => ({ loopId: l.loopId, scope: l.scope, repoKey: l.repoKey, state: l.state, ...(l.reason ? { reason: l.reason } : {}), ...(l.contentHash ? { contentHash: l.contentHash } : {}), ...(l.trustedHash ? { trustedHash: l.trustedHash } : {}), ...(l.trustedBy ? { trustedBy: l.trustedBy } : {}), ...(l.trustedAt ? { trustedAt: l.trustedAt } : {}), authoredBy: authorLabel(l.authoredBy ?? 'file') }));
    return { loops, events: events.slice(-200), envelopes: [] };
  }
}
