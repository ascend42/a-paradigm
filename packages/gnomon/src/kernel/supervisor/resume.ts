/**
 * @symbol #supervisor
 * @symbol $daemon-lifecycle
 *
 * §2.4 rule 11, the NEW kernel's side (TD-2026-10-19-908, TD-2026-10-19-528 F4, TD-2026-10-19-814 item 2;
 * T-2026-10-19-014 slice B2): resume after an upgrade.
 *
 * planResume() reads the chain ONCE at boot, BEFORE the rule-4 orphan sweep, and only the kernel's own
 * signed rows (principal in kernelPrincipals AND a kernel key — the same trust the fuse restore uses):
 *   - a session whose `session.drained{uuid, reason:'upgrade'}` is followed by its `session.exited{reason:
 *     drain-clean | drain-interrupted}`, with no later `session.open` or `permit.reattributed` for it, is a
 *     resume candidate (a kernel-signed `session.refused{resume}` for it also uses the record up: a refused
 *     resume is TERMINAL, never re-planned on a later boot — Aegis L1). Its exit closed its spawn, so the sweep never sees it (G-DMN-04 amended); the sweep
 *     is also told the candidates' hsids (children.ts `resuming`) so a spawn of this boot is never swept.
 *   - a `session.drained` with no matching exit is NOT a candidate: the drain did not finish and its open
 *     spawn is swept as an orphan, never resumed.
 *   - a `session.model{outcome: switched | reconciled}` (8.0:model-switch) moves the session's model to `to` and its
 *     spawn permit to `permitId`: a switched session resumes on the model it ran, under the permit that switch reserved.
 *   - every `approval.request` with no later `approval.decide` / `approval.expire` is a card an earlier kernel
 *     left pending. This broker never held it, so a decision against its id is refused NOT_FOUND{not-found}.
 * resumeAfterUpgrade() first RETIRES every old pending card with `approval.expire{why:'cancelled'}` (deny;
 * TD-2026-10-19-476 — retired BEFORE any session resumes, Aegis L6), so no GUI keeps a stale card id and no
 * decision against one lands; then, per candidate, it runs SessionSupervisor.resume() — the ordinary spawn path
 * with `--resume <uuid>`, re-running law 7, layersHash, gitHash and the permit (re-attributed with a fresh window
 * if it was live at the drain, never minted); a failure leaves the session stopped with its session.refused row.
 * No kind is rebuilt from the log, because none is safe to rebuild there: the chain's approval.request row
 * carries the card, never the detail its effect needs (a `fallback` card's cwd and request live only in the
 * old process); a session-bound card's request died with its session; a `daemon-stop` card would stop a kernel
 * nobody asked to stop; an `api-token` card is bound to its session. An `install` card IS raised again, by
 * #mod-host's pickup from its staged record (the record, not the log, keys it), with presence asked afresh.
 */
import type { PermitV1 } from '../budget/fuse.js';
import type { ApprovalBroker } from '../broker/broker.js';
import { DRAIN_EXIT_REASONS, type DrainOutcome, type ResumeInput, type SessionSupervisor } from './supervisor.js';

export { INTERRUPTED_NOTE } from './supervisor.js';

/** One chain row, as the daemon reads it back (full view). */
export interface ResumeRow {
  /** Aegis S2 H-2: the row seq, so a sealed legacy kernel key is trusted only up to its seal */
  seq?: number;
  id: string;
  kind: string;
  principal: string;
  keyId?: string;
  session?: string;
  /** the row's chain time (`at`): the session.drained time decides the permit carry-over */
  at?: string;
  payload: unknown;
}

export interface ResumeTrust {
  principals: readonly string[];
  isKernelKey(keyId: string, seq?: number): boolean;
}

export interface ResumeCandidate extends ResumeInput {
  /** the drained session's last session.sandbox row named a permit the chain does not hold (resume refuses) */
  permitMissing?: boolean;
}

export interface ForeignCard {
  cardId: string;
  kind: string;
  hsid?: string;
}

export interface ResumePlan {
  resume: ResumeCandidate[];
  /** hsids drained with no exit: swept as orphans, never resumed */
  unfinished: string[];
  /** cards an earlier kernel left pending */
  cards: ForeignCard[];
}


interface Track {
  open?: { by: string; principalClass: string; cwd: string; worktree?: string; model?: string; uuid: string };
  sandbox?: { layersHash: string; gitHash: string | null; permitId: string };
  drained?: { id: string; uuid: string; at: string };
  exitReason?: string;
}

const OUTCOME_OF: Readonly<Record<string, DrainOutcome>> = Object.freeze({ [DRAIN_EXIT_REASONS.clean]: 'clean', [DRAIN_EXIT_REASONS.interrupted]: 'interrupted' });

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Read the chain once (kernel-signed rows only) into what this boot resumes, sweeps and retires. */
export function planResume(rows: Iterable<ResumeRow>, trust: ResumeTrust): ResumePlan {
  const by = new Map<string, Track>();
  const grants = new Map<string, PermitV1>();
  const pending = new Map<string, ForeignCard>();
  const t = (hsid: string): Track => {
    let x = by.get(hsid);
    if (!x) by.set(hsid, (x = {}));
    return x;
  };
  for (const r of rows) {
    if (!trust.principals.includes(r.principal) || typeof r.keyId !== 'string' || !trust.isKernelKey(r.keyId, r.seq)) continue;
    const p = obj(r.payload);
    const hsid = typeof r.session === 'string' ? r.session : typeof p.hsid === 'string' ? p.hsid : null;
    switch (r.kind) {
      case 'permit.grant': {
        const permit = obj(p.permit) as unknown as PermitV1;
        if (typeof permit.permitId === 'string') grants.set(permit.permitId, permit);
        break;
      }
      case 'session.open':
        if (hsid && p.backend === 'claude-code' && typeof p.uuid === 'string' && typeof p.cwd === 'string' && typeof p.by === 'string') {
          // a later open of the same hsid is a resume (or a re-run): the drained record before it is consumed
          by.set(hsid, { open: { by: p.by, principalClass: typeof p.principalClass === 'string' ? p.principalClass : '', cwd: p.cwd, uuid: p.uuid, ...(typeof p.worktree === 'string' ? { worktree: p.worktree } : {}), ...(typeof p.model === 'string' ? { model: p.model } : {}) } });
        }
        break;
      case 'session.sandbox':
        if (hsid && typeof p.layersHash === 'string' && typeof p.permitId === 'string') t(hsid).sandbox = { layersHash: p.layersHash, gitHash: typeof p.gitHash === 'string' ? p.gitHash : null, permitId: p.permitId };
        break;
      case 'session.model':
        // 8.0:model-switch: a switched (or reconciled) session resumes on the model on record, under the permit it ran with
        if (hsid && (p.outcome === 'switched' || p.outcome === 'reconciled') && typeof p.to === 'string' && typeof p.permitId === 'string') {
          const x = t(hsid);
          if (x.open) x.open.model = p.to;
          if (x.sandbox) x.sandbox.permitId = p.permitId;
        }
        break;
      case 'session.drained':
        if (hsid && typeof p.uuid === 'string' && p.reason === 'upgrade') {
          const x = t(hsid);
          x.drained = { id: r.id, uuid: p.uuid, at: typeof r.at === 'string' ? r.at : '' };
          delete x.exitReason;
        }
        break;
      case 'session.exited':
        if (hsid && by.get(hsid)?.drained && typeof p.reason === 'string') t(hsid).exitReason = p.reason;
        break;
      case 'permit.reattributed':
        if (hsid) delete t(hsid).drained; // already resumed once: never twice
        break;
      case 'session.refused':
        if (hsid && typeof p.resume === 'string') delete t(hsid).drained; // Aegis L1: a refused resume is terminal
        break;
      case 'approval.request': {
        const card = obj(p.card);
        if (typeof card.cardId === 'string' && typeof card.kind === 'string') {
          pending.set(card.cardId, { cardId: card.cardId, kind: card.kind, ...(typeof card.hsid === 'string' ? { hsid: card.hsid } : {}) });
        }
        break;
      }
      case 'approval.decide':
      case 'approval.expire':
        if (typeof p.cardId === 'string') pending.delete(p.cardId);
        break;
      default:
        break;
    }
  }
  const resume: ResumeCandidate[] = [];
  const unfinished: string[] = [];
  for (const [hsid, x] of by) {
    if (!x.drained) continue;
    const outcome = x.exitReason !== undefined ? OUTCOME_OF[x.exitReason] : undefined;
    if (!outcome) {
      if (x.exitReason === undefined) unfinished.push(hsid); // drained, no exit: the sweep's (rule 4), never resumed
      continue;
    }
    if (!x.open || x.open.uuid !== x.drained.uuid || !x.sandbox) continue; // nothing to resume from: left stopped
    const permit = grants.get(x.sandbox.permitId) ?? null;
    resume.push({
      hsid, uuid: x.drained.uuid, drainedEventId: x.drained.id, drainedAt: x.drained.at, outcome, principal: x.open.by, principalClass: x.open.principalClass, cwd: x.open.cwd,
      ...(x.open.worktree ? { worktree: x.open.worktree } : {}), ...(x.open.model ? { model: x.open.model } : {}),
      layersHash: x.sandbox.layersHash, gitHash: x.sandbox.gitHash, permit, ...(permit ? {} : { permitMissing: true }),
    });
  }
  return { resume, unfinished, cards: [...pending.values()] };
}

export interface ResumeReport {
  resumed: Array<{ hsid: string; uuid: string; outcome: DrainOutcome }>;
  refused: Array<{ hsid: string; uuid: string; reason: string }>;
  retired: Array<{ cardId: string; kind: string }>;
}

export interface ResumeDeps {
  supervisor: Pick<SessionSupervisor, 'resume'>;
  broker?: Pick<ApprovalBroker, 'retireForeign'>;
}

/** Resume every candidate and settle every card an earlier kernel left pending (never throws per item). */
export async function resumeAfterUpgrade(plan: ResumePlan, deps: ResumeDeps): Promise<ResumeReport> {
  const out: ResumeReport = { resumed: [], refused: [], retired: [] };
  // Aegis L6: the old kernel's cards are retired FIRST, so none is still pending while a session resumes
  const broker = deps.broker;
  if (broker) {
    for (const card of plan.cards) {
      try {
        await broker.retireForeign(card, 'cancelled');
        out.retired.push({ cardId: card.cardId, kind: card.kind });
      } catch {
        /* a card that cannot be settled stays as it was: this broker never holds it, so no decision lands on it */
      }
    }
  }
  for (const c of plan.resume) {
    try {
      await deps.supervisor.resume(c);
      out.resumed.push({ hsid: c.hsid, uuid: c.uuid, outcome: c.outcome });
    } catch (err) {
      out.refused.push({ hsid: c.hsid, uuid: c.uuid, reason: (err as Error).message });
    }
  }
  return out;
}
