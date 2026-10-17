// p11-ws-framing — Arky P11 (research 29 §2; spec §19.1 M1.0 P11, §2.1, §4.9).
// Can the `gnomon-web` transport child do RFC 6455 over the node:http upgrade
// with zero deps, fast enough and small enough?
//
//   server  ws-server.mjs, a separate child process (its RSS is the measurement)
//   client  Node's built-in global WebSocket (undici) for the API-level cases
//           and throughput; a raw node:net client for Autobahn-style frame
//           cases the browser API cannot produce (fragmented/invalid frames)
//
// Pass criteria (Arky): the frame cases pass; 4 MiB frames >= 100 MB/s;
// transport-child RSS < 60 MB.
import { execFile, fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';

export const specRefs = ['§2.1 transport child', '§4.9 gnomon-rpc:v1', '§11.2', '§19.1 M1.0 P11', 'research 29 §2 P11'];

const MB = 1_000_000;
const MiB = 1024 * 1024;
const FRAME = 4 * MiB;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(p, ms, what) {
  return Promise.race([p, sleep(ms).then(() => Promise.reject(new Error(`timeout: ${what}`)))]);
}

// ----------------------------------------------------------- API client

function openWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    ws.binaryType = 'arraybuffer';
    const queue = [];
    const waiters = [];
    ws.onmessage = (ev) => {
      const w = waiters.shift();
      if (w) w(ev.data);
      else queue.push(ev.data);
    };
    ws.next = (ms = 5000) =>
      withTimeout(
        queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r)),
        ms,
        'ws message',
      );
    ws.closed = new Promise((r) => ws.addEventListener('close', (ev) => r({ code: ev.code, reason: ev.reason, wasClean: ev.wasClean })));
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error(`ws error: ${e.message ?? e.type}`));
  });
}

const eqBuf = (a, b) => Buffer.from(a).equals(Buffer.from(b));

async function apiCases(port) {
  const cases = {};
  const record = async (name, fn) => {
    try {
      cases[name] = await fn();
    } catch (err) {
      cases[name] = { pass: false, error: err.message };
    }
  };
  const ws = await openWs(port);

  await record('text-roundtrip-unicode', async () => {
    const s = 'héllo ✓ 🌍 gnomon';
    ws.send(s);
    const got = await ws.next();
    return { pass: got === s };
  });
  await record('binary-roundtrip-1KiB', async () => {
    const b = randomBytes(1024);
    ws.send(b);
    return { pass: eqBuf(await ws.next(), b) };
  });
  await record('empty-text-and-binary', async () => {
    ws.send('');
    const t = await ws.next();
    ws.send(new Uint8Array(0));
    const b = await ws.next();
    return { pass: t === '' && b.byteLength === 0 };
  });
  await record('length-encoding-boundaries', async () => {
    const out = {};
    for (const n of [125, 126, 127, 65535, 65536, 65537]) {
      const b = randomBytes(n);
      ws.send(b);
      out[n] = eqBuf(await ws.next(), b);
    }
    return { pass: Object.values(out).every(Boolean), sizes: out };
  });
  await record('server-fragmented-text-reassembled', async () => {
    ws.send('frag:5');
    const got = await ws.next();
    return { pass: got === 'fragmented hello world ✓', got };
  });
  await record('server-ping-client-auto-pong', async () => {
    ws.send('ping:abc');
    const got = await ws.next();
    return { pass: got === 'pong:abc', got };
  });
  await record('client-close-4001', async () => {
    ws.close(4001, 'bye');
    const c = await withTimeout(ws.closed, 3000, 'close');
    return { pass: c.code === 4001 && c.reason === 'bye' && c.wasClean, ...c };
  });
  for (const code of [1000, 4002]) {
    await record(`server-close-${code}`, async () => {
      const w = await openWs(port);
      w.send(`close:${code}`);
      const c = await withTimeout(w.closed, 3000, 'close');
      return { pass: c.code === code && c.reason === 'server-close', ...c };
    });
  }
  return cases;
}

// ------------------------------------------------------- raw frame client

function rawFrame({ opcode, payload = Buffer.alloc(0), fin = true, rsv = 0, mask = true, lenOverride }) {
  const len = payload.length;
  const b0 = (fin ? 0x80 : 0) | rsv | opcode;
  let head;
  const lenField = lenOverride ?? len;
  if (lenField < 126) head = Buffer.from([b0, (mask ? 0x80 : 0) | lenField]);
  else if (lenField < 65536) {
    head = Buffer.alloc(4);
    head[0] = b0;
    head[1] = (mask ? 0x80 : 0) | 126;
    head.writeUInt16BE(lenField, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = b0;
    head[1] = (mask ? 0x80 : 0) | 127;
    head.writeBigUInt64BE(BigInt(lenField), 2);
  }
  if (!mask) return Buffer.concat([head, payload]);
  const m = randomBytes(4);
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= m[i & 3];
  return Buffer.concat([head, m, body]);
}

function closePayload(code, reason = Buffer.alloc(0)) {
  const p = Buffer.alloc(2);
  p.writeUInt16BE(code, 0);
  return Buffer.concat([p, reason]);
}

// Opens a raw connection, sends frames, returns the server's frames until it
// closes the socket (or `ms` elapses).
function rawSession(port, frames, ms = 1500) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    const key = randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0);
    let upgraded = false;
    const got = [];
    const finish = () => {
      s.destroy();
      resolve(got);
    };
    const t = setTimeout(finish, ms);
    s.on('connect', () =>
      s.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`),
    );
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!upgraded) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        if (!buf.subarray(0, 12).toString().includes('101')) return reject(new Error('no 101'));
        buf = buf.subarray(i + 4);
        upgraded = true;
        for (const f of frames) s.write(f);
      }
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f;
        let hdr = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          hdr = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          hdr = 10;
        }
        if (buf.length < hdr + len) return;
        const payload = buf.subarray(hdr, hdr + len);
        got.push({ fin: (buf[0] & 0x80) !== 0, opcode: buf[0] & 0x0f, payload: Buffer.from(payload) });
        buf = buf.subarray(hdr + len);
      }
    });
    s.on('close', () => {
      clearTimeout(t);
      resolve(got);
    });
    s.on('error', () => {});
  });
}

const closeCodeOf = (frames) => {
  const c = frames.find((f) => f.opcode === 0x8);
  return c ? (c.payload.length >= 2 ? c.payload.readUInt16BE(0) : 'empty') : null;
};

async function rawCases(port) {
  const T = (s) => Buffer.from(s);
  const kosme = Buffer.from('κόσμε', 'utf8');
  const cases = {
    '1.1 masked text echo': {
      frames: [rawFrame({ opcode: 1, payload: T('Hello') })],
      check: (g) => g[0]?.opcode === 1 && g[0].payload.toString() === 'Hello',
    },
    '2.2 ping 125 bytes -> pong': {
      frames: [rawFrame({ opcode: 9, payload: Buffer.alloc(125, 0x61) })],
      check: (g) => g[0]?.opcode === 0xa && g[0].payload.length === 125,
    },
    '2.5 ping 126 bytes -> 1002': {
      frames: [rawFrame({ opcode: 9, payload: Buffer.alloc(126, 0x61) })],
      check: (g) => closeCodeOf(g) === 1002,
    },
    '3.1 RSV1 set -> 1002': {
      frames: [rawFrame({ opcode: 1, payload: T('x'), rsv: 0x40 })],
      check: (g) => closeCodeOf(g) === 1002,
    },
    '4.1 reserved opcode 3 -> 1002': {
      frames: [rawFrame({ opcode: 3, payload: T('x') })],
      check: (g) => closeCodeOf(g) === 1002,
    },
    'unmasked client frame -> 1002': {
      frames: [rawFrame({ opcode: 1, payload: T('x'), mask: false })],
      check: (g) => closeCodeOf(g) === 1002,
    },
    '5.3 fragmented text (3 frames) -> one echo': {
      frames: [
        rawFrame({ opcode: 1, payload: T('Hel'), fin: false }),
        rawFrame({ opcode: 0, payload: T('l'), fin: false }),
        rawFrame({ opcode: 0, payload: T('o') }),
      ],
      check: (g) => g.length >= 1 && g[0].opcode === 1 && g[0].payload.toString() === 'Hello',
    },
    '5.6 ping interleaved in fragments -> pong then echo': {
      frames: [
        rawFrame({ opcode: 1, payload: T('frag'), fin: false }),
        rawFrame({ opcode: 9, payload: T('p') }),
        rawFrame({ opcode: 0, payload: T('ment') }),
      ],
      check: (g) => g[0]?.opcode === 0xa && g[0].payload.toString() === 'p' && g[1]?.payload.toString() === 'fragment',
    },
    '5.1 fragmented ping -> 1002': {
      frames: [rawFrame({ opcode: 9, payload: T('a'), fin: false })],
      check: (g) => closeCodeOf(g) === 1002,
    },
    '5.9 continuation without start -> 1002': {
      frames: [rawFrame({ opcode: 0, payload: T('x') })],
      check: (g) => closeCodeOf(g) === 1002,
    },
    '5.18 new text frame inside fragmented message -> 1002': {
      frames: [rawFrame({ opcode: 1, payload: T('a'), fin: false }), rawFrame({ opcode: 1, payload: T('b') })],
      check: (g) => closeCodeOf(g) === 1002,
    },
    '6.2 valid UTF-8 split mid code point across fragments': {
      frames: [rawFrame({ opcode: 1, payload: kosme.subarray(0, 3), fin: false }), rawFrame({ opcode: 0, payload: kosme.subarray(3) })],
      check: (g) => g[0]?.payload.equals(kosme),
    },
    '6.3 invalid UTF-8 text -> 1007': {
      frames: [rawFrame({ opcode: 1, payload: Buffer.from([0xce, 0xba, 0xe1, 0xbd, 0xb9, 0xcf, 0x83, 0xce, 0xbc, 0xce, 0xb5, 0xed, 0xa0, 0x80, 0x65, 0x64, 0x69, 0x74, 0x65, 0x64]) })],
      check: (g) => closeCodeOf(g) === 1007,
    },
    '7.1 close 1000 -> echoed 1000': {
      frames: [rawFrame({ opcode: 8, payload: closePayload(1000) })],
      check: (g) => closeCodeOf(g) === 1000,
    },
    '7.3 close with 1-byte payload -> 1002': {
      frames: [rawFrame({ opcode: 8, payload: Buffer.from([0x03]) })],
      check: (g) => closeCodeOf(g) === 1002,
    },
    '7.5 close with invalid UTF-8 reason -> 1007': {
      frames: [rawFrame({ opcode: 8, payload: closePayload(1000, Buffer.from([0xff, 0xfe])) })],
      check: (g) => closeCodeOf(g) === 1007,
    },
  };
  for (const code of [0, 999, 1004, 1005, 1006, 1016, 2999]) {
    cases[`7.9 invalid close code ${code} -> 1002`] = {
      frames: [rawFrame({ opcode: 8, payload: closePayload(code) })],
      check: (g) => closeCodeOf(g) === 1002,
    };
  }
  for (const code of [1001, 1011, 3000, 4999]) {
    cases[`7.7 valid close code ${code} -> echoed`] = {
      frames: [rawFrame({ opcode: 8, payload: closePayload(code) })],
      check: (g) => closeCodeOf(g) === code,
    };
  }
  const out = {};
  for (const [name, c] of Object.entries(cases)) {
    const g = await rawSession(port, c.frames);
    out[name] = { pass: Boolean(c.check(g)), serverFrames: g.map((f) => ({ op: f.opcode, fin: f.fin, len: f.payload.length, close: f.opcode === 8 ? closeCodeOf([f]) : undefined })) };
  }
  return out;
}

// ----------------------------------------------------------- throughput

async function throughput(port, frames, pipelined) {
  const ws = await openWs(port);
  const payload = randomBytes(FRAME);
  // warm-up
  ws.send(payload);
  await ws.next(10_000);
  const t0 = process.hrtime.bigint();
  let ok = true;
  if (pipelined) {
    for (let i = 0; i < frames; i++) ws.send(payload);
    for (let i = 0; i < frames; i++) ok = (await ws.next(30_000)).byteLength === FRAME && ok;
  } else {
    for (let i = 0; i < frames; i++) {
      ws.send(payload);
      ok = (await ws.next(30_000)).byteLength === FRAME && ok;
    }
  }
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  ws.close(1000);
  const oneWayBytes = frames * FRAME;
  return {
    frames,
    frameBytes: FRAME,
    seconds: Number(secs.toFixed(4)),
    allEchoedIntact: ok,
    oneWayMBps: Number((oneWayBytes / secs / MB).toFixed(1)),
    bothWaysMBps: Number(((2 * oneWayBytes) / secs / MB).toFixed(1)),
    oneWayMiBps: Number((oneWayBytes / secs / MiB).toFixed(1)),
  };
}

// ---------------------------------------------------------------- probe

// Samples the child's memory from outside every ~10 ms: `ps -o rss=` (KiB) and,
// on macOS, every 5th tick `footprint -p` (phys_footprint, what Activity Monitor
// shows). macOS ps RSS keeps freed-but-reusable pages, so the two diverge.
function parseFootprintMB(text) {
  const m = /Footprint:\s*([\d.]+)\s*(KB|MB|GB)/.exec(text);
  if (!m) return 0;
  const v = Number(m[1]);
  return m[2] === 'KB' ? (v * 1024) / MB : m[2] === 'MB' ? (v * MiB) / MB : (v * 1024 * MiB) / MB;
}

function rssSampler(pid) {
  let peakKiB = 0;
  let peakFootprintMB = 0;
  let samples = 0;
  let footprintSamples = 0;
  let stopped = false;
  const hasFootprint = process.platform === 'darwin' && existsSync('/usr/bin/footprint');
  const exec = (cmd, args) =>
    new Promise((r) => execFile(cmd, args, { encoding: 'utf8' }, (err, out) => r(err ? '' : String(out))));
  const loop = async () => {
    while (!stopped) {
      const v = Number((await exec('/bin/ps', ['-o', 'rss=', '-p', String(pid)])).trim());
      if (v > peakKiB) peakKiB = v;
      samples++;
      if (hasFootprint && samples % 5 === 1) {
        const f = parseFootprintMB(await exec('/usr/bin/footprint', ['-p', String(pid)]));
        if (f > peakFootprintMB) peakFootprintMB = f;
        footprintSamples++;
      }
      await sleep(10);
    }
  };
  const done = loop();
  return async () => {
    stopped = true;
    await done;
    return {
      peakRssMB: Number(((peakKiB * 1024) / MB).toFixed(1)),
      samples,
      peakPhysFootprintMB: hasFootprint ? Number(peakFootprintMB.toFixed(1)) : null,
      footprintSamples,
    };
  };
}

async function runServer(ctx, { execArgv = [], env = {}, frameCases = true } = {}) {
  const child = fork(path.join(ctx.probeDir, 'ws-server.mjs'), [], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    execArgv,
    env: { ...process.env, ...env },
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const msgs = [];
  const waiters = [];
  child.on('message', (m) => {
    const w = waiters.shift();
    if (w) w(m);
    else msgs.push(m);
  });
  const nextMsg = () => withTimeout(msgs.length ? Promise.resolve(msgs.shift()) : new Promise((r) => waiters.push(r)), 10_000, 'child ipc');
  const stats = async () => {
    child.send({ type: 'stats' });
    const m = await nextMsg();
    return { rssMB: Number((m.rss / MB).toFixed(1)), peakRssMB: Number(((m.maxRSSKiB * 1024) / MB).toFixed(1)), heapUsedMB: Number((m.heapUsed / MB).toFixed(1)), arrayBuffersMB: Number((m.arrayBuffers / MB).toFixed(1)) };
  };
  try {
    const { port } = await nextMsg();
    const rssIdle = await stats();
    const api = frameCases ? await apiCases(port) : undefined;
    const raw = frameCases ? await rawCases(port) : undefined;
    const rssAfterCases = await stats();
    const stopSeq = rssSampler(child.pid);
    const sequential = await throughput(port, 32, false);
    const sampledSequential = await stopSeq();
    const rssAfterSequential = await stats();
    const stopPipe = rssSampler(child.pid);
    const pipelined = await throughput(port, 32, true);
    await sleep(300);
    const sampledPipelined = await stopPipe();
    const rssAfterPipelined = await stats();
    return {
      api,
      raw,
      sequential,
      pipelined,
      rss: {
        idle: rssIdle,
        afterFrameCases: rssAfterCases,
        afterSequential: rssAfterSequential,
        afterPipelined: rssAfterPipelined,
        sampledPeakDuringSequential: sampledSequential,
        sampledPeakDuringPipelined: sampledPipelined,
      },
      stderr: stderr.slice(0, 500),
    };
  } finally {
    child.kill();
  }
}

export default async function probe(ctx) {
  {
    const base = await runServer(ctx);
    const gcVariant = await runServer(ctx, { execArgv: ['--expose-gc'], env: { GNOMON_P11_GC_EVERY_MB: '16' }, frameCases: false });
    const { api, raw, sequential, pipelined } = base;
    const rssIdle = base.rss.idle;
    const rssAfterPipelined = base.rss.afterPipelined;
    const stderr = base.stderr;
    const apiPass = Object.values(api).every((c) => c.pass);
    const rawPass = Object.values(raw).every((c) => c.pass);
    const bestMBps = Math.max(sequential.oneWayMBps, pipelined.oneWayMBps);
    const throughputPass = sequential.oneWayMBps >= 100 && pipelined.oneWayMBps >= 100 && sequential.allEchoedIntact && pipelined.allEchoedIntact;
    const peakRssMB = Math.max(rssAfterPipelined.peakRssMB, base.rss.sampledPeakDuringSequential.peakRssMB, base.rss.sampledPeakDuringPipelined.peakRssMB);
    const sampledLoadPeakMB = Math.max(base.rss.sampledPeakDuringSequential.peakRssMB, base.rss.sampledPeakDuringPipelined.peakRssMB);
    const peakFootprintMB = Math.max(base.rss.sampledPeakDuringSequential.peakPhysFootprintMB ?? 0, base.rss.sampledPeakDuringPipelined.peakPhysFootprintMB ?? 0);
    const gcLoadPeakMB = Math.max(gcVariant.rss.sampledPeakDuringSequential.peakRssMB, gcVariant.rss.sampledPeakDuringPipelined.peakRssMB);
    const rssPass = peakRssMB < 60;
    const idleRssPass = rssIdle.rssMB < 60;
    const evidence = {
      apiCases: api,
      rawFrameCases: raw,
      throughput: { sequentialEcho: sequential, pipelinedEcho: pipelined, criterionMBps: 100, metric: 'one-way payload MB/s (MB = 1e6) of a full echo round trip; client (undici) cost is included, so this is conservative' },
      transportChildRss: { ...base.rss, criterionMB: 60, judgedOn: 'max of getrusage maxRSS and the external 10 ms ps sampler over the whole run (maxRSS includes Node startup)' },
      forcedGcVariant: {
        what: 'same server, --expose-gc, gc() after every 16 MB received (frame cases skipped) — shows what bounding external ArrayBuffer memory buys',
        sequential: gcVariant.sequential,
        pipelined: gcVariant.pipelined,
        rss: gcVariant.rss,
      },
      summary: {
        apiCasesPass: apiPass,
        rawFrameCasesPass: rawPass,
        rawCaseCount: Object.keys(raw).length,
        bestOneWayMBps: bestMBps,
        throughputPass,
        idleRssMB: rssIdle.rssMB,
        idleRssPass,
        peakRssMB,
        peakRssPass: rssPass,
        sampledLoadPeakMB,
        peakPhysFootprintUnderLoadMB: peakFootprintMB,
        physFootprintPass: peakFootprintMB > 0 ? peakFootprintMB < 60 : null,
        forcedGcVariantLoadPeakMB: gcLoadPeakMB,
        forcedGcVariantOneWayMBps: Math.max(gcVariant.sequential.oneWayMBps, gcVariant.pipelined.oneWayMBps),
      },
      notes: [
        'Not the Autobahn suite itself (that needs Python/Docker); the raw cases mirror Autobahn sections 1-7 numbering where they apply.',
        'Client-to-server fragmentation is exercised by the raw client; the built-in WebSocket never fragments outgoing messages.',
        'Server is Node with no flags.',
        'macOS: ps/getrusage RSS counts freed-but-reusable malloc pages (MADV_FREE_REUSABLE) until memory pressure; phys_footprint (footprint -p) is the charged memory. The forced-GC variant shows RSS growth is not live JS garbage. The criterion "RSS < 60 MB" is judged literally on RSS here; physFootprintPass is reported alongside for the re-plan.',
      ],
      childStderr: stderr.slice(0, 500),
    };
    const verdict = !apiPass || !rawPass ? 'fail' : throughputPass && rssPass ? 'pass' : 'partial';
    return { verdict, evidence };
  }
}
