/**
 * #kernel-sea TD-2026-10-29-746 (helper 1.11.0 slice, kernel side): the voice client pin and the running-child check.
 * Platform-independent: the SEA facts, guard and codesign verifier are stubbed; voiceTreeHash runs on a temp tree.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkVoiceClient, verifyRunningChild, type SeaGuard } from '../src/kernel/lifecycle/sea.js';
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

describe('verifyRunningChild (the running child meets the child-node pin)', () => {
  const child = () => ({ pid: 4242, kill: vi.fn(() => true) });

  it('is a no-op outside the SEA and for a command that is not the child node (sandbox-exec, claude)', () => {
    expect(verifyRunningChild('/usr/bin/node', child(), { sea: false })).toBeNull();
    expect(verifyRunningChild('/usr/bin/sandbox-exec', child(), { sea: true, guard: guard(), verify: async () => 0 })).toBeNull();
  });

  it('FALSIFIER: no guard kills the child', async () => {
    const c = child();
    expect(await verifyRunningChild('/x/node', c, { sea: true, guard: null })).toBe(false);
    expect(c.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('FALSIFIER: a running child that fails codesign -R is SIGKILLed; one that passes is kept', async () => {
    // the dev SEA candidate: <dir of execPath>/node/bin/node
    const node = path.join(path.dirname(process.execPath), 'node', 'bin', 'node');
    const bad = child();
    const seen: Array<[number, string]> = [];
    expect(await verifyRunningChild(node, bad, { sea: true, guard: guard(), verify: async (pid, req) => (seen.push([pid, req]), 3) })).toBe(false);
    expect(bad.kill).toHaveBeenCalledWith('SIGKILL');
    expect(seen).toEqual([[4242, 'identifier "gnomon.node"']]);
    const good = child();
    expect(await verifyRunningChild(node, good, { sea: true, guard: guard(), verify: async () => 0 })).toBe(true);
    expect(good.kill).not.toHaveBeenCalled();
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
});
