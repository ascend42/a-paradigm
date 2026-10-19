/**
 * @symbol #supervisor
 *
 * The socket port of #supervisor (spec §5 verbs 2–4: session.open,
 * session.send, session.stop) — what #socket's dispatcher calls for a HUMAN
 * principal in M1.7 slice 1 (agent/session principals stay not-implemented
 * until session principals and the broker decision for unattended work land).
 * Params are parsed strictly: a §5 param slice 1 does not serve (mode, as,
 * goal, contract, alias, derived, permitId on open, brief) is refused
 * BAD_REQUEST{reason:'bad-params'} rather than silently ignored.
 * `runMode` (P8-D86/D87) is served when the daemon passes the run-mode
 * control: an unknown mode is BAD_REQUEST, a mode over the strictness ceiling
 * FORBIDDEN{strictness-mode}; a mode no looser than the repo's is set by the
 * open (session.open{runMode}); a looser one opens the session at the repo's
 * mode and raises the loosening `strictness` card (fresh presence), whose id
 * the result carries as `runModeCard`.
 */
import { refuse, RefusedError } from '@a-company/gnomon-contracts';
import type { SessionSupervisor } from './supervisor.js';
import type { RunModeControl } from '../broker/run-mode.js';

export interface SessionCallContext {
  principal: string;
  principalClass: string;
  /** the hello features this connection negotiated (§4.9); `session.resume` gates the resumed sessions */
  features?: readonly string[];
  /** the calling connection and how it authenticated (run-mode loosening cards name the asker) */
  connId?: string;
  credential?: string;
}

/** The hello feature a client offers to address a session the kernel resumed after an upgrade (§2.4 rule 11, P8-D98). */
export const SESSION_RESUME_FEATURE = 'session.resume';

/**
 * §2.4 rule 11 feature gate (T-2026-10-19-014 B2): a client that did not negotiate `session.resume` is REFUSED
 * any verb on a resumed session, never served a degraded view of it (no feature switches a check off).
 */
function gateResumed(sup: SessionSupervisor, ctx: SessionCallContext, hsid: string, verb: string): void {
  if (!sup.resumed?.(hsid) || (ctx.features ?? []).includes(SESSION_RESUME_FEATURE)) return;
  throw new RefusedError(refuse({ code: 'FORBIDDEN', data: { reason: 'matrix', needs: SESSION_RESUME_FEATURE, verb } }), `#supervisor: ${verb} on a session resumed after an upgrade needs the ${SESSION_RESUME_FEATURE} hello feature (offer it in hello)`);
}

export interface SessionPort {
  open(ctx: SessionCallContext, params: unknown): Promise<unknown>;
  send(ctx: SessionCallContext, params: unknown): Promise<unknown>;
  stop(ctx: SessionCallContext, params: unknown): Promise<unknown>;
  status(): Record<string, unknown>;
}

function bad(message: string): RefusedError {
  return new RefusedError(refuse({ code: 'BAD_REQUEST', data: { reason: 'bad-params' } }), `#supervisor: ${message}`);
}

function objectParams(params: unknown, allowed: readonly string[], verb: string): Record<string, unknown> {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) throw bad(`${verb} takes an object`);
  const p = params as Record<string, unknown>;
  const extra = Object.keys(p).filter((k) => !allowed.includes(k));
  if (extra.length) throw bad(`${verb}: params not served in M1.7 slice 1: ${extra.join(', ')}`);
  return p;
}

export function createSessionPort(sup: SessionSupervisor, modes?: RunModeControl): SessionPort {
  return {
    open: async (ctx, params) => {
      const p = objectParams(params, ['backend', 'model', 'cwd', 'systemPrompt', 'attended', ...(modes ? ['runMode'] : [])], 'session.open');
      if (p.backend !== undefined && p.backend !== 'claude-code' && p.backend !== 'local') throw bad('backend is claude-code or local');
      if (p.model !== undefined && typeof p.model !== 'string') throw bad('model must be a string');
      if (typeof p.cwd !== 'string') throw bad('cwd is required');
      if (typeof p.attended !== 'boolean') throw bad('attended is required');
      if (p.systemPrompt !== undefined && typeof p.systemPrompt !== 'string') throw bad('systemPrompt must be a string');
      const adm = modes ? modes.admitOpen(p.cwd, p.runMode) : { direct: null, loosen: null };
      const opened = await sup.open({
        principal: ctx.principal,
        principalClass: ctx.principalClass,
        attended: p.attended,
        cwd: p.cwd,
        ...(p.backend ? { backend: p.backend as 'claude-code' | 'local' } : {}),
        ...(typeof p.model === 'string' ? { model: p.model } : {}),
        ...(typeof p.systemPrompt === 'string' ? { systemPrompt: p.systemPrompt } : {}),
        ...(adm.direct ? { runMode: adm.direct } : {}),
      });
      if (!adm.loosen || !modes || opened.backend !== 'claude-code') return opened;
      // a looser runMode than the repo's: the session runs at the repo's mode until the human allows the step with Touch ID
      const r = await modes.loosenOpened({ connId: ctx.connId ?? 'conn:unknown', principal: ctx.principal, principalClass: ctx.principalClass, credential: ctx.credential }, opened.hsid, adm.loosen).catch(() => null);
      return { ...opened, ...(r && 'pending' in r ? { runModeCard: r.cardId } : { runModeCard: null }) };
    },
    send: async (ctx, params) => {
      const p = objectParams(params, ['hsid', 'content', 'permitId', 'steer'], 'session.send');
      if (p.steer !== undefined && typeof p.steer !== 'boolean') throw bad('steer must be a boolean');
      if (typeof p.hsid !== 'string') throw bad('hsid is required');
      if (!Array.isArray(p.content) || p.content.length === 0) throw bad('content[] is required');
      const texts = p.content.map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : null));
      if (texts.some((t) => t === null)) throw bad('slice 1 serves text content parts only ({text})');
      if (p.permitId !== undefined && typeof p.permitId !== 'string') throw bad('permitId must be a string');
      gateResumed(sup, ctx, p.hsid, 'session.send');
      return sup.send(ctx.principal, { hsid: p.hsid, text: texts.join('\n'), ...(typeof p.permitId === 'string' ? { permitId: p.permitId } : {}), ...(p.steer === true ? { steer: true } : {}) });
    },
    stop: async (ctx, params) => {
      const p = objectParams(params, ['hsid', 'interrupt'], 'session.stop');
      if (typeof p.hsid !== 'string') throw bad('hsid is required');
      if (p.interrupt !== undefined && typeof p.interrupt !== 'boolean') throw bad('interrupt must be a boolean');
      gateResumed(sup, ctx, p.hsid, 'session.stop');
      return sup.stop(ctx.principal, { hsid: p.hsid, ...(p.interrupt === true ? { interrupt: true } : {}) });
    },
    status: () => ({ sessions: sup.status(), claudePin: sup.pinStatus(), sessionSandbox: sup.sandboxStatus() }),
  };
}
