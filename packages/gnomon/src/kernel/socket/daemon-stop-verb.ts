/**
 * @symbol #socket
 *
 * `daemon.stop {reason?}` (P8-D98 human-device verb 15, founder ruling
 * TD-2026-10-19-339, TD-2026-10-19-528 F3, spec §3.1 I3; T-2026-10-19-014
 * slice B0): the wire form of `gnomon daemon stop`. The verb never stops the
 * kernel by itself: it asks the kernel to raise its signed `daemon-stop` card
 * (#approval-broker DaemonStopCards) and returns `{cardId, state}`. The kernel
 * stops only when the human accepts that card with fresh presence (Touch ID).
 *
 * RULES (falsified in test/daemon-stop-verb.test.ts):
 *   - reached only through the UNIX dispatcher's DispatcherOptions.humanVerbs,
 *     so every non-human class, a read token, a GUI launch-token connection and
 *     any connection without a verified device key were refused
 *     FORBIDDEN{matrix} before this runs (and DaemonStopCards checks again);
 *     the web dispatcher has no port for it (status reports it unavailable);
 *   - params: `{}` or `{reason}`; reason is one of DAEMON_STOP_REASONS
 *     (`stop`, the default, or `upgrade`). Anything else is BAD_REQUEST{bad-params};
 *   - `upgrade` is reserved for the §2.4 rule 11 drain (slice B1): until it is
 *     built the call is ENGINE{not-implemented} and no card is raised;
 *   - a second request while a daemon-stop card is pending returns that card.
 */
import { DAEMON_STOP_REASONS, type DaemonStopReasonValue, type DaemonStopResult } from '@a-company/gnomon-contracts';
import type { CardV1 } from '@a-company/gnomon-contracts';
import type { DaemonStopReason } from '../broker/daemon-stop.js';
import type { HumanDeviceVerbContext, HumanDeviceVerbHandler } from './dispatch.js';
import { RpcRefusal } from './rpc.js';

export interface DaemonStopVerbPort {
  /** DaemonHandle.requestStop: raise (or return the pending) daemon-stop card for this connection. */
  requestStop(connId: string, reason: DaemonStopReason): Promise<CardV1>;
}

/** Parse `daemon.stop` params: `{}` or `{reason}` with a value from DAEMON_STOP_REASONS; anything else BAD_REQUEST. */
export function parseDaemonStopParams(params: unknown): { reason: DaemonStopReasonValue } {
  const p = params === undefined || params === null ? {} : params;
  if (typeof p !== 'object' || Array.isArray(p)) throw new RpcRefusal('BAD_REQUEST', 'bad-params', 'daemon.stop params are an object {reason?}', { verb: 'daemon.stop' });
  const extra = Object.keys(p).filter((k) => k !== 'reason');
  if (extra.length > 0) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `daemon.stop takes only reason (${extra.length} other field(s))`, { verb: 'daemon.stop' });
  if (!Object.hasOwn(p, 'reason')) return { reason: 'stop' };
  const r = (p as { reason: unknown }).reason;
  if (typeof r !== 'string' || !(DAEMON_STOP_REASONS as readonly string[]).includes(r)) {
    throw new RpcRefusal('BAD_REQUEST', 'bad-params', `daemon.stop reason is one of ${DAEMON_STOP_REASONS.join(', ')}`, { verb: 'daemon.stop' });
  }
  return { reason: r as DaemonStopReasonValue };
}

/** The `daemon.stop` handler for the unix dispatcher's humanVerbs. */
export function createDaemonStopHandler(port: DaemonStopVerbPort): HumanDeviceVerbHandler {
  return async (ctx: HumanDeviceVerbContext, params: unknown): Promise<DaemonStopResult> => {
    const { reason } = parseDaemonStopParams(params);
    if (reason === 'upgrade') {
      throw new RpcRefusal('ENGINE', 'not-implemented', 'daemon.stop reason upgrade (drain and resume, §2.4 rule 11) lands with slice B1 of T-2026-10-19-014', { verb: 'daemon.stop', milestone: 'T-2026-10-19-014' });
    }
    const card = await port.requestStop(ctx.connId, reason);
    return { cardId: card.cardId, state: card.state };
  };
}
