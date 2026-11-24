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
import { DIM_KINDS, dimHash, emptyDimState, foldDim } from './dim-shape.mjs';
import {
  ATTACH_CAP,
  DIM_CAP,
  KEYFRAME_BUDGET_BYTES,
  KEYFRAME_DIMS,
  KEYFRAME_EVERY_OPS,
  actorOf,
  apply,
  attachPayload,
  decodeKeyframe,
  encodeKeyframe,
  endPayload,
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
const TOOLS = ['dim-view', 'dim-draw'];
const RELAYED_FIELDS = ['principal', 'connId', 'surface', 'agent', 'hsid', 'turn'];
const PAGE_ROWS = 1000;
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
/** dim id → { idx: {repo, firstSeq, lastSeq, title, log}, state, sinceKf, dirty } in use order */
const loaded = new Map();

const ulidOf = (dim) => dim.slice(4);

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
    dims = Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, DIM_CAP) : [];
    kfs = Array.isArray(k) ? k.map((e) => plain(e)).filter((e) => e && typeof own(e, 'id') === 'string' && Number.isSafeInteger(own(e, 'bytes'))).map((e) => ({ id: e.id, bytes: e.bytes })) : [];
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
    return decodeKeyframe(head, chunks, dim);
  } catch {
    return null;
  }
}

/** Cold open: the keyframe when it verifies, then the rows after it up to the index's last seq, folded page by page. */
async function load(host, dim) {
  const hit = loaded.get(dim);
  if (hit) {
    loaded.delete(dim);
    loaded.set(dim, hit);
    return hit;
  }
  if (!dims.includes(ulidOf(dim))) return null;
  const idx = idxOf(await host.get(`idx:${ulidOf(dim)}`));
  // an index written for another log names seqs that mean nothing here
  if (!idx || idx.log !== logId) return null;
  const kf = await readKeyframe(host, dim);
  const usable = kf && kf.seq >= idx.firstSeq && kf.seq <= idx.lastSeq ? kf : null;
  let state = usable ?? emptyDimState(dim);
  let since = usable ? usable.seq : idx.firstSeq - 1;
  for (let i = 0; i < MAX_PAGES && since < idx.lastSeq; i++) {
    const page = plain(await host.kernel('log.read', { since: { logId, seq: since }, until: idx.lastSeq, kinds: KINDS, limit: PAGE_ROWS }));
    const rows = page && Array.isArray(own(page, 'rows')) ? page.rows : null;
    const next = page ? own(page, 'next') : undefined;
    if (!rows) break;
    const batch = [];
    for (const r of rows) {
      const ev = plain(r) && own(r, 'view') === 'full' ? plain(own(r, 'event')) : null;
      if (ev && typeof own(ev, 'kind') === 'string' && Number.isSafeInteger(own(r, 'seq'))) batch.push({ seq: r.seq, kind: ev.kind, payload: own(ev, 'payload') });
    }
    // ONE linear fold per page, continuing the last (never foldDimRow in a loop: that copies the state per row)
    state = foldDim(batch, undefined, state);
    if (!Number.isSafeInteger(next) || next <= since) break;
    since = next;
  }
  // the fold must have reached the row the index names: anything else means rows are missing, so nothing is served
  if (state.seq !== idx.lastSeq || state.dim !== dim) throw new Error('fold short');
  const entry = { idx, state, sinceKf: 0, dirty: false };
  remember(dim, entry);
  return entry;
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

async function dropKeyframe(host, id, n) {
  for (let i = 0; i < n; i++) await host.set(`kf:${id}:${i}`, null);
  await host.set(`kf:${id}`, null);
}

/** Best effort: a keyframe only shortens a cold open, so no failure here ever fails a command. */
async function saveKeyframe(host, dim, entry) {
  const id = ulidOf(dim);
  try {
    const enc = encodeKeyframe(entry.state);
    entry.sinceKf = 0;
    if (!enc) return;
    const old = plain(await host.get(`kf:${id}`));
    const oldN = old && Number.isSafeInteger(own(old, 'n')) ? old.n : 0;
    // make room first: only the most recent dimensions keep a keyframe, inside one byte budget
    let keep = kfs.filter((e) => e.id !== id);
    while (keep.length > 0 && (keep.length >= KEYFRAME_DIMS || keep.reduce((a, e) => a + e.bytes, enc.head.bytes) > KEYFRAME_BUDGET_BYTES)) {
      const gone = keep[0];
      keep = keep.slice(1);
      const head = plain(await host.get(`kf:${gone.id}`));
      await dropKeyframe(host, gone.id, head && Number.isSafeInteger(own(head, 'n')) ? Math.min(head.n, 64) : 0);
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
    const fresh = { idx: { repo: a.repo, firstSeq: seq, lastSeq: seq, title: t.title, log: logId }, state: landed(emptyDimState(a.dim), DIM_KINDS.start, payload, stamp, seq), sinceKf: 0, dirty: false };
    remember(a.dim, fresh);
    await saveIdx(host, a.dim, fresh);
    if (!dims.includes(ulidOf(a.dim))) {
      const list = [...dims, ulidOf(a.dim)];
      try {
        await host.set('dims', list);
        dims = list;
      } catch {
        // the row is in the log but the index could not take it: the dimension is not served from memory either
        loaded.delete(a.dim);
        return refusal('unavailable');
      }
    }
    return { ok: true, created: true, dim: a.dim, title: t.title, firstSeq: seq, seq, hash: dimHash(fresh.state) };
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
    if (seq === null) return refusal('append-failed');
    entry.state = landed(entry.state, kind, payload, stamp, seq);
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
    return typeof seq === 'number' ? { ok: true, created: false, dim: a.dim, title: entry.state.title, firstSeq: entry.idx.firstSeq, seq, hash: dimHash(entry.state) } : seq;
  }

  if (commandId === 'dim.close') {
    if (state.ended) return { ok: true, already: true, dim: a.dim, seq: state.seq, ops: state.ops, nodes: state.nodes.size, hash: dimHash(state) };
    const payload = endPayload(state);
    const seq = await write(DIM_KINDS.end, payload);
    if (typeof seq !== 'number') return seq;
    await saveKeyframe(host, a.dim, entry);
    return { ok: true, already: false, dim: a.dim, seq, ops: payload.ops, nodes: payload.nodes, hash: dimHash(entry.state) };
  }

  // dim.op
  if (state.ended) return refusal('dim-ended');
  const v = apply(state, a.ops, actor);
  // a secret anywhere, or nothing accepted: no row at all
  if (v.secret) return refusal('secret', { refused: v.refused });
  if (v.ok.length === 0) return refusal('ops-refused', { refused: v.refused });
  // the row is built from the validator's own copies only
  const seq = await write(DIM_KINDS.op, opPayload(a.dim, v.ok));
  if (typeof seq !== 'number') return seq;
  entry.sinceKf += v.ok.length;
  if (entry.sinceKf >= KEYFRAME_EVERY_OPS) await saveKeyframe(host, a.dim, entry);
  return { ok: true, dim: a.dim, seq, applied: v.ok.length, refused: v.refused };
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
      if (msg.error) w.rej(new Error('host refused'));
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
