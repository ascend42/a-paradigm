// @gnomon-platform: darwin, linux
/**
 * #kernel-log (spec §3.2, M1.2) — the POSIX half: owner-only file modes, crash
 * safety under kill -9, and G-LOG-04 / the M1.2 falsifier (p99 append > 5 ms
 * or memory > 150 MB by the per-OS metric of §16's memory row:
 * `phys_footprint` on macOS via /usr/bin/footprint, never RSS; `Pss` from
 * /proc/self/smaps_rollup on Linux CI). Windows (private bytes) is the parity
 * phase (P8-D78) — see platform-registry.ts.
 *
 * G-LOG-04 as re-cut by research 33 S33-10 (P8-D83): the critical class
 * (config.loaded: bulk-durability commit, NO F_FULLFSYNC, then file anchor,
 * then the awaited keystore anchor) is measured at HUMAN CADENCE — one
 * critical append per second, interleaved with bulk background load. The
 * unit pass runs GNOMON_LOG_PERF_CRIT (default 60) criticals ≈ 60 s; the
 * ≥ 600-event oracle of S33-10 is the manual 10⁶ probe run
 * (probes/p-log-fsync, `p-log-fsync-human-cadence`). Load shape: the first
 * GNOMON_LOG_PERF_ROWS bulk appends back-to-back (the bulk p99 burst), then
 * paced bulk (10 rows / 10 ms) until the criticals are done. Asserted: bulk
 * p99 < 5 ms AND ≤ 0.1 % of bulk appends over 5 ms; critical p99 < 25 ms.
 * Recorded, never asserted: p99.9, max, checkpoint count. The 1/64 sustained
 * mix (arm G) is a reported stress figure of the probe, not asserted here.
 * Two honesty notes (round-2 review): with the default 60 criticals the p99
 * index is the max, so critical p99 < 25 ms is ASSERTED only when n ≥ 100
 * (GNOMON_LOG_PERF_CRIT=100+) and recorded otherwise; and the child uses the
 * default KeystoreAnchorStore stub, so the keystore leg costs zero here — the
 * helper round trip is measured by probe P04 (M1.3).
 *
 * Both process tests run the BUILT kernel (dist/index.js) in a child process,
 * so the memory number is a kernel-like process's, not the vitest worker's.
 * Scale with GNOMON_LOG_PERF_ROWS (default 10 000; the oracle's 10⁶ is a
 * manual run). On CI (`CI` set) the perf numbers are recorded, not asserted:
 * shared runners are not the founder's machine (G-HON-07 names the machine).
 */
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FILE_ANCHOR_MAX_LAG, KernelLog, readBootSession, SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { PKG_ROOT } from './helpers.js';

const KERNEL = 'p:abcdefgh/kernel';
const DIST = path.join(PKG_ROOT, 'dist', 'index.js');
const homes: string[] = [];

function tmpHome(): string {
  const h = mkdtempSync(path.join(os.tmpdir(), 'gnomon-logp-'));
  homes.push(h);
  return h;
}

afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

function pem(): string {
  return generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

/** Child-process body shared by both tests (runs dist/, zero deps). */
const CHILD = String.raw`
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
const { kernelLog } = await import(process.env.GN_DIST);
const signer = new kernelLog.SoftwareEd25519Signer(process.env.GN_KEY);
const log = kernelLog.KernelLog.open({ home: process.env.GN_HOME, kernelPrincipal: '${KERNEL}', signer });
const n = Number(process.env.GN_ROWS);
const mode = process.env.GN_MODE;
const critN = Number(process.env.GN_CRIT ?? 60);
const bulk = [];
const crit = [];
const started = performance.now();
let lastCrit = started;
for (let i = 0; mode === 'crash' || i < n || crit.length < critN; i++) {
  // S33-10: critical kinds at 1/s (human cadence), interleaved with the bulk load
  const critical = mode === 'perf' && crit.length < critN && performance.now() - lastCrit >= 1000;
  if (critical) lastCrit = performance.now();
  else if (mode === 'perf' && i >= n && i % 10 === 0) await new Promise((r) => setTimeout(r, 10)); // paced background bulk
  const t = process.hrtime.bigint();
  if (critical) await log.append({ kind: 'config.loaded', principal: '${KERNEL}', payload: { i } });
  else await log.append({ kind: 'session.open', principal: '${KERNEL}', session: 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0', payload: { i, note: 'x'.repeat(64) } });
  if (mode === 'perf') (critical ? crit : bulk).push(Number(process.hrtime.bigint() - t) / 1e6);
  if (mode === 'crash' && i === n) process.stdout.write('ready\n');
}
const stats = (arr) => {
  const s = Float64Array.from(arr).sort();
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  let over5 = 0;
  for (const v of s) if (v > 5) over5++;
  return { n: s.length, p50: q(0.5), p99: q(0.99), p999: q(0.999), max: s[s.length - 1], over5, over5Frac: over5 / s.length };
};
const status = log.anchorStatus;
let memory = { metric: 'none', mb: null };
if (process.platform === 'darwin' && existsSync('/usr/bin/footprint')) {
  const out = execFileSync('/usr/bin/footprint', ['-p', String(process.pid)], { encoding: 'utf8' });
  const m = /Footprint:\s*([\d.]+)\s*(KB|MB|GB)/.exec(out);
  if (m) memory = { metric: 'phys_footprint', mb: Number(m[1]) * ({ KB: 1 / 1024, MB: 1, GB: 1024 })[m[2]] };
} else if (process.platform === 'linux' && existsSync('/proc/self/smaps_rollup')) {
  const m = /^Pss:\s+(\d+) kB/m.exec(readFileSync('/proc/self/smaps_rollup', 'utf8'));
  if (m) memory = { metric: 'Pss', mb: Number(m[1]) / 1024 };
}
await log.close();
process.stdout.write(JSON.stringify({ rows: bulk.length + crit.length, seconds: (performance.now() - started) / 1000, bulk: stats(bulk), critical: stats(crit), checkpoints: status.checkpoints, forcedAnchorRate: status.forcedAnchorRate, memory, rssMb: process.memoryUsage().rss / 1048576 }) + '\n');
`;

function childEnv(home: string, key: string, rows: number, mode: 'perf' | 'crash', crit = 0): NodeJS.ProcessEnv {
  return { ...process.env, GN_DIST: DIST, GN_HOME: home, GN_KEY: key, GN_ROWS: String(rows), GN_MODE: mode, GN_CRIT: String(crit) };
}

describe('#kernel-log file modes (owner-only, §15.2 custody posture)', () => {
  it('kernel.db, its WAL, the head anchor and the segment dir are owner-only', async () => {
    const home = tmpHome();
    const log = KernelLog.open({ home, kernelPrincipal: KERNEL, signer: SoftwareEd25519Signer.generate(), segmentRows: 4 });
    for (let i = 0; i < 5; i++) await log.append({ kind: 'daemon.start', principal: KERNEL });
    const mode = (p: string) => statSync(path.join(home, p)).mode & 0o777;
    expect(mode('kernel.db')).toBe(0o600);
    expect(mode('kernel.db-wal')).toBe(0o600);
    expect(mode('head')).toBe(0o600);
    expect(mode('log')).toBe(0o700);
    expect(mode('log/segments')).toBe(0o700);
    expect(mode('log/segments/000001.db')).toBe(0o600);
    await log.close();
  });
});

describe('#kernel-log boot session (S33-10, P8-D83)', () => {
  it('reads kern.bootsessionuuid (macOS) / boot_id (Linux) once per process, zero deps', () => {
    const boot = readBootSession();
    expect(boot).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(readBootSession()).toBe(boot);
    const home = tmpHome();
    const log = KernelLog.open({ home, kernelPrincipal: KERNEL, signer: SoftwareEd25519Signer.generate() });
    expect(log.report.boot).toBe(boot);
    void log.close();
  });
});

describe('#kernel-log crash safety (kill -9 mid-append)', () => {
  it('a SIGKILLed writer leaves a verifiable chain; reopen accepts at most a lagging anchor', async () => {
    const home = tmpHome();
    const key = pem();
    const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD], { env: childEnv(home, key, 300, 'crash'), stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (d: Buffer) => {
        if (d.toString().includes('ready')) setTimeout(() => (child.kill('SIGKILL'), resolve()), 20);
      });
      child.on('exit', (code) => (code !== null ? reject(new Error(`child exited ${code} before kill: ${err}`)) : undefined));
    });
    await new Promise((r) => child.on('close', r));
    const signer = new SoftwareEd25519Signer(key);
    const log = KernelLog.open({ home, kernelPrincipal: KERNEL, signer });
    expect(log.head().seq).toBeGreaterThanOrEqual(301);
    expect(log.report.anchorLag).toBeLessThanOrEqual(FILE_ANCHOR_MAX_LAG); // coalesced anchor (S33-05/07)
    const v = log.verify();
    expect(v.failures).toEqual([]);
    expect(v.rows).toBe(log.head().seq);
    await log.append({ kind: 'daemon.start', principal: KERNEL });
    await log.flushAnchors();
    expect(log.verify().ok).toBe(true);
    await log.close();
  });
});

describe('G-LOG-04 / M1.2 falsifier: p99 append and memory', () => {
  type Stats = { n: number; p50: number; p99: number; p999: number; max: number; over5: number; over5Frac: number };
  type PerfRun = { rows: number; seconds: number; bulk: Stats; critical: Stats; checkpoints: number; forcedAnchorRate: number; memory: { metric: string; mb: number | null }; rssMb: number };

  // Runs only in the isolated perf pass (`npm run test:perf`, GNOMON_PERF=1,
  // no file parallelism): inside the parallel suite other files' fsyncs contend
  // for the same SSD and the tail numbers measure the suite, not the log. One
  // attempt — a falsifier is never retried until it passes.
  it.runIf(process.env.GNOMON_PERF === '1')('bulk p99 < 5 ms and ≤ 0.1 % over 5 ms, critical (1/s under bulk load) p99 < 25 ms, memory < 150 MB', async () => {
    const rows = Number(process.env.GNOMON_LOG_PERF_ROWS ?? 10_000);
    const critN = Number(process.env.GNOMON_LOG_PERF_CRIT ?? 60);
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
      env: childEnv(tmpHome(), pem(), rows, 'perf', critN),
      encoding: 'utf8',
      timeout: 600_000,
    });
    expect(res.status, res.stderr).toBe(0);
    const r = JSON.parse(res.stdout.trim().split('\n').pop()!) as PerfRun;
    // Recorded numbers (G-HON-07: method = hrtime around append() incl. sign + commit, in a child running dist/; machine = this host).
    console.info(`[#kernel-log perf] ${os.hostname()} ${process.platform}/${process.arch} node ${process.version}: ${JSON.stringify(r)}`);
    if (process.env.CI) return; // recorded only on shared runners
    expect(r!.bulk.p99).toBeLessThan(5);
    expect(r!.bulk.over5Frac).toBeLessThanOrEqual(0.001);
    expect(r!.critical.n).toBeGreaterThanOrEqual(critN);
    // With n < 100 the p99 index IS the max (floor(0.99·n) = n-1): recorded above, asserted only when n ≥ 100.
    if (r!.critical.n >= 100) expect(r!.critical.p99).toBeLessThan(25);
    // p99.9, max and checkpoints are recorded above, not asserted (S33-08).
    expect(r!.memory.mb, 'per-OS memory metric unavailable').not.toBeNull();
    expect(r!.memory.mb!).toBeLessThan(150);
  }, 1_900_000);
});
