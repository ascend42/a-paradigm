// @gnomon-platform: darwin, linux
/**
 * #release-pins (T-2026-10-21-028, TD-2026-10-21-758, G-HLP-01): a release build pins the exact helper and voice-io
 * bytes ON TOP of the code-signing requirement and the version floor; a dev build (no manifest) keeps signature +
 * floor only. The verifier is simulated: it ACCEPTS the signature (a byte-flipped, re-signed helper would pass
 * codesign), so the sha256 pin is the only thing that can refuse it.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReleaseManifestV1 } from '@a-company/gnomon-contracts';
import { HELPER_REQUIREMENT, HelperProcess, HelperUnavailableError, MIN_HELPER_VERSION, pinHelper, type HelperVerifier } from '../src/kernel/identity/helper.js';
import { parseBuildStamp } from '../src/kernel/lifecycle/build-stamp.js';
import { DEV_PINS, artifactPin, loadedReleasePins, releasePinsFromCompiled, type ReleasePins } from '../src/kernel/lifecycle/release-pins.js';
import { installVoiceApp, MIN_VOICE_IO_VERSION, recheckVoiceApp, VOICE_APP_NAME, VOICE_IO_IN_APP, VOICE_IO_REQUIREMENT, VoiceAppRefused } from '../src/kernel/voice/voice-install.js';
import { removeTree } from '../src/kernel/manifest/index.js';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmps: string[] = [];
function tmp(): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-rel-')));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});

/** Simulates codesign accepting the file (a valid Developer ID signature): only the pin can refuse. */
const SIGNED: HelperVerifier = Object.freeze({ kind: 'codesign' as const, verify: () => undefined, verifyRunning: () => undefined });
const sha = (f: string) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function fakeServe(dir: string, version = MIN_HELPER_VERSION): string {
  const f = path.join(dir, 'gnomon-helper');
  fs.writeFileSync(
    f,
    `#!${process.execPath}
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const req = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    process.stdout.write(JSON.stringify({ id: req.id, ok: true, op: req.op, ...(req.op === 'info' ? { protocol: 'gnomon-helper:v2', version: '${version}' } : {}) }) + '\\n');
  }
});
// pad
`,
  );
  fs.chmodSync(f, 0o755);
  return f;
}

/** Flip one bit inside the trailing `# pad` / `// pad` comment: still a runnable script, different bytes. */
function flipByte(f: string): void {
  const b = fs.readFileSync(f);
  b[b.length - 3] ^= 0x01;
  fs.writeFileSync(f, b);
}

function release(over: Partial<{ helperSha: string; helperVersion: string; helperReq: string; voiceSha: string; voiceVersion: string; arch: string }> = {}): ReleasePins {
  const manifest: ReleaseManifestV1 = {
    schemaVersion: 'gnomon-release-manifest:v1',
    release: '8.0.0',
    artifacts: [
      { name: 'gnomon-helper', version: over.helperVersion ?? MIN_HELPER_VERSION, sha256: over.helperSha ?? 'a'.repeat(64), requirement: over.helperReq ?? HELPER_REQUIREMENT, arch: (over.arch ?? 'universal') as 'universal' },
      { name: 'gnomon-voice-io', version: over.voiceVersion ?? MIN_VOICE_IO_VERSION, sha256: over.voiceSha ?? 'b'.repeat(64), requirement: VOICE_IO_REQUIREMENT, arch: (over.arch ?? 'universal') as 'universal' },
    ],
  };
  const pins = releasePinsFromCompiled(true, JSON.stringify(manifest));
  expect(pins.mode).toBe('release');
  return pins;
}

const reason = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof HelperUnavailableError || e instanceof VoiceAppRefused ? e.reason : `other: ${(e as Error).message}`;
  }
  return 'no-throw';
};

describe('#release-pins: the compiled pins', () => {
  it('not a release ⇒ dev; a release with no, unparsable or invalid compiled manifest ⇒ broken (never dev)', () => {
    expect(releasePinsFromCompiled(false, null)).toBe(DEV_PINS);
    expect(releasePinsFromCompiled(true, null).mode).toBe('broken');
    expect(releasePinsFromCompiled(true, '{not json').mode).toBe('broken');
    expect(releasePinsFromCompiled(true, JSON.stringify({ schemaVersion: 'gnomon-release-manifest:v1', release: '8.0.0', artifacts: [] })).mode).toBe('broken');
    expect(artifactPin(releasePinsFromCompiled(true, null), 'gnomon-helper').kind).toBe('refuse');
  });

  it('tests run from src: the loaded kernel is a dev build', () => {
    expect(loadedReleasePins().mode).toBe('dev');
  });

  it('parseBuildStamp keeps a valid release and rejects a stamp whose release is invalid', () => {
    const base = { schemaVersion: 'gnomon-build:v1', version: '8.0.0', commit: 'abc', distHash: `sha256:${'0'.repeat(64)}`, guiBundleHash: null };
    const r = release();
    expect(parseBuildStamp({ ...base, release: r.mode === 'release' ? r.manifest : null })?.release?.release).toBe('8.0.0');
    expect(parseBuildStamp({ ...base, release: { bogus: true } })).toBeNull();
    expect(parseBuildStamp(base)?.release).toBeUndefined();
  });
});

describe('#release-pins: the helper (G-HLP-01 wired)', () => {
  it('a byte-flipped helper with a VALID signature is refused `checksum` in a release build; the shipped bytes pin', () => {
    const exe = fakeServe(tmp());
    const pins = release({ helperSha: sha(exe) });
    expect(pinHelper(exe, { verifier: SIGNED, pins }).sha256).toBe(sha(exe));
    flipByte(exe);
    expect(reason(() => pinHelper(exe, { verifier: SIGNED, pins }))).toBe('checksum');
  });

  it('a release with no helper for this arch, a broken stamp, or another requirement refuses `checksum`; a pinned version below the floor refuses `version`', () => {
    const exe = fakeServe(tmp());
    const other = process.arch === 'arm64' ? 'x64' : 'arm64';
    expect(reason(() => pinHelper(exe, { verifier: SIGNED, pins: release({ helperSha: sha(exe), arch: other }) }))).toBe('checksum');
    expect(reason(() => pinHelper(exe, { verifier: SIGNED, pins: { mode: 'broken', why: 'test' } }))).toBe('checksum');
    expect(reason(() => pinHelper(exe, { verifier: SIGNED, pins: release({ helperSha: sha(exe), helperReq: 'identifier "x"' }) }))).toBe('checksum');
    expect(reason(() => pinHelper(exe, { verifier: SIGNED, pins: release({ helperSha: sha(exe), helperVersion: '1.0.0' }) }))).toBe('version');
  });

  it('an older helper (valid signature, matching bytes in a dev build) is refused `version` at the handshake', async () => {
    const h = HelperProcess.start(pinHelper(fakeServe(tmp(), '1.0.0'), { verifier: SIGNED, pins: DEV_PINS }));
    const err = await h.request({ op: 'key.public' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HelperUnavailableError);
    expect((err as HelperUnavailableError).reason).toBe('version');
  });

  it('a dev build (no manifest) still pins and starts the helper: signature + version floor only', async () => {
    const exe = fakeServe(tmp());
    flipByte(exe); // any bytes: dev pins no sha256
    const h = HelperProcess.start(pinHelper(exe, { verifier: SIGNED, pins: DEV_PINS }));
    expect((await h.request({ op: 'ping' })).op).toBe('ping');
    await h.close();
  });
});

describe('#release-pins: voice-io', () => {
  function app(dir: string, body = '#!/bin/sh\necho "gnomon-voice-io 0.1.0"\n# pad\n'): string {
    const a = path.join(dir, 'src', VOICE_APP_NAME);
    fs.mkdirSync(path.join(a, path.dirname(VOICE_IO_IN_APP)), { recursive: true });
    fs.writeFileSync(path.join(a, VOICE_IO_IN_APP), body, { mode: 0o755 });
    return a;
  }
  const signed = () => ({ ok: true, detail: '' });
  const ditto = (s: string, d: string) => fs.cpSync(s, d, { recursive: true });
  const exeOf = (a: string) => path.join(a, VOICE_IO_IN_APP);

  it('a byte-flipped, validly signed voice-io is refused `checksum` in a release build (even with the dev flag); the shipped bytes install', () => {
    const d = tmp();
    const sourceApp = app(d);
    const pins = release({ voiceSha: sha(exeOf(sourceApp)) });
    const ok = installVoiceApp({ home: path.join(d, 'home'), sourceApp, devUnsigned: false, check: signed, ditto, pins, readVersion: () => '0.1.0' });
    expect(ok.devUnsigned).toBe(false);
    expect(sha(ok.ioBinary)).toBe(sha(exeOf(sourceApp)));
    flipByte(exeOf(sourceApp));
    for (const devUnsigned of [false, true]) expect(reason(() => installVoiceApp({ home: path.join(d, 'home'), sourceApp, devUnsigned, check: signed, ditto, pins, readVersion: () => '0.1.0' }))).toBe('checksum');
    expect(fs.existsSync(path.join(d, 'home', 'bin', 'voice', `.${VOICE_APP_NAME}.staging`))).toBe(false);
  });

  it('an older voice-io is refused `version` (dev and release); a release pinning an old version refuses too; no arch entry refuses `checksum`', () => {
    const d = tmp();
    const sourceApp = app(d);
    const base = { home: path.join(d, 'home'), sourceApp, devUnsigned: false, check: signed, ditto };
    expect(reason(() => installVoiceApp({ ...base, pins: DEV_PINS, readVersion: () => '0.0.9' }))).toBe('version');
    expect(reason(() => installVoiceApp({ ...base, pins: DEV_PINS, readVersion: () => null }))).toBe('version');
    expect(reason(() => installVoiceApp({ ...base, pins: release({ voiceSha: sha(exeOf(sourceApp)), voiceVersion: '0.0.1' }), readVersion: () => '0.1.0' }))).toBe('version');
    const other = process.arch === 'arm64' ? 'x64' : 'arm64';
    expect(reason(() => installVoiceApp({ ...base, pins: release({ voiceSha: sha(exeOf(sourceApp)), arch: other }), readVersion: () => '0.1.0' }))).toBe('checksum');
  });

  it('a dev build (no manifest) installs any signed voice-io at or above the floor; the default version probe runs the copy', () => {
    const d = tmp();
    const sourceApp = app(d);
    flipByte(exeOf(sourceApp)); // dev pins no sha256: changed bytes still install
    const r = installVoiceApp({ home: path.join(d, 'home'), sourceApp, devUnsigned: false, check: signed, ditto, pins: DEV_PINS, readVersion: () => '0.1.0' });
    expect(fs.existsSync(r.ioBinary)).toBe(true);
    const real = installVoiceApp({ home: path.join(d, 'home2'), sourceApp: app(tmp()), devUnsigned: false, check: signed, ditto, pins: DEV_PINS });
    expect(fs.existsSync(real.ioBinary)).toBe(true);
    expect(reason(() => installVoiceApp({ home: path.join(d, 'home3'), sourceApp: app(tmp(), '#!/bin/sh\necho "gnomon-voice-io 0.0.1"\n'), devUnsigned: false, check: signed, ditto, pins: DEV_PINS }))).toBe('version');
  });
});

describe('#release-pins: voice-io re-verified right before the spawn (Aegis M1 review)', () => {
  function installed(d: string, check = () => ({ ok: true, detail: '' }), pins: ReleasePins = DEV_PINS) {
    const a = path.join(d, 'src', VOICE_APP_NAME);
    fs.mkdirSync(path.join(a, path.dirname(VOICE_IO_IN_APP)), { recursive: true });
    fs.writeFileSync(path.join(a, VOICE_IO_IN_APP), '#!/bin/sh\necho "gnomon-voice-io 0.1.0"\n# pad\n', { mode: 0o755 });
    return installVoiceApp({ home: path.join(d, 'home'), sourceApp: a, devUnsigned: false, check, ditto: (s2, d2) => fs.cpSync(s2, d2, { recursive: true }), pins, readVersion: () => '0.1.0' });
  }

  it('an untouched copy passes; a swapped, byte-flipped or removed executable is refused before the spawn', () => {
    const d = tmp();
    const r = installed(d);
    expect(() => recheckVoiceApp(r.appPin!)).not.toThrow();
    flipByte(r.ioBinary);
    expect(reason(() => recheckVoiceApp(r.appPin!))).toBe('changed');
    const r2 = installed(tmp());
    const swapped = `${r2.ioBinary}.new`;
    fs.copyFileSync(r2.ioBinary, swapped);
    fs.renameSync(swapped, r2.ioBinary); // same bytes, new inode
    expect(reason(() => recheckVoiceApp(r2.appPin!))).toBe('changed');
    const r3 = installed(tmp());
    fs.rmSync(r3.ioBinary);
    expect(reason(() => recheckVoiceApp(r3.appPin!))).toBe('changed');
  });

  it('the signature is re-checked (a copy whose requirement no longer holds is refused `unsigned`); the release sha256 is re-checked', () => {
    let ok = true;
    const r = installed(tmp(), () => ({ ok, detail: 'test' }));
    ok = false;
    expect(reason(() => recheckVoiceApp(r.appPin!))).toBe('unsigned');
    const d = tmp();
    const probe = installed(d);
    const pins = release({ voiceSha: probe.appPin!.facts.sha256 });
    const pinned = installed(tmp(), undefined, pins);
    expect(() => recheckVoiceApp(pinned.appPin!)).not.toThrow();
    expect(reason(() => recheckVoiceApp({ ...pinned.appPin!, expectedSha256: 'c'.repeat(64) }))).toBe('checksum');
  });
});

describe('a RELEASE bundle (scripts/build-release.mjs): the pins are compiled in, never read from the stamp', () => {
  const run = (code: string) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  it('stamp deleted, stamp edited, dist/index.js, a copied dist: still the compiled hashes, a flipped helper refused `checksum`', { timeout: 180_000 }, () => {
    const d = tmp();
    const helper = path.join(d, 'gnomon-helper');
    fs.writeFileSync(helper, `#!/bin/sh\necho "gnomon-helper ${MIN_HELPER_VERSION}"\n# pad\n`, { mode: 0o755 });
    const voice = path.join(d, 'gnomon-voice-io');
    fs.writeFileSync(voice, `#!/bin/sh\necho "gnomon-voice-io ${MIN_VOICE_IO_VERSION}"\n`, { mode: 0o755 });
    const dist = path.join(d, 'dist');
    const b = spawnSync(process.execPath, [path.join(PKG, 'scripts', 'build-release.mjs'), '--out-dir', dist, '--helper', helper, '--voice-io', voice, '--arch', 'universal', '--no-codesign', '--release', '8.0.0'], { encoding: 'utf8', cwd: PKG });
    expect(b.status, b.stderr).toBe(0);
    const stamp = JSON.parse(fs.readFileSync(path.join(dist, 'build-id.json'), 'utf8'));
    expect(stamp.release.artifacts.map((a: { sha256: string }) => a.sha256)).toEqual([sha(helper), sha(voice)]);
    const probe = (distDir: string) => {
      const r = run(`
        const m = await import(${JSON.stringify(path.join(distDir, 'index.js'))});
        const pins = m.releasePins.loadedReleasePins();
        const v = { kind: 'codesign', verify() {}, verifyRunning() {} };
        let refused = null;
        try { m.pinHelper(${JSON.stringify(helper)}, { verifier: v }); } catch (e) { refused = e.reason; }
        process.stdout.write(JSON.stringify({ mode: pins.mode, helper: m.releaseHelperSha256(pins), voice: m.releaseVoiceIoSha256(pins), refused }));
      `);
      expect(r.status, r.stderr).toBe(0);
      return JSON.parse(r.stdout) as { mode: string; helper: string; voice: string; refused: string | null };
    };
    const want = { mode: 'release', helper: sha(helper), voice: sha(voice), refused: null };
    expect(probe(dist)).toEqual(want);
    // the stamp edited to other hashes: the compiled ones still pin
    fs.writeFileSync(path.join(dist, 'build-id.json'), JSON.stringify({ ...stamp, release: { ...stamp.release, artifacts: stamp.release.artifacts.map((a: object) => ({ ...a, sha256: 'e'.repeat(64) })) } }));
    expect(probe(dist)).toEqual(want);
    // the stamp deleted: still release, never dev
    fs.rmSync(path.join(dist, 'build-id.json'));
    expect(probe(dist)).toEqual(want);
    // a copied dist elsewhere: still pinned
    const copy = path.join(tmp(), 'elsewhere');
    fs.cpSync(dist, copy, { recursive: true });
    expect(probe(copy)).toEqual(want);
    // a byte-flipped helper (signature simulated as valid) is refused by the release bundle
    flipByte(helper);
    expect(probe(copy).refused).toBe('checksum');
    // and the workspace's own dev bundle stays dev
    if (fs.existsSync(path.join(PKG, 'dist', 'index.js'))) expect(probe(path.join(PKG, 'dist')).mode).toBe('dev');
  });

  it('write-release-manifest refuses a helper below the floor; an invalid manifest fails the stamp', () => {
    const d = tmp();
    const helper = path.join(d, 'gnomon-helper');
    fs.writeFileSync(helper, '#!/bin/sh\necho "gnomon-helper 1.0.0"\n', { mode: 0o755 });
    const voice = path.join(d, 'gnomon-voice-io');
    fs.writeFileSync(voice, `#!/bin/sh\necho "gnomon-voice-io ${MIN_VOICE_IO_VERSION}"\n`, { mode: 0o755 });
    const out = path.join(d, 'm.json');
    const old = spawnSync(process.execPath, [path.join(PKG, 'scripts', 'write-release-manifest.mjs'), '--helper', helper, '--voice-io', voice, '--out', out, '--arch', 'universal', '--no-codesign'], { encoding: 'utf8' });
    expect(old.status).toBe(1);
    expect(old.stderr).toMatch(/below the kernel's floor|dist\/index.js is missing/);
    fs.writeFileSync(out, JSON.stringify({ schemaVersion: 'gnomon-release-manifest:v1', release: '8.0.0', artifacts: [] }));
    const dist = path.join(d, 'dist');
    fs.mkdirSync(dist);
    const bad = spawnSync(process.execPath, [path.join(PKG, 'scripts', 'build-stamp.mjs'), '--dist', dist], { encoding: 'utf8', env: { ...process.env, GNOMON_RELEASE_MANIFEST: out } });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/refusing to stamp a release/);
  });
});
