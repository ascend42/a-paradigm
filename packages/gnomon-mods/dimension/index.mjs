// #dimension-mod (spec §12.7; first-party, mod-abi:v1; id `gnomon.dimension`).
// A dimension is a list of op rows in the kernel log. This mod is the ONLY writer of those rows: it validates
// every op with the published `dim-shape:v1` validator and appends through the host, which stamps who acted.
// Runs under #mod-host from its pinned snapshot and imports nothing outside this folder. S1.3 is human-only:
// the four commands write for a person on the Gnomon window and for nobody else; the two tools exist so the
// commands have a `write` effect, and answer `not-available` until agents draw (S1.4). It ships no view.
//
// Rules held here (Aegis S1.3 B2):
//  - identity comes from the host-written `relayedFor` and the host-composed `args.hsid` / `args.repo` only;
//  - args are read against a closed shape, field by field (model.mjs readArgs): never spread, never assigned;
//  - every check, the 512 cap and the row-size check included, runs BEFORE the append;
//  - mod state and the in-memory fold change only AFTER the append returned a seq;
//  - a refusal is a code and a fixed sentence, never input.
import { DIM_AUX_KINDS, DIM_KINDS, dimHash, dimMayDraw, emptyDimGrants, emptyDimState, foldDim, foldDimGrants } from './dim-shape.mjs';
import {
  ATTACH_CAP,
  DIM_CAP,
  KEYFRAME_BUDGET_BYTES,
  KEYFRAME_DIMS,
  KEYFRAME_EVERY_OPS,
  MEMO_CAP,
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
  rowProblem,
  stampOf,
  startPayload,
  titleFor,
} from './model.mjs';

const ABI = 'mod-abi:v1';
// Echoed at init; the host refuses any other id (a mod-ABI change needs a new build of this mod).
const MOD_ABI_ID = 'sha256:fb9bd26ac5577300dee3d6dc9c3dbe1e5927eca0655e976d7f4f372c273d3f66';
const KINDS = [DIM_KINDS.start, DIM_KINDS.attach, DIM_KINDS.op, DIM_KINDS.end];
// the log pages of a fold also read the grant kind: without it every grant would vanish at a cold open
const PAGE_KINDS = [...KINDS, DIM_AUX_KINDS.grant];
const OID = /^[0-9a-f]{16}$/;
const TOOLS = ['dim-view', 'dim-draw'];
const RELAYED_FIELDS = ['principal', 'connId', 'surface', 'agent', 'hsid', 'turn'];
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

const ulidOf = (dim) => dim.slice(4);
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const REPO = /^repo:[0-9a-f]{16}$/;

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
async function foldFromLog(host, dim, from, since, cancelled) {
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
      batch.push({ seq: r.seq, kind: ev.kind, payload });
    }
    // ONE linear fold per page, continuing the last (never a fold per row: that copies the state per row)
    if (batch.length > 0) state = foldDim(batch, undefined, state);
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
async function load(host, dim) {
  const hit = loaded.get(dim);
  if (hit) {
    loaded.delete(dim);
    loaded.set(dim, hit);
    return hit;
  }
  const id = ulidOf(dim);
  const known = dims.includes(id) ? idxOf(await host.get(`idx:${id}`)) : null;
  const idx = known && known.log === logId ? known : null;
  if (idx) {
    const kf = await readKeyframe(host, dim);
    const usable = kf && kf.state.seq >= idx.firstSeq ? kf : null;
    const from = usable ?? { state: emptyDimState(dim), grants: emptyDimGrants(), oids: new Map() };
    const { state, grants, oids, last } = await foldFromLog(host, dim, from, usable ? usable.state.seq : idx.firstSeq - 1);
    // the fold must have reached at least the row the index names: anything less means rows are missing
    if (last < idx.lastSeq || state.dim !== dim) throw new Error('fold short');
    const entry = { idx: { ...idx, lastSeq: last }, state, grants, oids, sinceKf: 0, dirty: last !== idx.lastSeq };
    remember(dim, entry);
    return entry;
  }
  // no usable index: look for the dimension in the log before anyone may create it again
  const { state, grants, oids, first, last } = await foldFromLog(host, dim, { state: emptyDimState(dim), grants: emptyDimGrants(), oids: new Map() }, 0);
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
  const entry = { idx: { repo: first.repo, firstSeq: first.seq, lastSeq: last, title: state.title, log: logId }, state, grants, oids, sinceKf: 0, dirty: true };
  remember(dim, entry);
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
  const out = await foldFromLog(host, dim, entry, entry.idx.lastSeq, cancelled);
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
  while (loaded.size > LOADED_MAX) loaded.delete(loaded.keys().next().value);
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
    const enc = encodeKeyframe(entry.state, logId, { grants: entry.grants, oids: entry.oids });
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

/** Append one row. Resolves the seq, or null when the host refused or failed (nothing was written). */
async function append(host, kind, payload) {
  try {
    const out = plain(await host.kernel('log.append', { kind, payload }));
    const seq = out ? own(out, 'seq') : undefined;
    return Number.isSafeInteger(seq) && seq > 0 ? seq : null;
  } catch {
    return null;
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
  if (entry && entry.dirty) await saveIdx(host, a.dim, entry);

  if (commandId === 'dim.open' && !entry) {
    // a new dimension: this session's repo owns it, and this session is its first attached one
    const t = titleFor(a.title, a.fromSession);
    if (t.problem) return refusal(t.problem);
    if (dims.length >= DIM_CAP) return refusal('dim-cap');
    const payload = startPayload(a.dim, a.hsid, a.opened, t.title);
    if (rowProblem(payload, stamp)) return refusal('row-too-large');
    const seq = await append(host, DIM_KINDS.start, payload);
    if (seq === null) return refusal('append-failed');
    const fresh = { idx: { repo: a.repo, firstSeq: seq, lastSeq: seq, title: t.title, log: logId }, state: landed(emptyDimState(a.dim), DIM_KINDS.start, payload, stamp, seq), grants: emptyDimGrants(), oids: new Map(), sinceKf: 0, dirty: false };
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
    } catch {
      // the row is in the log but the index could not take it: the next command adopts the dimension from the log
      return refusal('unavailable');
    }
    return { ok: true, created: true, dim: a.dim, title: t.title, firstSeq: seq, seq, hash: dimHash(fresh.state), grants: grantList(fresh) };
  }

  // every other path needs a known dimension of the caller's repo
  if (!entry) return refusal('dim-unknown');
  if (entry.idx.repo !== a.repo) return refusal('repo-mismatch');
  const state = entry.state;
  const attached = state.attached.includes(a.hsid);

  /** Append, then (and only then) move the fold and the index. */
  const write = async (kind, payload) => {
    if (rowProblem(payload, stamp)) return refusal('row-too-large');
    const seq = await append(host, kind, payload);
    if (seq === null) {
      // the mod cannot tell "not written" from "written, reply lost": forget the fold, so the next command reads the log
      loaded.delete(a.dim);
      return refusal('append-failed');
    }
    // a grant row is outside the published fold: it moves the grant fold, through the same shared function
    if (kind === DIM_AUX_KINDS.grant) entry.grants = foldDimGrants([{ seq, kind, payload: { ...payload, relayedFor: stamp } }], a.dim, entry.grants);
    else entry.state = landed(entry.state, kind, payload, stamp, seq);
    entry.idx = { ...entry.idx, lastSeq: seq };
    await saveIdx(host, a.dim, entry);
    return seq;
  };

  if (commandId === 'dim.attach') {
    // idempotent: a session already attached appends nothing
    if (attached) return { ok: true, already: true, dim: a.dim, seq: state.seq };
    if (state.attached.length >= ATTACH_CAP) return refusal('attach-cap');
    const seq = await write(DIM_KINDS.attach, attachPayload(a.dim, a.hsid));
    return typeof seq === 'number' ? { ok: true, already: false, dim: a.dim, seq } : seq;
  }

  if (!attached) return refusal('not-attached');

  if (commandId === 'dim.open') {
    // a reopen: no title (the first start row named the dimension), and any title sent is not read
    const seq = await write(DIM_KINDS.start, startPayload(a.dim, a.hsid, a.opened));
    return typeof seq === 'number' ? { ok: true, created: false, dim: a.dim, title: entry.state.title, firstSeq: entry.idx.firstSeq, seq, hash: dimHash(entry.state), grants: grantList(entry) } : seq;
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
    if (state.ended) return { ok: true, already: true, dim: a.dim, seq: state.seq, ops: state.ops, nodes: state.nodes.size, hash: dimHash(state) };
    const payload = endPayload(state);
    const seq = await write(DIM_KINDS.end, payload);
    if (typeof seq !== 'number') return seq;
    await saveKeyframe(host, a.dim, entry);
    return { ok: true, already: false, dim: a.dim, seq, ops: payload.ops, nodes: payload.nodes, hash: dimHash(entry.state) };
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
    if (entry.dirty) await saveIdx(host, a.dim, entry);
    return { ok: true, dim: a.dim, seq: entry.state.seq, hash: dimHash(entry.state) };
  }

  if (commandId !== 'dim.op') return refusal('command-unknown');
  if (state.ended) return refusal('dim-ended');
  const v = apply(state, a.ops, actor, { stamp });
  // ops that could never fit one row are refused before the validator reads them
  if (v.tooLarge) return refusal('row-too-large');
  // a secret anywhere, or nothing accepted: no row at all
  if (v.secret) return refusal('secret', { refused: v.refused });
  if (v.ok.length === 0) return refusal('ops-refused', { refused: v.refused });
  // the row is built from the validator's own copies only
  const seq = await write(DIM_KINDS.op, opPayload(a.dim, v.ok));
  if (typeof seq !== 'number') return seq;
  entry.sinceKf += v.ok.length;
  if (entry.sinceKf >= KEYFRAME_EVERY_OPS) await saveKeyframe(host, a.dim, entry);
  // the hash of the fold at this seq: the page compares its own fold there (S1.4 §5)
  return { ok: true, dim: a.dim, seq, hash: dimHash(entry.state), applied: v.ok.length, refused: v.refused };
}

/** S1.3: no tool is available. `saw` names the relayedFor fields the host sent (names only), for the identity test. */
function runTool(relayedFor) {
  const r = plain(relayedFor);
  return { refused: 'not-available', saw: r ? RELAYED_FIELDS.filter((k) => Object.hasOwn(r, k)) : [] };
}

/* ── host → mod ───────────────────────────────────────────────────────────── */

// one call at a time, in arrival order (the host keeps one call in force per mod; this holds it here too)
let tail = Promise.resolve();
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
    case 'tool.call':
      if (!TOOLS.includes(p.name)) throw Object.assign(new Error('no such tool'), { code: -32601 });
      return { result: runTool(p.relayedFor) };
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
    // this mod keeps no state from the event feed: its truth is the rows it appended
    if (msg.method === 'event' || msg.method === 'cancel' || msg.id === undefined) continue;
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    const id = msg.id;
    handle(msg.method, params).then(
      (result) => send({ id, result }),
      (e) => send({ id, error: { code: e && typeof e.code === 'number' ? e.code : -32000, message: e && typeof e.code === 'number' ? String(e.message) : 'the dimension mod failed' } }),
    );
  }
});
process.stdin.on('end', () => process.exit(0));
