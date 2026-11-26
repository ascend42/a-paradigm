// #dimension-mod model (spec §12.7): pure functions, no I/O and no platform import. Everything that decides what a
// dimension row may hold lives here, so the stdio loop (index.mjs) is only plumbing and the rules can be tested
// without a host. The fold and the validator are the published `dim-shape:v1` (dim-shape.mjs, generated).
import {
  DIM_ACT_PATTERN,
  DIM_AGENT_LABEL_PATTERN,
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
  dimActOf,
  dimAttrDigest,
  dimChangeSetOf,
  dimGrantDefault,
  dimHash,
  dimRowBy,
  dimUndoMarkOf,
  dimViewOf,
  dimZPlace,
  emptyDimState,
  foldDim,
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
/**
 * S1.4 E1 (Aegis ruling 1, F8): marks of OTHER hands one session may touch in one turn, counted PER ID (a move's
 * ids each count), charged before the append like TURN_OPS. Of them at most TURN_FOREIGN_DELETES deletes and at
 * most TURN_FOREIGN_WORDS updates that set or clear text, label, title or refs. "Other hand": the mark's original
 * hand (`restoredFrom.by`, else `by`) is not the caller's.
 */
export const TURN_FOREIGN = 32;
export const TURN_FOREIGN_DELETES = 16;
export const TURN_FOREIGN_WORDS = 16;
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
  'command-unknown': 'Use one of the commands dim.open, dim.attach, dim.op, dim.close, dim.grant, dim.select, dim.check, dim.undo or dim.seen.',
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
  'write-not-granted': 'The person has not let this session edit this board. Ask them to turn on "may edit" for it; dim-view still reads the board.',
  'turn-budget': 'This turn has used its 64 ops. Stop drawing; the count starts again on the next turn.',
  'call-too-large': 'Send fewer or smaller ops; one call holds at most 4 rows of 16 KiB each.',
  'op-id-bad': 'Use an opId of 1 to 64 characters from A-Z, a-z, 0-9, _ and -.',
  'op-id-reused': 'This opId was already used for a different draw. Use a new opId for new ops.',
  'append-busy': 'The row was not written: the board is taking too many rows this second. Nothing changed for it; send it again in a moment.',
  cancelled: 'The call took too long and was stopped. Rows it had already written stay; read the board again before you retry.',
  // S1.4 E1 (edit-anything; Luna's E-design words, agent-facing): undo, the stale view and the foreign budget
  'undo-expired': 'This change is too old to undo in one step; view the board and change the marks yourself.',
  'undo-nothing': 'Nothing in that change is left to undo; view the board.',
  'undo-not-allowed': 'You may undo one person\'s change per turn; finish this turn first.',
  'undo-set-bad': 'That change was not shown to you; view the board and name a change from its changes.',
  'changed-since': 'Another hand changed this mark after your view; view it again before you edit it.',
  'foreign-budget': 'This turn has changed as many marks of other hands as it may (32, of them 16 removals and 16 rewritten words). Stop changing others\' marks; the count starts again on the next turn.',
  'not-pinned': 'That change is not standing on this board; nothing was released.',
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

/**
 * `oid` (S1.4, Aegis A8): 16 hex of sha256(hsid, 0x00, dim, 0x00, opId), computed by the caller. Never the model's string.
 * `marks` (S1.4 E1, Aegis ruling 3): `act` (a person's action id, pattern-checked by readArgs or minted by the mod)
 * and `undo` (built by the mod from its own plan, `undoMarker`). Never from input: no caller passes an input object here.
 */
export const opPayload = (dim, ok, oid, marks) => ({
  v: DIM_ROW_VERSION,
  dim,
  ops: ok,
  ...(oid !== undefined ? { oid } : {}),
  ...(marks && marks.act !== undefined ? { act: marks.act } : {}),
  ...(marks && marks.undo !== undefined ? { undo: marks.undo } : {}),
});
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
  return measure({ ...payload, relayedFor: stamp }, ROW_MAX_BYTES, ROW_MAX_VISITED);
}

/** The JSON byte size of `full`, or `null` past `maxBytes`, `maxVisited` values or depth ROW_MAX_DEPTH. */
export function measure(full, maxBytes, maxVisited) {
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
    if (visited > maxVisited) return null;
    for (let i = 0; i < n; i++) {
      const c = keys ? v[keys[i]] : v[i];
      if (keys) chars += keys[i].length;
      if (typeof c === 'string') chars += c.length;
      else if (c !== null && typeof c === 'object') stack.push({ v: c, depth: depth + 1 });
      // a UTF-8 byte count is never below the UTF-16 length: past the limit already, without encoding anything
      if (chars > maxBytes) return null;
    }
  }
  try {
    const bytes = utf8.encode(JSON.stringify(full)).length;
    return bytes > maxBytes ? null : bytes;
  } catch {
    return null;
  }
}

const REPO = /^repo:[0-9a-f]{16}$/;
/** Arguments each command may carry, beside the host-composed `hsid` and `repo`. Anything else is refused. */
export const COMMAND_ARGS = Object.freeze({
  'dim.open': Object.freeze(['dim', 'title', 'titleFrom', 'opened']),
  'dim.attach': Object.freeze(['dim']),
  'dim.op': Object.freeze(['dim', 'ops', 'act']),
  'dim.close': Object.freeze(['dim']),
  'dim.grant': Object.freeze(['dim', 'write']),
  'dim.select': Object.freeze(['dim', 'ids']),
  'dim.check': Object.freeze(['dim']),
  // S1.4 E1: a person undoes a change-set, and dismisses a standing notice (Aegis S1 to S3)
  'dim.undo': Object.freeze(['dim', 'of', 'ids', 'base']),
  'dim.seen': Object.freeze(['dim', 'of']),
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
  if (commandId === 'dim.op') {
    out.ops = own(a, 'ops');
    // S1.4 E1 (Aegis ruling 3): `act` is the page's id for ONE action, a ULID and nothing else. `undo`, `restored`
    // and `of` are not args of dim.op (the closed list above refuses them args-bad): only the mod writes a marker.
    const act = own(a, 'act');
    if (act !== undefined && (typeof act !== 'string' || !DIM_ACT_PATTERN.test(act))) return { code: 'args-bad' };
    if (act !== undefined) out.act = act;
  }
  if (commandId === 'dim.grant') {
    // the session the grant is FOR is the host-composed `hsid` (the page names it as the focus; the host joins it
    // to a live session). `write` is a boolean and nothing else: a truthy string never grants.
    const write = own(a, 'write');
    if (typeof write !== 'boolean') return { code: 'args-bad' };
    out.write = write;
  }
  if (commandId === 'dim.undo' || commandId === 'dim.seen') {
    const of = readOf(own(a, 'of'));
    if (!of) return { code: 'args-bad' };
    out.of = of;
  }
  if (commandId === 'dim.undo') {
    const ids = own(a, 'ids');
    if (ids !== undefined) {
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > SELECT_MAX || new Set(ids).size !== ids.length || !ids.every((x) => typeof x === 'string' && DIM_NODE_ID_PATTERN.test(x))) return { code: 'args-bad' };
      out.ids = [...ids];
    }
    const base = own(a, 'base');
    if (base !== undefined && (!Number.isSafeInteger(base) || base < 0)) return { code: 'args-bad' };
    if (base !== undefined) out.base = base;
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

/** Keyframe format. v3 (S1.4 E1) adds each node's attribution; a v1 or v2 keyframe is ignored and rebuilt from the log. */
export const KEYFRAME_VERSION = 3;

/**
 * A node's attribution as a keyframe item holds it (S1.4 E1; Aegis P5 gate): `null` when the fold holds none, else
 * an object of own keys only, each present only when the fold holds it: `cb`/`cs`/`ch` (changedBy, changedSeq,
 * changedHsid), `ob`/`os` (otherBy, otherSeq), `wb`/`ws` (wordsBy, wordsSeq) and `rf` ([id, by], restoredFrom).
 */
function attrOf(n) {
  const a = {};
  if (n.changedBy !== undefined) (a.cb = n.changedBy), (a.cs = n.changedSeq ?? 0), (a.ch = n.changedHsid ?? null);
  if (n.otherBy !== undefined) (a.ob = n.otherBy), (a.os = n.otherSeq ?? 0);
  if (n.wordsBy !== undefined) (a.wb = n.wordsBy), (a.ws = n.wordsSeq ?? 0);
  if (n.restoredFrom !== undefined) a.rf = [n.restoredFrom.id, n.restoredFrom.by];
  return Object.keys(a).length > 0 ? a : null;
}
const ATTR_KEYS = ['cb', 'cs', 'ch', 'ob', 'os', 'wb', 'ws', 'rf'];
const seqOk = (v) => Number.isSafeInteger(v) && v >= 0;
/** The fold fields of a keyframe item's attribution, `{}` for `null`, or `null` when anything about it is wrong. */
function attrFrom(v) {
  if (v === null) return {};
  const a = plain(v);
  if (!a || Object.keys(a).length === 0 || !Object.keys(a).every((k) => ATTR_KEYS.includes(k))) return null;
  const out = {};
  const pair = (byKey, seqKey, byField, seqField) => {
    const has = Object.hasOwn(a, byKey);
    if (has !== Object.hasOwn(a, seqKey)) return false;
    if (!has) return true;
    const by = byOk(a[byKey]);
    if (!by || !seqOk(a[seqKey])) return false;
    out[byField] = by;
    out[seqField] = a[seqKey];
    return true;
  };
  if (!pair('cb', 'cs', 'changedBy', 'changedSeq') || !pair('ob', 'os', 'otherBy', 'otherSeq') || !pair('wb', 'ws', 'wordsBy', 'wordsSeq')) return null;
  if (Object.hasOwn(a, 'ch') !== Object.hasOwn(a, 'cb')) return null;
  if (Object.hasOwn(a, 'ch')) {
    if (!(a.ch === null || typeof a.ch === 'string')) return null;
    out.changedHsid = a.ch;
  }
  if (Object.hasOwn(a, 'rf')) {
    const rf = a.rf;
    const by = Array.isArray(rf) && rf.length === 2 && typeof rf[0] === 'string' ? byOk(rf[1]) : null;
    if (!by) return null;
    out.restoredFrom = { id: rf[0], by };
  }
  return out;
}

/**
 * A state as a keyframe: a head and chunks of at most KEYFRAME_CHUNK_BYTES each. `hash` is the published
 * `dimHash`; `sum` covers every stored field, the log id included, so a damaged chunk or head is found. `null` above KEYFRAME_MAX_BYTES.
 * Keyframe `v: 2` (S1.4): the head also carries `aux`, the write grants (`[hsid, write, seq]`) and the op-id memo
 * (`[oid, applied, seq]`, the newest MEMO_CAP). Both are covered by `sum` and so by the log id: a grant's high-water
 * seq is a seq of ONE log, and a keyframe written for another log is refused whole, grants included.
 * Keyframe `v: 3` (S1.4 E1): a node item is `['n', id, node, by, hsid, addedSeq, attr]` (`attrOf`), so the sum, and
 * so the log id, covers attribution too; the head carries `attr` (`dimAttrDigest`) beside `hash`, and a decoded
 * state must answer both, so a keyframe whose attribution does not match its own digest is refused whole.
 */
export function encodeKeyframe(state, log, aux) {
  const items = [];
  for (const [id, n] of state.nodes) items.push(['n', id, n.node, n.by, n.hsid, n.addedSeq, attrOf(n)]);
  // v3: a deleted id with its original hand (`goneBy`, Aegis defence in depth), or null when the fold has none
  for (const id of state.gone) items.push(['g', id, state.goneBy?.get(id) ?? null]);
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
  const head = { v: KEYFRAME_VERSION, log, seq: state.seq, hash: dimHash(state), attr: dimAttrDigest(state), n: chunks.length, bytes: total, meta, aux: encodeAux(aux) };
  return { head: { ...head, sum: sumOf(JSON.stringify([head, chunks])) }, chunks };
}

/**
 * What a stored keyframe holds, `{ state, grants, oids }`, or `null` when anything about it is wrong (it is then
 * ignored and rebuilt from the log). A `v: 1` keyframe (S1.3) carries no grants and no memo: it is ignored, never
 * read as "no grant rows". A `v: 2` keyframe (S1.4 P2) carries no attribution: it is ignored too, never read as
 * "nobody changed anything" (the view, `attr` and the undo planner's `restoredFrom` would all misattribute).
 */
export function decodeKeyframe(headIn, chunks, dim, log) {
  try {
    const h = plain(headIn);
    // a keyframe is a fold of ONE log's rows: another log's seqs mean nothing here (Aegis S1.3 L1)
    if (!h || typeof log !== 'string' || own(h, 'log') !== log) return null;
    if (own(h, 'v') !== KEYFRAME_VERSION || !Number.isSafeInteger(own(h, 'seq')) || typeof own(h, 'hash') !== 'string' || typeof own(h, 'attr') !== 'string' || typeof own(h, 'sum') !== 'string') return null;
    const m = plain(own(h, 'meta'));
    if (!m || own(m, 'dim') !== dim || typeof own(m, 'title') !== 'string' || typeof own(m, 'ended') !== 'boolean') return null;
    const attached = own(m, 'attached');
    if (!Array.isArray(attached) || !attached.every((x) => typeof x === 'string') || !Number.isSafeInteger(own(m, 'ops')) || !Number.isSafeInteger(own(m, 'unapplied'))) return null;
    if (!Array.isArray(chunks) || chunks.length !== own(h, 'n')) return null;
    const aux = decodeAux(own(h, 'aux'));
    if (!aux) return null;
    const head = { v: KEYFRAME_VERSION, log, seq: h.seq, hash: h.hash, attr: h.attr, n: h.n, bytes: own(h, 'bytes'), meta: { dim: m.dim, title: m.title, attached: [...attached], ended: m.ended, ops: m.ops, unapplied: m.unapplied }, aux: encodeAux(aux) };
    if (sumOf(JSON.stringify([head, chunks])) !== h.sum) return null;
    const nodes = new Map();
    const gone = new Set();
    const goneBy = new Map();
    for (const chunk of chunks) {
      if (!Array.isArray(chunk)) return null;
      for (const it of chunk) {
        if (!Array.isArray(it) || typeof it[1] !== 'string') return null;
        if (it[0] === 'g') {
          if (it.length !== 3) return null;
          const by = it[2] === null ? null : byOk(it[2]);
          if (it[2] !== null && !by) return null;
          gone.add(it[1]);
          if (by) goneBy.set(it[1], by);
        }
        else if (it[0] === 'n') {
          const by = byOk(it[3]);
          if (it.length !== 7 || !plain(it[2]) || !by || !(it[4] === null || typeof it[4] === 'string') || !Number.isSafeInteger(it[5])) return null;
          const attr = attrFrom(it[6]);
          if (attr === null) return null;
          nodes.set(it[1], { node: it[2], by, hsid: it[4], addedSeq: it[5], ...attr });
        } else return null;
      }
    }
    const state = { dim, title: m.title, attached: [...attached], ended: m.ended, nodes, gone, goneBy, seq: h.seq, ops: m.ops, unapplied: m.unapplied };
    // the content and adder by the published hash, the attribution by the published digest (Aegis G7, P5 gate)
    return dimHash(state) === h.hash && dimAttrDigest(state) === h.attr ? { state, grants: aux.grants, oids: aux.oids } : null;
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
  'dim-draw': Object.freeze(['dim', 'ops', 'opId', 'base']),
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
  // S1.4 E1 (F4, Aegis ruling 6): optional; the seq of the caller's view. Checked per id against the fold.
  const base = own(a, 'base');
  if (base !== undefined && (!Number.isSafeInteger(base) || base < 0)) return { code: 'args-bad' };
  if (base !== undefined) out.base = base;
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

/** The foreign sub-budgets this session has left in this turn (as `budgetLeft`). */
export function foreignLeft(turns, actor) {
  const t = turns.get(actor.hsid);
  const full = { touch: TURN_FOREIGN, del: TURN_FOREIGN_DELETES, words: TURN_FOREIGN_WORDS };
  if (!t || actor.turn > t.turn) return full;
  if (actor.turn < t.turn) return { touch: 0, del: 0, words: 0 };
  return { touch: Math.max(0, TURN_FOREIGN - (t.foreign ?? 0)), del: Math.max(0, TURN_FOREIGN_DELETES - (t.fdel ?? 0)), words: Math.max(0, TURN_FOREIGN_WORDS - (t.fwords ?? 0)) };
}

const WORDS_FIELDS = ['text', 'label', 'title', 'refs'];
/**
 * What one accepted op charges to the foreign sub-budgets, from the state BEFORE the call (a mark this call adds
 * is the caller's own): `{touch, del, words}`, per id.
 */
export function foreignCharge(state, op, hand) {
  const out = { touch: 0, del: 0, words: 0 };
  const o = plain(op);
  if (!o) return out;
  const type = own(o, 'type');
  const ids = type === 'move' && Array.isArray(own(o, 'ids')) ? o.ids : type === 'update' || type === 'delete' ? [own(o, 'id')] : [];
  for (const id of ids) {
    const n = typeof id === 'string' ? state.nodes.get(id) : undefined;
    if (!n) continue;
    const original = n.restoredFrom?.by ?? n.by;
    if (original.cls === hand.cls && original.principal === hand.principal && original.agent === hand.agent) continue;
    out.touch += 1;
    if (type === 'delete') out.del += 1;
    const patch = type === 'update' ? plain(own(o, 'patch')) : null;
    if (patch && Object.keys(patch).some((k) => WORDS_FIELDS.includes(k))) out.words += 1;
  }
  return out;
}

/**
 * F4 / Aegis ruling 6: an update, move or delete of a mark changed or (re-)added after `base` is refused
 * `changed-since`, per op (a move: when any of its ids is). Read from the fold's own seqs, O(1) per id.
 */
export function changedSince(state, op, base) {
  const o = plain(op);
  if (!o) return false;
  const type = own(o, 'type');
  const ids = type === 'move' && Array.isArray(own(o, 'ids')) ? o.ids : type === 'update' || type === 'delete' ? [own(o, 'id')] : [];
  for (const id of ids) {
    const n = typeof id === 'string' ? state.nodes.get(id) : undefined;
    if (n && Math.max(n.addedSeq ?? 0, n.changedSeq ?? 0) > base) return true;
  }
  return false;
}

/**
 * The `turns` state key as a list `[hsid, turn, used, countRows, foreign, foreignDeletes, foreignWords]` (never an
 * object keyed by hsid), and back. The S1.4 P2 four-element form still decodes (no foreign use yet).
 */
export function encodeTurns(turns) {
  return [...turns].map(([h, t]) => [h, t.turn, t.used, t.counts, t.foreign ?? 0, t.fdel ?? 0, t.fwords ?? 0]);
}
export function decodeTurns(v) {
  const out = new Map();
  if (!Array.isArray(v)) return out;
  for (const e of v.slice(-TURNS_CAP)) {
    if (!Array.isArray(e) || (e.length !== 4 && e.length !== 7) || !nonEmpty(e[0], 128) || !e.slice(1).every((x) => Number.isSafeInteger(x))) continue;
    const f = e.length === 7 ? e : [0, 0, 0, 0, 0, 0, 0];
    out.set(e[0], { turn: e[1], used: Math.min(Math.max(e[2], 0), TURN_OPS), counts: Math.max(e[3], 0), foreign: Math.min(Math.max(f[4], 0), TURN_FOREIGN), fdel: Math.min(Math.max(f[5], 0), TURN_FOREIGN_DELETES), fwords: Math.min(Math.max(f[6], 0), TURN_FOREIGN_WORDS) });
  }
  return out;
}

/**
 * The view's byte bound (S1.4 E1, carried from the E0 review): a 500-node page with full attribution measured
 * 294,752 bytes as plain hands (108,752 without), past the bridge's 256 KiB result cap. Two measures:
 *  - attribution is COMPACT: `changedBy`, `otherBy`, `wordsBy` and `restoredFrom.by` are indices into the answer's
 *    `hands` list (each hand once, as `dimViewBy` bounds it); `by` stays the hand itself. The same page then
 *    measures under VIEW_NODE_BYTES;
 *  - the nodes of one answer hold at most VIEW_NODE_BYTES in all (a page of long texts is cut, `truncated`).
 */
export const VIEW_NODE_BYTES = 192 * 1024;
function compactAttribution(nodes) {
  const hands = [];
  const keys = new Map();
  const ix = (by) => {
    const k = JSON.stringify([by.cls, by.principal, by.agent ?? null]);
    if (!keys.has(k)) {
      keys.set(k, hands.length);
      hands.push(by);
    }
    return keys.get(k);
  };
  const out = nodes.map((n) => {
    if (n.changedBy === undefined && n.otherBy === undefined && n.wordsBy === undefined && n.restoredFrom === undefined) return n;
    const c = { ...n };
    for (const f of ['changedBy', 'otherBy', 'wordsBy']) if (c[f] !== undefined) c[f] = ix(c[f]);
    if (c.restoredFrom !== undefined) c.restoredFrom = { id: c.restoredFrom.id, by: ix(c.restoredFrom.by) };
    return c;
  });
  return { nodes: out, hands };
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
  const { nodes: listed, hands } = compactAttribution(pick.slice(0, o.limit));
  // the byte bound (S1.4 E1): the answer stays inside VIEW_MAX_BYTES; marks past it are left for a smaller
  // `limit` or a `since` view, and `truncated` says how many there are
  let bytes = 0;
  let fit = 0;
  for (; fit < listed.length; fit++) {
    bytes += utf8.encode(JSON.stringify(listed[fit])).length + 1;
    if (bytes > VIEW_NODE_BYTES) break;
  }
  const nodes = listed.slice(0, fit);
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
    ...(hands.length > 0 ? { hands } : {}),
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
    // S1.4 E1 (Aegis ruling 5): the change-set the row belongs to, so a later undo can name it from this view, and
    // `undo: {of}` when the row is an honoured undo (an agent then sees its turn was undone and does not redraw it)
    const r = { seq: row.seq, kind: DIM_KINDS.op, payload: row.payload };
    const cs = dimChangeSetOf(r);
    if (cs) e.set = ofOf(cs);
    const mark = Object.hasOwn(row.payload, 'undo') ? dimUndoMarkOf(r) : null;
    if (mark) e.undo = { of: ofOf(mark.of) };
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

/* ── dim-draw: tool sugar, packing and the count row ──────────────────────── */

const NEW_KEY = /^new:[a-z0-9]{1,16}$/;
/** A copy of an object's OWN enumerable keys, each defined (never assigned: an own `__proto__` stays a key the validator refuses by name). */
function copyOwn(o) {
  const out = {};
  for (const k of Object.keys(o)) setOwn(out, k, o[k]);
  return out;
}
function setOwn(o, k, v) {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

/**
 * Tool sugar, resolved BEFORE validation and never stored (S1.4 §2). An `add` may leave out `node.id` or give
 * `new:<key>` (`[a-z0-9]{1,16}`): the mod mints a ULID. `from`, `to` and `parent` of a later add or update may name
 * that `new:<key>`. An `add` with no `z` goes on top (`dimZPlace` above the highest z of the board and of the
 * call). Everything else passes through as given, for the validator to accept or refuse by name. `created` maps an
 * add's index to `{key?, id}`. `mint` is the caller's ULID source (this file does no I/O).
 */
export function resolveSugar(state, ops, mint) {
  const keys = new Map();
  let top = null;
  for (const [, n] of state.nodes) {
    const z = n.node.z;
    if (typeof z === 'string' && DIM_Z_PATTERN.test(z) && (top === null || z > top)) top = z;
  }
  const out = [];
  const created = new Map();
  // index → fields that name a new:<key> this call did not define before them (F4: their refusal says so)
  const unresolved = new Map();
  const miss = (i, f) => {
    if (!unresolved.has(i)) unresolved.set(i, new Set());
    unresolved.get(i).add(f);
  };
  const link = (target, src, i) => {
    for (const f of ['from', 'to', 'parent']) {
      const v = own(src, f);
      if (typeof v === 'string' && keys.has(v)) setOwn(target, f, keys.get(v));
      else if (typeof v === 'string' && v.startsWith('new:')) miss(i, f);
    }
  };
  for (let i = 0; i < ops.length; i++) {
    const o = plain(ops[i]);
    const type = o ? own(o, 'type') : undefined;
    const node = type === 'add' ? plain(own(o, 'node')) : null;
    const patch = type === 'update' ? plain(own(o, 'patch')) : null;
    if (node) {
      const n = copyOwn(node);
      const id = own(node, 'id');
      let key;
      if (typeof id === 'string' && id.startsWith('new:') && (!NEW_KEY.test(id) || keys.has(id))) miss(i, 'id');
      if (id === undefined || (typeof id === 'string' && NEW_KEY.test(id) && !keys.has(id))) {
        const m = mint();
        if (id !== undefined) {
          key = id.slice(4);
          keys.set(id, m);
        }
        setOwn(n, 'id', m);
      }
      const z = own(node, 'z');
      if (z === undefined) {
        const placed = dimZPlace(top, null);
        setOwn(n, 'z', placed);
        top = placed;
      } else if (typeof z === 'string' && DIM_Z_PATTERN.test(z) && (top === null || z > top)) top = z;
      link(n, node, i);
      const op = copyOwn(o);
      setOwn(op, 'node', n);
      out.push(op);
      if (typeof own(n, 'id') === 'string') created.set(i, { ...(key !== undefined ? { key } : {}), id: own(n, 'id') });
    } else if (patch) {
      const p = copyOwn(patch);
      link(p, patch, i);
      const op = copyOwn(o);
      setOwn(op, 'patch', p);
      out.push(op);
    } else {
      if (o && (type === 'update' || type === 'delete') && typeof own(o, 'id') === 'string' && own(o, 'id').startsWith('new:')) miss(i, 'id');
      if (o && type === 'move' && Array.isArray(own(o, 'ids')) && own(o, 'ids').some((x) => typeof x === 'string' && x.startsWith('new:'))) miss(i, 'ids');
      out.push(ops[i]);
    }
  }
  return { ops: out, created, unresolved };
}

/**
 * Pack accepted ops, in order, into at most CALL_ROWS rows that each pass the host's row limits, inside
 * `budgetBytes` in all. Returns the rows as lists of positions into `ok`, and `cut`: the first position that did
 * not fit (it and everything after it are refused `call-too-large`, so no later op lands without an earlier one).
 */
export function packRows(dim, ok, oid, stamp, budgetBytes) {
  const rows = [];
  let cur = [];
  let curBytes = 0;
  let used = 0;
  let i = 0;
  while (i < ok.length) {
    const b = rowBytes(opPayload(dim, [...cur.map((j) => ok[j]), ok[i]], oid), stamp);
    if (b !== null && used + b <= budgetBytes) {
      cur.push(i);
      curBytes = b;
      i++;
      continue;
    }
    if (cur.length === 0 || rows.length + 1 >= CALL_ROWS) break;
    rows.push(cur);
    used += curBytes;
    cur = [];
    curBytes = 0;
  }
  if (cur.length > 0) rows.push(cur);
  return { rows, cut: i };
}

/**
 * The count row of a draw with refusals (C5): closed enums and counts only. A key is `<field>|<code>` with the
 * field from DIM_FIELDS (else `unknown`) and the code from the two closed lists (else `unknown`): never input.
 */
export function countPayload(dim, refused) {
  const by = {};
  let pairs = 0;
  let more = 0;
  for (const r of refused) {
    const field = DIM_FIELDS.includes(r.field) ? r.field : 'unknown';
    const code = DIM_REFUSAL_CODES.includes(r.code) || Object.hasOwn(MOD_REFUSAL_FIXES, r.code) ? r.code : 'unknown';
    const k = `${field}|${code}`;
    if (Object.hasOwn(by, k)) by[k] += 1;
    else if (pairs < COUNT_PAIRS) {
      by[k] = 1;
      pairs++;
    } else more++;
  }
  return { v: DIM_ROW_VERSION, dim, n: refused.length, by, ...(more > 0 ? { more } : {}) };
}

/** A refusal entry of a draw: exactly `{index, field, code, fix}` from the closed lists (no rule, no swatch, no input). */
export function refusedEntry(index, field, code, fix) {
  return { index, field: DIM_FIELDS.includes(field) ? field : 'unknown', code, fix: fix ?? fixFor(code) };
}

/** F4: the fix of an op that names a new:<key> the call did not define before it (a fixed sentence, no input). */
export const NEW_KEY_FIX = 'Define this new:<key> in an earlier add of the same call (key: a-z and 0-9, up to 16), use it only as from, to or parent, or use the id an earlier answer gave in created[].';
/** F3: a repeat answered from the rows after a restart: the ops sent now were never compared. */
export const REPEAT_UNKNOWN_FIX = 'This opId was already used on this board before a restart, so these ops were not compared and nothing was written. Use dim-view to see the board, and send new ops under a new opId.';

/** JSON with every object's keys sorted (the op-id memo's input; the caller measured the value first). */
export function canonicalText(v) {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalText(x))).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalText(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/* ── change-sets, checkpoints and the recent-rows ring (S1.4 E1; Arky §3.2; Aegis G6, N1) ─────────────── */

/** Change-sets one loaded dimension keeps a checkpoint for (the state just before the set's first row). */
export const UNDO_SETS = 32;
/** Op rows of one loaded dimension kept in the ring (payload and stamp, for the planner's `after`). */
export const UNDO_ROWS = 512;
/** Rows the ring may keep past UNDO_ROWS while a PINNED set still needs them; past it even a pinned set goes. */
export const UNDO_ROWS_PINNED = 2048;
/** Pinned sets per dimension (G6; Luna's notice cap, both kinds together): a ninth unpins the oldest pinned set. */
export const UNDO_PINS = 8;
/** Checkpoint Map entries (nodes + deleted ids) the whole mod keeps (G6): past it the oldest unpinned set goes first. */
export const UNDO_ENTRIES_MAX = 1_000_000;
/** A person "has the board open" while a command of theirs for it came within this long (agent-on-agent pins). */
export const PRESENCE_MS = 10 * 60 * 1000;

/** The key of a change-set, `dimChangeSetOf`'s identity as one string (a person's is `(principal, act)`, never act alone). */
export function setKey(cs) {
  return cs.kind === 'act' ? `act\u0000${cs.principal}\u0000${cs.act}` : `turn\u0000${cs.hsid}\u0000${cs.turn}`;
}
/** A change-set as an `of` (the marker's and the commands' form). */
export const ofOf = (cs) => (cs.kind === 'act' ? { principal: cs.principal, act: cs.act } : { hsid: cs.hsid, turn: cs.turn });

/**
 * `of` as a command names it: exactly `{hsid, turn}` (turn `turn:<hsid>/<n>`) or `{principal, act}` (a ULID act);
 * own keys only. Returns the change-set or null. Read the way `dimUndoMarkOf` reads a marker's `of`.
 */
export function readOf(v) {
  const o = plain(v);
  if (!o) return null;
  const keys = Object.keys(o).sort().join(',');
  if (keys === 'hsid,turn') {
    const hsid = own(o, 'hsid');
    const turn = own(o, 'turn');
    if (!nonEmpty(hsid, 128) || typeof turn !== 'string' || !turn.startsWith(`turn:${hsid}/`) || !/^[1-9][0-9]{0,14}$/.test(turn.slice(`turn:${hsid}/`.length))) return null;
    return { kind: 'turn', hsid, turn };
  }
  if (keys === 'act,principal') {
    const principal = own(o, 'principal');
    const act = own(o, 'act');
    if (!nonEmpty(principal, 256) || typeof act !== 'string' || !DIM_ACT_PATTERN.test(act)) return null;
    return { kind: 'act', principal, act };
  }
  return null;
}

/**
 * A fresh history for one loaded fold. MEMORY ONLY: never state or a keyframe, dropped with the fold (G6). `before`:
 * the change-set keys of the op rows the cold open folded (a set seen there is held from no row, never in part).
 */
export function emptyHistory(log, before) {
  return { log, rows: [], sets: new Map(), pins: [], entries: 0, presentAt: -Infinity, before: before ?? new Set() };
}

const handSame = (a, b) => !!a && !!b && a.cls === b.cls && a.principal === b.principal && a.agent === b.agent;
const checkpointSize = (s) => s.nodes.size + s.gone.size;

/**
 * Note one op row that LANDED (its seq returned, or read from the log), with the state just before it. Opens a
 * change-set at its first row with that state as the checkpoint (a reference: a fold is replaced, never mutated),
 * marks what the set touched, pins it (G6) and applies the per-dimension bounds. `now` is the caller's clock.
 * `after` (a catch-up stretch): a later state, read only for the hand of a node `before` does not hold.
 * Returns the keys of the sets this note evicted.
 */
export function noteHistoryRow(h, before, row, now, after) {
  const r = { seq: row.seq, kind: DIM_KINDS.op, payload: row.payload };
  const cs = dimChangeSetOf(r);
  const key = cs ? setKey(cs) : null;
  h.rows.push({ ...r, key });
  if (cs) {
    let set = h.sets.get(key);
    if (!set) {
      // `straddles`: the set had rows before this fold was opened (its earlier rows are not held): never planned in part
      set = { key, cs, firstSeq: r.seq, seqs: [], before, pinned: false, offered: false, human: false, other: false, undidPerson: false, straddles: h.before.has(key) };
      h.sets.set(key, set);
      h.entries += checkpointSize(before);
    }
    set.seqs.push(r.seq);
    const hand = dimRowBy(r);
    const ops = Array.isArray(own(r.payload, 'ops')) ? r.payload.ops : [];
    for (const op of ops) {
      const o = plain(op);
      if (!o) continue;
      const t = own(o, 'type');
      const ids = t === 'move' && Array.isArray(own(o, 'ids')) ? o.ids : t === 'update' || t === 'delete' ? [own(o, 'id')] : [];
      for (const id of ids) {
        // a node's hand never changes after its add: any state that holds it answers (`after` for a catch-up stretch)
        const n = typeof id === 'string' ? (before.nodes.get(id) ?? after?.nodes.get(id)) : undefined;
        if (!n) continue;
        const original = n.restoredFrom?.by ?? n.by;
        if (handSame(original, hand)) continue;
        set.other = true;
        if (original.cls === 'human') set.human = true;
      }
    }
    const mark = Object.hasOwn(r.payload, 'undo') ? dimUndoMarkOf(r) : null;
    if (mark && mark.of.kind === 'act') set.undidPerson = true;
    offerPin(h, set, now);
  }
  return trimHistory(h);
}

/**
 * Pin a set the person still needs (G6; the orchestrator's ruling): one that touched a person's marks or undid a
 * person's action, and an agent's set that touched another hand's marks while a person has the board open. A
 * ninth pin unpins the oldest pinned set (it stays undoable until normal eviction, N1).
 */
function offerPin(h, set, now) {
  if (set.pinned) return;
  const present = now - h.presentAt <= PRESENCE_MS;
  const want = set.human || set.undidPerson || (set.cs.kind === 'turn' && set.other && present);
  if (set.cs.kind === 'turn' && set.other && present) set.offered = true;
  if (!want) return;
  set.pinned = true;
  h.pins.push(set.key);
  while (h.pins.length > UNDO_PINS) {
    const old = h.sets.get(h.pins.shift());
    if (old) old.pinned = false;
  }
}

/** A person's command for this dimension came now: agent-on-agent sets that landed while nobody looked are pinned. */
export function notePresence(h, now) {
  h.presentAt = now;
  for (const set of h.sets.values()) if (!set.pinned && !set.offered && set.cs.kind === 'turn' && set.other) offerPin(h, set, now);
}

/** Release one pinned set (dim.seen, or the person's undo of it). True when it was pinned. */
export function unpinSet(h, key) {
  const set = h.sets.get(key);
  if (!set || !set.pinned) return false;
  set.pinned = false;
  set.offered = true;
  h.pins = h.pins.filter((k) => k !== key);
  return true;
}

/** Drop one set and its checkpoint. */
export function evictSet(h, key) {
  const set = h.sets.get(key);
  if (!set) return;
  h.sets.delete(key);
  h.entries -= checkpointSize(set.before);
  if (set.pinned) h.pins = h.pins.filter((k) => k !== key);
}

/** The per-dimension bounds: UNDO_SETS sets (the oldest unpinned first), UNDO_ROWS rows (UNDO_ROWS_PINNED for pins). */
function trimHistory(h) {
  const gone = [];
  const oldest = (pinned) => {
    let best = null;
    for (const s of h.sets.values()) if (s.pinned === pinned && (best === null || s.firstSeq < best.firstSeq)) best = s;
    return best;
  };
  while (h.sets.size > UNDO_SETS) {
    const s = oldest(false) ?? oldest(true);
    gone.push(s.key);
    evictSet(h, s.key);
  }
  // rows older than every kept set's first row are needed by nothing
  let need = Infinity;
  for (const s of h.sets.values()) need = Math.min(need, s.firstSeq);
  let cut = 0;
  while (cut < h.rows.length && h.rows[cut].seq < need) cut++;
  // the ring: past UNDO_ROWS, a row goes with every set that needs it, unpinned first; pinned sets hold up to UNDO_ROWS_PINNED
  while (h.rows.length - cut > UNDO_ROWS) {
    const pinnedNeed = Math.min(Infinity, ...[...h.sets.values()].filter((s) => s.pinned).map((s) => s.firstSeq));
    if (h.rows[cut].seq >= pinnedNeed && h.rows.length - cut <= UNDO_ROWS_PINNED) {
      break;
    }
    const dropped = h.rows[cut].seq;
    cut++;
    for (const s of [...h.sets.values()]) if (s.firstSeq <= dropped) (gone.push(s.key), evictSet(h, s.key));
  }
  if (cut > 0) h.rows.splice(0, cut);
  return gone;
}

/**
 * The planner's input for one held set: its rows oldest first, each with the state just before it (folded forward
 * from the checkpoint through the ring, one copy per set row), and every other ring row after the set's first row.
 * `null` when the ring does not reach the set's first row (it was trimmed).
 */
export function setRowsOf(h, key) {
  const set = h.sets.get(key);
  if (!set || set.straddles) return null;
  const i0 = h.rows.findIndex((r) => r.seq === set.firstSeq);
  if (i0 < 0) return null;
  const rows = [];
  const after = [];
  let state = set.before;
  let pending = [];
  for (let i = i0; i < h.rows.length; i++) {
    const r = h.rows[i];
    if (r.key === key) {
      // one linear fold per stretch between two set rows (one state copy per set row, never one per ring row)
      if (pending.length > 0) state = foldDim(pending, undefined, state);
      rows.push({ before: state, ops: Array.isArray(own(r.payload, 'ops')) ? r.payload.ops : [], seq: r.seq });
      pending = [{ seq: r.seq, kind: r.kind, payload: r.payload }];
    } else {
      pending.push({ seq: r.seq, kind: r.kind, payload: r.payload });
      after.push({ seq: r.seq, kind: r.kind, payload: r.payload });
    }
  }
  return { set, rows, after };
}

/**
 * The act of an earlier call of this person's undo of `of` (a continuation, `more`): the newest ring row stamped by
 * this person whose honoured marker names `of`. Its act is reused, so one undo is one change-set however many calls.
 */
export function continuationAct(h, cs, principal) {
  const k = setKey(cs);
  for (let i = h.rows.length - 1; i >= 0; i--) {
    const r = h.rows[i];
    if (!Object.hasOwn(r.payload, 'undo')) continue;
    const mark = dimUndoMarkOf(r);
    const act = dimActOf(r);
    if (mark && act && act.principal === principal && setKey(mark.of) === k) return act.act;
  }
  return null;
}

/**
 * A catch-up's op rows split into stretches (S1.4 E1): each stretch starts at a row that opens a change-set this
 * history does not hold yet, so the state at the stretch's start is that set's checkpoint. Only the last UNDO_SETS
 * openings get a stretch of their own (earlier ones would be evicted anyway); their sets are noted as straddling.
 * Returns `{ cuts: Set<index> , straddle: Set<key> }` over `rows`.
 */
export function catchUpCuts(h, rows) {
  const opens = [];
  const seen = new Set(h.sets.keys());
  rows.forEach((row, i) => {
    if (row.kind !== DIM_KINDS.op) return;
    const cs = dimChangeSetOf(row);
    if (!cs) return;
    const k = setKey(cs);
    if (seen.has(k)) return;
    seen.add(k);
    opens.push({ i, k });
  });
  const keep = opens.slice(-UNDO_SETS);
  return { cuts: new Set(keep.map((o) => o.i)), straddle: new Set(opens.slice(0, opens.length - keep.length).map((o) => o.k)) };
}
