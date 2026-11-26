// #dimension-mod (spec §12.7; first-party, mod-abi:v1; id `gnomon.dimension`).
// A dimension is a list of op rows in the kernel log. This mod is the ONLY writer of those rows: it validates
// every op with the published `dim-shape:v1` validator and appends through the host, which stamps who acted.
// Runs under #mod-host from its pinned snapshot and imports nothing outside this folder. The nine commands act
// for a person on the Gnomon window and for nobody else; the two tools (S1.4) act for an attached session's agent,
// identified by the host-written relayedFor alone, and append only op and draw.refused rows. It ships no view.
//
// Rules held here (Aegis S1.3 B2):
//  - identity comes from the host-written `relayedFor` and the host-composed `args.hsid` / `args.repo` only;
//  - tool input is hostile: a closed shape read by own keys; the model's opId reaches no row, only its hash;
//  - args are read against a closed shape, field by field (model.mjs readArgs): never spread, never assigned;
//  - every check, the 512 cap and the row-size check included, runs BEFORE the append;
//  - mod state and the in-memory fold change only AFTER the append returned a seq;
//  - a refusal is a code and a fixed sentence, never input.
import { DIM_AUX_KINDS, DIM_KINDS, DIM_LIMITS, dimAttrDigest, dimChangeSetOf, dimHash, dimMayDraw, dimOpOid, dimRowBy, emptyDimGrants, emptyDimState, foldDim, foldDimGrants, planDimUndo, validateDimOps } from './dim-shape.mjs';
import {
  ATTACH_CAP,
  DIM_CAP,
  KEYFRAME_BUDGET_BYTES,
  KEYFRAME_DIMS,
  KEYFRAME_EVERY_OPS,
  ANSWERS_CAP,
  CALL_BYTES,
  CALL_ROWS,
  COUNT_ROWS_PER_TURN,
  COUNT_ROW_RESERVE,
  MEMO_CAP,
  NEW_KEY_FIX,
  REPEAT_UNKNOWN_FIX,
  ROW_MAX_VISITED,
  TURNS_CAP,
  countPayload,
  changedSince,
  encodeTurns,
  foreignCharge,
  foreignLeft,
  undoForeignCharge,
  canonicalText,
  measure,
  packRows,
  refusedEntry,
  resolveSugar,
  sumOf,
  toolStampOf,
  OPENS_CAP,
  budgetLeft,
  changesOf,
  decodeTurns,
  readToolInput,
  toolActorOf,
  viewAnswer,
  actorOf,
  apply,
  attachPayload,
  decodeKeyframe,
  encodeKeyframe,
  endPayload,
  grantPayload,
  landed,
  opPayload,
  own,
  plain,
  readArgs,
  refusal,
  rowBytes,
  rowProblem,
  stampOf,
  startPayload,
  titleFor,
  UNDO_ENTRIES_MAX,
  catchUpCuts,
  keyframeSets,
  emptyHistory,
  evictSet,
  noteHistoryRow,
  notePresence,
  ofOf,
  setKey,
  setRowsOf,
  unpinSet,
} from './model.mjs';

const ABI = 'mod-abi:v1';
// Echoed at init; the host refuses any other id (a mod-ABI change needs a new build of this mod).
const MOD_ABI_ID = 'sha256:fb9bd26ac5577300dee3d6dc9c3dbe1e5927eca0655e976d7f4f372c273d3f66';
const KINDS = [DIM_KINDS.start, DIM_KINDS.attach, DIM_KINDS.op, DIM_KINDS.end];
// the log pages of a fold also read the grant kind: without it every grant would vanish at a cold open
const PAGE_KINDS = [...KINDS, DIM_AUX_KINDS.grant];
const OID = /^[0-9a-f]{16}$/;
const TOOLS = ['dim-view', 'dim-draw', 'dim-undo'];
const PAGE_ROWS = 1000;
/** pages one cold open may read; the kernel scans at most 10,000 log rows per page */
const MAX_PAGES = 4096;
/** Folds kept in memory; the rest are re-read from a keyframe and the log when next used. */
const LOADED_MAX = 8;

/* ── mod → host requests (each echoes the callId of the call in force) ───── */

let nextId = 1;
const pending = new Map();
const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
function request(method, params, callId) {
  return new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej });
    send({ id, method, params: callId ? { ...params, callId } : params });
  });
}
const hostFor = (callId) => ({
  get: async (key) => plain(await request('state.get', { key }, callId))?.value ?? null,
  set: async (key, value) => void (await request('state.set', { key, value }, callId)),
  kernel: async (verb, params) => plain(await request('kernel.call', { verb, params }, callId))?.result,
});

/* ── what the process remembers ───────────────────────────────────────────── */

/** ulids of every dimension this home holds (state key `dims`), or null before the first command */
let dims = null;
/** [{id, bytes}] of the stored keyframes, most recent last (state key `kfs`) */
let kfs = [];
let logId = null;
/** hsid → the dimension it opened last (state key `opens`, a list of [hsid, dim]): the tools' default `dim` */
let opens = null;
/** hsid → {turn, used, counts}: the per-turn budget (state key `turns`, Aegis M8) */
let turns = null;
/**
 * dim id → { idx: {repo, firstSeq, lastSeq, title, log}, state, grants, oids, sinceKf, dirty } in use order.
 * `grants` is the shared grant fold (a Map; never a plain object keyed by hsid); `oids` maps an op row's `oid` to
 * `{applied, seq}`, the ops the rows carrying it hold and the last of them (A8: an oid seen in the rows never
 * appends again).
 */
const loaded = new Map();

/**
 * `dim.select`: what the page last said is selected, per dimension and hsid. MEMORY ONLY: never a row, a state key
 * or a keyframe, and empty after a restart. `dim-view` answers a session its OWN hsid's selection only (A3).
 */
const selections = new Map();
const SELECTION_DIMS = 64;

/** F2: the hash of a fold, computed once per fold object (a fold is replaced, never mutated, when a row lands). */
const hashes = new WeakMap();
function hashOf(state) {
  let h = hashes.get(state);
  if (h === undefined) {
    h = dimHash(state);
    hashes.set(state, h);
  }
  return h;
}

/** G7: the attribution digest of a fold, computed once per fold object, beside its hash. */
const attrs = new WeakMap();
function attrDigestOf(state) {
  let d = attrs.get(state);
  if (d === undefined) {
    d = dimAttrDigest(state);
    attrs.set(state, d);
  }
  return d;
}

const ulidOf = (dim) => dim.slice(4);
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const REPO = /^repo:[0-9a-f]{16}$/;
const DIM_ID = /^dim:[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

async function boot(host) {
  if (logId === null) {
    // a page that scans nothing: it only names the log the seqs in the index belong to
    const page = plain(await host.kernel('log.read', { until: 0, limit: 1 }));
    const id = page ? own(page, 'logId') : undefined;
    if (typeof id !== 'string' || id.length === 0) throw new Error('no log');
    logId = id;
  }
  if (dims === null) {
    const list = await host.get('dims');
    const k = await host.get('kfs');
    let listed = Array.isArray(list) ? list.filter((x) => typeof x === 'string' && ULID.test(x)).slice(0, DIM_CAP) : [];
    let frames = Array.isArray(k) ? k.map((e) => plain(e)).filter((e) => e && typeof own(e, 'id') === 'string' && ULID.test(own(e, 'id')) && Number.isSafeInteger(own(e, 'bytes'))).map((e) => ({ id: e.id, bytes: e.bytes })) : [];
    // the index was written for ONE log. Under another log (another kernel, or a log a quarantine replaced) its
    // entries name seqs that mean nothing: they are pruned once, so they never count toward the cap again (L2)
    if (listed.length > 0 && (await host.get('log')) !== logId) {
      const keep = [];
      for (const id of listed) {
        const idx = idxOf(await host.get(`idx:${id}`));
        if (idx && idx.log === logId) keep.push(id);
        else {
          await dropKeyframe(host, id);
          if ((await host.get(`idx:${id}`)) !== null) await host.set(`idx:${id}`, null);
        }
      }
      frames = frames.filter((e) => keep.includes(e.id));
      await host.set('dims', keep);
      await host.set('kfs', frames);
      await host.set('log', logId);
      listed = keep;
    }
    dims = listed;
    kfs = frames;
  }
  if (opens === null) {
    const o = await host.get('opens');
    const m = new Map();
    if (Array.isArray(o)) for (const e of o.slice(-OPENS_CAP)) if (Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && e[0].length <= 128 && typeof e[1] === 'string' && DIM_ID.test(e[1])) m.set(e[0], e[1]);
    opens = m;
  }
  if (turns === null) turns = decodeTurns(await host.get('turns'));
}

/** Remember the dimension a session opened last; best effort (the open itself already landed). */
async function noteOpen(host, hsid, dim) {
  const next = new Map(opens);
  next.delete(hsid);
  next.set(hsid, dim);
  while (next.size > OPENS_CAP) next.delete(next.keys().next().value);
  try {
    await host.set('opens', [...next]);
    opens = next;
  } catch {
    /* the tools then need `dim` named */
  }
}

function idxOf(v) {
  const i = plain(v);
  if (!i) return null;
  const repo = own(i, 'repo');
  const firstSeq = own(i, 'firstSeq');
  const lastSeq = own(i, 'lastSeq');
  const title = own(i, 'title');
  const log = own(i, 'log');
  if (typeof repo !== 'string' || !Number.isSafeInteger(firstSeq) || !Number.isSafeInteger(lastSeq) || firstSeq < 1 || lastSeq < firstSeq || typeof title !== 'string' || typeof log !== 'string') return null;
  return { repo, firstSeq, lastSeq, title, log };
}

async function readKeyframe(host, dim) {
  const id = ulidOf(dim);
  try {
    const head = plain(await host.get(`kf:${id}`));
    const n = head ? own(head, 'n') : undefined;
    if (!Number.isSafeInteger(n) || n < 0 || n > 64) return null;
    const chunks = [];
    for (let i = 0; i < n; i++) chunks.push(await host.get(`kf:${id}:${i}`));
    return decodeKeyframe(head, chunks, dim, logId);
  } catch {
    return null;
  }
}

/**
 * Read this dimension's rows after `since` up to the LOG HEAD, folding page by page. Pages ask for the four
 * dimension kinds only, so a page returns at most PAGE_ROWS rows while the kernel scans at most 10,000 log rows
 * for it. Worst case for one cold open: every log row after `since` is scanned once (MAX_PAGES pages, so at most
 * 40,960,000 scanned rows; past that the open is refused `unavailable`), and every dimension row among them is
 * read. Returns the state, and the repo scope and seq of the first start row seen (for an adoption).
 */
async function foldFromLog(host, dim, from, since, cancelled, onOp, keys) {
  let state = from.state;
  let grants = from.grants;
  const oids = new Map(from.oids);
  let at = since;
  // the newest row of this dimension seen, of ANY of its kinds: a grant row is not in the published fold's seq
  let last = Math.max(from.state.seq, since);
  let first = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    // M3: a tool call that ran past its time stops between pages and answers (the host then restarts nothing)
    if (cancelled && cancelled()) throw new Error('cancelled');
    const page = plain(await host.kernel('log.read', { ...(at > 0 ? { since: { logId, seq: at } } : {}), kinds: PAGE_KINDS, limit: PAGE_ROWS }));
    const rows = page && Array.isArray(own(page, 'rows')) ? page.rows : null;
    const next = page ? own(page, 'next') : undefined;
    if (!rows) throw new Error('no page');
    const batch = [];
    const grantRows = [];
    for (const r of rows) {
      const ev = plain(r) && own(r, 'view') === 'full' ? plain(own(r, 'event')) : null;
      if (!ev || typeof own(ev, 'kind') !== 'string' || !Number.isSafeInteger(own(r, 'seq'))) continue;
      const payload = plain(own(ev, 'payload'));
      if (!payload || own(payload, 'dim') !== dim) continue;
      if (r.seq > last) last = r.seq;
      if (first === null && ev.kind === DIM_KINDS.start) {
        const scope = plain(own(ev, 'scope'));
        first = { seq: r.seq, repo: scope ? own(scope, 'repo') : undefined };
      }
      if (ev.kind === DIM_AUX_KINDS.grant) {
        grantRows.push({ seq: r.seq, kind: ev.kind, payload });
        continue;
      }
      if (ev.kind === DIM_KINDS.op) noteOid(oids, payload, r.seq);
      // a cold open notes the change-sets it folded: a set whose rows straddle the open is never undone in part
      if (keys && ev.kind === DIM_KINDS.op) {
        const cs = dimChangeSetOf({ seq: r.seq, kind: ev.kind, payload });
        if (cs) keys.add(setKey(cs));
      }
      batch.push({ seq: r.seq, kind: ev.kind, payload });
    }
    // ONE linear fold per page, continuing the last (never a fold per row: that copies the state per row). A catch-up
    // (`onOp`: rows of a loaded fold the mod did not answer for) folds the page in stretches and notes its op rows
    if (batch.length > 0 && !onOp) state = foldDim(batch, undefined, state);
    else if (batch.length > 0) state = onOp(state, batch);
    if (grantRows.length > 0) grants = foldDimGrants(grantRows, dim, grants);
    if (own(page, 'caughtUp') === true) return { state, grants, oids, first, last };
    if (!Number.isSafeInteger(next) || next <= at) throw new Error('no progress');
    at = next;
  }
  throw new Error('log too long');
}

/**
 * Cold open. The LOG is the truth and the index is a hint (Aegis S1.3 M1): the fold runs from a verified keyframe,
 * or from the dimension's first row, to the log head, so a row that landed while its index write did not is
 * folded and the index is healed. A dimension whose rows are in the log but whose index is missing (or was written
 * for another log) is ADOPTED from its first start row and that row's host-stamped repo scope (L2).
 */
async function load(host, dim, cancelled, admit) {
  const hit = loaded.get(dim);
  if (hit) {
    // a caller the board does not admit moves nothing in the cache, not even the use order (Aegis R-1)
    if (!admit || admit(hit)) {
      loaded.delete(dim);
      loaded.set(dim, hit);
    }
    return hit;
  }
  const id = ulidOf(dim);
  const known = dims.includes(id) ? idxOf(await host.get(`idx:${id}`)) : null;
  const idx = known && known.log === logId ? known : null;
  if (idx) {
    const kf = await readKeyframe(host, dim);
    const usable = kf && kf.state.seq >= idx.firstSeq ? kf : null;
    const from = usable ?? { state: emptyDimState(dim), grants: emptyDimGrants(), oids: new Map() };
    // the sets the keyframe's history held, then the ones the rows after it carry (Aegis I-2)
    const keys = new Set(usable?.sets ?? []);
    const { state, grants, oids, last } = await foldFromLog(host, dim, from, usable ? usable.state.seq : idx.firstSeq - 1, cancelled, undefined, keys);
    // the fold must have reached at least the row the index names: anything less means rows are missing
    if (last < idx.lastSeq || state.dim !== dim) throw new Error('fold short');
    const entry = { idx: { ...idx, lastSeq: last }, state, grants, oids, sinceKf: 0, dirty: last !== idx.lastSeq, hist: emptyHistory(logId, keys) };
    // Aegis I-1 (E1 review): a caller the board does not admit (an unattached tool session) reads it, but it never
    // enters the loaded list, so it can push out no other board and its pins
    if (!admit || admit(entry)) remember(dim, entry);
    return entry;
  }
  // a TOOL never adopts (Aegis R-1): adoption writes the index and drops a keyframe, so only a person's command
  // does it; the tool path (the one that passes `admit`) answers dim-unknown before any log read
  if (admit) return null;
  // no usable index: look for the dimension in the log before anyone may create it again
  const keys = new Set();
  const { state, grants, oids, first, last } = await foldFromLog(host, dim, { state: emptyDimState(dim), grants: emptyDimGrants(), oids: new Map() }, 0, cancelled, undefined, keys);
  if (state.seq === 0 || first === null) return null;
  if (typeof first.repo !== 'string' || !REPO.test(first.repo)) throw new Error('start row without a repo scope');
  if (!dims.includes(id)) {
    if (dims.length >= DIM_CAP) return null;
    const list = [...dims, id];
    await host.set('dims', list);
    await host.set('log', logId);
    dims = list;
  }
  // a keyframe under this id predates the adoption: it is not this fold's
  await dropKeyframe(host, id);
  kfs = kfs.filter((e) => e.id !== id);
  const entry = { idx: { repo: first.repo, firstSeq: first.seq, lastSeq: last, title: state.title, log: logId }, state, grants, oids, sinceKf: 0, dirty: true, hist: emptyHistory(logId, keys) };
  if (!admit || admit(entry)) remember(dim, entry);
  return entry;
}

/** Record an op row's `oid` (only ever a 16-hex value this mod computed; anything else is not read). */
function noteOid(oids, payload, seq) {
  const oid = own(payload, 'oid');
  if (typeof oid !== 'string' || !OID.test(oid)) return;
  const ops = own(payload, 'ops');
  const prev = oids.get(oid);
  oids.delete(oid);
  oids.set(oid, { applied: (prev ? prev.applied : 0) + (Array.isArray(ops) ? ops.length : 0), seq });
  while (oids.size > MEMO_CAP) oids.delete(oids.keys().next().value);
}

/** The effective grant of every attached session, as a LIST (M9: `dim.open` and `dim.grant` answer it). */
const grantList = (entry) => entry.state.attached.map((hsid) => ({ hsid, write: dimMayDraw(entry.state, entry.grants, hsid) }));

/**
 * Fold what the log holds after the entry's last row into it (the log is the truth; today this mod is its only
 * writer, so this normally reads one short page). `cancelled` is checked between pages.
 */
async function catchUp(host, dim, entry, cancelled) {
  const out = await foldFromLog(host, dim, entry, entry.idx.lastSeq, cancelled, (state, batch) => noteCaughtUp(entry, state, batch));
  entry.state = out.state;
  entry.grants = out.grants;
  entry.oids = out.oids;
  if (out.last > entry.idx.lastSeq) {
    entry.idx = { ...entry.idx, lastSeq: out.last };
    entry.dirty = true;
  }
}

function remember(dim, entry) {
  loaded.delete(dim);
  loaded.set(dim, entry);
  // past LOADED_MAX the least recently used board with NO pinned set goes first (Aegis I-1); only when every board
  // holds a pin does the least recently used one go (the mod-wide entries cap still applies)
  while (loaded.size > LOADED_MAX) {
    let out = null;
    for (const [k, e] of loaded) if (k !== dim && !(e.hist && e.hist.pins.length > 0)) {
      out = k;
      break;
    }
    loaded.delete(out ?? loaded.keys().next().value);
  }
}

/**
 * Note an op row that landed in the entry's history (checkpoints and ring, memory only; S1.4 E1, Aegis G6), then
 * hold the whole mod inside UNDO_ENTRIES_MAX checkpoint entries: the oldest unpinned set of any loaded dimension
 * goes first, then the oldest pinned one. `row.payload` carries its stamp.
 */
function noteRow(entry, before, row, after) {
  if (!entry.hist || entry.hist.log !== logId) entry.hist = emptyHistory(logId);
  noteHistoryRow(entry.hist, before, row, Date.now(), after);
  let total = 0;
  for (const e of loaded.values()) if (e.hist) total += e.hist.entries;
  if (!loaded.has(entry.state.dim)) total += entry.hist.entries;
  while (total > UNDO_ENTRIES_MAX) {
    let pick = null;
    for (const pinned of [false, true]) {
      for (const e of new Set([...loaded.values(), entry])) {
        if (!e.hist) continue;
        for (const st of e.hist.sets.values()) if (st.pinned === pinned && (pick === null || st.firstSeq < pick.st.firstSeq)) pick = { e, st };
      }
      if (pick) break;
    }
    if (!pick) break;
    total -= pick.st.before.nodes.size + pick.st.before.gone.size;
    evictSet(pick.e.hist, pick.st.key);
  }
}

/**
 * A catch-up page into a loaded fold (rows the mod did not answer for): folded in stretches that each start at a row
 * opening a new change-set (that stretch's start state is the set's checkpoint), one linear fold per stretch, and
 * every op row noted in the history. Returns the state after the page.
 */
function noteCaughtUp(entry, state, batch) {
  if (!entry.hist || entry.hist.log !== logId) entry.hist = emptyHistory(logId);
  const { cuts, straddle } = catchUpCuts(entry.hist, batch);
  for (const k of straddle) entry.hist.before.add(k);
  let start = 0;
  const stretch = (end) => {
    if (end <= start) return;
    const part = batch.slice(start, end);
    const before = state;
    state = foldDim(part, undefined, state);
    for (const row of part) if (row.kind === DIM_KINDS.op) noteRow(entry, before, { seq: row.seq, payload: row.payload }, state);
    start = end;
  };
  for (let i = 0; i < batch.length; i++) if (cuts.has(i)) stretch(i);
  stretch(batch.length);
  return state;
}

/** Write the index entry; a failure is remembered and retried on the next command (the fold in memory is right). */
async function saveIdx(host, dim, entry) {
  try {
    await host.set(`idx:${ulidOf(dim)}`, entry.idx);
    entry.dirty = false;
  } catch {
    entry.dirty = true;
  }
}

async function dropKeyframe(host, id) {
  const head = plain(await host.get(`kf:${id}`));
  if (head === null && (await host.get(`kf:${id}:0`)) === null) return;
  const n = head && Number.isSafeInteger(own(head, 'n')) ? Math.min(Math.max(head.n, 1), 64) : 64;
  // the head first: chunks without a head are never read
  await host.set(`kf:${id}`, null);
  for (let i = 0; i < n; i++) await host.set(`kf:${id}:${i}`, null);
}

/** Best effort: a keyframe only shortens a cold open, so no failure here ever fails a command. */
async function saveKeyframe(host, dim, entry) {
  const id = ulidOf(dim);
  try {
    const enc = encodeKeyframe(entry.state, logId, { grants: entry.grants, oids: entry.oids, sets: keyframeSets(entry.hist) });
    entry.sinceKf = 0;
    if (!enc) return;
    const old = plain(await host.get(`kf:${id}`));
    const oldN = old && Number.isSafeInteger(own(old, 'n')) ? old.n : 0;
    // make room first: only the most recent dimensions keep a keyframe, inside one byte budget
    let keep = kfs.filter((e) => e.id !== id);
    while (keep.length > 0 && (keep.length >= KEYFRAME_DIMS || keep.reduce((a, e) => a + e.bytes, enc.head.bytes) > KEYFRAME_BUDGET_BYTES)) {
      const gone = keep[0];
      keep = keep.slice(1);
      await dropKeyframe(host, gone.id);
    }
    // chunks, then the head that sums them: a write cut short leaves a head that does not verify
    for (let i = 0; i < enc.chunks.length; i++) await host.set(`kf:${id}:${i}`, enc.chunks[i]);
    await host.set(`kf:${id}`, enc.head);
    for (let i = enc.chunks.length; i < Math.min(oldN, 64); i++) await host.set(`kf:${id}:${i}`, null);
    kfs = [...keep, { id, bytes: enc.head.bytes }];
    await host.set('kfs', kfs);
  } catch {
    /* the next close or the next 256 ops try again */
  }
}

/** The host's budget refusal (A4): a DEFINITE "not written", decided before the log was touched. */
const BUSY = Object.freeze({ busy: true });
function isBudgetRefusal(e) {
  const d = e && plain(e.data);
  const inner = d ? plain(own(d, 'data')) : null;
  return !!inner && own(inner, 'modCode') === 'APPEND_BUDGET' && own(inner, 'written') === false;
}

/**
 * Append one row. Resolves the seq; BUSY when the host refused it for its append budget (nothing was written, so
 * the fold stays right); or null for any other failure, after which the mod cannot tell whether the row landed.
 */
async function append(host, kind, payload) {
  try {
    const out = plain(await host.kernel('log.append', { kind, payload }));
    const seq = out ? own(out, 'seq') : undefined;
    return Number.isSafeInteger(seq) && seq > 0 ? seq : null;
  } catch (e) {
    return isBudgetRefusal(e) ? BUSY : null;
  }
}

/* ── the four commands ────────────────────────────────────────────────────── */

async function runCommand(commandId, rawArgs, relayedFor, callId) {
  // 1. who: a person on the Gnomon window, from the host's stamp alone. Nobody else gets past this line.
  const actor = actorOf(relayedFor);
  if (!actor) return refusal('not-human-gui');
  // 2. what: the closed shape of this command's args
  const read = readArgs(commandId, rawArgs);
  if (!read.args) return refusal(read.code);
  const a = read.args;
  const stamp = stampOf(relayedFor);
  const host = hostFor(callId);
  let entry;
  try {
    await boot(host);
    entry = await load(host, a.dim);
  } catch {
    return refusal('unavailable');
  }
  // a read-only command (dim.select, dim.check) cannot set state: the index heals on the next writing command
  if (entry && entry.dirty && commandId !== 'dim.select' && commandId !== 'dim.check' && commandId !== 'dim.seen') await saveIdx(host, a.dim, entry);

  if (commandId === 'dim.open' && !entry) {
    // a new dimension: this session's repo owns it, and this session is its first attached one
    const t = titleFor(a.title, a.fromSession);
    if (t.problem) return refusal(t.problem);
    if (dims.length >= DIM_CAP) return refusal('dim-cap');
    const payload = startPayload(a.dim, a.hsid, a.opened, t.title);
    if (rowProblem(payload, stamp)) return refusal('row-too-large');
    const seq = await append(host, DIM_KINDS.start, payload);
    if (seq === BUSY) return refusal('append-busy');
    if (seq === null) return refusal('append-failed');
    const fresh = { idx: { repo: a.repo, firstSeq: seq, lastSeq: seq, title: t.title, log: logId }, state: landed(emptyDimState(a.dim), DIM_KINDS.start, payload, stamp, seq), grants: emptyDimGrants(), oids: new Map(), sinceKf: 0, dirty: false, hist: emptyHistory(logId) };
    try {
      // a keyframe left under this id is another dimension's fold (L1)
      await dropKeyframe(host, ulidOf(a.dim));
      kfs = kfs.filter((e) => e.id !== ulidOf(a.dim));
      await host.set(`idx:${ulidOf(a.dim)}`, fresh.idx);
      if (!dims.includes(ulidOf(a.dim))) {
        const list = [...dims, ulidOf(a.dim)];
        await host.set('dims', list);
        await host.set('log', logId);
        dims = list;
      }
      remember(a.dim, fresh);
      await noteOpen(host, a.hsid, a.dim);
    } catch {
      // the row is in the log but the index could not take it: the next command adopts the dimension from the log
      return refusal('unavailable');
    }
    return { ok: true, created: true, dim: a.dim, title: t.title, firstSeq: seq, seq, hash: hashOf(fresh.state), attr: attrDigestOf(fresh.state), grants: grantList(fresh) };
  }

  // every other path needs a known dimension of the caller's repo
  if (!entry) return refusal('dim-unknown');
  if (entry.idx.repo !== a.repo) return refusal('repo-mismatch');
  // a person's command for this board: they have it open (agent-on-agent sets are pinned while they do, G6)
  if (entry.hist) notePresence(entry.hist, Date.now());
  const state = entry.state;
  const attached = state.attached.includes(a.hsid);

  /** Append, then (and only then) move the fold and the index. */
  const write = async (kind, payload) => {
    if (rowProblem(payload, stamp)) return refusal('row-too-large');
    const seq = await append(host, kind, payload);
    // a budget refusal wrote nothing: the fold is still the log's, so it is kept (A4)
    if (seq === BUSY) return refusal('append-busy');
    if (seq === null) {
      // the mod cannot tell "not written" from "written, reply lost": forget the fold, so the next command reads the log
      loaded.delete(a.dim);
      return refusal('append-failed');
    }
    // a grant row is outside the published fold: it moves the grant fold, through the same shared function
    if (kind === DIM_AUX_KINDS.grant) entry.grants = foldDimGrants([{ seq, kind, payload: { ...payload, relayedFor: stamp } }], a.dim, entry.grants);
    else {
      const before = entry.state;
      entry.state = landed(entry.state, kind, payload, stamp, seq);
      if (kind === DIM_KINDS.op) noteRow(entry, before, { seq, payload: { ...payload, relayedFor: stamp } });
    }
    entry.idx = { ...entry.idx, lastSeq: seq };
    await saveIdx(host, a.dim, entry);
    return seq;
  };

  if (commandId === 'dim.attach') {
    // idempotent: a session already attached appends nothing
    // an attached session's tools default to this board too: attaching is how the person opens it for that session
    if (attached) {
      await noteOpen(host, a.hsid, a.dim);
      return { ok: true, already: true, dim: a.dim, seq: state.seq };
    }
    if (state.attached.length >= ATTACH_CAP) return refusal('attach-cap');
    const seq = await write(DIM_KINDS.attach, attachPayload(a.dim, a.hsid));
    if (typeof seq === 'number') await noteOpen(host, a.hsid, a.dim);
    return typeof seq === 'number' ? { ok: true, already: false, dim: a.dim, seq } : seq;
  }

  if (!attached) return refusal('not-attached');

  if (commandId === 'dim.open') {
    // a reopen: no title (the first start row named the dimension), and any title sent is not read
    const seq = await write(DIM_KINDS.start, startPayload(a.dim, a.hsid, a.opened));
    if (typeof seq === 'number') await noteOpen(host, a.hsid, a.dim);
    return typeof seq === 'number' ? { ok: true, created: false, dim: a.dim, title: entry.state.title, firstSeq: entry.idx.firstSeq, seq, hash: hashOf(entry.state), attr: attrDigestOf(entry.state), grants: grantList(entry) } : seq;
  }

  if (commandId === 'dim.grant') {
    // M10: a person on the window sets it for an ATTACHED session (the focus the host joined; checked above). The
    // grant row is the only writer of the standing; the answer is the effective map the mod now enforces (M9).
    if (state.ended) return refusal('dim-ended');
    const seq = await write(DIM_AUX_KINDS.grant, grantPayload(a.dim, a.hsid, a.write));
    if (typeof seq !== 'number') return seq;
    // the keyframe carries the grant map: written now, so a cold open after a revoke never starts from before it
    await saveKeyframe(host, a.dim, entry);
    return { ok: true, dim: a.dim, seq, grants: grantList(entry) };
  }

  if (commandId === 'dim.close') {
    if (state.ended) return { ok: true, already: true, dim: a.dim, seq: state.seq, ops: state.ops, nodes: state.nodes.size, hash: hashOf(state) };
    const payload = endPayload(state);
    const seq = await write(DIM_KINDS.end, payload);
    if (typeof seq !== 'number') return seq;
    await saveKeyframe(host, a.dim, entry);
    return { ok: true, already: false, dim: a.dim, seq, ops: payload.ops, nodes: payload.nodes, hash: hashOf(entry.state) };
  }

  if (commandId === 'dim.select') {
    let byHsid = selections.get(a.dim);
    if (!byHsid) {
      while (selections.size >= SELECTION_DIMS) selections.delete(selections.keys().next().value);
      byHsid = new Map();
      selections.set(a.dim, byHsid);
    }
    byHsid.set(a.hsid, a.ids);
    return { ok: true, dim: a.dim, selected: a.ids.length };
  }

  if (commandId === 'dim.check') {
    // the hash point after an agent's turn (Aegis C2.6): an agent's rows reach the page through the log, so the
    // page's own dim.op answers never vouch for them. Read to the log head, then answer the fold there. No write.
    try {
      await catchUp(host, a.dim, entry);
    } catch {
      loaded.delete(a.dim);
      return refusal('unavailable');
    }
    // G7: the attribution digest beside the hash; the page compares both at this hash point
    return { ok: true, dim: a.dim, seq: entry.state.seq, hash: hashOf(entry.state), attr: attrDigestOf(entry.state) };
  }

  if (commandId === 'dim.seen') {
    // Aegis S1 to S3: a person on the window (actorOf above: human, gui, no agent; never a tool, never a loop
    // session) dismisses ONE standing notice. `of` must name a set this mod holds pinned for this board; anything
    // else is a no-op refusal. Nothing is written: the pin is memory only.
    if (!entry.hist || !unpinSet(entry.hist, setKey(a.of))) return refusal('not-pinned');
    return { ok: true, dim: a.dim, released: true };
  }

  if (commandId === 'dim.undo') {
    if (state.ended) return refusal('dim-ended');
    // a turn is named by its session, which must be attached here (it need not be live)
    if (a.of.kind === 'turn' && !state.attached.includes(a.of.hsid)) return refusal('undo-set-bad');
    try {
      await catchUp(host, a.dim, entry);
    } catch {
      loaded.delete(a.dim);
      return refusal('unavailable');
    }
    if (a.base !== undefined && a.base > entry.state.seq) return refusal('args-bad');
    // the person's own act: a continuation of their earlier call of this undo keeps its act, else a fresh one
    // (minted here, never the page's: Aegis ruling 3), so one undo is one change-set of the person in its own right
    // Judge I-2, Aegis I-5: the act is reused ONLY for the continuation of this person's own call that answered
    // `more` for this set and this scope; every other undo is an action of its own
    const pk = setKey(a.of);
    const pend = entry.hist?.pending.get(pk);
    const scope = JSON.stringify(a.ids ?? null);
    const act = pend && pend.principal === actor.principal && pend.ids === scope ? pend.act : mintUlid();
    const out = await undoCore(host, a.dim, entry, {
      cs: a.of,
      ...(a.ids ? { ids: a.ids } : {}),
      actor,
      undoer: { cls: 'human', principal: actor.principal },
      stamp,
      act,
      appendRow: (payload) => append(host, DIM_KINDS.op, payload),
    });
    if (out.code) {
      if (out.code !== 'append-busy') entry.hist?.pending.delete(pk);
      return refusal(out.code, out.extra);
    }
    if (out.more) entry.hist.pending.set(pk, { act, principal: actor.principal, ids: scope });
    else entry.hist.pending.delete(pk);
    // the person pressed this set's notice: its pin is released (Aegis G6), but only by an undo of the WHOLE set
    // that finished (Aegis I-3, Judge nit): a per-mark undo (`ids`) or an answer with `more` keeps it standing.
    // A whole-set undo with no `more` releases it even when some marks were skipped (changed since, gone,
    // refused): the answer's `skipped` says which (Aegis N-b)
    if (!a.ids && !out.more) unpinSet(entry.hist, setKey(a.of));
    await saveIdx(host, a.dim, entry);
    if (entry.sinceKf >= KEYFRAME_EVERY_OPS) await saveKeyframe(host, a.dim, entry);
    return { ok: true, dim: a.dim, seq: entry.state.seq, hash: hashOf(entry.state), attr: attrDigestOf(entry.state), applied: out.applied, skipped: out.skipped, ...(out.more ? { more: true } : {}) };
  }

  if (commandId !== 'dim.op') return refusal('command-unknown');
  if (state.ended) return refusal('dim-ended');
  const v = apply(state, a.ops, actor, { stamp });
  // ops that could never fit one row are refused before the validator reads them
  if (v.tooLarge) return refusal('row-too-large');
  // a secret anywhere, or nothing accepted: no row at all
  if (v.secret) return refusal('secret', { refused: v.refused });
  if (v.ok.length === 0) return refusal('ops-refused', { refused: v.refused });
  // the row is built from the validator's own copies only; `act` is the pattern-checked arg (readArgs), never input as is
  const seq = await write(DIM_KINDS.op, opPayload(a.dim, v.ok, undefined, a.act !== undefined ? { act: a.act } : undefined));
  if (typeof seq !== 'number') return seq;
  entry.sinceKf += v.ok.length;
  if (entry.sinceKf >= KEYFRAME_EVERY_OPS) await saveKeyframe(host, a.dim, entry);
  // the hash of the fold at this seq: the page compares its own fold there (S1.4 §5)
  return { ok: true, dim: a.dim, seq, hash: hashOf(entry.state), attr: attrDigestOf(entry.state), applied: v.ok.length, refused: v.refused };
}

/* ── the three agent tools (S1.4 §2; dim-undo from E2) ────────────────────────────────────────── */

/**
 * `dim-view` and `dim-draw`. Identity is the host-written `relayedFor` alone; input is hostile (closed shape, own
 * keys, never spread). Order: actor, input, dimension (named, or the one this hsid opened last), attached; then
 * the tool's own checks. `cancelled` is the host's cancel for this call (M3), checked between log pages and rows.
 */
async function runTool(name, rawInput, relayedFor, callId, cancelled) {
  const who = toolActorOf(relayedFor);
  if (!who.actor) return refusal(who.code);
  const actor = who.actor;
  const read = readToolInput(name, rawInput);
  if (!read.args) return refusal(read.code);
  const a = read.args;
  const host = hostFor(callId);
  try {
    await boot(host);
  } catch {
    return refusal('unavailable');
  }
  const dim = a.dim ?? opens.get(actor.hsid);
  if (!dim) return refusal('no-open-dim');
  // I-1: a tool never adopts. A dimension this home does not index is refused BEFORE any log read: otherwise an
  // agent naming made-up ids would make every call fold the whole log (up to MAX_PAGES pages, uncached)
  if (!dims.includes(ulidOf(dim))) return refusal('dim-unknown');
  let entry;
  try {
    // attach is checked BEFORE the board enters the loaded list (Aegis I-1)
    entry = await load(host, dim, cancelled, (e) => e.state.attached.includes(actor.hsid));
  } catch {
    return refusal(cancelled() ? 'cancelled' : 'unavailable');
  }
  if (!entry) return refusal('dim-unknown');
  // dim-view is read-only (no state.set): only a draw heals the index
  if (entry.dirty && name !== 'dim-view') await saveIdx(host, dim, entry);
  // attach is the only door (C6): no grant is needed to view, but an unattached session sees nothing
  if (!entry.state.attached.includes(actor.hsid)) return refusal('not-attached');
  if (name === 'dim-view') return viewTool(host, dim, entry, actor, a, cancelled);
  if (name === 'dim-undo') return undoTool(host, dim, entry, actor, a, toolStampOf(relayedFor), cancelled);
  return drawTool(host, dim, entry, actor, a, toolStampOf(relayedFor), cancelled);
}

/**
 * Aegis ruling 5 (named from the agent's own view): the change-sets a `dim-view` changes answer listed to each hsid,
 * the newest SHOWN_SETS per hsid, per dimension. MEMORY ONLY. E2's `dim-undo` reads it (`shownTo`).
 */
const SHOWN_SETS = 32;
const shown = new Map();
function noteShown(dim, hsid, entries) {
  let byHsid = shown.get(dim);
  if (!byHsid) {
    while (shown.size >= SELECTION_DIMS) shown.delete(shown.keys().next().value);
    shown.set(dim, (byHsid = new Map()));
  }
  let list = byHsid.get(hsid) ?? [];
  for (const e of entries) {
    if (!e.set) continue;
    const k = setKey(readOfKnown(e.set));
    list = [...list.filter((x) => x !== k), k];
  }
  byHsid.delete(hsid);
  byHsid.set(hsid, list.slice(-SHOWN_SETS));
  while (byHsid.size > OPENS_CAP) byHsid.delete(byHsid.keys().next().value);
}
/** Was this change-set listed to this hsid on this board (one of its last SHOWN_SETS)? */
function shownTo(dim, hsid, cs) {
  return !!shown.get(dim)?.get(hsid)?.includes(setKey(cs));
}
const readOfKnown = (of) => (Object.hasOwn(of, 'act') ? { kind: 'act', principal: of.principal, act: of.act } : { kind: 'turn', hsid: of.hsid, turn: of.turn });

/** dim → oid → {input, answer}: the last ANSWERS_CAP draws with an opId, in memory (A8) */
const answers = new Map();
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A fresh ULID for a node the agent left unnamed (time, then 80 random bits). */
function mintUlid() {
  let t = Date.now();
  let head = '';
  for (let i = 0; i < 10; i++) {
    head = B32[t % 32] + head;
    t = Math.floor(t / 32);
  }
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let tail = '';
  for (let i = 0; i < 16; i++) tail += B32[rnd[i] % 32];
  return head + tail;
}

/**
 * M4: the ONLY append a tool call can reach. A tool writes op rows and its count row, nothing else: never a start,
 * attach, end or grant row, whatever the host's effect gate would allow.
 */
const TOOL_KINDS = Object.freeze([DIM_KINDS.op, DIM_AUX_KINDS.drawRefused]);
async function appendTool(host, kind, payload) {
  if (!TOOL_KINDS.includes(kind)) return null;
  return append(host, kind, payload);
}

/**
 * Charge the turn budget (M8) and, from S1.4 E1, the foreign sub-budgets `f` (Aegis ruling 1): the state write
 * comes BEFORE the first row; only rows the host definitely did not write are refunded (I-2).
 */
async function charge(host, actor, n, counts, f) {
  const t = turns.get(actor.hsid);
  const same = t && t.turn === actor.turn;
  const next = new Map(turns);
  next.delete(actor.hsid);
  const was = (k) => (same ? (t[k] ?? 0) : 0);
  next.set(actor.hsid, { turn: actor.turn, used: was('used') + n, counts: was('counts') + counts, foreign: was('foreign') + (f?.touch ?? 0), fdel: was('fdel') + (f?.del ?? 0), fwords: was('fwords') + (f?.words ?? 0) });
  // the least recently charged session goes first (stated residual: a 257th session drawing resets the oldest)
  while (next.size > TURNS_CAP) next.delete(next.keys().next().value);
  await host.set('turns', encodeTurns(next));
  turns = next;
}

async function drawTool(host, dim, entry, actor, a, stamp, cancelled) {
  // order (S1.4 §2, A8): actor, input, dimension, attached (runTool); ended; grant; THEN the op-id memo
  if (entry.state.ended) return refusal('dim-ended');
  if (!dimMayDraw(entry.state, entry.grants, actor.hsid)) return refusal('write-not-granted');
  const oid = a.opId !== undefined ? dimOpOid(actor.hsid, dim, a.opId) : undefined;
  if (oid === null) return refusal('op-id-bad');
  // size before anything reads the ops (the memo's input hash included): the whole call within the per-call bytes
  // and 4 rows of values
  if (measure(a.ops, CALL_BYTES, ROW_MAX_VISITED * CALL_ROWS) === null) return refusal('call-too-large', { budgetLeft: budgetLeft(turns, actor) });
  let input = null;
  if (oid !== undefined) {
    try {
      // canonical (sorted keys): the same ops in another key order are the same draw, never op-id-reused
      input = sumOf(canonicalText(a.ops));
    } catch {
      return refusal('args-bad');
    }
    const memo = answers.get(dim)?.get(oid);
    if (memo) return memo.input === input ? { ...memo.answer, budgetLeft: budgetLeft(turns, actor), repeat: true } : refusal('op-id-reused');
    // an oid found in the rows never appends again (after a restart the input is unknown: a repeat, A8)
    const seen = entry.oids.get(oid);
    if (seen) return { ok: true, dim, seq: entry.state.seq, hash: hashOf(entry.state), applied: seen.applied, created: [], refused: [], budgetLeft: budgetLeft(turns, actor), repeat: true, inputUnknown: true, fix: REPEAT_UNKNOWN_FIX };
  }
  const left = budgetLeft(turns, actor);
  if (left === 0) return refusal('turn-budget', { budgetLeft: 0 });
  // F4, Aegis ruling 6: `base` is the seq of the caller's view; a base past the board's head is no view of it
  if (a.base !== undefined && a.base > entry.state.seq) return refusal('args-bad');
  if (a.ops.length > DIM_LIMITS.opsPerRow) return finishRefused(host, dim, entry, actor, [refusedEntry(-1, 'ops', 'too-many-ops')], 'ops-refused');
  const sugar = resolveSugar(entry.state, a.ops, mintUlid);
  // changed-since (per op, before validation): those ops are left out of the batch; the rest is validated as one
  const kept = [];
  const stale = [];
  for (let i = 0; i < sugar.ops.length; i++) (a.base !== undefined && changedSince(entry.state, sugar.ops[i], a.base) ? stale : kept).push(i);
  // ONE validation of the whole batch (C5): a secret anywhere refuses everything before the first append
  const v = validateDimOps(entry.state, kept.map((i) => sugar.ops[i]), { cls: 'agent', principal: actor.principal, agent: actor.agent });
  const at = (r) => (r.index >= 0 && r.index < kept.length ? kept[r.index] : -1);
  // the validator's own fix is kept: a contrast refusal's sentence names its offered swatch (Aegis P0b F1)
  const refused = v.refused.map((r) => refusedEntry(at(r), r.field, r.code, sugar.unresolved.get(at(r))?.has(r.field) ? NEW_KEY_FIX : r.fix));
  // the field a stale op is refused on: a move names its marks in `ids`, an update or delete in `id`
  for (const i of stale) refused.push(refusedEntry(i, own(plain(sugar.ops[i]) ?? {}, 'type') === 'move' ? 'ids' : 'id', 'changed-since'));
  if (v.secret) return finishRefused(host, dim, entry, actor, refused, 'secret');
  const bad = new Set(v.refused.map((r) => r.index));
  const okIdx = [];
  for (let i = 0; i < kept.length && !bad.has(-1); i++) if (!bad.has(i)) okIdx.push(kept[i]);
  if (okIdx.length !== v.ok.length) return finishRefused(host, dim, entry, actor, refused, 'ops-refused');
  // the budgets: the turn's 64 ops, and per id the foreign touches, deletes and words (Aegis ruling 1). The first
  // accepted ops that fit all four; from the first that does not, it and every later op are refused
  const fl = foreignLeft(turns, actor);
  const hand = { cls: 'agent', principal: actor.principal, agent: actor.agent };
  const fc = v.ok.map((op) => foreignCharge(entry.state, op, hand));
  let take = 0;
  const sum = { touch: 0, del: 0, words: 0 };
  let over = null;
  for (; take < okIdx.length; take++) {
    const c = fc[take];
    if (take >= left) over = 'turn-budget';
    else if (sum.touch + c.touch > fl.touch || sum.del + c.del > fl.del || sum.words + c.words > fl.words) over = 'foreign-budget';
    if (over) break;
    sum.touch += c.touch;
    sum.del += c.del;
    sum.words += c.words;
  }
  for (const i of okIdx.slice(take)) refused.push(refusedEntry(i, 'op', over));
  const packed = packRows(dim, v.ok.slice(0, take), oid, stamp, CALL_BYTES - COUNT_ROW_RESERVE);
  for (const j of okIdx.slice(packed.cut, take)) refused.push(refusedEntry(j, 'op', 'call-too-large'));
  const planned = packed.cut;
  if (planned === 0) return finishRefused(host, dim, entry, actor, refused, refused.length > 0 && refused.every((r) => r.code === 'changed-since') ? 'changed-since' : 'ops-refused');
  const chargeOf = (from, to) => fc.slice(from, to).reduce((x, c) => ({ touch: x.touch + c.touch, del: x.del + c.del, words: x.words + c.words }), { touch: 0, del: 0, words: 0 });
  try {
    // charged BEFORE the append (M8): the ops and, per id, the foreign sub-budgets
    await charge(host, actor, planned, 0, chargeOf(0, planned));
  } catch {
    return refusal('unavailable');
  }
  const created = [];
  let applied = 0;
  let stop = null;
  // I-2: ops of rows the host DEFINITELY did not write (a budget refusal, or rows never tried after a definite
  // stop) go back to the turn's budget; an unknown or failed append is never refunded (M8)
  let refund = 0;
  const refundF = { touch: 0, del: 0, words: 0 };
  for (let r = 0; r < packed.rows.length; r++) {
    const pos = packed.rows[r];
    if (stop === null && cancelled()) stop = 'cancelled';
    if (stop === null && r > 0) {
      // revocation takes effect at the next row (M9): read what the log holds since the last row, then ask again
      try {
        await catchUp(host, dim, entry, cancelled);
      } catch {
        stop = cancelled() ? 'cancelled' : 'unavailable';
      }
      if (stop === null && (entry.state.ended || !dimMayDraw(entry.state, entry.grants, actor.hsid))) stop = 'write-not-granted';
    }
    let seq = null;
    let unknown = false;
    if (stop === null) {
      const payload = opPayload(dim, pos.map((j) => v.ok[j]), oid);
      seq = await appendTool(host, DIM_KINDS.op, payload);
      if (seq === BUSY) stop = 'append-busy';
      else if (seq === null) {
        stop = 'append-failed';
        unknown = true; // this row may have landed: never refunded
        loaded.delete(dim);
      } else {
        const before = entry.state;
        entry.state = landed(entry.state, DIM_KINDS.op, payload, stamp, seq);
        noteRow(entry, before, { seq, payload: { ...payload, relayedFor: stamp } });
        entry.idx = { ...entry.idx, lastSeq: seq };
        if (oid !== undefined) noteOid(entry.oids, payload, seq);
        entry.sinceKf += pos.length;
        applied += pos.length;
        for (const j of pos) {
          const c = sugar.created.get(okIdx[j]);
          if (c) created.push({ index: okIdx[j], ...c });
        }
      }
    }
    if (stop !== null) {
      for (const j of pos) refused.push(refusedEntry(okIdx[j], 'op', stop));
      if (!unknown) {
        refund += pos.length;
        for (const j of pos) (refundF.touch += fc[j].touch), (refundF.del += fc[j].del), (refundF.words += fc[j].words);
      }
    }
  }
  if (refund > 0) {
    try {
      await charge(host, actor, -refund, 0, { touch: -refundF.touch, del: -refundF.del, words: -refundF.words });
    } catch {
      /* the overcount stands (M8: never an undercount) */
    }
  }
  refused.sort((x, y) => x.index - y.index);
  if (applied > 0) {
    await saveIdx(host, dim, entry);
    // a cancelled call answers now: the keyframe waits for the next draw or close
    if (entry.sinceKf >= KEYFRAME_EVERY_OPS && stop !== 'cancelled') await saveKeyframe(host, dim, entry);
  }
  await countRow(host, dim, entry, actor, refused);
  if (applied === 0) return refusal(stop ?? 'ops-refused', { dim, refused, budgetLeft: budgetLeft(turns, actor) });
  const answer = { ok: true, dim, seq: entry.state.seq, hash: hashOf(entry.state), applied, created, refused, budgetLeft: budgetLeft(turns, actor) };
  if (oid !== undefined) memoAnswer(dim, oid, input, answer);
  return answer;
}

/**
 * Aegis E2 (one person set per turn): hsid → {turn, key}, the person's change-set (an `act` set) this session's
 * agent undid in its current turn. MEMORY ONLY: a restart forgets it, and with it every history (`undo-expired`).
 */
const personUndos = new Map();

/** The op-id memo's answer store, shared by dim-draw and dim-undo (A8; S1.4 §3.5). */
function memoAnswer(dim, oid, input, answer) {
  let m = answers.get(dim);
  if (!m) {
    while (answers.size >= 64) answers.delete(answers.keys().next().value);
    m = new Map();
    answers.set(dim, m);
  }
  m.set(oid, { input, answer });
  while (m.size > ANSWERS_CAP) m.delete(m.keys().next().value);
}

/**
 * `dim-undo` (S1.4 E2; Arky §3.3; Aegis rulings 5 and E2, the founder's ruling of 2026-11-26: undo is symmetric, so
 * an agent may undo its own turn, another agent's and a person's action). Order: actor, input, dimension, attached
 * (runTool); ended; GRANT; THEN the op-id memo (the same memo as dim-draw); then the set checks (named from this
 * hsid's own view, Aegis ruling 5; one person set per turn); THEN the budget. The undoer is the calling agent, never
 * "as a human". Every op the undo writes is charged to the turn and, per id against each mark's original hand, to
 * the foreign sub-budgets INSIDE `fit`, before the first append (M8); ops past a budget are not sent and answer
 * `more`. Only ops definitely not written are refunded. The grant is asked again before each later row (M9).
 */
async function undoTool(host, dim, entry, actor, a, stamp, cancelled) {
  if (entry.state.ended) return refusal('dim-ended');
  if (!dimMayDraw(entry.state, entry.grants, actor.hsid)) return refusal('write-not-granted');
  const oid = a.opId !== undefined ? dimOpOid(actor.hsid, dim, a.opId) : undefined;
  if (oid === null) return refusal('op-id-bad');
  let input = null;
  if (oid !== undefined) {
    // an object, never an array: no draw's ops (always an array) can share this input hash
    input = sumOf(canonicalText({ undo: { of: ofOf(a.of), ids: a.ids ?? null } }));
    const memo = answers.get(dim)?.get(oid);
    if (memo) return memo.input === input ? { ...memo.answer, budgetLeft: budgetLeft(turns, actor), repeat: true } : refusal('op-id-reused');
    const seen = entry.oids.get(oid);
    if (seen) return { ok: true, dim, seq: entry.state.seq, hash: hashOf(entry.state), applied: seen.applied, budgetLeft: budgetLeft(turns, actor), repeat: true, inputUnknown: true, fix: REPEAT_UNKNOWN_FIX };
  }
  // Aegis ruling 5: only a set a dim-view changes answer listed to THIS hsid on this board (stops blind or
  // remembered ids; not proof against a planted id the agent was also shown)
  if (!shownTo(dim, actor.hsid, a.of)) return refusal('undo-set-bad');
  if (a.of.kind === 'turn' && !entry.state.attached.includes(a.of.hsid)) return refusal('undo-set-bad');
  // Aegis E2: at most one person's change-set per agent turn (a further call for the SAME set, after `more`, is fine)
  const key = setKey(a.of);
  const pu = personUndos.get(actor.hsid);
  if (a.of.kind === 'act' && pu && pu.turn === actor.turn && pu.key !== key) return refusal('undo-not-allowed', { budgetLeft: budgetLeft(turns, actor) });
  const left = budgetLeft(turns, actor);
  if (left === 0) return refusal('turn-budget', { budgetLeft: 0 });
  try {
    await catchUp(host, dim, entry, cancelled);
  } catch {
    loaded.delete(dim);
    return refusal(cancelled() ? 'cancelled' : 'unavailable');
  }
  if (entry.state.ended) return refusal('dim-ended');
  if (!dimMayDraw(entry.state, entry.grants, actor.hsid)) return refusal('write-not-granted');
  const hand = { cls: 'agent', principal: actor.principal, agent: actor.agent };
  let fc = [];
  let charged = 0;
  const o = {
    cs: a.of,
    ...(a.ids ? { ids: a.ids } : {}),
    actor: hand,
    undoer: hand,
    stamp,
    act: undefined,
    appendRow: (payload) => appendTool(host, DIM_KINDS.op, payload),
    // M8: the plan's ops are charged here, after planning and BEFORE the first append; the first ops that fit the
    // turn's ops and the foreign touches, deletes and words go, from the first that does not none goes
    fit: async (planOps, restored) => {
      const fl = foreignLeft(turns, actor);
      fc = planOps.map((op) => undoForeignCharge(entry.state, op, hand, restored));
      const sum = { touch: 0, del: 0, words: 0 };
      let take = 0;
      let over = null;
      for (; take < planOps.length; take++) {
        const c = fc[take];
        if (take >= left) over = 'turn-budget';
        else if (sum.touch + c.touch > fl.touch || sum.del + c.del > fl.del || sum.words + c.words > fl.words) over = 'foreign-budget';
        if (over) break;
        sum.touch += c.touch;
        sum.del += c.del;
        sum.words += c.words;
      }
      if (take === 0) {
        o.fitCode = over ?? 'undo-nothing';
        return 0;
      }
      try {
        await charge(host, actor, take, 0, sum);
      } catch {
        o.fitCode = 'unavailable';
        return 0;
      }
      charged = take;
      if (a.of.kind === 'act') personUndos.set(actor.hsid, { turn: actor.turn, key });
      while (personUndos.size > TURNS_CAP) personUndos.delete(personUndos.keys().next().value);
      return take;
    },
    // M9: revocation (or a close) takes effect at the next row; a cancel stops there too
    between: async () => {
      if (cancelled()) return true;
      try {
        await catchUp(host, dim, entry, cancelled);
      } catch {
        return true;
      }
      return entry.state.ended || !dimMayDraw(entry.state, entry.grants, actor.hsid);
    },
  };
  const out = await undoCore(host, dim, entry, o);
  // I-2: refund what was charged and DEFINITELY not written (never sent, or refused by the host's budget); an op of
  // a row whose append failed unknown is never refunded (M8: an overcount, never an undercount)
  if (charged > 0) {
    const kept = new Set([...(out.landed ?? []), ...(out.unknown ?? [])]);
    let n = 0;
    const f = { touch: 0, del: 0, words: 0 };
    for (let j = 0; j < charged; j++) {
      if (kept.has(j)) continue;
      n++;
      f.touch += fc[j].touch;
      f.del += fc[j].del;
      f.words += fc[j].words;
    }
    if (n > 0) {
      try {
        await charge(host, actor, -n, 0, { touch: -f.touch, del: -f.del, words: -f.words });
      } catch {
        /* the overcount stands (M8) */
      }
    }
  }
  if (out.code) return refusal(out.code, { ...(out.extra ?? {}), budgetLeft: budgetLeft(turns, actor) });
  await saveIdx(host, dim, entry);
  if (entry.sinceKf >= KEYFRAME_EVERY_OPS && !cancelled()) await saveKeyframe(host, dim, entry);
  const answer = { ok: true, dim, seq: entry.state.seq, hash: hashOf(entry.state), applied: out.applied, skipped: out.skipped, ...(out.more ? { more: true } : {}), budgetLeft: budgetLeft(turns, actor) };
  if (oid !== undefined) memoAnswer(dim, oid, input, answer);
  return answer;
}

/**
 * THE UNDO CORE (S1.4 E1; Arky §3.3; Aegis rulings 3 and 4, G3, G5): shared by the person's `dim.undo` and, in
 * E2, the agent's `dim-undo`. Plans the undo of one HELD change-set with the published `planDimUndo` as `o.actor`
 * (the undoer: never "as a human" for a tool), per-node validated (G3), against the newest fold; packs the plan into
 * at most CALL_ROWS rows inside the call's bytes, each row carrying `act` and the mod-built `undo` marker (its
 * restored entries only for the re-adds IN that row, as `dimUndoMarkOf` honours them); appends them through
 * `o.appendRow`, and moves the fold and the history after each returned seq only. `o.fit(planOps, restored)` (E2: charges
 * the turn and foreign budgets) answers how many of the plan's ops may be sent, after planning and before the first
 * append; `o.between()` (E2: the grant re-check, M9) runs before each row after the first and stops the rest when
 * it answers true. The rest answers `more`; `planned` and `landed` are the plan's op indices packed and written,
 * `unknown` those of a row whose append failed without a definite "not written" (never refunded, M8).
 * Returns `{applied, skipped, more}` or `{code, extra?}`. Never charges a turn: the caller does, before the append.
 */
async function undoCore(host, dim, entry, o) {
  const held = entry.hist ? setRowsOf(entry.hist, setKey(o.cs)) : null;
  // outside the window, after a restart, or a set whose rows straddle a reload: never a plan built on another state
  if (!held || held.rows.length === 0) return { code: 'undo-expired' };
  const plan = planDimUndo({ rows: held.rows, after: held.after, current: entry.state, actor: o.actor, undoer: o.undoer, mint: mintUlid, of: o.cs, ...(o.ids ? { ids: o.ids } : {}) });
  if (plan.ops.length === 0) return { code: 'undo-nothing', extra: { skipped: plan.skipped } };
  const marker = (ops) => {
    const added = new Set(ops.filter((op) => op.type === 'add').map((op) => op.node.id));
    const restored = plan.restored.filter((e) => added.has(e[0])).map((e) => (e.length > 3 ? [e[0], e[1], e[2], e[3] ?? null, e[4] ?? null] : [e[0], e[1], e[2]]));
    return { of: ofOf(o.cs), ...(o.ids ? { ids: [...o.ids] } : {}), ...(restored.length > 0 ? { restored } : {}) };
  };
  const payloadOf = (ops) => opPayload(dim, ops, undefined, { act: o.act, undo: marker(ops) });
  // pack: op by op, each row measured WITH its marker, at most CALL_ROWS rows inside CALL_BYTES
  const rows = [];
  let cur = [];
  let curIx = [];
  const rowIx = [];
  let used = 0;
  let curBytes = 0;
  let i = 0;
  // Judge I-5 (E2-readiness): the caller's `fit(planOps)` runs after planning and before the first append and
  // answers how many of the plan's ops may be sent (E2 charges its turn and foreign budgets inside it)
  let limit = plan.ops.length;
  if (o.fit) {
    const n = await o.fit(plan.ops, plan.restored);
    limit = Number.isSafeInteger(n) ? Math.max(0, Math.min(n, plan.ops.length)) : 0;
    if (limit === 0) return { code: o.fitCode ?? 'undo-nothing', extra: { skipped: plan.skipped }, planned: [], landed: [] };
  }
  // Aegis I-4: an op that cannot fit a row even ALONE (a near-limit re-add with its marker) is left out with every
  // later op that names the id it would add, counted in skipped.refused; packing goes on
  const dropped = new Set();
  let unfit = 0;
  const names = (op) => (op.type === 'add' ? false : op.type === 'move' ? op.ids.some((x) => dropped.has(x)) : dropped.has(op.id) || (op.type === 'update' && Object.values(op.patch).some((v) => typeof v === 'string' && dropped.has(v))));
  while (i < limit) {
    const op = plan.ops[i];
    if (names(op)) {
      i++;
      continue;
    }
    const b = rowBytes(payloadOf([...cur, op]), o.stamp);
    if (b !== null && used + b <= CALL_BYTES) {
      cur.push(op);
      curIx.push(i);
      curBytes = b;
      i++;
      continue;
    }
    if (cur.length === 0 && (b === null || rowBytes(payloadOf([op]), o.stamp) === null)) {
      if (op.type === 'add') dropped.add(op.node.id);
      unfit++;
      i++;
      continue;
    }
    if (cur.length === 0 || rows.length + 1 >= CALL_ROWS) break;
    rows.push(cur);
    rowIx.push(curIx);
    used += curBytes;
    cur = [];
    curIx = [];
    curBytes = 0;
  }
  if (cur.length > 0) (rows.push(cur), rowIx.push(curIx));
  const planned = rowIx.flat();
  const landedIx = [];
  let more = plan.more || i < plan.ops.length;
  const skipped = { ...plan.skipped, refused: plan.skipped.refused + unfit };
  if (rows.length === 0) return unfit > 0 ? { code: 'undo-nothing', extra: { skipped } } : { code: 'row-too-large' };
  const landedIds = new Set();
  const unknownIx = [];
  let landedRows = 0;
  for (let r = 0; r < rows.length; r++) {
    const ops = rows[r];
    // Judge I-5: E2's grant re-check between rows (M9); a stop leaves the rest for a further call
    if (r > 0 && o.between && (await o.between())) {
      more = true;
      break;
    }
    const payload = payloadOf(ops);
    const seq = await o.appendRow(payload);
    if (seq === BUSY || seq === null) {
      // a budget refusal wrote nothing (the fold is kept, A4); anything else may have landed: the fold is forgotten
      if (seq === null) loaded.delete(dim);
      // `unknown`: the ops of a row whose append answered neither a seq nor a budget refusal (it may have landed)
      const unknown = seq === null ? [...rowIx[r]] : [];
      if (landedRows === 0) return { code: seq === BUSY ? 'append-busy' : 'append-failed', planned, landed: [], unknown };
      unknownIx.push(...unknown);
      more = true;
      break;
    }
    const before = entry.state;
    entry.state = landed(entry.state, DIM_KINDS.op, payload, o.stamp, seq);
    noteRow(entry, before, { seq, payload: { ...payload, relayedFor: o.stamp } });
    entry.idx = { ...entry.idx, lastSeq: seq };
    entry.sinceKf += ops.length;
    landedRows++;
    landedIx.push(...rowIx[r]);
    for (const op of ops) landedIds.add(op.type === 'move' ? op.ids[0] : op.type === 'add' ? op.node.id : op.id);
  }
  // per mark: the plan's own counts when every row landed, else the marks the landed rows reached
  const whole = landedRows === rows.length && i === plan.ops.length;
  // `planned` and `landed` are indices into the plan's ops (E2 refunds what was charged and never sent)
  return { applied: whole ? plan.applied - unfit : landedIds.size, skipped, more, planned, landed: landedIx, unknown: unknownIx };
}

/** A draw that wrote no op row: its count row, then the refusal. */
async function finishRefused(host, dim, entry, actor, refused, code) {
  refused.sort((x, y) => x.index - y.index);
  await countRow(host, dim, entry, actor, refused);
  return refusal(code, { dim, refused, budgetLeft: budgetLeft(turns, actor) });
}

/** One count row for a draw with refusals; at most COUNT_ROWS_PER_TURN per session and turn. Best effort. */
async function countRow(host, dim, entry, actor, refused) {
  if (refused.length === 0) return;
  const t = turns.get(actor.hsid);
  const counts = t && t.turn === actor.turn ? t.counts : 0;
  if (counts >= COUNT_ROWS_PER_TURN) return;
  try {
    await charge(host, actor, 0, 1);
  } catch {
    return;
  }
  // the count row is outside every fold and every page this mod reads: it never moves the index
  await appendTool(host, DIM_AUX_KINDS.drawRefused, countPayload(dim, refused));
}

async function viewTool(host, dim, entry, actor, a, cancelled) {
  const state = entry.state;
  const sel = selections.get(dim)?.get(actor.hsid) ?? [];
  const base = { hash: hashOf(state), mayDraw: !state.ended && dimMayDraw(state, entry.grants, actor.hsid), budgetLeft: budgetLeft(turns, actor), selection: [...sel], limit: a.limit };
  if (a.since === undefined) return viewAnswer(state, base);
  if (a.since > state.seq) return viewAnswer(state, { ...base, changes: 'reset' });
  if (a.since === state.seq) return viewAnswer(state, { ...base, changes: [], touched: new Set() });
  // one page of op rows after `since`; more than a page, or more than CHANGES_MAX entries, is a reset
  try {
    if (cancelled()) return refusal('cancelled');
    const page = plain(await host.kernel('log.read', { since: { logId, seq: a.since }, kinds: [DIM_KINDS.op], limit: PAGE_ROWS }));
    const rows = page && Array.isArray(own(page, 'rows')) ? page.rows : null;
    if (!rows || own(page, 'caughtUp') !== true) return viewAnswer(state, { ...base, changes: 'reset' });
    const mine = [];
    for (const r of rows) {
      const ev = plain(r) && own(r, 'view') === 'full' ? plain(own(r, 'event')) : null;
      const payload = ev ? plain(own(ev, 'payload')) : null;
      if (!payload || own(payload, 'dim') !== dim || !Number.isSafeInteger(own(r, 'seq')) || r.seq > state.seq) continue;
      mine.push({ seq: r.seq, kind: DIM_KINDS.op, payload });
    }
    const ch = changesOf(mine, dimRowBy);
    if (!ch) return viewAnswer(state, { ...base, changes: 'reset' });
    noteShown(dim, actor.hsid, ch.entries);
    return viewAnswer(state, { ...base, changes: ch.entries, touched: ch.touched });
  } catch {
    return viewAnswer(state, { ...base, changes: 'reset' });
  }
}

/* ── host → mod ───────────────────────────────────────────────────────────── */

// one call at a time, in arrival order (the host keeps one call in force per mod; this holds it here too)
let tail = Promise.resolve();
/** cancel tokens the host sent (M3); a call removes its own when it ends */
const cancels = new Set();
const queued = (f) => {
  const run = tail.then(f, f);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};

async function handle(method, p) {
  switch (method) {
    case 'init':
      if (p.abi !== ABI) throw Object.assign(new Error('unsupported abi'), { code: -32602 });
      return { abi: ABI, features: [], modAbiId: MOD_ABI_ID };
    case 'health':
      return { ok: true, abi: ABI };
    case 'shutdown':
      setImmediate(() => process.exit(0));
      return {};
    case 'command.run':
      return queued(async () => ({ result: await runCommand(typeof p.commandId === 'string' ? p.commandId : '', p.args, p.relayedFor, typeof p.callId === 'string' ? p.callId : null) }));
    case 'tool.call': {
      if (!TOOLS.includes(p.name)) throw Object.assign(new Error('no such tool'), { code: -32601 });
      const token = typeof p.cancelToken === 'string' ? p.cancelToken : null;
      const cancelled = () => token !== null && cancels.has(token);
      return queued(async () => {
        try {
          return { result: await runTool(p.name, p.input, p.relayedFor, typeof p.callId === 'string' ? p.callId : null, cancelled) };
        } finally {
          if (token !== null) cancels.delete(token);
        }
      });
    }
    default:
      throw Object.assign(new Error('unknown method'), { code: -32601 });
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg === null || typeof msg !== 'object') continue;
    if (typeof msg.method !== 'string') {
      // a reply to one of this mod's own requests
      const w = pending.get(msg.id);
      if (!w) continue;
      pending.delete(msg.id);
      // the host's refusal data rides along (an APPEND_BUDGET refusal is a definite "not written", A4)
      if (msg.error) w.rej(Object.assign(new Error('host refused'), { data: msg.error && typeof msg.error === 'object' ? msg.error.data : undefined }));
      else w.res(msg.result);
      continue;
    }
    // M3: the host cancels a tool call that ran past its time; the call stops at its next check and answers
    if (msg.method === 'cancel') {
      const t = msg.params && typeof msg.params === 'object' ? msg.params.cancelToken : undefined;
      if (typeof t === 'string' && t.length <= 128) {
        if (cancels.size >= 64) cancels.delete(cancels.values().next().value);
        cancels.add(t);
      }
      continue;
    }
    // this mod keeps no state from the event feed: its truth is the rows it appended
    if (msg.method === 'event' || msg.id === undefined) continue;
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    const id = msg.id;
    handle(msg.method, params).then(
      (result) => send({ id, result }),
      (e) => send({ id, error: { code: e && typeof e.code === 'number' ? e.code : -32000, message: e && typeof e.code === 'number' ? String(e.message) : 'the dimension mod failed' } }),
    );
  }
});
process.stdin.on('end', () => process.exit(0));
