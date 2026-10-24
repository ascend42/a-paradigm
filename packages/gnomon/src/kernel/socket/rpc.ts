/**
 * @symbol #socket
 *
 * #socket (spec §4.9) — `gnomon-rpc:v1` frame shapes. M1.4: errors carry the
 * contracts `refusal:v1` in `error.data` (§4.9 "{error:{code, message, data:
 * refusal:v1}}"); the JSON-RPC code comes from the contracts' total code map.
 * The human sentence is `error.message`, never inside the refusal (Warpline
 * semantics). Named reasons ride `refusal.data.reason` (an additive enum).
 */
import { GNOMON_RPC_V1, JSON_RPC_CODES, refuse, type Refusal, type RefusalCode, type RefusalData } from '@a-company/gnomon-contracts';

export const GNOMON_RPC = GNOMON_RPC_V1;

/** The §4.9 total code map (re-exported from the contracts). */
export const RPC_ERROR_CODES = JSON_RPC_CODES;

export type RpcErrorName = RefusalCode;
export type RpcId = string | number | null;

export interface RpcRequestFrame {
  jsonrpc: '2.0';
  rpc: typeof GNOMON_RPC;
  id?: RpcId;
  method: string;
  params?: unknown;
}

export interface RpcResultFrame {
  jsonrpc: '2.0';
  rpc: typeof GNOMON_RPC;
  id: RpcId;
  result: unknown;
}

export interface RpcErrorFrame {
  jsonrpc: '2.0';
  rpc: typeof GNOMON_RPC;
  id: RpcId;
  error: { code: number; message: string; data: Refusal };
}

export type RpcResponseFrame = RpcResultFrame | RpcErrorFrame;

/** A refusal plus its human sentence. */
export interface RefusalWithMessage {
  refusal: Refusal;
  message: string;
}

export function refusalWith(code: RefusalCode, reason: string, message: string, data?: RefusalData): RefusalWithMessage {
  return { refusal: refuse({ code, data: { reason, ...(data ?? {}) } }), message };
}

/**
 * Throw from a handler to answer with a refusal. `closeAfter` = the server
 * sends the reply, then ends the connection and ignores further frames
 * (§4.9: "failed auth closes after one AUTH refusal").
 */
export class RpcRefusal extends Error {
  readonly refusal: Refusal;
  readonly closeAfter: boolean;
  constructor(code: RefusalCode, reason: string, message: string, data?: RefusalData, opts: { closeAfter?: boolean } = {}) {
    super(message);
    this.name = 'RpcRefusal';
    this.refusal = refusalWith(code, reason, message, data).refusal;
    this.closeAfter = opts.closeAfter ?? false;
  }
  static from(r: RefusalWithMessage, opts: { closeAfter?: boolean } = {}): RpcRefusal {
    const e = new RpcRefusal(r.refusal.code, String(r.refusal.data?.reason ?? ''), r.message, undefined, opts);
    (e as { refusal: Refusal }).refusal = r.refusal;
    return e;
  }
}

/** A server→client notification (JSON-RPC 2.0: no id), e.g. log.read{follow} `event` frames. */
export interface RpcNotificationFrame {
  jsonrpc: '2.0';
  rpc: typeof GNOMON_RPC;
  method: string;
  params: unknown;
}

export function notificationFrame(method: string, params: unknown): RpcNotificationFrame {
  return { jsonrpc: '2.0', rpc: GNOMON_RPC, method, params };
}

export function resultFrame(id: RpcId, result: unknown): RpcResultFrame {
  return { jsonrpc: '2.0', rpc: GNOMON_RPC, id, result };
}

export function errorFrame(id: RpcId, r: RefusalWithMessage): RpcErrorFrame {
  return { jsonrpc: '2.0', rpc: GNOMON_RPC, id, error: { code: JSON_RPC_CODES[r.refusal.code], message: r.message, data: r.refusal } };
}

export function requestFrame(id: RpcId, method: string, params?: unknown): RpcRequestFrame {
  return { jsonrpc: '2.0', rpc: GNOMON_RPC, id, method, ...(params !== undefined ? { params } : {}) };
}

function isId(v: unknown): v is RpcId {
  return v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
}

export type ParsedRequest = { ok: true; frame: RpcRequestFrame } | ({ ok: false; id: RpcId } & RefusalWithMessage);

/** Validate a decoded object as a `gnomon-rpc:v1` request. */
export function parseRequest(value: Record<string, unknown>): ParsedRequest {
  const id: RpcId = isId(value.id) ? value.id : null;
  const bad = (reason: string, message: string): ParsedRequest => ({ ok: false, id, ...refusalWith('BAD_REQUEST', reason, message) });
  if (value.jsonrpc !== '2.0') return bad('jsonrpc-version', 'frame must carry "jsonrpc":"2.0"');
  if (value.rpc !== GNOMON_RPC) return bad('rpc-tag', `frame must carry "rpc":"${GNOMON_RPC}"`);
  if (Object.hasOwn(value, 'id') && !isId(value.id)) return bad('request-id', 'id must be a string, number or null');
  if (typeof value.method !== 'string' || value.method.length === 0) return bad('method-missing', 'method must be a non-empty string');
  return { ok: true, frame: value as unknown as RpcRequestFrame };
}

/** The reason string of an error frame's refusal (diagnostics, tests). */
export function reasonOf(frame: RpcResponseFrame): string | undefined {
  return 'error' in frame ? (frame.error.data.data?.reason as string | undefined) : undefined;
}
