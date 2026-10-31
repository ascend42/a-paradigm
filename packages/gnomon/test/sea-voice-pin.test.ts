/**
 * #kernel-sea TD-2026-10-29-746 (helper 1.11.0 slice, kernel side): the voice client pin and the running-child check.
 * Platform-independent: the SEA facts, guard and codesign verifier are stubbed; voiceTreeHash runs on a temp tree.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { checkVoiceClient, gateRunningChild, gateRunningSocket, type SeaGuard } from '../src/kernel/lifecycle/sea.js';
import * as sea from '../scripts/build-sea.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'gnomon-voice-pin-'));
  dirs.push(d);
  return d;
};

const guard = (o: Partial<SeaGuard> = {}): SeaGuard => ({
  profile: 'release',
  distTree: `sha256:${'0'.repeat(64)}`,
  childNodeRequirement: 'identifier "gnomon.node"',
  checkDist: () => undefined,
  checkChildNode: () => undefined,
  ...o,
});

describe('checkVoiceClient (the SEA voice client pin)', () => {
  it('is a no-op outside the SEA', () => {
    expect(() => checkVoiceClient('/anywhere/cli.js', { sea: false })).not.toThrow();
  });

  it('FALSIFIER: a SEA without a voice pin, a changed tree, or an entry outside the pinned dir refuses', () => {
    const root = tmp();
    mkdirSync(path.join(root, 'dist'));
    writeFileSync(path.join(root, 'dist', 'cli.js'), '');
    const entry = path.join(root, 'dist', 'cli.js');
    expect(() => checkVoiceClient(entry, { sea: true, guard: null })).toThrow(/no voice client pin/);
    expect(() => checkVoiceClient(entry, { sea: true, guard: guard() })).toThrow(/no voice client pin/);
    expect(() => checkVoiceClient(entry, { sea: true, guard: guard({ voiceRoot: root, checkVoice: () => { throw new Error('the voice client hashes to sha256:x'); } }) })).toThrow(/hashes to/);
    expect(() => checkVoiceClient('/tmp/elsewhere/cli.js', { sea: true, guard: guard({ voiceRoot: root, checkVoice: () => undefined }) })).toThrow(/outside the pinned/);
    const e = (() => { try { checkVoiceClient(entry, { sea: true, guard: null }); } catch (x) { return x as Error; } return null; })();
    expect(e?.name).toBe('VoiceClientRefused'); // voice-child marks it unavailable, never retried
    expect(() => checkVoiceClient(entry, { sea: true, guard: guard({ voiceRoot: root, checkVoice: () => undefined }) })).not.toThrow();
  });
});

describe('gateRunningChild / gateRunningSocket (Aegis S1 M2: nothing a child says is read before its RUNNING pid passes)', () => {
  const mk = () => {
    const stdout = new PassThrough();
    return { pid: 4242, kill: vi.fn(() => true), stdout, stdio: [null, stdout, null] } as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> };
  };

  it('is a no-op outside the SEA', () => {
    expect(gateRunningChild(mk(), { sea: false })).toBeNull();
    expect(gateRunningSocket(mk(), new PassThrough(), { sea: false })).toBeNull();
  });

  it('FALSIFIER: bytes are held until the pid passes, then delivered in order (direct or under sandbox-exec: no command check)', async () => {
    const c = mk();
    const raw = c.stdout!;
    let release!: (n: number) => void;
    const seen: Array<[number, string]> = [];
    const p = gateRunningChild(c, { sea: true, guard: guard(), verify: (pid, req) => (seen.push([pid, req]), new Promise<number>((r) => (release = r))) })!;
    const chunks: string[] = [];
    c.stdout!.on('data', (b: Buffer) => chunks.push(b.toString()));
    raw.write('hello ');
    raw.write('world');
    await new Promise((r) => setImmediate(r));
    expect(seen).toEqual([[4242, 'identifier "gnomon.node"']]);
    expect(chunks).toEqual([]);
    release(0);
    expect(await p).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(chunks.join('')).toBe('hello world');
    expect(c.kill).not.toHaveBeenCalled();
  });

  it('FALSIFIER: a failing pid is SIGKILLed and nothing it wrote is ever delivered', async () => {
    const c = mk();
    const raw = c.stdout!;
    const p = gateRunningChild(c, { sea: true, guard: guard(), verify: async () => 3 })!;
    const chunks: string[] = [];
    c.stdout!.on('data', (b: Buffer) => chunks.push(b.toString()));
    raw.write('{"forged":true}');
    expect(await p).toBe(false);
    expect(c.kill).toHaveBeenCalledWith('SIGKILL');
    expect(chunks).toEqual([]);
  });

  it('FALSIFIER: no guard kills at once', async () => {
    const c = mk();
    expect(await gateRunningChild(c, { sea: true, guard: null })).toBe(false);
    expect(c.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('FALSIFIER (Aegis S2 L-3): a child that writes more than the cap before its check passes is killed; nothing is delivered', async () => {
    const c = mk();
    const raw = c.stdout!;
    let release!: (n: number) => void;
    const p = gateRunningChild(c, { sea: true, guard: guard(), maxHeldBytes: 8, verify: () => new Promise<number>((r) => (release = r)) })!;
    const chunks: string[] = [];
    c.stdout!.on('data', (b: Buffer) => chunks.push(b.toString()));
    raw.write('12345');
    raw.write('67890');
    expect(await p).toBe(false);
    expect(c.kill).toHaveBeenCalledWith('SIGKILL');
    release(0); // a late pass changes nothing
    await new Promise((r) => setImmediate(r));
    expect(chunks).toEqual([]);
  });

  it('Aegis S2 L-3: the codesign timeout is below the voice client\'s 15 s RPC timeout and the default cap is 1 MiB', async () => {
    const { RUNNING_CHILD_CODESIGN_TIMEOUT_MS, GATE_MAX_HELD_BYTES } = await import('../src/kernel/lifecycle/sea.js');
    expect(RUNNING_CHILD_CODESIGN_TIMEOUT_MS).toBeLessThan(15_000);
    expect(GATE_MAX_HELD_BYTES).toBe(1 << 20);
  });

  it('FALSIFIER (Aegis S2 L-2): a model fetch whose gate is not true fails, a silent exit 0 included', async () => {
    const { fetchVoiceModels } = await import('../src/kernel/voice/voice-install.js');
    const d = tmp();
    const entry = path.join(d, 'fetch.mjs');
    writeFileSync(entry, 'process.exit(0)\n'); // says nothing, exits 0
    const run = (gate: () => Promise<boolean> | null) => fetchVoiceModels({ home: d, entry, report: () => undefined, execPath: process.execPath, gate });
    await expect(run(() => Promise.resolve(false))).rejects.toThrow(/not verified/);
    await expect(run(() => Promise.reject(new Error('x')))).rejects.toThrow(/not verified/);
    await expect(run(() => Promise.resolve(true))).resolves.toBeUndefined();
    await expect(run(() => null)).resolves.toBeUndefined(); // not a SEA: no gate
  });

  it('Aegis S2 L-4: the dev helper profile needs the SEA AND a dev guard', async () => {
    const { kernelHelperProfile, helperRequirements, HELPER_DEV_REQUIREMENT } = await import('../src/kernel/identity/helper.js');
    expect(kernelHelperProfile(true, { profile: 'dev' })).toBe('dev');
    expect(kernelHelperProfile(false, { profile: 'dev' })).toBeNull(); // a plain-node process with a planted global
    expect(kernelHelperProfile(true, { profile: 'release' })).toBeNull();
    expect(kernelHelperProfile(true, null)).toBeNull();
    expect(helperRequirements()).not.toContain(HELPER_DEV_REQUIREMENT); // the test process is not a SEA
  });

  it('the duplex link (voice fd 3) is handed over only after the first bytes and a passing pid; the bytes stay unread', async () => {
    const c = mk();
    const sock = new PassThrough();
    const p = gateRunningSocket(c, sock, { sea: true, guard: guard(), verify: async () => 0 })!;
    sock.write('hi');
    expect(await p).toBe(true);
    expect(String(sock.read())).toBe('hi');
    const bad = mk();
    const s2 = new PassThrough();
    const q = gateRunningSocket(bad, s2, { sea: true, guard: guard(), verify: async () => 1 })!;
    s2.write('x');
    expect(await q).toBe(false);
    expect(bad.kill).toHaveBeenCalledWith('SIGKILL');
  });
});

describe('voiceTreeHash (build) and the kernel stamp', () => {
  it('covers package.json, dist and node_modules (addons too), hashes symlinks as text, and changes with any file', async () => {
    const { voiceTreeHash } = await import('../scripts/release-darwin.mjs');
    const root = tmp();
    writeFileSync(path.join(root, 'package.json'), '{}');
    mkdirSync(path.join(root, 'dist'));
    writeFileSync(path.join(root, 'dist', 'cli.js'), 'a');
    mkdirSync(path.join(root, 'node_modules', 'onnx', 'bin'), { recursive: true });
    writeFileSync(path.join(root, 'node_modules', 'onnx', 'bin', 'x.node'), 'n');
    writeFileSync(path.join(root, 'node_modules', 'onnx', 'bin', 'x.dylib'), 'd');
    mkdirSync(path.join(root, 'node_modules', '.bin'));
    symlinkSync('../onnx/bin/x.node', path.join(root, 'node_modules', '.bin', 'x'));
    const a = voiceTreeHash(root);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(voiceTreeHash(root)).toBe(a);
    writeFileSync(path.join(root, 'node_modules', 'onnx', 'bin', 'x.dylib'), 'D');
    expect(voiceTreeHash(root)).not.toBe(a);
  });

  it('the stamp the helper reads is gnomon-kernel-stamp:v1 + {profile, version}', () => {
    expect(sea.KERNEL_STAMP_SEGMENT).toBe('__GNOMON');
    expect(sea.KERNEL_STAMP_SECTION).toBe('GNOMON_STAMP');
    expect(sea.kernelStampBytes({ profile: 'release', version: '8.1.0' }).toString('utf8')).toBe('gnomon-kernel-stamp:v1\n{"profile":"release","version":"8.1.0"}');
    expect(() => sea.kernelStampBytes({ profile: 'probe', version: '8.1.0' })).toThrow();
  });

  it('fix 2026-10-31: postject writes the resource as __<name>, and the helper reads exactly that section', () => {
    expect(sea.KERNEL_STAMP_MACHO_SECTION).toBe(`__${sea.KERNEL_STAMP_SECTION}`);
    const swift = readFileSync(path.join(__dirname, '..', '..', 'gnomon-helper', 'darwin', 'Sources', 'gnomon-helper', 'Caller.swift'), 'utf8');
    expect(/^let kernelStampSection = "([^"]+)"$/m.exec(swift)?.[1]).toBe(sea.KERNEL_STAMP_MACHO_SECTION);
    expect(/^let kernelStampSegment = "([^"]+)"$/m.exec(swift)?.[1]).toBe(sea.KERNEL_STAMP_SEGMENT);
  });
});
