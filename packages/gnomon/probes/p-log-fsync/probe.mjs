// p-log-fsync — root-cause experiment for the #kernel-log p99 append regression
// (1e6 rows: p99 7.4 ms vs 5 ms budget; ~2.3% of appends ~7.5 ms after ~100k rows).
//
// Hypothesis under test: the per-commit head anchor write (tmp + rename, no
// fsync, anchor.ts) leaves dirty APFS metadata that the NEXT WAL fsync
// (synchronous=FULL) must flush, so commit latency balloons only when both run.
//
// Arms (each in a fresh realpath'd temp dir, each its own child process):
//   A  raw SQLite insert, kernel-log pragmas (WAL, synchronous=FULL,
//      wal_autocheckpoint=0) + kernel-log's inline PASSIVE checkpoint every 20k
//   B  A + head tmp-write + rename after every commit (anchor.ts policy today)
//   C  A + head pwrite at offset 0, fixed size, no rename, after every commit
//   D  A + head tmp+rename every 64 commits
//   E  A + head tmp+rename when >= 50 ms since the last one (a 50 ms timer; the
//      loop is synchronous, so the "timer" is checked inline after each commit)
//   F  B, but the head lives in a sibling subdir (db in <d>/db, head in <d>/anchor)
//   G  the research 33 policy (P8-D82): D+E coalesced bulk anchor (rename when
//      64 rows or 50 ms since the last one) PLUS a forced "critical" row at
//      1/64 (i % 64 === 63): PRAGMA fullfsync=ON for that one commit
//      (F_FULLFSYNC), then the head tmp+rename before the next append. The
//      keystore anchor is not modelled (arm H, after P04). Bulk and critical
//      latencies are reported separately (G-LOG-04 as restated by S33-08:
//      bulk p99 < 5 ms and <= 0.1 % over 5 ms; critical p99 < 25 ms).
//   H*  P8-D83 human cadence: the G coalesced bulk load (rename at 64 rows or
//      50 ms) with ONE critical commit per 1000 ms of WALL time (not per N
//      rows), each followed by a synchronous head tmp+rename. The critical
//      commit's durability mechanism varies:
//   H1  PRAGMA fullfsync=ON for that transaction (SQLite -> F_FULLFSYNC).
//   H2  F_BARRIERFSYNC ordering barrier on the WAL after a default commit:
//      NOT reachable from node:sqlite without native code. Upstream SQLite's
//      os_unix.c full_fsync() only issues F_FULLFSYNC (fullfsync=ON) or
//      fsync(2); there is no barrier pragma/compile option (only Apple's
//      system libsqlite3 carries that patch; node bundles the upstream
//      amalgamation, see compile_options in the evidence). node fs.fsyncSync
//      goes through libuv uv__fs_fsync, which on Apple tries F_FULLFSYNC
//      FIRST and only falls back to F_BARRIERFSYNC when F_FULLFSYNC fails, so
//      it cannot select the barrier either. H2 is therefore recorded, not run.
//   H2b plain fsync semantics: PRAGMA fullfsync=OFF set explicitly for that
//      transaction, synchronous=FULL -> fsync(2) (on macOS this does not
//      flush the drive cache). Mechanically the same syscall as H3; it is an
//      explicit-pragma replicate so the fsync(2) cost is measured twice.
//   H3  baseline: no extra flush (synchronous=FULL default, fullfsync off) + rename.
// Per commit we time (hrtime) the SQLite commit and the anchor op separately;
// `total` = commit + anchor = what append() pays.
//
// Zero deps: node builtins + node:sqlite.
//   node packages/gnomon/probes/run.mjs p-log-fsync --timeout 1800000
// Env: P_LOG_FSYNC_N (default 300000), P_LOG_FSYNC_ARMS (default ABCDEF; letters,
// or comma-separated arm ids, e.g. A,E,G or H1,H2b,H3; H2 is reported as unreachable).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const specRefs = ['§3.2', 'G-LOG-06', 'M1.2 append p99 <= 5 ms'];

const SELF = fileURLToPath(import.meta.url);
const BUDGET_MS = 5;
const ARMS = {
  A: 'raw SQLite (kernel-log pragmas) only',
  B: 'A + head tmp+rename every commit (current anchor.ts)',
  C: 'A + head pwrite in place at offset 0, no rename, every commit',
  D: 'A + head tmp+rename every 64 commits',
  E: 'A + head tmp+rename on a 50 ms timer',
  F: 'B with head in a sibling subdir of the db dir',
  G: 'D+E coalesced anchor + forced fullfsync commit and anchor rename at 1/64 (research 33 policy)',
  H1: 'human cadence: D+E coalesced bulk + 1 critical/1000 ms wall: PRAGMA fullfsync=ON (F_FULLFSYNC) + sync anchor rename',
  H2: 'human cadence: critical = default commit + F_BARRIERFSYNC on the WAL (NOT reachable from node:sqlite; not run)',
  H2b: 'human cadence: critical = PRAGMA fullfsync=OFF explicit, synchronous=FULL -> fsync(2) (no drive-cache flush) + sync anchor rename',
  H3: 'human cadence: critical = no extra flush (synchronous=FULL default) + sync anchor rename (baseline)',
};
const HUMAN = new Set(['H1', 'H2b', 'H3']);
const H2_UNREACHABLE = {
  arm: 'H2',
  desc: 'human cadence: critical = default commit + F_BARRIERFSYNC on the WAL',
  reachable: false,
  evidence: [
    'node:sqlite bundles the upstream SQLite amalgamation; PRAGMA compile_options (see evidence.sqliteCompileOptions) has no barrier-fsync option',
    'upstream os_unix.c full_fsync(): HAVE_FULLFSYNC -> fcntl(F_FULLFSYNC) only when PRAGMA fullfsync=ON, else fsync(2); no F_BARRIERFSYNC path (that is an Apple patch to the system libsqlite3 only)',
    'node fs.fsync/fsyncSync -> libuv uv__fs_fsync on __APPLE__: fcntl(F_FULLFSYNC) first, F_BARRIERFSYNC only if F_FULLFSYNC fails, then fsync(2); no way to request the barrier alone',
    'node has no fcntl binding; native helpers are out of scope (no native code), so H2b substitutes',
  ],
};
const CRITICAL_BUDGET_MS = 25;
const MAX_OVER5_FRAC = 0.001;

const SCHEMA = `
CREATE TABLE chain (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, at TEXT NOT NULL, principal TEXT NOT NULL,
                    audience TEXT NOT NULL, sensitivity TEXT NOT NULL, envelope TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, sig TEXT);
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`;

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
function stats(arr) {
  const s = Float64Array.from(arr).sort();
  let slow = 0;
  for (const v of arr) if (v > BUDGET_MS) slow++;
  const r = (x) => Math.round(x * 1000) / 1000;
  return { p50: r(pct(s, 50)), p90: r(pct(s, 90)), p99: r(pct(s, 99)), p999: r(pct(s, 99.9)), max: r(s[s.length - 1]), over5ms: slow };
}

async function child(arm, dir, n) {
  const { DatabaseSync } = await import('node:sqlite');
  const dbDir = arm === 'F' ? path.join(dir, 'db') : dir;
  const headDir = arm === 'F' ? path.join(dir, 'anchor') : dir;
  fs.mkdirSync(dbDir, { recursive: true });
  fs.mkdirSync(headDir, { recursive: true });
  const db = new DatabaseSync(path.join(dbDir, 'kernel.db'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0;');
  db.exec(SCHEMA);
  const ins = db.prepare('INSERT INTO chain (seq, id, kind, at, principal, audience, sensitivity, envelope, prev_hash, hash, sig) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const tip = db.prepare('SELECT seq, hash FROM chain ORDER BY seq DESC LIMIT 1');
  const headPath = path.join(headDir, 'head');
  const tmpPath = `${headPath}.tmp`;
  const HEAD_LEN = 200;
  const headText = (seq, hash) => {
    const s = JSON.stringify({ schemaVersion: 'gnomonHead:v1', log: 'log_probe', segment: 1, seq, hash, at: new Date().toISOString() });
    return `${s}${' '.repeat(Math.max(0, HEAD_LEN - 1 - s.length))}\n`;
  };
  const renameHead = (seq, hash) => {
    const fd = fs.openSync(tmpPath, 'w', 0o600);
    try { fs.writeSync(fd, headText(seq, hash)); } finally { fs.closeSync(fd); }
    fs.renameSync(tmpPath, headPath);
  };
  renameHead(0, '0'.repeat(64));
  const inPlaceFd = arm === 'C' ? fs.openSync(headPath, 'r+') : undefined;

  const commitMs = new Float64Array(n);
  const anchorMs = new Float64Array(n);
  const totalMs = new Float64Array(n);
  let prev = '0'.repeat(64);
  let lastRename = process.hrtime.bigint();
  let since = 0;
  let checkpoints = 0;
  const pad = 'x'.repeat(260);
  const t0 = Date.now();
  const critical = new Uint8Array(n);
  let sinceRename = 0;
  let lastCritical = process.hrtime.bigint();
  for (let i = 0; i < n; i++) {
    const seq = i + 1;
    const forced = (arm === 'G' && i % 64 === 63) || (HUMAN.has(arm) && process.hrtime.bigint() - lastCritical >= 1_000_000_000n);
    critical[i] = forced ? 1 : 0;
    const env = `{"schemaVersion":"event:v1","id":"ev_${seq}","seq":${seq},"kind":"session.output","payload":"${pad}","prev":"${prev}"}`;
    const hash = createHash('sha256').update(env).digest('hex');
    const sig = createHash('sha512').update(hash).digest('base64');
    const at = new Date().toISOString();
    const a = process.hrtime.bigint();
    if (forced) lastCritical = a;
    if (forced && (arm === 'G' || arm === 'H1')) db.exec('PRAGMA fullfsync=ON');
    else if (forced && arm === 'H2b') db.exec('PRAGMA fullfsync=OFF');
    db.exec('BEGIN IMMEDIATE');
    tip.get();
    ins.run(seq, `ev_${seq}`, 'session.output', at, 'kernel', 'owner', 'normal', env, prev, hash, sig);
    db.exec('COMMIT');
    if (forced && (arm === 'G' || arm === 'H1')) db.exec('PRAGMA fullfsync=OFF');
    const b = process.hrtime.bigint();
    if (arm === 'B' || arm === 'F') renameHead(seq, hash);
    else if (arm === 'C') fs.writeSync(inPlaceFd, headText(seq, hash), 0, 'utf8');
    else if (arm === 'D') { if (seq % 64 === 0) renameHead(seq, hash); }
    else if (arm === 'E') { if (b - lastRename >= 50_000_000n) { renameHead(seq, hash); lastRename = process.hrtime.bigint(); } }
    else if (arm === 'G' || HUMAN.has(arm)) {
      if (forced || ++sinceRename >= 64 || b - lastRename >= 50_000_000n) { renameHead(seq, hash); lastRename = process.hrtime.bigint(); sinceRename = 0; }
    }
    // kernel-log hard WAL bound: inline PASSIVE checkpoint every 20k appends
    if (++since >= 20_000) { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); since = 0; checkpoints++; }
    const c = process.hrtime.bigint();
    commitMs[i] = Number(b - a) / 1e6;
    anchorMs[i] = Number(c - b) / 1e6;
    totalMs[i] = Number(c - a) / 1e6;
    prev = hash;
  }
  const wallS = (Date.now() - t0) / 1000;
  if (inPlaceFd !== undefined) fs.closeSync(inPlaceFd);
  db.close();
  // onset: slow (>5 ms total) commits per 50k bucket, first slow index
  const buckets = [];
  let firstSlow = -1;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / 50_000);
    buckets[k] ??= 0;
    if (totalMs[i] > BUDGET_MS) { buckets[k]++; if (firstSlow < 0) firstSlow = i + 1; }
  }
  // attribution: of the slow totals, how many are slow in the commit (fsync) part
  let slowInCommit = 0;
  let slowInAnchor = 0;
  for (let i = 0; i < n; i++) if (totalMs[i] > BUDGET_MS) { if (commitMs[i] > anchorMs[i]) slowInCommit++; else slowInAnchor++; }
  const out = { arm, desc: ARMS[arm], n, wallS, checkpoints, total: stats(totalMs), commit: stats(commitMs), anchor: stats(anchorMs), slowPer50k: buckets, firstSlowAt: firstSlow, slowDominatedBy: { commit: slowInCommit, anchor: slowInAnchor } };
  if (arm === 'G' || HUMAN.has(arm)) {
    const bulk = [];
    const crit = [];
    for (let i = 0; i < n; i++) (critical[i] ? crit : bulk).push(totalMs[i]);
    const b = stats(bulk);
    const c = stats(crit);
    out.bulk = { ...b, n: bulk.length, over5Frac: b.over5ms / bulk.length };
    out.critical = { ...c, n: crit.length };
    if (HUMAN.has(arm)) {
      const cc = [];
      const ca = [];
      for (let i = 0; i < n; i++) if (critical[i]) { cc.push(commitMs[i]); ca.push(anchorMs[i]); }
      out.criticalCommit = stats(cc);
      out.criticalAnchor = stats(ca);
      out.cadence = { criticalPerWallS: crit.length / wallS };
      // per-critical [seq, total ms] so onset vs. db size / checkpoints is visible
      out.criticalSeries = [];
      for (let i = 0; i < n; i++) if (critical[i]) out.criticalSeries.push([i + 1, Math.round(totalMs[i] * 1000) / 1000]);
    }
    out.gLog04 = { bulkP99Ok: b.p99 < BUDGET_MS, bulkOver5Ok: b.over5ms / bulk.length <= MAX_OVER5_FRAC, criticalP99Ok: c.p99 < CRITICAL_BUDGET_MS };
  }
  return out;
}

// Windows arm (W1): node fs.fsyncSync -> libuv uv_fs_fsync -> FlushFileBuffers;
// fs.fdatasyncSync -> NtFlushBuffersFileEx(FLUSH_FLAGS_FILE_DATA_SYNC_ONLY).
// SQLite os_win.c winSync() calls FlushFileBuffers for synchronous=FULL and
// ignores PRAGMA fullfsync (a no-op off Apple), so H1 and H3 run the same
// syscalls there: the pair is a replicate, not a contrast. FlushFileBuffers
// already asks the drive to flush its cache (unlike fsync(2) on macOS). The
// default N (20k) is smaller because each commit pays a FlushFileBuffers.
function fsyncBench(dir, iters) {
  const out = {};
  for (const [name, sync] of [['fsyncSync', fs.fsyncSync], ['fdatasyncSync', fs.fdatasyncSync]]) {
    const fd = fs.openSync(path.join(dir, `bench-${name}`), 'a');
    const t = new Float64Array(iters);
    const buf = Buffer.alloc(256, 120);
    try {
      for (let i = 0; i < iters; i++) {
        fs.writeSync(fd, buf);
        const a = process.hrtime.bigint();
        sync(fd);
        t[i] = Number(process.hrtime.bigint() - a) / 1e6;
      }
    } finally {
      fs.closeSync(fd);
    }
    out[name] = { iters, ...stats(t) };
  }
  return out;
}

function win32Volume(dir) {
  const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 30_000 }).trim();
  const drive = path.parse(dir).root.slice(0, 1);
  const first = (e) => String(e?.message ?? e).split(/\r?\n/)[0];
  const ev = {};
  try { ev.volume = JSON.parse(ps(`Get-Volume -DriveLetter ${drive} | Select-Object DriveLetter,FileSystem,DriveType,Size | ConvertTo-Json -Compress`)); } catch (e) { ev.volume = `unreadable: ${first(e)}`; }
  try { ev.disk = JSON.parse(ps(`Get-Partition -DriveLetter ${drive} | Get-Disk | Select-Object FriendlyName,BusType | ConvertTo-Json -Compress`)); } catch (e) { ev.disk = `unreadable: ${first(e)}`; }
  try { ev.defenderRealTime = JSON.parse(ps('(Get-MpComputerStatus).RealTimeProtectionEnabled | ConvertTo-Json')); } catch (e) { ev.defenderRealTime = `unreadable: ${first(e)}`; }
  return ev;
}

export default async function probe(ctx = {}) {
  const win = (ctx.platform ?? process.platform) === 'win32';
  const n = Number(process.env.P_LOG_FSYNC_N ?? (win ? 20_000 : 300_000));
  const spec = process.env.P_LOG_FSYNC_ARMS ?? (win ? 'A,D,G,H1,H3' : 'ABCDEF');
  const arms = (spec.includes(',') ? spec.split(',').map((a) => a.trim()) : /^[A-G]+$/.test(spec) ? spec.split('') : [spec.trim()]).filter((a) => a in ARMS);
  const { DatabaseSync } = await import('node:sqlite');
  const mem = new DatabaseSync(':memory:');
  const sqliteCompileOptions = mem.prepare('PRAGMA compile_options').all().map((r) => r.compile_options);
  mem.close();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'p-log-fsync-')));
  const results = {};
  let rawFsync;
  try {
    if (win) {
      const bdir = path.join(root, 'bench');
      fs.mkdirSync(bdir);
      rawFsync = JSON.parse(execFileSync(process.execPath, ['--no-warnings', SELF, '--fsync-bench', bdir, '1000'], { encoding: 'utf8', timeout: 10 * 60_000 }));
      process.stderr.write(`p-log-fsync raw fsyncSync p50 ${rawFsync.fsyncSync.p50} ms p99 ${rawFsync.fsyncSync.p99} ms\n`);
    }
    for (const arm of arms) {
      if (arm === 'H2') { results.H2 = H2_UNREACHABLE; process.stderr.write('p-log-fsync arm H2: not reachable from node:sqlite (recorded, not run)\n'); continue; }
      const dir = path.join(root, `arm-${arm}`);
      fs.mkdirSync(dir);
      const out = execFileSync(process.execPath, ['--no-warnings', SELF, '--child', arm, dir, String(n)], { encoding: 'utf8', maxBuffer: 1 << 24, timeout: 60 * 60_000 });
      results[arm] = JSON.parse(out);
      fs.rmSync(dir, { recursive: true, force: true });
      process.stderr.write(`p-log-fsync arm ${arm}: total p99 ${results[arm].total.p99} ms, >5ms ${results[arm].total.over5ms}/${n}, ${results[arm].wallS}s\n`);
      if (results[arm].critical) process.stderr.write(`p-log-fsync arm ${arm}: bulk p99 ${results[arm].bulk.p99} ms (${results[arm].bulk.over5ms} >5ms), critical p99 ${results[arm].critical.p99} ms\n`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  // arm G is judged by the restated G-LOG-04 (bulk p99 + slow fraction, critical p99), the others by total p99
  const meets = Object.values(results)
    .filter((r) => r.reachable !== false)
    .filter((r) => (r.gLog04 ? r.gLog04.bulkP99Ok && r.gLog04.bulkOver5Ok && r.gLog04.criticalP99Ok : r.total.p99 < BUDGET_MS))
    .map((r) => r.arm);
  if (win) {
    return {
      verdict: meets.length ? 'pass' : 'fail',
      evidence: {
        n,
        budgetMs: BUDGET_MS,
        tmpRoot: root.replace(fs.realpathSync(os.tmpdir()), '<tmp>'),
        dataVolume: win32Volume(root),
        cpus: os.cpus()[0]?.model?.trim(),
        syncSemantics: {
          nodeFsync: 'fs.fsyncSync -> libuv uv_fs_fsync -> FlushFileBuffers (flushes the drive write cache)',
          nodeFdatasync: 'fs.fdatasyncSync -> NtFlushBuffersFileEx(FLUSH_FLAGS_FILE_DATA_SYNC_ONLY)',
          sqliteFull: 'os_win.c winSync -> FlushFileBuffers on each WAL commit at synchronous=FULL',
          fullfsyncPragma: 'no-op off Apple: H1 and H3 issue the same syscalls (a replicate pair)',
        },
        rawFsync,
        armsMeetingBudget: meets,
        sqliteCompileOptions,
        arms: results,
      },
      toolVersions: { sqlite: process.versions.sqlite ?? 'unknown' },
    };
  }
  let fsType = 'unknown';
  try { fsType = execFileSync('/sbin/mount', [], { encoding: 'utf8' }).split('\n').find((l) => / on \/System\/Volumes\/Data /.test(l)) ?? fsType; } catch {}
  return {
    verdict: meets.length ? 'pass' : 'fail',
    evidence: { n, budgetMs: BUDGET_MS, tmpRoot: root, dataVolume: fsType, cpus: os.cpus()[0]?.model, armsMeetingBudget: meets, sqliteCompileOptions, arms: results },
    toolVersions: { sqlite: process.versions.sqlite ?? 'unknown' },
  };
}

if (process.argv[2] === '--fsync-bench') {
  process.stdout.write(JSON.stringify(fsyncBench(process.argv[3], Number(process.argv[4]))));
}
if (process.argv[2] === '--child') {
  const [, , , arm, dir, n] = process.argv;
  child(arm, dir, Number(n)).then((r) => process.stdout.write(JSON.stringify(r)));
}
