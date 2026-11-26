// #dimension-mod model (spec §12.7): pure functions, no I/O and no platform import. Everything that decides what a
// dimension row may hold lives here, so the stdio loop (index.mjs) is only plumbing and the rules can be tested
// without a host. The fold and the validator are the published `dim-shape:v1` (dim-shape.mjs, generated).
import {
  DIM_AGENT_LABEL_PATTERN,
  DIM_AUX_KINDS,
  DIM_FIELDS,
  DIM_ID_PATTERN,
  DIM_KINDS,
  DIM_LIMITS,
  DIM_NODE_ID_PATTERN,
  DIM_OPENED,
  DIM_OP_ID_PATTERN,
  DIM_REFUSAL_CODES,
  DIM_REFUSAL_FIXES,
  DIM_ROW_VERSION,
  DIM_VIEW_PRINCIPAL_PATTERN,
  DIM_Z_PATTERN,
  dimGrantDefault,
  dimHash,
  dimMayDraw,
  dimViewOf,
  dimZPlace,
  emptyDimState,
  foldDimRow,
  validateDimOps,
} from './dim-shape.mjs';

/** `dim.select`: ids one selection may name. */
export const SELECT_MAX = 64;
/** Op-row oids a dimension remembers (memory and keyframe): an oid in them never appends again (A8). */
export const MEMO_CAP = 256;
/** Whole answers kept in memory per dimension, with the hash of their input (same id + other input: op-id-reused). */
export const ANSWERS_CAP = 32;
/** S1.4 C5 / Aegis M8: accepted ops one session may draw in one turn, across calls, rows and dimensions. */
export const TURN_OPS = 64;
/** Sessions the `turns` state key holds; the least recently charged one is evicted (stated residual). */
export const TURNS_CAP = 256;
/** `opens`: sessions whose last opened dimension is remembered (the tools' default `dim`). */
export const OPENS_CAP = 256;
/** One tool call: at most this many op rows, inside the host's 64 KiB per-call byte budget (bridge.ts). */
export const CALL_ROWS = 4;
export const CALL_BYTES = 64 * 1024;
/** Bytes of the call budget kept for the count row, so a full draw with a refusal still writes it (Aegis A4). */
export const COUNT_ROW_RESERVE = 3 * 1024;
/** Count rows one session may write per turn. */
export const COUNT_ROWS_PER_TURN = 8;
/** `field|code` pairs one count row lists; the rest is one `more` count. */
export const COUNT_PAIRS = 32;
/** `dim-view`: nodes listed by default and at most; change entries a `since` answer lists. */
export const VIEW_LIMIT = 200;
export const VIEW_LIMIT_MAX = 500;
export const CHANGES_MAX = 64;

/** Dimensions one home may hold (the index lives in mod state, 1 MiB in all). */
export const DIM_CAP = 512;
/** Sessions one dimension may have attached. */
export const ATTACH_CAP = 16;
/** The host's append limits (modhost/bridge.ts), checked here BEFORE the append so a refusal is ours and named. */
export const ROW_MAX_BYTES = 16 * 1024;
export const ROW_MAX_VISITED = 4096;
export const ROW_MAX_DEPTH = 32;
/** The title a dimension gets when a session's name cannot be one. */
export const FALLBACK_TITLE = 'Board';
export const KEYFRAME_EVERY_OPS = 256;
export const KEYFRAME_DIMS = 4;
export const KEYFRAME_CHUNK_BYTES = 60 * 1024;
export const KEYFRAME_MAX_BYTES = 256 * 1024;
/** All keyframes together: the rest of the 1 MiB store is kept for the index. */
export const KEYFRAME_BUDGET_BYTES = 640 * 1024;

/** Command-level refusals: a code and ONE fixed sentence each. A refusal never carries input. */
export const MOD_REFUSAL_FIXES = Object.freeze({
  'not-human-gui': 'Only a person using the Gnomon window can change a dimension.',
  'no-session': 'Open the dimension from a live session; none was named, or the named one is not live.',
  'command-unknown': 'Use one of the commands dim.open, dim.attach, dim.op, dim.close, dim.grant, dim.select or dim.check.',
  'args-bad': 'Send only the listed arguments of this command, each with its listed type.',
  'dim-bad': 'Use dim: followed by a 26-character ULID as the dimension id.',
  'opened-bad': 'Say how the dimension was opened: command, menu or offer.',
  'title-missing': 'Give a new dimension a title.',
  'title-bad': 'Use a title of 1 to 120 characters with no control or invisible characters.',
  'title-secret': 'Remove the credential from the title; rows are permanent, so nothing that looks like a secret is stored.',
  'dim-cap': 'This home already holds 512 dimensions; no more can be created.',
  'dim-unknown': 'Name a dimension that exists; open it with dim.open first.',
  'repo-mismatch': 'This dimension belongs to another repository; open it from a session of its own repository.',
  'not-attached': 'This session is not attached to the dimension; attach it first.',
  'attach-cap': 'This dimension already has 16 sessions attached; no more can be attached.',
  'dim-ended': 'This dimension is closed; open it again before drawing.',
  'ops-refused': 'None of the ops could be applied; each one is refused by name.',
  secret: 'Remove the credential from the text; op rows are permanent, so nothing that looks like a secret is stored.',
  'row-too-large': 'Send fewer or smaller ops in one call; one row holds at most 16 KiB and 4,096 values.',
  'append-failed': 'The row was not written; nothing changed. Try again in a moment.',
  unavailable: 'The dimension could not be read from the log; nothing changed.',
  // S1.4: the agent tools (dim-view, dim-draw), grants and the turn budget
  'not-agent-tool': 'Only the agent of a live session can use the board tools.',
  'no-turn': 'The board tools work only inside a turn of the calling session.',
  'no-open-dim': 'This session has no board open. Ask the person to open a board with /board.',
  'write-not-granted': 'The person has not let this session draw on this board. Ask them to turn on "may draw" for it; dim-view still reads the board.',
  'turn-budget': 'This turn has used its 64 ops. Stop drawing; the count starts again on the next turn.',
  'call-too-large': 'Send fewer or smaller ops; one call holds at most 4 rows of 16 KiB each.',
  'op-id-bad': 'Use an opId of 1 to 64 characters from A-Z, a-z, 0-9, _ and -.',
  'op-id-reused': 'This opId was already used for a different draw. Use a new opId for new ops.',
  'append-busy': 'The row was not written: the board is taking too many rows this second. Nothing changed for it; send it again in a moment.',
  cancelled: 'The call took too long and was stopped. Rows it had already written stay; read the board again before you retry.',
});
export const MOD_REFUSAL_CODES = Object.freeze(Object.keys(MOD_REFUSAL_FIXES));

/** A command refusal result. */
export function refusal(code, extra) {
  const c = Object.hasOwn(MOD_REFUSAL_FIXES, code) ? code : 'args-bad';
  return { ok: false, code: c, fix: MOD_REFUSAL_FIXES[c], ...(extra ?? {}) };
}

/** The fixed sentence of a code from either closed list (the mod's, then the published validator's). */
export function fixFor(code) {
  if (Object.hasOwn(MOD_REFUSAL_FIXES, code)) return MOD_REFUSAL_FIXES[code];
  if (Object.hasOwn(DIM_REFUSAL_FIXES, code)) return DIM_REFUSAL_FIXES[code];
  return MOD_REFUSAL_FIXES['args-bad'];
}

/** A plain object (prototype null or Object.prototype), else null. */
export function plain(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const p = Object.getPrototypeOf(v);
  return p === null || p === Object.prototype ? v : null;
}
/** An OWN property, or undefined: nothing here is read through a prototype. */
export const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const nonEmpty = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

const STAMP_FIELDS = ['principal', 'connId', 'surface'];
/**
 * The stamp the host writes on a row of this call, rebuilt from what the host told the mod (`relayedFor` of a
 * command is exactly {principal, connId, surface?}). Used to fold a row the way the log holds it, and to measure it.
 */
export function stampOf(relayedFor) {
  const r = plain(relayedFor);
  const out = {};
  if (!r) return out;
  for (const k of STAMP_FIELDS) {
    const v = own(r, k);
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Who is acting, from the HOST-WRITTEN `relayedFor` alone (never from args or input, S1.2 C2). A human only when
 * the stamp names a principal, its surface is `gui`, and it names no agent. Everything else is nobody: an agent,
 * session, voice or mod caller (no surface), a human on a device key (`cli`), and any tool call in S1.3.
 */
export function actorOf(relayedFor) {
  const r = plain(relayedFor);
  if (!r) return null;
  const principal = own(r, 'principal');
  if (!nonEmpty(principal, 256) || own(r, 'surface') !== 'gui' || Object.hasOwn(r, 'agent')) return null;
  return { cls: 'human', principal };
}

/**
 * The ONE entry for ops (A6): the command and, from S1.4, the agent tool are thin callers. Validates against the
 * state with the published validator and previews the state after. A secret anywhere, or no accepted op, yields
 * `ok: []` and `next === state`: nothing may be appended; so do ops too large for one row (`tooLarge`), which never
 * reach the validator. `ok` holds the validator's own copies (prototype keys
 * dropped at every depth); a row is built from `ok` only, never from the caller's ops.
 */
export function apply(state, ops, actor, opts = {}) {
  const none = { ok: [], refused: [], secret: false, tooLarge: false, next: state };
  if (!actor || (actor.cls !== 'human' && actor.cls !== 'agent')) return none;
  const stamp = actor.cls === 'human' ? { principal: actor.principal, surface: 'gui' } : { principal: actor.principal, surface: 'bridge', agent: actor.agent };
  // SIZE FIRST (Aegis S1.3 M2): the validator's secret scan reads a node's strings pairwise, on refused ops too, so
  // ops that could never fit one row (16 KiB, 4,096 values, depth 32) are refused before it is called at all
  if (Array.isArray(ops) && rowProblem(opPayload(state.dim, ops), opts.stamp ?? stamp)) return { ...none, tooLarge: true };
  const v = (opts.validate ?? validateDimOps)(state, ops, actor);
  if (v.secret || v.ok.length === 0) return { ...none, refused: v.refused, secret: v.secret };
  const next = landed(state, DIM_KINDS.op, opPayload(state.dim, v.ok), stamp, state.seq + 1);
  return { ok: v.ok, refused: v.refused, secret: false, tooLarge: false, next };
}

/** The state after a row this mod appended came back with its seq (the single-row fold step). */
export function landed(state, kind, payload, stamp, seq) {
  return foldDimRow(state, { seq, kind, payload: { ...payload, relayedFor: stamp } });
}

/** `oid` (S1.4, Aegis A8): 16 hex of sha256(hsid, 0x00, dim, 0x00, opId), computed by the caller. Never the model's string. */
export const opPayload = (dim, ok, oid) => ({ v: DIM_ROW_VERSION, dim, ops: ok, ...(oid !== undefined ? { oid } : {}) });
/** A first start row names the dimension; a reopen row carries NO title (the fold keeps the first one). */
export const startPayload = (dim, hsid, opened, title) => ({ v: DIM_ROW_VERSION, dim, ...(title !== undefined ? { title } : {}), attached: [hsid], opened });
export const attachPayload = (dim, hsid) => ({ v: DIM_ROW_VERSION, dim, hsid });
/** `modns.gnomon.dimension.grant`: `write` is exactly a boolean (readArgs refused anything else). */
export const grantPayload = (dim, hsid, write) => ({ v: DIM_ROW_VERSION, dim, hsid, write: write === true });
/** The counts are the mod's own, from its fold: never a caller's. */
export const endPayload = (state) => ({ v: DIM_ROW_VERSION, dim: state.dim, ops: state.ops, nodes: state.nodes.size });

const PROBE_ID = '00000000000000000000000000';
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
/**
 * `null` when the string may be a dimension title, else the refusal code. The secret check is the validator's own
 * (three texts: NFKD with invisible characters, combining marks and default-ignorables removed then NFC, the
 * S1.2 form NFKC with invisible characters removed, and the raw text), reached by validating a frame that
 * carries the title, so a title and a mark are scanned by one rule set.
 */
export function titleProblem(title) {
  if (title === undefined || title === null) return 'title-missing';
  if (typeof title !== 'string' || title.length > DIM_LIMITS.title || title.trim().length === 0 || INVISIBLE.test(title)) return 'title-bad';
  const v = validateDimOps(emptyDimState(), [{ type: 'add', node: { id: PROBE_ID, kind: 'frame', x: 0, y: 0, z: 'V', w: 1, h: 1, title } }], { cls: 'human', principal: 'p:probe/title' });
  if (v.secret) return 'title-secret';
  return v.ok.length === 1 ? null : 'title-bad';
}

/** The title a new dimension gets: a session's name is used only if it could be typed as one, else the fixed word. */
export function titleFor(title, fromSession) {
  const problem = titleProblem(title);
  if (problem === null) return { title };
  return fromSession ? { title: FALLBACK_TITLE } : { problem };
}

/**
 * Write grant of an attached session with no grant row: the first attached one is on, any later one is off. The
 * rule is the published `dimGrantDefault` (dim-shape.mjs), so the mod and the page cannot disagree (consumed in S1.4).
 */
export function grantDefault(state, hsid) {
  return dimGrantDefault(state, hsid) ? 'on' : 'off';
}

const utf8 = new TextEncoder();
/**
 * Would the host refuse this row? Measured as the host does: the canonical JSON bytes with the stamp included
 * (key order does not change a length), nesting, and the count of keys and elements.
 */
export function rowProblem(payload, stamp) {
  return rowBytes(payload, stamp) === null ? 'row-too-large' : null;
}

/** The canonical-JSON byte size of the row with its stamp, or `null` when the host would refuse it (see rowProblem). */
export function rowBytes(payload, stamp) {
  const full = { ...payload, relayedFor: stamp };
  // the walk first: it stops after 4,096 values whatever it is given, so the byte count below reads a bounded tree
  const stack = [{ v: full, depth: 1 }];
  let visited = 0;
  let chars = 0;
  while (stack.length > 0) {
    const { v, depth } = stack.pop();
    if (depth > ROW_MAX_DEPTH) return null;
    const keys = Array.isArray(v) ? null : Object.keys(v);
    const n = keys ? keys.length : v.length;
    visited += n;
    if (visited > ROW_MAX_VISITED) return null;
    for (let i = 0; i < n; i++) {
      const c = keys ? v[keys[i]] : v[i];
      if (keys) chars += keys[i].length;
      if (typeof c === 'string') chars += c.length;
      else if (c !== null && typeof c === 'object') stack.push({ v: c, depth: depth + 1 });
      // a UTF-8 byte count is never below the UTF-16 length: past the limit already, without encoding anything
      if (chars > ROW_MAX_BYTES) return null;
    }
  }
  try {
    const bytes = utf8.encode(JSON.stringify(full)).length;
    return bytes > ROW_MAX_BYTES ? null : bytes;
  } catch {
    return null;
  }
}

const REPO = /^repo:[0-9a-f]{16}$/;
/** Arguments each command may carry, beside the host-composed `hsid` and `repo`. Anything else is refused. */
export const COMMAND_ARGS = Object.freeze({
  'dim.open': Object.freeze(['dim', 'title', 'titleFrom', 'opened']),
  'dim.attach': Object.freeze(['dim']),
  'dim.op': Object.freeze(['dim', 'ops']),
  'dim.close': Object.freeze(['dim']),
  'dim.grant': Object.freeze(['dim', 'write']),
  'dim.select': Object.freeze(['dim', 'ids']),
  'dim.check': Object.freeze(['dim']),
});

/**
 * Read a command's args against its CLOSED shape (Aegis S1.3: nested prototype keys can reach a handler, so args
 * are never spread or assigned). Returns `{ dim, hsid, repo, ... }` built field by field from own keys, or a
 * refusal code. `ops` is passed on untouched: only `validateDimOps` reads it.
 */
export function readArgs(commandId, args) {
  if (!Object.hasOwn(COMMAND_ARGS, commandId)) return { code: 'command-unknown' };
  const a = plain(args);
  if (!a) return { code: 'args-bad' };
  const allowed = COMMAND_ARGS[commandId];
  for (const k of Object.keys(a)) if (k !== 'hsid' && k !== 'repo' && !allowed.includes(k)) return { code: 'args-bad' };
  const hsid = own(a, 'hsid');
  const repo = own(a, 'repo');
  // the host sets both or neither: absence is "no session"
  if (!nonEmpty(hsid, 128) || typeof repo !== 'string' || !REPO.test(repo)) return { code: 'no-session' };
  const dim = own(a, 'dim');
  if (typeof dim !== 'string' || !DIM_ID_PATTERN.test(dim)) return { code: 'dim-bad' };
  const out = { dim, hsid, repo };
  if (commandId === 'dim.open') {
    const opened = own(a, 'opened');
    if (typeof opened !== 'string' || !DIM_OPENED.includes(opened)) return { code: 'opened-bad' };
    const from = own(a, 'titleFrom');
    if (from !== undefined && from !== 'session' && from !== 'user') return { code: 'args-bad' };
    out.opened = opened;
    out.title = own(a, 'title');
    out.fromSession = from === 'session';
  }
  if (commandId === 'dim.op') out.ops = own(a, 'ops');
  if (commandId === 'dim.grant') {
    // the session the grant is FOR is the host-composed `hsid` (the page names it as the focus; the host joins it
    // to a live session). `write` is a boolean and nothing else: a truthy string never grants.
    const write = own(a, 'write');
    if (typeof write !== 'boolean') return { code: 'args-bad' };
    out.write = write;
  }
  if (commandId === 'dim.select') {
    const ids = own(a, 'ids');
    if (!Array.isArray(ids) || ids.length > SELECT_MAX) return { code: 'args-bad' };
    const list = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (typeof id !== 'string' || !DIM_NODE_ID_PATTERN.test(id)) return { code: 'args-bad' };
      if (!list.includes(id)) list.push(id);
    }
    out.ids = list;
  }
  return { args: out };
}

/* ── keyframes ────────────────────────────────────────────────────────────── */

/** sha256 of any text through the bundled contract (it exports no bare hash): the hash of a state that holds only this title. */
export function sumOf(text) {
  return dimHash({ ...emptyDimState(), title: text });
}

const BY_CLS = ['human', 'agent', 'unknown'];
function byOk(by) {
  const b = plain(by);
  if (!b || !BY_CLS.includes(own(b, 'cls')) || typeof own(b, 'principal') !== 'string') return null;
  const agent = own(b, 'agent');
  if (agent !== undefined && typeof agent !== 'string') return null;
  return { cls: b.cls, principal: b.principal, ...(agent !== undefined ? { agent } : {}) };
}

const OID = /^[0-9a-f]{16}$/;
/** The auxiliary part of a keyframe as lists (never an object keyed by hsid: see DimGrants in dim-shape). */
function encodeAux(aux) {
  const grants = [];
  if (aux && aux.grants instanceof Map) for (const [hsid, g] of aux.grants) if (plain(g) && typeof g.write === 'boolean' && Number.isSafeInteger(g.seq)) grants.push([hsid, g.write, g.seq]);
  const oids = [];
  if (aux && aux.oids instanceof Map) for (const [oid, m] of aux.oids) if (OID.test(oid) && Number.isSafeInteger(m.applied) && Number.isSafeInteger(m.seq)) oids.push([oid, m.applied, m.seq]);
  return { grants, oids: oids.slice(-MEMO_CAP) };
}
function decodeAux(aux) {
  const a = plain(aux);
  if (!a || !Array.isArray(own(a, 'grants')) || !Array.isArray(own(a, 'oids'))) return null;
  const grants = new Map();
  for (const g of a.grants) {
    if (!Array.isArray(g) || g.length !== 3 || !nonEmpty(g[0], 256) || typeof g[1] !== 'boolean' || !Number.isSafeInteger(g[2]) || g[2] < 1) return null;
    grants.set(g[0], { write: g[1], seq: g[2] });
  }
  if (a.oids.length > MEMO_CAP) return null;
  const oids = new Map();
  for (const o of a.oids) {
    if (!Array.isArray(o) || o.length !== 3 || typeof o[0] !== 'string' || !OID.test(o[0]) || !Number.isSafeInteger(o[1]) || o[1] < 0 || !Number.isSafeInteger(o[2]) || o[2] < 1) return null;
    oids.set(o[0], { applied: o[1], seq: o[2] });
  }
  return { grants, oids };
}

/**
 * A state as a keyframe: a head and chunks of at most KEYFRAME_CHUNK_BYTES each. `hash` is the published
 * `dimHash`; `sum` covers every stored field, the log id included, so a damaged chunk or head is found. `null` above KEYFRAME_MAX_BYTES.
 * Keyframe `v: 2` (S1.4): the head also carries `aux`, the write grants (`[hsid, write, seq]`) and the op-id memo
 * (`[oid, applied, seq]`, the newest MEMO_CAP). Both are covered by `sum` and so by the log id: a grant's high-water
 * seq is a seq of ONE log, and a keyframe written for another log is refused whole, grants included.
 */
export function encodeKeyframe(state, log, aux) {
  const items = [];
  for (const [id, n] of state.nodes) items.push(['n', id, n.node, n.by, n.hsid, n.addedSeq]);
  for (const id of state.gone) items.push(['g', id]);
  const chunks = [];
  let cur = [];
  let size = 2;
  let total = 0;
  for (const it of items) {
    const b = utf8.encode(JSON.stringify(it)).length + 1;
    total += b;
    if (total > KEYFRAME_MAX_BYTES) return null;
    if (cur.length > 0 && size + b > KEYFRAME_CHUNK_BYTES) {
      chunks.push(cur);
      cur = [];
      size = 2;
    }
    cur.push(it);
    size += b;
  }
  if (cur.length > 0) chunks.push(cur);
  const meta = { dim: state.dim, title: state.title, attached: [...state.attached], ended: state.ended, ops: state.ops, unapplied: state.unapplied };
  const head = { v: 2, log, seq: state.seq, hash: dimHash(state), n: chunks.length, bytes: total, meta, aux: encodeAux(aux) };
  return { head: { ...head, sum: sumOf(JSON.stringify([head, chunks])) }, chunks };
}

/**
 * What a stored keyframe holds, `{ state, grants, oids }`, or `null` when anything about it is wrong (it is then
 * ignored and rebuilt from the log). A `v: 1` keyframe (S1.3) carries no grants and no memo: it is ignored, never
 * read as "no grant rows".
 */
export function decodeKeyframe(headIn, chunks, dim, log) {
  try {
    const h = plain(headIn);
    // a keyframe is a fold of ONE log's rows: another log's seqs mean nothing here (Aegis S1.3 L1)
    if (!h || typeof log !== 'string' || own(h, 'log') !== log) return null;
    if (own(h, 'v') !== 2 || !Number.isSafeInteger(own(h, 'seq')) || typeof own(h, 'hash') !== 'string' || typeof own(h, 'sum') !== 'string') return null;
    const m = plain(own(h, 'meta'));
    if (!m || own(m, 'dim') !== dim || typeof own(m, 'title') !== 'string' || typeof own(m, 'ended') !== 'boolean') return null;
    const attached = own(m, 'attached');
    if (!Array.isArray(attached) || !attached.every((x) => typeof x === 'string') || !Number.isSafeInteger(own(m, 'ops')) || !Number.isSafeInteger(own(m, 'unapplied'))) return null;
    if (!Array.isArray(chunks) || chunks.length !== own(h, 'n')) return null;
    const aux = decodeAux(own(h, 'aux'));
    if (!aux) return null;
    const head = { v: 2, log, seq: h.seq, hash: h.hash, n: h.n, bytes: own(h, 'bytes'), meta: { dim: m.dim, title: m.title, attached: [...attached], ended: m.ended, ops: m.ops, unapplied: m.unapplied }, aux: encodeAux(aux) };
    if (sumOf(JSON.stringify([head, chunks])) !== h.sum) return null;
    const nodes = new Map();
    const gone = new Set();
    for (const chunk of chunks) {
      if (!Array.isArray(chunk)) return null;
      for (const it of chunk) {
        if (!Array.isArray(it) || typeof it[1] !== 'string') return null;
        if (it[0] === 'g') gone.add(it[1]);
        else if (it[0] === 'n') {
          const by = byOk(it[3]);
          if (!plain(it[2]) || !by || !(it[4] === null || typeof it[4] === 'string') || !Number.isSafeInteger(it[5])) return null;
          nodes.set(it[1], { node: it[2], by, hsid: it[4], addedSeq: it[5] });
        } else return null;
      }
    }
    const state = { dim, title: m.title, attached: [...attached], ended: m.ended, nodes, gone, seq: h.seq, ops: m.ops, unapplied: m.unapplied };
    return dimHash(state) === h.hash ? { state, grants: aux.grants, oids: aux.oids } : null;
  } catch {
    return null;
  }
}

/* ── the agent tools (S1.4 §2): identity, input, budget and the view ───────── */

const TOOL_SURFACES = ['bridge', 'voice'];
const TOOL_STAMP_FIELDS = ['principal', 'connId', 'surface', 'agent', 'hsid', 'turn'];

/** The stamp the host writes on a row of a tool call: exactly the string fields of the `relayedFor` it sent. */
export function toolStampOf(relayedFor) {
  const r = plain(relayedFor);
  const out = {};
  if (!r) return out;
  for (const k of TOOL_STAMP_FIELDS) {
    const v = own(r, k);
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Who calls a tool, from the HOST-WRITTEN `relayedFor` alone (never from input; G-DDL-09). An agent only when the
 * stamp has a principal in the view's pattern, a tool surface (`bridge` or `voice`: both fold to `agent`, A5), an
 * agent label in its pattern and an hsid; anything else is `not-agent-tool`. The turn must be the kernel's
 * `turn:<hsid>/<n>` of that same hsid, else `no-turn`. `actorOf` stays human-only for commands.
 */
export function toolActorOf(relayedFor) {
  const r = plain(relayedFor);
  if (!r) return { code: 'not-agent-tool' };
  const principal = own(r, 'principal');
  const surface = own(r, 'surface');
  const agent = own(r, 'agent');
  const hsid = own(r, 'hsid');
  if (typeof principal !== 'string' || !DIM_VIEW_PRINCIPAL_PATTERN.test(principal)) return { code: 'not-agent-tool' };
  if (!TOOL_SURFACES.includes(surface) || typeof agent !== 'string' || !DIM_AGENT_LABEL_PATTERN.test(agent) || !nonEmpty(hsid, 128)) return { code: 'not-agent-tool' };
  const turn = own(r, 'turn');
  const prefix = `turn:${hsid}/`;
  const n = typeof turn === 'string' && turn.startsWith(prefix) && /^[1-9][0-9]{0,14}$/.test(turn.slice(prefix.length)) ? Number(turn.slice(prefix.length)) : null;
  if (n === null || !Number.isSafeInteger(n)) return { code: 'no-turn' };
  return { actor: { cls: 'agent', principal, agent, hsid, turn: n } };
}

export const TOOL_INPUT = Object.freeze({
  'dim-view': Object.freeze(['dim', 'since', 'limit']),
  'dim-draw': Object.freeze(['dim', 'ops', 'opId']),
});

/**
 * Read a tool's input against its CLOSED shape: own keys only, nothing spread or assigned, an unknown top-level key
 * refused `args-bad`. `ops` is passed on untouched (the tool sugar and the validator read it). `opId` is checked
 * here and never leaves the mod's call: only its hash (`oid`) is kept.
 */
export function readToolInput(tool, input) {
  if (!Object.hasOwn(TOOL_INPUT, tool)) return { code: 'args-bad' };
  const a = input === null || input === undefined ? {} : plain(input);
  if (!a) return { code: 'args-bad' };
  const allowed = TOOL_INPUT[tool];
  for (const k of Object.keys(a)) if (!allowed.includes(k)) return { code: 'args-bad' };
  const out = {};
  const dim = own(a, 'dim');
  if (dim !== undefined) {
    if (typeof dim !== 'string' || !DIM_ID_PATTERN.test(dim)) return { code: 'dim-bad' };
    out.dim = dim;
  }
  if (tool === 'dim-view') {
    const since = own(a, 'since');
    if (since !== undefined && (!Number.isSafeInteger(since) || since < 0)) return { code: 'args-bad' };
    const limit = own(a, 'limit');
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > VIEW_LIMIT_MAX)) return { code: 'args-bad' };
    if (since !== undefined) out.since = since;
    out.limit = limit ?? VIEW_LIMIT;
    return { args: out };
  }
  const opId = own(a, 'opId');
  if (opId !== undefined && (typeof opId !== 'string' || !DIM_OP_ID_PATTERN.test(opId))) return { code: 'op-id-bad' };
  const ops = own(a, 'ops');
  if (!Array.isArray(ops)) return { code: 'args-bad' };
  out.ops = ops;
  if (opId !== undefined) out.opId = opId;
  return { args: out };
}

/**
 * The ops this session may still draw in this turn (Aegis M8). `turns` maps hsid → {turn, used}; a newer turn
 * starts at TURN_OPS, an OLDER turn than the one stored has nothing left.
 */
export function budgetLeft(turns, actor) {
  const t = turns.get(actor.hsid);
  if (!t || actor.turn > t.turn) return TURN_OPS;
  if (actor.turn < t.turn) return 0;
  return Math.max(0, TURN_OPS - t.used);
}

/** The `turns` state key as a list `[hsid, turn, used, countRows]` (never an object keyed by hsid), and back. */
export function encodeTurns(turns) {
  return [...turns].map(([h, t]) => [h, t.turn, t.used, t.counts]);
}
export function decodeTurns(v) {
  const out = new Map();
  if (!Array.isArray(v)) return out;
  for (const e of v.slice(-TURNS_CAP)) {
    if (!Array.isArray(e) || e.length !== 4 || !nonEmpty(e[0], 128) || !Number.isSafeInteger(e[1]) || !Number.isSafeInteger(e[2]) || !Number.isSafeInteger(e[3])) continue;
    out.set(e[0], { turn: e[1], used: Math.min(Math.max(e[2], 0), TURN_OPS), counts: Math.max(e[3], 0) });
  }
  return out;
}

/** A stroke is shown as its point count and its box, never its point list (H1: an integer list can carry an encoding). */
function strokeView(n) {
  const pts = Array.isArray(n.points) ? n.points : [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  const out = {};
  for (const k of Object.keys(n)) if (k !== 'points') out[k] = n[k];
  out.points = Math.floor(pts.length / 2);
  if (pts.length >= 2 && typeof n.x === 'number' && typeof n.y === 'number') out.box = { x: n.x + minX, y: n.y + minY, w: maxX - minX, h: maxY - minY };
  return out;
}

/**
 * The `dim-view` answer from a fold: `dimViewOf` (bounded `by`, carried-through fields left out, stored values
 * re-checked), strokes as a count and a box, at most `limit` nodes in z order (`truncated` says how many there
 * are), or only the `touched` ids when a change list is answered. Appends nothing.
 */
export function viewAnswer(state, o) {
  const v = dimViewOf(state);
  const all = v.nodes.map((n) => (n.kind === 'stroke' ? strokeView(n) : n));
  const pick = o.touched ? all.filter((n) => o.touched.has(n.id)) : all;
  const nodes = pick.slice(0, o.limit);
  return {
    v: 1,
    dim: v.dim,
    title: v.title,
    seq: state.seq,
    hash: o.hash,
    open: !state.ended,
    mayDraw: o.mayDraw,
    budgetLeft: o.budgetLeft,
    nodes,
    legend: v.legend,
    selection: o.selection,
    ...(o.changes !== undefined ? { changes: o.changes } : {}),
    ...(pick.length > nodes.length ? { truncated: { nodes: pick.length } } : {}),
  };
}

const idOk = (x) => typeof x === 'string' && DIM_NODE_ID_PATTERN.test(x);
/**
 * Change entries from op rows (already in seq order, this dimension only): ids only, each list bounded by what one
 * row may hold, the hand from the row's stamp (`byOf(row)`). `null` when there are more than CHANGES_MAX entries:
 * the caller answers `changes: 'reset'` with the full view.
 */
export function changesOf(rows, byOf) {
  if (rows.length > CHANGES_MAX) return null;
  const touched = new Set();
  const entries = rows.map((row) => {
    const e = { seq: row.seq, by: byOf(row), added: [], updated: [], moved: [], deleted: [] };
    const ops = Array.isArray(own(row.payload, 'ops')) ? row.payload.ops.slice(0, DIM_LIMITS.opsPerRow) : [];
    for (const op of ops) {
      const o = plain(op);
      if (!o) continue;
      const type = own(o, 'type');
      if (type === 'add') {
        const id = own(plain(own(o, 'node')) ?? {}, 'id');
        if (idOk(id)) e.added.push(id);
      } else if (type === 'update' || type === 'delete') {
        const id = own(o, 'id');
        if (idOk(id)) (type === 'update' ? e.updated : e.deleted).push(id);
      } else if (type === 'move') {
        const ids = own(o, 'ids');
        if (Array.isArray(ids)) for (const id of ids.slice(0, DIM_LIMITS.moveIds)) if (idOk(id)) e.moved.push(id);
      }
    }
    for (const k of ['added', 'updated', 'moved', 'deleted']) for (const id of e[k]) touched.add(id);
    return e;
  });
  return { entries, touched };
}
