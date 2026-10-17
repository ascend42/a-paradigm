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
// Per commit we time (hrtime) the SQLite commit and the anchor op separately;
// `total` = commit + anchor = what append() pays.
//
// Zero deps: node builtins + node:sqlite.
//   node packages/gnomon/probes/run.mjs p-log-fsync --timeout 1800000
// Env: P_LOG_FSYNC_N (default 300000), P_LOG_FSYNC_ARMS (default ABCDEF).

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
};

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
  for (let i = 0; i < n; i++) {
    const seq = i + 1;
    const env = `{"schemaVersion":"event:v1","id":"ev_${seq}","seq":${seq},"kind":"session.output","payload":"${pad}","prev":"${prev}"}`;
    const hash = createHash('sha256').update(env).digest('hex');
    const sig = createHash('sha512').update(hash).digest('base64');
    const at = new Date().toISOString();
    const a = process.hrtime.bigint();
    db.exec('BEGIN IMMEDIATE');
    tip.get();
    ins.run(seq, `ev_${seq}`, 'session.output', at, 'kernel', 'owner', 'normal', env, prev, hash, sig);
    db.exec('COMMIT');
    const b = process.hrtime.bigint();
    if (arm === 'B' || arm === 'F') renameHead(seq, hash);
    else if (arm === 'C') fs.writeSync(inPlaceFd, headText(seq, hash), 0, 'utf8');
    else if (arm === 'D') { if (seq % 64 === 0) renameHead(seq, hash); }
    else if (arm === 'E') { if (b - lastRename >= 50_000_000n) { renameHead(seq, hash); lastRename = process.hrtime.bigint(); } }
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
  return { arm, desc: ARMS[arm], n, wallS, checkpoints, total: stats(totalMs), commit: stats(commitMs), anchor: stats(anchorMs), slowPer50k: buckets, firstSlowAt: firstSlow, slowDominatedBy: { commit: slowInCommit, anchor: slowInAnchor } };
}

export default async function probe() {
  const n = Number(process.env.P_LOG_FSYNC_N ?? 300_000);
  const arms = (process.env.P_LOG_FSYNC_ARMS ?? 'ABCDEF').split('');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'p-log-fsync-')));
  const results = {};
  try {
    for (const arm of arms) {
      const dir = path.join(root, `arm-${arm}`);
      fs.mkdirSync(dir);
      const out = execFileSync(process.execPath, ['--no-warnings', SELF, '--child', arm, dir, String(n)], { encoding: 'utf8', maxBuffer: 1 << 24, timeout: 20 * 60_000 });
      results[arm] = JSON.parse(out);
      fs.rmSync(dir, { recursive: true, force: true });
      process.stderr.write(`p-log-fsync arm ${arm}: total p99 ${results[arm].total.p99} ms, >5ms ${results[arm].total.over5ms}/${n}, ${results[arm].wallS}s\n`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const meets = Object.values(results).filter((r) => r.total.p99 < BUDGET_MS).map((r) => r.arm);
  let fsType = 'unknown';
  try { fsType = execFileSync('/sbin/mount', [], { encoding: 'utf8' }).split('\n').find((l) => / on \/System\/Volumes\/Data /.test(l)) ?? fsType; } catch {}
  return {
    verdict: meets.length ? 'pass' : 'fail',
    evidence: { n, budgetMs: BUDGET_MS, tmpRoot: root, dataVolume: fsType, cpus: os.cpus()[0]?.model, armsMeetingBudget: meets, arms: results },
    toolVersions: { sqlite: process.versions.sqlite ?? 'unknown' },
  };
}

if (process.argv[2] === '--child') {
  const [, , , arm, dir, n] = process.argv;
  child(arm, dir, Number(n)).then((r) => process.stdout.write(JSON.stringify(r)));
}
