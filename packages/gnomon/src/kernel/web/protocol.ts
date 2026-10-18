/**
 * @symbol #web-endpoint
 *
 * #web-endpoint (spec §2.1, §4.9 WebSocket paragraph, §11.2 rule 1b) — the
 * kernel ⇄ `gnomon-web` transport-child channel: NDJSON records over the
 * child's stdio, plus the IPC channel (stdio fd 3) that carries ONLY the
 * connected sockets the kernel accepted (`subprocess.send('conn', socket)`;
 * WEB_CONN_MESSAGE). The child listens on nothing (§15.5, T-2026-10-18-020).
 * ZERO imports on purpose: the child imports this file, and its
 * import closure must reach no key, no log and no kernel state.
 *
 * Division of labour (A24-1). The child parses bytes — HTTP requests, the
 * RFC 6455 upgrade and frames — and FORWARDS records; it never interprets a
 * frame, never holds a token's meaning and never answers on its own beyond
 * the mechanical RFC 6455 refusals (close codes 1002/1003/1007/1009, §4.9).
 * Every §11.2 rule (host, origin, Sec-Fetch-Site, token, deadline, limits,
 * headers) is decided by the kernel, which then tells the child exactly what
 * to write.
 *
 * Child → kernel (stdout):
 *   ready     {bundleHash, files}               bundle hashed + loaded; handed sockets are served from now on
 *   http      {rid, method, path, headers, body?, bodyOver?}
 *   upgrade   {rid, method, path, headers}
 *   frame     {rid, data}                       one complete, valid UTF-8 text frame (base64 of its bytes)
 *   closed    {rid, code, why}                  a WebSocket ended (either side)
 *   pressure  {rid, bytes}                      a WebSocket's unsent bytes passed the high-water mark
 *   drain     {rid}                             …and drained again
 *   fatal     {why}                             the child cannot continue (it exits next)
 * Kernel → child (stdin):
 *   config    {bundleDir, pingMs, missedPongs, maxFrameBytes, preAuthMaxFrameBytes,
 *              maxBodyBytes, maxSocketBuffer, writeHighWater, defaultHeaders}   first record, once
 *
 * The kernel VALIDATES every child record (validateChildRecord): a record
 * outside the closed shape set means the child is no longer trusted and is
 * killed (Aegis C1) — a compromised child must not crash or steer the daemon.
 *   respond   {rid, status, headers, body?}     answer an HTTP request / refuse an upgrade
 *   static    {rid, file, headers}              serve one in-memory bundle file
 *   accept    {rid}                             complete the RFC 6455 handshake
 *   send      {rid, data}                       one text frame (base64 of its UTF-8 bytes)
 *   close     {rid, code}                       close a WebSocket with `code`
 *   limit     {rid, maxFrameBytes}              raise a connection's inbound frame cap (sent on authentication)
 *   shutdown  {}
 */

export const WEB_CHANNEL = 'gnomon-web:v2' as const;
/** The IPC message that carries one connected socket from the kernel's 127.0.0.1 listener to the child. */
export const WEB_CONN_MESSAGE = 'conn' as const;

/** One JSON-RPC message per unfragmented text frame, at most 4 MiB (§4.9). */
export const WS_MAX_FRAME_BYTES = 4 * 1024 * 1024;
/** Child records are NDJSON; a 4 MiB frame travels base64 (4/3) inside one record. */
export const CHANNEL_MAX_RECORD_BYTES = 8 * 1024 * 1024;
/** The child pings every 30 s and closes after two missed pongs (§4.9). */
export const WS_PING_MS = 30_000;
export const WS_MISSED_PONGS = 2;
/** The size cap of an HTTP request body (`/diag`, `/blob`, §11.1). */
export const HTTP_MAX_BODY_BYTES = 64 * 1024;
/** Inbound frame cap per connection until it authenticates (the socket's PRE_AUTH_MAX_FRAME_BYTES). */
export const WS_PRE_AUTH_MAX_FRAME_BYTES = 16 * 1024;
/** A WebSocket whose unsent bytes pass this is closed 1008 by the child (backpressure, Aegis C6). */
export const WS_MAX_SOCKET_BUFFER = 8 * 1024 * 1024;
/** Unsent bytes at which the child reports `pressure` for a connection. */
export const WS_WRITE_HIGH_WATER = 1024 * 1024;

export type HeaderMap = Record<string, string>;

export type ChildRecord =
  | { t: 'ready'; bundleHash: string; files: number }
  | { t: 'http'; rid: number; method: string; path: string; headers: HeaderMap; body?: string; bodyOver?: boolean }
  | { t: 'upgrade'; rid: number; method: string; path: string; headers: HeaderMap }
  | { t: 'frame'; rid: number; data: string }
  | { t: 'closed'; rid: number; code: number; why: string }
  | { t: 'pressure'; rid: number; bytes: number }
  | { t: 'drain'; rid: number }
  | { t: 'fatal'; why: string };

export interface ChildConfig {
  t: 'config';
  bundleDir: string;
  pingMs: number;
  missedPongs: number;
  maxFrameBytes: number;
  preAuthMaxFrameBytes: number;
  maxBodyBytes: number;
  maxSocketBuffer: number;
  writeHighWater: number;
  /** Headers on every response the child writes on its own (503, 404): the rule-6 set. */
  defaultHeaders: HeaderMap;
  /** How long the child waits for the kernel's answer to a request before its own 503 (default 10 s). */
  answerTimeoutMs?: number;
}

export type KernelRecord =
  | ChildConfig
  | { t: 'respond'; rid: number; status: number; headers: HeaderMap; body?: string }
  | { t: 'static'; rid: number; file: string; headers: HeaderMap }
  | { t: 'accept'; rid: number }
  | { t: 'send'; rid: number; data: string }
  | { t: 'close'; rid: number; code: number }
  | { t: 'limit'; rid: number; maxFrameBytes: number }
  | { t: 'shutdown' };

/** Encode one record as an NDJSON line. */
export function encodeRecord(r: ChildRecord | KernelRecord): string {
  return `${JSON.stringify(r)}\n`;
}

/** Lower-cased header map from Node's IncomingHttpHeaders (arrays joined with ", "; set-cookie-like duplicates are irrelevant inbound). */
export function flattenHeaders(h: Record<string, string | string[] | undefined>): HeaderMap {
  const out: HeaderMap = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

/* ── strict validation of child records (Aegis C1) ────────────────────── */

const MAX_HEADERS = 128;
const MAX_HEADER_VALUE = 16 * 1024;
const MAX_PATH = 8 * 1024;
const MAX_WHY = 256;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const b64Max = (bytes: number): number => Math.ceil(bytes / 3) * 4;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const isRid = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isB64 = (v: unknown, maxBytes: number): v is string => typeof v === 'string' && v.length <= b64Max(maxBytes) && B64.test(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
function isHeaders(v: unknown): v is HeaderMap {
  if (!isObj(v)) return false;
  const e = Object.entries(v);
  return e.length <= MAX_HEADERS && e.every(([k, x]) => k.length > 0 && k.length <= 256 && isStr(x, MAX_HEADER_VALUE));
}
function exactKeys(v: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const ks = Object.keys(v);
  return required.every((k) => Object.hasOwn(v, k)) && ks.every((k) => required.includes(k) || optional.includes(k));
}

/** The record, if it has exactly one of the closed shapes; null otherwise (the kernel then kills the child). */
export function validateChildRecord(v: unknown, limits: { maxFrameBytes: number; maxBodyBytes: number }): ChildRecord | null {
  if (!isObj(v) || typeof v.t !== 'string') return null;
  switch (v.t) {
    case 'ready':
      return exactKeys(v, ['t', 'bundleHash', 'files']) && isStr(v.bundleHash, 80) && isInt(v.files, 0, 1_000_000) ? (v as ChildRecord) : null;
    case 'http':
      return exactKeys(v, ['t', 'rid', 'method', 'path', 'headers'], ['body', 'bodyOver']) &&
        isRid(v.rid) &&
        isStr(v.method, 16) &&
        isStr(v.path, MAX_PATH) &&
        isHeaders(v.headers) &&
        (v.body === undefined || isB64(v.body, limits.maxBodyBytes)) &&
        (v.bodyOver === undefined || v.bodyOver === true)
        ? (v as ChildRecord)
        : null;
    case 'upgrade':
      return exactKeys(v, ['t', 'rid', 'method', 'path', 'headers']) && isRid(v.rid) && isStr(v.method, 16) && isStr(v.path, MAX_PATH) && isHeaders(v.headers) ? (v as ChildRecord) : null;
    case 'frame':
      return exactKeys(v, ['t', 'rid', 'data']) && isRid(v.rid) && isB64(v.data, limits.maxFrameBytes) ? (v as ChildRecord) : null;
    case 'closed':
      return exactKeys(v, ['t', 'rid', 'code', 'why']) && isRid(v.rid) && isInt(v.code, 0, 65535) && isStr(v.why, MAX_WHY) ? (v as ChildRecord) : null;
    case 'pressure':
      return exactKeys(v, ['t', 'rid', 'bytes']) && isRid(v.rid) && isInt(v.bytes, 0, Number.MAX_SAFE_INTEGER) ? (v as ChildRecord) : null;
    case 'drain':
      return exactKeys(v, ['t', 'rid']) && isRid(v.rid) ? (v as ChildRecord) : null;
    case 'fatal':
      return exactKeys(v, ['t', 'why']) && isStr(v.why, 4096) ? (v as ChildRecord) : null;
    default:
      return null;
  }
}
