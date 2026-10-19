/**
 * @symbol #socket
 *
 * `gui.open {cwdHint?}` (spec §2.4 rule 8, P8-D98 human-device verb 13,
 * T-2026-10-19-001 A3, TD-2026-10-19-947): the wire form of `gnomon open`.
 * Bare `gnomon` (and later Gnomon.app) reaches a kernel that already runs and
 * asks it for a launch grant, instead of refusing `already-running`.
 *
 * RULES (falsified in test/gui-open.test.ts):
 *   - reached only through DispatcherOptions.humanVerbs, so the dispatcher has
 *     already refused every non-human class, a read token, a GUI launch-token
 *     connection and any connection that has not authenticated a device key
 *     over a verified hello (FORBIDDEN{matrix});
 *   - the grant is the in-process launch's grant: the SAME `requestWebLaunch`
 *     (single-use token, at most 60 s) under the SAME launch-grant cap as the
 *     terminal and the wrapper channel (web/launch-cap.ts: shared, not added on
 *     top). A capped or failed mint is ENGINE{web-launch-capped | <reason>};
 *   - `cwdHint` is an unverified same-user string: checked for type and size
 *     (≤ GUI_OPEN_CWD_HINT_MAX_BYTES UTF-8 bytes, else BAD_REQUEST{cwd-hint-too-long})
 *     and returned verbatim for the CLI to append as the URL fragment. The
 *     kernel never reads, resolves or logs it; a refusal names its length only;
 *   - a connection that went away while the token was minted gets nothing.
 */
import { GUI_OPEN_CWD_HINT_MAX_BYTES } from '@a-company/gnomon-contracts';
import { isLifecycleRefusal } from '../lifecycle/refusal.js';
import type { LaunchGrant } from '../web/endpoint.js';
import type { HumanDeviceVerbContext, HumanDeviceVerbHandler } from './dispatch.js';
import { RpcRefusal } from './rpc.js';

export interface GuiOpenPort {
  /** The in-process launch path: DaemonHandle.requestWebLaunch for this connection (the endpoint applies the shared cap). */
  requestLaunch(connId: string): Promise<LaunchGrant>;
}

export interface GuiOpenGrant {
  url: string;
  expiresAt: string;
  cwdHint?: string;
}

/** Parse `gui.open` params: `{}` or `{cwdHint: string}` (≤ 1024 UTF-8 bytes); anything else BAD_REQUEST. Never echoes the hint. */
export function parseGuiOpenParams(params: unknown): { cwdHint?: string } {
  const p = params === undefined || params === null ? {} : params;
  if (typeof p !== 'object' || Array.isArray(p)) throw new RpcRefusal('BAD_REQUEST', 'bad-params', 'gui.open params are an object {cwdHint?}', { verb: 'gui.open' });
  const keys = Object.keys(p);
  const extra = keys.filter((k) => k !== 'cwdHint');
  if (extra.length > 0) throw new RpcRefusal('BAD_REQUEST', 'bad-params', `gui.open takes only cwdHint (${extra.length} other field(s))`, { verb: 'gui.open' });
  if (!Object.hasOwn(p, 'cwdHint')) return {};
  const h = (p as { cwdHint: unknown }).cwdHint;
  if (typeof h !== 'string' || h.length === 0) throw new RpcRefusal('BAD_REQUEST', 'bad-params', 'gui.open cwdHint is a non-empty string', { verb: 'gui.open' });
  const bytes = Buffer.byteLength(h, 'utf8');
  if (bytes > GUI_OPEN_CWD_HINT_MAX_BYTES) throw new RpcRefusal('BAD_REQUEST', 'cwd-hint-too-long', `gui.open cwdHint is ${bytes} UTF-8 bytes; at most ${GUI_OPEN_CWD_HINT_MAX_BYTES}`, { verb: 'gui.open', bytes, max: GUI_OPEN_CWD_HINT_MAX_BYTES });
  return { cwdHint: h };
}

/** The `gui.open` handler for DispatcherOptions.humanVerbs. */
export function createGuiOpenHandler(port: GuiOpenPort): HumanDeviceVerbHandler {
  return async (ctx: HumanDeviceVerbContext, params: unknown): Promise<GuiOpenGrant> => {
    const { cwdHint } = parseGuiOpenParams(params); // before any mint: a bad hint costs no token and no cap slot
    let g: LaunchGrant;
    try {
      g = await port.requestLaunch(ctx.connId);
    } catch (e) {
      if (isLifecycleRefusal(e)) throw new RpcRefusal('ENGINE', e.reason, e.message, { verb: 'gui.open' });
      throw e;
    }
    if (!ctx.isLive()) throw new RpcRefusal('ENGINE', 'connection-gone', 'the connection closed while the launch token was minted', { verb: 'gui.open' });
    return { url: g.url, expiresAt: new Date(g.expiresAt).toISOString(), ...(cwdHint !== undefined ? { cwdHint } : {}) };
  };
}
