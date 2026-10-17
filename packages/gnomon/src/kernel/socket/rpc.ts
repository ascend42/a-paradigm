/**
 * #socket (spec §4.9) — the minimal, LOCAL `gnomon-rpc:v1` frame shapes PR-5
 * needs. Deliberately not imported from @a-company/gnomon-contracts: the
 * contracts are being rewritten in parallel (PR-3); M1.4 swaps these for the
 * contract types and `refusal:v1`. The code values are the §4.9 total map.
 */
export const GNOMON_RPC = 'gnomon-rpc:v1' as const;

export const RPC_ERROR_CODES = Object.freeze({
  ENGINE: -32000,
  AUTH: -32001,
  FORBIDDEN: -32002,
  NOT_FOUND: -32004,
  UNSUPPORTED: -32005,
  BAD_REQUEST: -32600,
  UNKNOWN_VERB: -32601,
} as const);

export type RpcErrorName = keyof typeof RPC_ERROR_CODES;
export type RpcId = string | number | null;

/** Refusal-shaped error data (a local stand-in for `refusal:v1`). */
export interface PendingRefusal {
  code: RpcErrorName;
  reason: string;
  message: string;
  detail?: Record<string, unknown>;
}

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
  error: { code: number; message: string; data: PendingRefusal };
}

export type RpcResponseFrame = RpcResultFrame | RpcErrorFrame;

/** Throw from a handler to answer with a refusal-shaped error. */
export class RpcRefusal extends Error {
  readonly refusal: PendingRefusal;
  constructor(code: RpcErrorName, reason: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'RpcRefusal';
    this.refusal = { code, reason, message, ...(detail ? { detail } : {}) };
  }
}

export function resultFrame(id: RpcId, result: unknown): RpcResultFrame {
  return { jsonrpc: '2.0', rpc: GNOMON_RPC, id, result };
}

export function errorFrame(id: RpcId, refusal: PendingRefusal): RpcErrorFrame {
  return { jsonrpc: '2.0', rpc: GNOMON_RPC, id, error: { code: RPC_ERROR_CODES[refusal.code], message: refusal.message, data: refusal } };
}

export function requestFrame(id: RpcId, method: string, params?: unknown): RpcRequestFrame {
  return { jsonrpc: '2.0', rpc: GNOMON_RPC, id, method, ...(params !== undefined ? { params } : {}) };
}

function isId(v: unknown): v is RpcId {
  return v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
}

export type ParsedRequest = { ok: true; frame: RpcRequestFrame } | { ok: false; id: RpcId; refusal: PendingRefusal };

/** Validate a decoded object as a `gnomon-rpc:v1` request. */
export function parseRequest(value: Record<string, unknown>): ParsedRequest {
  const id: RpcId = isId(value.id) ? value.id : null;
  const bad = (reason: string, message: string): ParsedRequest => ({
    ok: false,
    id,
    refusal: { code: 'BAD_REQUEST', reason, message },
  });
  if (value.jsonrpc !== '2.0') return bad('jsonrpc-version', 'frame must carry "jsonrpc":"2.0"');
  if (value.rpc !== GNOMON_RPC) return bad('rpc-tag', `frame must carry "rpc":"${GNOMON_RPC}"`);
  if (Object.hasOwn(value, 'id') && !isId(value.id)) return bad('id', 'id must be a string, number or null');
  if (typeof value.method !== 'string' || value.method.length === 0) return bad('method', 'method must be a non-empty string');
  return { ok: true, frame: value as unknown as RpcRequestFrame };
}
