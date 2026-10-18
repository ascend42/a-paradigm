/**
 * @symbol #supervisor
 *
 * The socket port of #supervisor (spec §5 verbs 2–4: session.open,
 * session.send, session.stop) — what #socket's dispatcher calls for a HUMAN
 * principal in M1.7 slice 1 (agent/session principals stay not-implemented
 * until session principals and the broker decision for unattended work land).
 * Params are parsed strictly: a §5 param slice 1 does not serve (mode,
 * runMode, as, goal, contract, alias, derived, permitId on open, brief) is
 * refused BAD_REQUEST{reason:'bad-params'} rather than silently ignored.
 */
import { refuse, RefusedError } from '@a-company/gnomon-contracts';
import type { SessionSupervisor } from './supervisor.js';

export interface SessionCallContext {
  principal: string;
  principalClass: string;
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

export function createSessionPort(sup: SessionSupervisor): SessionPort {
  return {
    open: async (ctx, params) => {
      const p = objectParams(params, ['backend', 'model', 'cwd', 'systemPrompt', 'attended'], 'session.open');
      if (p.backend !== undefined && p.backend !== 'claude-code' && p.backend !== 'local') throw bad('backend is claude-code or local');
      if (p.model !== undefined && typeof p.model !== 'string') throw bad('model must be a string');
      if (typeof p.cwd !== 'string') throw bad('cwd is required');
      if (typeof p.attended !== 'boolean') throw bad('attended is required');
      if (p.systemPrompt !== undefined && typeof p.systemPrompt !== 'string') throw bad('systemPrompt must be a string');
      return sup.open({
        principal: ctx.principal,
        principalClass: ctx.principalClass,
        attended: p.attended,
        cwd: p.cwd,
        ...(p.backend ? { backend: p.backend as 'claude-code' | 'local' } : {}),
        ...(typeof p.model === 'string' ? { model: p.model } : {}),
        ...(typeof p.systemPrompt === 'string' ? { systemPrompt: p.systemPrompt } : {}),
      });
    },
    send: async (ctx, params) => {
      const p = objectParams(params, ['hsid', 'content', 'permitId'], 'session.send');
      if (typeof p.hsid !== 'string') throw bad('hsid is required');
      if (!Array.isArray(p.content) || p.content.length === 0) throw bad('content[] is required');
      const texts = p.content.map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : null));
      if (texts.some((t) => t === null)) throw bad('slice 1 serves text content parts only ({text})');
      if (p.permitId !== undefined && typeof p.permitId !== 'string') throw bad('permitId must be a string');
      return sup.send(ctx.principal, { hsid: p.hsid, text: texts.join('\n'), ...(typeof p.permitId === 'string' ? { permitId: p.permitId } : {}) });
    },
    stop: async (ctx, params) => {
      const p = objectParams(params, ['hsid', 'interrupt'], 'session.stop');
      if (typeof p.hsid !== 'string') throw bad('hsid is required');
      if (p.interrupt !== undefined && typeof p.interrupt !== 'boolean') throw bad('interrupt must be a boolean');
      return sup.stop(ctx.principal, { hsid: p.hsid, ...(p.interrupt === true ? { interrupt: true } : {}) });
    },
    status: () => ({ sessions: sup.status(), claudePin: sup.pinStatus() }),
  };
}
