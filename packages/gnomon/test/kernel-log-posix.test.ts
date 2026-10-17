// @gnomon-platform: darwin, linux
/**
 * #kernel-log (spec §3.2, M1.2) — the POSIX half: owner-only file modes, crash
 * safety under kill -9, and G-LOG-04 / the M1.2 falsifier (p99 append > 5 ms
 * or memory > 150 MB by the per-OS metric of §16's memory row:
 * `phys_footprint` on macOS via /usr/bin/footprint, never RSS; `Pss` from
 * /proc/self/smaps_rollup on Linux CI). Windows (private bytes) is the parity
 * phase (P8-D78) — see platform-registry.ts.
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
import { KernelLog, SoftwareEd25519Signer } from '../src/kernel/log/index.js';
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
const lat = new Float64Array(n);
for (let i = 0; mode === 'crash' || i < n; i++) {
  const t = process.hrtime.bigint();
  log.append({ kind: 'session.open', principal: '${KERNEL}', session: 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0', payload: { i, note: 'x'.repeat(64) } });
  if (mode === 'perf') lat[i] = Number(process.hrtime.bigint() - t) / 1e6;
  if (mode === 'crash' && i === n) process.stdout.write('ready\n');
}
lat.sort();
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];
let memory = { metric: 'none', mb: null };
if (process.platform === 'darwin' && existsSync('/usr/bin/footprint')) {
  const out = execFileSync('/usr/bin/footprint', ['-p', String(process.pid)], { encoding: 'utf8' });
  const m = /Footprint:\s*([\d.]+)\s*(KB|MB|GB)/.exec(out);
  if (m) memory = { metric: 'phys_footprint', mb: Number(m[1]) * ({ KB: 1 / 1024, MB: 1, GB: 1024 })[m[2]] };
} else if (process.platform === 'linux' && existsSync('/proc/self/smaps_rollup')) {
  const m = /^Pss:\s+(\d+) kB/m.exec(readFileSync('/proc/self/smaps_rollup', 'utf8'));
  if (m) memory = { metric: 'Pss', mb: Number(m[1]) / 1024 };
}
log.close();
process.stdout.write(JSON.stringify({ rows: n, p50: q(0.5), p99: q(0.99), max: lat[lat.length - 1], memory, rssMb: process.memoryUsage().rss / 1048576 }) + '\n');
`;

function childEnv(home: string, key: string, rows: number, mode: 'perf' | 'crash'): NodeJS.ProcessEnv {
  return { ...process.env, GN_DIST: DIST, GN_HOME: home, GN_KEY: key, GN_ROWS: String(rows), GN_MODE: mode };
}

describe('#kernel-log file modes (owner-only, §15.2 custody posture)', () => {
  it('kernel.db, its WAL, the head anchor and the segment dir are owner-only', () => {
    const home = tmpHome();
    const log = KernelLog.open({ home, kernelPrincipal: KERNEL, signer: SoftwareEd25519Signer.generate(), segmentRows: 4 });
    for (let i = 0; i < 5; i++) log.append({ kind: 'daemon.start', principal: KERNEL });
    const mode = (p: string) => statSync(path.join(home, p)).mode & 0o777;
    expect(mode('kernel.db')).toBe(0o600);
    expect(mode('kernel.db-wal')).toBe(0o600);
    expect(mode('head')).toBe(0o600);
    expect(mode('log')).toBe(0o700);
    expect(mode('log/segments')).toBe(0o700);
    expect(mode('log/segments/000001.db')).toBe(0o600);
    log.close();
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
    expect(log.report.anchorLag).toBeLessThanOrEqual(1);
    const v = log.verify();
    expect(v.failures).toEqual([]);
    expect(v.rows).toBe(log.head().seq);
    log.append({ kind: 'daemon.start', principal: KERNEL });
    expect(log.verify().ok).toBe(true);
    log.close();
  });
});

describe('G-LOG-04 / M1.2 falsifier: p99 append and memory', () => {
  it('p99 append < 5 ms and memory < 150 MB (per-OS metric) over GNOMON_LOG_PERF_ROWS rows', () => {
    const rows = Number(process.env.GNOMON_LOG_PERF_ROWS ?? 10_000);
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
      env: childEnv(tmpHome(), pem(), rows, 'perf'),
      encoding: 'utf8',
      timeout: 600_000,
    });
    expect(res.status, res.stderr).toBe(0);
    const r = JSON.parse(res.stdout.trim().split('\n').pop()!) as {
      rows: number;
      p50: number;
      p99: number;
      max: number;
      memory: { metric: string; mb: number | null };
      rssMb: number;
    };
    // Recorded numbers (G-HON-07: method = hrtime around append() incl. sign + commit, in a child running dist/; machine = this host).
    console.info(`[#kernel-log perf] ${os.hostname()} ${process.platform}/${process.arch} node ${process.version}: ${JSON.stringify(r)}`);
    if (process.env.CI) return; // recorded only on shared runners
    expect(r.p99).toBeLessThan(5);
    expect(r.memory.mb, 'per-OS memory metric unavailable').not.toBeNull();
    expect(r.memory.mb!).toBeLessThan(150);
  }, 620_000);
});
